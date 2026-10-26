import type { Sql } from "../db.ts";
import type { Store } from "../store.ts";
import { deleteEvent, getEvent, putEvent } from "../lib/caldav.ts";
import { parseRowAt } from "../lib/eventWriteback.ts";
import {
  addExdate,
  buildEvent,
  foreignOrganizer,
  partstatFor,
  patchMaster,
  seriesCount,
  setPartstat,
  shiftMaster,
  splitSeries,
  upsertOverride,
  withoutOverrides,
} from "../lib/icalwrite.ts";
import { isUsableTimeZone } from "../lib/icalTz.ts";
import { materializeIcloudResource } from "../lib/icloudExpand.ts";
import { countRuleOccurrencesBefore } from "../lib/ics.ts";
import {
  deleteOwnedEventsByIds,
  deleteOwnedSeries,
  getOwnedEvent,
  hiddenCalendarIds,
  listOwnedAccounts,
  logSync,
  openAccountSecret,
} from "./store.ts";
import type { CalendarAccount } from "./types.ts";

type EventPatch = {
  title?: string;
  start_at?: string;
  end_at?: string;
  all_day?: boolean;
  location?: string | null;
  description?: string | null;
  recurrence?: string[] | null;
};

function editSeries(
  ics: string,
  p: EventPatch,
  evt: { start_at: string; end_at: string },
  timeZone: string | null,
): string {
  if (p.recurrence !== undefined) {
    const ruled = patchMaster(ics, {
      recurrence: p.recurrence?.length ? p.recurrence : null,
      title: p.title,
      location: p.location,
      description: p.description,
      timeZone,
    });
    return withoutOverrides(ruled);
  }
  if (p.all_day !== undefined) {
    return patchMaster(ics, {
      title: p.title,
      allDay: p.all_day,
      location: p.location,
      description: p.description,
    });
  }
  if (p.start_at || p.end_at) {
    const startDelta = p.start_at ? new Date(p.start_at).getTime() - new Date(evt.start_at).getTime() : 0;
    const endDelta = p.end_at ? new Date(p.end_at).getTime() - new Date(evt.end_at).getTime() : startDelta;
    let next = shiftMaster(ics, startDelta, p.title, endDelta, timeZone);
    if (p.location !== undefined || p.description !== undefined) {
      next = patchMaster(next, { location: p.location, description: p.description });
    }
    return next;
  }
  return patchMaster(ics, { title: p.title, location: p.location, description: p.description });
}

async function rewriteOwnedRow(
  sql: Sql,
  userId: string,
  eventId: string,
  patch: Record<string, unknown>,
  rowAt: { start_at: string; end_at: string } | null,
): Promise<void> {
  if (rowAt) {
    await sql`
      UPDATE external_events SET
        title = coalesce(${(patch.title as string | undefined) ?? null}, title),
        start_at = coalesce(${(patch.start_at as string | undefined) ?? null}, start_at),
        end_at = coalesce(${(patch.end_at as string | undefined) ?? null}, end_at),
        all_day = coalesce(${patch.all_day as boolean | null ?? null}, all_day),
        location = CASE WHEN ${patch.location !== undefined} THEN ${patch.location as string | null} ELSE location END
      WHERE id = ${eventId}
        AND user_id = ${userId}
        AND start_at = ${rowAt.start_at}
        AND end_at = ${rowAt.end_at}
    `;
    return;
  }
  await sql`
    UPDATE external_events SET
      title = coalesce(${(patch.title as string | undefined) ?? null}, title),
      start_at = coalesce(${(patch.start_at as string | undefined) ?? null}, start_at),
      end_at = coalesce(${(patch.end_at as string | undefined) ?? null}, end_at),
      all_day = coalesce(${patch.all_day as boolean | null ?? null}, all_day),
      location = CASE WHEN ${patch.location !== undefined} THEN ${patch.location as string | null} ELSE location END
    WHERE id = ${eventId} AND user_id = ${userId}
  `;
}

export async function handleIcloudEvents(
  store: Store,
  env: { TOKEN_ENC_KEY_V1?: string },
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const sql = store.sql;
  const userId = store.userId;
  const { eventId, action, patch } = body;
  let scope = (body.scope as string | undefined) ?? "THIS";
  const timeZone = isUsableTimeZone(body.timeZone as string) ? (body.timeZone as string) : null;

  if (action === "create") {
    const title = (typeof body.title === "string" ? body.title.trim() : "") || "(no title)";
    const start_at = body.start_at as string;
    const end_at = body.end_at as string;
    const all_day = Boolean(body.all_day);
    const recurrence = Array.isArray(body.recurrence) ? (body.recurrence as string[]) : undefined;
    if (!start_at || !end_at) return { status: 400, body: { error: "start_at and end_at required" } };

    const accountId = typeof body.accountId === "string" ? body.accountId : undefined;
    const accounts = await listOwnedAccounts(store, "icloud");
    const account = accounts.find((a) => !accountId || a.id === accountId);
    if (!account) return { status: 400, body: { error: "no iCloud account connected" } };

    const password = await openAccountSecret(account, env.TOKEN_ENC_KEY_V1);
    if (!password) return { status: 400, body: { error: "iCloud credential missing" } };

    const hidden = new Set(await hiddenCalendarIds(store));
    const namedCalendar = typeof body.calendarId === "string" ? body.calendarId.trim() : "";
    const visible = ((account.calendars ?? []) as { id?: string }[]).filter(
      (c) => typeof c.id === "string" && c.id && !hidden.has(c.id),
    );
    const calendarUrl = namedCalendar || visible[0]?.id;
    if (!calendarUrl) {
      return {
        status: 400,
        body: {
          error:
            "No visible Apple calendar to create on. Unhide a calendar you own in Settings → Calendars.",
        },
      };
    }

    const location = typeof body.location === "string" ? body.location : null;
    const description = typeof body.description === "string" ? body.description : null;
    const uid = `nuvo-${crypto.randomUUID()}`;
    const ics = buildEvent({
      uid,
      title,
      startISO: start_at,
      endISO: end_at,
      allDay: all_day,
      location,
      description,
      recurrence,
      timeZone,
    });
    const href = `${calendarUrl.replace(/\/$/, "")}/${uid}.ics`;
    let etag: string | null;
    try {
      etag = await putEvent(href, ics, account.email, password);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/\bHTTP 403\b/.test(msg)) {
        throw new Error(
          "Apple didn't allow creating on this calendar. Shared calendars (like Family) often block new events from other apps — pick a calendar you own, or unhide one in Settings.",
        );
      }
      throw e;
    }

    const materialized = recurrence?.length
      ? await materializeIcloudResource(
          sql,
          {
            userId,
            accountId: account.id,
            accountEmail: account.email,
            calendarId: calendarUrl,
            uid,
            href,
            etag,
          },
          ics,
          { anchorMs: new Date(start_at).getTime() },
        )
      : null;
    if (materialized) {
      await logSync(sql, "icloud", "event-create", "ok", undefined, userId);
      return { status: 200, body: { ok: true, event: materialized } };
    }

    const inserted = await sql`
      INSERT INTO external_events (
        user_id, account_id, provider_event_id, calendar_id, title,
        start_at, end_at, all_day, location, busy, raw, last_synced_at
      )
      VALUES (
        ${userId}, ${account.id}, ${uid}, ${calendarUrl}, ${title},
        ${new Date(start_at).toISOString()}, ${new Date(end_at).toISOString()},
        ${all_day}, ${location}, true,
        ${JSON.stringify({ caldav_href: href, caldav_etag: etag })}::jsonb,
        ${new Date().toISOString()}
      )
      ON CONFLICT (account_id, calendar_id, provider_event_id) DO UPDATE SET
        title = EXCLUDED.title,
        start_at = EXCLUDED.start_at,
        end_at = EXCLUDED.end_at,
        all_day = EXCLUDED.all_day,
        location = EXCLUDED.location,
        raw = EXCLUDED.raw,
        last_synced_at = EXCLUDED.last_synced_at
      WHERE external_events.user_id = ${userId}
      RETURNING id, account_id, provider_event_id, calendar_id, title, start_at, end_at, all_day, location, busy
    `;
    await logSync(sql, "icloud", "event-create", "ok", undefined, userId);
    return { status: 200, body: { ok: true, event: inserted[0] ?? null } };
  }

  if (typeof eventId !== "string" || !eventId) return { status: 400, body: { error: "eventId required" } };
  if (!action && !patch) return { status: 400, body: { error: "patch or action required" } };

  const evt = await getOwnedEvent(store, eventId);
  if (!evt) {
    return {
      status: 404,
      body: { error: "This event changed on Apple Calendar since it was opened — close it and open it again." },
    };
  }
  const account = evt.account as CalendarAccount;
  if (account.provider !== "icloud") return { status: 400, body: { error: "not an iCloud event" } };

  const password = await openAccountSecret(account, env.TOKEN_ENC_KEY_V1);
  if (!password) return { status: 400, body: { error: "iCloud credential missing" } };

  const raw = (evt.raw ?? {}) as Record<string, unknown>;
  const href = raw.caldav_href as string | undefined;
  if (!href) return { status: 400, body: { error: "event has no CalDAV resource on file — resync and retry" } };

  const [uidBase, suffix] = String(evt.provider_event_id).split("::");
  const isOccurrence = Boolean(suffix);
  const occurrence = suffix || null;
  const series = {
    userId,
    accountId: String(evt.account_id),
    accountEmail: account.email,
    calendarId: String(evt.calendar_id),
    uid: uidBase,
    href,
  };

  if (scope === "FOLLOWING" && isOccurrence && occurrence && (action === "delete" || (!action && patch))) {
    const got = await getEvent(href, account.email, password);
    const foreign = foreignOrganizer(got.ics, account.email);
    if (foreign) {
      return {
        status: 400,
        body: {
          error: `Only the organizer (${foreign}) can change this and following events — change just this one, or all of them.`,
        },
      };
    }
    const newUid = `nuvo-${crypto.randomUUID()}`;
    let split = splitSeries(got.ics, occurrence, { newUid });
    if (split && seriesCount(got.ics) != null) {
      const countBefore = countRuleOccurrencesBefore(got.ics, Date.parse(split.occurrenceISO));
      split = splitSeries(got.ics, occurrence, { newUid, countBefore });
    }
    if (split) {
      if (action === "delete") {
        const headEtag = await putEvent(href, split.head, account.email, password, got.etag);
        await materializeIcloudResource(sql, { ...series, etag: headEtag }, split.head);
        await logSync(sql, "icloud", "event-delete-following", "ok", undefined, userId);
        return { status: 200, body: { ok: true } };
      }
      const p = patch as EventPatch;
      const tail = editSeries(split.tail, p, { start_at: String(evt.start_at), end_at: String(evt.end_at) }, timeZone);
      const newHref = `${String(evt.calendar_id).replace(/\/$/, "")}/${newUid}.ics`;
      const tailEtag = await putEvent(newHref, tail, account.email, password);
      let headEtag: string | null;
      try {
        headEtag = await putEvent(href, split.head, account.email, password, got.etag);
      } catch (e) {
        await deleteEvent(newHref, account.email, password).catch(() => {});
        throw e;
      }
      const startDelta = p.start_at ? new Date(p.start_at).getTime() - new Date(String(evt.start_at)).getTime() : 0;
      const event = await materializeIcloudResource(
        sql,
        { ...series, uid: newUid, href: newHref, etag: tailEtag },
        tail,
        { rowId: eventId, anchorMs: Date.parse(split.occurrenceISO) + startDelta },
      );
      await materializeIcloudResource(sql, { ...series, etag: headEtag }, split.head);
      await logSync(sql, "icloud", "event-writeback-following", "ok", undefined, userId);
      return { status: 200, body: { ok: true, event } };
    }
    scope = "ALL";
  }

  if (action === "delete") {
    if (isOccurrence && scope !== "ALL" && occurrence) {
      const got = await getEvent(href, account.email, password);
      const next = addExdate(got.ics, occurrence);
      await putEvent(href, next, account.email, password, got.etag);
      await deleteOwnedEventsByIds(store, [eventId]);
    } else {
      const status = await deleteEvent(href, account.email, password);
      if (status >= 400 && status !== 404 && status !== 410) {
        throw new Error(`delete failed: HTTP ${status}`);
      }
      if (scope === "ALL") {
        await deleteOwnedSeries(store, String(evt.account_id), String(evt.calendar_id), uidBase);
      } else {
        await deleteOwnedEventsByIds(store, [eventId]);
      }
    }
    await logSync(sql, "icloud", "event-delete", "ok", undefined, userId);
    return { status: 200, body: { ok: true } };
  }

  if (action === "move") {
    const dest = (typeof body.calendarId === "string" ? body.calendarId : "").trim();
    if (!dest) return { status: 400, body: { error: "calendarId required" } };
    if (dest.replace(/\/$/, "") === String(evt.calendar_id).replace(/\/$/, "")) {
      return { status: 200, body: { ok: true } };
    }
    const got = await getEvent(href, account.email, password);
    const newHref = `${dest.replace(/\/$/, "")}/${uidBase}.ics`;
    const newEtag = await putEvent(newHref, got.ics, account.email, password);
    const status = await deleteEvent(href, account.email, password);
    if (status >= 400 && status !== 404 && status !== 410) {
      await deleteEvent(newHref, account.email, password).catch(() => {});
      throw new Error(`move failed on delete: HTTP ${status}`);
    }
    await sql`
      UPDATE external_events
      SET calendar_id = ${dest}
      WHERE account_id = ${String(evt.account_id)}
        AND user_id = ${userId}
        AND (provider_event_id = ${uidBase} OR provider_event_id LIKE ${`${uidBase}::%`})
    `;
    await sql`
      UPDATE external_events
      SET raw = ${JSON.stringify({ ...raw, caldav_href: newHref, caldav_etag: newEtag })}::jsonb
      WHERE id = ${eventId} AND user_id = ${userId}
    `;
    await logSync(sql, "icloud", "event-move", "ok", undefined, userId);
    return { status: 200, body: { ok: true } };
  }

  if (action === "rsvp") {
    const partstat = partstatFor(String(body.responseStatus ?? ""));
    if (!partstat) return { status: 400, body: { error: "invalid responseStatus" } };
    const got = await getEvent(href, account.email, password);
    if (setPartstat(got.ics, account.email, partstat) === got.ics) {
      return { status: 400, body: { error: "You're not listed as a guest on this event" } };
    }
    const thisOccurrence = isOccurrence && scope !== "ALL" && occurrence;
    const next = thisOccurrence
      ? setPartstat(got.ics, account.email, partstat, occurrence)
      : setPartstat(got.ics, account.email, partstat);
    await putEvent(href, next, account.email, password, got.etag);
    const selfRsvp = String(body.responseStatus);
    if (scope === "ALL") {
      await sql`
        UPDATE external_events SET self_rsvp = ${selfRsvp}
        WHERE account_id = ${String(evt.account_id)}
          AND user_id = ${userId}
          AND calendar_id = ${String(evt.calendar_id)}
          AND (provider_event_id = ${uidBase} OR provider_event_id LIKE ${`${uidBase}::%`})
      `;
    } else {
      await sql`
        UPDATE external_events SET self_rsvp = ${selfRsvp}
        WHERE id = ${eventId} AND user_id = ${userId}
      `;
    }
    await logSync(sql, "icloud", "event-rsvp", "ok", undefined, userId);
    return { status: 200, body: { ok: true } };
  }

  if (action === "series_rule") {
    const got = await getEvent(href, account.email, password);
    const master = (got.ics.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? []).find(
      (ve) => !/\bRECURRENCE-ID\b/i.test(ve),
    );
    const recurrence = master ? (master.match(/^RRULE:.*$/gim) ?? []) : [];
    return { status: 200, body: { ok: true, recurrence: recurrence.length ? recurrence : null } };
  }

  const p = patch as EventPatch;
  const got = await getEvent(href, account.email, password);

  if (p.recurrence !== undefined) {
    const next = editSeries(got.ics, { recurrence: p.recurrence }, { start_at: String(evt.start_at), end_at: String(evt.end_at) }, timeZone);
    const newEtag = await putEvent(href, next, account.email, password, got.etag);
    const event = await materializeIcloudResource(sql, { ...series, etag: newEtag }, next, {
      rowId: eventId,
      anchorMs: new Date(String(evt.start_at)).getTime(),
    });
    await logSync(sql, "icloud", "event-recurrence", "ok", undefined, userId);
    return { status: 200, body: { ok: true, event } };
  }

  let next: string;
  if (isOccurrence && scope === "ALL") {
    next = editSeries(got.ics, p, { start_at: String(evt.start_at), end_at: String(evt.end_at) }, timeZone);
  } else if (isOccurrence && occurrence) {
    next = upsertOverride(got.ics, occurrence, {
      title: p.title,
      startISO: p.start_at,
      endISO: p.end_at,
      allDay: p.all_day,
      location: p.location,
      description: p.description,
    });
  } else {
    next = patchMaster(got.ics, {
      title: p.title,
      startISO: p.start_at,
      endISO: p.end_at,
      allDay: p.all_day,
      location: p.location,
      description: p.description,
      timeZone,
    });
  }

  const newEtag = await putEvent(href, next, account.email, password, got.etag);

  if (scope !== "ALL") {
    const rowPatch: Record<string, unknown> = {};
    if (p.title !== undefined) rowPatch.title = p.title;
    if (p.start_at !== undefined) rowPatch.start_at = new Date(p.start_at).toISOString();
    if (p.end_at !== undefined) rowPatch.end_at = new Date(p.end_at).toISOString();
    if (p.all_day !== undefined) rowPatch.all_day = p.all_day;
    if (p.location !== undefined) rowPatch.location = p.location;
    if (Object.keys(rowPatch).length) {
      await rewriteOwnedRow(sql, userId, eventId, rowPatch, parseRowAt(body.rowAt));
    }
  } else {
    const startDelta = p.start_at ? new Date(p.start_at).getTime() - new Date(String(evt.start_at)).getTime() : 0;
    const event = await materializeIcloudResource(sql, { ...series, etag: newEtag }, next, {
      rowId: eventId,
      anchorMs: new Date(String(evt.start_at)).getTime() + startDelta,
    });
    await logSync(sql, "icloud", "event-writeback", "ok", undefined, userId);
    return { status: 200, body: { ok: true, event } };
  }

  await logSync(sql, "icloud", "event-writeback", "ok", undefined, userId);
  return { status: 200, body: { ok: true } };
}
