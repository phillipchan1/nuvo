// Write-back for real Google events edited in the planner (move / resize /
// retitle). The optimistic local edit already happened; this pushes it to
// Google. M365 events never reach here (read-only in the UI).
//
// scope="THIS"  — patch just this instance (default)
// scope="ALL"   — patch the master recurring event using the time delta,
//                 which shifts every instance in the series
import { admin, handleOptions, json, logSync, requireActor } from "../_shared/admin.ts";
import { type GoogleAccount, gFetch, loadGoogleAccounts, mapGoogleEvent } from "../_shared/google.ts";
import { shiftGoogleDateResource, googleStartEnd, masterToAllDay, masterToTimed } from "../_shared/googleDateTime.ts";
import { hasConference, joinUrl, meetCreateRequest, shouldAddMeet } from "../_shared/conferencing.ts";
import { type MirrorRowTable, parseRowAt, rewriteMirrorRow } from "../_shared/eventWriteback.ts";
import { isGoogleSeriesMaster } from "../_shared/google.ts";
import { countGoogleInstancesBefore, googleSeriesOrFilter, materializeGoogleResource } from "../_shared/googleSeries.ts";
import { planGoogleSplit } from "../_shared/googleSplit.ts";
import { isUsableTimeZone, toIcalLocal } from "../_shared/icalTz.ts";
import { rruleCount, shiftRRuleDays } from "../_shared/recurrence.ts";
import { refuseFrozenWrite } from "../_shared/writeFreeze.ts";

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

/** THIS patches the instance; ALL patches the series master. */
function googleTargetId(
  evt: {
    recurring_event_id?: string | null;
    provider_event_id: string;
    raw?: unknown;
  },
  scope: string,
): string {
  const master = seriesMasterId(evt);
  return scope === "ALL" && master ? master : evt.provider_event_id;
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
    all_day?: boolean;
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
      if (patch.all_day !== undefined) rowPatch.all_day = patch.all_day;
      if (!Object.keys(rowPatch).length) return Promise.resolve();
      return admin.from("external_events").update(rowPatch).eq("id", row.id);
    }),
  );
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const frozen = refuseFrozenWrite(req);
  if (frozen) return frozen;

  try {
    const body = await req.json();
    const user = await requireActor(req, (body as { actingUserId?: unknown }).actingUserId);
    const { eventId, action, patch } = body;
    let scope = (body.scope as string | undefined) ?? "THIS";
    // The client's IANA zone. Google REQUIRES a timeZone on a recurring event
    // ("Missing time zone definition") and expands BYDAY in it — without one a
    // weekly create failed outright, and converting a Nuvo-made event to
    // weekly did too.
    const timeZone = isUsableTimeZone(body.timeZone) ? (body.timeZone as string) : null;

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
      if (!all_day && timeZone) {
        start.timeZone = timeZone;
        end.timeZone = timeZone;
      }

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
      // A series is stored as its instances, never as the master.
      if (isGoogleSeriesMaster(created)) {
        let event = null;
        try {
          event = await materializeGoogleResource(account, calendarId, created, {
            anchorMs: new Date(start_at).getTime(),
          });
        } catch (e) {
          // Google has the series; the next sync brings it in. Not a create failure.
          await logSync("google", "event-create-instances", "error", String(e), user.id);
        }
        await logSync("google", "event-create", "ok", undefined, user.id);
        return json({ ok: true, event, meetUrl: joinUrl(created) });
      }
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
      const targetId = googleTargetId(evt, scope);

      const getRes = await gFetch(
        account,
        `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(targetId)}`,
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
          encodeURIComponent(targetId)
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
      if (scope === "ALL") {
        await kickGoogleSync(account, evt.calendar_id, user.id, "event-invite-all-sync");
      }

      await logSync("google", "event-invite", "ok", undefined, user.id);
      return json({ ok: true });
    }

    // ── Add Google Meet to an existing event ─────────────────────────────
    // For the meeting that was booked before the preference existed, or booked
    // as a solo block and then given guests. Idempotent: an event that already
    // has a conference returns its link rather than minting a second one.
    if (action === "add_meet") {
      const targetId = googleTargetId(evt, scope);
      const getRes = await gFetch(
        account,
        `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${
          encodeURIComponent(targetId)
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
          encodeURIComponent(targetId)
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
              encodeURIComponent(targetId)
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
      if (scope === "ALL") {
        await kickGoogleSync(account, evt.calendar_id, user.id, "event-add-meet-all-sync");
      }
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
      const targetId = googleTargetId(evt, scope);
      let googleEvent: Record<string, unknown> | null = null;
      let rsvpCalId = evt.calendar_id;
      for (const tryId of [evt.calendar_id, "primary"]) {
        const getRes = await gFetch(
          account,
          `/calendars/${encodeURIComponent(tryId)}/events/${encodeURIComponent(targetId)}`,
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
        `/calendars/${encodeURIComponent(rsvpCalId)}/events/${encodeURIComponent(targetId)}?sendUpdates=${sendUpdates}`,
        { method: "PATCH", body: JSON.stringify({ attendees: updated }) },
      );
      if (!patchRes.ok) throw new Error(`rsvp failed (${patchRes.status}): ${await patchRes.text()}`);

      // Refresh raw + self_rsvp so the slide-over and calendar grid update
      // immediately without waiting for the next background sync.
      const refreshed = await patchRes.json().catch(() => null);
      const master = seriesMasterId(evt);
      if (scope === "ALL" && master) {
        await admin
          .from("external_events")
          .update({ self_rsvp: responseStatus })
          .eq("account_id", evt.account_id)
          .eq("calendar_id", evt.calendar_id)
          .or(`id.eq.${eventId},recurring_event_id.eq.${master}`);
        if (refreshed) {
          await admin.from("external_events").update({ raw: refreshed }).eq("id", eventId);
        }
        await kickGoogleSync(account, evt.calendar_id, user.id, "event-rsvp-all-sync");
      } else {
        await admin
          .from("external_events")
          .update({ self_rsvp: responseStatus, ...(refreshed ? { raw: refreshed } : {}) })
          .eq("id", eventId)
          .eq("user_id", user.id);
      }

      await logSync("google", "event-rsvp", "ok", undefined, user.id);
      return json({ ok: true });
    }

    // ── This and following: end the series here, start a new one ─────────
    // What Google's own UI does — there is no API verb for it. From the
    // series' first occurrence nothing precedes it, so it is "all".
    const followingMaster = scope === "FOLLOWING" ? seriesMasterId(evt) : undefined;
    if (followingMaster && (action === "delete" || (!action && patch))) {
      const cal = encodeURIComponent(evt.calendar_id);
      const masterRes = await gFetch(account, `/calendars/${cal}/events/${encodeURIComponent(followingMaster)}`);
      if (!masterRes.ok) throw new Error(`fetch master: ${masterRes.status} ${await masterRes.text()}`);
      const master = await masterRes.json();
      if (master.organizer && master.organizer.self !== true) {
        const who = master.organizer.displayName || master.organizer.email || "the organizer";
        return json({
          error: `Only ${who} can change this and following events — change just this one, or all of them.`,
        }, 400);
      }
      const instance = (evt.raw ?? {}) as Record<string, unknown>;
      const current = { start_at: evt.start_at as string, end_at: evt.end_at as string };
      const probe = planGoogleSplit(master, instance, current, null, { timeZone });
      if (probe) {
        const count = rruleCount(master.recurrence ?? []);
        const remaining = count != null
          ? count - await countGoogleInstancesBefore(account, evt.calendar_id, followingMaster, probe.originalStartISO)
          : null;
        const plan = planGoogleSplit(master, instance, current, action === "delete" ? null : patch, { timeZone, remaining });
        if (!plan) throw new Error("couldn't split the series");

        let created: Record<string, unknown> | null = null;
        if (plan.tail) {
          const createRes = await gFetch(
            account,
            `/calendars/${cal}/events?sendUpdates=none${plan.tail.conferenceData ? "&conferenceDataVersion=1" : ""}`,
            { method: "POST", body: JSON.stringify(plan.tail) },
          );
          if (!createRes.ok) throw new Error(`create following: ${createRes.status} ${await createRes.text()}`);
          created = await createRes.json();
        }
        const headRes = await gFetch(account, `/calendars/${cal}/events/${encodeURIComponent(followingMaster)}`, {
          method: "PATCH",
          body: JSON.stringify({ recurrence: plan.headRecurrence }),
        });
        if (!headRes.ok) {
          // Take the new half back down rather than leave the following weeks twice.
          if (created?.id) {
            await gFetch(account, `/calendars/${cal}/events/${encodeURIComponent(String(created.id))}?sendUpdates=none`, {
              method: "DELETE",
            }).catch(() => {});
          }
          throw new Error(`end series: ${headRes.status} ${await headRes.text()}`);
        }
        const head = await headRes.json().catch(() => null);

        // New series first, keeping the open row; then the old one, whose
        // sweep takes the occurrences it no longer has.
        let event = null;
        if (created) {
          const startDelta = patch?.start_at ? Date.parse(patch.start_at) - Date.parse(evt.start_at) : 0;
          event = await materializeGoogleResource(account, evt.calendar_id, created, {
            rowId: eventId,
            anchorMs: Date.parse(plan.originalStartISO) + startDelta,
          });
        }
        if (head) await materializeGoogleResource(account, evt.calendar_id, head);
        await kickGoogleSync(account, evt.calendar_id, user.id, "event-following-sync");
        await logSync("google", action === "delete" ? "event-delete-following" : "event-writeback-following", "ok", undefined, user.id);
        return json({ ok: true, event });
      }
      scope = "ALL";
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
      // The same master lookup every other action uses (column, raw, id
      // pattern) — reading raw alone missed series whose raw lacked it.
      const recurringEventId = seriesMasterId(evt);
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
          .or(googleSeriesOrFilter(recurringEventId));
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
      const targetId = seriesMasterId(evt) ?? evt.provider_event_id;
      const nextRecurrence = patch.recurrence === null || (Array.isArray(patch.recurrence) && patch.recurrence.length === 0)
        ? []
        : (patch.recurrence as string[]);

      const gPatch: Record<string, unknown> = { recurrence: nextRecurrence };
      if (nextRecurrence.length) {
        // A series needs a zone. Nuvo-made events were written as bare UTC
        // instants, and Google refuses recurrence on those — anchor them to
        // the editor's zone, keeping the same instants.
        const masterRes = await gFetch(
          account,
          `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(targetId)}`,
        );
        if (!masterRes.ok) throw new Error(`fetch master: ${masterRes.status} ${await masterRes.text()}`);
        const master = await masterRes.json();
        const zone = timeZone ?? "UTC";
        if (master.start?.dateTime && !master.start?.timeZone) {
          gPatch.start = { dateTime: master.start.dateTime, timeZone: zone };
        }
        if (master.end?.dateTime && !master.end?.timeZone) {
          gPatch.end = { dateTime: master.end.dateTime, timeZone: zone };
        }
      }

      const res = await gFetch(
        account,
        `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(targetId)}`,
        { method: "PATCH", body: JSON.stringify(gPatch) },
      );
      if (!res.ok) throw new Error(`patch recurrence: ${res.status} ${await res.text()}`);

      // Store the series as Google now expands it, keeping the open row's id —
      // upserting the master here painted a phantom on the first date and,
      // when it took over the open row, made a later THIS edit hit the series.
      const updated = await res.json().catch(() => null);
      let event = null;
      if (updated) {
        event = await materializeGoogleResource(account, evt.calendar_id, updated, {
          rowId: eventId,
          anchorMs: new Date(evt.start_at).getTime(),
        });
      }
      await kickGoogleSync(account, evt.calendar_id, user.id, "event-recurrence-sync");

      await logSync("google", "event-recurrence", "ok", undefined, user.id);
      return json({ ok: true, event });
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
        if (patch.all_day !== undefined) {
          // Timed ↔ all-day is a type change on the master, not a time delta.
          // Shifting 9am to midnight and leaving dateTime in place kept the
          // series timed; converting the master's own civil date is the ALL act.
          const converted = patch.all_day
            ? masterToAllDay(master.start, master.end)
            : masterToTimed(master.start);
          gPatch.start = converted.start;
          gPatch.end = converted.end;
        } else {
          if (patch.start_at) {
            const delta =
              new Date(patch.start_at as string).getTime() - new Date(evt.start_at as string).getTime();
            const next = shiftGoogleDateResource(master.start, delta);
            if (next) gPatch.start = next;
            // Moving the series to another DAY moves the rule's days too —
            // shifting only the start left BYDAY=WE generating Wednesdays.
            const ruleZone = master.start?.timeZone ?? timeZone;
            if (Array.isArray(master.recurrence) && isUsableTimeZone(ruleZone)) {
              const day = (iso: string) => Date.parse(`${toIcalLocal(iso, ruleZone).replace(/^(\d{4})(\d{2})(\d{2}).*$/, "$1-$2-$3")}T00:00:00Z`);
              const dayDelta = Math.round((day(patch.start_at as string) - day(evt.start_at as string)) / 86_400_000);
              if (dayDelta) gPatch.recurrence = shiftRRuleDays(master.recurrence as string[], dayDelta);
            }
          }
          if (patch.end_at) {
            const delta =
              new Date(patch.end_at as string).getTime() - new Date(evt.end_at as string).getTime();
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
            account,
            `/calendars/${encodeURIComponent(evt.calendar_id)}/events/${encodeURIComponent(recurringEventId)}`,
            { method: "PATCH", body: JSON.stringify(gPatch) },
          );
          if (!res.ok) throw new Error(`patch master: ${res.status} ${await res.text()}`);
          after = (await res.json().catch(() => null)) ?? master;
        }

        // Instances are named by their original start, so moving the series
        // renames every one of them: re-read them and keep the open row's id.
        // The delta-shift stays as the fallback when that read fails.
        const startDelta = patch.start_at
          ? new Date(patch.start_at as string).getTime() - new Date(evt.start_at as string).getTime()
          : 0;
        const event = await materializeGoogleResource(account, evt.calendar_id, after, {
          rowId: eventId,
          anchorMs: new Date(evt.start_at as string).getTime() + startDelta,
        }).catch(async (e) => {
          await logSync("google", "event-writeback-all-instances", "error", String(e), user.id);
          await shiftLocalSeries(evt, recurringEventId, patch);
          return null;
        });
        await kickGoogleSync(account, evt.calendar_id, user.id, "event-writeback-all-sync");
        await logSync("google", "event-writeback-all", "ok", undefined, user.id);
        return json({ ok: true, event });
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
    // notes/location reflect the write without waiting for the next sync —
    // but only while the row still holds the times the client's write left it
    // at (`rowAt`). A newer edit owns the row by then, and this answer would
    // put the previous drag back on every screen (_shared/eventWriteback.ts).
    const updated = await res.json().catch(() => null);
    if (updated) {
      const mapped = mapGoogleEvent(account, evt.calendar_id, updated);
      const outcome = await rewriteMirrorRow(
        admin.from("external_events") as unknown as MirrorRowTable,
        eventId,
        {
          raw: updated,
          ...(mapped ? { all_day: mapped.all_day, start_at: mapped.start_at, end_at: mapped.end_at } : {}),
          ...(patch.location !== undefined ? { location: patch.location ?? null } : {}),
        },
        parseRowAt(body.rowAt),
      );
      if (outcome === "failed") {
        await logSync("google", "event-writeback-row", "error", "mirror row rewrite failed", user.id);
      }
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
