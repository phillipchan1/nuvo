// On Deck — the grooming hub. A demand-phased timeline of the in-flight projects
// across the next few weeks, drawn as a Gantt table: a project column + one
// column per week (each headed with its demand-vs-capacity), a bar per project
// positioned by its start→finish weeks and labelled with its due date, the pinch
// week tinted, and coarse moves (Push · Park · Cut) + the gap-closing lens chips
// inline on tap. The footer's guided pass walks every gapped project through,
// demand-first. Reads readOnDeck (docs/on-deck.md, docs/grooming-lenses.md §9A);
// the moves reuse the Capacity run's mutations.

import { useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { useCapacity } from "../../hooks/useCapacity";
import { domainById, type VerticalData } from "../../lib/vertical";
import { readOnDeck, BLOCK_MINS, type LaneState, type OnDeckLane } from "../../lib/onDeck";
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

const toBlocks = (mins: number) => Math.round(mins / BLOCK_MINS);
const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtWk = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const TINT = `color-mix(in srgb, ${CAUTION} 9%, transparent)`;

// The left-column status line — the readiness verdict, in the state's color.
function statusOf(l: OnDeckLane): { text: string; color: string } {
  switch (l.state) {
    case "ready": {
      const b = toBlocks(l.pace.remainingMins);
      return { text: b >= 2 ? `ready · ~${b} blocks` : "ready", color: READY };
    }
    case "needs_shaping":
      return { text: "needs shaping", color: CAUTION };
    case "stalled":
      return { text: l.pace.read === "overdue" ? `overdue · ${l.pace.driftDays ?? 0}d late` : "stalled", color: CAUTION };
    case "idea":
      return { text: "no finish line", color: "var(--muted)" };
    default:
      return { text: "parked", color: "var(--muted)" };
  }
}

// The label that rides inside the bar — the due date, warned when it needs work.
function barLabel(l: OnDeckLane): string | null {
  if (l.state === "idea") return "idea";
  if (!l.project.targetDate) return null;
  const d = new Date(l.project.targetDate + "T00:00:00");
  const dl = l.pace.daysLeft;
  const when = dl != null && dl >= 0 && dl <= 6 ? format(d, "EEE") : format(d, "MMM d");
  const warn = l.state === "needs_shaping" || l.pace.read === "overdue";
  return `${warn ? "⚠ " : ""}due ${when}`;
}

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
  // project column + one flexible column per week
  const cols = `minmax(132px, 1.2fr) repeat(${H}, minmax(0, 1fr))`;
  const weekCols = `repeat(${H}, minmax(0, 1fr))`;

  const needShaping = board.lanes.filter((l) => l.gaps.length > 0).length;

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

  return (
    <div className="pb-28">
      {/* header — title + the count eyebrow (mockup: "4 projects · 2 need shaping") */}
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-lead masthead leading-none">On deck · next {H} weeks</h1>
        <span className="shrink-0 text-caption text-muted">
          {board.lanes.length} project{board.lanes.length === 1 ? "" : "s"}
          {needShaping > 0 && <> · {needShaping} need shaping</>}
        </span>
      </div>

      {board.pinch && (
        <div
          className="mt-4 rounded-xl border px-4 py-3"
          style={{ borderColor: `color-mix(in srgb, ${CAUTION} 45%, var(--line))`, background: `color-mix(in srgb, ${CAUTION} 8%, transparent)` }}
        >
          <div className="section-label !p-0 flex items-center gap-1.5" style={{ color: CAUTION }}>
            <span aria-hidden>⚠</span> The pinch
          </div>
          <p className="mt-1 text-body leading-relaxed text-ink/90">{board.pinch.line}</p>
        </div>
      )}

      {board.lanes.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-line glass-card px-5 py-9 text-center" style={{ boxShadow: "var(--shadow-2)" }}>
          <div className="text-[28px]" style={{ color: "var(--accent)" }}>✓</div>
          <p className="mt-2 text-body text-muted">Nothing in flight on deck. Commit a project with a finish line and it shows up here.</p>
        </div>
      ) : (
        <>
          {/* the Gantt table — scrolls inside its own frame on a phone, body never does */}
          <div className="mt-5 overflow-x-auto">
            <div className="min-w-[520px] overflow-hidden rounded-xl border border-line glass-card">
              {/* column headers: project | each week's demand-vs-capacity */}
              <div className="grid border-b border-line" style={{ gridTemplateColumns: cols }}>
                <div className="section-label !p-0 self-end px-3.5 py-2.5">project</div>
                {board.weeks.map((w) => (
                  <div key={w.idx} className="border-l border-line px-3 py-2" style={{ background: w.over ? TINT : undefined }}>
                    <div className="flex items-center gap-1 text-caption font-medium text-ink">
                      {w.idx === 0 ? "This week" : w.idx === 1 ? "Next week" : `Week of ${fmtWk(w.weekStart)}`}
                      {w.over && <span style={{ color: CAUTION }} aria-hidden>⚠</span>}
                    </div>
                    <div className="mono text-micro" style={{ color: w.over ? CAUTION : "var(--muted)" }}>
                      {w.over ? `over by ${Math.max(1, w.demandBlocks - w.blocks)}` : `${w.demandBlocks} of ${w.blocks} blocks`}
                    </div>
                  </div>
                ))}
              </div>

              {/* one row per project */}
              {board.lanes.map((l) => {
                const st = statusOf(l);
                const isOpen = openId === l.project.id;
                const dot = domainById(data, l.project.domainId)?.color ?? "var(--accent)";
                const color = STATE_COLOR[l.state];
                const isIdea = l.state === "idea";
                const start = isIdea ? H - 1 : l.startWeekIdx;
                const end = isIdea ? H - 1 : l.dueWeekIdx ?? H - 1;
                const extendsBeyond = !isIdea && l.dueWeekIdx == null && l.state !== "parked";
                const single = start === end;
                const label = barLabel(l);
                const fillPct = l.state === "needs_shaping" ? 20 : 32;

                return (
                  <div key={l.project.id} className="border-t border-line first:border-t-0">
                    <button
                      onClick={() => setOpenId(isOpen ? null : l.project.id)}
                      className="tap fast block w-full text-left hover:bg-accent-soft"
                    >
                      <div className="relative">
                        {/* background cells — tint + vertical gridlines */}
                        <div className="grid" style={{ gridTemplateColumns: cols }}>
                          <div className="min-w-0 px-3.5 py-3">
                            <div className="flex items-center gap-2">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
                              <span className="truncate text-body text-ink">{l.project.name}</span>
                            </div>
                            <div className="mono mt-0.5 pl-4 text-micro" style={{ color: st.color }}>{st.text}</div>
                          </div>
                          {board.weeks.map((w) => (
                            <div key={w.idx} className="border-l border-line" style={{ background: w.over ? TINT : undefined }} />
                          ))}
                        </div>

                        {/* bar overlay — positioned over the week columns only */}
                        <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: cols }}>
                          <div />
                          <div className="grid items-center px-1.5" style={{ gridColumn: `2 / span ${H}`, gridTemplateColumns: weekCols }}>
                            <div
                              className="flex h-7 items-center overflow-hidden rounded-md px-2 text-micro font-medium"
                              style={{
                                gridColumn: `${start + 1} / ${end + 2}`,
                                justifyContent: single ? "center" : "flex-end",
                                background: isIdea ? "transparent" : `color-mix(in srgb, ${color} ${fillPct}%, var(--surface))`,
                                border: isIdea
                                  ? `1.5px dashed ${color}`
                                  : l.state === "needs_shaping"
                                    ? `1.5px solid ${color}`
                                    : "none",
                                color: isIdea ? "var(--muted)" : `color-mix(in srgb, ${color} 72%, var(--ink))`,
                                boxShadow: extendsBeyond ? `4px 0 0 -1px ${color}` : "none",
                                opacity: l.state === "parked" ? 0.5 : 1,
                              }}
                            >
                              {label}
                            </div>
                          </div>
                        </div>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="flex flex-wrap gap-1.5 px-3.5 pb-3">
                        {/* gap-specific lens chips route straight into the lens that closes it */}
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
          </div>

          {/* footer — the guided pass + the runway metric, de-emphasised */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-micro text-muted">Tap a project to shape or move it · {board.coverageWeeks} weeks stocked</span>
            {shapeQueue.length > 0 ? (
              <button
                onClick={() => onStart(shapeQueue)}
                className="tap fast rounded-xl px-5 py-2.5 text-body font-medium text-white active:scale-[.98]"
                style={{ background: "var(--accent)" }}
              >
                Shape the {shapeQueue.length} that need it →
              </button>
            ) : (
              <span className="text-caption text-muted">Everything on deck is ready.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
