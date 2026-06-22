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

export interface Batch {
  id: string;
  name: string;
  energy: Energy;
  taskIds: string[];
  durationMins: number;
  deadline: string | null;
  initiativeId: string | null;
  domainId: string | null;
  color: string | null;
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

type Cls = "deep" | "decide" | "shallow";
const classOf = (e: Energy | null): Cls => (e === "deep" ? "deep" : e === "decide" ? "decide" : "shallow");

function resolveDomainId(data: VerticalData, t: Task): string | null {
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

function makeBatch(members: Task[], cls: Cls, data: VerticalData, seq: number): Batch {
  const durationMins = members.reduce((s, t) => s + (t.duration_minutes ?? 30), 0);
  const deadline = members.map((t) => t.deadline).filter((d): d is string => !!d).sort()[0] ?? null;
  const domainId = mostCommon(members.map((t) => resolveDomainId(data, t)));
  const domain = domainById(data, domainId);
  const initiativeId = mostCommon(members.map((t) => t.initiative_id));
  const projectId = mostCommon(members.map((t) => t.project_id));
  const base = projectById(data, projectId)?.name ?? initiativeById(data, initiativeId)?.name ?? domain?.name ?? "Work";
  const energy: Energy = cls === "deep" ? "deep" : cls === "decide" ? "decide" : "quick";
  const name = cls === "shallow"
    ? (domain ? `${domain.name} admin` : "Admin batch")
    : `${cls === "deep" ? "Deep" : "Decide"} · ${base}`;
  return { id: `batch-${seq}`, name, energy, taskIds: members.map((t) => t.id), durationMins, deadline, initiativeId, domainId, color: domain?.color ?? null };
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

  // deep & decide: keep each context (project / initiative / domain) together
  for (const cls of ["deep", "decide"] as const) {
    const pool = tasks.filter((t) => classOf(t.energy) === cls);
    const groups = groupBy(pool, (t) => t.project_id ?? t.initiative_id ?? resolveDomainId(data, t) ?? "loose");
    for (const members of groups) {
      members.sort((a, b) => a.sort_order - b.sort_order);
      for (const c of chunkByCap(members, cls === "deep" ? CAP_DEEP : CAP_DECIDE)) batches.push(makeBatch(c, cls, data, seq++));
    }
  }
  // shallow: batch all the small stuff across projects, by domain (one context)
  const shallow = tasks.filter((t) => classOf(t.energy) === "shallow");
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
  return {
    id: `inbox-${seq}`,
    name: part ? `${name} (${part})` : name,
    energy,
    taskIds: members.map((t) => t.id),
    durationMins,
    deadline,
    initiativeId,
    domainId,
    color: domain?.color ?? null,
  };
}

// A placeholder the composer can place — only its scheduling fields are read.
function synthTask(b: Batch, idx: number): Task {
  return {
    id: b.id,
    title: b.name,
    energy: b.energy,
    duration_minutes: b.durationMins,
    deadline: b.deadline,
    initiative_id: b.initiativeId,
    project_id: null,
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

/** Theme & slot the inbox: take AI-grouped runs, build a focus-block batch per
 *  run (chunked to one sitting), and let composeWeek place them in open time. */
export function aiBatchInbox(
  args: PlaceArgs & { groups: InboxGroup[]; tasks: Task[]; data: VerticalData },
): BatchResult {
  const byId = new Map(args.tasks.map((t) => [t.id, t]));
  const batches: Batch[] = [];
  let seq = 0;
  for (const g of args.groups) {
    const members = g.taskIds.map((id) => byId.get(id)).filter((t): t is Task => !!t);
    if (!members.length) continue;
    members.sort((a, b) => a.sort_order - b.sort_order);
    const cls = classOf(g.energy);
    const cap = cls === "deep" ? CAP_DEEP : cls === "decide" ? CAP_DECIDE : CAP_SHALLOW;
    const chunks = chunkByCap(members, cap);
    chunks.forEach((c, i) => batches.push(makeInboxBatch(c, g.energy, g.name, args.data, seq++, chunks.length > 1 ? i + 1 : 0)));
  }
  return placeBatches(batches, args);
}
