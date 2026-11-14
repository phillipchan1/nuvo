/**
 * Get ready on the decks (D-207, docs/rail-line.md §5) — the cards that take a
 * deck to ready, worst first, and the crown's line over them.
 *
 * The project deck and the initiative deck answer "is the work ahead ready to
 * be placed?" one clock speed apart. Their stack is built from facts the deck
 * already computes (the lane's tier, gaps, pace and risk), never a new read:
 *
 *   project deck      overdue → a thin path (D-196) → a gap (no outcome · no
 *                     finish line · no steps) → won't fit its week
 *   initiative deck   at risk → overdue → a gap (no outcome · no key results)
 *                     → needs OKRs / still an idea
 *
 * Every act names where it goes, and none writes behind your back (P3): a gap
 * that is steps goes to Draft the path; everything else opens the record, where
 * its lead line asks the question (D-050). Opening writes nothing, so nothing
 * lands (Momentum law 2) — the card simply leaves when its fact does.
 *
 * Pure: no React, no clock.
 */

import type { ReadyCard } from "./readyCards";
import { lineFrom, type CrownLineData, type LineCard } from "./crownLine";

export interface DeckActs {
  /** open the record (project or initiative) */
  open: (id: string) => void;
  /** Draft the path — the record opens with the draft running */
  draftPath: (projectId: string) => void;
  /** Draft the projects — a bet's own door on the deck (D-195's drafts) */
  draftProjects?: (initiativeId: string, from: HTMLElement | null) => void;
}

/** What a project lane says, as the deck already knows it. */
export interface ProjectDeckFact {
  id: string;
  name: string;
  /** 0 = this week; used to rank the nearer gap first */
  weekIdx: number;
  /** "Nov 16" — the week it sits in */
  weekLabel: string;
  overdueDays: number | null;
  /** `thinWord` of a thin path, when it has one (D-196) */
  thin: string | null;
  /** the first readiness gap's words ("no outcome", "no steps"), or null */
  gap: string | null;
  wontFit: boolean;
}

export function projectDeckCards(facts: readonly ProjectDeckFact[], acts: DeckActs): ReadyCard[] {
  const near = [...facts].sort((a, b) => a.weekIdx - b.weekIdx);
  const out: ReadyCard[] = [];
  const open = (f: ProjectDeckFact) => ({ verb: "Open", name: f.name, run: () => acts.open(f.id) });
  const draft = (f: ProjectDeckFact) => ({ verb: "Draft the path", run: () => acts.draftPath(f.id) });
  for (const f of near)
    if (f.overdueDays && f.overdueDays > 0)
      out.push({ key: `deck:overdue:${f.id}`, kind: "risk", title: f.name, why: `${f.overdueDays}d overdue · ${f.weekLabel}`, primary: open(f), projectId: f.id });
  for (const f of near)
    if (f.thin && !(f.overdueDays && f.overdueDays > 0))
      out.push({ key: `deck:thin:${f.id}`, kind: "path", title: f.name, why: `${f.thin} · ${f.weekLabel}`, primary: draft(f), projectId: f.id });
  for (const f of near)
    if (f.gap && !f.thin && !(f.overdueDays && f.overdueDays > 0))
      out.push({
        key: `deck:gap:${f.id}`,
        kind: "shape",
        title: f.name,
        why: `${cap(f.gap)} · ${f.weekLabel}`,
        primary: f.gap === "no steps" ? draft(f) : open(f),
        projectId: f.id,
      });
  for (const f of near)
    if (f.wontFit && !f.gap && !f.thin && !(f.overdueDays && f.overdueDays > 0))
      out.push({ key: `deck:fit:${f.id}`, kind: "shape", title: f.name, why: `Won't fit ${f.weekLabel}`, primary: open(f), projectId: f.id });
  return out;
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
  const open = (f: InitiativeDeckFact) => ({ verb: "Open", name: f.name, run: () => acts.open(f.id) });
  // A bet at risk with no work under it has a better act than opening it: the
  // deck's own Draft the projects, which puts work on deck (nothing written
  // until you keep a draft, P3).
  const fix = (f: InitiativeDeckFact) =>
    f.canDraft && acts.draftProjects
      ? { verb: "Draft the projects", run: (el: HTMLElement | null) => acts.draftProjects!(f.id, el) }
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
  const shapeN = cards.filter((c) => c.kind === "shape" || c.kind === "path").length;
  const riskN = cards.filter((c) => c.kind === "risk").length;
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
    return shapeN === 1
      ? { part: "shape", fact: `${c.title}: ${lower(c.why.split(" · ")[0])}`, then: `${c.title} needs shaping`, tone: "accent" }
      : { part: "shape", fact: `${shapeN} ${noun} shaping`, then: `${shapeN} need shaping`, tone: "accent" };
  });
  return lineFrom(lineCards);
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const lower = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
