// Write-back for iCloud (Apple Calendar) events over CalDAV.
//
//   action=create               → PUT a new VEVENT to the target calendar
//   patch (no action)           → move / resize / retitle
//   action=delete               → remove the event (or one occurrence)
//
// scope="THIS" (default) edits/deletes a single occurrence of a recurring series;
// scope="FOLLOWING" splits the series there (icalwrite.splitSeries) and edits or
// ends the new half; scope="ALL" edits/deletes the whole series. An occurrence is named by its row's
// own RECURRENCE-ID suffix, written in the master's form (TZID wall clock, DATE
// or UTC) — see icalwrite.ts. `timeZone` (the client's IANA zone) anchors a
// series that has none yet, so BYDAY means the local weekday across DST.
//
// Every series-level write (create, a rule change, an ALL edit) re-materializes
// the series locally from the ICS it PUT and keeps the edited row's id
// (_shared/icloudExpand.ts) — the open sheet and the chat card stay valid.
import { admin, handleOptions, json, logSync, readSecret, requireActor } from "../_shared/admin.ts";
import {
  addExdate,
  buildEvent,
  foreignOrganizer,
  seriesCount,
  splitSeries,
  withoutOverrides,
  partstatFor,
  patchMaster,
  setPartstat,
  shiftMaster,
  upsertOverride,
} from "../_shared/icalwrite.ts";
import { deleteEvent, getEvent, putEvent } from "../_shared/caldav.ts";
import { icloudSeriesOrFilter } from "../_shared/icloudSeries.ts";
import { materializeIcloudResource } from "../_shared/icloudExpand.ts";
import { countRuleOccurrencesBefore } from "../_shared/ics.ts";
import { isUsableTimeZone } from "../_shared/icalTz.ts";
import { type MirrorRowTable, parseRowAt, rewriteMirrorRow } from "../_shared/eventWriteback.ts";

type EventPatch = {
  title?: string;
  start_at?: string;
  end_at?: string;
  all_day?: boolean;
  location?: string | null;
  description?: string | null;
  recurrence?: string[] | null;
};

/**
 * Apply an edit to a series as a whole: the ALL edit, and the edit to the new
 * half of a "this and following" split. `evt` is the occurrence the user
 * touched — its times give the delta every occurrence moves by.
 */
function editSeries(
  ics: string,
  p: EventPatch,
  evt: { start_at: string; end_at: string },
  timeZone: string | null,
): string {
  if (p.recurrence !== undefined) {
    // A new rule renames every occurrence; overrides keyed to the old ones
    // would orphan into duplicates.
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
    // Timed ↔ all-day is a type change on the master, not a millisecond shift.
    return patchMaster(ics, { title: p.title, allDay: p.all_day, location: p.location, description: p.description });
  }
  if (p.start_at || p.end_at) {
    // Shift the whole series by the instance's time delta (+ retitle).
    const startDelta = p.start_at ? new Date(p.start_at).getTime() - new Date(evt.start_at).getTime() : 0;
    const endDelta = p.end_at ? new Date(p.end_at).getTime() - new Date(evt.end_at).getTime() : startDelta;
    let next = shiftMaster(ics, startDelta, p.title, endDelta, timeZone);
    if (p.location !== undefined || p.description !== undefined) {
      next = patchMaster(next, { location: p.location, description: p.description });
    }
    return next;
  }
  // Title / place / notes only — don't invent a time shift.
  return patchMaster(ics, { title: p.title, location: p.location, description: p.description });
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const body = await req.json();
    const user = await requireActor(req, (body as { actingUserId?: unknown }).actingUserId);
    const { eventId, action, patch } = body;
    let scope = (body.scope as string | undefined) ?? "THIS";
    const timeZone = isUsableTimeZone(body.timeZone) ? (body.timeZone as string) : null;

    // ── Create a new event on an iCloud calendar ─────────────────────────
    if (action === "create") {
      const title = (body.title as string)?.trim() || "(no title)";
      const start_at = body.start_at as string;
      const end_at = body.end_at as string;
      const all_day = Boolean(body.all_day);
      const recurrence = Array.isArray(body.recurrence) ? (body.recurrence as string[]) : undefined;
      if (!start_at || !end_at) return json({ error: "start_at and end_at required" }, 400);

      const accountId = body.accountId as string | undefined;
      const { data: accounts } = await admin
        .from("calendar_accounts")
        .select("*")
        .eq("user_id", user.id)
        .eq("provider", "icloud");
      let account = (accounts ?? []).find((a) => !accountId || a.id === accountId);
      if (!account) return json({ error: "no iCloud account connected" }, 400);

      const password = await readSecret(account.refresh_token_secret_id);
      if (!password) return json({ error: "iCloud credential missing" }, 400);

      const { data: settings } = await admin
        .from("user_settings")
        .select("hidden_calendar_ids")
        .eq("user_id", user.id)
        .maybeSingle();
      const hidden = new Set<string>(
        Array.isArray(settings?.hidden_calendar_ids) ? settings.hidden_calendar_ids : [],
      );
      const namedCalendar = (body.calendarId as string | undefined)?.trim();
      // D-047: a hidden calendar is never chosen unnamed. calendars[0] used to
      // be Work — hidden — so a create "succeeded" onto a calendar the Schedule
      // does not show, and looked like a total failure.
      const visible = ((account.calendars ?? []) as { id?: string }[]).filter(
        (c) => typeof c.id === "string" && c.id && !hidden.has(c.id),
      );
      const calendarUrl =
        namedCalendar ||
        visible[0]?.id ||
        undefined;
      if (!calendarUrl) {
        return json(
          {
            error:
              "No visible Apple calendar to create on. Unhide a calendar you own in Settings → Calendars.",
          },
          400,
        );
      }

      const location = (body.location as string | undefined) ?? null;
      const description = (body.description as string | undefined) ?? null;
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

      // A series becomes every occurrence now, keyed the way sync will key
      // them — not one bare-UID row that the next poll sweeps out from under
      // the chat card that points at it.
      const materialized = recurrence?.length
        ? await materializeIcloudResource(
          {
            userId: user.id,
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
        await logSync("icloud", "event-create", "ok", undefined, user.id);
        return json({ ok: true, event: materialized });
      }

      const { data: event } = await admin
        .from("external_events")
        .upsert(
          {
            user_id: user.id,
            account_id: account.id,
            provider_event_id: uid,
            calendar_id: calendarUrl,
            title,
            start_at: new Date(start_at).toISOString(),
            end_at: new Date(end_at).toISOString(),
            all_day,
            location,
            busy: true,
            raw: { caldav_href: href, caldav_etag: etag },
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: "account_id,calendar_id,provider_event_id" },
        )
        .select("id, account_id, provider_event_id, calendar_id, title, start_at, end_at, all_day, location, busy")
        .single();

      await logSync("icloud", "event-create", "ok", undefined, user.id);
      return json({ ok: true, event });
    }

    if (!eventId) return json({ error: "eventId required" }, 400);
    if (!action && !patch) return json({ error: "patch or action required" }, 400);

    const { data: evt, error } = await admin
      .from("external_events")
      .select("*, calendar_accounts(*)")
      .eq("id", eventId)
      .eq("user_id", user.id)
      .single();
    if (error || !evt) {
      return json({ error: "This event changed on Apple Calendar since it was opened — close it and open it again." }, 404);
    }

    // deno-lint-ignore no-explicit-any
    const account = evt.calendar_accounts as any;
    if (account?.provider !== "icloud") return json({ error: "not an iCloud event" }, 400);

    const password = await readSecret(account.refresh_token_secret_id);
    if (!password) return json({ error: "iCloud credential missing" }, 400);

    const raw = (evt.raw ?? {}) as Record<string, unknown>;
    const href = raw.caldav_href as string | undefined;
    if (!href) return json({ error: "event has no CalDAV resource on file — resync and retry" }, 400);

    const [uidBase, suffix] = String(evt.provider_event_id).split("::");
    const isOccurrence = Boolean(suffix);
    // The occurrence's identity, verbatim from the expansion that made the row.
    const occurrence = suffix || null;
    const series = {
      userId: user.id,
      accountId: evt.account_id as string,
      accountEmail: account.email as string,
      calendarId: evt.calendar_id as string,
      uid: uidBase,
      href,
    };

    // ── This and following: split the series at this occurrence ─────────
    // The old resource ends just before it; a new one starts at it and takes
    // the edit (or, for a delete, simply isn't made). From the series' first
    // occurrence there is nothing before it to keep, so it IS "all".
    if (scope === "FOLLOWING" && isOccurrence && occurrence && (action === "delete" || (!action && patch))) {
      const { ics, etag } = await getEvent(href, account.email, password);
      const foreign = foreignOrganizer(ics, account.email);
      if (foreign) {
        return json({
          error: `Only the organizer (${foreign}) can change this and following events — change just this one, or all of them.`,
        }, 400);
      }
      const newUid = `nuvo-${crypto.randomUUID()}`;
      let split = splitSeries(ics, occurrence, { newUid });
      if (split && seriesCount(ics) != null) {
        const countBefore = countRuleOccurrencesBefore(ics, Date.parse(split.occurrenceISO));
        split = splitSeries(ics, occurrence, { newUid, countBefore });
      }
      if (split) {
        if (action === "delete") {
          const headEtag = await putEvent(href, split.head, account.email, password, etag);
          await materializeIcloudResource({ ...series, etag: headEtag }, split.head);
          await logSync("icloud", "event-delete-following", "ok", undefined, user.id);
          return json({ ok: true });
        }
        const p = patch as EventPatch;
        const tail = editSeries(split.tail, p, evt, timeZone);
        const newHref = `${String(evt.calendar_id).replace(/\/$/, "")}/${newUid}.ics`;
        // New half first: if ending the old half then fails, take the new one
        // back down rather than leave the following weeks on the calendar twice.
        const tailEtag = await putEvent(newHref, tail, account.email, password);
        let headEtag: string | null;
        try {
          headEtag = await putEvent(href, split.head, account.email, password, etag);
        } catch (e) {
          await deleteEvent(newHref, account.email, password).catch(() => {});
          throw e;
        }
        const startDelta = p.start_at ? new Date(p.start_at).getTime() - new Date(evt.start_at).getTime() : 0;
        // The open row moves to the new series first, so the old series'
        // sweep below doesn't take it.
        const event = await materializeIcloudResource(
          { ...series, uid: newUid, href: newHref, etag: tailEtag },
          tail,
          { rowId: eventId, anchorMs: Date.parse(split.occurrenceISO) + startDelta },
        );
        await materializeIcloudResource({ ...series, etag: headEtag }, split.head);
        await logSync("icloud", "event-writeback-following", "ok", undefined, user.id);
        return json({ ok: true, event });
      }
      scope = "ALL";
    }

    // ── Delete / cancel ──────────────────────────────────────────────────
    if (action === "delete") {
      if (isOccurrence && scope !== "ALL" && occurrence) {
        // Remove just this occurrence: EXDATE onto the master, then PUT back.
        const { ics, etag } = await getEvent(href, account.email, password);
        const next = addExdate(ics, occurrence);
        await putEvent(href, next, account.email, password, etag);
        await admin.from("external_events").delete().eq("id", eventId);
      } else {
        // Whole resource (single event or entire series).
        const status = await deleteEvent(href, account.email, password);
        if (status >= 400 && status !== 404 && status !== 410) {
          throw new Error(`delete failed: HTTP ${status}`);
        }
        if (scope === "ALL") {
          // Drop every materialized occurrence of this series locally (they all
          // share the base UID as `uid::<recurrence-id>`); the sync sweep would
          // catch stragglers too, but this makes the delete feel immediate.
          await admin
            .from("external_events")
            .delete()
            .eq("account_id", evt.account_id)
            .eq("calendar_id", evt.calendar_id)
            .or(icloudSeriesOrFilter(uidBase));
        } else {
          await admin.from("external_events").delete().eq("id", eventId);
        }
      }
      await logSync("icloud", "event-delete", "ok", undefined, user.id);
      return json({ ok: true });
    }

    // ── Move: re-home the CalDAV resource onto a different collection ─────
    // CalDAV has no atomic move — PUT the event to the destination collection,
    // then DELETE it from the old one. Occurrence-level moves aren't a thing;
    // the whole resource (series) moves together.
    if (action === "move") {
      const dest = ((body.calendarId as string) ?? "").trim();
      if (!dest) return json({ error: "calendarId required" }, 400);
      if (dest.replace(/\/$/, "") === String(evt.calendar_id).replace(/\/$/, "")) {
        return json({ ok: true });
      }
      const { ics } = await getEvent(href, account.email, password);
      const newHref = `${dest.replace(/\/$/, "")}/${uidBase}.ics`;
      const newEtag = await putEvent(newHref, ics, account.email, password);
      const status = await deleteEvent(href, account.email, password);
      if (status >= 400 && status !== 404 && status !== 410) {
        // Roll back the copy so a failed delete doesn't leave a duplicate.
        await deleteEvent(newHref, account.email, password).catch(() => {});
        throw new Error(`move failed on delete: HTTP ${status}`);
      }
      // Retag every local row of this resource to the destination collection,
      // and point the edited row's raw at the new href.
      await admin
        .from("external_events")
        .update({ calendar_id: dest })
        .eq("account_id", evt.account_id)
        .or(icloudSeriesOrFilter(uidBase));
      await admin
        .from("external_events")
        .update({ raw: { ...raw, caldav_href: newHref, caldav_etag: newEtag } })
        .eq("id", eventId);
      await logSync("icloud", "event-move", "ok", undefined, user.id);
      return json({ ok: true });
    }

    // ── RSVP: answer an invite ────────────────────────────────────────────
    // Google has an endpoint for this; CalDAV does not. Answering IS rewriting
    // your own ATTENDEE line's PARTSTAT and PUTting the resource back — which
    // is why RSVP was Google-only until now even though iCloud is a writable
    // provider (the 2026-08-12 audit, rank 9).
    if (action === "rsvp") {
      const partstat = partstatFor(String(body.responseStatus ?? ""));
      if (!partstat) return json({ error: "invalid responseStatus" }, 400);

      const { ics, etag } = await getEvent(href, account.email, password);
      if (setPartstat(ics, account.email, partstat) === ics) {
        // No ATTENDEE line for this address: it isn't an invite the user was
        // asked to. Say so rather than silently reporting success.
        return json({ error: "You're not listed as a guest on this event" }, 400);
      }
      const thisOccurrence = isOccurrence && scope !== "ALL" && occurrence;
      const next = thisOccurrence
        ? setPartstat(ics, account.email, partstat, occurrence)
        : setPartstat(ics, account.email, partstat);
      await putEvent(href, next, account.email, password, etag);

      // Mirror the answer locally so the grid de-dims immediately, exactly as
      // the Google path does. `self_rsvp` is the column every surface reads.
      const selfRsvp = body.responseStatus as string;
      if (scope === "ALL") {
        await admin
          .from("external_events")
          .update({ self_rsvp: selfRsvp })
          .eq("account_id", evt.account_id)
          .eq("calendar_id", evt.calendar_id)
          .or(icloudSeriesOrFilter(uidBase));
      } else {
        await admin.from("external_events").update({ self_rsvp: selfRsvp }).eq("id", eventId);
      }
      await logSync("icloud", "event-rsvp", "ok", undefined, user.id);
      return json({ ok: true });
    }

    // ── Series rule: read RRULE from the master VEVENT ───────────────────
    if (action === "series_rule") {
      const { ics } = await getEvent(href, account.email, password);
      const master = (ics.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? [])
        .find((ve) => !/\bRECURRENCE-ID\b/i.test(ve));
      const recurrence = master
        ? (master.match(/^RRULE:.*$/gim) ?? [])
        : [];
      return json({ ok: true, recurrence: recurrence.length ? recurrence : null });
    }

    // ── Move / resize / retitle / relocate / re-note / re-rule ───────────
    const p = patch as EventPatch;
    const { ics, etag } = await getEvent(href, account.email, password);

    // Recurrence always edits the master VEVENT — never a per-occurrence override.
    if (p.recurrence !== undefined) {
      const next = editSeries(ics, { recurrence: p.recurrence }, evt, timeZone);
      const newEtag = await putEvent(href, next, account.email, password, etag);
      // Materialize here rather than kicking icloud-sync: the sweep there
      // deleted the row the sheet had open (a single event's bare UID becomes
      // `uid::…` occurrences), so the next tap on that sheet 404'd.
      const event = await materializeIcloudResource({ ...series, etag: newEtag }, next, {
        rowId: eventId,
        anchorMs: new Date(evt.start_at).getTime(),
      });
      await logSync("icloud", "event-recurrence", "ok", undefined, user.id);
      return json({ ok: true, event });
    }

    let next: string;
    if (isOccurrence && scope === "ALL") {
      next = editSeries(ics, p, evt, timeZone);
    } else if (isOccurrence && occurrence) {
      // Edit just this occurrence via a RECURRENCE-ID override.
      next = upsertOverride(ics, occurrence, {
        title: p.title,
        startISO: p.start_at,
        endISO: p.end_at,
        allDay: p.all_day,
        location: p.location,
        description: p.description,
      });
    } else {
      // Plain single event.
      next = patchMaster(ics, {
        title: p.title,
        startISO: p.start_at,
        endISO: p.end_at,
        allDay: p.all_day,
        location: p.location,
        description: p.description,
        timeZone,
      });
    }

    const newEtag = await putEvent(href, next, account.email, password, etag);

    // description isn't a column — it lives in the ICS and comes back via sync.
    if (scope !== "ALL") {
      const rowPatch: Record<string, unknown> = {};
      if (p.title !== undefined) rowPatch.title = p.title;
      if (p.start_at !== undefined) rowPatch.start_at = new Date(p.start_at).toISOString();
      if (p.end_at !== undefined) rowPatch.end_at = new Date(p.end_at).toISOString();
      if (p.all_day !== undefined) rowPatch.all_day = p.all_day;
      if (p.location !== undefined) rowPatch.location = p.location;
      // Only while the row still holds the times the client's write left it
      // at — a newer edit owns it otherwise (_shared/eventWriteback.ts).
      if (Object.keys(rowPatch).length) {
        await rewriteMirrorRow(
          admin.from("external_events") as unknown as MirrorRowTable,
          eventId,
          rowPatch,
          parseRowAt(body.rowAt),
        );
      }
    } else {
      // The whole series moved, retitled or changed type: re-materialize it
      // from the ICS we just PUT. A local delta-shift was right for times but
      // could not follow occurrence ids (a TZID series renames every
      // RECURRENCE-ID when it moves) or a series re-anchored to its zone, and
      // a full CalDAV reconcile kick deleted the rows the client had open.
      const startDelta = p.start_at ? new Date(p.start_at).getTime() - new Date(evt.start_at).getTime() : 0;
      const event = await materializeIcloudResource({ ...series, etag: newEtag }, next, {
        rowId: eventId,
        anchorMs: new Date(evt.start_at).getTime() + startDelta,
      });
      await logSync("icloud", "event-writeback", "ok", undefined, user.id);
      return json({ ok: true, event });
    }

    await logSync("icloud", "event-writeback", "ok", undefined, user.id);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("icloud", "event-writeback", "error", msg);
    return json({ error: msg }, 500);
  }
});
