"""Cutover copy-set helpers. Imported by cutover-migrate.yml and tests.

Never prints row data. Counts, hashes, and watermarks only.
"""

from __future__ import annotations

import csv
import json
import os
import re
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# Billing webhooks keep writing these on Supabase during the copy window, so
# they are not frozen, not dumped, and not in the frozen snapshot/parity
# proof. They move by the separate scripted billing copy below
# (compose_billing_*), with its own read-only snapshot and parity, and
# re-run as phase=billing for the post-switch delta.
BILLING_TABLES = frozenset(
    {
        "subscriptions",
        "stripe_webhook_events",
        "apple_webhook_events",
        "apple_notification_events",
    }
)

# sync_log is written by billing webhooks via logSync during the window.
# Structure is dumped (--exclude-table-data); rows stay out of the frozen
# snapshot/parity and are copied after switch by id anti-join.
COPY_SKIP_TABLES = frozenset(BILLING_TABLES | {"sync_log"})

SYNC_LOG_COLUMNS = (
    "id",
    "user_id",
    "provider",
    "operation",
    "status",
    "error",
    "created_at",
)

PUSH_COLUMNS = (
    "id",
    "user_id",
    "created_at",
    "updated_at",
    "endpoint",
    "p256dh",
    "auth",
    "label",
    "time_zone",
    "last_seen_at",
    "failure_count",
)

FetchJson = Callable[[str], dict[str, Any]]


def skipped_from_copy(name: str) -> bool:
    return name in COPY_SKIP_TABLES


def dump_exclude_args() -> list[str]:
    args = [f"--exclude-table=public.{name}" for name in sorted(BILLING_TABLES)]
    args.append("--exclude-table-data=public.sync_log")
    return args


def is_dry_run_mode(mode: str | None = None) -> bool:
    """True when CUTOVER_MODE is dry-run. Default reads the env."""
    raw = (os.environ.get("CUTOVER_MODE") or "") if mode is None else mode
    return str(raw).strip().lower() == "dry-run"


def dump_requires_freeze(mode: str | None = None) -> bool:
    """Armed + WRITE_FREEZE preflight is cutover-only. Dry-run never arms or 503s."""
    return not is_dry_run_mode(mode)


def source_snapshot_is_fatal(mode: str | None = None) -> bool:
    """Source vs dump-time snapshot fails the job only on cutover (prod is frozen)."""
    return not is_dry_run_mode(mode)


def auth_parity_is_fatal(mode: str | None = None) -> bool:
    """Live source vs Better Auth must match on cutover. Dry-run sign-ins are report-only."""
    return not is_dry_run_mode(mode)


def maintenance_is_armed(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    value = payload.get("cutover_armed")
    if value is True:
        return True
    if isinstance(value, (int, float)) and value == 1:
        return True
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return False


def fetch_maintenance(url: str, *, timeout: float = 10.0) -> dict[str, Any]:
    req = Request(url, method="GET", headers={"Accept": "application/json"})
    with urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("maintenance payload is not an object")
    return payload


class CutoverArmedError(Exception):
    def __init__(self, message: str, *, code: str = "not_armed"):
        super().__init__(message)
        self.code = code


def assert_cutover_armed(url: str, *, fetch: FetchJson = fetch_maintenance) -> dict[str, Any]:
    if not (url or "").strip():
        raise CutoverArmedError(
            "MAINTENANCE_URL is required — ship a build with "
            "VITE_MAINTENANCE_URL and VITE_CUTOVER_ARMED=1 before arming",
            code="missing_url",
        )
    try:
        payload = fetch(url.strip())
    except CutoverArmedError:
        raise
    except Exception as exc:
        raise CutoverArmedError(
            f"maintenance endpoint unreachable — refuse to start copy "
            f"({type(exc).__name__})",
            code="unreachable",
        ) from exc
    if not maintenance_is_armed(payload):
        raise CutoverArmedError(
            "maintenance endpoint is not armed (cutover_armed is not true) "
            "— refuse to start copy",
            code="not_armed",
        )
    return payload


def post_status(url: str, *, timeout: float = 10.0) -> int:
    req = Request(
        url,
        method="POST",
        data=b"{}",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urlopen(req, timeout=timeout) as resp:
            return int(resp.status)
    except HTTPError as exc:
        return int(exc.code)


def edge_preflight_frozen(status: int) -> bool:
    return status == 503


def resolve_edge_preflight_url(preflight: str, supabase_url: str) -> str:
    explicit = (preflight or "").strip()
    if explicit:
        return explicit
    base = (supabase_url or "").strip().rstrip("/")
    if not base:
        raise ValueError(
            "WRITE_FREEZE_PREFLIGHT_URL or SUPABASE_URL is required for the freeze preflight"
        )
    return f"{base}/functions/v1/calendar-refresh"


def anon_insert_privilege_sql() -> str:
    return "SELECT has_table_privilege('anon', 'public.sync_log', 'INSERT')"


def anon_insert_denied(result: str) -> bool:
    text = (result or "").strip().lower()
    return text in {"f", "false", "0"}


def parse_watermark(id_value: Any, created_at: Any) -> dict[str, Any]:
    try:
        watermark_id = int(id_value)
    except (TypeError, ValueError) as exc:
        raise ValueError("sync_log watermark id must be an integer") from exc
    if watermark_id < 0:
        raise ValueError("sync_log watermark id must be >= 0")
    stamp = created_at if isinstance(created_at, str) and created_at else "-infinity"
    return {"id": watermark_id, "created_at": stamp}


def parse_watermark_line(line: str) -> dict[str, Any]:
    text = (line or "").strip()
    if not text:
        return parse_watermark(0, "-infinity")
    if "|" not in text:
        raise ValueError("sync_log watermark line must be id|created_at")
    ident, stamp = text.split("|", 1)
    return parse_watermark(ident, stamp)


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def sync_log_watermark_sql() -> str:
    return (
        "SELECT COALESCE(MAX(id), 0)::text || '|' || "
        "COALESCE(MAX(created_at)::text, '-infinity') "
        "FROM public.sync_log"
    )


def sync_log_copy_sql() -> str:
    cols = ", ".join(SYNC_LOG_COLUMNS)
    return f"COPY (SELECT {cols} FROM public.sync_log) TO STDOUT WITH CSV"


def csv_record_count(path: str | os.PathLike[str]) -> int:
    """Records in a `COPY … WITH CSV` file. A quoted field may hold newlines
    (five sync_log `error` texts do), so counting lines over-reports."""
    with open(path, newline="", encoding="utf-8") as fh:
        return sum(1 for row in csv.reader(fh) if row)


def sync_log_set_lock_timeout_sql(*, local: bool = False) -> str:
    kind = "LOCAL " if local else ""
    return f"SET {kind}lock_timeout = '{SYNC_LOG_LOCK_TIMEOUT}'"


def psql_verbosity_sql() -> str:
    """Print only SQLSTATE on errors — no message text to spoof."""
    return r"\set VERBOSITY sqlstate"


def strip_psql_meta(sql: str) -> str:
    """Drop psql meta-commands so libpq / PGlite can exec the SQL."""
    return "\n".join(
        line
        for line in (sql or "").splitlines()
        if not line.lstrip().startswith("\\")
    )


def sync_log_load_sql() -> str:
    # Session-level so CREATE TEMP / \\copy (before BEGIN) cannot hang either.
    # VERBOSITY sqlstate so the -f banner is `ERROR:  55P03` with no
    # message text (PG17 prints no colon after the code).
    # client_min_messages = error is the first SQL statement so NOTICE /
    # WARNING never print (INFO cannot be suppressed).
    return (
        psql_verbosity_sql() + "\n"
        + "SET client_min_messages = error;\n"
        + sync_log_set_lock_timeout_sql() + ";\n"
        "CREATE TEMP TABLE cutover_sync_log_src (\n"
        "  id bigint PRIMARY KEY,\n"
        "  user_id uuid,\n"
        "  provider text,\n"
        "  operation text,\n"
        "  status text,\n"
        "  error text,\n"
        "  created_at timestamptz\n"
        ")"
    )


def sync_log_anti_join_insert_sql(*, labeled: bool = False) -> str:
    cols = ", ".join(SYNC_LOG_COLUMNS)
    result = (
        "'sync_log_inserted=' || CAST(COUNT(*) AS text)" if labeled else "COUNT(*)"
    )
    return (
        "WITH ins AS (\n"
        f"  INSERT INTO public.sync_log ({cols})\n"
        "  OVERRIDING SYSTEM VALUE\n"
        f"  SELECT {cols}\n"
        "  FROM cutover_sync_log_src s\n"
        "  WHERE NOT EXISTS (SELECT 1 FROM public.sync_log t WHERE t.id = s.id)\n"
        "  ON CONFLICT (id) DO NOTHING\n"
        "  RETURNING 1\n"
        ")\n"
        f"SELECT {result} FROM ins"
    )


# --exclude-table-data drops sequence data; OVERRIDING SYSTEM VALUE does
# not advance the identity. After restore (empty table), park past source
# max + margin so Neon ids stay above Supabase ids for the switch window.
# Resync setval is monotonic: GREATEST(max(id), last_value, 1) never
# lowers the park. Same transaction as the anti-join (table + sequence
# locked) so an in-flight nextval cannot be undercut.
SYNC_LOG_SEQUENCE_MARGIN = 1_000_000

SYNC_LOG_SEQ = "pg_get_serial_sequence('public.sync_log','id')"
SYNC_LOG_SEQ_NAME = "public.sync_log_id_seq"
SYNC_LOG_LOCK_TIMEOUT = "10s"
LOCK_TIMEOUT_SQLSTATE = "55P03"
LOCK_TIMEOUT_TABLES = ("push_subscriptions", "sync_log")


def lock_timeout_message(table: str | None = None) -> str:
    named = f"{table} " if table else ""
    return (
        f"{named}lock timed out after 10s — retry the resync (retryable) "
        f"[{LOCK_TIMEOUT_SQLSTATE}]"
    )


SYNC_LOG_LOCK_TIMEOUT_MESSAGE = lock_timeout_message("sync_log")
PUSH_LOCK_TIMEOUT_MESSAGE = lock_timeout_message("push_subscriptions")


def sync_log_last_value_sql() -> str:
    return f"SELECT last_value FROM {SYNC_LOG_SEQ_NAME}"


def sync_log_setval_expr() -> str:
    return (
        f"setval({SYNC_LOG_SEQ}, "
        "GREATEST("
        "(SELECT max(id) FROM public.sync_log), "
        f"(SELECT last_value FROM {SYNC_LOG_SEQ_NAME}), "
        "1))"
    )


def sync_log_setval_sql() -> str:
    return "SELECT " + sync_log_setval_expr()


def sync_log_reserve_sequence_sql(
    source_max_id: int,
    *,
    margin: int = SYNC_LOG_SEQUENCE_MARGIN,
) -> str:
    parked = max(int(source_max_id), 0) + int(margin)
    if parked < 1:
        parked = 1
    return f"SELECT setval({SYNC_LOG_SEQ}, {parked})"


def sync_log_collision_count_sql() -> str:
    return (
        "SELECT COUNT(*) FROM cutover_sync_log_src s\n"
        "JOIN public.sync_log t ON t.id = s.id\n"
        "WHERE s.user_id IS DISTINCT FROM t.user_id\n"
        "   OR s.provider IS DISTINCT FROM t.provider\n"
        "   OR s.operation IS DISTINCT FROM t.operation\n"
        "   OR s.status IS DISTINCT FROM t.status\n"
        "   OR s.error IS DISTINCT FROM t.error\n"
        "   OR s.created_at IS DISTINCT FROM t.created_at"
    )


def sync_log_collision_guard_sql() -> str:
    return (
        "DO $cutover_sync_log_collision$\n"
        "DECLARE n bigint;\n"
        "BEGIN\n"
        "  SELECT COUNT(*) INTO n FROM cutover_sync_log_src s\n"
        "  JOIN public.sync_log t ON t.id = s.id\n"
        "  WHERE s.user_id IS DISTINCT FROM t.user_id\n"
        "     OR s.provider IS DISTINCT FROM t.provider\n"
        "     OR s.operation IS DISTINCT FROM t.operation\n"
        "     OR s.status IS DISTINCT FROM t.status\n"
        "     OR s.error IS DISTINCT FROM t.error\n"
        "     OR s.created_at IS DISTINCT FROM t.created_at;\n"
        "  IF n > 0 THEN\n"
        "    RAISE EXCEPTION 'sync_log id collision: % incoming row(s) differ on Neon', n;\n"
        "  END IF;\n"
        "END\n"
        "$cutover_sync_log_collision$"
    )


# Resync is `psql -f` + VERBOSITY sqlstate: a real banner is
# `psql:<file>:<n>: ERROR:  55P03` with no message (PG17 prints no
# colon after the code). Bare / pg_restore ERROR lines never count.
# Fail-closed: any INFO/NOTICE/WARNING/LOG/DEBUG banner before the
# first ERROR means the stream was spoofable — None.
PSQL_PRE_ERROR = re.compile(
    r"^psql:[^:\n]+:\d+: (INFO|NOTICE|WARNING|LOG|DEBUG\d?):",
    re.MULTILINE,
)
FIRST_ERROR_BANNER = re.compile(r"^psql:[^:\n]+:\d+: ERROR:", re.MULTILINE)
BARE_OR_RESTORE_ERROR = re.compile(
    r"^(?:ERROR:|pg_restore: error:)",
    re.MULTILINE,
)
RETRYABLE_LOCK_TIMEOUT_BANNER = re.compile(
    r"^psql:[^:\n]+:\d+: ERROR:\s+55P03(?::|[ \t]*$)",
    re.MULTILINE,
)
FIRST_PSQL_ERROR_SQLSTATE = re.compile(
    r"^psql:[^:\n]+:\d+: ERROR:\s+([0-9A-Z]{5})(?::|[ \t]*$)",
    re.MULTILINE,
)
PSQL_ERROR_LINE_NO = re.compile(
    r"^psql:[^:\n]+:(\d+): ERROR:\s+55P03(?::|[ \t]*$)",
    re.MULTILINE,
)
_RESYNC_PUSH_LINE = re.compile(
    r"cutover_push_|pg_temp\.cutover_push_|public\.push_subscriptions"
)
_RESYNC_SYNC_LINE = re.compile(
    r"cutover_sync_log|LOCK TABLE public\.sync_log|public\.sync_log"
)

# Prefer the failing statement / CONTEXT over a loose name match.
_LOCK_TIMEOUT_STATEMENT_TABLE = re.compile(
    r"(?is)(?:lock\s+table|delete\s+from|insert\s+into|update|from|into)\s+"
    r"(?:only\s+)?(?:public\.)?(push_subscriptions|sync_log)\b"
)


def table_from_lock_error(text: str) -> str | None:
    """Name the table from the failing statement or CONTEXT; never guess."""
    blob = text or ""
    match = _LOCK_TIMEOUT_STATEMENT_TABLE.search(blob)
    if match:
        return match.group(1).lower()
    lower = blob.lower()
    for table in LOCK_TIMEOUT_TABLES:
        if re.search(rf"(?<![a-z0-9_]){re.escape(table)}(?![a-z0-9_])", lower):
            return table
    return None


def compose_resync_script(*, sync_copy_sql: str, push_copy_sql: str) -> str:
    """The -f script the migrate job writes; line numbers are the table map."""
    return "\n".join(
        [
            sync_log_load_sql() + ";",
            sync_copy_sql,
            sync_log_resync_txn_sql(),
            push_load_rows_sql() + ";",
            push_copy_sql,
            push_anti_join_delete_sql() + ";",
            push_upsert_sql() + ";",
            "",
        ]
    )


def table_at_resync_line(script: str, line_no: int) -> str | None:
    """Table for a 1-based line of the generated resync.sql. Last section wins."""
    found: str | None = None
    for i, line in enumerate((script or "").splitlines(), start=1):
        if i > line_no:
            break
        if _RESYNC_PUSH_LINE.search(line):
            found = "push_subscriptions"
        elif _RESYNC_SYNC_LINE.search(line):
            found = "sync_log"
    return found


def table_from_resync_error(stderr: str, script: str) -> str | None:
    """Table from the first 55P03 banner's line number, not message text."""
    line = first_error_banner_line(stderr)
    if line is None:
        return None
    match = PSQL_ERROR_LINE_NO.match(line)
    if not match:
        return None
    return table_at_resync_line(script, int(match.group(1)))


def first_error_banner_line(text: str) -> str | None:
    """First `psql:<file>:<n>: ERROR:` banner. Chatter before it is fatal."""
    for raw in (text or "").splitlines():
        if PSQL_PRE_ERROR.match(raw):
            return None
        if FIRST_ERROR_BANNER.match(raw):
            return raw
        if BARE_OR_RESTORE_ERROR.match(raw):
            return None
    return None


def first_psql_sqlstate(text: str) -> str | None:
    """SQLSTATE on the first psql-prefixed ERROR banner; None if it has none."""
    line = first_error_banner_line(text)
    if line is None:
        return None
    match = FIRST_PSQL_ERROR_SQLSTATE.match(line)
    return match.group(1) if match else None


def is_retryable_lock_timeout(text: str) -> bool:
    """Retryable only when the first psql-prefixed ERROR banner is 55P03."""
    line = first_error_banner_line(text)
    return bool(line and RETRYABLE_LOCK_TIMEOUT_BANNER.match(line))


def retryable_lock_timeout_stop(
    redacted_psql_error: str,
    table: str | None = None,
    script: str | None = None,
) -> str:
    """Operator-facing stop: retryable banner plus the redacted psql text."""
    err = (redacted_psql_error or "").strip()
    named = (
        table
        or table_from_resync_error(err, script or "")
        or table_from_lock_error(err)
    )
    msg = lock_timeout_message(named)
    if not err:
        return msg
    return f"{msg}: {err}"


def lock_timeout_handler_sql(table: str) -> str:
    # PG lock_timeout raises lock_not_available (55P03), not query_canceled.
    # Key the rewrite on that SQLSTATE (WHEN lock_not_available), not SQLERRM.
    msg = lock_timeout_message(table).replace("'", "''")
    return (
        "EXCEPTION\n"
        "  WHEN lock_not_available THEN\n"
        f"    RAISE EXCEPTION '{msg}'\n"
        "      USING ERRCODE = 'lock_not_available';\n"
    )


def sync_log_lock_timeout_handler_sql() -> str:
    return lock_timeout_handler_sql("sync_log")


def sync_log_lock_sql() -> str:
    # SHARE ROW EXCLUSIVE waits for in-flight INSERTs and blocks new ones
    # (INSERT takes ROW EXCLUSIVE). nextval is only reached through INSERT
    # on this table. lock_timeout so a stuck writer cannot hang the job;
    # lock_not_available from lock timeout is rewritten as a retryable error.
    return (
        sync_log_set_lock_timeout_sql(local=True) + ";\n"
        "DO $cutover_sync_log_lock$\n"
        "BEGIN\n"
        "  LOCK TABLE public.sync_log IN SHARE ROW EXCLUSIVE MODE;\n"
        f"{sync_log_lock_timeout_handler_sql()}"
        "END\n"
        "$cutover_sync_log_lock$"
    )


def sync_log_lock_timeout_probe_sql(
    *,
    errcode: str = "lock_not_available",
    message: str = "canceling statement due to lock timeout",
) -> str:
    """Raise errcode/message through the same EXCEPTION rewrite the lock uses."""
    safe_code = errcode.replace("'", "")
    safe_msg = message.replace("'", "''")
    return (
        "DO $cutover_sync_log_lock_probe$\n"
        "BEGIN\n"
        f"  RAISE EXCEPTION '{safe_msg}' USING ERRCODE = '{safe_code}';\n"
        f"{sync_log_lock_timeout_handler_sql()}"
        "END\n"
        "$cutover_sync_log_lock_probe$"
    )


def sync_log_resync_txn_sql() -> str:
    """Lock, abort on content collision, anti-join insert, monotonic setval."""
    return "\n".join(
        [
            "BEGIN;",
            sync_log_lock_sql() + ";",
            sync_log_collision_guard_sql() + ";",
            sync_log_anti_join_insert_sql(labeled=True) + ";",
            "SELECT 'sync_log_setval=' || CAST(" + sync_log_setval_expr() + " AS text);",
            "COMMIT;",
        ]
    )


def parse_labeled_count(text: str, key: str) -> int | None:
    prefix = f"{key}="
    for raw in (text or "").splitlines():
        line = raw.strip().strip("'\"")
        if line.startswith(prefix):
            try:
                return int(line[len(prefix) :])
            except ValueError:
                return None
    return None


def watermark_filter_ids(source_ids: list[int], watermark_id: int) -> list[int]:
    """What a max(id) tail would copy — misses late-committed lower ids."""
    return [i for i in source_ids if i > watermark_id]


def anti_join_ids(source_ids: list[int], target_ids: list[int]) -> list[int]:
    present = set(target_ids)
    return [i for i in source_ids if i not in present]


def push_full_copy_sql() -> str:
    cols = ", ".join(PUSH_COLUMNS)
    return f"COPY (SELECT {cols} FROM public.push_subscriptions) TO STDOUT WITH CSV"


def push_load_rows_sql() -> str:
    return (
        "CREATE TEMP TABLE cutover_push_rows (\n"
        "  id uuid PRIMARY KEY,\n"
        "  user_id uuid,\n"
        "  created_at timestamptz,\n"
        "  updated_at timestamptz,\n"
        "  endpoint text,\n"
        "  p256dh text,\n"
        "  auth text,\n"
        "  label text,\n"
        "  time_zone text,\n"
        "  last_seen_at timestamptz,\n"
        "  failure_count integer\n"
        ");\n"
        + _push_count_fn_sql(
            "cutover_push_anti_join_delete",
            _push_anti_join_delete_body_sql(),
        )
        + ";\n"
        + _push_count_fn_sql("cutover_push_upsert", _push_upsert_body_sql())
    )


def _push_upsert_body_sql() -> str:
    cols = ", ".join(PUSH_COLUMNS)
    assignments = ",\n    ".join(f"{c} = EXCLUDED.{c}" for c in PUSH_COLUMNS if c != "id")
    return (
        "WITH upserted AS (\n"
        f"  INSERT INTO public.push_subscriptions ({cols})\n"
        f"  SELECT {cols} FROM cutover_push_rows\n"
        "  ON CONFLICT (id) DO UPDATE SET\n"
        f"    {assignments}\n"
        "  RETURNING 1\n"
        ")\n"
        "SELECT COUNT(*) FROM upserted"
    )


def _push_anti_join_delete_body_sql() -> str:
    return (
        "WITH gone AS (\n"
        "  DELETE FROM public.push_subscriptions t\n"
        "  WHERE NOT EXISTS (SELECT 1 FROM cutover_push_rows s WHERE s.id = t.id)\n"
        "  RETURNING 1\n"
        ")\n"
        "SELECT COUNT(*) FROM gone"
    )


def _push_count_fn_sql(name: str, body: str) -> str:
    """Session-scoped wrapper so a lock_timeout names this table on stderr."""
    return (
        f"CREATE OR REPLACE FUNCTION pg_temp.{name}() RETURNS bigint\n"
        "LANGUAGE plpgsql AS $cutover_push_fn$\n"
        "DECLARE n bigint;\n"
        "BEGIN\n"
        f"  EXECUTE $cutover_push_body${body}$cutover_push_body$ INTO n;\n"
        "  RETURN n;\n"
        f"{lock_timeout_handler_sql('push_subscriptions')}"
        "END\n"
        "$cutover_push_fn$"
    )


def push_upsert_sql() -> str:
    return "SELECT pg_temp.cutover_push_upsert() AS count"


def push_anti_join_delete_sql() -> str:
    return "SELECT pg_temp.cutover_push_anti_join_delete() AS count"


# Blocker 8 (docs/cloudflare-cutover.md): the restored Supabase schema keeps
# every planner FK pointed at auth.users(id) — a stub table nothing writes
# after the flip. A fresh Better Auth sign-up inserts public.users (the
# planner owner, `bootstrapUser`) and then user_settings, which failed on
# user_settings_user_id_fkey. Repoint each public → auth.users(id) FK at
# public.users(id), keeping its name and ON DELETE / ON UPDATE / DEFERRABLE
# clauses, so the copied database has the same owner as worker/schema/neon.sql.
# Not Better Auth's "user": its id is TEXT and planner user_id is UUID.
# Runs after PUBLIC_USERS_SQL (every copied account already has its row, so
# ADD CONSTRAINT validates). Idempotent: a second run finds nothing to move.
REPOINT_OWNER_FKS_SQL = r"""
DO $repoint$
DECLARE
  fk record;
  def text;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RETURN;
  END IF;
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'public.users must exist before repointing owner FKs';
  END IF;
  FOR fk IN
    SELECT c.oid, c.conname, c.conrelid::regclass AS tbl, c.confkey
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE c.contype = 'f'
      AND c.confrelid = 'auth.users'::regclass
      AND n.nspname = 'public'
  LOOP
    def := pg_get_constraintdef(fk.oid);
    IF def !~ 'REFERENCES auth\.users\(id\)' THEN
      RAISE EXCEPTION 'FK % on % references auth.users by a column other than id: %',
        fk.conname, fk.tbl, def;
    END IF;
    def := regexp_replace(def, 'REFERENCES auth\.users\(id\)', 'REFERENCES public.users(id)');
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.tbl, fk.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', fk.tbl, fk.conname, def);
  END LOOP;
END
$repoint$;
"""

# Must print 0 after REPOINT_OWNER_FKS_SQL; the restore dies otherwise.
OWNER_FKS_ON_AUTH_USERS_SQL = """
SELECT count(*)
FROM pg_constraint c
JOIN pg_class r ON r.oid = c.conrelid
JOIN pg_namespace n ON n.oid = r.relnamespace
WHERE c.contype = 'f'
  AND to_regclass('auth.users') IS NOT NULL
  AND c.confrelid = to_regclass('auth.users')
  AND n.nspname = 'public'
"""


# Blocker 7: every public table with a field_ts column must carry the stamp
# trigger from worker/schema/field-ts.sql. Must print 0 after the install.
FIELD_TS_TRIGGERS_MISSING_SQL = """
SELECT count(*)
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.column_name = 'field_ts'
  AND NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = format('public.%I', c.table_name)::regclass
      AND t.tgname = c.table_name || '_stamp_field_ts'
      AND NOT t.tgisinternal
  )
"""


# ---------------------------------------------------------------------------
# Billing copy (docs/cloudflare-cutover.md § Billing port → Flip night 1 and 5).
#
# Billing tables stay out of pg_dump and the frozen snapshot: Stripe / Apple
# webhooks keep writing Supabase through the copy window by design. Instead
# this copies them Supabase → target (Neon in cutover, scratch in dry-run)
# over the columns both sides have, from ONE read-only REPEATABLE READ
# snapshot on the source, then proves parity with counts + md5 only.
#
#   subscriptions          upsert by user_id; newer updated_at wins
#   stripe_webhook_events  insert, ON CONFLICT (event_id) DO NOTHING
#   apple_webhook_events   insert, ON CONFLICT (event_id) DO NOTHING
#   apple_notification_events (legacy, source only, optional)
#       notification_uuid → apple_webhook_events.event_id,
#       received_at       → apple_webhook_events.created_at (now() if absent),
#       ON CONFLICT (event_id) DO NOTHING. Neon has no such table: the
#       ledger only has to recognise the id so a retry is still deduped.
#
# Parity rule (billing_parity_problems): target ⊇ source.
#   1. The rows loaded into the target's temp table hash exactly like the
#      source snapshot (count + md5) — what was copied is what was read.
#   2. Every source key exists on the target (missing = 0). For the legacy
#      ledger that is every notification_uuid as an apple_webhook_events
#      event_id.
#   3. Over the source keys, the target's rows hash exactly like the source
#      rows (same columns, same canonical text, same order). For
#      subscriptions a key whose target updated_at is strictly newer (the
#      Worker wrote it after the flip) is left out of both sides and
#      counted as target_newer — allowed only in phase=billing; in the
#      copy phase the target was just created, so it must be 0.
#   4. Target rows with no source key (target_extra) are reported, never
#      fatal: after the flip the Worker creates rows Supabase never sees.
# ---------------------------------------------------------------------------

BILLING_COPY_KEYS: dict[str, str] = {
    "subscriptions": "user_id",
    "stripe_webhook_events": "event_id",
    "apple_webhook_events": "event_id",
}
BILLING_COPY_ORDER = ("subscriptions", "stripe_webhook_events", "apple_webhook_events")
LEGACY_APPLE_LEDGER = "apple_notification_events"
LEGACY_APPLE_KEY = "notification_uuid"
LEGACY_APPLE_STAMP = "received_at"
BILLING_UPSERT_TABLE = "subscriptions"
BILLING_UPSERT_STAMP = "updated_at"
BILLING_UPDATED_AT_TRIGGER = "subscriptions_set_updated_at"
BILLING_LOCK_TIMEOUT = "10s"
BILLING_SCHEMA_MARKER = "-- Billing (the Worker port"

_BILLING_LINE = re.compile(
    r"^billing\|(src|load|cmp|dst|missing|newer|extra|written)\|(\w+)\|(\d+)\|([0-9a-f]{32}|-)$"
)
_BILLING_COL_LINE = re.compile(r"^billing_col\|(\w+)\|([^|]+)\|(YES|NO)\|(t|f|true|false)$")
_BARE_IDENT = re.compile(r"^[a-z_][a-z0-9_]*$")


class BillingCopyError(ValueError):
    """The billing copy cannot run safely; nothing has been written."""


def _ident(name: str) -> str:
    if _BARE_IDENT.match(name):
        return name
    return '"' + name.replace('"', '""') + '"'


def billing_temp_table(table: str) -> str:
    return f"cutover_billing_{table}"


def billing_columns_sql() -> str:
    """One `billing_col|table|column|nullable|has_default` line per column."""
    names = ", ".join(
        sql_literal(t) for t in (*BILLING_COPY_ORDER, LEGACY_APPLE_LEDGER)
    )
    return (
        "SELECT 'billing_col|' || table_name || '|' || column_name || '|' || "
        "is_nullable || '|' || "
        "(column_default IS NOT NULL OR is_identity = 'YES' "
        "OR is_generated <> 'NEVER')::text "
        "FROM information_schema.columns "
        f"WHERE table_schema = 'public' AND table_name IN ({names}) "
        "ORDER BY table_name, ordinal_position"
    )


def parse_billing_columns(text: str) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for raw in (text or "").splitlines():
        match = _BILLING_COL_LINE.match(raw.strip())
        if not match:
            continue
        table, column, nullable, has_default = match.groups()
        out.setdefault(table, []).append(
            {
                "name": column,
                "nullable": nullable == "YES",
                "has_default": has_default in {"t", "true"},
            }
        )
    return out


def billing_common_columns(
    table: str,
    source_cols: list[dict[str, Any]] | None,
    target_cols: list[dict[str, Any]] | None,
) -> list[str]:
    """Columns in both, in target order. Refuses a target NOT NULL column
    without a default that the source cannot fill."""
    if not target_cols:
        raise BillingCopyError(f"target is missing public.{table}")
    if not source_cols:
        raise BillingCopyError(f"source is missing public.{table}")
    key = BILLING_COPY_KEYS[table]
    have = {c["name"] for c in source_cols}
    if key not in have or key not in {c["name"] for c in target_cols}:
        raise BillingCopyError(f"{table}.{key} must exist on both sides")
    for col in target_cols:
        if col["name"] in have:
            continue
        if not col["nullable"] and not col["has_default"]:
            raise BillingCopyError(
                f"target {table}.{col['name']} is NOT NULL without a default "
                "and the source has no such column"
            )
    common = [c["name"] for c in target_cols if c["name"] in have]
    if table == BILLING_UPSERT_TABLE and BILLING_UPSERT_STAMP not in common:
        raise BillingCopyError(
            f"{table}.{BILLING_UPSERT_STAMP} must exist on both sides (newer wins)"
        )
    return common


def billing_plan(
    source_meta: dict[str, list[dict[str, Any]]],
    target_meta: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    """Tables, keys and common columns; legacy ledger only if the source has it."""
    tables = [
        {
            "table": table,
            "key": BILLING_COPY_KEYS[table],
            "columns": billing_common_columns(
                table, source_meta.get(table), target_meta.get(table)
            ),
        }
        for table in BILLING_COPY_ORDER
    ]
    legacy: dict[str, Any] | None = None
    legacy_cols = source_meta.get(LEGACY_APPLE_LEDGER)
    if legacy_cols:
        names = [c["name"] for c in legacy_cols]
        if LEGACY_APPLE_KEY not in names:
            raise BillingCopyError(
                f"source {LEGACY_APPLE_LEDGER} has no {LEGACY_APPLE_KEY} column"
            )
        allowed = {"event_id", "created_at"}
        for col in target_meta.get("apple_webhook_events") or []:
            if col["name"] in allowed:
                continue
            if not col["nullable"] and not col["has_default"]:
                raise BillingCopyError(
                    f"target apple_webhook_events.{col['name']} is NOT NULL "
                    f"without a default; {LEGACY_APPLE_LEDGER} cannot fill it"
                )
        target_names = {c["name"] for c in target_meta.get("apple_webhook_events") or []}
        if "created_at" not in target_names:
            raise BillingCopyError("target apple_webhook_events.created_at is missing")
        cols = [LEGACY_APPLE_KEY]
        if LEGACY_APPLE_STAMP in names:
            cols.append(LEGACY_APPLE_STAMP)
        legacy = {"table": LEGACY_APPLE_LEDGER, "key": LEGACY_APPLE_KEY, "columns": cols}
    return {"tables": tables, "legacy": legacy}


def billing_plan_entries(plan: dict[str, Any]) -> list[dict[str, Any]]:
    entries = list(plan["tables"])
    if plan.get("legacy"):
        entries.append(plan["legacy"])
    return entries


def billing_schema_missing(target_meta: dict[str, list[dict[str, Any]]]) -> list[str]:
    return [t for t in BILLING_COPY_ORDER if not target_meta.get(t)]


def billing_schema_sql(neon_sql: str) -> str:
    """The billing DDL from worker/schema/neon.sql: set_updated_at() plus the
    billing section to the end of the file. Idempotent (IF NOT EXISTS /
    OR REPLACE). The restored Supabase schema has none of it, because the
    dump excludes the billing tables and the restore drops functions."""
    text = neon_sql or ""
    fn = re.search(
        r"CREATE OR REPLACE FUNCTION public\.set_updated_at\(\).*?\n\$\$;\n",
        text,
        re.S,
    )
    at = text.find(BILLING_SCHEMA_MARKER)
    if not fn or at < 0:
        raise BillingCopyError("neon.sql billing section not found")
    start = text.rfind("\n-- ----", 0, at)
    section = text[(start + 1 if start >= 0 else at):]
    for table in BILLING_COPY_ORDER:
        if f"CREATE TABLE IF NOT EXISTS public.{table} " not in section:
            raise BillingCopyError(f"neon.sql billing section has no {table}")
    return fn.group(0) + "\n" + section.rstrip() + "\n"


def billing_session_sql() -> str:
    """Same canonical text on both sides: row text of timestamptz depends on these."""
    return "SET TIME ZONE 'UTC';\nSET datestyle = 'ISO, MDY';\nSET intervalstyle = 'postgres';"


def billing_hash_expr(columns: list[str], key: str, alias: str = "a") -> str:
    row = ", ".join(f"{alias}.{_ident(c)}" for c in columns)
    return (
        f"md5(COALESCE(string_agg(md5(ROW({row})::text), '' "
        f"ORDER BY {alias}.{_ident(key)}::text COLLATE \"C\"), ''))"
    )


def _billing_line_sql(kind: str, table: str, rest: str) -> str:
    return f"SELECT 'billing|{kind}|{table}|' || {rest}"


def _billing_count_hash(kind: str, entry: dict[str, Any], source: str) -> str:
    expr = billing_hash_expr(entry["columns"], entry["key"])
    return _billing_line_sql(
        kind, entry["table"], f"COUNT(*)::text || '|' || {expr} FROM {source}"
    )


def billing_source_copy_query(entry: dict[str, Any]) -> str:
    """Single line — psql's \\copy takes the rest of the line."""
    cols = ", ".join(_ident(c) for c in entry["columns"])
    return (
        f"SELECT {cols} FROM public.{_ident(entry['table'])} "
        f"ORDER BY {_ident(entry['key'])}"
    )


def billing_source_hash_sql(entry: dict[str, Any]) -> str:
    return _billing_count_hash("src", entry, f"public.{_ident(entry['table'])} a")


def billing_source_begin_sql() -> str:
    return "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"


def compose_billing_source_script(plan: dict[str, Any], files: dict[str, str]) -> str:
    """psql -f on the source: one read-only snapshot for every copy + hash."""
    lines = [billing_session_sql(), billing_source_begin_sql() + ";"]
    for entry in billing_plan_entries(plan):
        path = files[entry["table"]]
        lines.append(
            f"\\copy ({billing_source_copy_query(entry)}) TO {sql_literal(path)} WITH CSV"
        )
        lines.append(billing_source_hash_sql(entry) + ";")
    lines.append("COMMIT;")
    return "\n".join(lines) + "\n"


def billing_target_prepare_sql(plan: dict[str, Any]) -> str:
    """Temp tables typed like the target (so both hashes see the same types)."""
    stmts = []
    for entry in plan["tables"]:
        cols = ", ".join(_ident(c) for c in entry["columns"])
        stmts.append(
            f"CREATE TEMP TABLE {billing_temp_table(entry['table'])} AS "
            f"SELECT {cols} FROM public.{_ident(entry['table'])} WITH NO DATA"
        )
    legacy = plan.get("legacy")
    if legacy:
        cols = [f"{LEGACY_APPLE_KEY} text"]
        if LEGACY_APPLE_STAMP in legacy["columns"]:
            cols.append(f"{LEGACY_APPLE_STAMP} timestamptz")
        stmts.append(
            f"CREATE TEMP TABLE {billing_temp_table(LEGACY_APPLE_LEDGER)} "
            f"({', '.join(cols)})"
        )
    return ";\n".join(stmts)


def billing_upsert_sql(entry: dict[str, Any]) -> str:
    table, key = entry["table"], entry["key"]
    cols = ", ".join(_ident(c) for c in entry["columns"])
    tmp = billing_temp_table(table)
    if table == BILLING_UPSERT_TABLE:
        sets = ",\n    ".join(
            f"{_ident(c)} = EXCLUDED.{_ident(c)}" for c in entry["columns"] if c != key
        )
        conflict = (
            f"  ON CONFLICT ({_ident(key)}) DO UPDATE SET\n"
            f"    {sets}\n"
            f"  WHERE EXCLUDED.{BILLING_UPSERT_STAMP} > t.{BILLING_UPSERT_STAMP}\n"
        )
    else:
        conflict = f"  ON CONFLICT ({_ident(key)}) DO NOTHING\n"
    return (
        "WITH w AS (\n"
        f"  INSERT INTO public.{_ident(table)} AS t ({cols})\n"
        f"  SELECT {cols} FROM {tmp}\n"
        f"{conflict}"
        "  RETURNING 1\n"
        ")\n"
        + _billing_line_sql("written", table, "COUNT(*)::text || '|-' FROM w")
    )


def billing_legacy_insert_sql(legacy: dict[str, Any]) -> str:
    tmp = billing_temp_table(LEGACY_APPLE_LEDGER)
    stamp = (
        f"COALESCE(s.{LEGACY_APPLE_STAMP}, now())"
        if LEGACY_APPLE_STAMP in legacy["columns"]
        else "now()"
    )
    return (
        "WITH w AS (\n"
        "  INSERT INTO public.apple_webhook_events AS t (event_id, created_at)\n"
        f"  SELECT s.{LEGACY_APPLE_KEY}, {stamp} FROM {tmp} s\n"
        f"  WHERE s.{LEGACY_APPLE_KEY} IS NOT NULL\n"
        "  ON CONFLICT (event_id) DO NOTHING\n"
        "  RETURNING 1\n"
        ")\n"
        + _billing_line_sql("written", LEGACY_APPLE_LEDGER, "COUNT(*)::text || '|-' FROM w")
    )


def billing_trigger_toggle_sql(*, enable: bool) -> str:
    """The BEFORE UPDATE stamp would overwrite the copied updated_at with now()
    and break parity. Off only inside the copy transaction (ALTER TABLE takes
    ACCESS EXCLUSIVE, so no Worker write slips in), back on before COMMIT."""
    trig = BILLING_UPDATED_AT_TRIGGER
    if enable:
        body = (
            "  IF current_setting('cutover.billing_trigger_off', true) = 'on' THEN\n"
            f"    ALTER TABLE public.subscriptions ENABLE TRIGGER {trig};\n"
            "  END IF;\n"
        )
    else:
        body = (
            "  IF EXISTS (\n"
            "    SELECT 1 FROM pg_trigger\n"
            "    WHERE tgrelid = 'public.subscriptions'::regclass\n"
            f"      AND tgname = '{trig}' AND tgenabled <> 'D'\n"
            "  ) THEN\n"
            f"    ALTER TABLE public.subscriptions DISABLE TRIGGER {trig};\n"
            "    PERFORM set_config('cutover.billing_trigger_off', 'on', true);\n"
            "  END IF;\n"
        )
    return (
        "DO $cutover_billing_trigger$\n"
        "BEGIN\n"
        f"{body}"
        "END\n"
        "$cutover_billing_trigger$"
    )


def billing_apply_txn_sql(plan: dict[str, Any]) -> str:
    stmts = [
        "BEGIN;",
        f"SET LOCAL lock_timeout = '{BILLING_LOCK_TIMEOUT}';",
        billing_trigger_toggle_sql(enable=False) + ";",
    ]
    for entry in plan["tables"]:
        stmts.append(billing_upsert_sql(entry) + ";")
    if plan.get("legacy"):
        # After the real Apple ledger, so its created_at wins a shared id.
        stmts.append(billing_legacy_insert_sql(plan["legacy"]) + ";")
    stmts.append(billing_trigger_toggle_sql(enable=True) + ";")
    stmts.append("COMMIT;")
    return "\n".join(stmts)


def billing_target_parity_sql(plan: dict[str, Any]) -> str:
    stmts: list[str] = []
    legacy = plan.get("legacy")
    for entry in plan["tables"]:
        table, key = entry["table"], _ident(entry["key"])
        tmp = billing_temp_table(table)
        real = f"public.{_ident(table)}"
        stmts.append(_billing_count_hash("load", entry, f"{tmp} a"))
        if table == BILLING_UPSERT_TABLE:
            stamp = BILLING_UPSERT_STAMP
            stmts.append(
                _billing_count_hash(
                    "cmp",
                    entry,
                    f"{tmp} a WHERE NOT EXISTS (SELECT 1 FROM {real} t "
                    f"WHERE t.{key} = a.{key} AND t.{stamp} > a.{stamp})",
                )
            )
            stmts.append(
                _billing_count_hash(
                    "dst",
                    entry,
                    f"{real} a WHERE EXISTS (SELECT 1 FROM {tmp} s "
                    f"WHERE s.{key} = a.{key} AND NOT (a.{stamp} > s.{stamp}))",
                )
            )
            stmts.append(
                _billing_line_sql(
                    "newer",
                    table,
                    f"COUNT(*)::text || '|-' FROM {tmp} s JOIN {real} t "
                    f"ON t.{key} = s.{key} WHERE t.{stamp} > s.{stamp}",
                )
            )
        else:
            stmts.append(_billing_count_hash("cmp", entry, f"{tmp} a"))
            stmts.append(
                _billing_count_hash(
                    "dst",
                    entry,
                    f"{real} a WHERE EXISTS (SELECT 1 FROM {tmp} s WHERE s.{key} = a.{key})",
                )
            )
            stmts.append(_billing_line_sql("newer", table, "'0|-'"))
        stmts.append(
            _billing_line_sql(
                "missing",
                table,
                f"COUNT(*)::text || '|-' FROM {tmp} s "
                f"WHERE NOT EXISTS (SELECT 1 FROM {real} t WHERE t.{key} = s.{key})",
            )
        )
        extra_where = f"NOT EXISTS (SELECT 1 FROM {tmp} s WHERE s.{key} = t.{key})"
        if legacy and table == "apple_webhook_events":
            ltmp = billing_temp_table(LEGACY_APPLE_LEDGER)
            extra_where += (
                f" AND NOT EXISTS (SELECT 1 FROM {ltmp} l "
                f"WHERE l.{LEGACY_APPLE_KEY} = t.event_id)"
            )
        stmts.append(
            _billing_line_sql(
                "extra", table, f"COUNT(*)::text || '|-' FROM {real} t WHERE {extra_where}"
            )
        )
    if legacy:
        ltmp = billing_temp_table(LEGACY_APPLE_LEDGER)
        stmts.append(_billing_count_hash("load", legacy, f"{ltmp} a"))
        stmts.append(
            _billing_line_sql(
                "missing",
                LEGACY_APPLE_LEDGER,
                f"COUNT(*)::text || '|-' FROM {ltmp} s "
                "WHERE NOT EXISTS (SELECT 1 FROM public.apple_webhook_events t "
                f"WHERE t.event_id = s.{LEGACY_APPLE_KEY})",
            )
        )
    return ";\n".join(stmts)


def compose_billing_target_script(plan: dict[str, Any], files: dict[str, str]) -> str:
    """psql -f on the target: load the source CSVs, apply in one transaction,
    then print parity lines (counts + md5 only)."""
    lines = [
        psql_verbosity_sql(),
        "SET client_min_messages = error;",
        billing_session_sql(),
        billing_target_prepare_sql(plan) + ";",
    ]
    for entry in billing_plan_entries(plan):
        cols = ", ".join(_ident(c) for c in entry["columns"])
        lines.append(
            f"\\copy {billing_temp_table(entry['table'])} ({cols}) "
            f"FROM {sql_literal(files[entry['table']])} WITH CSV"
        )
    lines.append(billing_apply_txn_sql(plan))
    lines.append(billing_target_parity_sql(plan) + ";")
    return "\n".join(lines) + "\n"


def parse_billing_lines(text: str) -> dict[str, dict[str, Any]]:
    """{table: {kind: {"n": int, "hash": str|None}}} from billing|… lines."""
    out: dict[str, dict[str, Any]] = {}
    for raw in (text or "").splitlines():
        match = _BILLING_LINE.match(raw.strip())
        if not match:
            continue
        kind, table, n, digest = match.groups()
        out.setdefault(table, {})[kind] = {
            "n": int(n),
            "hash": None if digest == "-" else digest,
        }
    return out


def _same_count_hash(a: Any, b: Any) -> bool:
    return (
        isinstance(a, dict)
        and isinstance(b, dict)
        and isinstance(a.get("n"), int)
        and a.get("n") == b.get("n")
        and bool(a.get("hash"))
        and a.get("hash") == b.get("hash")
    )


def _n(row: Any) -> int | None:
    return row.get("n") if isinstance(row, dict) else None


def billing_parity_problems(
    source: dict[str, dict[str, Any]],
    target: dict[str, dict[str, Any]],
    plan: dict[str, Any],
    *,
    allow_target_newer: bool,
) -> list[str]:
    """Empty list = parity holds. Counts and hashes only, never row data."""
    problems: list[str] = []
    for entry in billing_plan_entries(plan):
        table = entry["table"]
        src = (source.get(table) or {}).get("src")
        dst = target.get(table) or {}
        load = dst.get("load")
        if not _same_count_hash(src, load):
            problems.append(
                f"{table}: loaded {_n(load)}/{(load or {}).get('hash')} "
                f"!= source snapshot {_n(src)}/{(src or {}).get('hash')}"
            )
        missing = _n(dst.get("missing"))
        if missing != 0:
            problems.append(f"{table}: {missing} source key(s) missing on target")
        if table == LEGACY_APPLE_LEDGER:
            continue
        cmp_, got = dst.get("cmp"), dst.get("dst")
        if not _same_count_hash(cmp_, got):
            problems.append(
                f"{table}: target {_n(got)}/{(got or {}).get('hash')} "
                f"!= source {_n(cmp_)}/{(cmp_ or {}).get('hash')} over the source keys"
            )
        newer = _n(dst.get("newer"))
        if newer is None:
            problems.append(f"{table}: no target_newer count")
            continue
        if newer and not allow_target_newer:
            problems.append(
                f"{table}: {newer} target row(s) newer than source "
                "(only allowed in phase=billing, after the flip)"
            )
        if _n(cmp_) is not None and _n(load) is not None and _n(cmp_) + newer != _n(load):
            problems.append(
                f"{table}: compared {_n(cmp_)} + target_newer {newer} != loaded {_n(load)}"
            )
    return problems


def billing_report_lines(
    source: dict[str, dict[str, Any]],
    target: dict[str, dict[str, Any]],
    plan: dict[str, Any],
    problems: list[str],
    *,
    phase: str,
) -> list[str]:
    """Markdown for cutover-report.md. Table names, counts and md5s only."""
    lines = [
        "",
        f"## Billing copy (phase={phase})",
        "",
        "Supabase snapshot (REPEATABLE READ READ ONLY) → target. Rule: target ⊇ source; "
        "target rows over the source keys hash like the source; subscriptions rows "
        "newer on the target are counted, not compared (phase=billing only).",
        "",
        "| table | source_count | source_md5 | written | target_count | target_md5 "
        "| missing | target_newer | target_extra | ok |",
        "| --- | ---: | --- | ---: | ---: | --- | ---: | ---: | ---: | --- |",
    ]
    for entry in billing_plan_entries(plan):
        table = entry["table"]
        src = (source.get(table) or {}).get("src") or {}
        dst = target.get(table) or {}
        got = dst.get("dst") or {}
        ok = not any(p.startswith(f"{table}:") for p in problems)

        def cell(row: Any, key: str = "n") -> str:
            if not isinstance(row, dict) or row.get(key) is None:
                return "-"
            return str(row.get(key))

        lines.append(
            f"| {table} | {cell(src)} | {cell(src, 'hash')} | {cell(dst.get('written'))} "
            f"| {cell(got)} | {cell(got, 'hash')} | {cell(dst.get('missing'))} "
            f"| {cell(dst.get('newer'))} | {cell(dst.get('extra'))} | {'yes' if ok else 'NO'} |"
        )
    if not plan.get("legacy"):
        lines.append("")
        lines.append(f"- {LEGACY_APPLE_LEDGER}: not on source, skipped")
    lines.extend(["", f"billing mismatches: {len(problems)}", ""])
    return lines
