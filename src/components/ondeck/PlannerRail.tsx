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

import { useMemo, useState, type ReactNode } from "react";
import { Icon } from "../Icon";
import { Button, Crown, CrownLine, IconButton, MarkSet, SectionHeader, Stop, UnitCrown } from "../kit";
import type { FinishTier } from "../../lib/celebrate";
import { marksReady, type Mark, type MarkKey } from "../../lib/marks";
import type { ReadyCard } from "../../lib/readyCards";
import { DeckFixList } from "./DeckFixList";
import { DECK_REACH_KEY } from "../../lib/motion";
import type { CrownLineData } from "../../lib/crownLine";
import { RAIL_WIDTH_CSS } from "../../lib/railWidth";

// The rail is the SAME rail at every altitude, so it wears the width you set on
// the Schedule — `--rail-w` (lib/railWidth), which every page bar's breadcrumb
// slot wears too. Switching rungs moves neither the pool's edge nor the tabs.
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
  /** The readings (D-209): with these the crown draws a title that earns its
   *  ember stop and the altitude's three marks, in place of number + track. */
  title?: string;
  marks?: Mark[];
  /** the deck at rest: the Get ready stack's top card, in place of the line */
  deck?: ReactNode;
  /** A dial's fixes (D-227): its "what's left" becomes the button that unfolds
   *  these cards under the dials, each with its act on the row. */
  fixes?: Partial<Record<MarkKey, readonly ReadyCard[]>>;
  /** what a fix's name opens */
  onFixOpen?: (id: string) => void;
  /** the walk, offered at the foot of the Shaped dial's list */
  walk?: { label: string; run: () => void } | null;
  /** told when a dial's list opens or closes (the deck fetches ✦ drafts) */
  onUnfold?: (k: MarkKey | null) => void;
  /** The unit you can finish now, as a finish ring above the horizon's dials
   *  (D-231): the project deck's This week, the initiative deck's This
   *  quarter — the same hero the Schedule's Today wears. */
  unit?: {
    title: string;
    outer: number | null;
    n: number;
    of: number;
    closed: boolean;
    said: string;
    tier: FinishTier;
  } | null;
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
  const width = useMemo(RAIL_WIDTH_CSS, []);
  // One dial's list open at a time; a second press on its line folds it.
  const [unfold, setUnfold] = useState<MarkKey | null>(null);
  const fixes = crown.fixes ?? {};
  const acts: Partial<Record<MarkKey, () => void>> = {};
  for (const m of crown.marks ?? [])
    if (fixes[m.key]?.length)
      acts[m.key] = () => {
        const next = unfold === m.key ? null : m.key;
        setUnfold(next);
        crown.onUnfold?.(next);
      };
  const open = unfold ? fixes[unfold] ?? [] : [];
  const shapedKey = crown.marks?.[0]?.key;

  return (
    <aside {...{ [dropAttr]: "" }} className="pr" data-over={over || undefined} style={{ width }}>
      {/* ── the crown — the readiness, as the surface's one hero ─────────────── */}
      {crown.marks ? (
        <>
          {crown.unit && (
            <div className="pr-unit">
              <UnitCrown {...crown.unit} />
            </div>
          )}
          <div className="k-crown" data-crown="">
            <div className="k-crown-k">
              <span className="k-crown-eyebrow" data-horizon={crown.unit ? "" : undefined}>
                {crown.eyebrow}
                {/* with a unit ring above, the horizon heads its dials and wears the stop */}
                {crown.unit && <Stop on={marksReady(crown.marks)} />}
              </span>
              <span className="k-crown-grow" />
              {crown.onOpen && (
                <IconButton
                  size="xs"
                  label={crown.openTitle ?? "Open Groom"}
                  icon={<Icon name="arrow-right" size={14} />}
                  onClick={crown.onOpen}
                />
              )}
            </div>
            {!crown.unit && (
              <h2 className="k-crown-hero text-display masthead">
                {crown.title}
                <Stop on={marksReady(crown.marks)} />
              </h2>
            )}
            <MarkSet
              marks={crown.marks}
              // A card that writes Reaches the deck (D-207) — it lands on Ready.
              attrsFor={(k) => (k === crown.marks![0].key ? { "data-crown-deck": "" } : undefined)}
              reachKeyFor={(k) => (k === crown.marks![0].key ? DECK_REACH_KEY : undefined)}
              acts={acts}
            />
            {open.length > 0 && crown.onFixOpen && (
              <DeckFixList
                cards={open}
                label={crown.marks.find((m) => m.key === unfold)?.label ?? ""}
                onOpen={crown.onFixOpen}
                walk={unfold === shapedKey ? crown.walk : null}
              />
            )}
            {/* The dials say what's left and open it, so the line only speaks
                for what no dial carries, and never adds a "then:" (D-227). */}
            {!crown.deck && crown.line && <CrownLine line={{ ...crown.line, then: null }} onPress={crown.onLine} />}
            {groomAction && <div className="pr-groom">{groomAction}</div>}
          </div>
          {crown.deck}
        </>
      ) : (
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
      )}

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
