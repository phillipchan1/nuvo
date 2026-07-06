// On Deck — the grooming hub. A demand-phased timeline of the in-flight projects
// across the next few weeks: capacity per week, a bar per project positioned by
// its finish line, the pinch called out, and the coarse moves (Push · Park ·
// Cut) inline. Each lane NAMES its readiness gap (the lens router) and routes
// straight into the lens that closes it — Brief (what) or Path (how) — and the
// footer's guided pass walks every gapped project through, demand-first.
// Renders inside the Groom flow's Scaffold. Reads readOnDeck (docs/on-deck.md,
// docs/grooming-lenses.md §9A); the moves reuse the Capacity run's mutations.

import { useMemo, useState } from "react";
import { addDays } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { useCapacity } from "../../hooks/useCapacity";
import { domainById, type VerticalData } from "../../lib/vertical";
import { readOnDeck, type LaneState, type OnDeckLane } from "../../lib/onDeck";
import { LENS_LABEL, type LensRef } from "../../lib/lenses";
import { PROJECT_STATUS_COLORS } from "../floors/parts";
import { READY } from "../floors/ReadinessBanner";

const CAUTION = PROJECT_STATUS_COLORS.waiting; // the one caution amber

const STATE_COLOR: Record<LaneState, string> = {
  ready: READY,
  needs_shaping: CAUTION,
  stalled: CAUTION,
  idea: "var(--line-strong)",
  parked: "var(--muted)",
};
const STATE_LABEL: Record<LaneState, string> = {
  ready: "ready",
  needs_shaping: "needs shaping",
  stalled: "stalled",
  idea: "no finish line",
  parked: "parked",
};

const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtWk = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

export default function OnDeckTimeline({
  data,
  onStart,
}: {
  data: VerticalData;
  onStart: (refs: LensRef[]) => void;
}) {
  const store = useVertical();
  const { byWeek, weeklyAvgMins } = useCapacity();
  const now = useMemo(() => new Date(), []);
  const board = useMemo(() => readOnDeck(data, byWeek, weeklyAvgMins, now), [data, byWeek, weeklyAvgMins, now]);
  const [openId, setOpenId] = useState<string | null>(null);

  const H = board.horizonWeeks;
  const cols = `repeat(${H}, minmax(0,1fr))`;

  // the guided pass — every gapped project, already in the board's demand order
  const shapeQueue: LensRef[] = board.lanes
    .filter((l) => l.gaps.length > 0)
    .map((l) => ({ kind: "project", id: l.project.id }));

  const push = (l: OnDeckLane) => {
    const base = l.project.targetDate ? new Date(l.project.targetDate + "T00:00:00") : now;
    store.updateProject(l.project.id, { targetDate: toISO(addDays(base, 7)) });
  };
  const park = (l: OnDeckLane) => store.updateProject(l.project.id, { status: "waiting" });
  const cut = (l: OnDeckLane) => store.updateProject(l.project.id, { status: "cancelled" });

  if (board.lanes.length === 0) {
    return (
      <div className="pt-3 pb-28">
        <Hero coverage={board.coverageWeeks} horizon={H} />
        <div className="mt-8 rounded-2xl border border-line glass-card px-5 py-9 text-center" style={{ boxShadow: "var(--shadow-2)" }}>
          <div className="text-[28px]" style={{ color: "var(--accent)" }}>✓</div>
          <p className="mt-2 text-body text-muted">Nothing in flight on deck. Commit a project with a finish line and it shows up here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-3 pb-28">
      <Hero coverage={board.coverageWeeks} horizon={H} />

      {board.pinch && (
        <div
          className="mt-4 rounded-xl border px-4 py-3"
          style={{ borderColor: `color-mix(in srgb, ${CAUTION} 45%, var(--line))`, background: `color-mix(in srgb, ${CAUTION} 8%, transparent)` }}
        >
          <div className="section-label !p-0" style={{ color: CAUTION }}>The pinch</div>
          <p className="mt-1 text-body leading-relaxed text-ink/90">{board.pinch.line}</p>
        </div>
      )}

      {/* capacity header — aligned to the same week columns as the bars */}
      <div className="mt-6 grid gap-1.5" style={{ gridTemplateColumns: cols }}>
        {board.weeks.map((w) => (
          <div key={w.idx} className="text-center">
            <div className="text-micro text-muted">{w.idx === 0 ? "This week" : w.idx === 1 ? "Next week" : fmtWk(w.weekStart)}</div>
            <div className="mono text-caption" style={{ color: w.over ? CAUTION : "var(--muted)" }}>
              {w.blocks} blk{w.over ? " · over" : ""}
            </div>
          </div>
        ))}
      </div>

      {/* lanes */}
      <div className="mt-2 space-y-0.5">
        {board.lanes.map((l) => {
          const color = STATE_COLOR[l.state];
          const dot = domainById(data, l.project.domainId)?.color ?? "var(--accent)";
          const start = l.startWeekIdx;
          const end = l.dueWeekIdx ?? H - 1;
          const extendsBeyond = l.dueWeekIdx == null && l.state !== "idea";
          const isOpen = openId === l.project.id;
          return (
            <div key={l.project.id} className="rounded-lg px-1.5 py-2 hover:bg-accent-soft">
              <button
                onClick={() => setOpenId(isOpen ? null : l.project.id)}
                className="tap fast flex w-full items-center justify-between gap-2 text-left"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
                  <span className="truncate text-caption">{l.project.name}</span>
                </span>
                {/* the gap, named — the hub's routing made legible (§4) */}
                <span className="mono shrink-0 text-micro" style={{ color }}>
                  {l.gaps.length > 0 ? l.gaps.map((g) => g.label).join(" · ") : STATE_LABEL[l.state]}
                </span>
              </button>

              {/* the bar track — a grid over the week columns */}
              <div className="mt-1.5 grid items-center gap-1.5" style={{ gridTemplateColumns: cols, minHeight: 10 }}>
                <span
                  className="h-2.5 self-center rounded-full"
                  style={{
                    gridColumn: `${start + 1} / ${end + 2}`,
                    background: l.state === "idea" ? "transparent" : color,
                    border: l.state === "idea" ? `1px dashed ${color}` : "none",
                    opacity: l.state === "parked" ? 0.4 : 1,
                    boxShadow: extendsBeyond ? `4px 0 0 -1px ${color}` : "none",
                  }}
                />
              </div>

              {isOpen && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {/* gap-specific lens chips replace the old flat "Shape →" */}
                  {l.gaps.map((g) => (
                    <button
                      key={g.lens}
                      onClick={() => onStart([{ kind: "project", id: l.project.id, lens: g.lens }])}
                      className="tap fast rounded-lg px-3.5 py-2 text-caption font-medium text-white active:scale-[.98]"
                      style={{ background: "var(--accent)" }}
                      title={g.label}
                    >
                      {LENS_LABEL[g.lens]} →
                    </button>
                  ))}
                  {l.project.targetDate && (
                    <button onClick={() => push(l)} className="tap fast rounded-lg border border-line px-3.5 py-2 text-caption text-muted hover:text-ink active:scale-[.98]">
                      Push a week
                    </button>
                  )}
                  {l.state !== "parked" && (
                    <button
                      onClick={() => park(l)}
                      className="tap fast rounded-lg px-3.5 py-2 text-caption font-medium active:scale-[.98]"
                      style={{ background: `color-mix(in srgb, ${CAUTION} 14%, transparent)`, color: CAUTION }}
                    >
                      Park
                    </button>
                  )}
                  <button onClick={() => cut(l)} className="tap fast rounded-lg border border-line px-3.5 py-2 text-caption text-muted hover:text-ink active:scale-[.98]">
                    Cut
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {shapeQueue.length > 0 ? (
        <button
          onClick={() => onStart(shapeQueue)}
          className="tap fast mt-6 w-full rounded-xl py-3 text-body font-medium text-white active:scale-[.98]"
          style={{ background: "var(--accent)" }}
        >
          Groom the {shapeQueue.length} that need it →
        </button>
      ) : (
        <p className="mt-6 text-center text-caption text-muted">Everything on deck is ready — {board.coverageWeeks} weeks stocked.</p>
      )}
    </div>
  );
}

function Hero({ coverage, horizon }: { coverage: number; horizon: number }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <div className="section-label">On deck · next {horizon} weeks</div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="text-display masthead leading-none">{coverage}</span>
          <span className="text-head text-muted">weeks stocked</span>
        </div>
      </div>
    </div>
  );
}
