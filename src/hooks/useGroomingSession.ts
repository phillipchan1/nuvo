// One grooming session, not one nudge per project. `needy` is exactly the set
// `ProjectReadinessStrip` / `InitiativeReadinessStrip` already compute — this
// hook only gives that existing, honest count a second thing it can do: bundle
// every ungroomed item into ONE inbox capture, with an opt-in "block time this
// week" that finds a real open gap rather than ever guessing one (Principle 6).
// Self-contained (kind-only input) so the desktop strips and the mobile Groom
// header can mount the same action and never disagree about what needs shaping.

import { useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { useVertical } from "./useVertical";
import { useTaskMutations } from "./useTasks";
import { useSettings } from "./useSettings";
import { useWorkingDays } from "./useWorkingDays";
import { useExternalEvents } from "./useCalendar";
import { useScheduledTasks } from "./useTasks";
import { useSlots } from "./useSlots";
import { lensGaps } from "../lib/lenses";
import { isProjectInFlight, type Project, type Initiative } from "../lib/vertical";
import { planningWeekStartISO, parseDateISO, todayISO, endOf } from "../lib/dates";
import { readDay, toBusyBlocks, type BusyBlock } from "../lib/now";
import { span } from "../components/mobile/dayPlan";

const GROOM_DURATION_MINS = 30;
const WORK_START_DEFAULT = 480;
const WORK_END_DEFAULT = 990;

export interface GroomingNeedyItem {
  id: string;
  name: string;
  gapLabel: string;
}

export interface GroomingSlot {
  dayISO: string;
  startISO: string;
  endISO: string;
  /** "Thu 9–9:30am" — the app's one clock spelling (`span`/`at` in mobile/dayPlan). */
  label: string;
}

export function useGroomingSession(kind: "project" | "initiative") {
  const { data, applySchedule, ensureWeek } = useVertical();
  const { create } = useTaskMutations();
  const { settings } = useSettings();
  const [workingDays] = useWorkingDays();

  const now = useMemo(() => new Date(), []);

  const needy = useMemo<GroomingNeedyItem[]>(() => {
    const items =
      kind === "project"
        ? data.projects.filter((p) => isProjectInFlight(p.status))
        : data.initiatives.filter((i) => isProjectInFlight(i.status));
    const result: GroomingNeedyItem[] = [];
    for (const item of items as (Project | Initiative)[]) {
      const gaps = lensGaps(data, kind, item, now);
      if (gaps.length > 0) result.push({ id: item.id, name: item.name, gapLabel: gaps[0].label });
    }
    return result;
  }, [data, kind, now]);

  const weekStartISO = data.sprint?.week_start ?? planningWeekStartISO(now);
  const range = useMemo(() => {
    const start = parseDateISO(weekStartISO);
    return { start: start.toISOString(), end: addDays(start, 7).toISOString() };
  }, [weekStartISO]);

  const { data: events = [] } = useExternalEvents(range.start, range.end);
  const { data: blocks = [] } = useScheduledTasks(range.start, range.end);
  const { data: slots = [] } = useSlots(range.start, range.end);

  const hiddenCals = useMemo(() => new Set(settings?.hidden_calendar_ids ?? []), [settings]);
  const hiddenEventKeys = useMemo(
    () => new Set((settings?.hidden_events ?? []).map((h) => h.key)),
    [settings],
  );

  const previewSlot = useMemo<GroomingSlot | null>(() => {
    const eventBusy = toBusyBlocks(events, blocks, hiddenCals, hiddenEventKeys);
    // toBusyBlocks doesn't fold in slots (a slot child task carries no
    // start_time of its own) — map the sittings in by hand, same shape.
    const slotBusy: BusyBlock[] = slots
      .filter((s) => s.start_time)
      .map((s) => ({
        title: s.title,
        start: new Date(s.start_time),
        end: endOf({ start_time: s.start_time, duration_minutes: s.duration_minutes }),
        kind: "block",
      }));
    const busy = [...eventBusy, ...slotBusy];

    const workStartMin = settings?.work_start_minutes ?? WORK_START_DEFAULT;
    const workEndMin = settings?.work_end_minutes ?? WORK_END_DEFAULT;
    const weekStart = parseDateISO(weekStartISO);
    const todayStr = todayISO(now);

    for (let i = 0; i < 7; i++) {
      const day = addDays(weekStart, i);
      const dayISO = todayISO(day);
      if (dayISO < todayStr) continue;
      if (!workingDays.includes(day.getDay())) continue;

      const dayStart = new Date(day);
      dayStart.setHours(0, 0, 0, 0);
      const windowStart = new Date(dayStart.getTime() + workStartMin * 60000);
      const windowEnd = new Date(dayStart.getTime() + workEndMin * 60000);

      const read = readDay(now, busy, windowStart, windowEnd);
      const gap = read.gaps.find((g) => g.mins >= GROOM_DURATION_MINS);
      if (gap) {
        const end = new Date(gap.start.getTime() + GROOM_DURATION_MINS * 60000);
        return {
          dayISO,
          startISO: gap.start.toISOString(),
          endISO: end.toISOString(),
          label: `${format(gap.start, "EEE")} ${span(gap.start, end)}`,
        };
      }
    }
    return null;
  }, [events, blocks, slots, hiddenCals, hiddenEventKeys, settings, workingDays, weekStartISO, now]);

  const [scheduleOn, setScheduleOn] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<"idle" | "done" | "error">("idle");

  const commit = async () => {
    if (needy.length === 0) return;
    setCommitting(true);
    setResult("idle");
    try {
      const noun = kind === "project" ? "project" : "initiative";
      const title = `Groom ${needy.length} ${noun}${needy.length === 1 ? "" : "s"}: ${needy
        .map((n) => n.name)
        .join(", ")}`;
      const notes = needy.map((n) => `${n.name} — ${n.gapLabel}`).join("\n");
      const task = await create({ title, notes });

      if (scheduleOn && previewSlot) {
        const sprintId = await ensureWeek();
        await applySchedule(
          [
            {
              id: task.id,
              doDateISO: previewSlot.dayISO,
              startISO: previewSlot.startISO,
              durationMins: GROOM_DURATION_MINS,
            },
          ],
          { sprintId },
        );
      }
      setResult("done");
    } catch {
      setResult("error");
    } finally {
      setCommitting(false);
    }
  };

  return { needy, previewSlot, scheduleOn, setScheduleOn, commit, committing, result };
}
