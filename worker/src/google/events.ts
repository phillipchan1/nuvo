import type { Env } from "../env.ts";
import type { Sql } from "../db.ts";
import { jsonParam } from "../db.ts";
import { redactSecrets } from "../lib/redact.ts";
import {
  googleStartEnd,
  masterToAllDay,
  masterToTimed,
  shiftGoogleDateResource,
} from "../../../supabase/functions/_shared/googleDateTime.ts";
import { hasConference, joinUrl, meetCreateRequest, shouldAddMeet } from "../../../supabase/functions/_shared/conferencing.ts";
import { parseRowAt } from "../../../supabase/functions/_shared/eventWriteback.ts";
import { planGoogleSplit } from "../../../supabase/functions/_shared/googleSplit.ts";
import { isUsableTimeZone, toIcalLocal } from "../../../supabase/functions/_shared/icalTz.ts";
import { rruleCount, shiftRRuleDays } from "../../../supabase/functions/_shared/recurrence.ts";
import { syncWindow } from "../../../supabase/functions/_shared/syncWindow.ts";
import type { EventRow } from "../lib/eventHash.ts";
import {
  defaultCalendarAccountId,
  getOwnedExternalEvent,
  getOwnedGoogleAccount,
  listOwnedGoogleAccounts,
  logSync,
  makeCalendarStore,
  meetPreference,
} from "./owned.ts";
import { rewriteMirrorRow, writeSeriesRows } from "./seriesRows.ts";
import { fetchGoogleSeriesInstances, runGoogleSync } from "./sync.ts";
import { gFetch, isGoogleSeriesMaster, mapGoogleEvent } from "./tokens.ts";
import type { GoogleAccount } from "./types.ts";

function seriesMasterId(evt: {
  recurring_event_id?: string | null;
  provider_event_id: string;
  raw?: unknown;
}): string | undefined {
  if (evt.recurring_event_id) return evt.recurring_event_id;
  const raw = (evt.raw ?? {}) as Record<string, unknown>;
  if (typeof raw.recurringEventId === "string" && raw.recurringEventId) return raw.recurringEventId;
  const m = String(evt.provider_event_id).match(/^(.+)_\d{8}T\d{6}Z?$/);
  return m?.[1];
}

function googleTargetId(
  evt: { recurring_event_id?: string | null; provider_event_id: string; raw?: unknown },
  scope: string,
): string {
  const master = seriesMasterId(evt);
  return scope === "ALL" && master ? master : evt.provider_event_id;
}

async function kickGoogleSync(
  sql: Sql,
  env: Env,
  account: GoogleAccount,
  calendarId: string,
  reqUrl?: string,
) {
  await runGoogleSync(sql, env, {
    mode: "incremental",
    accountId: account.id,
    calendarId,
    userId: account.user_id,
    reqUrl,
  }).catch(() => undefined);
}

async function materializeGoogleResource(
  sql: Sql,
  env: Env,
  account: GoogleAccount,
  calendarId: string,
  resource: Record<string, unknown>,
  keep?: { rowId?: string; anchorMs: number } | null,
): Promise<Record<string, unknown> | null> {
  const masterId = String(resource?.id ?? "");
  if (!masterId) return null;
  let rows: EventRow[];
  if (isGoogleSeriesMaster(resource)) {
    const { start, end } = syncWindow();
    rows = await fetchGoogleSeriesInstances(
      sql,
      env,
      account,
      calendarId,
      masterId,
      start.toISOString(),
      end.toISOString(),
    );
  } else {
    const row = mapGoogleEvent(account, calendarId, resource);
    rows = row ? [row] : [];
  }
  return writeSeriesRows(
    sql,
    { accountId: account.id, userId: account.user_id, calendarId, masterId },
    rows,
    keep,
  );
}

async function shiftLocalSeries(
  sql: Sql,
  userId: string,
  evt: { account_id: string; calendar_id: string; start_at: string; end_at: string },
  recurringEventId: string,
  patch: { start_at?: string; end_at?: string; title?: string; location?: string | null; all_day?: boolean },
) {
  const startDelta = patch.start_at ? new Date(patch.start_at).getTime() - new Date(evt.start_at).getTime() : 0;
  const endDelta = patch.end_at ? new Date(patch.end_at).getTime() - new Date(evt.end_at).getTime() : 0;
  if (Number.isNaN(startDelta) || Number.isNaN(endDelta)) return;
  const rows = await sql`
    SELECT id, start_at, end_at
    FROM external_events
    WHERE account_id = ${evt.account_id}
      AND user_id = ${userId}
      AND calendar_id = ${evt.calendar_id}
      AND recurring_event_id = ${recurringEventId}
  `;
  for (const row of rows as unknown as { id: string; start_at: string; end_at: string }[]) {
    const startAt = patch.start_at
      ? new Date(new Date(row.start_at).getTime() + startDelta).toISOString()
      : row.start_at;
    const endAt = patch.end_at
      ? new Date(new Date(row.end_at).getTime() + endDelta).toISOString()
      : row.end_at;
    await sql`
      UPDATE external_events SET
        start_at = ${startAt},
        end_at = ${endAt},
        title = COALESCE(${patch.title ?? null}, title),
        location = CASE WHEN ${patch.location !== undefined ? 1 : 0} = 1 THEN ${patch.location ?? null} ELSE location END,
        all_day = COALESCE(${patch.all_day ?? null}, all_day)
      WHERE id = ${row.id}
        AND user_id = ${userId}
    `;
  }
}

async function countGoogleInstancesBefore(
  sql: Sql,
  env: Env,
  account: GoogleAccount,
  calendarId: string,
  masterId: string,
  beforeISO: string,
): Promise<number> {
  let n = 0;
  let pageToken: string | null = null;
  do {
    const params = new URLSearchParams({ timeMax: beforeISO, showDeleted: "true", maxResults: "2500" });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await gFetch(
      sql,
      env,
      account,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(masterId)}/instances?${params}`,
    );
    if (!res.ok) throw new Error(`instances ${masterId}: ${res.status}`);
    const body = (await res.json()) as {
      items?: Array<{ originalStartTime?: { dateTime?: string; date?: string } }>;
      nextPageToken?: string;
    };
    for (const inst of body.items ?? []) {
      const orig = inst.originalStartTime?.dateTime ?? inst.originalStartTime?.date;
      if (orig && Date.parse(orig.length === 10 ? `${orig}T00:00:00Z` : orig) < Date.parse(beforeISO)) n++;
    }
    pageToken = body.nextPageToken ?? null;
  } while (pageToken);
  return n;
}

async function upsertMapped(
  sql: Sql,
  userId: string,
  row: EventRow,
): Promise<Record<string, unknown> | null> {
  const inserted = await sql`
    INSERT INTO external_events (
      user_id, account_id, provider_event_id, calendar_id, title, start_at, end_at,
      all_day, location, busy, raw, last_synced_at, recurring_event_id
    ) VALUES (
      ${userId}, ${row.account_id}, ${row.provider_event_id}, ${row.calendar_id},
      ${row.title}, ${row.start_at}, ${row.end_at}, ${row.all_day}, ${row.location},
      ${row.busy}, ${jsonParam(sql, row.raw)}, ${row.last_synced_at}, ${row.recurring_event_id ?? null}
    )
    ON CONFLICT (account_id, calendar_id, provider_event_id) DO UPDATE SET
      title = EXCLUDED.title,
      start_at = EXCLUDED.start_at,
      end_at = EXCLUDED.end_at,
      all_day = EXCLUDED.all_day,
      location = EXCLUDED.location,
      busy = EXCLUDED.busy,
      raw = EXCLUDED.raw,
      last_synced_at = EXCLUDED.last_synced_at,
      recurring_event_id = EXCLUDED.recurring_event_id
    WHERE external_events.user_id = ${userId}
    RETURNING id, account_id, provider_event_id, calendar_id, title, start_at, end_at, all_day, location, busy
  `;
  return (inserted[0] as Record<string, unknown> | undefined) ?? null;
}

export async function handleGoogleEvents(
  sql: Sql,
  env: Env,
  userId: string,
  body: Record<string, unknown>,
  reqUrl?: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const action = body.action as string | undefined;
  const patch = (body.patch ?? {}) as Record<string, unknown>;
  let scope = (body.scope as string | undefined) ?? "THIS";
  const timeZone = isUsableTimeZone(body.timeZone as string) ? (body.timeZone as string) : null;
  const store = makeCalendarStore(sql, userId);

  if (action === "create") {
    const title = ((body.title as string) ?? "").trim() || "(no title)";
    const start_at = body.start_at as string;
    const end_at = body.end_at as string;
    const all_day = Boolean(body.all_day);
    const recurrence = Array.isArray(body.recurrence) ? (body.recurrence as string[]) : undefined;
    if (!start_at || !end_at) return { status: 400, data: { error: "start_at and end_at required" } };

    const requestedAccountId = typeof body.accountId === "string" ? body.accountId : undefined;
    let account = requestedAccountId
      ? await getOwnedGoogleAccount(store, requestedAccountId)
      : null;
    if (!account && !requestedAccountId) {
      const def = await defaultCalendarAccountId(store);
      if (def) account = await getOwnedGoogleAccount(store, def);
      account ??= (await listOwnedGoogleAccounts(store))[0] ?? null;
    }
    if (!account) {
      return {
        status: requestedAccountId ? 404 : 400,
        data: { error: requestedAccountId ? "not found" : "no google account connected" },
      };
    }

    const attendees = Array.isArray(body.attendees) ? (body.attendees as string[]) : [];
    const targetCal = ((body.calendarId as string | undefined) ?? "").trim();
    const location = (body.location as string | undefined) ?? undefined;
    const description = (body.description as string | undefined) ?? undefined;
    const notifyGuests = body.notifyGuests !== false;
    let addMeet = typeof body.addMeet === "boolean" ? body.addMeet : undefined;
    if (addMeet === undefined) {
      addMeet = shouldAddMeet(await meetPreference(store), attendees.length);
    }

    const { start, end } = googleStartEnd(start_at, end_at, all_day);
    if (!all_day && timeZone) {
      start.timeZone = timeZone;
      end.timeZone = timeZone;
    }

    const res = await gFetch(
      sql,
      env,
      account,
      `/calendars/${encodeURIComponent(targetCal || "primary")}/events?sendUpdates=${
        notifyGuests ? "all" : "none"
      }${addMeet && !all_day ? "&conferenceDataVersion=1" : ""}`,
      {
        method: "POST",
        body: JSON.stringify({
          summary: title,
          start,
          end,
          ...(location ? { location } : {}),
          ...(description ? { description } : {}),
          ...(recurrence?.length ? { recurrence } : {}),
          ...(attendees.length ? { attendees: attendees.map((email) => ({ email })) } : {}),
          ...(addMeet ? meetCreateRequest(crypto.randomUUID()) : {}),
        }),
      },
    );
    if (!res.ok) throw new Error(`create event failed: ${res.status}`);
    let created = (await res.json()) as Record<string, unknown>;

    if (addMeet && !hasConference(created)) {
      try {
        const calForRead = targetCal || ((created.organizer as { email?: string } | undefined)?.email) || account.email;
        for (const waitMs of [700, 1500]) {
          await new Promise((r) => setTimeout(r, waitMs));
          const again = await gFetch(
            sql,
            env,
            account,
            `/calendars/${encodeURIComponent(calForRead)}/events/${encodeURIComponent(String(created.id))}?conferenceDataVersion=1`,
          );
          if (!again.ok) break;
          const fresh = (await again.json()) as Record<string, unknown>;
          if (hasConference(fresh)) {
            created = fresh;
            break;
          }
          const status = (fresh.conferenceData as { createRequest?: { status?: { statusCode?: string } } } | undefined)
            ?.createRequest?.status?.statusCode;
          if (status === "failure") break;
        }
      } catch (e) {
        await logSync(sql, "google", "event-create-meet-poll", "error", redactSecrets(e instanceof Error ? e.message : String(e)), userId);
      }
    }

    const calendarId = targetCal || ((created.organizer as { email?: string } | undefined)?.email) || account.email;
    if (isGoogleSeriesMaster(created)) {
      let event = null;
      try {
        event = await materializeGoogleResource(sql, env, account, calendarId, created, {
          anchorMs: new Date(start_at).getTime(),
        });
      } catch (e) {
        await logSync(sql, "google", "event-create-instances", "error", redactSecrets(e instanceof Error ? e.message : String(e)), userId);
      }
      await logSync(sql, "google", "event-create", "ok", undefined, userId);
      return { status: 200, data: { ok: true, event, meetUrl: joinUrl(created) } };
    }
    const row = mapGoogleEvent(account, calendarId, created);
    let event = null;
    if (row) {
      try {
        event = await upsertMapped(sql, userId, row);
      } catch (e) {
        await logSync(sql, "google", "event-create-upsert", "error", redactSecrets(e instanceof Error ? e.message : String(e)), userId);
      }
    }
    await logSync(sql, "google", "event-create", "ok", undefined, userId);
    return { status: 200, data: { ok: true, event, meetUrl: joinUrl(created) } };
  }

  const eventId = body.eventId as string | undefined;
  if (!eventId) return { status: 400, data: { error: "eventId required" } };
  if (!action && !body.patch) return { status: 400, data: { error: "patch or action required" } };

  const found = await getOwnedExternalEvent(store, eventId);
  if (!found) return { status: 404, data: { error: "event not found" } };
  const account = found.account;
  const accountRow = await sql`
    SELECT provider FROM calendar_accounts
    WHERE id = ${account.id}
      AND user_id = ${userId}
    LIMIT 1
  `;
  if ((accountRow[0] as { provider?: string } | undefined)?.provider !== "google") {
    return { status: 400, data: { error: "event is read-only" } };
  }

  const evt = {
    id: String(found.id),
    account_id: String(found.account_id),
    calendar_id: String(found.calendar_id),
    provider_event_id: String(found.provider_event_id),
    start_at: new Date(found.start_at as string | Date).toISOString(),
    end_at: new Date(found.end_at as string | Date).toISOString(),
    all_day: Boolean(found.all_day),
    recurring_event_id: (found.recurring_event_id as string | null) ?? null,
    raw: found.raw,
  };

  if (action === "invite") {
    const newEmails = Array.isArray(body.attendees) ? (body.attendees as string[]) : [];
    if (!newEmails.length) return { status: 400, data: { error: "attendees required" } };
    const targetId = googleTargetId(evt, scope);
    const getRes = await gFetch(
      sql,
      env,
      account,
      `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(targetId)}`,
    );
    if (!getRes.ok) throw new Error(`fetch event: ${getRes.status}`);
    const googleEvent = (await getRes.json()) as { attendees?: { email?: string }[] };
    const existingEmails = new Set((googleEvent.attendees ?? []).map((a) => a.email as string));
    const merged = [
      ...(googleEvent.attendees ?? []),
      ...newEmails.filter((e) => !existingEmails.has(e)).map((email) => ({ email })),
    ];
    const notifyGuests = body.notifyGuests !== false;
    const patchRes = await gFetch(
      sql,
      env,
      account,
      `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(targetId)}?sendUpdates=${
        notifyGuests ? "all" : "none"
      }`,
      { method: "PATCH", body: JSON.stringify({ attendees: merged }) },
    );
    if (!patchRes.ok) throw new Error(`invite: ${patchRes.status}`);
    const refreshed = await patchRes.json().catch(() => null);
    if (refreshed) {
      await sql`
        UPDATE external_events SET raw = ${jsonParam(sql, refreshed)}
        WHERE id = ${eventId} AND user_id = ${userId}
      `;
    }
    if (scope === "ALL") await kickGoogleSync(sql, env, account, evt.calendar_id, reqUrl);
    await logSync(sql, "google", "event-invite", "ok", undefined, userId);
    return { status: 200, data: { ok: true } };
  }

  if (action === "add_meet") {
    const targetId = googleTargetId(evt, scope);
    const getRes = await gFetch(
      sql,
      env,
      account,
      `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(targetId)}?conferenceDataVersion=1`,
    );
    if (!getRes.ok) throw new Error(`fetch event: ${getRes.status}`);
    const current = (await getRes.json()) as Record<string, unknown>;
    if (hasConference(current)) {
      await sql`
        UPDATE external_events SET raw = ${jsonParam(sql, current)}
        WHERE id = ${eventId} AND user_id = ${userId}
      `;
      return { status: 200, data: { ok: true, meetUrl: joinUrl(current), alreadyHad: true } };
    }
    const guests = ((current.attendees as { self?: boolean }[]) ?? []).filter((a) => a?.self !== true);
    const notifyGuests = typeof body.notifyGuests === "boolean" ? body.notifyGuests : guests.length > 0;
    const patchRes = await gFetch(
      sql,
      env,
      account,
      `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(targetId)}?conferenceDataVersion=1&sendUpdates=${
        notifyGuests ? "all" : "none"
      }`,
      { method: "PATCH", body: JSON.stringify(meetCreateRequest(crypto.randomUUID())) },
    );
    if (!patchRes.ok) throw new Error(`add meet: ${patchRes.status}`);
    let updated = (await patchRes.json()) as Record<string, unknown>;
    try {
      for (const waitMs of [700, 1500]) {
        if (hasConference(updated)) break;
        await new Promise((r) => setTimeout(r, waitMs));
        const again = await gFetch(
          sql,
          env,
          account,
          `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(targetId)}?conferenceDataVersion=1`,
        );
        if (!again.ok) break;
        updated = (await again.json()) as Record<string, unknown>;
      }
    } catch (e) {
      await logSync(sql, "google", "event-add-meet-poll", "error", redactSecrets(e instanceof Error ? e.message : String(e)), userId);
    }
    await sql`
      UPDATE external_events SET raw = ${jsonParam(sql, updated)}
      WHERE id = ${eventId} AND user_id = ${userId}
    `;
    if (scope === "ALL") await kickGoogleSync(sql, env, account, evt.calendar_id, reqUrl);
    await logSync(sql, "google", "event-add-meet", "ok", undefined, userId);
    const meetUrl = joinUrl(updated);
    if (!meetUrl) return { status: 200, data: { ok: true, meetUrl: null, pending: true } };
    return { status: 200, data: { ok: true, meetUrl } };
  }

  if (action === "rsvp") {
    const responseStatus = body.responseStatus as string;
    const sendUpdates = body.sendNotifications !== false ? "all" : "none";
    if (!["accepted", "declined", "tentative"].includes(responseStatus)) {
      return { status: 400, data: { error: "invalid responseStatus" } };
    }
    const targetId = googleTargetId(evt, scope);
    let googleEvent: Record<string, unknown> | null = null;
    let rsvpCalId = evt.calendar_id;
    for (const tryId of [evt.calendar_id, "primary"]) {
      const getRes = await gFetch(
        sql,
        env,
        account,
        `/calendars/${encodeURIComponent(tryId)}/events/${encodeURIComponent(targetId)}`,
      );
      if (getRes.ok) {
        googleEvent = (await getRes.json()) as Record<string, unknown>;
        rsvpCalId = tryId;
        break;
      }
    }
    if (!googleEvent) throw new Error("event not found in Google Calendar");
    const attendees = (googleEvent.attendees as { self?: boolean; email?: string; responseStatus?: string }[]) ?? [];
    const hasSelf = attendees.some((a) => a.self);
    const updated = hasSelf
      ? attendees.map((a) => (a.self ? { ...a, responseStatus } : a))
      : [...attendees, { email: account.email, responseStatus, self: true }];
    const patchRes = await gFetch(
      sql,
      env,
      account,
      `/calendars/${encodeURIComponent(rsvpCalId)}/events/${encodeURIComponent(targetId)}?sendUpdates=${sendUpdates}`,
      { method: "PATCH", body: JSON.stringify({ attendees: updated }) },
    );
    if (!patchRes.ok) throw new Error(`rsvp failed (${patchRes.status})`);
    const refreshed = await patchRes.json().catch(() => null);
    const master = seriesMasterId(evt);
    if (scope === "ALL" && master) {
      await sql`
        UPDATE external_events SET self_rsvp = ${responseStatus}
        WHERE account_id = ${evt.account_id}
          AND user_id = ${userId}
          AND calendar_id = ${evt.calendar_id}
          AND (id = ${eventId} OR recurring_event_id = ${master})
      `;
      if (refreshed) {
        await sql`
          UPDATE external_events SET raw = ${jsonParam(sql, refreshed)}
          WHERE id = ${eventId} AND user_id = ${userId}
        `;
      }
      await kickGoogleSync(sql, env, account, evt.calendar_id, reqUrl);
    } else {
      await sql`
        UPDATE external_events SET
          self_rsvp = ${responseStatus},
          raw = COALESCE(${refreshed ? jsonParam(sql, refreshed) : null}, raw)
        WHERE id = ${eventId} AND user_id = ${userId}
      `;
    }
    await logSync(sql, "google", "event-rsvp", "ok", undefined, userId);
    return { status: 200, data: { ok: true } };
  }

  const followingMaster = scope === "FOLLOWING" ? seriesMasterId(evt) : undefined;
  if (followingMaster && (action === "delete" || (!action && body.patch))) {
    const cal = encodeURIComponent(evt.calendar_id);
    const masterRes = await gFetch(
      sql,
      env,
      account,
      `/calendars/${cal}/events/${encodeURIComponent(followingMaster)}`,
    );
    if (!masterRes.ok) throw new Error(`fetch master: ${masterRes.status}`);
    const master = (await masterRes.json()) as Record<string, unknown> & {
      organizer?: { self?: boolean; displayName?: string; email?: string };
      recurrence?: string[];
    };
    if (master.organizer && master.organizer.self !== true) {
      const who = master.organizer.displayName || master.organizer.email || "the organizer";
      return {
        status: 400,
        data: { error: `Only ${who} can change this and following events — change just this one, or all of them.` },
      };
    }
    const instance = (evt.raw ?? {}) as Record<string, unknown>;
    const current = { start_at: evt.start_at, end_at: evt.end_at };
    const probe = planGoogleSplit(master, instance, current, null, { timeZone });
    if (probe) {
      const count = rruleCount(master.recurrence ?? []);
      const remaining = count != null
        ? count - await countGoogleInstancesBefore(sql, env, account, evt.calendar_id, followingMaster, probe.originalStartISO)
        : null;
      const plan = planGoogleSplit(master, instance, current, action === "delete" ? null : patch, { timeZone, remaining });
      if (!plan) throw new Error("couldn't split the series");
      let created: Record<string, unknown> | null = null;
      if (plan.tail) {
        const createRes = await gFetch(
          sql,
          env,
          account,
          `/calendars/${cal}/events?sendUpdates=none${plan.tail.conferenceData ? "&conferenceDataVersion=1" : ""}`,
          { method: "POST", body: JSON.stringify(plan.tail) },
        );
        if (!createRes.ok) throw new Error(`create following: ${createRes.status}`);
        created = (await createRes.json()) as Record<string, unknown>;
      }
      const headRes = await gFetch(sql, env, account, `/calendars/${cal}/events/${encodeURIComponent(followingMaster)}`, {
        method: "PATCH",
        body: JSON.stringify({ recurrence: plan.headRecurrence }),
      });
      if (!headRes.ok) {
        if (created?.id) {
          await gFetch(
            sql,
            env,
            account,
            `/calendars/${cal}/events/${encodeURIComponent(String(created.id))}?sendUpdates=none`,
            { method: "DELETE" },
          ).catch(() => undefined);
        }
        throw new Error(`end series: ${headRes.status}`);
      }
      const head = (await headRes.json().catch(() => null)) as Record<string, unknown> | null;
      let event = null;
      if (created) {
        const startDelta = patch.start_at ? Date.parse(String(patch.start_at)) - Date.parse(evt.start_at) : 0;
        event = await materializeGoogleResource(sql, env, account, evt.calendar_id, created, {
          rowId: eventId,
          anchorMs: Date.parse(plan.originalStartISO) + startDelta,
        });
      }
      if (head) await materializeGoogleResource(sql, env, account, evt.calendar_id, head);
      await kickGoogleSync(sql, env, account, evt.calendar_id, reqUrl);
      await logSync(
        sql,
        "google",
        action === "delete" ? "event-delete-following" : "event-writeback-following",
        "ok",
        undefined,
        userId,
      );
      return { status: 200, data: { ok: true, event } };
    }
    scope = "ALL";
  }

  if (action === "delete") {
    const rawEvent = (evt.raw ?? {}) as Record<string, unknown>;
    const guests = ((rawEvent.attendees as { self?: boolean }[]) ?? []).filter((a) => a?.self !== true);
    const isOrganizer = (rawEvent.organizer as { self?: boolean } | undefined)?.self === true;
    const notifyByDefault = guests.length > 0 && isOrganizer;
    const notifyGuests = typeof body.notifyGuests === "boolean"
      ? body.notifyGuests
      : body.sendUpdates === "all" || (body.sendUpdates === undefined && notifyByDefault);
    const sendUpdates = notifyGuests ? "all" : "none";
    const recurringEventId = seriesMasterId(evt);
    const targetId = scope === "ALL" && recurringEventId ? recurringEventId : evt.provider_event_id;
    const res = await gFetch(
      sql,
      env,
      account,
      `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(targetId)}?sendUpdates=${sendUpdates}`,
      { method: "DELETE" },
    );
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw new Error(`delete event failed: ${res.status}`);
    }
    if (scope === "ALL" && recurringEventId) {
      await sql`
        DELETE FROM external_events
        WHERE account_id = ${evt.account_id}
          AND user_id = ${userId}
          AND calendar_id = ${evt.calendar_id}
          AND (recurring_event_id = ${recurringEventId} OR provider_event_id = ${recurringEventId})
      `;
    } else {
      await sql`
        DELETE FROM external_events
        WHERE id = ${eventId} AND user_id = ${userId}
      `;
    }
    await logSync(sql, "google", "event-delete", "ok", undefined, userId);
    return { status: 200, data: { ok: true } };
  }

  if (action === "move") {
    const dest = ((body.calendarId as string) ?? "").trim();
    if (!dest) return { status: 400, data: { error: "calendarId required" } };
    if (dest === evt.calendar_id) return { status: 200, data: { ok: true } };
    const res = await gFetch(
      sql,
      env,
      account,
      `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(evt.provider_event_id)}/move?destination=${encodeURIComponent(dest)}&sendUpdates=none`,
      { method: "POST" },
    );
    if (!res.ok) throw new Error(`move event failed: ${res.status}`);
    await sql`
      UPDATE external_events SET calendar_id = ${dest}
      WHERE id = ${eventId} AND user_id = ${userId}
    `;
    await logSync(sql, "google", "event-move", "ok", undefined, userId);
    return { status: 200, data: { ok: true } };
  }

  if (action === "series_rule") {
    const rawEvent = (evt.raw ?? {}) as Record<string, unknown>;
    const stored = Array.isArray(rawEvent.recurrence) ? (rawEvent.recurrence as string[]) : null;
    if (stored?.length) return { status: 200, data: { ok: true, recurrence: stored } };
    const recurringEventId = rawEvent.recurringEventId as string | undefined;
    if (!recurringEventId) return { status: 200, data: { ok: true, recurrence: null } };
    const masterRes = await gFetch(
      sql,
      env,
      account,
      `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(recurringEventId)}`,
    );
    if (!masterRes.ok) throw new Error(`fetch master: ${masterRes.status}`);
    const master = (await masterRes.json()) as { recurrence?: string[] };
    return { status: 200, data: { ok: true, recurrence: Array.isArray(master.recurrence) ? master.recurrence : null } };
  }

  if (patch.recurrence !== undefined) {
    const targetId = seriesMasterId(evt) ?? evt.provider_event_id;
    const nextRecurrence = patch.recurrence === null || (Array.isArray(patch.recurrence) && patch.recurrence.length === 0)
      ? []
      : (patch.recurrence as string[]);
    const gPatch: Record<string, unknown> = { recurrence: nextRecurrence };
    if (nextRecurrence.length) {
      const masterRes = await gFetch(
        sql,
        env,
        account,
        `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(targetId)}`,
      );
      if (!masterRes.ok) throw new Error(`fetch master: ${masterRes.status}`);
      const master = (await masterRes.json()) as {
        start?: { dateTime?: string; timeZone?: string };
        end?: { dateTime?: string; timeZone?: string };
      };
      const zone = timeZone ?? "UTC";
      if (master.start?.dateTime && !master.start?.timeZone) {
        gPatch.start = { dateTime: master.start.dateTime, timeZone: zone };
      }
      if (master.end?.dateTime && !master.end?.timeZone) {
        gPatch.end = { dateTime: master.end.dateTime, timeZone: zone };
      }
    }
    const res = await gFetch(
      sql,
      env,
      account,
      `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(targetId)}`,
      { method: "PATCH", body: JSON.stringify(gPatch) },
    );
    if (!res.ok) throw new Error(`patch recurrence: ${res.status}`);
    const updated = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    let event = null;
    if (updated) {
      event = await materializeGoogleResource(sql, env, account, evt.calendar_id, updated, {
        rowId: eventId,
        anchorMs: new Date(evt.start_at).getTime(),
      });
    }
    await kickGoogleSync(sql, env, account, evt.calendar_id, reqUrl);
    await logSync(sql, "google", "event-recurrence", "ok", undefined, userId);
    return { status: 200, data: { ok: true, event } };
  }

  if (scope === "ALL") {
    const recurringEventId = seriesMasterId(evt);
    if (recurringEventId) {
      const masterRes = await gFetch(
        sql,
        env,
        account,
        `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(recurringEventId)}`,
      );
      if (!masterRes.ok) throw new Error(`fetch master: ${masterRes.status}`);
      const master = (await masterRes.json()) as Record<string, unknown> & {
        start?: { dateTime?: string; date?: string; timeZone?: string };
        end?: { dateTime?: string; date?: string; timeZone?: string };
        recurrence?: string[];
      };
      const gPatch: Record<string, unknown> = {};
      if (patch.all_day !== undefined) {
        const converted = patch.all_day
          ? masterToAllDay(master.start ?? {}, master.end ?? {})
          : masterToTimed(master.start ?? {});
        gPatch.start = converted.start;
        gPatch.end = converted.end;
      } else {
        if (patch.start_at) {
          const delta = new Date(patch.start_at as string).getTime() - new Date(evt.start_at).getTime();
          const next = shiftGoogleDateResource(master.start, delta);
          if (next) gPatch.start = next;
          const ruleZone = master.start?.timeZone ?? timeZone;
          if (Array.isArray(master.recurrence) && isUsableTimeZone(ruleZone)) {
            const day = (iso: string) =>
              Date.parse(`${toIcalLocal(iso, ruleZone).replace(/^(\d{4})(\d{2})(\d{2}).*$/, "$1-$2-$3")}T00:00:00Z`);
            const dayDelta = Math.round((day(patch.start_at as string) - day(evt.start_at)) / 86_400_000);
            if (dayDelta) gPatch.recurrence = shiftRRuleDays(master.recurrence, dayDelta);
          }
        }
        if (patch.end_at) {
          const delta = new Date(patch.end_at as string).getTime() - new Date(evt.end_at).getTime();
          const next = shiftGoogleDateResource(master.end, delta);
          if (next) gPatch.end = next;
        }
      }
      if (patch.title) gPatch.summary = patch.title;
      if (patch.location !== undefined) gPatch.location = patch.location ?? "";
      if (patch.description !== undefined) gPatch.description = patch.description ?? "";

      let after = master;
      if (Object.keys(gPatch).length) {
        const res = await gFetch(
          sql,
          env,
          account,
          `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(recurringEventId)}`,
          { method: "PATCH", body: JSON.stringify(gPatch) },
        );
        if (!res.ok) throw new Error(`patch master: ${res.status}`);
        after = ((await res.json().catch(() => null)) as typeof master | null) ?? master;
      }
      const startDelta = patch.start_at
        ? new Date(patch.start_at as string).getTime() - new Date(evt.start_at).getTime()
        : 0;
      const event = await materializeGoogleResource(sql, env, account, evt.calendar_id, after, {
        rowId: eventId,
        anchorMs: new Date(evt.start_at).getTime() + startDelta,
      }).catch(async (e) => {
        await logSync(sql, "google", "event-writeback-all-instances", "error", redactSecrets(e instanceof Error ? e.message : String(e)), userId);
        await shiftLocalSeries(sql, userId, evt, recurringEventId, patch);
        return null;
      });
      await kickGoogleSync(sql, env, account, evt.calendar_id, reqUrl);
      await logSync(sql, "google", "event-writeback-all", "ok", undefined, userId);
      return { status: 200, data: { ok: true, event } };
    }
  }

  const gPatch: Record<string, unknown> = {};
  if (patch.title) gPatch.summary = patch.title;
  const allDay = patch.all_day !== undefined ? Boolean(patch.all_day) : Boolean(evt.all_day);
  if (patch.start_at || patch.end_at || patch.all_day !== undefined) {
    const startISO = (patch.start_at as string | undefined) ?? evt.start_at;
    const endISO = (patch.end_at as string | undefined) ?? evt.end_at;
    Object.assign(gPatch, googleStartEnd(startISO, endISO, allDay));
  }
  if (patch.location !== undefined) gPatch.location = patch.location ?? "";
  if (patch.description !== undefined) gPatch.description = patch.description ?? "";

  const res = await gFetch(
    sql,
    env,
    account,
    `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(evt.provider_event_id)}`,
    { method: "PATCH", body: JSON.stringify(gPatch) },
  );
  if (!res.ok) throw new Error(`google patch failed: ${res.status}`);
  const updated = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (updated) {
    const mapped = mapGoogleEvent(account, evt.calendar_id, updated);
    const outcome = await rewriteMirrorRow(
      sql,
      eventId,
      userId,
      {
        raw: updated,
        ...(mapped ? { all_day: mapped.all_day, start_at: mapped.start_at, end_at: mapped.end_at } : {}),
        ...(patch.location !== undefined ? { location: (patch.location as string | null) ?? null } : {}),
      },
      parseRowAt(body.rowAt),
    );
    if (outcome === "failed") {
      await logSync(sql, "google", "event-writeback-row", "error", "mirror row rewrite failed", userId);
    }
  }
  await logSync(sql, "google", "event-writeback", "ok", undefined, userId);
  return { status: 200, data: { ok: true } };
}
