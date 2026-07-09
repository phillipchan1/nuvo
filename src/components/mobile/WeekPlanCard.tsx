// The Week's Plan / Review — the weekly narrated companion. A "This week" hero
// (used atop the Now screen); tap to open the full surface full-screen, where
// you can walk ‹ › back to sealed Reviews of past weeks. Lifted out of the old
// Plan tab so it survives that tab's removal.

import { useMemo, useState } from "react";
import { addDays, format, startOfWeek } from "date-fns";
import { toDateISO } from "../../lib/dates";
import { useWeekReport } from "../../hooks/useWeekReport";
import { WeekPlanBody } from "../floors/WeekPlanFloor";
import WeekStory from "../floors/WeekStory";
import WeekEmblem from "../floors/WeekEmblem";

function weekLabelOf(weekISO: string): string {
  const s = new Date(weekISO + "T00:00:00");
  const e = addDays(s, 6);
  return `${format(s, "MMM d")} – ${format(e, s.getMonth() === e.getMonth() ? "d" : "MMM d")}`;
}

export default function WeekPlanCard() {
  const now = useMemo(() => new Date(), []);
  const currentWeekISO = useMemo(() => toDateISO(startOfWeek(now, { weekStartsOn: 1 })), [now]);
  const report = useWeekReport(currentWeekISO, now);
  const [open, setOpen] = useState(false);
  const total = report.priorityTotal;

  return (
    <div>
      <button
        onClick={() => setOpen(true)}
        className="tap fast flex w-full items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-3 text-left active:bg-surface"
      >
        <WeekEmblem spec={report.emblem} state="forming" size={48} hideAmbient />
        <div className="min-w-0 flex-1">
          <div className="section-label !p-0">This week</div>
          <div className="truncate text-head font-semibold text-ink">{weekLabelOf(currentWeekISO)}</div>
          <div className="truncate text-caption text-muted">
            {total > 0 ? `${report.landedCount} of ${total} priorities landed` : "Set what matters most"}
          </div>
        </div>
        <span className="shrink-0 text-muted">›</span>
      </button>

      {open && <WeekPlanSheet currentWeekISO={currentWeekISO} now={now} onClose={() => setOpen(false)} />}
    </div>
  );
}

function WeekPlanSheet({ currentWeekISO, now, onClose }: { currentWeekISO: string; now: Date; onClose: () => void }) {
  const [viewedWeekISO, setViewedWeekISO] = useState(currentWeekISO);
  const [mode, setMode] = useState<"story" | "detail">("story");
  const report = useWeekReport(viewedWeekISO, now);
  const isCurrent = viewedWeekISO === currentWeekISO;
  const state = isCurrent ? "forming" : ("sealed" as const);
  const walk = (deltaDays: number) =>
    setViewedWeekISO((iso) => {
      const next = toDateISO(addDays(new Date(iso + "T00:00:00"), deltaDays));
      return next > currentWeekISO ? currentWeekISO : next;
    });

  // The recap opens full-screen by default (the received moment); "See the full
  // week" drops into the detailed view — same as desktop.
  if (mode === "story") {
    return (
      <div className="fixed inset-0 z-[60]">
        <WeekStory report={report} state={state} weekLabel={weekLabelOf(viewedWeekISO)} onClose={onClose} onSeeDetail={() => setMode("detail")} />
      </div>
    );
  }

  const header = (
    <div className="mb-5 flex items-center gap-2 pt-safe">
      <button onClick={() => walk(-7)} className="tap fast flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-surface-2" aria-label="Previous week">‹</button>
      <button onClick={isCurrent ? undefined : () => walk(7)} disabled={isCurrent} className="tap fast flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-surface-2 disabled:opacity-30" aria-label="Next week">›</button>
      <div className="min-w-0 flex-1 text-center">
        <div className="section-label !p-0">{isCurrent ? "This week" : "The Review"}</div>
        <div className="masthead text-head text-ink">{weekLabelOf(viewedWeekISO)}</div>
      </div>
      <button onClick={onClose} className="tap fast flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-surface-2" aria-label="Close">✕</button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto" style={{ background: "color-mix(in srgb, var(--bg) 96%, transparent)", backdropFilter: "blur(20px)" }}>
      <div className="px-4 pb-24 pt-3">
        <WeekPlanBody report={report} state={state} viewedWeekISO={viewedWeekISO} header={header} />
      </div>
    </div>
  );
}
