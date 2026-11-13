// The Week's Plan / Review — the weekly narrated companion. A "This week" kit
// Card at the top of the Week segment, with one act that opens the full
// surface full-screen, where you can walk ‹ › back to sealed Reviews of past
// weeks. Lifted out of the old Plan tab so it survives that tab's removal.

import { useEffect, useMemo, useState } from "react";
import { addDays, format, startOfWeek } from "date-fns";
import { toDateISO } from "../../lib/dates";
import { useWeekReport } from "../../hooks/useWeekReport";
import { isRevealReady, isAcknowledged, acknowledge as ackReveal, readRevealConfig } from "../../lib/weekReveal";
import { WeekPlanBody } from "../floors/WeekPlanFloor";
import { PlanWeekCard } from "./MobilePlanWeek";
import WeekStory from "../floors/WeekStory";
import WeekEmblem from "../floors/WeekEmblem";
import WeekArchiveGallery from "../floors/WeekArchiveGallery";
import { Button, Card, IconButton } from "../kit";
import { Icon } from "../Icon";
import { TouchButton } from "./touch";

function weekLabelOf(weekISO: string): string {
  const s = new Date(weekISO + "T00:00:00");
  const e = addDays(s, 6);
  return `${format(s, "MMM d")} – ${format(e, s.getMonth() === e.getMonth() ? "d" : "MMM d")}`;
}

export default function WeekPlanCard({ variant = "card" }: { variant?: "card" | "link" }) {
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

  if (variant === "link") {
    return (
      <div className="flex">
        <Button kind="ghost" size="sm" onClick={openSheet} trailing={<Icon name="chevron-right" size={14} />} className="tap-bloom -ml-2.5">
          {total > 0 ? `This week · ${report.landedCount} of ${total} landed` : "The week's plan"}
        </Button>
        {open && (
          <WeekPlanSheet currentWeekISO={currentWeekISO} now={now} onClose={() => setOpen(false)} storyFirst={reviewReady} />
        )}
      </div>
    );
  }

  // A review waiting is an invitation — the intent's colour, never --signal
  // (which is spent on "now"): the act turns primary and says what it opens.
  return (
    <div>
      <Card className="ph-card">
        <div className="flex items-center gap-3">
          <WeekEmblem spec={report.emblem} state="forming" size={40} hideAmbient />
          <div className="min-w-0 flex-1">
            <div className="truncate text-head font-semibold text-ink">{reviewReady ? "Review ready" : "This week"}</div>
            <div className="mt-0.5 truncate text-caption tabular-nums text-muted">
              {weekLabelOf(currentWeekISO)}
              {!reviewReady && total > 0 && ` · ${report.landedCount} of ${total} landed`}
            </div>
          </div>
          <TouchButton kind={reviewReady ? "primary" : "secondary"} compact onClick={openSheet} className="shrink-0">
            {reviewReady ? "Review" : "Open"}
          </TouchButton>
        </div>
      </Card>

      {open && <WeekPlanSheet currentWeekISO={currentWeekISO} now={now} onClose={() => setOpen(false)} storyFirst={reviewReady} />}
    </div>
  );
}

/**
 * The Week segment's companion pair with ONE primary per state (three identical
 * chevron cards used to fight the FAB for the same eye):
 *   review ready        → the Review card leads, planning demotes to a link;
 *   week not yet planned → Plan the week leads, the plan view is a link;
 *   week planned         → the week's plan card leads, adjusting is a link.
 */
export function WeekCompanions({ onOpenPlan }: { onOpenPlan: () => void }) {
  const now = useMemo(() => new Date(), []);
  const currentWeekISO = useMemo(() => toDateISO(startOfWeek(now, { weekStartsOn: 1 })), [now]);
  const report = useWeekReport(currentWeekISO, now);
  const reviewReady = isRevealReady(now, currentWeekISO, readRevealConfig()) && !isAcknowledged(currentWeekISO);
  const planned = report.priorityTotal > 0;

  if (reviewReady || planned) {
    return (
      <>
        <WeekPlanCard />
        <PlanWeekCard onOpen={onOpenPlan} variant="link" />
      </>
    );
  }
  return (
    <>
      <PlanWeekCard onOpen={onOpenPlan} />
      <WeekPlanCard variant="link" />
    </>
  );
}

/** The week's plan, full-screen — also the Calendar crown's door, so "the plan"
 *  opens the same surface wherever the phone offers it. */
export function WeekPlanSheet({
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
  const [galleryOpen, setGalleryOpen] = useState(false);
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
    <div className="mb-5 flex items-center gap-1 pt-safe">
      <IconButton label="Previous week" size="md" icon={<Icon name="chevron-left" size={18} />} onClick={() => walk(-7)} className="tap-icon shrink-0" />
      <IconButton
        label="Next week"
        size="md"
        icon={<Icon name="chevron-right" size={18} />}
        onClick={isCurrent ? undefined : () => walk(7)}
        disabled={isCurrent}
        className="tap-icon shrink-0"
      />
      <div className="min-w-0 flex-1 text-center">
        <div className="text-caption font-semibold text-muted">{isCurrent ? "This week" : "The Review"}</div>
        <div className="truncate text-head font-semibold tabular-nums text-ink">{weekLabelOf(viewedWeekISO)}</div>
      </div>
      <IconButton
        label="Browse your Reviews"
        size="md"
        icon={
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden>
            <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
            <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
            <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
            <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        }
        onClick={() => setGalleryOpen(true)}
        className="tap-icon shrink-0"
      />
      <IconButton label="Close" size="md" icon={<Icon name="close" size={18} />} onClick={onClose} className="tap-icon shrink-0" />
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-[var(--panel)]">
      <div className="px-4 fab-clear pt-3">
        {/* `tense` was never passed, so walking back to a sealed week still read
            "Where the hours are going" over a week that had finished. No
            `onOpenProject`: MobileShell doesn't mount the record overlay. */}
        <WeekPlanBody report={report} state={state} tense={isCurrent ? "current" : "past"} viewedWeekISO={viewedWeekISO} header={header} />
      </div>

      {galleryOpen && (
        <WeekArchiveGallery
          onClose={() => setGalleryOpen(false)}
          onSelectWeek={(iso) => {
            setViewedWeekISO(iso);
            setMode("detail");
            setGalleryOpen(false);
          }}
        />
      )}
    </div>
  );
}
