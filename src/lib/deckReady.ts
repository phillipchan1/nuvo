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
  /** move the project to the week the card names (the drag's own write) */
  move?: (projectId: string, from: HTMLElement | null) => void;
}

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
  const open = (f: ProjectDeckFact): ReadyAct => ({ verb: "Open", name: f.name, run: () => acts.open(f.id) });
  const draft = (f: ProjectDeckFact): ReadyAct => ({ verb: "Draft the path", run: () => acts.draftPath(f.id) });
  const move = (f: ProjectDeckFact): ReadyAct | null =>
    f.moveTo && acts.move ? { verb: "Move to", name: f.moveTo.label, run: (el) => acts.move!(f.id, el) } : null;
  const ranked: { rank: number; week: number; card: ReadyCard }[] = [];
  const add = (rank: keyof typeof RANK, f: ProjectDeckFact, card: Omit<ReadyCard, "title" | "projectId">) =>
    ranked.push({ rank: RANK[rank], week: f.weekIdx, card: { ...card, title: f.name, projectId: f.id } });

  for (const f of facts) {
    if (f.overdueDays && f.overdueDays > 0) {
      add("risk", f, { key: `deck:overdue:${f.id}`, kind: "risk", why: `${f.overdueDays}d overdue · ${f.weekLabel}`, primary: open(f) });
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
        primary: { verb: "Set as outcome", run: (el) => acts.setOutcome!(f.id, text, el) },
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
      ? { verb: "Draft the projects", run: (el) => acts.draftProjects!(f.id, el) }
      : open(f);
  for (const f of near)
    if (f.risk || f.overdue)
      out.push({
        key: `bet:risk:${f.id}`,
        kind: "risk",
        title: f.name,
        why: f.overdue ? `Overdue · ${f.quarterLabel}` : `At risk: ${f.risk}`,
        primary: fix(f),
        secondary: f.canDraft && acts.draftProjects ? { label: `Open ${f.name}`, run: () => acts.open(f.id) } : undefined,
        projectId: null,
      });
  for (const f of near)
    if (!f.risk && !f.overdue && (f.gap || f.stateWord))
      out.push({ key: `bet:gap:${f.id}`, kind: "shape", title: f.name, why: `${cap(f.gap ?? f.stateWord ?? "")} · ${f.quarterLabel}`, primary: open(f), projectId: null });
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
