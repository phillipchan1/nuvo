// Draft the projects (D-196) — the pure half, shared by the app and the agent.
//
// An initiative's missing projects, drafted as bars across its quarter's weeks.
// The agent proposes; this module is what both runtimes agree a proposal IS:
// a name, a one-line outcome, a reason, and a span in whole weeks inside the
// quarter. Zero imports, no clock — like the planning kernel.
//
// Weeks are 0-based indices into the quarter's week list (the client sends the
// list; the model speaks 1-based "W3", which `shapeProjectProposals` converts).

export interface ProjectSpan {
  /** first week, 0-based into the quarter's weeks */
  start: number;
  /** whole weeks, ≥ 1 */
  weeks: number;
}

export interface ProjectVersion extends ProjectSpan {
  name: string;
  outcome: string;
  /** why it's needed — a few words, said under the name */
  why: string;
}

export interface ProjectProposal extends ProjectVersion {
  /** other ways to get the same part of the outcome (0–2) */
  alternatives: ProjectVersion[];
}

/** At most this many projects in one draft — a quarter, not a backlog. */
export const MAX_DRAFTED_PROJECTS = 5;

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** Clamp a span into the quarter: it starts inside it and ends by its last week. */
export function clampSpan(start: number, weeks: number, weekCount: number): ProjectSpan {
  const n = Math.max(1, Math.floor(weekCount));
  const s = Math.min(n - 1, Math.max(0, Math.floor(Number.isFinite(start) ? start : 0)));
  const w = Math.min(n - s, Math.max(1, Math.floor(Number.isFinite(weeks) ? weeks : 1)));
  return { start: s, weeks: w };
}

/** Spans for proposals that came without one: in order, each a fair share of
 *  the quarter, overlapping its neighbour by a week so the quarter isn't a
 *  relay. Deterministic — the same n and quarter always lay out the same. */
export function fallbackSpans(count: number, weekCount: number): ProjectSpan[] {
  if (count <= 0) return [];
  const n = Math.max(1, weekCount);
  const share = n / count;
  return Array.from({ length: count }, (_, i) => clampSpan(Math.round(i * share), Math.max(2, Math.round(share) + 1), n));
}

function shapeVersion(raw: Record<string, unknown>, weekCount: number, fallback: ProjectSpan): ProjectVersion | null {
  const name = str(raw.name, 80);
  if (!name) return null;
  const hasSpan = raw.start_week != null || raw.weeks != null;
  const span = hasSpan
    ? clampSpan(Number(raw.start_week ?? 1) - 1, Number(raw.weeks ?? fallback.weeks), weekCount)
    : { start: fallback.start, weeks: fallback.weeks };
  return { name, outcome: str(raw.outcome, 160), why: str(raw.why ?? raw.rationale, 80), start: span.start, weeks: span.weeks };
}

/**
 * Whatever the model said → proposals both runtimes trust: named, deduplicated
 * against the projects the initiative already has (and each other), spans
 * inside the quarter, at most five, each with at most two alternatives.
 */
export function shapeProjectProposals(raw: unknown, weekCount: number, existingNames: string[] = []): ProjectProposal[] {
  const list = (Array.isArray(raw) ? raw : []).filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null);
  const fallback = fallbackSpans(Math.min(list.length, MAX_DRAFTED_PROJECTS), weekCount);
  const seen = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const out: ProjectProposal[] = [];
  for (const p of list) {
    if (out.length >= MAX_DRAFTED_PROJECTS) break;
    const v = shapeVersion(p, weekCount, fallback[out.length] ?? clampSpan(0, 2, weekCount));
    if (!v || seen.has(v.name.toLowerCase())) continue;
    seen.add(v.name.toLowerCase());
    const alternatives = (Array.isArray(p.alternatives) ? p.alternatives : [])
      .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
      .map((a) => shapeVersion(a, weekCount, v))
      .filter((a): a is ProjectVersion => !!a && a.name.toLowerCase() !== v.name.toLowerCase())
      .slice(0, 2);
    out.push({ ...v, alternatives });
  }
  return out;
}

/** Stack bars into rows in start order so no two in a row overlap. */
export function packRows<T extends { id: string } & ProjectSpan>(bars: T[]): Map<string, number> {
  const order = [...bars].sort((a, b) => a.start - b.start || a.weeks - b.weeks || a.id.localeCompare(b.id));
  const rowEnd: number[] = [];
  const rows = new Map<string, number>();
  for (const b of order) {
    let r = rowEnd.findIndex((end) => end < b.start);
    if (r < 0) {
      r = rowEnd.length;
      rowEnd.push(-1);
    }
    rowEnd[r] = b.start + b.weeks - 1;
    rows.set(b.id, r);
  }
  return rows;
}

/** How many of these run in each week of the quarter. */
export function atOnce(bars: ProjectSpan[], weekCount: number): number[] {
  const n = Array(Math.max(0, weekCount)).fill(0) as number[];
  for (const b of bars) for (let w = b.start; w < b.start + b.weeks && w < weekCount; w++) if (w >= 0) n[w]++;
  return n;
}
