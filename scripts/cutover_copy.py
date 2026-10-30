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

# Billing stays on Supabase. Webhooks keep writing these; they are not
# frozen, not dumped, and not in the snapshot/parity proof.
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
