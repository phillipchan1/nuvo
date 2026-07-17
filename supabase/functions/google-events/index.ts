// Write-back for real Google events edited in the planner (move / resize /
// retitle). The optimistic local edit already happened; this pushes it to
// Google. M365 events never reach here (read-only in the UI).
//
// scope="THIS"  — patch just this instance (default)
// scope="ALL"   — patch the master recurring event using the time delta,
//                 which shifts every instance in the series
import { admin, handleOptions, json, logSync, requireUser } from "../_shared/admin.ts";
import { type GoogleAccount, gFetch, loadGoogleAccounts, mapGoogleEvent } from "../_shared/google.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const body = await req.json();
    const { eventId, action, patch, scope = "THIS" } = body;

    // ── Create a new event on the primary Google calendar ────────────────
    if (action === "create") {
      const title = (body.title as string)?.trim() || "(no title)";
      const start_at = body.start_at as string;
      const end_at = body.end_at as string;
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

      const res = await gFetch(
        account,
        `/calendars/${encodeURIComponent(targetCal || "primary")}/events?sendUpdates=all`,
        {
          method: "POST",
          body: JSON.stringify({
            summary: title,
            start: { dateTime: new Date(start_at).toISOString() },
            end: { dateTime: new Date(end_at).toISOString() },
            ...(location ? { location } : {}),
            ...(description ? { description } : {}),
            ...(recurrence?.length ? { recurrence } : {}),
            ...(attendees.length ? { attendees: attendees.map((email) => ({ email })) } : {}),
          }),
        },
      );
      if (!res.ok) throw new Error(`create event failed: ${res.status} ${await res.text()}`);
      const created = await res.json();

      // Prefer the explicit target calendar; else the primary's id (the account
      // email, which Google returns as the organizer). Write the row now so it
      // shows without waiting on sync.
      const calendarId = targetCal || (created.organizer?.email as string) || account.email;
      const row = mapGoogleEvent(account, calendarId, created);
      let event = null;
      if (row) {
        const { data } = await admin
          .from("external_events")
          .upsert(row, { onConflict: "account_id,calendar_id,provider_event_id" })
          .select(
            "id, account_id, provider_event_id, calendar_id, title, start_at, end_at, all_day, location, busy",
          )
          .single();
        event = data;
      }
      await logSync("google", "event-create", "ok", undefined, user.id);
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

      const patchRes = await gFetch(
        account,
        `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(evt.provider_event_id)}?sendUpdates=all`,
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
    // sendUpdates "all" notifies attendees (a real cancellation for events the
    // user organizes); "none" (default) quietly removes it from their calendar.
    if (action === "delete") {
      const sendUpdates = body.sendUpdates === "all" ? "all" : "none";
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

    if (scope === "ALL") {
      // Patch the master recurring event so every instance shifts together.
      const recurringEventId = (evt.raw as Record<string, unknown>)?.recurringEventId as string | undefined;
      if (!recurringEventId) {
        // Not actually a recurring instance — fall through to single-event patch.
      } else {
        // Fetch master to get its current start/end and timezone info.
        const masterRes = await gFetch(
          account,
          `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(recurringEventId)}`,
        );
        if (!masterRes.ok) throw new Error(`fetch master: ${masterRes.status} ${await masterRes.text()}`);
        const master = await masterRes.json();

        // Calculate the time delta from the instance's old time to the new time,
        // then apply the same offset to the master event's start/end.
        const deltaMs =
          new Date(patch.start_at as string).getTime() - new Date(evt.start_at as string).getTime();

        const masterStart = new Date(
          (master.start?.dateTime ?? master.start?.date) as string,
        );
        const masterEnd = new Date(
          (master.end?.dateTime ?? master.end?.date) as string,
        );

        const body: Record<string, unknown> = {
          start: {
            dateTime: new Date(masterStart.getTime() + deltaMs).toISOString(),
            timeZone: master.start?.timeZone,
          },
          end: {
            dateTime: new Date(masterEnd.getTime() + deltaMs).toISOString(),
            timeZone: master.end?.timeZone,
          },
        };

        const res = await gFetch(
          account,
          `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(recurringEventId)}`,
          { method: "PATCH", body: JSON.stringify(body) },
        );
        if (!res.ok) throw new Error(`patch master: ${res.status} ${await res.text()}`);

        await logSync("google", "event-writeback-all", "ok", undefined, user.id);
        return json({ ok: true });
      }
    }

    // scope="THIS" (or ALL fallback when recurringEventId is missing)
    const gPatch: Record<string, unknown> = {};
    if (patch.title) gPatch.summary = patch.title;
    if (patch.start_at) gPatch.start = { dateTime: patch.start_at };
    if (patch.end_at) gPatch.end = { dateTime: patch.end_at };
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
      await admin
        .from("external_events")
        .update({
          raw: updated,
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
