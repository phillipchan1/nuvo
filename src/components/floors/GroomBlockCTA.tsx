// "Find time to groom" — the suggestive fix on the Readiness floor. Everything in
// Nuvo flows through timeblocks, so the on-brand way to raise readiness is to put
// a grooming session on the calendar: it picks the ripest to-groom item, estimates
// the work, finds the next open slot in your work window, and shows the projected
// gain ("Readiness 25 → 31"). One tap drops a block; undo from the toast.

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { addDays, format, isSameDay, startOfDay } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { useSettings } from "../../hooks/useSettings";
import { useExternalEvents, useHiddenEvents } from "../../hooks/useCalendar";
import { useScheduledTasks, useTaskMutations } from "../../hooks/useTasks";
import { readStanding, scoreFromParts } from "../../lib/standing";
import { projectedFloorShaped } from "../../lib/readiness";
import { readTending, type Ripeness } from "../../lib/tending";
import { readDay, toBusyBlocks, fmtMins, type BusyBlock } from "../../lib/now";
import { toDateISO } from "../../lib/dates";

// Rough time to groom one item to ready, by how far it has to climb. Tunable.
const GROOM_MINS: Record<Ripeness, number> = { raw: 40, shaped: 30, scaffolded: 20, active: 15, resting: 20 };

const HORIZON_DAYS = 7;

/** First open span ≥ estMins across the next week's work windows, or null. */
function findSlot(busy: BusyBlock[], workStart: number, workEnd: number, now: Date, estMins: number): Date | null {
  for (let d = 0; d < HORIZON_DAYS; d++) {
    const base = startOfDay(addDays(now, d));
    const ws = new Date(base); ws.setHours(0, workStart, 0, 0);
    const we = new Date(base); we.setHours(0, workEnd, 0, 0);
    const from = d === 0 ? (now > ws ? now : ws) : ws;
    if (from >= we) continue;
    const gap = readDay(from, busy, ws, we).gaps.find((g) => g.mins >= estMins);
    if (gap) return gap.start;
  }
  return null;
}

export default function GroomBlockCTA({ kind, now = new Date() }: { kind: "project" | "initiative"; now?: Date }) {
  const { data } = useVertical();
  const { settings } = useSettings();
  const { keys: hiddenKeys } = useHiddenEvents();
  const { create, trash } = useTaskMutations();
  const [busyState, setBusyState] = useState(false);

  const rangeStart = startOfDay(now).toISOString();
  const rangeEnd = addDays(startOfDay(now), HORIZON_DAYS).toISOString();
  const { data: events = [] } = useExternalEvents(rangeStart, rangeEnd);
  const { data: scheduled = [] } = useScheduledTasks(rangeStart, rangeEnd);

  const plan = useMemo(() => {
    const top = readTending(data, now).groomable.find((c) => c.kind === kind);
    if (!top) return null;
    const s = readStanding(data, kind, now);
    const current = scoreFromParts(s.defined, s.capacity, s.motionMoving, s.inFlight);
    const projShaped = projectedFloorShaped(data, kind, new Set([top.id]));
    const projected = scoreFromParts(projShaped, s.capacity, s.motionMoving, s.inFlight);
    const mins = GROOM_MINS[top.ripeness.stage];
    const busy = toBusyBlocks(events, scheduled, settings?.hidden_calendar_ids ?? [], hiddenKeys);
    const slot = findSlot(busy, settings?.work_start_minutes ?? 480, settings?.work_end_minutes ?? 990, now, mins);
    return { top, current, projected, mins, slot };
  }, [data, kind, events, scheduled, settings, hiddenKeys, now]);

  if (!plan || plan.projected <= plan.current) return null;
  const { top, current, projected, mins, slot } = plan;

  const slotLabel = slot
    ? isSameDay(slot, now) ? `today ${format(slot, "h:mm a")}` : format(slot, "EEE h:mm a")
    : null;

  const schedule = async () => {
    if (busyState) return;
    setBusyState(true);
    try {
      const task = await create({
        title: `Groom: ${top.name}`,
        do_date: toDateISO(slot ?? now),
        start_time: slot ? slot.toISOString() : null,
        duration_minutes: mins,
        project_id: kind === "project" ? top.id : null,
        initiative_id: kind === "initiative" ? top.id : null,
      });
      toast.success(
        slot ? `Blocked ${fmtMins(mins)} ${slotLabel} to groom ${top.name}` : `Added ${fmtMins(mins)} to groom ${top.name}`,
        { action: { label: "Undo", onClick: () => trash(task) } },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't schedule grooming");
    } finally {
      setBusyState(false);
    }
  };

  return (
    <button
      onClick={schedule}
      disabled={busyState}
      className="fast group mb-6 flex w-full max-w-[640px] items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-left hover:border-accent/50 active:scale-[.99] disabled:opacity-60"
    >
      <span className="text-lead leading-none text-accent" aria-hidden>✦</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-medium text-ink">
          {slot ? `Find ${fmtMins(mins)} to groom ${top.name}` : `Plan ${fmtMins(mins)} to groom ${top.name}`}
        </div>
        <div className="truncate text-caption text-muted">
          {slot ? <>blocks {slotLabel} · </> : <>no open slot this week · </>}
          Readiness <span className="mono">{current}</span> → <span className="mono text-accent">{projected}</span>
        </div>
      </div>
      <span className="fast shrink-0 text-muted transition-transform group-hover:translate-x-0.5">→</span>
    </button>
  );
}
