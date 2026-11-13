// The Memory page's read (docs/memory.md §13, D-197): the portrait, the week
// Nuvo would draw, how it's doing, and what it asks this week — one pure
// function over what `useMemory` already holds, so the live page and the
// `?memory` harness draw the same thing from the same rules.

import {
  drawnAhead,
  drawnMinutes,
  keptAsDrafted,
  lastWeekOf,
  localDayOf,
  questionsLeft,
  type Graded,
  type KeptAsDrafted,
  type WeekBlock,
} from "./memoryGrade";
import {
  blocksOf,
  chipOf,
  clauseOf,
  labelOf,
  listOf,
  saidClause,
  type ClauseState,
  type Described,
  type MemoryAnswer,
  type Section,
} from "./memory";
import { weekdayOf, windowOf, type Observation, type RhythmEvent } from "../../supabase/functions/_shared/memory/rhythm";

export interface MemoryItem {
  key: string;
  section: Section;
  area: "Time";
  described: Described;
  observation: Observation | null;
  answer: MemoryAnswer | null;
}

/** One pill of the portrait (§13.3). */
export interface PortraitClause {
  key: string;
  /** The few words on its pill. */
  chip: string;
  /** The whole sentence, one tap away. */
  text: string;
  state: ClauseState;
  item: MemoryItem | null;
}

/** One block of the week Nuvo would draw. */
export interface PredictedBlock extends WeekBlock {
  key: string;
  state: ClauseState;
  label: string;
  /** A window is open time, not something you do. */
  open: boolean;
  domainId: string | null;
}

export type Drawn =
  | { gated: true; why: "weeks" | "kept" | "quiet" }
  | { gated: false; hit: number; total: number };

export interface MemoryFace {
  portrait: PortraitClause[];
  week: PredictedBlock[];
  proof: { keptAsDrafted: KeptAsDrafted; drawn: Drawn; lastWeekDrawn: (WeekBlock & { ahead: boolean })[] };
  questions: MemoryItem[];
  waiting: number;
  recent: { key: string; text: string; at: string }[];
}

export const clauseState = (section: Section): ClauseState => (section === "kept" ? "kept" : section === "new" ? "asking" : "watch");

/** How many weeks of the window had anything in them before "would have drawn it" may speak. */
export const DRAWN_NEEDS_WEEKS = 4;

export function readMemoryFace(input: {
  today: string;
  items: MemoryItem[];
  /** Every observation, before "hours you already have" is filtered out — kept items find their shape here. */
  observations: Observation[];
  answers: MemoryAnswer[];
  graded: Graded[] | undefined;
  workNames: string[];
  /** Your own timed events across the window. */
  events: RhythmEvent[];
  learning: boolean;
}): MemoryFace {
  const { today, items, observations, answers, graded, workNames, events, learning } = input;
  const workLabel = workNames[0] ?? "Work";
  const obsByKey = new Map(observations.map((o) => [o.key, o]));
  const obsOf = (i: MemoryItem) => i.observation ?? obsByKey.get(i.key) ?? null;

  // ── the portrait: what you said, then each memory, kept → asking → watching ──
  const portrait: PortraitClause[] = [];
  const said = saidClause(workNames);
  if (said) portrait.push({ key: "said:work", chip: `${listOf(workNames)} ${workNames.length > 1 ? "are" : "is"} paid work`, text: said, state: "kept", item: null });
  const rank = { kept: 0, new: 1, watch: 2, no: 3 } as const;
  const kindRank = { hours: 0, habit: 1, window: 2, repeat: 3 } as const;
  const kindOf = (i: MemoryItem) => obsOf(i)?.kind ?? i.answer?.kind ?? "repeat";
  items
    .filter((i) => i.section !== "no")
    .sort((a, b) => kindRank[kindOf(a)] - kindRank[kindOf(b)] || rank[a.section] - rank[b.section])
    .forEach((i) => {
      const o = obsOf(i);
      const st = clauseState(i.section);
      portrait.push({
        key: i.key,
        chip: i.answer?.chip ?? (o ? chipOf(o, workLabel) : i.described.title),
        text: i.answer?.clause ?? (o ? clauseOf(o, st) : i.described.statement),
        state: st,
        item: i,
      });
    });

  // ── where each memory sits in a week ──
  const shapeOf = (i: MemoryItem): { blocks: WeekBlock[]; label: string; open: boolean; domainId: string | null } => {
    const o = obsOf(i);
    if (o) return { blocks: blocksOf(o), label: labelOf(o, workLabel), open: o.kind === "window", domainId: o.kind === "habit" ? o.domainId : null };
    const a = i.answer;
    if (a?.blocks) return { blocks: a.blocks, label: a.label ?? "", open: a.kind === "window", domainId: a.domainId ?? null };
    // Hours kept before answers carried their shape: the key spells the days out.
    if (a?.key.startsWith("hours:"))
      return { blocks: hoursFromKey(a.key), label: workLabel, open: false, domainId: null };
    return { blocks: [], label: "", open: false, domainId: null };
  };

  const week: PredictedBlock[] = items
    .filter((i) => i.section !== "no")
    .flatMap((i) => {
      const sh = shapeOf(i);
      return sh.blocks.map((b) => ({ ...b, key: i.key, state: clauseState(i.section), label: sh.label, open: sh.open, domainId: sh.domainId }));
    });

  // ── how it's doing: graded against what you did ──
  const lw = lastWeekOf(today);
  const lived = events
    .filter((e) => e.day >= lw.start && e.day <= lw.end && e.endMin > e.startMin)
    .map((e) => ({ weekday: weekdayOf(e.day), startMin: e.startMin, endMin: e.endMin }));
  // Only what was kept before last week began: a prediction made after the fact isn't one.
  const predicted = items
    .filter((i) => i.section === "kept" && i.answer && localDayOf(i.answer.at) < lw.start)
    .flatMap((i) => {
      const sh = shapeOf(i);
      return sh.open ? [] : sh.blocks;
    });
  const win = windowOf(today);
  const weeksWithData = new Set(events.map((e) => win.weekIndex(e.day)).filter((x) => x >= 0)).size;
  const d = drawnMinutes(lived, predicted);
  const drawn: Drawn =
    weeksWithData < DRAWN_NEEDS_WEEKS
      ? { gated: true, why: "weeks" }
      : !predicted.length
        ? { gated: true, why: "kept" }
        : d.total === 0
          ? { gated: true, why: "quiet" }
          : { gated: false, hit: d.hit, total: d.total };

  // ── this week's questions: two at most, surest first ──
  const asks = items
    .filter((i) => i.section === "new")
    .sort(
      (a, b) =>
        (a.described.confidence === "sure" ? 0 : 1) - (b.described.confidence === "sure" ? 0 : 1) ||
        (b.observation?.hits ?? 0) - (a.observation?.hits ?? 0),
    );
  const left = learning ? questionsLeft(graded, today) : 0;
  const questions = asks.slice(0, left);

  // ── confirmation that it's learning: what you kept most recently ──
  const recent = answers
    .filter((a) => a.answer === "kept")
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 3)
    .map((a) => ({ key: a.key, text: a.chip ?? a.statement, at: a.at }));

  return {
    portrait,
    week,
    proof: { keptAsDrafted: keptAsDrafted(graded, "path"), drawn, lastWeekDrawn: lived.map((b) => ({ ...b, ahead: drawnAhead(b, predicted) })) },
    questions,
    waiting: asks.length - questions.length,
    recent,
  };
}

/** "hours:0-480-930,1-480-930" → the blocks it names. */
export function hoursFromKey(key: string): WeekBlock[] {
  return key
    .slice(key.indexOf(":") + 1)
    .split(",")
    .map((p) => p.split("-").map(Number))
    .filter((p) => p.length === 3 && p.every(Number.isFinite))
    .map(([weekday, startMin, endMin]) => ({ weekday, startMin, endMin }));
}
