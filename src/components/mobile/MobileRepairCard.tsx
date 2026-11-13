// The week, repaired in place — the phone's face (docs/plan-the-week-v2.md §8).
//
// Same repairs as the desktop bar (useWeekRepair), same acts and dial
// (useRepairs), by tap: one card per broken block above the Calendar, **Take it**
// in one tap, **Other times** opens the composer's other fits as rows, ✕ leaves
// it. Nothing renders when the week holds.

import { Button, Card, IconButton } from "../kit";
import { Icon } from "../Icon";
import { TouchButton } from "./touch";
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
    <div className="flex flex-col gap-2 px-4 pb-2 pt-2">
      {r.dial === "ask" && !r.asked && r.open.length > 0 && (
        <Card className="ph-card !flex items-center justify-between gap-2">
          <span className="text-body text-muted">
            <b className="font-semibold text-ink tabular-nums">{r.open.length}</b> broke · nothing moved
          </span>
          <TouchButton kind="primary" compact onClick={() => r.setAsked(true)}>
            Re-plan
          </TouchButton>
        </Card>
      )}
      {r.staged.map((x) => {
        const i = r.ix[x.key] ?? 0;
        const o = x.options[i];
        const s = instantOf(o.dayISO, o.startMin);
        return (
          <Card key={x.key} className="ph-card">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-body font-semibold">
                {x.title}
                <span className="font-normal text-muted"> · {x.why === "missed" ? "missed" : `${x.event} landed on it`}</span>
              </span>
              <IconButton
                label="Leave it"
                size="md"
                icon={<Icon name="close" size={16} />}
                onClick={() => r.leave(x)}
                className="tap-icon -mr-2 shrink-0"
              />
            </div>
            {/* Where it would go — the card's one figure, not a second hero. */}
            <div className="ph-stat">
              {DAY[s.getDay()]} {at(s)}
            </div>
            <div className="flex gap-2">
              <TouchButton kind="primary" full onClick={() => r.take(x)}>
                Take it
              </TouchButton>
              <TouchButton full active={open === x.key} onClick={() => setOpen((k) => (k === x.key ? null : x.key))}>
                Other times
              </TouchButton>
            </div>
            {open === x.key && (
              <div className="ph-rows">
                {x.options.map((alt, j) => {
                  const st = instantOf(alt.dayISO, alt.startMin);
                  return (
                    <button
                      key={j}
                      type="button"
                      className="ph-row row-hover"
                      aria-pressed={j === i}
                      onClick={() => {
                        r.cycle(x, j - i);
                        setOpen(null);
                      }}
                    >
                      <span className="ph-row-label" data-grow="">
                        {DAY[st.getDay()]} {at(st)}
                      </span>
                      {j === i ? (
                        <Icon name="check" size={18} className="shrink-0 text-accent" />
                      ) : (
                        <Icon name="chevron-right" size={16} className="ph-row-chev" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
      {r.applied.map((a, i) => (
        <div key={a.key} className="flex min-h-11 items-center justify-between gap-2 text-body">
          <span className="flex min-w-0 items-center gap-2">
            <Icon name="check" size={16} className="shrink-0 text-accent" />
            <span className="truncate">{a.label}</span>
          </span>
          <Button kind="ghost" size="md" className="tap-icon shrink-0" onClick={() => r.undo(i)}>
            Undo
          </Button>
        </div>
      ))}
    </div>
  );
}
