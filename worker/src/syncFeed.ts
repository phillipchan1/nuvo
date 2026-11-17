/**
 * The change feed — how a device learns what another device changed, without
 * re-downloading every list to find out (D-238).
 *
 * The Worker path has no Realtime, so the client used to keep up by refetching:
 * every stale query on every window focus, every task / slot / label list once a
 * minute, and every task list after each of its own writes. On a lived-in
 * account that was ~1.5 GB a day of Neon data transfer from one open Mac.
 *
 * One read RPC, `sync_changes`, answers "what moved since I last asked" in one of
 * two shapes, so the client works against a Neon that has or hasn't had the
 * change log applied yet (the schema is applied by hand — D-152's rule):
 *
 *  • **delta** — `sync_changes` (the table, `worker/schema/neon.sql`) exists. A
 *    row trigger on every synced table appends `(user, table, key)` on every
 *    insert / update / delete, whoever the writer is (the SPA, the agent, MCP,
 *    capture, calendar sync, the crons). The feed returns the CURRENT row for
 *    every key that moved after the cursor, or a DELETE for a key that no
 *    longer exists — a hard delete needs no tombstone column, because "the key
 *    moved and the row is gone" is the tombstone.
 *  • **version** — no log yet. A per-table fingerprint (row count + a sum of
 *    row hashes) computed in Postgres. Only a few hundred bytes leave Neon; the
 *    client refetches just the tables whose fingerprint moved.
 *
 * The cursor is the log's global `seq`. Identity values are handed out at
 * insert and become visible at commit, so a reader can see 11 before 10. The
 * cursor therefore only advances to the newest seq inserted more than
 * `SETTLE_SECONDS` ago; anything newer is sent again next time (applying the
 * current row twice is harmless). A transaction that stays open longer than
 * that window could still be skipped — no Worker write runs that long.
 *
 * Nothing here is cached by Hyperdrive: every statement calls a STABLE or
 * VOLATILE function (`now()` / `clock_timestamp()`), the same rule `rest.ts`
 * holds for the SPA's reads.
 */
import type { Sql } from "./db.ts";

/** The tables the feed covers: the outbox's tables, plus provider events and
 *  their domain routing. `src/lib/sync/liveKeys.ts` holds the same list. */
export const FEED_TABLES = [
  "tasks",
  "task_labels",
  "projects",
  "initiatives",
  "domains",
  "key_results",
  "slots",
  "labels",
  "user_settings",
  "record_comments",
  "week_reviews",
  "sprints",
  "recurrences",
  "reminders",
  "external_events",
  "event_domain_routing",
] as const;

export type FeedTable = (typeof FEED_TABLES)[number];

/** Distinct keys one answer carries before it says "refetch instead". */
export const FEED_LIMIT = 1000;

/** How long a log row must have existed before the cursor may pass it. */
export const SETTLE_SECONDS = 30;

/** Columns a feed row never carries: what the client's own reads don't select. */
const OMIT: Partial<Record<FeedTable, readonly string[]>> = {
  // The provider's full payload — the client reads description through its own
  // detail query, never through the range lists.
  external_events: ["raw", "content_hash"],
  // Rotated only by its RPC; the client never needs it in the cache.
  user_settings: ["inbound_token"],
};

export interface FeedChange {
  table: FeedTable;
  eventType: "UPDATE" | "DELETE";
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
}

export type FeedAnswer =
  | { mode: "delta"; cursor: string; reset: boolean; changes: FeedChange[] }
  | { mode: "version"; versions: Record<string, string> };

// ---------------------------------------------------------------------------
// Which tables exist — a Neon without the log (or a thin local DB) still answers
// ---------------------------------------------------------------------------

const PRESENT_TTL_MS = 5 * 60 * 1000;
let presentCache: { at: number; value: Promise<Set<string>> } | null = null;

export function resetSyncFeedForTests(): void {
  presentCache = null;
}

async function presentTables(sql: Sql): Promise<Set<string>> {
  const now = Date.now();
  if (presentCache && now - presentCache.at < PRESENT_TTL_MS) return presentCache.value;
  const names = [...FEED_TABLES, "sync_changes"];
  const value = sql
    .unsafe<{ relname: string }[]>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND c.relname = ANY (CAST($1 AS text[])) AND now() IS NOT NULL`,
      [names],
    )
    .then((rows) => new Set(rows.map((r) => r.relname)));
  presentCache = { at: now, value };
  value.catch(() => {
    if (presentCache?.value === value) presentCache = null;
  });
  return value;
}

/** The owner clause for `x`, aliased; `$1` is always the session's user id. */
function ownedFrom(table: FeedTable): string {
  if (table === "task_labels") {
    return `public.task_labels x JOIN public.tasks o ON o.id = x.task_id WHERE o.user_id = $1`;
  }
  return `public.${table} x WHERE x.user_id = $1`;
}

/** The SQL text of a row's feed key — what the trigger writes as `row_key`. */
function keySql(table: FeedTable): string {
  if (table === "task_labels") return `(x.task_id::text || ':' || x.label_id::text)`;
  if (table === "user_settings") return `x.user_id::text`;
  // Keyed (user_id, event_key) in production, with no `id` column — must match
  // the trigger in worker/schema/neon.sql.
  if (table === "event_domain_routing") return `x.event_key`;
  return `x.id::text`;
}

function rowJson(table: FeedTable): string {
  const omit = OMIT[table] ?? [];
  return omit.reduce((acc, col) => `${acc} - '${col}'`, "to_jsonb(x)");
}

// ---------------------------------------------------------------------------
// version mode
// ---------------------------------------------------------------------------

async function versions(sql: Sql, userId: string, present: Set<string>): Promise<Record<string, string>> {
  const tables = FEED_TABLES.filter((t) => present.has(t) && (t !== "task_labels" || present.has("tasks")));
  if (!tables.length) return {};
  const parts = tables.map(
    (t) =>
      `SELECT '${t}' AS tbl, count(*)::text || '.' || coalesce(sum(hashtext(x::text)::bigint), 0)::text AS v
         FROM ${ownedFrom(t)}`,
  );
  const rows = await sql.unsafe<{ tbl: string; v: string }[]>(
    `SELECT tbl, v FROM (${parts.join(" UNION ALL ")}) s WHERE now() IS NOT NULL`,
    [userId],
  );
  return Object.fromEntries(rows.map((r) => [r.tbl, r.v]));
}

// ---------------------------------------------------------------------------
// delta mode
// ---------------------------------------------------------------------------

function parseCursor(raw: unknown): bigint | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw).trim();
  if (!/^\d{1,19}$/.test(text)) return null;
  return BigInt(text);
}

const big = (v: string | null | undefined): bigint | null => (v == null ? null : BigInt(v));
const maxBig = (a: bigint, b: bigint | null) => (b != null && b > a ? b : a);

async function rowsFor(
  sql: Sql,
  userId: string,
  table: FeedTable,
  keys: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const rows = await sql.unsafe<{ k: string; r: Record<string, unknown> }[]>(
    `SELECT ${keySql(table)} AS k, ${rowJson(table)} AS r
       FROM ${ownedFrom(table)}
        AND ${keySql(table)} = ANY (CAST($2 AS text[]))
        AND now() IS NOT NULL`,
    [userId, keys],
  );
  return new Map(rows.map((row) => [row.k, typeof row.r === "string" ? JSON.parse(row.r) : row.r]));
}

/** The key a DELETE names, in the shape `applyLiveChange` reads off `old`. */
function oldFor(table: FeedTable, key: string, userId: string): Record<string, unknown> {
  if (table === "task_labels") {
    const [task_id, label_id] = key.split(":");
    return { task_id, label_id };
  }
  if (table === "user_settings") return { user_id: userId };
  return { id: key };
}

async function delta(sql: Sql, userId: string, present: Set<string>, sinceRaw: unknown): Promise<FeedAnswer> {
  const [bounds] = await sql.unsafe<{ lo: string | null; hi: string | null; settled: string | null }[]>(
    `SELECT (SELECT min(seq) FROM public.sync_changes)::text AS lo,
            (SELECT max(seq) FROM public.sync_changes)::text AS hi,
            (SELECT seq FROM public.sync_changes
              WHERE at < clock_timestamp() - make_interval(secs => ${SETTLE_SECONDS})
              ORDER BY seq DESC LIMIT 1)::text AS settled`,
  );
  const lo = big(bounds?.lo);
  const hi = big(bounds?.hi);
  const settled = big(bounds?.settled);
  // Where a device starts when it has nothing to compare against: just before
  // the oldest row that might still be on the wire.
  const fresh = settled ?? (lo != null ? lo - 1n : 0n);
  const since = parseCursor(sinceRaw);

  // Unknown cursor, one older than what the log still holds, or one from a
  // different database (a restore): refetch everything, start from here.
  if (since == null || (lo != null && since < lo - 1n) || (hi != null && since > hi) || (hi == null && since > 0n)) {
    return { mode: "delta", cursor: fresh.toString(), reset: true, changes: [] };
  }

  const moved = await sql.unsafe<{ tbl: string; row_key: string }[]>(
    `SELECT tbl, row_key FROM public.sync_changes
      WHERE user_id = $1 AND seq > CAST($2 AS bigint) AND clock_timestamp() IS NOT NULL
      GROUP BY tbl, row_key
      ORDER BY max(seq)
      LIMIT ${FEED_LIMIT + 1}`,
    [userId, since.toString()],
  );
  const cursor = maxBig(since, settled).toString();
  if (moved.length > FEED_LIMIT) return { mode: "delta", cursor, reset: true, changes: [] };

  const byTable = new Map<FeedTable, string[]>();
  for (const m of moved) {
    const table = m.tbl as FeedTable;
    if (!(FEED_TABLES as readonly string[]).includes(table) || !present.has(table)) continue;
    const list = byTable.get(table) ?? [];
    list.push(m.row_key);
    byTable.set(table, list);
  }

  const changes: FeedChange[] = [];
  // Parents before children: a task before its labels, so a label lands on a
  // row the client already holds.
  for (const table of FEED_TABLES) {
    const keys = byTable.get(table);
    if (!keys?.length) continue;
    const found = await rowsFor(sql, userId, table, keys);
    for (const key of keys) {
      const row = found.get(key);
      changes.push(
        row
          ? { table, eventType: "UPDATE", new: row, old: null }
          : { table, eventType: "DELETE", new: null, old: oldFor(table, key, userId) },
      );
    }
  }
  return { mode: "delta", cursor, reset: false, changes };
}

/** The RPC body: `{ p_since }` → a delta, or fingerprints when there is no log. */
export async function syncChanges(sql: Sql, userId: string, since: unknown): Promise<FeedAnswer> {
  const present = await presentTables(sql);
  if (present.has("sync_changes")) return delta(sql, userId, present, since);
  return { mode: "version", versions: await versions(sql, userId, present) };
}

/**
 * Keep the log to what a device could still ask for. A device whose cursor
 * predates the cut is told to refetch (the `lo` check above), so this bounds
 * the table without ever losing a change silently. The newest row always stays:
 * it is what lets a cursor be told apart from one that predates a prune.
 */
export async function pruneSyncChanges(sql: Sql, days = 14): Promise<number> {
  const present = await presentTables(sql);
  if (!present.has("sync_changes")) return 0;
  const rows = await sql.unsafe<{ n: string }[]>(
    `WITH gone AS (
       DELETE FROM public.sync_changes
        WHERE at < now() - make_interval(days => ${Math.max(1, Math.floor(days))})
          AND seq < (SELECT max(seq) FROM public.sync_changes)
        RETURNING 1)
     SELECT count(*)::text AS n FROM gone`,
  );
  return Number(rows[0]?.n ?? 0);
}
