import type { Context } from "hono";
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
} from "../../supabase/functions/_shared/dayShape.ts";
import { OPEN_CORS, json } from "./cors.ts";
import { requireStore, type AppEnv } from "./session.ts";

const DEFAULT_WORK_START = 480;
const DEFAULT_WORK_END = 990;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function resolveTz(raw: string | null): string {
  if (!raw) return FALLBACK_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    return FALLBACK_TZ;
  }
}

export async function handleDay(c: Context<AppEnv>): Promise<Response> {
  if (c.req.method === "OPTIONS") return new Response("ok", { headers: OPEN_CORS });
  if (c.req.method !== "GET") return json({ error: "Method not allowed" }, 405, OPEN_CORS);

  const got = await requireStore(c);
  if ("error" in got) return got.error;
  const store = got.store;
  const url = new URL(c.req.url);
  const tz = resolveTz(url.searchParams.get("tz"));
  const today = todayIn(tz);
  const date = url.searchParams.get("date") ?? today;
  if (!DATE_RE.test(date)) return json({ error: "date must be YYYY-MM-DD" }, 400, OPEN_CORS);

  const now = new Date();
  const nowMs = now.getTime();
  const rangeStart = new Date(`${date}T00:00:00Z`).getTime() - 86_400_000;
  const rangeEnd = rangeStart + 3 * 86_400_000;
  const startISO = new Date(rangeStart).toISOString();
  const endISO = new Date(rangeEnd).toISOString();

  const [events, scheduled, slots, settingsRows] = await Promise.all([
    store.sql`
      SELECT id, title, start_at, end_at, all_day, busy, location, calendar_id, account_id, provider_event_id, recurring_event_id
      FROM external_events
      WHERE user_id = ${store.userId}
        AND start_at < ${endISO}
        AND end_at > ${startISO}
    ` as Promise<Record<string, unknown>[]>,
    store.sql`
      SELECT id, title, status, do_date, start_time, duration_minutes, deadline, priority, notes, roll_count
      FROM tasks
      WHERE user_id = ${store.userId}
        AND start_time IS NOT NULL
        AND status IN ('planned', 'done')
        AND start_time >= ${startISO}
        AND start_time < ${endISO}
    ` as Promise<Record<string, unknown>[]>,
    store.sql`
      SELECT id, title, do_date, start_time, duration_minutes, project_id, domain_id
      FROM slots
      WHERE user_id = ${store.userId}
        AND start_time >= ${startISO}
        AND start_time < ${endISO}
      ORDER BY start_time
    ` as Promise<Record<string, unknown>[]>,
    store.sql`
      SELECT work_start_minutes, work_end_minutes, hidden_calendar_ids, hidden_events
      FROM user_settings
      WHERE user_id = ${store.userId}
      LIMIT 1
    ` as Promise<Record<string, unknown>[]>,
  ]);

  const settings = settingsRows[0] ?? null;
  const visibility = makeEventVisibility(settings);
  const dayEvents = events
    .filter((e) => !visibility.hiddenCalendars.has(String(e.calendar_id ?? "")) && !visibility.isEventHidden(e))
    .map((e) => fmtEvent(e, date, nowMs, tz));
  const dayTasks = scheduled.map((t) => fmtTask(t, date, nowMs, tz));
  const slotIds = slots.map((r) => String(r.id));
  const slotChildren = slotIds.length
    ? ((await store.sql`
        SELECT id, title, status, slot_id
        FROM tasks
        WHERE user_id = ${store.userId}
          AND slot_id = ANY(${slotIds})
          AND status <> 'trashed'
        ORDER BY sort_order
      `) as Record<string, unknown>[])
    : [];
  const slotSummaries = buildSlotSummaries(slots, slotChildren, tz, nowMs);
  const schedule = buildDaySchedule(dayEvents, dayTasks, slotSummaries, date);
  const openWindows = computeOpenWindows(dayEvents, dayTasks, slotSummaries, date, nowMs, tz);
  const workStart = Number(settings?.work_start_minutes ?? DEFAULT_WORK_START);
  const workEnd = Number(settings?.work_end_minutes ?? DEFAULT_WORK_END);
  const windowStartMs = zonedInstant(date, workStart, tz);
  const windowEndMs = zonedInstant(date, workEnd, tz);
  const isToday = date === today;
  const refNowMs = isToday ? Math.max(nowMs, windowStartMs) : windowStartMs;
  const openMins = openMinutes(
    openSpans(busyIntervalsFor(dayEvents, dayTasks, slotSummaries, date), windowStartMs, windowEndMs, refNowMs),
  );
  const isBygone = date < today;
  const readout = dayReadout({
    busyCount: schedule.length,
    openMins,
    isPast: isToday && nowMs >= windowEndMs,
    isBygone,
  });

  return json(
    {
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
    },
    200,
    OPEN_CORS,
  );
}
