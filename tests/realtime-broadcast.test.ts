/**
 * Live changes reach a client only through its own private broadcast topics.
 *
 * `postgres_changes` sent every account's DELETE primary keys to every
 * subscriber, because Realtime cannot RLS-check a row that is gone (migration
 * 90). The fix has three halves that only work together: `rt_broadcast()`
 * routes each row to `nuvo:<owner>:<table>`, a `realtime.messages` policy lets
 * an account join only its own topics, and the hooks join through `liveTopic`.
 * These checks fail when one half moves without the others.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TABLE_TO_KEYS } from "../src/hooks/useRealtime";
import { LIVE_TOPIC_PREFIX, liveTopic } from "../src/lib/sync/liveTopic";

const MIGRATIONS = new URL("../supabase/migrations/", import.meta.url).pathname;
const SRC = new URL("../src/", import.meta.url).pathname;

// Joined outside useRealtime: useSubscriptionLiveSync's own channel.
const LIVE_TABLES = [...Object.keys(TABLE_TO_KEYS), "subscriptions"];

const stripComments = (sql: string) => sql.replace(/--.*$/gm, "");
const migrations = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ file: f, sql: stripComments(readFileSync(MIGRATIONS + f, "utf8")) }));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(`${dir}${e.name}/`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}${e.name}`] : [],
  );
}

describe("live changes ride private broadcast topics", () => {
  it("every live table broadcasts through rt_broadcast()", () => {
    const triggered = new Set<string>();
    for (const { sql } of migrations) {
      for (const m of sql.matchAll(
        /create\s+trigger\s+rt_broadcast\s+after\s+insert\s+or\s+update\s+or\s+delete\s+on\s+public\.(\w+)\s+for\s+each\s+row\s+execute\s+function\s+public\.rt_broadcast\(/gi,
      )) {
        triggered.add(m[1]);
      }
    }
    const missing = LIVE_TABLES.filter((t) => !triggered.has(t));
    expect(missing, "Listened to but never broadcast: its channel joins and nothing ever arrives").toEqual([]);
  });

  it("the trigger, the policy and the client agree on the topic", () => {
    const fn = migrations.filter(({ sql }) => /function\s+public\.rt_broadcast\(\)/i.test(sql)).at(-1)?.sql ?? "";
    expect(fn).toContain(`'${LIVE_TOPIC_PREFIX}:' || owner_::text || ':' || tg_table_name`);
    const policy = migrations.filter(({ sql }) => /on\s+realtime\.messages/i.test(sql)).at(-1)?.sql ?? "";
    expect(policy).toMatch(new RegExp(`split_part\\(\\(select realtime\\.topic\\(\\)\\), ':', 1\\) = '${LIVE_TOPIC_PREFIX}'`));
    expect(policy).toMatch(/split_part\(\(select realtime\.topic\(\)\), ':', 2\) = \(select auth\.uid\(\)\)::text/);
    expect(liveTopic("u-1", "tasks")).toBe(`${LIVE_TOPIC_PREFIX}:u-1:tasks`);
  });

  it("no client can send on a live topic", () => {
    // Only the trigger speaks there. An INSERT policy would let any account
    // forge a change into its own caches, or, with a loose check, someone else's.
    for (const { file, sql } of migrations) {
      const writes = [...sql.matchAll(/create\s+policy[^;]*on\s+realtime\.messages[^;]*for\s+(insert|all|update)\b/gi)];
      expect(writes.map((m) => m[0]), file).toEqual([]);
    }
  });

  it("nothing in the app listens to postgres_changes", () => {
    const offenders = sourceFiles(SRC).filter((f) => /["']postgres_changes["']/.test(readFileSync(f, "utf8")));
    expect(
      offenders.map((f) => f.slice(SRC.length)),
      "postgres_changes sends every account's DELETE primary keys to every subscriber. Use a liveTopic.",
    ).toEqual([]);
  });
});
