/**
 * GET /functions/v1/day?date=YYYY-MM-DD&tz=America/Los_Angeles
 *
 * One day, already shaped. The answer to "what's on, and how much room is left"
 * for a single date, composed on the server and rendered verbatim by whoever
 * asked.
 *
 * **Why this exists.** Nuvo's day rules — what counts as busy, which events a
 * user can see, how much of a working window is unclaimed, the words a day is
 * described in — live in `_shared/dayShape.ts` and are imported by the SPA and
 * by the agent. A watchOS app cannot import either: watchOS has no web view, so
 * not one line of `src/` is reachable from it. Re-deriving those rules in Swift
 * would be a *third* runtime of the same logic, which is exactly the drift the
 * planning kernel exists to prevent.
 *
 * So the client computes nothing. It asks, and renders what it gets:
 * `timeRange` and `readout` arrive pre-formatted in the caller's zone and must
 * be shown as-is. A client that re-derives a time from the ISO fields has
 * reintroduced the bug.
 *
 * Deliberately NOT `buildContext`. That builds an eleven-query, ±7-day snapshot
 * for a language model; this is one date for a glance, and a wrist cannot wait
 * on the former.
 *
 * `asOf` is not decoration: any surface that caches this (a lock-screen widget,
 * a watch complication) has to be able to say how old it is, because a glance
 * that looks live when it's hours stale is the Principle 7 failure.
 */

import { admin, handleOptions, json, requireUser } from "../_shared/admin.ts";
import {
  buildDaySchedule,
  buildSlotSummaries,
  busyIntervalsFor,
  computeOpenWindows,
  dayReadout,
  FALLBACK_TZ,
  fmtEvent,
  fmtTask,
  makeEventVisibility,
  openMinutes,
  openSpans,
  todayIn,
  zonedInstant,
} from "../_shared/dayShape.ts";

/** Defaults match `user_settings` (migration 5): 8:00 → 16:30. */
const DEFAULT_WORK_START = 480;
const DEFAULT_WORK_END = 990;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A zone we can't resolve is a wrong day, not a small formatting slip — fall
 *  back loudly rather than silently answering about somewhere else. */
function resolveTz(raw: string | null): string {
  if (!raw) return FALLBACK_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    console.warn(`[day] unknown tz "${raw}" — falling back to ${FALLBACK_TZ}`);
    return FALLBACK_TZ;
  }
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const tz = resolveTz(url.searchParams.get("tz"));
    const today = todayIn(tz);
    const date = url.searchParams.get("date") ?? today;
    if (!DATE_RE.test(date)) {
      return json({ error: "date must be YYYY-MM-DD" }, 400);
    }

    const now = new Date();
    const nowMs = now.getTime();

    // A generous UTC window around the local date, then filtered by localDate.
    // Deriving exact UTC bounds from a zone is the fragile way to do this; the
    // shared builders already filter on the local date, so a day of slack on
    // each side is both correct and cheap.
    const rangeStart = new Date(`${date}T00:00:00Z`).getTime() - 86_400_000;
    const rangeEnd = rangeStart + 3 * 86_400_000;
    const startISO = new Date(rangeStart).toISOString();
    const endISO = new Date(rangeEnd).toISOString();

    const [eventsRes, scheduledRes, slotsRes, settingsRes] = await Promise.all([
      admin
        .from("external_events")
        .select(
          // `busy` matters: an event marked free is on the day but must not eat
          // the open hours (the toBusyBlocks rule).
          "id, title, start_at, end_at, all_day, busy, location, calendar_id, account_id, provider_event_id, recurring_event_id",
        )
        .eq("user_id", user.id)
        .lt("start_at", endISO)
        .gt("end_at", startISO),
      admin
        .from("tasks")
        .select(
          "id, title, status, do_date, start_time, duration_minutes, deadline, priority, notes, roll_count",
        )
        .eq("user_id", user.id)
        .not("start_time", "is", null)
        .in("status", ["planned", "done"])
        .gte("start_time", startISO)
        .lt("start_time", endISO),
      admin
        .from("slots")
        .select("id, title, do_date, start_time, duration_minutes, project_id, domain_id")
        .eq("user_id", user.id)
        .gte("start_time", startISO)
        .lt("start_time", endISO)
        .order("start_time"),
      admin
        .from("user_settings")
        .select("work_start_minutes, work_end_minutes, hidden_calendar_ids, hidden_events")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    for (const r of [eventsRes, scheduledRes, slotsRes, settingsRes]) {
      if (r.error) throw new Error(r.error.message);
    }

    // Hidden is out of the ledger — the same rule the phone and the agent apply.
    const visibility = makeEventVisibility(settingsRes.data);
    const events = (eventsRes.data ?? [])
      .filter((e) => !visibility.hiddenCalendars.has(e.calendar_id as string) && !visibility.isEventHidden(e))
      .map((e) => fmtEvent(e, date, nowMs, tz));
    const scheduled = (scheduledRes.data ?? []).map((t) => fmtTask(t, date, nowMs, tz));

    const slotRows = (slotsRes.data ?? []) as Record<string, unknown>[];
    const slotChildren = slotRows.length
      ? ((
          await admin
            .from("tasks")
            .select("id, title, status, slot_id")
            .eq("user_id", user.id)
            .in("slot_id", slotRows.map((r) => r.id as string))
            .neq("status", "trashed")
            .order("sort_order")
        ).data ?? [])
      : [];
    const slots = buildSlotSummaries(slotRows, slotChildren, tz, nowMs);

    const schedule = buildDaySchedule(events, scheduled, slots, date);
    const openWindows = computeOpenWindows(events, scheduled, slots, date, nowMs, tz);

    // How much room the day has — the work-window question, which is a different
    // one from "what fits between two meetings" (see dayShape's header). The
    // phone answers it through `readDay`; this is the same math, so the two
    // surfaces cannot describe one day differently.
    const workStart = (settingsRes.data?.work_start_minutes as number | null) ?? DEFAULT_WORK_START;
    const workEnd = (settingsRes.data?.work_end_minutes as number | null) ?? DEFAULT_WORK_END;
    const windowStartMs = zonedInstant(date, workStart, tz);
    const windowEndMs = zonedInstant(date, workEnd, tz);
    const isToday = date === today;
    // On a future day the whole window is ahead of you; on today it starts now.
    const refNowMs = isToday ? Math.max(nowMs, windowStartMs) : windowStartMs;
    const openMins = openMinutes(
      openSpans(busyIntervalsFor(events, scheduled, slots, date), windowStartMs, windowEndMs, refNowMs),
    );

    const isBygone = date < today;
    const readout = dayReadout({
      busyCount: schedule.length,
      openMins,
      isPast: isToday && nowMs >= windowEndMs,
      isBygone,
    });

    return json({
      date,
      isToday,
      isBygone,
      nowLabel: new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      }).format(now),
      readout: readout.text,
      readoutAccent: readout.accent,
      openMinutes: openMins,
      schedule,
      openWindows,
      asOf: now.toISOString(),
    });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[day]", msg);
    return json({ error: msg }, 500);
  }
});
