/**
 * Changes-only reads for the lists that used to re-download themselves on
 * every focus (D-249).
 *
 * The Worker answers `Prefer: nuvo-delta` + `nuvo_since` with
 * `{ updated, ids, read_at }`: rows newer than the cursor, plus every identity
 * still matching the filters. A missing id is a delete or a move-out — there
 * is no tombstone column. Old Workers (and PostgREST) 400 the unknown Prefer;
 * we fall back to the full array for the rest of the session.
 *
 * Shipped clients never send either, so the server change is additive.
 */

import { workersEnabled } from "../backend";
import { restRequest } from "../supabase";

export type DeltaIdentity<T> = (row: T) => string;

export type DeltaBody<T> =
  | { reset: true; read_at?: string }
  | { updated: T[]; ids: string[]; read_at?: string };

const cursors = new Map<string, string>();
let deltaSupported: boolean | null = null;

export function resetDeltaCursorsForTests(): void {
  cursors.clear();
  deltaSupported = null;
}

export function mergeDelta<T>(
  prev: T[],
  updated: T[],
  ids: string[],
  identity: DeltaIdentity<T>,
): T[] {
  const live = new Set(ids);
  const byId = new Map<string, T>();
  for (const row of prev) {
    const id = identity(row);
    if (live.has(id)) byId.set(id, row);
  }
  for (const row of updated) byId.set(identity(row), row);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of prev) {
    const id = identity(row);
    if (!live.has(id) || seen.has(id)) continue;
    const next = byId.get(id);
    if (!next) continue;
    out.push(next);
    seen.add(id);
  }
  for (const id of ids) {
    if (seen.has(id)) continue;
    const row = byId.get(id);
    if (!row) continue;
    out.push(row);
    seen.add(id);
  }
  return out;
}

function remember(cursorKey: string, iso: string | null | undefined): void {
  if (iso && /^\d{4}-\d{2}-\d{2}T/.test(iso)) cursors.set(cursorKey, iso);
}

/** After a full read we don't see X-Read-At; overlap a couple of seconds so a
 *  write that committed during the round-trip is not skipped on the next delta. */
function overlapCursor(): string {
  return new Date(Date.now() - 2_000).toISOString();
}

export interface FetchWithDeltaOpts<T> {
  table: string;
  search: URLSearchParams;
  cursorKey: string;
  identity: DeltaIdentity<T>;
  prev: T[] | undefined;
  full: () => Promise<T[]>;
  request?: (pathAndQuery: string, init?: RequestInit) => Promise<Response>;
}

export async function fetchWithDelta<T>(opts: FetchWithDeltaOpts<T>): Promise<T[]> {
  const since = cursors.get(opts.cursorKey);
  const canDelta =
    workersEnabled &&
    deltaSupported !== false &&
    typeof since === "string" &&
    Array.isArray(opts.prev);

  if (canDelta) {
    const params = new URLSearchParams(opts.search);
    params.set("nuvo_since", since);
    try {
      const request = opts.request ?? restRequest;
      const res = await request(`${opts.table}?${params.toString()}`, {
        headers: { Prefer: "nuvo-delta", Accept: "application/json" },
      });
      if (res.status === 400 || res.status === 404) {
        deltaSupported = false;
      } else if (res.ok && res.headers.get("x-nuvo-delta") === "1") {
        deltaSupported = true;
        const body = (await res.json()) as DeltaBody<T>;
        const readAt = ("read_at" in body ? body.read_at : undefined) ?? res.headers.get("x-read-at");
        if ("reset" in body && body.reset) {
          cursors.delete(opts.cursorKey);
          const rows = await opts.full();
          remember(opts.cursorKey, readAt ?? overlapCursor());
          return rows;
        }
        if ("updated" in body && Array.isArray(body.updated) && Array.isArray(body.ids)) {
          remember(opts.cursorKey, readAt);
          return mergeDelta(opts.prev ?? [], body.updated, body.ids, opts.identity);
        }
      }
    } catch {
      // A network blip: the full read below is the same as before this path.
    }
  }

  const rows = await opts.full();
  remember(opts.cursorKey, overlapCursor());
  return rows;
}
