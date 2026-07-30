// The pool rail — the shared left column of every *planner* surface (the
// Schedule's LeftRail, the project deck, the initiative deck). Every one of those
// surfaces is the same act at a different clock speed: a pool of unclaimed things
// on the left, a grid of time on the right, and you drag from one into the other.
// So the pool wears one shape everywhere:
//
//   crown   — readiness, in the EXECUTION voice: a tracked-caps eyebrow, one mono
//             count, one thin meter, and a gap line that names the first debt and
//             vanishes when clean (the WeekPanel pattern, generalized).
//   pool    — the loose items, scrolling.
//   foot    — the "+ new" pill, floating out of the hierarchy (mirrors the rail's
//             capture pill and the mobile ＋ FAB).
//
// It is STRUCTURE, not an object: full height, transparent so the one warm-paper
// atmosphere reads straight through it, separated from the grid by a single
// hairline. Never a floating panel — the things that float are the things you pick
// up, and if the container floats too, nothing reads as graspable.

import { useMemo, type ReactNode } from "react";

// The rail is the SAME rail at every altitude, so it wears the width you set on
// the Schedule (LeftRail persists it here) — switching rungs must not move the
// edge between the pool and the grid. Read once at mount; the decks and the
// Schedule are never on screen together, so there's nothing to keep in sync.
const RAIL_WIDTH_KEY = "nuvo-rail-width";
const DEFAULT_RAIL_WIDTH = 360;
const MIN_RAIL_WIDTH = 240;
const MAX_RAIL_WIDTH = 560;

function sharedRailWidth(): number {
  try {
    const v = Number(localStorage.getItem(RAIL_WIDTH_KEY));
    if (Number.isFinite(v) && v >= MIN_RAIL_WIDTH && v <= MAX_RAIL_WIDTH) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_RAIL_WIDTH;
}

/** The readiness crown: "5 of 9 ready" + the one gap that's still open. */
export interface RailCrown {
  /** tracked-caps identity line — the horizon this rail plans ("NEXT 4 WEEKS"). */
  eyebrow: string;
  /** the scoreboard: `done` of `total` `noun` ("5 of 9 ready"). */
  done: number;
  total: number;
  noun: string;
  /** the one debt owed to the floor below — hidden entirely when clean. */
  gap?: { label: string; detail?: string; onJump: () => void } | null;
  /** the crown itself is the doorway to the play that moves the meter (Groom). */
  onOpen?: () => void;
  openTitle?: string;
}

export default function PlannerRail({
  crown,
  poolLabel,
  poolCount,
  over,
  dropAttr,
  footLabel,
  onFoot,
  footTitle,
  children,
}: {
  crown: RailCrown;
  /** the section label over the loose items ("Needs a sprint"). */
  poolLabel: string;
  poolCount: number;
  /** a drag is hovering the rail — releasing here un-claims the item's time. */
  over?: boolean;
  /** the hit-test attribute the surface's drag tracker looks for. */
  dropAttr: "data-pool-drop" | "data-inbox-drop";
  footLabel: string;
  onFoot: () => void;
  footTitle?: string;
  children: ReactNode;
}) {
  const pct = crown.total > 0 ? (crown.done / crown.total) * 100 : 0;
  const width = useMemo(sharedRailWidth, []);

  return (
    <aside
      {...{ [dropAttr]: "" }}
      className="fast relative z-10 flex h-full shrink-0 flex-col border-r border-line"
      style={
        // Dropping into the pool RELEASES time, so the receptive wash is --slot
        // (open / unclaimed) — never an opaque fill over the atmosphere.
        over
          ? {
              width,
              background: "color-mix(in srgb, var(--slot) 10%, transparent)",
              boxShadow: "inset 0 0 0 1.5px color-mix(in srgb, var(--slot) 55%, transparent)",
            }
          : { width }
      }
    >
      {/* ── the crown — readiness, execution voice ───────────────────────────── */}
      <div className="shrink-0 border-b border-line-strong px-3 pb-3 pt-2">
        <CrownFace crown={crown} pct={pct} />
        {crown.gap && (
          <button
            onClick={crown.gap.onJump}
            className="fast tap mt-2.5 flex w-full items-center gap-2 border-t border-line pt-2.5 text-left"
          >
            <span className="shrink-0 text-caption text-muted">{crown.gap.label}</span>
            {crown.gap.detail && (
              <span className="min-w-0 flex-1 truncate text-caption" style={{ color: "var(--accent)" }}>
                — {crown.gap.detail}
              </span>
            )}
            <span className="ml-auto shrink-0 text-micro text-muted">›</span>
          </button>
        )}
      </div>

      {/* ── the pool ─────────────────────────────────────────────────────────────
          An EMPTY pool centres its one line in the space it owns rather than
          stranding it under the label with a rail-height void beneath — an empty
          drop target should read as open room, not as an unfinished panel. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-3">
        <div className="section-label !px-1 pt-2.5">
          {poolLabel} · {poolCount}
        </div>
        <div className={poolCount === 0 ? "flex flex-1 flex-col justify-center" : ""}>{children}</div>
      </div>

      {/* ── the foot pill — a persistent action, out of the hierarchy ─────────── */}
      <div className="shrink-0 border-t border-line p-2.5">
        <button
          onClick={onFoot}
          title={footTitle ?? footLabel}
          className="tap fast w-full rounded-full border border-line-strong px-3 py-2 text-center text-caption font-medium text-muted hover:border-accent hover:text-accent"
        >
          ＋ {footLabel}
        </button>
      </div>
    </aside>
  );
}

function CrownFace({ crown, pct }: { crown: RailCrown; pct: number }) {
  const face = (
    <div className="min-w-0 flex-1">
      <div className="section-label !px-0 !pb-0" style={{ color: "var(--accent)" }}>
        {crown.eyebrow}
      </div>
      {crown.total === 0 ? (
        <div className="mt-1 text-body text-muted">Nothing on the board yet</div>
      ) : (
        <div className="mt-1.5 flex items-center gap-2.5">
          <span className="shrink-0 text-body">
            <span className="mono font-medium text-ink">{crown.done}</span>
            <span className="text-muted"> of </span>
            <span className="mono font-medium text-ink">{crown.total}</span>
            <span className="text-muted"> {crown.noun}</span>
          </span>
          <span className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
            <span
              className="block h-full rounded-full"
              style={{ width: `${pct}%`, background: "var(--accent)" }}
            />
          </span>
        </div>
      )}
    </div>
  );

  if (!crown.onOpen) return <div className="flex w-full items-start gap-2">{face}</div>;
  return (
    <button
      onClick={crown.onOpen}
      title={crown.openTitle}
      className="fast tap group flex w-full items-start gap-2 text-left"
    >
      {face}
      <span className="mt-0.5 shrink-0 text-micro text-muted transition-colors group-hover:text-accent">
        open ▸
      </span>
    </button>
  );
}
