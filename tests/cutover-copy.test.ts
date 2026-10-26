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
  it("excludes billing tables from the dump and skips sync_log data from parity", () => {
    expect(py("from cutover_copy import skipped_from_copy, COPY_SKIP_TABLES, BILLING_TABLES; print(sorted(COPY_SKIP_TABLES)); print(sorted(BILLING_TABLES)); print(skipped_from_copy('sync_log'), skipped_from_copy('tasks'))")).toBe(
      "['apple_notification_events', 'apple_webhook_events', 'stripe_webhook_events', 'subscriptions', 'sync_log']\n['apple_notification_events', 'apple_webhook_events', 'stripe_webhook_events', 'subscriptions']\nTrue False",
    );
  });

  it("keeps sync_log structure and excludes billing tables", () => {
    const out = py("from cutover_copy import dump_exclude_args; print('\\n'.join(dump_exclude_args()))");
    expect(out).toContain("--exclude-table-data=public.sync_log");
    expect(out).toContain("--exclude-table=public.subscriptions");
    expect(out).not.toContain("--exclude-table=public.sync_log");
    expect(out).not.toContain("push_subscriptions");
  });

  it("treats cutover_armed true/1/yes as armed", () => {
    expect(py("from cutover_copy import maintenance_is_armed; print(maintenance_is_armed({'cutover_armed': True}), maintenance_is_armed({'cutover_armed': '1'}), maintenance_is_armed({'cutover_armed': False}), maintenance_is_armed({}))")).toBe(
      "True True False False",
    );
  });

  it("parses the sync_log watermark line (report only)", () => {
    expect(py("from cutover_copy import parse_watermark_line; import json; print(json.dumps(parse_watermark_line('42|2026-10-26 12:00:00+00')))")).toBe(
      '{"id": 42, "created_at": "2026-10-26 12:00:00+00"}',
    );
  });

  it("copies all sync_log rows (no watermark filter)", () => {
    const sql = py("from cutover_copy import sync_log_copy_sql, sync_log_anti_join_insert_sql; print(sync_log_copy_sql()); print('---'); print(sync_log_anti_join_insert_sql())");
    expect(sql).toMatch(/FROM public\.sync_log/);
    expect(sql).not.toMatch(/id >/);
    expect(sql).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM public\.sync_log t WHERE t\.id = s\.id\)/);
    expect(sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
  });

  it("setvals the sync_log identity after resync and reserves past source max after restore", () => {
    const setval = py("from cutover_copy import sync_log_setval_sql; print(sync_log_setval_sql())");
    expect(setval).toMatch(/GREATEST\(/);
    expect(setval).toMatch(/SELECT max\(id\) FROM public\.sync_log/);
    expect(setval).toMatch(/SELECT last_value FROM public\.sync_log_id_seq/);
    expect(setval).not.toMatch(/GREATEST\(\(SELECT max\(id\) FROM public\.sync_log\), ?1\)\s*$/);
    const reserved = py("from cutover_copy import sync_log_reserve_sequence_sql, SYNC_LOG_SEQUENCE_MARGIN; print(sync_log_reserve_sequence_sql(6)); print(SYNC_LOG_SEQUENCE_MARGIN)");
    expect(reserved).toMatch(/^SELECT setval\(pg_get_serial_sequence\('public\.sync_log','id'\), 1000006\)\n1000000$/);
    const txn = py("from cutover_copy import sync_log_resync_txn_sql; print(sync_log_resync_txn_sql())");
    expect(txn).toMatch(/^BEGIN;/);
    expect(txn).toMatch(/LOCK TABLE public\.sync_log IN SHARE ROW EXCLUSIVE MODE/);
    expect(txn).toMatch(/incoming row\(s\) differ on Neon/);
    expect(txn).toMatch(/sync_log_setval=/);
    expect(txn).toMatch(/COMMIT;/);
    const begin = txn.indexOf("BEGIN;");
    const insert = txn.indexOf("INSERT INTO public.sync_log");
    const setvalAt = txn.indexOf("setval(");
    const commit = txn.indexOf("COMMIT;");
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(begin);
    expect(setvalAt).toBeGreaterThan(insert);
    expect(commit).toBeGreaterThan(setvalAt);
    expect(py("from cutover_copy import parse_labeled_count; print(parse_labeled_count('sync_log_inserted=4\\nsync_log_setval=1000003', 'sync_log_inserted')); print(parse_labeled_count('sync_log_inserted=4\\nsync_log_setval=1000003', 'sync_log_setval'))")).toBe("4\n1000003");
  });

  it("push resync deletes missing ids before upserting every column", () => {
    const sql = py("from cutover_copy import push_upsert_sql, push_anti_join_delete_sql, push_full_copy_sql; print(push_full_copy_sql()); print('---'); print(push_upsert_sql()); print('---'); print(push_anti_join_delete_sql())");
    expect(sql).toMatch(/FROM public\.push_subscriptions/);
    expect(sql).toMatch(/ON CONFLICT \(id\) DO UPDATE SET/);
    expect(sql).toMatch(/last_seen_at = EXCLUDED\.last_seen_at/);
    expect(sql).toMatch(/failure_count = EXCLUDED\.failure_count/);
    expect(sql).toMatch(/DELETE FROM public\.push_subscriptions/);
    expect(sql).toMatch(/SELECT COUNT\(\*\) FROM gone/);
    expect(sql).not.toMatch(/RETURNING \*/);
    const idxDelete = WORKFLOW.indexOf("push_anti_join_delete_sql() + \";\"");
    const idxUpsert = WORKFLOW.indexOf("push_upsert_sql() + \";\"");
    expect(idxDelete).toBeGreaterThan(0);
    expect(idxUpsert).toBeGreaterThan(idxDelete);
  });
});

describe("not-armed refusal actually runs", () => {
  // Live HTTP in the same Python process (http.server + urllib). A Node
  // createServer + spawnSync deadlocks: the event loop is blocked and the
  // GET never completes. This still hits fetch_maintenance, not a stub.
  const liveAssert = (armed: boolean) => `
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading
from cutover_copy import assert_cutover_armed, CutoverArmedError

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"write_freeze": true, "cutover_armed": ${armed ? "true" : "false"}}')
    def log_message(self, *args):
        pass

httpd = HTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{httpd.server_address[1]}/api/maintenance"
try:
    print(assert_cutover_armed(url)["cutover_armed"])
except CutoverArmedError as e:
    print(e.code)
    print(str(e))
finally:
    httpd.shutdown()
`;

  it("refuses when the live maintenance endpoint reports cutover_armed false", () => {
    const out = py(liveAssert(false));
    expect(out).toMatch(/^not_armed\n/);
    expect(out).toMatch(/refuse to start copy/);
  });

  it("passes when the live maintenance endpoint reports armed", () => {
    expect(py(liveAssert(true))).toBe("True");
  });

  it("refuses a missing maintenance URL", () => {
    const out = py(`
from cutover_copy import assert_cutover_armed, CutoverArmedError
try:
    assert_cutover_armed("")
    print("ARMED")
except CutoverArmedError as e:
    print(e.code)
`);
    expect(out).toBe("missing_url");
  });
});

describe("edge preflight helpers", () => {
  it("only accepts 503 as frozen", () => {
    expect(py("from cutover_copy import edge_preflight_frozen; print(edge_preflight_frozen(503), edge_preflight_frozen(401), edge_preflight_frozen(200))")).toBe(
      "True False False",
    );
  });

  it("POSTs a live gated function and treats 503 as frozen", () => {
    const out = py(`
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading
from cutover_copy import post_status, edge_preflight_frozen

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        self.send_response(503)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"write_freeze": true}')
    def log_message(self, *args):
        pass

httpd = HTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{httpd.server_address[1]}/functions/v1/calendar-refresh"
try:
    status = post_status(url)
    print(status, edge_preflight_frozen(status))
finally:
    httpd.shutdown()
`);
    expect(out).toBe("503 True");
  });

  it("treats has_table_privilege f as anon insert denied", () => {
    expect(py("from cutover_copy import anon_insert_denied; print(anon_insert_denied('f'), anon_insert_denied('t'), anon_insert_denied('true'))")).toBe(
      "True False False",
    );
  });
});

describe("cutover-migrate.yml", () => {
  it("imports the shared copy helpers", () => {
    expect(WORKFLOW).toMatch(/from cutover_copy import/);
    expect(WORKFLOW).toMatch(/require_cutover_armed/);
    expect(WORKFLOW).toMatch(/require_write_freeze_preflight/);
    expect(WORKFLOW).toMatch(/cmd_resync/);
  });

  it("refuses to start dump unless maintenance reports armed", () => {
    expect(WORKFLOW).toMatch(/MAINTENANCE_URL/);
    expect(WORKFLOW).toMatch(/assert_cutover_armed/);
    expect(COPY_PY).toMatch(/def assert_cutover_armed/);
  });

  it("keeps sync_log structure and excludes its data from parity", () => {
    expect(WORKFLOW).toMatch(/COPY_SKIP_TABLES/);
    expect(WORKFLOW).toMatch(/exclude-table-data/);
    expect(WORKFLOW).toMatch(/sync_log_watermark/);
    expect(WORKFLOW).toMatch(/structure must be kept/);
  });

  it("keeps push_subscriptions in the copy and upserts after switch", () => {
    expect(WORKFLOW).toMatch(/push_subscriptions upserted/);
    expect(WORKFLOW).toMatch(/push_subscriptions deleted on target \(anti-join\)/);
    expect(WORKFLOW).toMatch(/sync_log identity setval=/);
    expect(WORKFLOW).toMatch(/reserved sync_log identity setval=/);
    expect(WORKFLOW).toMatch(/sync_log_resync_txn_sql/);
    expect(WORKFLOW).not.toMatch(/psql\(target, sync_log_setval_sql/);
    expect(WORKFLOW).toMatch(/phase=resync|phase == 'resync'/);
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

  it("documents sync_log id anti-join and push upsert", () => {
    expect(DOC).toMatch(/--exclude-table-data/);
    expect(DOC).toMatch(/watermark/);
    expect(DOC).toMatch(/late-committed/);
    expect(DOC).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
    expect(DOC).toMatch(/setval/);
    expect(DOC).toMatch(/last_value/);
    expect(DOC).toMatch(/never decreases/);
    expect(DOC).toMatch(/deletes\s+missing ids first/);
    expect(DOC).toMatch(/phase=resync/);
  });

  it("documents aclexplode restore and idempotent unfreeze", () => {
    expect(DOC).toMatch(/aclexplode\(relacl\)/);
    expect(DOC).toMatch(/no new direct grants/);
    expect(DOC).toMatch(/idempotent/);
    expect(DOC).toMatch(/Partitioned tables, views, and column-level grants/);
  });
});
