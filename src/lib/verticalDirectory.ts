import { deriveSlotTitle } from "./slots";
import { resolveDomainId, type VerticalData } from "./vertical";
import type { Slot, Task } from "./types";

/**
 * The vertical's DIRECTORY: every domain, initiative and project by name, hue,
 * parent and status — everything a surface that only *labels* work reads.
 *
 * `buildVertical` makes a new snapshot on every task write, because a task's
 * status moves its project's progress. A block's bar colour, a slot's title and
 * a rail row's "Billing migration" don't move with it — but they were derived
 * from the whole snapshot, so every write (and the 5-minute clock tick) rebuilt
 * every block on the grid. Comparing directories lets those readers keep the
 * snapshot they have until a name, hue or parent actually changes.
 */
const signatures = new WeakMap<VerticalData, string>();

export function directorySignature(d: VerticalData): string {
  const hit = signatures.get(d);
  if (hit !== undefined) return hit;
  const parts: string[] = [];
  for (const x of d.domains) parts.push(`d\u001f${x.id}\u001f${x.name}\u001f${x.color}`);
  for (const x of d.initiatives) parts.push(`i\u001f${x.id}\u001f${x.name}\u001f${x.domainId}\u001f${x.status}`);
  for (const x of d.projects) {
    parts.push(`p\u001f${x.id}\u001f${x.name}\u001f${x.domainId}\u001f${x.initiativeId ?? ""}\u001f${x.status}`);
  }
  const sig = parts.join("\u001e");
  signatures.set(d, sig);
  return sig;
}

/** Same names, hues, parentage and statuses — a `useVerticalSelector` equality. */
export function sameDirectory(a: VerticalData, b: VerticalData): boolean {
  return a === b || directorySignature(a) === directorySignature(b);
}

type TaskRef = Pick<Task, "domain_id" | "project_id" | "initiative_id">;

/** What the calendar grid reads off the vertical, keyed by id. */
export interface GridLookups {
  /** The domain hue a task's bar carries — `resolveDomainId`, so a parented
   *  task wears its project's domain, never its own stale copy (D-088). */
  taskColor: (t: TaskRef) => string | null;
  taskDomain: (t: TaskRef) => string | null;
  /** The project a task block belongs to, by name. */
  taskProject: (t: Pick<Task, "project_id">) => string | null;
  /** The project a sitting is FOR, and the domain hue it carries. */
  slotProject: (s: Pick<Slot, "project_id">) => { name: string; color: string | null } | null;
  slotTitle: (s: Slot, children: Task[]) => string;
  domains: { id: string; name: string; color: string }[];
}

/**
 * Build the grid's lookups from a snapshot. Pass a directory-stable snapshot
 * (see `useVerticalDirectory`) and the functions here keep their identity across
 * task writes — which is what lets `fcEvents` skip rebuilding for them.
 */
export function gridLookups(d: VerticalData): GridLookups {
  const domainById = new Map(d.domains.map((x) => [x.id, x]));
  const projectById = new Map(d.projects.map((x) => [x.id, x]));
  const initiativeDomain = new Map(d.initiatives.map((x) => [x.id, x.domainId]));
  const taskDomain = (t: TaskRef) =>
    resolveDomainId(
      t.domain_id,
      t.project_id,
      t.initiative_id,
      (id) => projectById.get(id)?.domainId,
      (id) => initiativeDomain.get(id),
    );
  return {
    taskDomain,
    taskColor: (t) => {
      const id = taskDomain(t);
      return id ? domainById.get(id)?.color ?? null : null;
    },
    taskProject: (t) => (t.project_id ? projectById.get(t.project_id)?.name ?? null : null),
    slotProject: (s) => {
      const p = s.project_id ? projectById.get(s.project_id) : null;
      if (!p) return null;
      return { name: p.name, color: domainById.get(p.domainId)?.color ?? null };
    },
    slotTitle: (s, children) => deriveSlotTitle(s, children, d),
    domains: d.domains.map(({ id, name, color }) => ({ id, name, color })),
  };
}
