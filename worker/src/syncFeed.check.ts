// The change feed (D-238) on PGlite with the real neon.sql: the trigger logs
// every writer, the delta carries only this account's rows, a delete arrives as
// a DELETE, the cursor never passes a row that might still be uncommitted, and
// a Neon without the log answers with fingerprints instead.
// Run: node --experimental-strip-types worker/src/syncFeed.check.ts

import { PGlite } from "@electric-sql/pglite";
import { applyIsolationSchema } from "./isolationDb.ts";
import { makePgliteSql } from "./pgliteSql.ts";
import { pruneSyncChanges, resetSyncFeedForTests, syncChanges, type FeedAnswer } from "./syncFeed.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: unknown, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const A_TASK = "aaaaaaaa-2222-4000-8000-000000000001";
const A_LABEL = "aaaaaaaa-3333-4000-8000-000000000001";
const B_TASK = "bbbbbbbb-2222-4000-8000-000000000001";

const db = new PGlite();
await applyIsolationSchema(db);
const sql = makePgliteSql(db);

/** Pretend every logged row is old enough for the cursor to pass it. */
const age = () => db.exec(`UPDATE sync_changes SET at = at - interval '1 hour'`);
const delta = (a: FeedAnswer) => {
  if (a.mode !== "delta") throw new Error(`expected delta, got ${a.mode}`);
  return a;
};

// --- bootstrap -----------------------------------------------------------
const seeded = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM sync_changes`);
ok(seeded.rows[0].n > 0, "the trigger logged the seed's inserts");

let first = delta(await syncChanges(sql, A, null));
ok(first.reset, "no cursor → reset (refetch everything once)");
ok(/^\d+$/.test(first.cursor), "bootstrap returns a numeric cursor");
await age();
first = delta(await syncChanges(sql, A, null));
const start = first.cursor;

// --- a write lands in the next answer, for its owner only ------------------
await db.query(`UPDATE tasks SET title = 'moved on the phone' WHERE id = $1`, [A_TASK]);
await db.query(`UPDATE tasks SET title = 'B private' WHERE id = $1`, [B_TASK]);
let next = delta(await syncChanges(sql, A, start));
ok(!next.reset, "a known cursor is not a reset");
const taskChange = next.changes.find((c) => c.table === "tasks");
ok(taskChange?.eventType === "UPDATE", "an update arrives as a row");
ok(taskChange?.new?.title === "moved on the phone", "the row is the current server row");
ok(!next.changes.some((c) => c.new?.id === B_TASK || c.old?.id === B_TASK), "B's change never reaches A");
ok(next.cursor === start, "a change younger than the settle window does not move the cursor");
const again = delta(await syncChanges(sql, A, next.cursor));
ok(again.changes.some((c) => c.new?.id === A_TASK), "…so it is sent again until it settles");

await age();
next = delta(await syncChanges(sql, A, start));
ok(BigInt(next.cursor) > BigInt(start), "once settled, the cursor passes it");
const quiet = delta(await syncChanges(sql, A, next.cursor));
ok(quiet.changes.length === 0, "nothing moved → nothing sent");

// --- an update that changes nothing is not logged ---------------------------
const before = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM sync_changes`);
await db.query(`UPDATE tasks SET title = title WHERE id = $1`, [A_TASK]);
const after = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM sync_changes`);
ok(after.rows[0].n === before.rows[0].n, "a no-op UPDATE does not log a change");

// --- label rows and hard deletes -------------------------------------------
let cursor = next.cursor;
await db.query(`DELETE FROM task_labels WHERE task_id = $1 AND label_id = $2`, [A_TASK, A_LABEL]);
next = delta(await syncChanges(sql, A, cursor));
const labelGone = next.changes.find((c) => c.table === "task_labels");
ok(labelGone?.eventType === "DELETE", "a removed label arrives as a DELETE");
ok(labelGone?.old?.task_id === A_TASK && labelGone?.old?.label_id === A_LABEL, "…naming the task and label");

await age();
cursor = delta(await syncChanges(sql, A, cursor)).cursor;
await db.query(`DELETE FROM tasks WHERE id = $1`, [A_TASK]);
next = delta(await syncChanges(sql, A, cursor));
const taskGone = next.changes.find((c) => c.table === "tasks");
ok(taskGone?.eventType === "DELETE" && taskGone.old?.id === A_TASK, "a hard-deleted task arrives as a DELETE");

// --- provider events leave their payload behind -----------------------------
await db.query(
  `INSERT INTO external_events (user_id, account_id, calendar_id, provider_event_id, title, start_at, end_at, raw)
   VALUES ($1, 'aaaaaaaa-eeee-4000-8000-000000000001', 'primary', 'standup', 'Standup', now(), now() + interval '30 minutes', '{"description":"long"}')`,
  [A],
);
next = delta(await syncChanges(sql, A, cursor));
const event = next.changes.find((c) => c.table === "external_events");
ok(event?.new?.title === "Standup", "a synced event arrives");
ok(event && !("raw" in (event.new ?? {})), "…without the provider's raw payload");

// --- settings never carry the inbound token ---------------------------------
await db.query(`UPDATE user_settings SET theme = 'dark', inbound_token = 'secret' WHERE user_id = $1`, [A]);
next = delta(await syncChanges(sql, A, cursor));
const settings = next.changes.find((c) => c.table === "user_settings");
ok(settings?.new?.theme === "dark", "a settings change arrives");
ok(settings && !("inbound_token" in (settings.new ?? {})), "…without the inbound token");

// --- routing in production's shape: keyed (user_id, event_key), no `id` ------
// neon.sql is production's shape (D-241), so the table has no `id` here either.
// Keying the trigger or the feed by `id` raised on every routing write.
await db.query(`INSERT INTO event_domain_routing (user_id, event_key) VALUES ($1, 'gcal:standup')`, [A]);
next = delta(await syncChanges(sql, A, cursor));
const routed = next.changes.find((c) => c.table === "event_domain_routing");
ok(routed?.eventType !== "DELETE" && routed?.new?.event_key === "gcal:standup", "a routing write in production's shape arrives");
await db.query(`DELETE FROM event_domain_routing WHERE user_id = $1 AND event_key = 'gcal:standup'`, [A]);
next = delta(await syncChanges(sql, A, cursor));
ok(
  next.changes.some((c) => c.table === "event_domain_routing" && c.eventType === "DELETE"),
  "…and its delete arrives as a DELETE",
);

// --- a cursor the log no longer covers, or from another database -----------
await db.exec(`UPDATE sync_changes SET at = at - interval '30 days'`);
const pruned = await pruneSyncChanges(sql, 14);
ok(pruned > 0, "the prune removes settled rows");
const left = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM sync_changes`);
ok(left.rows[0].n >= 1, "the prune keeps the newest row");
ok(delta(await syncChanges(sql, A, "1")).reset, "a cursor older than the log → reset");
ok(delta(await syncChanges(sql, A, "999999999")).reset, "a cursor from the future (a restore) → reset");
ok(delta(await syncChanges(sql, A, "not-a-number")).reset, "a malformed cursor → reset");

// --- no log yet: fingerprints ------------------------------------------------
await db.exec(`DROP TABLE sync_changes CASCADE`);
await db.exec(`DROP FUNCTION log_sync_change() CASCADE`);
resetSyncFeedForTests();
const v1 = await syncChanges(sql, A, null);
ok(v1.mode === "version", "without the log the feed answers with fingerprints");
if (v1.mode === "version") {
  ok(typeof v1.versions.tasks === "string" && typeof v1.versions.task_labels === "string", "every present table is fingerprinted");
  await db.query(`UPDATE projects SET name = 'renamed' WHERE user_id = $1`, [A]);
  const v2 = await syncChanges(sql, A, null);
  if (v2.mode === "version") {
    ok(v2.versions.projects !== v1.versions.projects, "a changed table's fingerprint moves");
    ok(v2.versions.tasks === v1.versions.tasks, "an untouched table's fingerprint holds");
  }
  await db.query(`UPDATE projects SET name = 'B renamed' WHERE user_id = $1`, [B]);
  const v3 = await syncChanges(sql, A, null);
  if (v3.mode === "version" && v2.mode === "version") {
    ok(v3.versions.projects === v2.versions.projects, "another account's write does not move A's fingerprint");
  }
}

await db.close();
if (fails.length) {
  console.error(`syncFeed.check: ${fails.length}/${checks} failed`);
  for (const f of fails) console.error("  ✗", f);
  process.exit(1);
}
console.log(`syncFeed.check: ${checks} checks passed`);
