// Refine — the active grooming loop, decomposed. Where tending.ts reads how ripe
// an item is, this turns ONE item into an ordered stack of atomic gap-cards: the
// few one-tap decisions that move it toward ready. Pure over a VerticalData
// snapshot (+ an optional fresh verdict) — the card-loop UI (RefineRun) renders
// these and wires each to the existing draft/verify/mutation primitives.
//
// The decomposition falls straight out of the ripeness ladder + the soundness
// verdict — no new scoring. See docs/refine-run.md §3 (the card taxonomy).

import { addDays, format } from "date-fns";
import {
  initiativeById,
  isProjectComplete,
  projectById,
  type Initiative,
  type Project,
  type SoundnessVerdict,
  type VerticalData,
} from "./vertical";
import {
  ripenessOfInitiative,
  ripenessOfProject,
  tendedScore,
  type GroomCandidate,
} from "./tending";

// ── A card is one gap — one verdict to confirm, never a form to fill ──────────
export type RefineCardKind =
  | "outcome"  // raw: no definition of done — set one
  | "sharpen"  // has an outcome, but Nuvo can make it crisper (verdict suggestion)
  | "tasks"    // shaped / thin: an outcome with no (or too thin a) path
  | "due"      // scaffolded: a path with no finish line
  | "reality"; // active: the load-vs-calendar feasibility read (the keystone card)

export interface RefineCard {
  kind: RefineCardKind;
  /** why this blocks readiness — the card's one-line subtitle. */
  reason: string;
}

export const REFINE_CARD_LABEL: Record<RefineCardKind, string> = {
  outcome: "Definition of done",
  sharpen: "Sharper outcome",
  tasks: "The path",
  due: "Finish line",
  reality: "Reality check",
};

const has = (cards: RefineCard[], kind: RefineCardKind) => cards.some((c) => c.kind === kind);

// ── Decompose one project into its ordered gap-cards ─────────────────────────
// Structural gaps (from the ripeness stage) come first — they're the more
// fundamental thing missing. Soundness repairs (from a fresh verdict) layer on
// once Nuvo has judged the piece and found it wanting.
export function refineProjectCards(
  d: VerticalData,
  p: Project,
  verdict: SoundnessVerdict | null,
): RefineCard[] {
  if (isProjectComplete(p.status)) return [];
  const cards: RefineCard[] = [];
  const stage = ripenessOfProject(d, p).stage;

  if (stage === "raw") {
    cards.push({ kind: "outcome", reason: "No definition of done — Nuvo can't tell when this is finished." });
  } else if (stage === "shaped") {
    cards.push({ kind: "tasks", reason: "An outcome with no path — there are no steps to take yet." });
  } else if (stage === "scaffolded") {
    cards.push({ kind: "due", reason: "No finish line — nothing tells the week when to pull this in." });
  }

  // soundness repairs — only once Nuvo has judged it and found a real gap
  if (verdict && !verdict.sound) {
    if (verdict.outcome.suggestion && p.outcome.trim() && !has(cards, "outcome")) {
      cards.push({ kind: "sharpen", reason: verdict.outcome.note || "The outcome could be sharper." });
    }
    if (verdict.steps.verdict === "thin" && !has(cards, "tasks")) {
      const miss = verdict.steps.missing?.length ? ` Missing: ${verdict.steps.missing.join(", ")}.` : "";
      cards.push({ kind: "tasks", reason: `Thin on steps.${miss}` });
    }
    if (verdict.time.read === "unrealistic" || verdict.time.read === "tight") {
      const hrs = verdict.time.estHours ? ` ≈${verdict.time.estHours}h of work.` : "";
      cards.push({ kind: "reality", reason: `${verdict.time.note}${hrs}` });
    }
    if (!verdict.dates.ok && !has(cards, "due")) {
      cards.push({ kind: "due", reason: verdict.dates.note || "The dates need a look." });
    }
  }

  return cards;
}

// ── Decompose one initiative — the next altitude (docs/refine-run.md §4) ──────
// Same shape as a project, but the "path" gap is structure (key results +
// projects, via blueprint) rather than a task list.
export function refineInitiativeCards(
  d: VerticalData,
  i: Initiative,
  verdict: SoundnessVerdict | null,
): RefineCard[] {
  if (isProjectComplete(i.status)) return [];
  const cards: RefineCard[] = [];
  const stage = ripenessOfInitiative(d, i).stage;

  if (stage === "raw") {
    cards.push({ kind: "outcome", reason: "No outcome — this bet isn't clear enough for projects to run under it." });
  } else if (stage === "shaped") {
    cards.push({ kind: "tasks", reason: "A bet with no structure — no key results or projects to carry it." });
  } else if (stage === "scaffolded") {
    cards.push({ kind: "due", reason: "No finish line — the bet has no horizon to drive toward." });
  }

  if (verdict && !verdict.sound) {
    if (verdict.outcome.suggestion && i.outcome.trim() && !has(cards, "outcome")) {
      cards.push({ kind: "sharpen", reason: verdict.outcome.note || "The outcome could be sharper." });
    }
    if (verdict.steps.verdict === "thin" && !has(cards, "tasks")) {
      cards.push({ kind: "tasks", reason: "The structure under this bet looks thin." });
    }
    if (!verdict.dates.ok && !has(cards, "due")) {
      cards.push({ kind: "due", reason: verdict.dates.note || "The dates need a look." });
    }
  }
  return cards;
}

/** Decompose a candidate into its ordered gap-cards (project or initiative). */
export function refineCards(
  d: VerticalData,
  c: GroomCandidate,
  verdict: SoundnessVerdict | null,
): RefineCard[] {
  if (c.kind === "project") {
    const p = projectById(d, c.id);
    return p ? refineProjectCards(d, p, verdict) : [];
  }
  const i = initiativeById(d, c.id);
  return i ? refineInitiativeCards(d, i, verdict) : [];
}

/** The readiness ring value, 0..100 — soundness-aware, read live as cards clear. */
export function refineReadiness(d: VerticalData, c: GroomCandidate): number {
  return Math.round(tendedScore(d, c.kind, c.id) * 100);
}

/** A gentle default finish line when the due card has nothing better to offer —
 *  two weeks out, with buffer. The user can tweak it; this is just the proposal. */
export function proposeDueISO(now: Date = new Date()): string {
  return format(addDays(now, 14), "yyyy-MM-dd");
}
