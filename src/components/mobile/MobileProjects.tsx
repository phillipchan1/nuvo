// The Projects tab — the phone's echo of the desktop project On Deck. Read-first:
// it shows the demand-phased timeline (which projects want which of the next few
// weeks, where a week pinches, how many weeks of ready work are stocked) and a
// demand-ranked list of in-flight projects with their readiness. Tapping a
// project opens its detail Sheet, where changing status/dates re-times the board
// — the mobile stand-in for the desktop drag-to-week. The "All" segment reaches
// backlog/complete projects the On Deck view (in-flight only) leaves out.

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { useCapacity } from "../../hooks/useCapacity";
import { readOnDeck, type OnDeckLane, type ReadyTier } from "../../lib/onDeck";
import { PROJECT_STATUS_COLORS } from "../floors/parts";
import { READY } from "../floors/ReadinessBanner";
import { Row, Empty, VerticalList } from "./detail/verticalDetail";

// Readiness ramp — one color per tier so a wall of rows sorts itself by eye.
const TIER_COLOR: Record<ReadyTier, string> = {
  ready: READY,
  grooming: PROJECT_STATUS_COLORS.waiting,
  raw: "var(--line-strong)",
  parked: "var(--muted)",
  done: READY,
};

const SEG_KEY = "nuvo-mobile-projects-seg";
type Seg = "ondeck" | "all";

const fmtWk = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
function weekColLabel(idx: number, weekStart: Date): string {
  if (idx === 0) return "This week";
  if (idx === 1) return "Next week";
  return `Wk ${fmtWk(weekStart)}`;
}

function readyText(l: OnDeckLane): string {
  if (l.readyTier === "done") return "Done";
  if (l.readyTier === "parked") return "Parked";
  if (l.readyTier === "ready") return "Ready";
  if (l.readyTier === "raw") return "Raw";
  return `${l.readyCount}/3`;
}

/** The subtitle line — where it stands: the due/pace read plus the top gap. */
function laneSubtitle(l: OnDeckLane): string {
  const bits: string[] = [];
  if (l.project.targetDate) {
    const dt = new Date(l.project.targetDate + "T00:00:00");
    const dl = l.pace.daysLeft;
    if (l.pace.read === "overdue") bits.push(`overdue ${l.pace.driftDays ?? 0}d`);
    else bits.push(`due ${dl != null && dl >= 0 && dl <= 6 ? format(dt, "EEE") : format(dt, "MMM d")}`);
  } else {
    bits.push("no finish line");
  }
  if (l.gaps.length) bits.push(l.gaps.map((g) => g.label).join(" · "));
  else if (l.axes.fits === false) bits.push("won't fit the week");
  return bits.join(" · ");
}

export default function MobileProjects({
  onOpenItem,
}: {
  onOpenItem: (kind: "project" | "initiative" | "domain", id: string) => void;
}) {
  const store = useVertical();
  const d = store.data;
  const { byWeek, weeklyAvgMins } = useCapacity();
  const now = useMemo(() => new Date(), []);
  const board = useMemo(() => readOnDeck(d, byWeek, weeklyAvgMins, now, 3, false), [d, byWeek, weeklyAvgMins, now]);

  const [seg, setSegState] = useState<Seg>(() => {
    try {
      const v = localStorage.getItem(SEG_KEY);
      return v === "all" ? "all" : "ondeck";
    } catch {
      return "ondeck";
    }
  });
  const setSeg = (s: Seg) => {
    setSegState(s);
    try {
      localStorage.setItem(SEG_KEY, s);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="pb-24">
      <SegHeader seg={seg} setSeg={setSeg} />

      {seg === "all" ? (
        <VerticalList
          d={d}
          lens="projects"
          onOpenProject={(id) => onOpenItem("project", id)}
          onOpenInitiative={(id) => onOpenItem("initiative", id)}
          onOpenDomain={(id) => onOpenItem("domain", id)}
        />
      ) : (
        <>
          {/* Horizon strip — capacity vs demand across the next 3 weeks. */}
          <div className="flex gap-2 px-4 pt-4">
            {board.weeks.map((w) => (
              <div
                key={w.idx}
                className={`flex-1 rounded-xl border p-2.5 ${w.over ? "border-signal/50" : "border-line"} bg-surface-2`}
              >
                <div className="section-label !p-0 truncate">{weekColLabel(w.idx, w.weekStart)}</div>
                <div className="mono mt-1 text-head font-semibold" style={{ color: w.over ? "var(--signal)" : "var(--ink)" }}>
                  {w.demandBlocks}
                  <span className="text-caption text-muted"> / {w.blocks}</span>
                </div>
                <div className="text-micro text-muted">blocks</div>
              </div>
            ))}
          </div>

          {/* The pinch — the first week over capacity, in the steward voice. */}
          {board.pinch && (
            <div className="mx-4 mt-3 rounded-xl border border-signal/40 bg-signal-soft px-3 py-2.5">
              <div className="text-caption text-ink">{board.pinch.line}</div>
              {board.pinch.culprits.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {board.pinch.culprits.slice(0, 4).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => onOpenItem("project", p.id)}
                      className="tap fast rounded-full border border-line bg-surface px-2.5 py-1 text-meta font-medium text-muted active:text-accent"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Coverage — weeks of ready work stocked against a typical week. */}
          <div className="mono px-4 pt-3 text-caption text-muted">
            ≈{board.coverageWeeks} {board.coverageWeeks === 1 ? "week" : "weeks"} of ready work stocked
          </div>

          {/* Demand-ranked lanes — most urgent first (see readOnDeck). */}
          <div className="mt-2">
            {board.lanes.length === 0 ? (
              <Empty>Nothing in flight. Start a project from “All”, or capture one with ＋.</Empty>
            ) : (
              board.lanes.map((l) => (
                <Row
                  key={l.project.id}
                  onClick={() => onOpenItem("project", l.project.id)}
                  chevron
                  leading={<span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TIER_COLOR[l.readyTier] }} />}
                  title={l.project.name}
                  subtitle={laneSubtitle(l)}
                  meta={
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <ReadyMeter count={l.readyCount} tier={l.readyTier} />
                      <span className="mono text-micro text-muted">{readyText(l)}</span>
                    </span>
                  }
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

// A 3-segment definition-of-ready meter (Defined · Planned · Fits).
function ReadyMeter({ count, tier }: { count: number; tier: ReadyTier }) {
  return (
    <span className="flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-3 rounded-full"
          style={{ background: i < count ? TIER_COLOR[tier] : "var(--line)" }}
        />
      ))}
    </span>
  );
}

function SegHeader({ seg, setSeg }: { seg: Seg; setSeg: (s: Seg) => void }) {
  const items: { id: Seg; label: string }[] = [
    { id: "ondeck", label: "On Deck" },
    { id: "all", label: "All" },
  ];
  return (
    <div className="sticky top-0 z-10 flex gap-1 border-b border-line bg-surface/90 px-3 py-2 backdrop-blur">
      {items.map((t) => {
        const on = seg === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setSeg(t.id)}
            className={`tap fast flex flex-1 items-center justify-center rounded-lg py-1.5 text-body font-medium ${
              on ? "bg-accent text-white" : "text-muted active:bg-surface-2"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
