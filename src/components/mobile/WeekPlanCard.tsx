// The Week's Plan / Review — the weekly narrated companion. A "This week" hero
// (used atop the Now screen); tap to open the full surface full-screen, where
// you can walk ‹ › back to sealed Reviews of past weeks. Lifted out of the old
// Plan tab so it survives that tab's removal.

import { useEffect, useMemo, useState } from "react";
import { addDays, format, startOfWeek } from "date-fns";
import { toDateISO } from "../../lib/dates";
import { useWeekReport } from "../../hooks/useWeekReport";
import { isRevealReady, isAcknowledged, acknowledge as ackReveal, readRevealConfig } from "../../lib/weekReveal";
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
  const reviewReady = isRevealReady(now, currentWeekISO, readRevealConfig()) && !isAcknowledged(currentWeekISO);

  const openSheet = () => {
    if (reviewReady) ackReveal(currentWeekISO);
    setOpen(true);
  };

  return (
    <div>
      <button
        onClick={openSheet}
        className={`tap fast flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left active:bg-surface ${
          reviewReady ? "border-[color:var(--signal)] bg-surface-2" : "border-line bg-surface-2"
        }`}
        style={reviewReady ? { boxShadow: "0 0 0 3px color-mix(in srgb, var(--signal) 18%, transparent)" } : undefined}
      >
        <WeekEmblem spec={report.emblem} state="forming" size={48} hideAmbient />
        <div className="min-w-0 flex-1">
          <div className="section-label !p-0">{reviewReady ? "Review ready" : "This week"}</div>
          <div className="masthead truncate text-head text-ink">{weekLabelOf(currentWeekISO)}</div>
          <div className="truncate text-caption text-muted">
            {reviewReady
              ? report.find
                ? "Your week left a pattern"
                : "Your week is ready to receive"
              : total > 0
                ? `${report.landedCount} of ${total} landed`
                : "Nothing on this week yet"}
          </div>
        </div>
        {reviewReady && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--signal)" }} />}
        <span className="shrink-0 text-muted">›</span>
      </button>

      {open && <WeekPlanSheet currentWeekISO={currentWeekISO} now={now} onClose={() => setOpen(false)} storyFirst={reviewReady} />}
    </div>
  );
}

function WeekPlanSheet({
  currentWeekISO,
  now,
  onClose,
  storyFirst = true,
}: {
  currentWeekISO: string;
  now: Date;
  onClose: () => void;
  storyFirst?: boolean;
}) {
  const [viewedWeekISO, setViewedWeekISO] = useState(currentWeekISO);
  const [mode, setMode] = useState<"story" | "detail">(storyFirst ? "story" : "detail");
  const report = useWeekReport(viewedWeekISO, now);
  const isCurrent = viewedWeekISO === currentWeekISO;
  const state = isCurrent ? "forming" : ("sealed" as const);
  const walk = (deltaDays: number) =>
    setViewedWeekISO((iso) => {
      const next = toDateISO(addDays(new Date(iso + "T00:00:00"), deltaDays));
      return next > currentWeekISO ? currentWeekISO : next;
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  if (mode === "story") {
    return (
      <div className="fixed inset-0 z-[60]">
        <WeekStory report={report} state={state} weekLabel={weekLabelOf(viewedWeekISO)} onClose={onClose} onSeeDetail={() => setMode("detail")} />
      </div>
    );
  }

  const header = (
    <div className="mb-5 flex items-center gap-2 pt-safe">
      <button onClick={() => walk(-7)} className="tap fast flex h-11 w-11 items-center justify-center rounded-full text-muted active:bg-surface-2" aria-label="Previous week">‹</button>
      <button onClick={isCurrent ? undefined : () => walk(7)} disabled={isCurrent} className="tap fast flex h-11 w-11 items-center justify-center rounded-full text-muted active:bg-surface-2 disabled:opacity-30" aria-label="Next week">›</button>
      <div className="min-w-0 flex-1 text-center">
        <div className="section-label !p-0">{isCurrent ? "This week" : "The Review"}</div>
        <div className="masthead text-head text-ink">{weekLabelOf(viewedWeekISO)}</div>
      </div>
      <button onClick={onClose} className="tap fast flex h-11 w-11 items-center justify-center rounded-full text-muted active:bg-surface-2" aria-label="Close">✕</button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto" style={{ background: "color-mix(in srgb, var(--bg) 96%, transparent)", backdropFilter: "blur(20px)" }}>
      <div className="px-4 pb-24 pt-3">
        {/* `tense` was never passed, so walking back to a sealed week still read
            "Where the hours are going" over a week that had finished. No
            `onOpenProject`: MobileShell doesn't mount the record overlay. */}
        <WeekPlanBody report={report} state={state} tense={isCurrent ? "current" : "past"} viewedWeekISO={viewedWeekISO} header={header} />
      </div>
    </div>
  );
}
