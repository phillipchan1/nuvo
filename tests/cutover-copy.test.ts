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
    expect(txn).toMatch(/SET LOCAL lock_timeout = '10s'/);
    expect(txn).toMatch(/LOCK TABLE public\.sync_log IN SHARE ROW EXCLUSIVE MODE/);
    expect(txn).toMatch(/WHEN lock_not_available/);
    expect(txn).not.toMatch(/WHEN query_canceled/);
    expect(txn).toMatch(/sync_log lock timed out after 10s — retry the resync \(retryable\) \[55P03\]/);
    expect(txn).not.toMatch(/SQLERRM ILIKE/);
    expect(txn).toMatch(/incoming row\(s\) differ on Neon/);
    expect(txn).toMatch(/sync_log_setval=/);
    expect(txn).toMatch(/COMMIT;/);
    const begin = txn.indexOf("BEGIN;");
    const lockTimeout = txn.indexOf("SET LOCAL lock_timeout = '10s'");
    const lockTable = txn.indexOf("LOCK TABLE public.sync_log IN SHARE ROW EXCLUSIVE MODE");
    const insert = txn.indexOf("INSERT INTO public.sync_log");
    const setvalAt = txn.indexOf("setval(");
    const commit = txn.indexOf("COMMIT;");
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(lockTimeout).toBeGreaterThan(begin);
    expect(lockTable).toBeGreaterThan(lockTimeout);
    expect(insert).toBeGreaterThan(lockTable);
    expect(setvalAt).toBeGreaterThan(insert);
    expect(commit).toBeGreaterThan(setvalAt);
    const load = py("from cutover_copy import sync_log_load_sql; print(sync_log_load_sql())");
    expect(load).toMatch(/^\\set VERBOSITY sqlstate\nSET client_min_messages = error;\nSET lock_timeout = '10s';/);
    expect(load).not.toMatch(/^SET LOCAL lock_timeout/);
    expect(load.indexOf("\\set VERBOSITY sqlstate")).toBeLessThan(load.indexOf("SET client_min_messages = error;"));
    expect(load.indexOf("SET client_min_messages = error;")).toBeLessThan(load.indexOf("SET lock_timeout = '10s'"));
    expect(load.indexOf("SET lock_timeout = '10s'")).toBeLessThan(load.indexOf("CREATE TEMP TABLE cutover_sync_log_src"));
    expect(load.indexOf("CREATE TEMP TABLE cutover_sync_log_src")).toBeGreaterThanOrEqual(0);
    const script = `${load};\n${txn}`;
    expect(script.indexOf("\\set VERBOSITY sqlstate")).toBeLessThan(script.indexOf("SET client_min_messages = error;"));
    expect(script.indexOf("SET client_min_messages = error;")).toBeLessThan(script.indexOf("SET lock_timeout = '10s'"));
    expect(script.indexOf("SET lock_timeout = '10s'")).toBeLessThan(script.indexOf("CREATE TEMP TABLE cutover_sync_log_src"));
    expect(script.indexOf("CREATE TEMP TABLE cutover_sync_log_src")).toBeLessThan(script.indexOf("BEGIN;"));
    expect(py("from cutover_copy import parse_labeled_count; print(parse_labeled_count('sync_log_inserted=4\\nsync_log_setval=1000003', 'sync_log_inserted')); print(parse_labeled_count('sync_log_inserted=4\\nsync_log_setval=1000003', 'sync_log_setval'))")).toBe("4\n1000003");
  });

  it("classifies a lock timeout as retryable only on an anchored ERROR 55P03 banner", () => {
    const out = py(
      "from cutover_copy import is_retryable_lock_timeout, SYNC_LOG_LOCK_TIMEOUT_MESSAGE, PUSH_LOCK_TIMEOUT_MESSAGE, LOCK_TIMEOUT_SQLSTATE; "
      + "print(is_retryable_lock_timeout('ERROR:  55P03: canceling statement due to lock timeout')); "
      + "print(is_retryable_lock_timeout(SYNC_LOG_LOCK_TIMEOUT_MESSAGE)); "
      + "print(is_retryable_lock_timeout(PUSH_LOCK_TIMEOUT_MESSAGE)); "
      + "print(is_retryable_lock_timeout('ERROR:  canceling statement due to lock timeout')); "
      + "print(is_retryable_lock_timeout('sync_log lock timed out after 10s — retry the resync (retryable)')); "
      + "print(is_retryable_lock_timeout('sync_log id collision: 1 incoming row(s) differ on Neon')); "
      + "print(is_retryable_lock_timeout('canceling statement due to statement timeout')); "
      + "print(is_retryable_lock_timeout('psql:resync.sql:24: ERROR:  55P03:')); "
      + "print(is_retryable_lock_timeout('DETAIL:  SQLSTATE 55P03 is mentioned')); "
      + "print(is_retryable_lock_timeout('prefix ERROR:  55P03: not at line start')); "
      + "print(is_retryable_lock_timeout('ERROR:  23505: duplicate key value violates unique constraint \"t_pkey\"\\nDETAIL:  Key (id)=(x\\nERROR:  55P03: fake) already exists.')); "
      + "print(is_retryable_lock_timeout('ERROR:  23505: duplicate key value violates unique constraint \"t_pkey\"\\nDETAIL:  Key (id)=(x\\npsql:a:1: ERROR:  55P03: fake) already exists.')); "
      + "print(is_retryable_lock_timeout('psql:f:2: ERROR:  P0001: ERROR:  55P03: fake')); "
      + "print(is_retryable_lock_timeout(\"ERROR:  P0001: x\\nERROR:  55P03: fake\")); "
      + "print(is_retryable_lock_timeout('pg_restore: error: COPY failed for table \"t\": ERROR:  duplicate key value violates unique constraint \"t_pkey\"\\nDETAIL:  Key (id)=(x\\nERROR:  55P03: fake) already exists.')); "
      + "print(is_retryable_lock_timeout('ERROR:  duplicate key value violates unique constraint \"t_pkey\"\\nDETAIL:  Key (id)=(x\\nERROR:  55P03: fake) already exists.')); "
      + "print(is_retryable_lock_timeout('NOTICE:  ERROR:  55P03: fake\\nWARNING:  ERROR:  55P03: fake\\nERROR:  duplicate key value violates unique constraint \"t_pkey\"')); "
      + "print(LOCK_TIMEOUT_SQLSTATE); "
      + "print(SYNC_LOG_LOCK_TIMEOUT_MESSAGE); "
      + "print(PUSH_LOCK_TIMEOUT_MESSAGE)",
    );
    expect(out).toBe(
      "False\nFalse\nFalse\nFalse\nFalse\nFalse\nFalse\nTrue\nFalse\nFalse\nFalse\nFalse\nFalse\nFalse\nFalse\nFalse\nFalse\n55P03\n"
      + "sync_log lock timed out after 10s — retry the resync (retryable) [55P03]\n"
      + "push_subscriptions lock timed out after 10s — retry the resync (retryable) [55P03]",
    );
  });

  it("takes SQLSTATE from the first error-banner line, not a later spoof", () => {
    const out = py(
      "from cutover_copy import first_error_banner_line, first_psql_sqlstate, is_retryable_lock_timeout; "
      + "samples = ["
      + "  'pg_restore: error: COPY failed for table \"t\": ERROR:  duplicate key value violates unique constraint \"t_pkey\"\\nDETAIL:  Key (id)=(x\\nERROR:  55P03: fake) already exists.',"
      + "  'ERROR:  duplicate key value violates unique constraint \"t_pkey\"\\nDETAIL:  Key (id)=(x\\nERROR:  55P03: fake) already exists.',"
      + "  'NOTICE:  ERROR:  55P03: fake\\nWARNING:  ERROR:  55P03: fake\\nERROR:  statement timeout',"
      + "]; "
      + "print('\\n'.join("
      + "  (first_error_banner_line(s) or 'NONE') + '|' + (first_psql_sqlstate(s) or 'NONE') + '|' + str(is_retryable_lock_timeout(s))"
      + "  for s in samples"
      + "))",
    );
    expect(out).toBe("NONE|NONE|False\nNONE|NONE|False\nNONE|NONE|False");
  });

  it("does not treat chatter or spoof bodies before the first ERROR as retryable", () => {
    const out = py(
      "from cutover_copy import first_error_banner_line, first_psql_sqlstate, is_retryable_lock_timeout; "
      + "samples = ["
      + "  'psql:resync.sql:1: NOTICE:  x\\nERROR:  55P03: fake\\npsql:resync.sql:2: ERROR:  P0001: not a lock',"
      + "  'psql:resync.sql:1: WARNING:  x\\nERROR:  55P03: fake\\npsql:resync.sql:3: ERROR:  23505: duplicate key value violates unique constraint \"t_pkey\"',"
      + "  'psql:resync.sql:1: NOTICE:  x\\r\\nERROR:  55P03: fake\\r\\npsql:resync.sql:2: ERROR:  P0001: not a lock',"
      + "  'psql:resync.sql:1: ERROR:  23505:\\npsql:resync.sql:1: DETAIL:  Key (id)=(x\\nERROR:  55P03: fake) already exists.',"
      + "  'psql:resync.sql:1: NOTICE:  x\\npsql:a:1: ERROR:  55P03: fake\\npsql:resync.sql:2: ERROR:  P0001: not a lock',"
      + "  'psql:resync.sql:1: INFO:  x\\npsql:x:1: ERROR:  55P03: fake\\npsql:resync.sql:2: ERROR:  P0001: not a lock',"
      + "  'psql:resync.sql:1: INFO:  x\\npsql:resync.sql:1: ERROR:  55P03: fake\\npsql:resync.sql:2: ERROR:  P0001: not a lock',"
      + "  'psql:/tmp/dumps/resync.sql:10: NOTICE:  x\\npsql:/tmp/dumps/resync.sql:10: ERROR:  55P03: fake\\npsql:/tmp/dumps/resync.sql:20: ERROR:  P0001: not a lock',"
      + "]; "
      + "print('\\n'.join("
      + "  (first_error_banner_line(s) or 'NONE') + '|' + (first_psql_sqlstate(s) or 'NONE') + '|' + str(is_retryable_lock_timeout(s))"
      + "  for s in samples"
      + "))",
    );
    expect(out).toBe(
      "NONE|NONE|False\n"
      + "NONE|NONE|False\n"
      + "NONE|NONE|False\n"
      + "psql:resync.sql:1: ERROR:  23505:|23505|False\n"
      + "NONE|NONE|False\n"
      + "NONE|NONE|False\n"
      + "NONE|NONE|False\n"
      + "NONE|NONE|False",
    );
  });

  it("maps a sqlstate 55P03 banner to the table at that resync.sql line", () => {
    const out = py(
      "from cutover_copy import compose_resync_script, is_retryable_lock_timeout, table_from_resync_error, retryable_lock_timeout_stop; "
      + "script = compose_resync_script(sync_copy_sql='\\\\copy cutover_sync_log_src (id) FROM \\'/tmp/s.csv\\' WITH CSV', push_copy_sql='\\\\copy cutover_push_rows (id) FROM \\'/tmp/p.csv\\' WITH CSV'); "
      + "lines = script.splitlines(); "
      + "sync_n = next(i for i, l in enumerate(lines, 1) if 'LOCK TABLE public.sync_log' in l); "
      + "push_n = next(i for i, l in enumerate(lines, 1) if 'cutover_push_anti_join_delete()' in l); "
      + "upsert_n = next(i for i, l in enumerate(lines, 1) if 'cutover_push_upsert()' in l); "
      + "sync_err = f'psql:resync.sql:{sync_n}: ERROR:  55P03:'; "
      + "push_err = f'psql:resync.sql:{push_n}: ERROR:  55P03:'; "
      + "upsert_err = f'psql:resync.sql:{upsert_n}: ERROR:  55P03:'; "
      + "print(is_retryable_lock_timeout(sync_err)); "
      + "print(table_from_resync_error(sync_err, script)); "
      + "print(is_retryable_lock_timeout(push_err)); "
      + "print(table_from_resync_error(push_err, script)); "
      + "print(is_retryable_lock_timeout(upsert_err)); "
      + "print(table_from_resync_error(upsert_err, script)); "
      + "print('sync_log' in retryable_lock_timeout_stop(sync_err, script=script)); "
      + "print('push_subscriptions' in retryable_lock_timeout_stop(push_err, script=script))",
    );
    expect(out).toBe("True\nsync_log\nTrue\npush_subscriptions\nTrue\npush_subscriptions\nTrue\nTrue");
  });

  it("retryable lock-timeout stop names the table that waited", () => {
    const out = py(
      "from cutover_copy import retryable_lock_timeout_stop, SYNC_LOG_LOCK_TIMEOUT_MESSAGE, PUSH_LOCK_TIMEOUT_MESSAGE; "
      + "print(retryable_lock_timeout_stop('ERROR:  55P03: canceling statement due to lock timeout\\nCONTEXT:  SQL statement \"LOCK TABLE public.sync_log IN SHARE ROW EXCLUSIVE MODE\"')); "
      + "print('---'); "
      + "print(retryable_lock_timeout_stop('ERROR:  55P03: canceling statement due to lock timeout\\nCONTEXT:  SQL statement \"LOCK TABLE public.push_subscriptions IN SHARE ROW EXCLUSIVE MODE\"')); "
      + "print('---'); "
      + "print(retryable_lock_timeout_stop('')); "
      + "print(SYNC_LOG_LOCK_TIMEOUT_MESSAGE in retryable_lock_timeout_stop('ERROR:  55P03: LOCK TABLE public.sync_log')); "
      + "print(PUSH_LOCK_TIMEOUT_MESSAGE in retryable_lock_timeout_stop('ERROR:  55P03: LOCK TABLE public.push_subscriptions'))",
    );
    expect(out).toContain("sync_log lock timed out after 10s — retry the resync (retryable) [55P03]: ERROR:  55P03: canceling statement due to lock timeout");
    expect(out).toContain("LOCK TABLE public.sync_log IN SHARE ROW EXCLUSIVE MODE");
    expect(out).toContain("push_subscriptions lock timed out after 10s — retry the resync (retryable) [55P03]: ERROR:  55P03: canceling statement due to lock timeout");
    expect(out).toContain("LOCK TABLE public.push_subscriptions IN SHARE ROW EXCLUSIVE MODE");
    expect(out).not.toMatch(/user_id|provider|operation|RETURNING \*/);
    expect(out).toContain("---\nlock timed out after 10s — retry the resync (retryable) [55P03]\nTrue\nTrue");
    const pushStop = py(
      "from cutover_copy import retryable_lock_timeout_stop; "
      + "print(retryable_lock_timeout_stop('ERROR:  55P03: lock timeout', 'push_subscriptions'))",
    );
    expect(pushStop).toMatch(/^push_subscriptions lock timed out/);
    expect(pushStop).not.toMatch(/sync_log lock timed out/);
  });

  it("push resync deletes missing ids before upserting every column", () => {
    const sql = py("from cutover_copy import push_upsert_sql, push_anti_join_delete_sql, push_full_copy_sql, push_load_rows_sql; print(push_full_copy_sql()); print('---'); print(push_upsert_sql()); print('---'); print(push_anti_join_delete_sql()); print('---'); print(push_load_rows_sql())");
    expect(sql).toMatch(/FROM public\.push_subscriptions/);
    expect(sql).toMatch(/ON CONFLICT \(id\) DO UPDATE SET/);
    expect(sql).toMatch(/last_seen_at = EXCLUDED\.last_seen_at/);
    expect(sql).toMatch(/failure_count = EXCLUDED\.failure_count/);
    expect(sql).toMatch(/DELETE FROM public\.push_subscriptions/);
    expect(sql).toMatch(/SELECT COUNT\(\*\) FROM gone/);
    expect(sql).toMatch(/SELECT pg_temp\.cutover_push_anti_join_delete\(\) AS count/);
    expect(sql).toMatch(/SELECT pg_temp\.cutover_push_upsert\(\) AS count/);
    expect(sql).toMatch(/push_subscriptions lock timed out after 10s — retry the resync \(retryable\) \[55P03\]/);
    expect(sql).not.toMatch(/sync_log lock timed out after 10s — retry the resync \(retryable\) \[55P03\]/);
    expect(sql).toMatch(/WHEN lock_not_available/);
    expect(sql).not.toMatch(/SQLERRM ILIKE/);
    expect(sql).not.toMatch(/RETURNING \*/);
    expect(sql).not.toMatch(/def push_lock_sql|push_lock_timeout_probe_sql/);
    expect(COPY_PY).not.toMatch(/def push_lock_sql/);
    expect(COPY_PY).not.toMatch(/def push_lock_timeout_probe_sql/);
    const idxDelete = COPY_PY.indexOf("push_anti_join_delete_sql() + \";\"");
    const idxUpsert = COPY_PY.indexOf("push_upsert_sql() + \";\"");
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
    expect(WORKFLOW).toMatch(/is_retryable_lock_timeout/);
    expect(WORKFLOW).toMatch(/retryable_lock_timeout_stop\(stderr, script=resync_script\)/);
    expect(WORKFLOW).toMatch(/compose_resync_script/);
    expect(WORKFLOW).toMatch(/retryable_lock=True/);
    expect(WORKFLOW.match(/retryable_lock=True/g)?.length).toBe(1);
    expect(WORKFLOW).toMatch(/if retryable_lock and stderr and is_retryable_lock_timeout\(stderr\)/);
    expect(WORKFLOW).toMatch(/err = stderr or stdout/);
    expect(WORKFLOW).not.toMatch(/is_retryable_lock_timeout\(err\)/);
    expect(WORKFLOW).not.toMatch(/is_retryable_lock_timeout\(stdout\)/);
    expect(WORKFLOW).not.toMatch(/retryable_lock_timeout_stop\(err\)/);
    expect(WORKFLOW).not.toMatch(/die\(SYNC_LOG_LOCK_TIMEOUT_MESSAGE\)/);
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
    expect(DOC).toMatch(/SET LOCAL lock_timeout = '10s'/);
    expect(DOC).toMatch(/retry the resync \(retryable\)/);
    expect(DOC).toMatch(/lock_not_available/);
    expect(DOC).toMatch(/temp-table load/);
    expect(DOC).toMatch(/redacted psql error/);
    expect(DOC).toMatch(/deletes\s+missing ids first/);
    expect(DOC).toMatch(/phase=resync/);
    expect(DOC).toMatch(/SQLSTATE `55P03`/);
    expect(DOC).toMatch(/names that table from the\s+resync\.sql line number, not `sync_log`/);
    expect(DOC).toMatch(/\\set VERBOSITY sqlstate/);
    expect(DOC).toMatch(/ERROR:  55P03:/);
    expect(DOC).toMatch(/Only the resync target/);
    expect(DOC).toMatch(/psql:<file>:<n>: ERROR:/);
    expect(DOC).toMatch(/client_min_messages = error/);
    expect(DOC).toMatch(/pg_restore/);
    expect(DOC).toMatch(/no automatic retry/);
    expect(DOC).toMatch(/re-dispatch `cutover-migrate` with `phase=resync` by hand/);
    expect(DOC).toMatch(/CUTOVER_FLIPPED/);
    expect(DOC).toMatch(/skipped: true/);
    expect(DOC).toMatch(/`1`, `true`, `yes`, `on`/);
    expect(DOC).toMatch(/unschedule[\s\S]*phase=resync[\s\S]*CUTOVER_FLIPPED/);
    expect(DOC).toMatch(/about 1e6 further Neon inserts/);
    expect(DOC).not.toMatch(/Supabase-origin ids are all below the floor/);
    expect(DOC).not.toMatch(/never deletes ids in the parked identity window/);
  });

  it("documents aclexplode restore and idempotent unfreeze", () => {
    expect(DOC).toMatch(/aclexplode\(relacl\)/);
    expect(DOC).toMatch(/no new direct grants/);
    expect(DOC).toMatch(/idempotent/);
    expect(DOC).toMatch(/Partitioned tables, views, and column-level grants/);
  });
});
