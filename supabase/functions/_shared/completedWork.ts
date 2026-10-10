// Finished work — the stamp a complete writes, and the grouping a "what did
// I finish" read returns.
//
// Same constraints as the other kernels (`planningRules.ts`, `taskQuery.ts`):
//   1 · ZERO imports.
//   2 · Pure. No I/O, no clock — "now" is passed IN.
//   3 · Under `_shared/` so both runtimes (and the battery) import it.
//
// A completion time is `completed_at`, never `updated_at`. The latter moves
// on any later edit of a done row (title, notes, parent) and is not a
// finish time. Unstamped done rows are omitted from a completion window,
// not guessed.

/** Fields written alongside `status` so complete and reopen cannot drift. */
export function completionStamp(
  status: string,
  atISO: string,
): { completed_at: string | null } {
  return { completed_at: status === "done" ? atISO : null };
}

/** Planned length of a finished task. A missing duration is the app's
 *  30-minute default — the same number `fmtTask` and a new capture use —
 *  so a group total is in the same unit the calendar already speaks. */
export const FALLBACK_PLANNED_MINUTES = 30;

export function plannedMinutes(duration: number | null | undefined): number {
  return duration && duration > 0 ? duration : FALLBACK_PLANNED_MINUTES;
}

export interface CompletedWorkTask {
  id: string;
  title: string;
  completed_at: string;
  duration_minutes: number | null;
  project_id: string | null;
  domain_id: string | null;
}

export interface CompletedWorkProject {
  id: string;
  name: string;
  domain_id: string | null;
}

export interface CompletedWorkDomain {
  id: string;
  name: string;
}

export interface CompletedWorkItem {
  id: string;
  title: string;
  completed_at: string;
  duration_minutes: number;
}

export interface CompletedWorkGroup {
  project: { id: string; name: string } | null;
  domain: { id: string; name: string } | null;
  tasks: CompletedWorkItem[];
  total_minutes: number;
}

export interface CompletedWork {
  groups: CompletedWorkGroup[];
  total_minutes: number;
  count: number;
}

/**
 * Group finished tasks by project, then by the domain their hours COUNT
 * toward (D-088): a parented task uses its project's domain, never its own
 * denormalized copy. Loose tasks use their own domain. Missing names stay
 * null rather than inventing an "Unfiled" noun (P11).
 */
export function groupCompletedWork(
  tasks: CompletedWorkTask[],
  projects: CompletedWorkProject[],
  domains: CompletedWorkDomain[],
): CompletedWork {
  const projById = new Map(projects.map((p) => [p.id, p]));
  const domById = new Map(domains.map((d) => [d.id, d]));

  type Bucket = CompletedWorkGroup & { key: string };
  const buckets = new Map<string, Bucket>();

  for (const t of tasks) {
    if (!t.completed_at) continue;
    const proj = t.project_id ? projById.get(t.project_id) : undefined;
    // Parented: the project's domain, or unknown if the project is gone.
    // Loose: the task's own domain is authoritative.
    const domainId = t.project_id ? (proj?.domain_id ?? null) : (t.domain_id ?? null);
    const domain = domainId ? domById.get(domainId) : undefined;
    const project = proj ? { id: proj.id, name: proj.name } : null;
    const domainRef = domain ? { id: domain.id, name: domain.name } : null;
    const key = `${project?.id ?? ""}|${domainRef?.id ?? ""}`;
    const mins = plannedMinutes(t.duration_minutes);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, project, domain: domainRef, tasks: [], total_minutes: 0 };
      buckets.set(key, bucket);
    }
    bucket.tasks.push({
      id: t.id,
      title: t.title,
      completed_at: t.completed_at,
      duration_minutes: mins,
    });
    bucket.total_minutes += mins;
  }

  for (const b of buckets.values()) {
    b.tasks.sort((a, c) => (a.completed_at < c.completed_at ? 1 : a.completed_at > c.completed_at ? -1 : 0));
  }

  const rank = (g: Bucket): number => (g.project ? 0 : g.domain ? 1 : 2);
  const groups = [...buckets.values()]
    .sort((a, b) => {
      const rd = rank(a) - rank(b);
      if (rd) return rd;
      if (b.total_minutes !== a.total_minutes) return b.total_minutes - a.total_minutes;
      const an = a.project?.name ?? a.domain?.name ?? "";
      const bn = b.project?.name ?? b.domain?.name ?? "";
      return an.localeCompare(bn);
    })
    .map(({ key: _key, ...g }) => g);

  return {
    groups,
    total_minutes: groups.reduce((s, g) => s + g.total_minutes, 0),
    count: groups.reduce((s, g) => s + g.tasks.length, 0),
  };
}
