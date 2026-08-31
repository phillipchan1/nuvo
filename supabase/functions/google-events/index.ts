// Write-back for real Google events edited in the planner (move / resize /
// retitle). The optimistic local edit already happened; this pushes it to
// Google. M365 events never reach here (read-only in the UI).
//
// scope="THIS"  — patch just this instance (default)
// scope="ALL"   — patch the master recurring event using the time delta,
//                 which shifts every instance in the series
import { admin, handleOptions, json, logSync, requireActor } from "../_shared/admin.ts";
import { type GoogleAccount, gFetch, loadGoogleAccounts, mapGoogleEvent } from "../_shared/google.ts";
import { shiftGoogleDateResource } from "../_shared/googleDateTime.ts";
import { hasConference, joinUrl, meetCreateRequest, shouldAddMeet } from "../_shared/conferencing.ts";

/** Master series id: generated column, then raw, then the Google instance suffix. */
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

async function kickGoogleSync(
  account: GoogleAccount,
  calendarId: string,
  userId: string,
  reason: string,
) {
  const syncRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/google-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "incremental",
      accountId: account.id,
      calendarId,
    }),
  });
  if (!syncRes.ok) {
    await logSync("google", reason, "error", await syncRes.text(), userId);
  }
}

/** Shift every mirrored instance of a series by the same start/end deltas the
 *  dragged occurrence moved, so the next client refetch isn't the old times. */
async function shiftLocalSeries(
  evt: {
    account_id: string;
    calendar_id: string;
    start_at: string;
    end_at: string;
  },
  recurringEventId: string,
  patch: {
    start_at?: string;
    end_at?: string;
    title?: string;
    location?: string | null;
  },
) {
  const startDelta = patch.start_at
    ? new Date(patch.start_at).getTime() - new Date(evt.start_at).getTime()
    : 0;
  const endDelta = patch.end_at
    ? new Date(patch.end_at).getTime() - new Date(evt.end_at).getTime()
    : 0;
  if (Number.isNaN(startDelta) || Number.isNaN(endDelta)) return;

  const { data: rows } = await admin
    .from("external_events")
    .select("id, start_at, end_at")
    .eq("account_id", evt.account_id)
    .eq("calendar_id", evt.calendar_id)
    .eq("recurring_event_id", recurringEventId);

  await Promise.all(
    (rows ?? []).map((row: { id: string; start_at: string; end_at: string }) => {
      const rowPatch: Record<string, unknown> = {};
      if (patch.start_at) {
        rowPatch.start_at = new Date(new Date(row.start_at).getTime() + startDelta).toISOString();
      }
      if (patch.end_at) {
        rowPatch.end_at = new Date(new Date(row.end_at).getTime() + endDelta).toISOString();
      }
      if (patch.title !== undefined) rowPatch.title = patch.title;
      if (patch.location !== undefined) rowPatch.location = patch.location;
      if (!Object.keys(rowPatch).length) return Promise.resolve();
      return admin.from("external_events").update(rowPatch).eq("id", row.id);
    }),
  );
}

function googleDate(iso: string): string {
  return iso.slice(0, 10);
}

function googleStartEnd(isoStart: string, isoEnd: string, allDay: boolean): { start: Record<string, string>; end: Record<string, string> } {
  if (allDay) {
    return { start: { date: googleDate(isoStart) }, end: { date: googleDate(isoEnd) } };
  }
  return { start: { dateTime: new Date(isoStart).toISOString() }, end: { dateTime: new Date(isoEnd).toISOString() } };
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const body = await req.json();
    const user = await requireActor(req, (body as { actingUserId?: unknown }).actingUserId);
    const { eventId, action, patch, scope = "THIS" } = body;

    // ── Create a new event on the primary Google calendar ────────────────
    if (action === "create") {
      const title = (body.title as string)?.trim() || "(no title)";
      const start_at = body.start_at as string;
      const end_at = body.end_at as string;
      const all_day = Boolean(body.all_day);
      // Optional Google RRULE lines for a repeating event — Google expands the
      // series natively; the read-sync pulls the instances back.
      const recurrence = Array.isArray(body.recurrence) ? (body.recurrence as string[]) : undefined;
      if (!start_at || !end_at) return json({ error: "start_at and end_at required" }, 400);

      // Prefer explicit accountId, then the user's default, then first connected account.
      const accountId = body.accountId as string | undefined;
      const allAccounts = await loadGoogleAccounts(accountId || undefined);
      let account = allAccounts.find((a) => a.user_id === user.id && (!accountId || a.id === accountId));
      if (!account && !accountId) {
        // Fall back to the user's saved default calendar account.
        const { data: s } = await admin
          .from("user_settings")
          .select("default_calendar_account_id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (s?.default_calendar_account_id) {
          account = allAccounts.find((a) => a.id === s.default_calendar_account_id);
        }
        account ??= allAccounts.find((a) => a.user_id === user.id);
      }
      if (!account) return json({ error: "no google account connected" }, 400);

      const attendees = Array.isArray(body.attendees) ? (body.attendees as string[]) : [];
      const targetCal = (body.calendarId as string | undefined)?.trim();
      const location = (body.location as string | undefined) ?? undefined;
      const description = (body.description as string | undefined) ?? undefined;

      // Whether guests are emailed is the caller's decision, not a constant.
      // This used to be a hardcoded sendUpdates=all, so a composer whose button
      // said "Create" silently mailed everyone in the guest field. The UI now
      // states who gets mailed and offers to skip; an omitted flag still
      // notifies, which is the right default for a real invite.
      const notifyGuests = body.notifyGuests !== false;

      // Video conferencing. Google never applies the user's "add Meet
      // automatically" web-UI preference to API-created events, so unless we ask
      // here the event has no link at all. An explicit addMeet from the caller
      // wins; otherwise the account's standing preference decides
      // (_shared/conferencing.ts), which is the same rule the composer shows.
      let addMeet = typeof body.addMeet === "boolean" ? (body.addMeet as boolean) : undefined;
      if (addMeet === undefined) {
        const { data: prefs } = await admin
          .from("user_settings")
          .select("auto_add_meet")
          .eq("user_id", user.id)
          .maybeSingle();
        addMeet = shouldAddMeet(prefs?.auto_add_meet, attendees.length);
      }

      const { start, end } = googleStartEnd(start_at, end_at, all_day);

      const res = await gFetch(
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
      if (!res.ok) throw new Error(`create event failed: ${res.status} ${await res.text()}`);
      let created = await res.json();

      // Google mints the conference asynchronously: the create response comes
      // back with status "pending" and no entry points, and the link appears a
      // beat later. Without this re-read the row we store — and everything the
      // caller reports — says the meeting has no way to join, which is exactly
      // the bug this feature exists to fix. Two short reads, then give up and
      // let the next sync fill it in.
      // This is a best-effort enrichment of an already-created event — Google
      // has the event and has already mailed the guests by this point, so a
      // hiccup here (network blip, token refresh failure) must never surface
      // as "couldn't create the event." Swallow and let the next sync fill
      // the Meet link in instead.
      if (addMeet && !hasConference(created)) {
        try {
          const calForRead = targetCal || (created.organizer?.email as string) || account.email;
          for (const waitMs of [700, 1500]) {
            await new Promise((r) => setTimeout(r, waitMs));
            const again = await gFetch(
              account,
              `/calendars/${encodeURIComponent(calForRead)}/events/${
                encodeURIComponent(created.id)
              }?conferenceDataVersion=1`,
            );
            if (!again.ok) break;
            const fresh = await again.json();
            if (hasConference(fresh)) { created = fresh; break; }
            // A failed create request never resolves — stop waiting on it.
            if (fresh?.conferenceData?.createRequest?.status?.statusCode === "failure") break;
          }
        } catch (e) {
          await logSync("google", "event-create-meet-poll", "error", String(e), user.id);
        }
      }

      // Prefer the explicit target calendar; else the primary's id (the account
      // email, which Google returns as the organizer). Write the row now so it
      // shows without waiting on sync.
      const calendarId = targetCal || (created.organizer?.email as string) || account.email;
      const row = mapGoogleEvent(account, calendarId, created);
      let event = null;
      if (row) {
        const { data, error: upsertError } = await admin
          .from("external_events")
          .upsert(row, { onConflict: "account_id,calendar_id,provider_event_id" })
          .select(
            "id, account_id, provider_event_id, calendar_id, title, start_at, end_at, all_day, location, busy",
          )
          .single();
        if (upsertError) {
          // The event exists on Google and guests are already mailed — a local
          // storage failure here is not a create failure. Log it; the next
          // sync pass will pick the event up.
          await logSync("google", "event-create-upsert", "error", upsertError.message, user.id);
        }
        event = data;
      }
      await logSync("google", "event-create", "ok", undefined, user.id);
      // meetUrl lets the caller *say* the link is there (the agent quotes it,
      // the composer can surface it) instead of the user going to Google to check.
      return json({ ok: true, event, meetUrl: joinUrl(created) });
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

    const account = evt.calendar_accounts as unknown as GoogleAccount & { provider: string };
    if (account.provider !== "google") return json({ error: "event is read-only" }, 400);

    // ── Invite: add guests to an existing event ──────────────────────────
    if (action === "invite") {
      const newEmails = Array.isArray(body.attendees) ? (body.attendees as string[]) : [];
      if (!newEmails.length) return json({ error: "attendees required" }, 400);

      const getRes = await gFetch(
        account,
        `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(evt.provider_event_id)}`,
      );
      if (!getRes.ok) throw new Error(`fetch event: ${getRes.status}`);
      const googleEvent = await getRes.json();

      // deno-lint-ignore no-explicit-any
      const existingEmails = new Set((googleEvent.attendees ?? []).map((a: any) => a.email as string));
      const merged = [
        ...(googleEvent.attendees ?? []),
        ...newEmails.filter((e) => !existingEmails.has(e)).map((email) => ({ email })),
      ];

      const notifyGuests = body.notifyGuests !== false;
      const patchRes = await gFetch(
        account,
        `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${
          encodeURIComponent(evt.provider_event_id)
        }?sendUpdates=${notifyGuests ? "all" : "none"}`,
        { method: "PATCH", body: JSON.stringify({ attendees: merged }) },
      );
      if (!patchRes.ok) throw new Error(`invite: ${patchRes.status} ${await patchRes.text()}`);

      // Refresh local raw so the attendees list updates without waiting for sync.
      const refreshed = await patchRes.json().catch(() => null);
      if (refreshed) {
        await admin
          .from("external_events")
          .update({ raw: refreshed })
          .eq("id", eventId);
      }

      await logSync("google", "event-invite", "ok", undefined, user.id);
      return json({ ok: true });
    }

    // ── Add Google Meet to an existing event ─────────────────────────────
    // For the meeting that was booked before the preference existed, or booked
    // as a solo block and then given guests. Idempotent: an event that already
    // has a conference returns its link rather than minting a second one.
    if (action === "add_meet") {
      const getRes = await gFetch(
        account,
        `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${
          encodeURIComponent(evt.provider_event_id)
        }?conferenceDataVersion=1`,
      );
      if (!getRes.ok) throw new Error(`fetch event: ${getRes.status}`);
      const current = await getRes.json();
      if (hasConference(current)) {
        await admin.from("external_events").update({ raw: current }).eq("id", eventId);
        return json({ ok: true, meetUrl: joinUrl(current), alreadyHad: true });
      }

      // Guests need to be told a meeting moved online, so notifying is the
      // default here — same rule as delete: only a solo event stays quiet.
      // deno-lint-ignore no-explicit-any
      const guests = ((current.attendees as any[]) ?? []).filter((a) => a?.self !== true);
      const notifyGuests = typeof body.notifyGuests === "boolean"
        ? (body.notifyGuests as boolean)
        : guests.length > 0;

      const patchRes = await gFetch(
        account,
        `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${
          encodeURIComponent(evt.provider_event_id)
        }?conferenceDataVersion=1&sendUpdates=${notifyGuests ? "all" : "none"}`,
        { method: "PATCH", body: JSON.stringify(meetCreateRequest(crypto.randomUUID())) },
      );
      if (!patchRes.ok) throw new Error(`add meet: ${patchRes.status} ${await patchRes.text()}`);
      let updated = await patchRes.json();

      // Same asynchronous mint as on create — poll briefly for the entry point.
      // The PATCH above already succeeded, so a hiccup in this poll must not
      // turn a successful add-meet into a reported failure.
      try {
        for (const waitMs of [700, 1500]) {
          if (hasConference(updated)) break;
          await new Promise((r) => setTimeout(r, waitMs));
          const again = await gFetch(
            account,
            `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${
              encodeURIComponent(evt.provider_event_id)
            }?conferenceDataVersion=1`,
          );
          if (!again.ok) break;
          updated = await again.json();
          if (updated?.conferenceData?.createRequest?.status?.statusCode === "failure") break;
        }
      } catch (e) {
        await logSync("google", "event-add-meet-poll", "error", String(e), user.id);
      }

      await admin.from("external_events").update({ raw: updated }).eq("id", eventId);
      await logSync("google", "event-add-meet", "ok", undefined, user.id);
      const meetUrl = joinUrl(updated);
      if (!meetUrl) {
        // Google accepted the request but hasn't produced a link. Say so —
        // a silent ok would read as "there's a Meet link" when there isn't one yet.
        return json({ ok: true, meetUrl: null, pending: true });
      }
      return json({ ok: true, meetUrl });
    }

    // ── RSVP: accept / decline / tentative ───────────────────────────────
    if (action === "rsvp") {
      const responseStatus = body.responseStatus as string;
      const sendUpdates = body.sendNotifications !== false ? "all" : "none";
      if (!["accepted", "declined", "tentative"].includes(responseStatus)) {
        return json({ error: "invalid responseStatus" }, 400);
      }

      // Fetch current event from Google to get the full attendees array.
      // Try calendar_id first; fall back to "primary" (invited events sometimes
      // only appear under the user's primary calendar alias).
      let googleEvent: Record<string, unknown> | null = null;
      let rsvpCalId = evt.calendar_id;
      for (const tryId of [evt.calendar_id, "primary"]) {
        const getRes = await gFetch(
          account,
          `/calendars/${encodeURIComponent(tryId)}/events/${encodeURIComponent(evt.provider_event_id)}`,
        );
        if (getRes.ok) { googleEvent = await getRes.json(); rsvpCalId = tryId; break; }
      }
      if (!googleEvent) throw new Error("event not found in Google Calendar");

      // deno-lint-ignore no-explicit-any
      const attendees: any[] = (googleEvent.attendees as any[]) ?? [];
      const hasSelf = attendees.some((a: any) => a.self);
      const updated = hasSelf
        ? attendees.map((a: any) => (a.self ? { ...a, responseStatus } : a))
        : [...attendees, { email: account.email, responseStatus, self: true }];

      const patchRes = await gFetch(
        account,
        `/calendars/${encodeURIComponent(rsvpCalId)}/events/${encodeURIComponent(evt.provider_event_id)}?sendUpdates=${sendUpdates}`,
        { method: "PATCH", body: JSON.stringify({ attendees: updated }) },
      );
      if (!patchRes.ok) throw new Error(`rsvp failed (${patchRes.status}): ${await patchRes.text()}`);

      // Refresh raw + self_rsvp so the slide-over and calendar grid update
      // immediately without waiting for the next background sync.
      const refreshed = await patchRes.json().catch(() => null);
      await admin
        .from("external_events")
        .update({ self_rsvp: responseStatus, ...(refreshed ? { raw: refreshed } : {}) })
        .eq("id", eventId)
        .eq("user_id", user.id);

      await logSync("google", "event-rsvp", "ok", undefined, user.id);
      return json({ ok: true });
    }

    // ── Delete / cancel: remove from Google + local mirror ───────────────
    // Deleting an event you organize cancels it for every guest whatever we
    // pass — sendUpdates only decides whether they are *told*. "none" was the
    // flat default, so cancelling a meeting made it vanish from other people's
    // calendars with no explanation. Now a meeting you host defaults to sending
    // cancellation notices, and only a solo event stays quiet. The client can
    // still override either way (notifyGuests), and the UI says which it will do.
    if (action === "delete") {
      const rawEvent = (evt.raw ?? {}) as Record<string, unknown>;
      // deno-lint-ignore no-explicit-any
      const guests = ((rawEvent.attendees as any[]) ?? []).filter((a) => a?.self !== true);
      // deno-lint-ignore no-explicit-any
      const isOrganizer = (rawEvent.organizer as any)?.self === true;
      const notifyByDefault = guests.length > 0 && isOrganizer;
      const notifyGuests = typeof body.notifyGuests === "boolean"
        ? body.notifyGuests
        // Legacy callers passed sendUpdates directly; keep honouring it.
        : body.sendUpdates === "all" || (body.sendUpdates === undefined && notifyByDefault);
      const sendUpdates = notifyGuests ? "all" : "none";
      const recurringEventId = (evt.raw as Record<string, unknown>)?.recurringEventId as
        | string
        | undefined;
      // scope="ALL" deletes the whole series (the master event); otherwise
      // just this instance / single event.
      const targetId = scope === "ALL" && recurringEventId ? recurringEventId : evt.provider_event_id;

      const res = await gFetch(
        account,
        `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(targetId)}?sendUpdates=${sendUpdates}`,
        { method: "DELETE" },
      );
      // 404/410 = already gone on Google's side; treat as success.
      if (!res.ok && res.status !== 404 && res.status !== 410) {
        throw new Error(`delete event failed: ${res.status} ${await res.text()}`);
      }

      if (scope === "ALL" && recurringEventId) {
        const { error: delErr } = await admin
          .from("external_events")
          .delete()
          .eq("account_id", evt.account_id)
          .eq("calendar_id", evt.calendar_id)
          .eq("recurring_event_id", recurringEventId);
        if (delErr) throw delErr;
      } else {
        const { error: delErr } = await admin.from("external_events").delete().eq("id", eventId);
        if (delErr) throw delErr;
      }
      await logSync("google", "event-delete", "ok", undefined, user.id);
      return json({ ok: true });
    }

    // ── Move: re-home the event onto a different calendar in this account ─
    if (action === "move") {
      const dest = ((body.calendarId as string) ?? "").trim();
      if (!dest) return json({ error: "calendarId required" }, 400);
      if (dest === evt.calendar_id) return json({ ok: true });

      const res = await gFetch(
        account,
        `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(evt.provider_event_id)}/move?destination=${encodeURIComponent(dest)}&sendUpdates=none`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`move event failed: ${res.status} ${await res.text()}`);

      await admin.from("external_events").update({ calendar_id: dest }).eq("id", eventId);
      await logSync("google", "event-move", "ok", undefined, user.id);
      return json({ ok: true });
    }

    // ── Series rule: read the master's RRULE (instances don't carry it) ──
    if (action === "series_rule") {
      const rawEvent = (evt.raw ?? {}) as Record<string, unknown>;
      const stored = Array.isArray(rawEvent.recurrence) ? (rawEvent.recurrence as string[]) : null;
      if (stored?.length) return json({ ok: true, recurrence: stored });

      const recurringEventId = rawEvent.recurringEventId as string | undefined;
      if (!recurringEventId) return json({ ok: true, recurrence: null });

      const masterRes = await gFetch(
        account,
        `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(recurringEventId)}`,
      );
      if (!masterRes.ok) throw new Error(`fetch master: ${masterRes.status} ${await masterRes.text()}`);
      const master = await masterRes.json();
      const recurrence = Array.isArray(master.recurrence) ? (master.recurrence as string[]) : null;
      return json({ ok: true, recurrence });
    }

    // ── Recurrence: add / change / remove the series rule ────────────────
    // Always targets the master — a single event becomes a series; a series
    // is un-recurred or re-ruled in place.
    if (patch?.recurrence !== undefined) {
      const rawEvent = (evt.raw ?? {}) as Record<string, unknown>;
      const recurringEventId = rawEvent.recurringEventId as string | undefined;
      const targetId = recurringEventId ?? evt.provider_event_id;
      const nextRecurrence = patch.recurrence === null || (Array.isArray(patch.recurrence) && patch.recurrence.length === 0)
        ? []
        : (patch.recurrence as string[]);

      const res = await gFetch(
        account,
        `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(targetId)}`,
        { method: "PATCH", body: JSON.stringify({ recurrence: nextRecurrence }) },
      );
      if (!res.ok) throw new Error(`patch recurrence: ${res.status} ${await res.text()}`);

      // Google expands the series upstream; pull the new instances into the
      // mirror now rather than waiting for a webhook or the 15-minute poll.
      const updated = await res.json().catch(() => null);
      if (updated) {
        const mapped = mapGoogleEvent(account, evt.calendar_id, updated);
        if (mapped) {
          await admin
            .from("external_events")
            .upsert(mapped, { onConflict: "account_id,calendar_id,provider_event_id" });
        }
      }
      await kickGoogleSync(account, evt.calendar_id, user.id, "event-recurrence-sync");

      await logSync("google", "event-recurrence", "ok", undefined, user.id);
      return json({ ok: true });
    }

    if (scope === "ALL") {
      // Patch the master so every instance shifts together, then rewrite the
      // local mirror and kick an incremental sync. Returning without either of
      // those left the dialog's revert as the last thing the calendar showed —
      // Google had the new times (or a failed PATCH nobody saw) and Nuvo didn't.
      const recurringEventId = seriesMasterId(evt);
      if (!recurringEventId) {
        // Not actually a recurring instance — fall through to single-event patch.
      } else {
        const masterRes = await gFetch(
          account,
          `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(recurringEventId)}`,
        );
        if (!masterRes.ok) throw new Error(`fetch master: ${masterRes.status} ${await masterRes.text()}`);
        const master = await masterRes.json();

        const gPatch: Record<string, unknown> = {};
        if (patch.start_at) {
          const delta =
            new Date(patch.start_at as string).getTime() - new Date(evt.start_at as string).getTime();
          const next = shiftGoogleDateResource(master.start, delta);
          if (next) gPatch.start = next;
        }
        if (patch.end_at) {
          const delta =
            new Date(patch.end_at as string).getTime() - new Date(evt.end_at as string).getTime();
          const next = shiftGoogleDateResource(master.end, delta);
          if (next) gPatch.end = next;
        }
        if (patch.title) gPatch.summary = patch.title;
        if (patch.location !== undefined) gPatch.location = patch.location ?? "";
        if (patch.description !== undefined) gPatch.description = patch.description ?? "";

        if (Object.keys(gPatch).length) {
          const res = await gFetch(
            account,
            `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(recurringEventId)}`,
            { method: "PATCH", body: JSON.stringify(gPatch) },
          );
          if (!res.ok) throw new Error(`patch master: ${res.status} ${await res.text()}`);
        }

        await shiftLocalSeries(evt, recurringEventId, patch);
        await kickGoogleSync(account, evt.calendar_id, user.id, "event-writeback-all-sync");
        await logSync("google", "event-writeback-all", "ok", undefined, user.id);
        return json({ ok: true });
      }
    }

    // scope="THIS" (or ALL fallback when recurringEventId is missing)
    const gPatch: Record<string, unknown> = {};
    if (patch.title) gPatch.summary = patch.title;
    const allDay = patch.all_day !== undefined ? Boolean(patch.all_day) : Boolean(evt.all_day);
    if (patch.start_at || patch.end_at || patch.all_day !== undefined) {
      const startISO = (patch.start_at as string | undefined) ?? evt.start_at;
      const endISO = (patch.end_at as string | undefined) ?? evt.end_at;
      Object.assign(gPatch, googleStartEnd(startISO, endISO, allDay));
    }
    // location / description are nullable — send "" to clear the field in Google.
    if (patch.location !== undefined) gPatch.location = patch.location ?? "";
    if (patch.description !== undefined) gPatch.description = patch.description ?? "";

    const res = await gFetch(
      account,
      `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(evt.provider_event_id)}`,
      { method: "PATCH", body: JSON.stringify(gPatch) },
    );
    if (!res.ok) throw new Error(`google patch failed: ${res.status} ${await res.text()}`);

    // Keep the mirror row's raw (and location column) fresh so the inspector's
    // notes/location reflect the write without waiting for the next sync.
    const updated = await res.json().catch(() => null);
    if (updated) {
      const mapped = mapGoogleEvent(account, evt.calendar_id, updated);
      await admin
        .from("external_events")
        .update({
          raw: updated,
          ...(mapped ? { all_day: mapped.all_day, start_at: mapped.start_at, end_at: mapped.end_at } : {}),
          ...(patch.location !== undefined ? { location: patch.location ?? null } : {}),
        })
        .eq("id", eventId);
    }

    await logSync("google", "event-writeback", "ok", undefined, user.id);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("google", "event-writeback", "error", msg);
    return json({ error: msg }, 500);
  }
});
