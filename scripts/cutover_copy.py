"""Cutover copy-set helpers. Imported by cutover-migrate.yml and tests.

Never prints row data. Counts, hashes, and watermarks only.
"""

from __future__ import annotations

import json
from typing import Any
from urllib.error import URLError
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
# Excluded from the frozen dump and parity; its tail is re-synced after
# the switch using the snapshot watermark.
COPY_SKIP_TABLES = frozenset(BILLING_TABLES | {"sync_log"})


def skipped_from_copy(name: str) -> bool:
    return name in COPY_SKIP_TABLES


def dump_exclude_args() -> list[str]:
    return [f"--exclude-table=public.{name}" for name in sorted(COPY_SKIP_TABLES)]


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


def sync_log_tail_copy_sql(watermark: dict[str, Any]) -> str:
    parsed = parse_watermark(watermark.get("id"), watermark.get("created_at"))
    return (
        "COPY (\n"
        "  SELECT id, user_id, provider, operation, status, error, created_at\n"
        "  FROM public.sync_log\n"
        f"  WHERE id > {parsed['id']} OR created_at > {sql_literal(parsed['created_at'])}::timestamptz\n"
        ") TO STDOUT WITH CSV"
    )


def sync_log_tail_load_sql() -> str:
    return (
        "CREATE TEMP TABLE cutover_sync_log_tail (\n"
        "  id bigint PRIMARY KEY,\n"
        "  user_id uuid,\n"
        "  provider text,\n"
        "  operation text,\n"
        "  status text,\n"
        "  error text,\n"
        "  created_at timestamptz\n"
        ")"
    )


def sync_log_tail_insert_sql() -> str:
    return (
        "WITH ins AS (\n"
        "  INSERT INTO public.sync_log (id, user_id, provider, operation, status, error, created_at)\n"
        "  OVERRIDING SYSTEM VALUE\n"
        "  SELECT id, user_id, provider, operation, status, error, created_at\n"
        "  FROM cutover_sync_log_tail\n"
        "  ON CONFLICT (id) DO NOTHING\n"
        "  RETURNING 1\n"
        ")\n"
        "SELECT COUNT(*) FROM ins"
    )


def push_ids_copy_sql() -> str:
    return "COPY (SELECT id::text FROM public.push_subscriptions) TO STDOUT WITH CSV"


def push_load_ids_sql() -> str:
    return "CREATE TEMP TABLE cutover_push_ids (id uuid PRIMARY KEY)"


def push_anti_join_delete_sql() -> str:
    return (
        "WITH gone AS (\n"
        "  DELETE FROM public.push_subscriptions t\n"
        "  WHERE NOT EXISTS (SELECT 1 FROM cutover_push_ids s WHERE s.id = t.id)\n"
        "  RETURNING 1\n"
        ")\n"
        "SELECT COUNT(*) FROM gone"
    )
