/**
 * Per-user write epoch — what keeps Hyperdrive from serving a stale list
 * after a write (D-249).
 *
 * Hyperdrive config `2c523431` caches cacheable SELECTs for max_age ~60s
 * plus stale_while_revalidate ~15s, and does **not** invalidate on writes.
 * REST list bodies no longer select `now()`, so they are cacheable — and a
 * client that writes then refetches (every shipped iOS/desktop build) would
 * otherwise get the pre-write list and overwrite optimistic state.
 *
 * After a write for an account we mark it fresh for `WRITE_FRESH_MS`. A REST
 * GET/HEAD in that window appends `now() IS NOT NULL`, which Hyperdrive
 * treats as uncacheable (STABLE). Past the window the same SQL is cacheable
 * again; the previous cache entry has expired.
 *
 * Isolate memory is the same-request / same-isolate path. The Cache API
 * carries the mark across isolates in the colo (the write response waits on
 * the put, so the client's next GET sees it). Node check scripts have no
 * Cache API — isolate memory is enough because write and read share a process.
 */
export const WRITE_FRESH_MS = 90_000;

/** Appended to REST SELECTs while the row must not come from Hyperdrive. */
export const HYPERDRIVE_BYPASS = "now() IS NOT NULL";

const ALL = "*";
const PUSH_EMPTY = "push-empty";
const CACHE_ORIGIN = "https://nuvo.internal/write-fresh";

const local = new Map<string, number>();
let pushEmptyLocal = false;

function cachesDefault(): Cache | null {
  try {
    const api = (globalThis as { caches?: { default?: Cache } }).caches;
    return api?.default ?? null;
  } catch {
    return null;
  }
}

function freshRequest(id: string): Request {
  return new Request(`${CACHE_ORIGIN}/${id}`, { method: "GET" });
}

function freshResponse(at: number): Response {
  return new Response(String(at), {
    headers: { "Cache-Control": `max-age=${Math.ceil(WRITE_FRESH_MS / 1000)}` },
  });
}

export function resetWriteFreshnessForTests(): void {
  local.clear();
  pushEmptyLocal = false;
}

export function noteUserWrites(poke: { users?: string[]; all?: boolean }, at = Date.now()): void {
  pushEmptyLocal = false;
  if (poke.all) local.set(ALL, at);
  for (const u of poke.users ?? []) {
    if (typeof u === "string" && u) local.set(u, at);
  }
}

/** Awaited on the write response path so a later GET in this colo sees the mark. */
export async function persistWriteFreshness(poke: { users?: string[]; all?: boolean }, at = Date.now()): Promise<void> {
  noteUserWrites(poke, at);
  const cache = cachesDefault();
  if (!cache) return;
  try {
    const puts: Promise<unknown>[] = [cache.delete(freshRequest(PUSH_EMPTY))];
    if (poke.all) puts.push(cache.put(freshRequest(ALL), freshResponse(at)));
    for (const u of poke.users ?? []) {
      if (typeof u === "string" && u) puts.push(cache.put(freshRequest(u), freshResponse(at)));
    }
    await Promise.all(puts);
  } catch {
    /* Cache API is a hint; isolate memory still holds on this Worker. */
  }
}

export function userWroteRecently(userId: string, now = Date.now()): boolean {
  const allAt = local.get(ALL);
  if (allAt != null && now - allAt < WRITE_FRESH_MS) return true;
  const at = local.get(userId);
  return at != null && now - at < WRITE_FRESH_MS;
}

export async function userWroteRecentlyAsync(userId: string, now = Date.now()): Promise<boolean> {
  if (userWroteRecently(userId, now)) return true;
  const cache = cachesDefault();
  if (!cache) return false;
  try {
    const hit = (await cache.match(freshRequest(userId))) ?? (await cache.match(freshRequest(ALL)));
    if (!hit) return false;
    const at = Number(await hit.text());
    if (!Number.isFinite(at) || now - at >= WRITE_FRESH_MS) return false;
    local.set(hit.url.endsWith(`/${ALL}`) ? ALL : userId, at);
    return true;
  } catch {
    return false;
  }
}

export async function freshnessSql(userId: string): Promise<string> {
  return (await userWroteRecentlyAsync(userId)) ? ` AND ${HYPERDRIVE_BYPASS}` : "";
}

export function markPushListingEmpty(): void {
  pushEmptyLocal = true;
  const cache = cachesDefault();
  if (!cache) return;
  void cache
    .put(
      freshRequest(PUSH_EMPTY),
      new Response("1", { headers: { "Cache-Control": "max-age=3600" } }),
    )
    .catch(() => undefined);
}

export async function pushListingIsEmpty(): Promise<boolean> {
  if (pushEmptyLocal) return true;
  const cache = cachesDefault();
  if (!cache) return false;
  try {
    const hit = await cache.match(freshRequest(PUSH_EMPTY));
    if (!hit) return false;
    pushEmptyLocal = true;
    return true;
  } catch {
    return false;
  }
}
