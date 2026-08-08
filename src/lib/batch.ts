// The week batcher — cluster the committed week into a few named focus blocks
// (Slots), then let the deterministic composer place them. The split of labor:
// clustering is judgment (which tasks belong together), placement is
// constraint-satisfaction (fit, breaks, peak/trough) — composeWeek's job.
//
// v1 clusters deterministically: deep/decide work stays per-context (project →
// initiative → domain) and capped to one focus block; shallow work (quick /
// delegate) is batched across projects by domain into "admin" runs. Each batch
// becomes a synthetic block the composer places with all its rules; the result
// maps back to real Slot rows that hold the member tasks. (AI naming/clustering
// can layer on later — see nuvo-intelligent-ordering.)

import type { ExternalEvent, Task } from "./types";
import type { Energy } from "./energy";
import { composeWeek, type DayContext } from "./compose";
import { domainById, initiativeById, projectById, type VerticalData } from "./vertical";
import { titleCase } from "./text";

export interface Batch {
  id: string;
  name: string;
  energy: Energy;
  taskIds: string[];
  durationMins: number;
  deadline: string | null;
  initiativeId: string | null;
  /** set when every member belongs to one project — this batch IS a project slot */
  projectId: string | null;
  domainId: string | null;
  color: string | null;
  /** The name without any "· Part n" suffix — what a surface shows when it's
   *  already saying which part this is somewhere else. */
  baseName?: string;
  /** A project too big for one sitting earns several. These say which, so two
   *  blocks with the same project name aren't a mystery: you're looking at one
   *  project split, in order, not the same work twice. */
  part?: number;
  parts?: number;
}

export interface BatchPlacement {
  batch: Batch;
  dayISO: string;
  startMin: number;
  durationMin: number;
  reason: string;
}

export interface BatchResult {
  placed: BatchPlacement[];
  unplaced: Batch[];
}

// focus-block caps (minutes): a batch never exceeds one sitting
const CAP_DEEP = 100;
const CAP_DECIDE = 90;
const CAP_SHALLOW = 60;
/** One sitting on a project. Past this it stops being a sitting and becomes a
 *  day — so a bigger project simply earns a second slot. */
const CAP_PROJECT = 120;

type Cls = "deep" | "decide" | "shallow";
const classOf = (e: Energy | null): Cls => (e === "deep" ? "deep" : e === "decide" ? "decide" : "shallow");

export function resolveDomainId(data: VerticalData, t: Task): string | null {
  return (
    t.domain_id ??
    projectById(data, t.project_id)?.domainId ??
    initiativeById(data, t.initiative_id)?.domainId ??
    null
  );
}

function chunkByCap(tasks: Task[], cap: number): Task[][] {
  const out: Task[][] = [];
  let cur: Task[] = [];
  let mins = 0;
  for (const t of tasks) {
    const d = t.duration_minutes ?? 30;
    if (cur.length && mins + d > cap) { out.push(cur); cur = []; mins = 0; }
    cur.push(t);
    mins += d;
  }
  if (cur.length) out.push(cur);
  return out;
}

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [k, c] of counts) if (c > n) { best = k; n = c; }
  return best;
}

/** `nameOverride` — a project slot is named for its project, full stop. Without
 *  it the name came from the energy class ("Deep · X", "<domain> admin"), which
 *  told you how it feels to do rather than what it moves. */
function makeBatch(members: Task[], cls: Cls, data: VerticalData, seq: number, nameOverride?: string): Batch {
  const durationMins = members.reduce((s, t) => s + (t.duration_minutes ?? 30), 0);
  const deadline = members.map((t) => t.deadline).filter((d): d is string => !!d).sort()[0] ?? null;
  const domainId = mostCommon(members.map((t) => resolveDomainId(data, t)));
  const domain = domainById(data, domainId);
  const initiativeId = mostCommon(members.map((t) => t.initiative_id));
  const projectId = mostCommon(members.map((t) => t.project_id));
  const base = projectById(data, projectId)?.name ?? initiativeById(data, initiativeId)?.name ?? domain?.name ?? "Work";
  const energy: Energy = cls === "deep" ? "deep" : cls === "decide" ? "decide" : "quick";
  const name = nameOverride
    ?? (cls === "shallow"
      ? (domain ? `${domain.name} admin` : "Admin batch")
      : `${cls === "deep" ? "Deep" : "Decide"} · ${base}`);
  return { id: `batch-${seq}`, name, energy, taskIds: members.map((t) => t.id), durationMins, deadline, initiativeId, projectId, domainId, color: domain?.color ?? null };
}

/** Cluster the week's committed tasks into named focus-block batches. */
export function clusterWeek(tasks: Task[], data: VerticalData): Batch[] {
  const batches: Batch[] = [];
  let seq = 0;
  const groupBy = (pool: Task[], keyOf: (t: Task) => string): Task[][] => {
    const m = new Map<string, Task[]>();
    for (const t of pool) {
      const k = keyOf(t);
      const arr = m.get(k);
      if (arr) arr.push(t);
      else m.set(k, [t]);
    }
    return [...m.values()];
  };

  // 1 · PROJECT WORK → a project slot per project, energy be damned.
  //
  // A project's sitting is the unit: its steps belong together because they move
  // the same thing, not because they share an energy tag. Grouping by energy
  // FIRST meant a project only earned a slot if its steps happened to be tagged
  // deep/decide — anything `quick` (which is most captured work, and everything
  // an AI drafts) fell through to a shallow "<domain> admin" run and scattered.
  // That's why one project read as a named slot and its neighbours didn't.
  const projectWork = tasks.filter((t) => t.project_id);
  for (const members of groupBy(projectWork, (t) => t.project_id!)) {
    members.sort((a, b) => a.sort_order - b.sort_order);
    const name = projectById(data, members[0].project_id ?? null)?.name;
    // the sitting takes the most demanding energy present, so it lands in the
    // window its hardest step deserves
    const cls: Cls = members.some((t) => classOf(t.energy) === "deep")
      ? "deep"
      : members.some((t) => classOf(t.energy) === "decide")
        ? "decide"
        : "shallow";
    // A project bigger than one sitting earns several — numbered, so the week
    // reads as "part 1 then part 2" rather than the same title twice.
    const chunks = chunkByCap(members, CAP_PROJECT);
    chunks.forEach((c, i) => {
      const b = makeBatch(c, cls, data, seq++, name);
      b.baseName = b.name;
      if (chunks.length > 1) {
        b.part = i + 1;
        b.parts = chunks.length;
        b.name = `${b.name} · Part ${i + 1}`;
      }
      batches.push(b);
    });
  }

  // 2 · everything else has no project to belong to, so energy decides its company.
  const loose = tasks.filter((t) => !t.project_id);
  for (const cls of ["deep", "decide"] as const) {
    const pool = loose.filter((t) => classOf(t.energy) === cls);
    const groups = groupBy(pool, (t) => t.initiative_id ?? resolveDomainId(data, t) ?? "loose");
    for (const members of groups) {
      members.sort((a, b) => a.sort_order - b.sort_order);
      for (const c of chunkByCap(members, cls === "deep" ? CAP_DEEP : CAP_DECIDE)) batches.push(makeBatch(c, cls, data, seq++));
    }
  }
  // shallow: batch the small loose stuff by domain (one context)
  const shallow = loose.filter((t) => classOf(t.energy) === "shallow");
  for (const members of groupBy(shallow, (t) => resolveDomainId(data, t) ?? "loose")) {
    members.sort((a, b) => a.sort_order - b.sort_order);
    for (const c of chunkByCap(members, CAP_SHALLOW)) batches.push(makeBatch(c, "shallow", data, seq++));
  }
  return batches;
}

/** Build a batch from an explicit group (AI-themed inbox run): keep the given
 *  name + energy, derive the rest (duration, domain, color) from the members. */
function makeInboxBatch(members: Task[], energy: Energy, name: string, data: VerticalData, seq: number, part: number): Batch {
  const durationMins = members.reduce((s, t) => s + (t.duration_minutes ?? 30), 0);
  const deadline = members.map((t) => t.deadline).filter((d): d is string => !!d).sort()[0] ?? null;
  const domainId = mostCommon(members.map((t) => resolveDomainId(data, t)));
  const domain = domainById(data, domainId);
  const initiativeId = mostCommon(members.map((t) => t.initiative_id));
  const display = titleCase(name);
  return {
    id: `inbox-${seq}`,
    name: part ? `${display} (${part})` : display,
    energy,
    taskIds: members.map((t) => t.id),
    durationMins,
    deadline,
    initiativeId,
    projectId: null, // an inbox run is loose by definition
    domainId,
    color: domain?.color ?? null,
  };
}

// A placeholder the composer can place — only its scheduling fields are read.
/** A batch as a placeable stand-in, so the composer can treat a whole sitting as
 *  one block. `project_id` rides along: a project slot must sort and size like the
 *  project work it holds (and render as a project slot). */
export function synthTask(b: Batch, idx: number): Task {
  return {
    id: b.id,
    title: b.name,
    energy: b.energy,
    duration_minutes: b.durationMins,
    deadline: b.deadline,
    initiative_id: b.initiativeId,
    project_id: b.projectId,
    domain_id: b.domainId,
    sort_order: idx,
    start_time: null,
    status: "backlog",
  } as unknown as Task;
}

interface PlaceArgs {
  weekStartISO: string;
  todayISO: string;
  now: Date;
  events: ExternalEvent[];
  blocks: Task[];
  workStartMin: number;
  workEndMin: number;
  focusInitiativeIds: string[];
  dayContexts: Record<string, DayContext>;
  workingDays: number[];
}

/** Hand a set of batches to the deterministic composer and map placements back
 *  to their batches — the shared tail of both the deterministic and AI paths. */
function placeBatches(batches: Batch[], args: PlaceArgs): BatchResult {
  const synth = batches.map((b, i) => synthTask(b, i));
  const res = composeWeek({
    weekStartISO: args.weekStartISO,
    todayISO: args.todayISO,
    now: args.now,
    tasks: synth,
    events: args.events,
    blocks: args.blocks,
    workStartMin: args.workStartMin,
    workEndMin: args.workEndMin,
    focusInitiativeIds: args.focusInitiativeIds,
    dayContexts: args.dayContexts,
    workingDays: args.workingDays,
    weeklyBudgetMins: null,
  });
  const byId = new Map(batches.map((b) => [b.id, b]));
  const placed: BatchPlacement[] = res.placements
    .map((p) => {
      const batch = byId.get(p.task.id);
      return batch ? { batch, dayISO: p.dayISO, startMin: p.startMin, durationMin: p.durationMin, reason: p.reason } : null;
    })
    .filter((x): x is BatchPlacement => x !== null);
  const placedIds = new Set(placed.map((x) => x.batch.id));
  return { placed, unplaced: batches.filter((b) => !placedIds.has(b.id)) };
}

export function batchWeek(args: PlaceArgs & { tasks: Task[]; data: VerticalData }): BatchResult {
  return placeBatches(clusterWeek(args.tasks, args.data), args);
}

/** An AI-themed inbox run as returned by the `clusterInbox` edge function. */
export interface InboxGroup {
  name: string;
  energy: Energy;
  taskIds: string[];
}

/** Turn AI-grouped runs into focus-block batches (each chunked to one sitting).
 *  Clustering only — the caller decides where they land, so a run can join the
 *  draft on the board (movable) instead of being placed behind its own back. */
export function clusterInboxRuns(groups: InboxGroup[], tasks: Task[], data: VerticalData): Batch[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const batches: Batch[] = [];
  let seq = 0;
  for (const g of groups) {
    const members = g.taskIds.map((id) => byId.get(id)).filter((t): t is Task => !!t);
    if (!members.length) continue;
    members.sort((a, b) => a.sort_order - b.sort_order);
    const cls = classOf(g.energy);
    const cap = cls === "deep" ? CAP_DEEP : cls === "decide" ? CAP_DECIDE : CAP_SHALLOW;
    const chunks = chunkByCap(members, cap);
    chunks.forEach((c, i) => batches.push(makeInboxBatch(c, g.energy, g.name, data, seq++, chunks.length > 1 ? i + 1 : 0)));
  }
  return batches;
}

/** Theme & slot the inbox: take AI-grouped runs, build a focus-block batch per
 *  run (chunked to one sitting), and let composeWeek place them in open time. */
export function aiBatchInbox(
  args: PlaceArgs & { groups: InboxGroup[]; tasks: Task[]; data: VerticalData },
): BatchResult {
  const batches = clusterInboxRuns(args.groups, args.tasks, args.data);
  return placeBatches(batches, args);
}
