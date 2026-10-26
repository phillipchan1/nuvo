import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/cutover-migrate.yml"), "utf8");
const FREEZE = readFileSync(join(ROOT, "docs/cloudflare-migration/freeze.sql"), "utf8");
const UNFREEZE = readFileSync(join(ROOT, "docs/cloudflare-migration/unfreeze.sql"), "utf8");
const DOC = readFileSync(join(ROOT, "docs/cloudflare-cutover.md"), "utf8");
const COPY_PY = readFileSync(join(ROOT, "scripts/cutover_copy.py"), "utf8");

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

describe("cutover_copy helpers", () => {
  it("excludes billing tables and sync_log from the frozen copy", () => {
    expect(py("from cutover_copy import skipped_from_copy, COPY_SKIP_TABLES, BILLING_TABLES; print(sorted(COPY_SKIP_TABLES)); print(sorted(BILLING_TABLES)); print(skipped_from_copy('sync_log'), skipped_from_copy('tasks'))")).toBe(
      "['apple_notification_events', 'apple_webhook_events', 'stripe_webhook_events', 'subscriptions', 'sync_log']\n['apple_notification_events', 'apple_webhook_events', 'stripe_webhook_events', 'subscriptions']\nTrue False",
    );
  });

  it("dump exclude args cover billing + sync_log", () => {
    const out = py("from cutover_copy import dump_exclude_args; print('\\n'.join(dump_exclude_args()))");
    expect(out).toContain("--exclude-table=public.sync_log");
    expect(out).toContain("--exclude-table=public.subscriptions");
    expect(out).not.toContain("push_subscriptions");
  });

  it("treats cutover_armed true/1/yes as armed", () => {
    expect(py("from cutover_copy import maintenance_is_armed; print(maintenance_is_armed({'cutover_armed': True}), maintenance_is_armed({'cutover_armed': '1'}), maintenance_is_armed({'cutover_armed': False}), maintenance_is_armed({}))")).toBe(
      "True True False False",
    );
  });

  it("parses the sync_log watermark line", () => {
    expect(py("from cutover_copy import parse_watermark_line; import json; print(json.dumps(parse_watermark_line('42|2026-10-26 12:00:00+00')))")).toBe(
      '{"id": 42, "created_at": "2026-10-26 12:00:00+00"}',
    );
  });

  it("builds a tail SELECT greater than the watermark", () => {
    const sql = py("from cutover_copy import sync_log_tail_copy_sql; print(sync_log_tail_copy_sql({'id': 9, 'created_at': \"2026-10-26 00:00:00+00\"}))");
    expect(sql).toMatch(/id > 9/);
    expect(sql).toMatch(/created_at > '2026-10-26 00:00:00\+00'::timestamptz/);
    expect(sql).toMatch(/FROM public\.sync_log/);
  });

  it("push reconcile is an anti-join delete by id (counts only)", () => {
    const sql = py("from cutover_copy import push_anti_join_delete_sql; print(push_anti_join_delete_sql())");
    expect(sql).toMatch(/DELETE FROM public\.push_subscriptions/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM cutover_push_ids/);
    expect(sql).toMatch(/SELECT COUNT\(\*\) FROM gone/);
    expect(sql).not.toMatch(/RETURNING \*/);
  });
});

describe("cutover-migrate.yml", () => {
  it("imports the shared copy helpers", () => {
    expect(WORKFLOW).toMatch(/from cutover_copy import/);
    expect(WORKFLOW).toMatch(/require_cutover_armed/);
    expect(WORKFLOW).toMatch(/cmd_resync/);
  });

  it("refuses to start dump unless maintenance reports armed", () => {
    expect(WORKFLOW).toMatch(/MAINTENANCE_URL/);
    expect(WORKFLOW).toMatch(/refuse to start copy/);
    expect(WORKFLOW).toMatch(/cutover_armed is not true/);
    expect(COPY_PY).toMatch(/def maintenance_is_armed/);
  });

  it("excludes sync_log from dump, snapshot, and parity", () => {
    expect(WORKFLOW).toMatch(/COPY_SKIP_TABLES/);
    expect(WORKFLOW).toMatch(/skipped_from_copy/);
    expect(WORKFLOW).toMatch(/sync_log_watermark/);
    expect(WORKFLOW).not.toMatch(/BILLING_TABLES = \{/);
  });

  it("keeps push_subscriptions in the copy and reconciles deletes after switch", () => {
    expect(WORKFLOW).toMatch(/push_subscriptions deleted on target \(anti-join\)/);
    expect(WORKFLOW).toMatch(/phase=resync|phase == 'resync'/);
    expect(COPY_PY).toMatch(/DELETE FROM public\.push_subscriptions/);
    expect(COPY_PY).not.toMatch(/COPY_SKIP_TABLES = frozenset\(BILLING_TABLES \| \{"push_subscriptions"\}\)/);
  });
});

describe("freeze / unfreeze SQL", () => {
  it("records aclexplode including PUBLIC", () => {
    expect(FREEZE).toMatch(/aclexplode\(c\.relacl\)/);
    expect(FREEZE).toMatch(/THEN 'PUBLIC'/);
    expect(FREEZE).not.toMatch(/has_table_privilege/);
  });

  it("documents partitions, views, and column grants as out of scope", () => {
    expect(FREEZE).toMatch(/relkind = 'p'/);
    expect(FREEZE).toMatch(/relkind = 'v'/);
    expect(FREEZE).toMatch(/attacl/);
    expect(FREEZE).toMatch(/NOT c\.relispartition/);
  });

  it("restores recorded ACLs only and is idempotent", () => {
    expect(UNFREEZE).toMatch(/FROM migration_tmp\.freeze_grants/);
    expect(UNFREEZE).toMatch(/already unfrozen/);
    expect(UNFREEZE).toMatch(/TO PUBLIC/);
    expect(UNFREEZE).not.toMatch(/RAISE EXCEPTION/);
    expect(UNFREEZE).not.toMatch(/was_granted/);
  });
});

describe("runbook", () => {
  it("ships VITE_MAINTENANCE_URL + VITE_CUTOVER_ARMED before arming", () => {
    expect(DOC).toMatch(/Ship the armed build first/);
    expect(DOC).toMatch(/VITE_MAINTENANCE_URL/);
    expect(DOC).toMatch(/VITE_CUTOVER_ARMED=1/);
    expect(DOC).toMatch(/refuses to start dump/);
  });

  it("documents sync_log tail and push_subscriptions anti-join", () => {
    expect(DOC).toMatch(/`sync_log` is also excluded/);
    expect(DOC).toMatch(/watermark/);
    expect(DOC).toMatch(/anti-join/);
    expect(DOC).toMatch(/phase=resync/);
  });

  it("documents aclexplode restore and idempotent unfreeze", () => {
    expect(DOC).toMatch(/aclexplode\(relacl\)/);
    expect(DOC).toMatch(/no new direct grants/);
    expect(DOC).toMatch(/idempotent/);
    expect(DOC).toMatch(/Partitioned tables, views, and column-level grants/);
  });
});
