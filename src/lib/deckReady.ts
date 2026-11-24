/**
 * Get ready on the decks (D-207, docs/rail-line.md §5) — the cards that take a
 * deck to ready, worst first, and the crown's line over them.
 *
 * The project deck and the initiative deck answer "is the work ahead ready to
 * be placed?" one clock speed apart. Their stack is built from facts the deck
 * already computes (the lane's tier, gaps, pace, risk, the week's load), never
 * a new read. ONE card per project, its worst fact:
 *
 *   project deck      overdue → a week holding more than your cap (Q2) → a
 *                     thin path (D-196) → a gap (no outcome · no finish line ·
 *                     no steps) → won't fit its week
 *   initiative deck   at risk / overdue → a gap or still needs OKRs
 *
 * Every act names where it goes, and nothing is written until you press (P3):
 * *Set as outcome* writes the ✦ draft the card shows (and says it's a draft,
 * P6); *Move to Nov 23* is the drag's own write; *Draft the path* / *Draft the
 * projects* open their drafters; everything else opens the record, where its
 * lead line asks the question (D-050). A card that writes Reaches the deck's
 * crown (D-202); one that only opens something lands nothing.
 *
 * Pure: no React, no clock.
 */

import type { ReadyAct, ReadyCard } from "./readyCards";
import { lineFrom, type CrownLineData, type LineCard } from "./crownLine";

export interface DeckActs {
  /** open the record (project or initiative) */
  open: (id: string) => void;
  /** Draft the path — the record opens with the draft running */
  draftPath: (projectId: string) => void;
  /** Draft the projects — a bet's own door on the deck */
  draftProjects?: (initiativeId: string, from: HTMLElement | null) => void;
  /** write a drafted outcome onto the project */
  setOutcome?: (projectId: string, outcome: string, from: HTMLElement | null) => void;
  /** move the project to the week — or the bet to the quarter — the card names
   *  (the drag's own write) */
  move?: (id: string, from: HTMLElement | null) => void;
  /** open the ship assessment — shipping is a judgment, so this never writes (D-256) */
  ship?: (projectId: string) => void;
  /** park the record (status "waiting"), with an Undo */
  park?: (id: string) => void;
  /** a bet's own completion */
  complete?: (initiativeId: string) => void;
}

/** Park it — a state, said in words (D-256). */
const parkAct = (acts: DeckActs, id: string): ReadyCard["secondary"] =>
  acts.park ? { label: "Park it", run: () => acts.park!(id) } : undefined;

/** A ✦ outcome draft for a project with none — fetched when Get ready opens. */
export type OutcomeDraft = { state: "loading" } | { state: "ready"; text: string } | { state: "error" };

/** What a project lane says, as the deck already knows it. */
export interface ProjectDeckFact {
  id: string;
  name: string;
  /** 0 = this week; nearer facts rank first */
  weekIdx: number;
  /** "Next week" — the week it sits in */
  weekLabel: string;
  overdueDays: number | null;
  /** `thinWord` of a thin path, when it has one (D-196) */
  thin: string | null;
  /** the first readiness gap's words ("no outcome", "no steps"), or null */
  gap: string | null;
  wontFit: boolean;
  /** its week holds more than the per-week cap, and it's the one to move */
  crowded?: { load: number; cap: number } | null;
  /** the nearest later week with room — what *Move to* names */
  moveTo?: { label: string } | null;
  draft?: OutcomeDraft | null;
}

const RANK = { risk: 0, crowd: 1, path: 2, shape: 3, fit: 4 } as const;

export function projectDeckCards(facts: readonly ProjectDeckFact[], acts: DeckActs): ReadyCard[] {
  const parkOf = (id: string) => parkAct(acts, id);
  const open = (f: ProjectDeckFact): ReadyAct => ({ verb: "Open", name: f.name, run: () => acts.open(f.id) });
  const draft = (f: ProjectDeckFact): ReadyAct => ({ verb: "Suggest tasks", run: () => acts.draftPath(f.id) });
  const move = (f: ProjectDeckFact): ReadyAct | null =>
    f.moveTo && acts.move ? { verb: "Move to", name: f.moveTo.label, run: (el) => acts.move!(f.id, el) } : null;
  const ranked: { rank: number; week: number; card: ReadyCard }[] = [];
  const add = (rank: keyof typeof RANK, f: ProjectDeckFact, card: Omit<ReadyCard, "title" | "projectId">) =>
    ranked.push({ rank: RANK[rank], week: f.weekIdx, card: { ...card, title: f.name, projectId: f.id } });

  for (const f of facts) {
    if (f.overdueDays && f.overdueDays > 0) {
      // An overdue project is late, finished, or no longer wanted — a card that
      // only said "Open" could answer none of the three (D-256). Reschedule it
      // to the nearest week with room; or say it shipped; or park it.
      add("risk", f, {
        key: `deck:overdue:${f.id}`,
        kind: "risk",
        why: `${f.overdueDays}d overdue · ${f.weekLabel}`,
        primary: move(f) ?? open(f),
        done: acts.ship ? { label: "Ship it…", opens: true, run: () => acts.ship!(f.id) } : undefined,
        secondary: parkOf(f.id),
      });
    } else if (f.crowded && move(f)) {
      add("crowd", f, {
        key: `deck:crowd:${f.id}`,
        kind: "crowd",
        why: `${f.weekLabel} holds ${f.crowded.load} · room for ${f.crowded.cap}`,
        primary: move(f)!,
        secondary: { label: `Open ${f.name}`, run: () => acts.open(f.id) },
      });
    } else if (f.thin) {
      add("path", f, { key: `deck:thin:${f.id}`, kind: "path", why: `${f.thin} · ${f.weekLabel}`, primary: draft(f) });
    } else if (f.gap === "no outcome" && f.draft?.state === "ready" && acts.setOutcome) {
      const text = f.draft.text;
      add("shape", f, {
        key: `deck:gap:${f.id}`,
        kind: "shape",
        why: `✦ ${text}`,
        primary: { verb: "Use this outcome", run: (el) => acts.setOutcome!(f.id, text, el) },
        secondary: { label: "Write my own", run: () => acts.open(f.id) },
      });
    } else if (f.gap) {
      add("shape", f, {
        key: `deck:gap:${f.id}`,
        kind: "shape",
        why: f.gap === "no outcome" && f.draft?.state === "loading" ? "No outcome · ✦ drafting one…" : `${cap(f.gap)} · ${f.weekLabel}`,
        primary: f.gap === "no steps" ? draft(f) : open(f),
      });
    } else if (f.wontFit) {
      add("fit", f, { key: `deck:fit:${f.id}`, kind: "shape", why: `Won't fit ${lower(f.weekLabel)}`, primary: move(f) ?? open(f) });
    }
  }
  return ranked.sort((a, b) => a.rank - b.rank || a.week - b.week).map((r) => r.card);
}

/** What a bet's lane says. */
export interface InitiativeDeckFact {
  id: string;
  name: string;
  quarterIdx: number;
  quarterLabel: string;
  /** the first reason it's at risk, or null when it isn't */
  risk: string | null;
  overdue: boolean;
  gap: string | null;
  /** "needs OKRs" / "idea" — the lane's own word, when it's one of those */
  stateWord: string | null;
  /** the deck can draft this bet's projects (`canDraftProjects`) */
  canDraft?: boolean;
  /** the next quarter it could move to, in words ("next quarter") — bets are
   *  thought of in quarters, never dates (D-256) */
  moveTo?: { label: string } | null;
}

export function initiativeDeckCards(facts: readonly InitiativeDeckFact[], acts: DeckActs): ReadyCard[] {
  const near = [...facts].sort((a, b) => a.quarterIdx - b.quarterIdx);
  const out: ReadyCard[] = [];
  const open = (f: InitiativeDeckFact): ReadyAct => ({ verb: "Open", name: f.name, run: () => acts.open(f.id) });
  // A bet at risk with no work under it has a better act than opening it: the
  // deck's own Draft the projects, which puts work on deck (nothing written
  // until you keep a draft, P3).
  const fix = (f: InitiativeDeckFact): ReadyAct =>
    f.canDraft && acts.draftProjects
      ? { verb: "Suggest projects", run: (el) => acts.draftProjects!(f.id, el) }
      : open(f);
  for (const f of near)
    if (f.risk || f.overdue)
      out.push({
        key: `bet:risk:${f.id}`,
        kind: "risk",
        title: f.name,
        why: f.overdue ? `Overdue · ${f.quarterLabel}` : `At risk: ${f.risk}`,
        // Overdue is a schedule fact, so its answer is a quarter; "at risk" is
        // about what's under it, so its answer stays Suggest projects / Open
        primary: f.overdue && f.moveTo && acts.move ? { verb: "Move to", name: f.moveTo.label, run: (el) => acts.move!(f.id, el) } : fix(f),
        // a bet at risk is late, done, or no longer wanted, like a project (D-256)
        done: acts.complete ? { label: "Mark complete", run: () => acts.complete!(f.id) } : undefined,
        secondary: parkAct(acts, f.id) ?? (f.canDraft && acts.draftProjects ? { label: `Open ${f.name}`, run: () => acts.open(f.id) } : undefined),
        projectId: null,
      });
  for (const f of near)
    if (!f.risk && !f.overdue && (f.gap || f.stateWord))
      out.push({
        key: `bet:gap:${f.id}`,
        kind: "shape",
        title: f.name,
        why: `${cap(f.gap ?? f.stateWord ?? "")} · ${f.quarterLabel}`,
        // a bet with no work under it has a better act than opening it (D-227)
        primary: fix(f),
        secondary: f.canDraft && acts.draftProjects ? { label: `Open ${f.name}`, run: () => acts.open(f.id) } : undefined,
        projectId: null,
      });
  return out;
}

/** The deck's line: the first card, said as a fact. */
export function deckLine(cards: readonly ReadyCard[], altitude: "project" | "initiative"): CrownLineData | null {
  const n = (k: ReadyCard["kind"][]) => cards.filter((c) => k.includes(c.kind)).length;
  const shapeN = n(["shape", "path"]);
  const riskN = n(["risk"]);
  const crowdN = n(["crowd"]);
  const noun = altitude === "project" ? (shapeN === 1 ? "project needs" : "projects need") : shapeN === 1 ? "bet needs" : "bets need";
  const lineCards: LineCard[] = cards.map((c): LineCard => {
    if (c.kind === "risk")
      return riskN === 1
        ? {
            part: "repair",
            fact:
              altitude === "project"
                ? `${c.title}: ${lower(c.why.split(" · ")[0])}`
                : `${c.title} is ${c.why.startsWith("Overdue") ? "overdue" : "at risk"}`,
            then: `${c.title} is ${altitude === "project" ? "overdue" : "at risk"}`,
            tone: "warn",
          }
        : { part: "repair", fact: `${riskN} ${altitude === "project" ? "projects are overdue" : "bets are at risk"}`, then: `${riskN} at risk`, tone: "warn" };
    if (c.kind === "crowd")
      return crowdN === 1
        ? { part: "time", fact: c.why.replace(" · ", ", "), then: c.why.split(" · ")[0], tone: "accent" }
        : { part: "time", fact: `${crowdN} weeks hold more than your cap`, then: `${crowdN} crowded weeks`, tone: "accent" };
    return shapeN === 1
      ? { part: "shape", fact: `${c.title}: ${c.why.startsWith("✦") || c.why.startsWith("No outcome") ? "no outcome" : lower(c.why.split(" · ")[0])}`, then: `${c.title} needs shaping`, tone: "accent" }
      : { part: "shape", fact: `${shapeN} ${noun} shaping`, then: `${shapeN} need shaping`, tone: "accent" };
  });
  return lineFrom(lineCards);
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const lower = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

// ── the deck at rest (D-216, docs/offer-rules.md R6) ─────────────────────────
// The stack no longer stands above the list. A card about one project (or bet)
// rides that project's own card on the deck as a quiet chip — but only when its
// act names somewhere to go (*Move to Nov 23*, *Suggest tasks*): an *Open* is
// what pressing the card already does, so it's no offer at all (R1), and those
// stay in the stack, behind the crown's line (R11 — silence is fine).

/** The record a deck card is about: its project, or the id its key ends in. */
export const subjectOf = (c: ReadyCard): string => c.projectId ?? c.key.slice(c.key.lastIndexOf(":") + 1);

/** At most this many chips on a deck at once — the rail's own budget (D-205). */
export const DECK_CHIPS_MAX = 3;

/** One chip per row, worst first, nothing past the budget, never an Open. */
export function rowOffers(cards: readonly ReadyCard[], max = DECK_CHIPS_MAX): Map<string, ReadyCard> {
  const out = new Map<string, ReadyCard>();
  for (const c of cards) {
    if (out.size >= max) break;
    if (c.opensMode || c.primary.verb === "Open" || c.kind === "plan") continue;
    const id = subjectOf(c);
    if (!out.has(id)) out.set(id, c);
  }
  return out;
}

/** The walk's door in the stack: *Plan projects* / *Plan initiatives*, last,
 *  only while something on the deck isn't Ready. It opens the mode (R9). */
export function planCard(notReady: number, altitude: "project" | "initiative", open: () => void): ReadyCard | null {
  if (notReady <= 0) return null;
  const verb = altitude === "project" ? "Plan projects" : "Plan initiatives";
  return {
    key: `deck:plan:${altitude}`,
    kind: "plan",
    title: verb,
    why: `${notReady} not Ready`,
    primary: { verb, run: () => open() },
    projectId: null,
    opensMode: "plan",
  };
}

/**
 * The deck's line, with the walk in it. When the worst thing on the deck is
 * shaping (not a project overdue, not a crowded week), the line is the walk's
 * door: "2 not Ready · Plan projects ›". Otherwise it stays the stack's line
 * (Get ready), and the walk is one card inside it. `opens` says which.
 */
export function deckPlanLine(
  cards: readonly ReadyCard[],
  notReady: number,
  altitude: "project" | "initiative",
): { line: CrownLineData | null; opens: "plan" | "ready" } {
  const work = cards.filter((c) => c.kind !== "plan");
  const lead = work[0];
  if (notReady > 0 && (!lead || lead.kind === "shape" || lead.kind === "path")) {
    return {
      line: { tone: "accent", glyph: null, text: `${notReady} not Ready`, act: altitude === "project" ? "Plan projects" : "Plan initiatives", then: null },
      opens: "plan",
    };
  }
  const line = deckLine(work, altitude);
  return { line: line && notReady > 0 && !line.then ? { ...line, then: `${notReady} not Ready` } : line, opens: "ready" };
}
