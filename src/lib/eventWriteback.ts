/**
 * Writing a provider calendar event back, one event at a time.
 *
 * `external_events` is a cache of Google's (or iCloud's) truth, not a table the
 * outbox owns, so none of the sync layer's ordering applies to it. An edit is
 * two writes: the mirror row (so the grid and every other device move now) and
 * the provider PATCH, whose function then rewrites the row from the provider's
 * answer. Both used to fire the moment the gesture ended. Drag a meeting twice
 * inside a second and the first PATCH's row rewrite could land after the
 * second drag's row write — the block jumped back to where it was a second ago
 * — and Google kept whichever PATCH happened to arrive last, not the one the
 * user made last.
 *
 * So each event gets a lane:
 *
 *  • **One write at a time per event, in order.** The next edit's row write
 *    and PATCH start only when the previous PATCH has answered, so the provider
 *    sees the edits in the order they were made and its last word is the
 *    user's last word.
 *  • **Waiting edits coalesce.** Three drags while one PATCH is out send one
 *    more PATCH carrying the newest times, not three.
 *  • **Echoes of an event being written are not painted.** While a lane is
 *    busy the cache already holds the newest state; a Realtime echo can only
 *    be an older one. After it drains, an echo matching a state this device
 *    wrote and then moved past is still ignored for a few seconds.
 *
 * Plus the server half (`google-events`): its row rewrite only lands if the
 * row still holds the times this write left it at (`rowAt`), so a stale answer
 * from a slow PATCH cannot overwrite a newer edit made anywhere.
 *
 * Creates are tracked here too: the optimistic row has a temporary id, and the
 * real row can arrive by Realtime before the create call returns. Matching it
 * to the waiting temp row swaps one for the other instead of drawing both.
 */

import type { QueryClient } from "@tanstack/react-query";
import type { ExternalEvent } from "./types";

/** The row's times as a write left them — the server's guard for its rewrite. */
export interface EventRowAt {
  start_at: string;
  end_at: string;
}

/** How long an echo of a state this device already moved past is ignored. */
export const STALE_ECHO_MS = 10_000;

// ── Holds ────────────────────────────────────────────────────────────────

const holds = new Map<string, number>();

/** Mark an event as being written until the returned release is called. */
export function holdEvent(id: string): () => void {
  holds.set(id, (holds.get(id) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const n = (holds.get(id) ?? 1) - 1;
    if (n > 0) holds.set(id, n);
    else holds.delete(id);
  };
}

/** True while an edit to this event is between gesture and provider answer. */
export function isEventBeingWritten(id: string): boolean {
  return (holds.get(id) ?? 0) > 0;
}

// ── States this device wrote ─────────────────────────────────────────────

const timeKey = (row: { start_at?: unknown; end_at?: unknown }) =>
  `${Date.parse(String(row.start_at ?? ""))}|${Date.parse(String(row.end_at ?? ""))}`;

const written = new Map<string, { latest: string; older: Set<string>; at: number }>();

/** Record the times a write left an event's row at. */
export function noteEventRow(id: string, rowAt: EventRowAt, now = Date.now()): void {
  const key = timeKey(rowAt);
  const prev = written.get(id);
  const older = new Set(prev && prev.at >= now - STALE_ECHO_MS ? prev.older : []);
  if (prev && prev.latest !== key) older.add(prev.latest);
  older.delete(key);
  written.set(id, { latest: key, older, at: now });
}

/**
 * Whether a Realtime row for this event is older than what this device holds.
 *
 * True while the event is being written (the cache is the newest state), and
 * for `STALE_ECHO_MS` after for a row carrying times this device wrote and then
 * replaced. Anything else — another device, the provider sync — is painted.
 */
export function isStaleEventEcho(
  id: string,
  row: { start_at?: unknown; end_at?: unknown } | null,
  now = Date.now(),
): boolean {
  if (isEventBeingWritten(id)) return true;
  const mine = written.get(id);
  if (!mine || !row) return false;
  if (mine.at < now - STALE_ECHO_MS) {
    written.delete(id);
    return false;
  }
  const key = timeKey(row);
  return key !== mine.latest && mine.older.has(key);
}

// ── The lane ─────────────────────────────────────────────────────────────

export type EventPatch = Record<string, unknown>;

/** Runs one write: `written()` once the mirror row is done, then the PATCH. */
export type EventWriteRun = (patch: EventPatch, written: () => void) => Promise<void>;

interface Item {
  patch: EventPatch;
  coalesce: boolean;
  run: EventWriteRun;
  written: Promise<void>;
  done: Promise<void>;
  markWritten: () => void;
  fail: (e: unknown) => void;
  finish: () => void;
}

const lanes = new Map<string, Item[]>();

function newItem(patch: EventPatch, coalesce: boolean, run: EventWriteRun): Item {
  let markWritten!: () => void;
  let failWritten!: (e: unknown) => void;
  let finish!: () => void;
  let failDone!: (e: unknown) => void;
  let isWritten = false;
  const written = new Promise<void>((res, rej) => {
    markWritten = () => {
      isWritten = true;
      res();
    };
    failWritten = rej;
  });
  const done = new Promise<void>((res, rej) => {
    finish = res;
    failDone = rej;
  });
  // A caller that only awaits one of the two must not leave the other as an
  // unhandled rejection.
  written.catch(() => {});
  done.catch(() => {});
  return {
    patch,
    coalesce,
    run,
    written,
    done,
    markWritten: () => markWritten(),
    fail: (e) => {
      if (!isWritten) failWritten(e);
      failDone(e);
    },
    finish: () => {
      markWritten();
      finish();
    },
  };
}

async function drainLane(id: string) {
  const queue = lanes.get(id);
  if (!queue) return;
  const release = holdEvent(id);
  try {
    while (queue.length) {
      const item = queue[0];
      try {
        await item.run(item.patch, item.markWritten);
        item.finish();
      } catch (e) {
        item.fail(e);
      }
      queue.shift();
    }
  } finally {
    lanes.delete(id);
    release();
  }
}

/**
 * Queue one edit to an event behind any write already out for it.
 *
 * `coalesce` marks a plain single-instance field edit: while it waits, a later
 * coalescing edit folds into it (later fields win) and shares its promises. A
 * series or recurrence edit never merges. The latest `run` is the one used.
 *
 * `written` settles when the edit's mirror-row write has (or would have)
 * happened, `done` when the provider has answered.
 */
export function queueEventWrite(
  id: string,
  patch: EventPatch,
  opts: { coalesce: boolean },
  run: EventWriteRun,
): { written: Promise<void>; done: Promise<void> } {
  const queue = lanes.get(id);
  if (queue) {
    const waiting = queue.length > 1 ? queue[queue.length - 1] : undefined;
    if (waiting && waiting.coalesce && opts.coalesce) {
      waiting.patch = { ...waiting.patch, ...patch };
      waiting.run = run;
      return { written: waiting.written, done: waiting.done };
    }
    const item = newItem(patch, opts.coalesce, run);
    queue.push(item);
    return { written: item.written, done: item.done };
  }
  const item = newItem(patch, opts.coalesce, run);
  lanes.set(id, [item]);
  void drainLane(id);
  return { written: item.written, done: item.done };
}

// ── Creates ──────────────────────────────────────────────────────────────

interface PendingCreate {
  account_id: string;
  title: string;
  all_day: boolean;
  times: string;
}

const pendingCreates = new Map<string, PendingCreate>();

/** Register the optimistic row of a create whose real row has no id yet. */
export function beginEventCreate(temp: ExternalEvent): void {
  pendingCreates.set(temp.id, {
    account_id: temp.account_id,
    title: temp.title.trim(),
    all_day: temp.all_day,
    times: timeKey(temp),
  });
}

export function endEventCreate(tempId: string): void {
  pendingCreates.delete(tempId);
}

/** The row on screen is a create that has not come back yet — it has no real
 *  id to write to, so it cannot be dragged or edited until it does. */
export function isPendingEventCreate(id: string): boolean {
  return pendingCreates.has(id);
}

/** The pending create a just-arrived row is the real version of, if any. */
export function pendingCreateFor(row: Record<string, unknown>): string | undefined {
  const title = String(row.title ?? "").trim();
  for (const [tempId, p] of pendingCreates) {
    if (p.account_id && row.account_id != null && String(row.account_id) !== p.account_id) continue;
    // The function writes "(no title)" for an empty one.
    if (p.title !== title && !(p.title === "" && title === "(no title)")) continue;
    if (Boolean(row.all_day) !== p.all_day) continue;
    // An all-day row's instants are normalised by the provider; the title and
    // account are enough to recognise one we are waiting on.
    if (!p.all_day && timeKey(row) !== p.times) continue;
    return tempId;
  }
  return undefined;
}

/** Does this event belong in the `["external_events", start, end]` cache? */
export function eventInRange(row: object, key: readonly unknown[]): boolean {
  const start = key[1] as string | undefined;
  const end = key[2] as string | undefined;
  if (!start || !end) return true;
  // Compared as instants: a Realtime row says `+00:00` where the key says `Z`.
  const { start_at, end_at } = row as { start_at?: unknown; end_at?: unknown };
  const startAt = Date.parse(String(start_at ?? ""));
  const endAt = Date.parse(String(end_at ?? ""));
  return startAt < Date.parse(end) && endAt > Date.parse(start);
}

/**
 * Replace a create's optimistic row with the real one in every range cache.
 * Where the real row is already present (its echo won the race), the temp row
 * simply goes. Returns whether the temp row was found anywhere.
 */
export function swapCreatedEvent(qc: QueryClient, tempId: string, real: ExternalEvent): boolean {
  let found = false;
  for (const [key, data] of qc.getQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] })) {
    if (!Array.isArray(data)) continue;
    const temp = data.find((e) => e.id === tempId);
    const hasReal = data.some((e) => e.id === real.id);
    const belongs = eventInRange(real, key);
    if (temp) found = true;
    let next: ExternalEvent[] | null = null;
    if (temp && hasReal) next = data.filter((e) => e.id !== tempId);
    // In place, so the block keeps its slot in the list (and its column).
    else if (temp) {
      next = belongs
        ? data.map((e) => (e.id === tempId ? { ...temp, ...real } : e))
        : data.filter((e) => e.id !== tempId);
    } else if (!hasReal && belongs) next = [...data, real];
    if (next) qc.setQueryData(key, next);
  }
  return found;
}

/** Test seam. */
export function resetEventWritebackForTests(): void {
  holds.clear();
  written.clear();
  lanes.clear();
  pendingCreates.clear();
}
