// Draft the path — the pure half (D-193).
//
// Nuvo drafts a project's missing steps; the person keeps, drops, re-words,
// re-sizes and re-orders them in the project's own list. Nothing here touches a
// cache or the network: it decides where a drafted step sits among the steps
// the person already wrote, what a kept step's sort order is, and what (if
// anything) their finished work says about how long it takes.
//
// The draft lives in a `layout` — the list as drawn, real task ids and draft
// keys interleaved. Real tasks keep their own `sort_order`; a draft only has a
// place in the layout until it's kept, and then it gets the sort order between
// the real neighbours it sits between.

export type Energy = "deep" | "decide" | "delegate" | "quick";

export interface DraftVersion {
  title: string;
  durationMins: number;
}

/** What the agent returns for one step (`scaffold.ts` → `ScaffoldDraft`). */
export interface ProposedStep {
  title: string;
  energy: Energy | null;
  durationMins: number;
  rationale?: string;
  after?: string;
  alternatives?: DraftVersion[];
}

export interface Evidence {
  /** One line for the opened step: where the size came from. */
  text: string;
  /** False when no finished work looks like it — the size is the model's guess. */
  measured: boolean;
}

export interface DraftStep {
  key: string;
  versions: DraftVersion[];
  version: number;
  energy: Energy | null;
  why: string | null;
  evidence: Evidence;
}

export const DRAFT_PREFIX = "draft:";
export const isDraftId = (id: string) => id.startsWith(DRAFT_PREFIX);
export const draftId = (key: string) => DRAFT_PREFIX + key;
export const keyOf = (id: string) => id.slice(DRAFT_PREFIX.length);

export const current = (s: DraftStep): DraftVersion => s.versions[s.version] ?? s.versions[0];

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// ── evidence — sizes from the person's own finished work, never invented ────────

const STOP = new Set([
  "the", "a", "an", "and", "or", "to", "for", "of", "with", "on", "in", "at", "by", "from", "my", "your", "our",
  "their", "it", "this", "that", "up", "out", "about", "into", "all", "new", "next", "first",
]);

function words(title: string): string[] {
  return norm(title)
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(" ")
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/** Does a finished task look like the same kind of work? Same leading verb and
 *  one shared word beyond it, or two shared words anywhere. Deliberately strict:
 *  a missed match costs an "estimate" label; a wrong one lends the model's guess
 *  the authority of your history (P6). */
export function looksAlike(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  if (!wa.length || !wb.length) return false;
  const shared = wa.filter((w) => wb.includes(w));
  const sameVerb = norm(a).split(" ")[0] === norm(b).split(" ")[0];
  return shared.length >= 2 || (sameVerb && shared.filter((w) => w !== wa[0]).length >= 1);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);

/**
 * Size a drafted step from the person's finished tasks. Two or more finished
 * tasks that look alike and carry a duration → the median of theirs, and the
 * line says so. Otherwise the model's size stands and the line says it's an
 * estimate. The second case is the whole of a new account (P7, P16).
 */
export function sizeFromHistory(
  title: string,
  proposedMins: number,
  finished: { title: string; duration_minutes: number | null }[],
): { mins: number; evidence: Evidence } {
  const like = finished.filter((t) => t.duration_minutes && t.duration_minutes > 0 && looksAlike(title, t.title));
  if (like.length < 2) return { mins: proposedMins, evidence: { text: "An estimate", measured: false } };
  const mins = like.map((t) => t.duration_minutes as number);
  const lo = Math.min(...mins);
  const hi = Math.max(...mins);
  const range = lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
  return {
    mins: Math.max(5, Math.round(median(mins) / 5) * 5),
    evidence: { text: `You've finished ${like.length} like this, sized ${range}`, measured: true },
  };
}

// ── building the draft ───────────────────────────────────────────────────────

let seq = 0;

/** Turn the agent's proposals into draft steps, sized against your history. */
export function toSteps(
  proposals: ProposedStep[],
  finished: { title: string; duration_minutes: number | null }[],
): DraftStep[] {
  return proposals.map((p) => {
    const raw = [{ title: p.title, durationMins: p.durationMins }, ...(p.alternatives ?? [])];
    const seen = new Set<string>();
    const versions = raw
      .filter((v) => v.title.trim() && !seen.has(norm(v.title)) && seen.add(norm(v.title)))
      .map((v) => {
        const sized = sizeFromHistory(v.title, v.durationMins, finished);
        return { title: v.title.trim(), durationMins: sized.mins, evidence: sized.evidence };
      });
    return {
      key: `s${++seq}`,
      versions: versions.map(({ title, durationMins }) => ({ title, durationMins })),
      version: 0,
      energy: p.energy,
      why: p.rationale?.trim() || null,
      evidence: versions[0].evidence,
    };
  });
}

/** Re-size the evidence line when the version changes. */
export function evidenceFor(
  step: DraftStep,
  finished: { title: string; duration_minutes: number | null }[],
): Evidence {
  const v = current(step);
  return sizeFromHistory(v.title, v.durationMins, finished).evidence;
}

/**
 * Lay the drafted steps among the person's own. Each proposal names the step
 * it follows (`after`, an exact title, or "START"); one that names nothing — or
 * a title that isn't there — follows the proposal before it, and the first such
 * goes at the end. Proposals that follow the same step keep their order.
 */
export function placeSteps(realIds: string[], titleOf: (id: string) => string, steps: DraftStep[], proposals: ProposedStep[]): string[] {
  const layout = [...realIds];
  const byTitle = new Map(realIds.map((id) => [norm(titleOf(id)), id]));
  let prev: string | null = null; // the id the last placed draft went in after (or the draft itself)
  steps.forEach((s, i) => {
    const after = proposals[i]?.after;
    const id = draftId(s.key);
    let at: number;
    if (after && norm(after) === "start") {
      // Before every real step, after any drafts already put there.
      const firstReal = layout.findIndex((x) => !isDraftId(x));
      at = firstReal < 0 ? layout.length : firstReal;
    } else if (after && byTitle.has(norm(after))) {
      const anchor = byTitle.get(norm(after)) as string;
      let j = layout.indexOf(anchor) + 1;
      while (j < layout.length && isDraftId(layout[j])) j++;
      at = j;
    } else if (prev) {
      at = layout.indexOf(prev) + 1;
    } else {
      at = layout.length;
    }
    layout.splice(at, 0, id);
    prev = id;
  });
  return layout;
}

/** Bring the layout up to date with the list as it now stands: real rows that
 *  vanished go, new real rows (added in the box, or by another device) join at
 *  the end, drafts stay where they were. */
export function reconcile(layout: string[], realIds: string[], liveKeys: Set<string>): string[] {
  const real = new Set(realIds);
  const kept = layout.filter((id) => (isDraftId(id) ? liveKeys.has(keyOf(id)) : real.has(id)));
  const placed = new Set(kept);
  return [...kept, ...realIds.filter((id) => !placed.has(id))];
}

/**
 * The sort order a kept draft takes: between the real rows either side of it in
 * the layout. Fractions are fine (`orderBeside` does the same); with no real
 * neighbour on one side it steps one past the other.
 */
export function sortOrderAt(layout: string[], id: string, orderOf: (realId: string) => number | undefined): number {
  const i = layout.indexOf(id);
  let before: number | undefined;
  let after: number | undefined;
  for (let j = i - 1; j >= 0 && before === undefined; j--) if (!isDraftId(layout[j])) before = orderOf(layout[j]);
  for (let j = i + 1; j < layout.length && after === undefined; j++) if (!isDraftId(layout[j])) after = orderOf(layout[j]);
  if (before === undefined && after === undefined) return i + 1;
  if (before === undefined) return (after as number) - 1;
  if (after === undefined) return before + 1;
  if (before === after) return before + 1e-3;
  return (before + after) / 2;
}

/** Move one row of the layout by `delta` places. Null when it can't go further. */
export function shiftIn(layout: string[], id: string, delta: number): string[] | null {
  const i = layout.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= layout.length) return null;
  const next = [...layout];
  next.splice(i, 1);
  next.splice(j, 0, id);
  return next;
}

/** The real rows' order inside a layout — what a reorder writes. */
export const realOrder = (layout: string[]) => layout.filter((id) => !isDraftId(id));

/** Which steer a free-text line asks for is the model's call; this only cleans it. */
export const cleanSteer = (text: string) => text.trim().replace(/\s+/g, " ").slice(0, 200);

export const STEERS = ["Smaller steps", "Fewer steps", "Skip the research"] as const;
