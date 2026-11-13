// The pool rail — the shared left column of every *planner* surface (the
// Schedule's LeftRail, the project deck, the initiative deck). Every one of those
// surfaces is the same act at a different clock speed: a pool of unclaimed things
// on the left, a grid of time on the right, and you drag from one into the other.
// So the pool wears one shape everywhere (styles/decks.css):
//
//   crown   — the surface's ONE hero, and it is the readiness: the horizon as a
//             12/600 label, the count as `text-display masthead` ("5 of 9
//             ready"), and one gap line that names the first debt — a fact and
//             a door at once — which vanishes when the altitude is clean.
//   pool    — a kit section header and the loose items, scrolling.
//   foot    — the "new" act, a kit Button with its keycap.
//
// It is STRUCTURE, not an object: full height, transparent on the panel,
// separated from the grid by one --line-1 hairline. Never a floating panel —
// the things that float are the things you pick up, and if the container
// floats too, nothing reads as graspable.

import { useMemo, type ReactNode } from "react";
import { Icon } from "../Icon";
import { Button, IconButton, SectionHeader } from "../kit";

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
  /** the horizon this rail plans ("Next 4 weeks"). */
  eyebrow: string;
  /** the scoreboard: `done` of `total` `noun` ("5 of 9 ready"). */
  done: number;
  total: number;
  noun: string;
  /** the one debt owed to the floor below — hidden entirely when clean. */
  gap?: { label: string; detail?: string; onJump: () => void } | null;
  /** the crown is also the doorway to the play that moves the count (Groom). */
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
  footTeach,
  footShortcut,
  groomAction,
  children,
}: {
  crown: RailCrown;
  /** the section label over the loose items ("Needs a week"). */
  poolLabel: string;
  poolCount: number;
  /** a drag is hovering the rail — releasing here un-claims the item's time. */
  over?: boolean;
  /** the hit-test attribute the surface's drag tracker looks for. */
  dropAttr: "data-pool-drop" | "data-inbox-drop";
  footLabel: string;
  onFoot: () => void;
  footTitle?: string;
  /** `data-teach` key, so the live walkthrough can light this ＋ (see teachTargets). */
  footTeach?: string;
  /** the global key that does the same thing ("P" / "I"), drawn as a keycap. */
  footShortcut?: string;
  /** the grooming-session action — quiet, self-hiding, lives right under the
   *  gap line so "N need shaping" has a same-screen answer, not just a jump
   *  into Groom (see GroomingSessionAction). */
  groomAction?: ReactNode;
  children: ReactNode;
}) {
  const width = useMemo(sharedRailWidth, []);

  return (
    <aside {...{ [dropAttr]: "" }} className="pr" data-over={over || undefined} style={{ width }}>
      {/* ── the crown — the readiness, as the surface's one hero ─────────────── */}
      <div className="pr-crown">
        <div className="pr-k">
          <span>{crown.eyebrow}</span>
          <span className="pr-grow" />
          {crown.onOpen && (
            <IconButton
              size="xs"
              label={crown.openTitle ?? "Open Groom"}
              icon={<Icon name="arrow-right" size={14} />}
              onClick={crown.onOpen}
            />
          )}
        </div>
        {crown.total === 0 ? (
          <h2 className="pr-hero text-display masthead" data-empty="">
            Nothing placed
          </h2>
        ) : (
          <h2 className="pr-hero text-display masthead" aria-label={`${crown.done} of ${crown.total} ${crown.noun}`}>
            {crown.done}
            <span className="pr-of"> of {crown.total}</span> {crown.noun}
          </h2>
        )}
        {crown.gap && (
          <button type="button" className="pr-gap" onClick={crown.gap.onJump}>
            <span className="pr-gap-mark" aria-hidden />
            <GapLabel label={crown.gap.label} />
            {crown.gap.detail && <span className="pr-gap-detail">· {crown.gap.detail}</span>}
            <Icon name="chevron-right" size={12} />
          </button>
        )}
        {groomAction && <div className="pr-groom">{groomAction}</div>}
      </div>

      {/* ── the pool ─────────────────────────────────────────────────────────────
          An EMPTY pool centres its two words in the space it owns rather than
          stranding them under the label with a rail-height void beneath — an
          empty drop target reads as open room, not as an unfinished panel. */}
      <div className="pr-pool">
        <SectionHeader title={poolLabel} count={poolCount} />
        <div className={poolCount === 0 ? "pr-empty" : undefined}>{children}</div>
      </div>

      {/* ── the foot — the "new" act, with its key ─────────────────────────────── */}
      <div className="pr-foot" data-teach={footTeach}>
        <Button
          full
          kind="ghost"
          icon={<Icon name="plus" size={14} />}
          shortcut={footShortcut}
          title={footTitle ?? footLabel}
          onClick={onFoot}
        >
          {footTitle ?? footLabel}
        </Button>
      </div>
    </aside>
  );
}

/** "3 need shaping" → the count in ink, the words quiet. */
function GapLabel({ label }: { label: string }) {
  const m = /^(\d+)(\s.*)$/.exec(label);
  if (!m) return <span>{label}</span>;
  return (
    <span>
      <b>{m[1]}</b>
      {m[2]}
    </span>
  );
}
