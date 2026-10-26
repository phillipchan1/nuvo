import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

function py(code: string): string {
  const result = spawnSync(
    "python3",
    ["-c", `import sys; sys.path.insert(0, ${JSON.stringify(join(ROOT, "scripts"))}); ${code}`],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `python exited ${result.status}`);
  }
  return (result.stdout || "").trim();
}

const SYNC_DDL = `
CREATE TABLE public.sync_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const PUSH_DDL = `
CREATE TABLE public.push_subscriptions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT,
  time_zone TEXT,
  last_seen_at TIMESTAMPTZ,
  failure_count INTEGER NOT NULL DEFAULT 0
);
`;

async function idsOf(db: PGlite): Promise<number[]> {
  const { rows } = await db.query<{ id: string }>("SELECT id FROM public.sync_log ORDER BY id");
  return rows.map((r) => Number(r.id));
}

describe("sync_log late commit", () => {
  it("id anti-join copies a row allocated before the snapshot and committed after it", async () => {
    const source = new PGlite();
    const target = new PGlite();
    await source.exec(SYNC_DDL);
    await target.exec(SYNC_DDL);

    // Committed at snapshot time: 1,2,3,5,6. Identity already handed out 4
    // to an open transaction that has not committed. max(id) visible = 6.
    for (const id of [1, 2, 3, 5, 6]) {
      await source.query(
        `INSERT INTO public.sync_log (id, provider, operation, status)
         OVERRIDING SYSTEM VALUE VALUES ($1, 'google', 'sync', 'ok')`,
        [id],
      );
      await target.query(
        `INSERT INTO public.sync_log (id, provider, operation, status)
         OVERRIDING SYSTEM VALUE VALUES ($1, 'google', 'sync', 'ok')`,
        [id],
      );
    }
    const watermark = await source.query<{ m: string }>("SELECT COALESCE(MAX(id), 0)::text AS m FROM public.sync_log");
    expect(Number(watermark.rows[0]?.m)).toBe(6);

    // Late commit: id 4 was allocated before the snapshot.
    await source.query(
      `INSERT INTO public.sync_log (id, provider, operation, status)
       OVERRIDING SYSTEM VALUE VALUES (4, 'stripe', 'webhook', 'ok')`,
    );

    const sourceIds = await idsOf(source);
    const targetBefore = await idsOf(target);
    expect(sourceIds).toEqual([1, 2, 3, 4, 5, 6]);
    expect(targetBefore).toEqual([1, 2, 3, 5, 6]);

    const missed = py("from cutover_copy import watermark_filter_ids; print(watermark_filter_ids([1,2,3,4,5,6], 6))");
    expect(missed).toBe("[]");

    const anti = py("from cutover_copy import anti_join_ids; print(anti_join_ids([1,2,3,4,5,6], [1,2,3,5,6]))");
    expect(anti).toBe("[4]");

    await target.exec(py("from cutover_copy import sync_log_load_sql; print(sync_log_load_sql())") + ";");
    await target.query(
      `INSERT INTO cutover_sync_log_src (id, user_id, provider, operation, status, error, created_at)
       SELECT id, user_id, provider, operation, status, error, created_at FROM public.sync_log`,
    );
    // Source rows live on `source`. Load them into the temp on target.
    await target.exec("DELETE FROM cutover_sync_log_src");
    for (const id of sourceIds) {
      const row = await source.query<{
        id: string;
        user_id: string | null;
        provider: string;
        operation: string;
        status: string;
        error: string | null;
        created_at: string;
      }>("SELECT id, user_id, provider, operation, status, error, created_at FROM public.sync_log WHERE id = $1", [id]);
      const r = row.rows[0];
      await target.query(
        `INSERT INTO cutover_sync_log_src (id, user_id, provider, operation, status, error, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [r.id, r.user_id, r.provider, r.operation, r.status, r.error, r.created_at],
      );
    }
    const insertSql = py("from cutover_copy import sync_log_anti_join_insert_sql; print(sync_log_anti_join_insert_sql())");
    const inserted = await target.query<{ count: string }>(insertSql);
    expect(Number(inserted.rows[0]?.count)).toBe(1);
    expect(await idsOf(target)).toEqual([1, 2, 3, 4, 5, 6]);

    await source.close();
    await target.close();
  });
});

describe("push_subscriptions window edits", () => {
  it("upserts last_seen_at and failure_count changed during the window", async () => {
    const source = new PGlite();
    const target = new PGlite();
    await source.exec(PUSH_DDL);
    await target.exec(PUSH_DDL);

    const id = "11111111-1111-1111-1111-111111111111";
    const user = "22222222-2222-2222-2222-222222222222";
    const gone = "33333333-3333-3333-3333-333333333333";
    await source.query(
      `INSERT INTO public.push_subscriptions
        (id, user_id, endpoint, p256dh, auth, last_seen_at, failure_count)
       VALUES ($1, $2, 'https://push.example/a', 'k', 's', '2026-10-26T10:00:00Z', 3)`,
      [id, user],
    );
    await target.query(
      `INSERT INTO public.push_subscriptions
        (id, user_id, endpoint, p256dh, auth, last_seen_at, failure_count)
       VALUES ($1, $2, 'https://push.example/a', 'k', 's', '2026-10-26T08:00:00Z', 0)`,
      [id, user],
    );
    await target.query(
      `INSERT INTO public.push_subscriptions
        (id, user_id, endpoint, p256dh, auth, last_seen_at, failure_count)
       VALUES ($1, $2, 'https://push.example/gone', 'k', 's', '2026-10-26T08:00:00Z', 1)`,
      [gone, user],
    );

    await target.exec(py("from cutover_copy import push_load_rows_sql; print(push_load_rows_sql())") + ";");
    const src = await source.query<{
      id: string;
      user_id: string;
      created_at: string;
      updated_at: string;
      endpoint: string;
      p256dh: string;
      auth: string;
      label: string | null;
      time_zone: string | null;
      last_seen_at: string | null;
      failure_count: number;
    }>("SELECT id, user_id, created_at, updated_at, endpoint, p256dh, auth, label, time_zone, last_seen_at, failure_count FROM public.push_subscriptions");
    for (const r of src.rows) {
      await target.query(
        `INSERT INTO cutover_push_rows
          (id, user_id, created_at, updated_at, endpoint, p256dh, auth, label, time_zone, last_seen_at, failure_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [r.id, r.user_id, r.created_at, r.updated_at, r.endpoint, r.p256dh, r.auth, r.label, r.time_zone, r.last_seen_at, r.failure_count],
      );
    }

    const upserted = await target.query<{ count: string }>(py("from cutover_copy import push_upsert_sql; print(push_upsert_sql())"));
    expect(Number(upserted.rows[0]?.count)).toBe(1);
    const deleted = await target.query<{ count: string }>(py("from cutover_copy import push_anti_join_delete_sql; print(push_anti_join_delete_sql())"));
    expect(Number(deleted.rows[0]?.count)).toBe(1);

    const row = await target.query<{ last_seen_at: string; failure_count: number }>(
      "SELECT last_seen_at, failure_count FROM public.push_subscriptions WHERE id = $1",
      [id],
    );
    expect(row.rows).toHaveLength(1);
    expect(Number(row.rows[0]?.failure_count)).toBe(3);
    expect(new Date(row.rows[0]!.last_seen_at).toISOString()).toBe("2026-10-26T10:00:00.000Z");
    const leftover = await target.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM public.push_subscriptions WHERE id = $1", [gone]);
    expect(Number(leftover.rows[0]?.n)).toBe(0);

    await source.close();
    await target.close();
  });
});
