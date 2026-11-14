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
import { Button, Crown, IconButton, SectionHeader } from "../kit";
import type { CrownLineData } from "../../lib/crownLine";

// The rail is the SAME rail at every altitude, so it wears the width you set on
// the Schedule (LeftRail persists it here) — switching rungs must not move the
// edge between the pool and the grid. Read once at mount; the decks and the
// Schedule are never on screen together, so there's nothing to keep in sync.
const RAIL_WIDTH_KEY = "nuvo-rail-width";
const DEFAULT_RAIL_WIDTH = 360;
const MIN_RAIL_WIDTH = 240;
const MAX_RAIL_WIDTH = 560;

export function sharedRailWidth(): number {
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
  /** the deck as a track (D-207) — one piece per item, ready · mid-groom · raw */
  track?: ReactNode;
  /** the crown's line (D-207): the deck's Get ready stack, first card in words.
   *  `null` when the deck is clean — no line, nothing to press. */
  line?: CrownLineData | null;
  /** pressing the line opens the deck's Get ready stack */
  onLine?: () => void;
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
      <Crown
        eyebrow={crown.eyebrow}
        eyebrowAction={
          crown.onOpen && (
            <IconButton
              size="xs"
              label={crown.openTitle ?? "Open Groom"}
              icon={<Icon name="arrow-right" size={14} />}
              onClick={crown.onOpen}
            />
          )
        }
        done={crown.done}
        total={crown.total}
        noun={crown.noun}
        empty="Nothing placed"
        track={crown.track}
        line={crown.line}
        onLine={crown.onLine}
      >
        {groomAction && <div className="pr-groom">{groomAction}</div>}
      </Crown>

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
