/**
 * Manual order for task lists — the smallest write that expresses a move.
 *
 * `tasks.sort_order` is one global column (a band in the rail, a project's list,
 * a slot's children and a task's steps all read it), and it is a double. So a
 * move doesn't renumber the list: it keeps every row that is already in order
 * and gives only the moved rows a value between their new neighbours. Dragging
 * one task is one write, one outbox op, one Realtime echo — instead of N of each
 * and a list that snaps back while they trickle in.
 *
 * Renumbering is the fallback, for lists that can't express an order at all:
 * ties (every fresh capture lands on the same default) or a gap that has been
 * halved down to nothing. It re-deals the list's OWN values when they are
 * distinct, and spreads densely from the list's floor otherwise — never 0..n,
 * which would clobber the order of rows this list can't see.
 */

export interface Ordered {
  id: string;
  sort_order: number;
}

export interface OrderPatch {
  id: string;
  sort_order: number;
}

/** Below this, midpoints stop being distinguishable after a few more splits. */
const MIN_GAP = 1e-6;

/** Indices (into `vals`) of one longest strictly increasing subsequence. */
function longestIncreasing(vals: number[]): Set<number> {
  const tails: number[] = [];
  const tailIdx: number[] = [];
  const prev = new Array<number>(vals.length).fill(-1);
  vals.forEach((v, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = v;
    tailIdx[lo] = i;
    prev[i] = lo > 0 ? tailIdx[lo - 1] : -1;
  });
  const keep = new Set<number>();
  let k = tailIdx[tails.length - 1] ?? -1;
  while (k >= 0) {
    keep.add(k);
    k = prev[k];
  }
  return keep;
}

function renumber(rows: Ordered[], nextIds: string[]): OrderPatch[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sorted = rows.map((r) => r.sort_order).sort((a, b) => a - b);
  const distinct = new Set(sorted).size === sorted.length;
  const base = sorted[0] ?? 0;
  const vals = distinct ? sorted : sorted.map((_, i) => base + i);
  const out: OrderPatch[] = [];
  nextIds.forEach((id, i) => {
    const row = byId.get(id);
    if (row && row.sort_order !== vals[i]) out.push({ id, sort_order: vals[i] });
  });
  return out;
}

/**
 * The writes that make `rows` read in `nextIds` order.
 *
 * `rows` are the list's current rows (any order); `nextIds` is the order the
 * user just asked for. Ids in `nextIds` that aren't in `rows` are ignored.
 */
export function orderPatches(rows: Ordered[], nextIds: string[]): OrderPatch[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ids = nextIds.filter((id) => byId.has(id));
  if (ids.length < 2) return [];
  const vals = ids.map((id) => byId.get(id)!.sort_order);

  const keep = longestIncreasing(vals);
  if (keep.size === ids.length) return [];

  const assigned = vals.slice();
  let i = 0;
  while (i < ids.length) {
    if (keep.has(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j < ids.length && !keep.has(j)) j++;
    // ids[i..j-1] are displaced; their neighbours are kept rows (or the ends).
    const lo = i > 0 ? assigned[i - 1] : null;
    const hi = j < ids.length ? assigned[j] : null;
    const run = j - i;
    for (let k = 0; k < run; k++) {
      if (lo != null && hi != null) assigned[i + k] = lo + ((hi - lo) * (k + 1)) / (run + 1);
      else if (lo != null) assigned[i + k] = lo + (k + 1);
      else if (hi != null) assigned[i + k] = hi - (run - k);
      else assigned[i + k] = k;
    }
    i = j;
  }

  for (let k = 1; k < assigned.length; k++) {
    if (!(assigned[k] - assigned[k - 1] > MIN_GAP)) return renumber(rows, ids);
  }

  const out: OrderPatch[] = [];
  ids.forEach((id, k) => {
    if (assigned[k] !== vals[k]) out.push({ id, sort_order: assigned[k] });
  });
  return out;
}

/** `ids` with `id` moved `by` places (clamped). Null when it can't move. */
export function shiftId(ids: string[], id: string, by: number): string[] | null {
  const from = ids.indexOf(id);
  if (from < 0) return null;
  const to = Math.max(0, Math.min(ids.length - 1, from + by));
  if (to === from) return null;
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
