// Write-back for iCloud (Apple Calendar) events over CalDAV.
//
//   action=create               → PUT a new VEVENT to the target calendar
//   patch (no action)           → move / resize / retitle
//   action=delete               → remove the event (or one occurrence)
//
// scope="THIS" (default) edits/deletes a single occurrence of a recurring series;
// scope="ALL" edits/deletes the whole series. Single-occurrence edits on a series
// are best-effort (RECURRENCE-ID/EXDATE are written in UTC).
import { admin, handleOptions, json, logSync, readSecret, requireUser } from "../_shared/admin.ts";
import {
  addExdate,
  buildEvent,
  patchMaster,
  shiftMaster,
  upsertOverride,
} from "../_shared/icalwrite.ts";
import { deleteEvent, getEvent, putEvent } from "../_shared/caldav.ts";

/** The `uid::<recurrence-id>` suffix a recurring occurrence carries → ISO start. */
function suffixToISO(suffix: string): string | null {
  const m = suffix.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", se = "0"] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se)).toISOString();
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const body = await req.json();
    const { eventId, action, patch, scope = "THIS" } = body;

    // ── Create a new event on an iCloud calendar ─────────────────────────
    if (action === "create") {
      const title = (body.title as string)?.trim() || "(no title)";
      const start_at = body.start_at as string;
      const end_at = body.end_at as string;
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

      // Target calendar: an explicit collection url, else the account's first.
      const calendarUrl =
        (body.calendarId as string | undefined) ||
        (account.calendars?.[0]?.id as string | undefined);
      if (!calendarUrl) return json({ error: "no iCloud calendar to write to" }, 400);

      const uid = `nuvo-${crypto.randomUUID()}`;
      const ics = buildEvent({ uid, title, startISO: start_at, endISO: end_at, recurrence });
      const href = `${calendarUrl.replace(/\/$/, "")}/${uid}.ics`;
      const etag = await putEvent(href, ics, account.email, password);

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
            all_day: false,
            location: null,
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
    if (error || !evt) return json({ error: "event not found" }, 404);

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
    const occurrenceISO = suffix ? suffixToISO(suffix) : null;

    // ── Delete / cancel ──────────────────────────────────────────────────
    if (action === "delete") {
      if (isOccurrence && scope !== "ALL" && occurrenceISO) {
        // Remove just this occurrence: EXDATE onto the master, then PUT back.
        const { ics, etag } = await getEvent(href, account.email, password);
        const next = addExdate(ics, occurrenceISO);
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
            .or(`provider_event_id.eq.${uidBase},provider_event_id.like.${uidBase}::*`);
        } else {
          await admin.from("external_events").delete().eq("id", eventId);
        }
      }
      await logSync("icloud", "event-delete", "ok", undefined, user.id);
      return json({ ok: true });
    }

    // ── Move / resize / retitle ──────────────────────────────────────────
    const p = patch as { title?: string; start_at?: string; end_at?: string };
    const { ics, etag } = await getEvent(href, account.email, password);

    let next: string;
    if (isOccurrence && scope === "ALL") {
      // Shift the whole series by the instance's time delta (+ retitle).
      const deltaMs = p.start_at ? new Date(p.start_at).getTime() - new Date(evt.start_at).getTime() : 0;
      next = shiftMaster(ics, deltaMs, p.title);
    } else if (isOccurrence && occurrenceISO) {
      // Edit just this occurrence via a RECURRENCE-ID override.
      next = upsertOverride(ics, occurrenceISO, {
        title: p.title,
        startISO: p.start_at,
        endISO: p.end_at,
      });
    } else {
      // Plain single event.
      next = patchMaster(ics, { title: p.title, startISO: p.start_at, endISO: p.end_at });
    }

    await putEvent(href, next, account.email, password, etag);

    // Keep the local row consistent (THIS-scope only; ALL is rewritten by the
    // next sync when every instance's new time comes back).
    if (scope !== "ALL") {
      const rowPatch: Record<string, unknown> = {};
      if (p.title !== undefined) rowPatch.title = p.title;
      if (p.start_at !== undefined) rowPatch.start_at = new Date(p.start_at).toISOString();
      if (p.end_at !== undefined) rowPatch.end_at = new Date(p.end_at).toISOString();
      if (Object.keys(rowPatch).length) {
        await admin.from("external_events").update(rowPatch).eq("id", eventId);
      }
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
