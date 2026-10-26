"""Cutover copy-set helpers. Imported by cutover-migrate.yml and tests.

Never prints row data. Counts, hashes, and watermarks only.
"""

from __future__ import annotations

import json
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


def sync_log_load_sql() -> str:
    return (
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


def sync_log_anti_join_insert_sql() -> str:
    cols = ", ".join(SYNC_LOG_COLUMNS)
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
        "SELECT COUNT(*) FROM ins"
    )


# --exclude-table-data drops sequence data; OVERRIDING SYSTEM VALUE does
# not advance the identity. After resync, park last_value at max(id).
# After restore (empty table), park past source max + margin so a
# pre-resync Neon insert cannot take a Supabase id and silently drop it
# (ON CONFLICT DO NOTHING).
SYNC_LOG_SEQUENCE_MARGIN = 1_000_000


def sync_log_setval_sql() -> str:
    return (
        "SELECT setval(pg_get_serial_sequence('public.sync_log','id'), "
        "GREATEST((SELECT max(id) FROM public.sync_log),1))"
    )


def sync_log_reserve_sequence_sql(
    source_max_id: int,
    *,
    margin: int = SYNC_LOG_SEQUENCE_MARGIN,
) -> str:
    parked = max(int(source_max_id), 0) + int(margin)
    if parked < 1:
        parked = 1
    return (
        "SELECT setval(pg_get_serial_sequence('public.sync_log','id'), "
        f"{parked})"
    )


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
        ")"
    )


def push_upsert_sql() -> str:
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


def push_anti_join_delete_sql() -> str:
    return (
        "WITH gone AS (\n"
        "  DELETE FROM public.push_subscriptions t\n"
        "  WHERE NOT EXISTS (SELECT 1 FROM cutover_push_rows s WHERE s.id = t.id)\n"
        "  RETURNING 1\n"
        ")\n"
        "SELECT COUNT(*) FROM gone"
    )
