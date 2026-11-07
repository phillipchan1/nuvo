// The week, repaired in place — the phone's face (docs/plan-the-week-v2.md §8).
//
// Same repairs as the desktop bar (useWeekRepair), same acts and dial
// (useRepairs), by tap: one card per broken block above the Calendar, **Take it**
// in one tap, **Other times** opens the composer's other fits as rows, ✕ leaves
// it. Nothing renders when the week holds.

import { useMemo, useState } from "react";
import { startOfWeek } from "date-fns";
import { useExternalEvents } from "../../hooks/useCalendar";
import { useScheduledTasks, useTaskMutations } from "../../hooks/useTasks";
import { useSlotMutations, useSlots } from "../../hooks/useSlots";
import { useSettings } from "../../hooks/useSettings";
import { useWorkingDays } from "../../hooks/useWorkingDays";
import { useWeekRepair, type Repair } from "../../hooks/useWeekRepair";
import { instantOf, useRepairs } from "../plan/RepairBar";
import { toDateISO } from "../../lib/dates";
import { at } from "./dayPlan";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function MobileRepairCard({ now }: { now: Date }) {
  const range = useMemo(() => {
    const s = startOfWeek(now, { weekStartsOn: 1 });
    return { start: s.toISOString(), end: new Date(s.getTime() + 7 * 86_400_000).toISOString() };
    // the week only changes on Monday — key it by the week's start
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toDateISO(startOfWeek(now, { weekStartsOn: 1 }))]);
  const { data: events = [] } = useExternalEvents(range.start, range.end);
  const { data: tasks = [] } = useScheduledTasks(range.start, range.end);
  const { data: slots = [] } = useSlots(range.start, range.end);
  const { settings } = useSettings();
  const [workingDays] = useWorkingDays();
  const mutations = useTaskMutations();
  const slotMutations = useSlotMutations();
  const hiddenCalendarIds = useMemo(() => settings?.hidden_calendar_ids ?? [], [settings]);
  const hiddenEventKeys = useMemo(() => (settings?.hidden_events ?? []).map((h) => h.key), [settings]);
  const repairs = useWeekRepair({
    tasks,
    events,
    slots,
    hiddenCalendarIds,
    hiddenEventKeys,
    workStartMin: settings?.work_start_minutes ?? 480,
    workEndMin: settings?.work_end_minutes ?? 990,
    workingDays,
    now,
    enabled: true,
  });
  const acts = useMemo(
    () => ({
      apply: (r: Repair, start: Date) => {
        if (r.kind === "task" && r.task) {
          const task = r.task;
          const was = new Date(task.start_time!);
          mutations.block(task, start, r.from.durationMin);
          return () => mutations.block(task, was, r.from.durationMin);
        }
        const slot = r.slot!;
        const before = { start_time: slot.start_time, do_date: slot.do_date };
        slotMutations.updateSlot({ id: slot.id, patch: { start_time: start.toISOString(), do_date: toDateISO(start) } });
        return () => slotMutations.updateSlot({ id: slot.id, patch: before });
      },
    }),
    [mutations, slotMutations],
  );
  const r = useRepairs(repairs, acts);
  const [open, setOpen] = useState<string | null>(null);

  if (!r.staged.length && !r.applied.length && !(r.dial === "ask" && r.open.length)) return null;

  return (
    <div className="flex flex-col gap-2 px-3 pb-2 pt-1">
      {r.dial === "ask" && !r.asked && r.open.length > 0 && (
        <div className="glass-card flex items-center justify-between gap-2 rounded-[14px] border border-line p-3">
          <span className="text-caption text-muted">{r.open.length} broke · nothing moved</span>
          <button className="tap rounded-full bg-accent px-3 text-caption text-on-accent" onClick={() => r.setAsked(true)}>
            Re-plan
          </button>
        </div>
      )}
      {r.staged.map((x) => {
        const i = r.ix[x.key] ?? 0;
        const o = x.options[i];
        const s = instantOf(o.dayISO, o.startMin);
        return (
          <div key={x.key} className="glass-card flex flex-col gap-1 rounded-[14px] border border-line p-3">
            <div className="flex items-center gap-2 text-caption">
              <span className="text-accent">{x.why === "missed" ? "◌" : "↯"}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">{x.title}</span>
              <button aria-label="Leave it" className="tap-icon text-muted" onClick={() => r.leave(x)}>
                ✕
              </button>
            </div>
            <div className="masthead text-display">
              → {DAY[s.getDay()]} {at(s)}
            </div>
            <div className="flex gap-2 pt-1">
              <button className="tap flex-1 rounded-[10px] bg-accent font-semibold text-on-accent" onClick={() => r.take(x)}>
                Take it
              </button>
              <button className="tap flex-1 rounded-[10px] border border-line-strong" onClick={() => setOpen((k) => (k === x.key ? null : x.key))}>
                Other times
              </button>
            </div>
            {open === x.key &&
              x.options.map((alt, j) => {
                const st = instantOf(alt.dayISO, alt.startMin);
                return (
                  <button
                    key={j}
                    className="tap flex items-center justify-between border-b border-line text-left text-body"
                    onClick={() => {
                      r.cycle(x, j - i);
                      setOpen(null);
                    }}
                  >
                    <span>
                      {DAY[st.getDay()]} {at(st)}
                    </span>
                    <span className="text-caption text-muted">{j === i ? "chosen" : "›"}</span>
                  </button>
                );
              })}
          </div>
        );
      })}
      {r.applied.map((a, i) => (
        <div key={a.key} className="flex items-center justify-between gap-2 px-1 text-caption">
          <span className="min-w-0 truncate">✓ {a.label}</span>
          <button className="tap-icon text-muted" onClick={() => r.undo(i)}>
            Undo
          </button>
        </div>
      ))}
    </div>
  );
}
