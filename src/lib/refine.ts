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
  domainById,
  initiativeById,
  isOpenStatus,
  projectById,
  isProjectComplete,
  type Initiative,
  type Project,
  type SoundnessVerdict,
  type VerticalData,
} from "./vertical";
import {
  readTending,
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

// ── Curated entry — group the groomable work into intent clusters ─────────────
// The portfolio map shouldn't drop 15 ranked rows on you. It groups the groomable
// work by the bet (or domain) it serves — "to move THIS, these few need shaping" —
// so a run is a coherent, bounded scope, not the firehose. The grouping is the
// overwhelm fix and the intent frame at once (docs/refine-run.md §5, §10 run-length).

export type RefineRef = { kind: "project" | "initiative"; id: string };

export interface RefineCluster {
  /** the intent this cluster serves — an initiative (a bet) or a domain (loose work). */
  kind: "initiative" | "domain";
  id: string;
  name: string;
  /** the "what you're trying to do" line — an initiative's outcome (domains: null). */
  intent: string | null;
  color: string;
  /** the initiative head itself still needs refining (only for kind "initiative"). */
  headGroomable: boolean;
  /** the groomable projects serving this intent, ranked (head excluded). */
  members: GroomCandidate[];
  /** the ranked run queue for the whole cluster — head first if it's groomable. */
  queue: RefineRef[];
  /** cluster rank = its strongest member's priority. */
  priority: number;
}

/** Which cluster a candidate belongs to — its bet if it has an open one, else its domain. */
function clusterKeyOf(d: VerticalData, c: GroomCandidate): string {
  if (c.kind === "initiative") return `init:${c.id}`;
  const initId = projectById(d, c.id)?.initiativeId;
  if (initId) {
    const init = initiativeById(d, initId);
    if (init && isOpenStatus(init.status)) return `init:${initId}`;
  }
  return `dom:${c.domainId}`;
}

/**
 * Group the ranked groomable work into intent clusters, strongest first. Each
 * cluster is a coherent run scope — one bet (and the projects under it) or a
 * domain's loose projects. The UI caps how many clusters / members it shows; this
 * returns them all so "see all" can simply lift the cap.
 */
export function curateRefine(d: VerticalData, now: Date = new Date()): RefineCluster[] {
  const groomable = readTending(d, now).groomable;
  const buckets = new Map<string, GroomCandidate[]>();
  for (const c of groomable) {
    const key = clusterKeyOf(d, c);
    const arr = buckets.get(key);
    if (arr) arr.push(c);
    else buckets.set(key, [c]);
  }

  const clusters: RefineCluster[] = [];
  for (const [key, members] of buckets) {
    const priority = members.reduce((m, c) => Math.max(m, c.priority), 0);
    if (key.startsWith("init:")) {
      const init = initiativeById(d, key.slice(5));
      if (!init) continue;
      const head = members.find((m) => m.kind === "initiative");
      const projects = members.filter((m) => m.kind === "project");
      clusters.push({
        kind: "initiative",
        id: init.id,
        name: init.name,
        intent: init.outcome.trim() || null,
        color: domainById(d, init.domainId)?.color ?? "var(--accent)",
        headGroomable: !!head,
        members: projects,
        queue: [
          ...(head ? [{ kind: "initiative" as const, id: init.id }] : []),
          ...projects.map((p) => ({ kind: "project" as const, id: p.id })),
        ],
        priority,
      });
    } else {
      const dom = domainById(d, key.slice(4));
      if (!dom) continue;
      const projects = members.filter((m) => m.kind === "project");
      clusters.push({
        kind: "domain",
        id: dom.id,
        name: dom.name,
        intent: null,
        color: dom.color,
        headGroomable: false,
        members: projects,
        queue: projects.map((p) => ({ kind: "project" as const, id: p.id })),
        priority,
      });
    }
  }

  return clusters.sort((a, b) => b.priority - a.priority);
}
