// "Tasks that belong here" — the record modal's intelligence. Given a project
// or initiative, scan the quiet pools (inbox captures + loose, undated,
// unfiled work) and surface the tasks that most plausibly belong under this
// record. It scores two signals and explains itself:
//
//   · semantic — keyword overlap between a task's title and the RECORD'S OWN
//     words (name + goal + description, plus the parent initiative's name).
//     This is why "everything in there informs" the suggestions: the richer
//     you describe a project, the smarter the matches.
//   · structural — how close a loose task already sits: in your inbox, parked
//     on the same domain, or loose on the same initiative.
//
// Everything here is pure and synchronous over the live VerticalData snapshot,
// so it runs instantly with no backend. The shape (a ranked list of candidates
// each carrying a score + human reasons) is deliberately the same one an
// LLM-backed proposer would return, so this can be swapped for an edge-function
// call later without touching the modal.

import type { Initiative, Project, VerticalData, VTask } from "./vertical";

export interface Suggestion {
  task: VTask;
  score: number;
  /** Short, human reasons — rendered as chips ("mentions “invoice”"). */
  reasons: string[];
}

// Words that carry no matching signal — dropped before overlap is computed.
const STOP = new Set([
  "the", "and", "for", "to", "a", "an", "of", "in", "on", "at", "is", "are",
  "with", "from", "by", "this", "that", "it", "be", "as", "or", "my", "our",
  "do", "make", "get", "set", "up", "out", "new", "add", "via", "into", "per",
  "about", "after", "before", "then", "than", "so", "we", "you", "i", "me",
]);

/** Lowercase word tokens, stopwords and short fragments dropped. */
function tokenize(...parts: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const p of parts) {
    if (!p) continue;
    for (const raw of p.toLowerCase().split(/[^a-z0-9]+/)) {
      const w = raw.trim();
      if (w.length > 2 && !STOP.has(w)) out.add(w);
    }
  }
  return out;
}

/** The undated, not-done, not-yet-committed pool — the only work we propose
 *  moving. Scheduled / planned / week-committed tasks already have a home, and
 *  re-filing them would yank them off the calendar, so they're never candidates. */
function pool(data: VerticalData): VTask[] {
  return data.tasks.filter((t) => t.status !== "done" && !t.doDate && !t.sprint);
}

const KEYWORD_WEIGHT = 2; // per matched keyword
const KEYWORD_CAP = 3; // diminishing returns past three matches
const THRESHOLD = 2.5; // below this, with no keyword hit, we stay quiet

function rank(
  candidates: { task: VTask; structural: number; structuralReason: string | null }[],
  seed: Set<string>,
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  for (const { task, structural, structuralReason } of candidates) {
    const titleTokens = tokenize(task.title);
    const matched: string[] = [];
    for (const w of titleTokens) {
      if (seed.has(w)) matched.push(w);
      if (matched.length >= KEYWORD_CAP) break;
    }
    const score = structural + matched.length * KEYWORD_WEIGHT;

    // Keep it only if it earns its place: a real keyword hit, or it already
    // sits structurally very close (e.g. loose on the same initiative).
    if (matched.length === 0 && score < THRESHOLD) continue;

    const reasons: string[] = [];
    if (matched.length) reasons.push(`mentions “${matched.slice(0, 3).join("”, “")}”`);
    if (structuralReason) reasons.push(structuralReason);

    suggestions.push({ task, score, reasons });
  }

  return suggestions
    .sort((a, b) => b.score - a.score || a.task.title.localeCompare(b.task.title))
    .slice(0, 6);
}

/** Tasks that plausibly belong under `project` but aren't filed there yet. */
export function suggestForProject(data: VerticalData, project: Project): Suggestion[] {
  const initiative = project.initiativeId
    ? data.initiatives.find((i) => i.id === project.initiativeId) ?? null
    : null;
  const seed = tokenize(project.name, project.outcome, project.description, initiative?.name);

  const candidates = pool(data)
    .filter((t) => t.projectId !== project.id)
    .map((t) => {
      let structural = 0;
      let reason: string | null = null;
      if (t.initiativeId && t.initiativeId === project.initiativeId && !t.projectId) {
        structural = 3;
        reason = initiative ? `loose in ${initiative.name}` : "loose on this initiative";
      } else if (t.domainId && t.domainId === project.domainId && !t.projectId && !t.initiativeId) {
        structural = 2;
        reason = "unfiled in this domain";
      } else if (t.inbox) {
        structural = 1.5;
        reason = "from your inbox";
      }
      // Anything else only earns a place through a keyword hit (structural 0).
      return { task: t, structural, structuralReason: reason };
    });

  return rank(candidates, seed);
}

/** Tasks that plausibly belong under `initiative` (loose on it) but sit
 *  elsewhere — in the inbox or parked on its domain — for now. */
export function suggestForInitiative(data: VerticalData, initiative: Initiative): Suggestion[] {
  const seed = tokenize(initiative.name, initiative.outcome, initiative.description);

  const candidates = pool(data)
    .filter((t) => !(t.initiativeId === initiative.id && !t.projectId))
    .filter((t) => !t.projectId) // a task already inside a project has a home
    .map((t) => {
      let structural = 0;
      let reason: string | null = null;
      if (t.domainId && t.domainId === initiative.domainId && !t.initiativeId) {
        structural = 2;
        reason = "unfiled in this domain";
      } else if (t.inbox) {
        structural = 1.5;
        reason = "from your inbox";
      }
      return { task: t, structural, structuralReason: reason };
    });

  return rank(candidates, seed);
}
