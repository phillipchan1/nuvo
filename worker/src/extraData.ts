/**
 * Token-safe REST for tables that are not on generic planner /api/data.
 * List functions never select token columns.
 */
import type { Context } from "hono";
import { json, OPEN_CORS } from "./cors.ts";
import {
  deleteOwnedActivityBinding,
  deleteOwnedCalendarAccount,
  deleteOwnedPushByEndpoint,
  getOwnedExternalEvent,
  insertActivityBinding,
  insertConnection,
  insertPushSubscription,
  listOwnedActivityBindings,
  listOwnedActivitySources,
  listOwnedActivityUnits,
  listOwnedCalendarAccounts,
  listOwnedConnections,
  listOwnedExternalEvents,
  listOwnedPushSubscriptions,
  updateOwnedConnection,
  updateOwnedExternalEvent,
  type Store,
} from "./store.ts";
import type { AppEnv } from "./session.ts";

export const EXTRA_DATA_TABLES = [
  "calendar_accounts",
  "external_events",
  "connections",
  "activity_sources",
  "activity_bindings",
  "activity_units",
  "push_subscriptions",
] as const;

export type ExtraDataTable = (typeof EXTRA_DATA_TABLES)[number];

export function isExtraDataTable(name: string): name is ExtraDataTable {
  return (EXTRA_DATA_TABLES as readonly string[]).includes(name);
}

export async function listExtra(
  store: Store,
  table: ExtraDataTable,
): Promise<Record<string, unknown>[]> {
  switch (table) {
    case "calendar_accounts":
      return listOwnedCalendarAccounts(store);
    case "external_events":
      return listOwnedExternalEvents(store);
    case "connections":
      return listOwnedConnections(store);
    case "activity_sources":
      return listOwnedActivitySources(store);
    case "activity_bindings":
      return listOwnedActivityBindings(store);
    case "activity_units":
      return listOwnedActivityUnits(store);
    case "push_subscriptions":
      return listOwnedPushSubscriptions(store);
  }
}

export async function getExtra(
  store: Store,
  table: ExtraDataTable,
  id: string,
): Promise<Record<string, unknown> | null> {
  // List helpers omit token columns. Do not use getOwnedCalendarAccount here —
  // that SELECT * is for the calendar sync path, not REST.
  if (table === "external_events") return getOwnedExternalEvent(store, id);
  const rows = await listExtra(store, table);
  return rows.find((row) => row.id === id) ?? null;
}

export async function writeExtra(
  store: Store,
  table: ExtraDataTable,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (table === "connections") {
    if (typeof body.app !== "string" || typeof body.name !== "string" || typeof body.token_hash !== "string") {
      return null;
    }
    return insertConnection(store, {
      id: typeof body.id === "string" ? body.id : undefined,
      app: body.app,
      name: body.name,
      token_hash: body.token_hash,
      last_four: typeof body.last_four === "string" ? body.last_four : undefined,
      scopes: body.scopes,
    });
  }
  if (table === "activity_bindings") {
    if (typeof body.source_id !== "string" || typeof body.project_id !== "string" || typeof body.selector !== "string") {
      return null;
    }
    return insertActivityBinding(store, {
      id: typeof body.id === "string" ? body.id : undefined,
      source_id: body.source_id,
      project_id: body.project_id,
      selector: body.selector,
    });
  }
  if (table === "push_subscriptions") {
    if (typeof body.endpoint !== "string" || typeof body.p256dh !== "string" || typeof body.auth !== "string") {
      return null;
    }
    return insertPushSubscription(store, {
      id: typeof body.id === "string" ? body.id : undefined,
      endpoint: body.endpoint,
      p256dh: body.p256dh,
      auth: body.auth,
      label: typeof body.label === "string" ? body.label : null,
      time_zone: typeof body.time_zone === "string" ? body.time_zone : null,
    });
  }
  return null;
}

export async function patchExtra(
  store: Store,
  table: ExtraDataTable,
  id: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (table === "external_events") return updateOwnedExternalEvent(store, id, body);
  if (table === "connections") return updateOwnedConnection(store, id, body);
  return null;
}

export async function deleteExtra(
  store: Store,
  table: ExtraDataTable,
  id: string,
  query: { endpoint?: string },
): Promise<number> {
  if (table === "calendar_accounts") return deleteOwnedCalendarAccount(store, id);
  if (table === "activity_bindings") return deleteOwnedActivityBinding(store, id);
  if (table === "push_subscriptions") {
    if (query.endpoint) return deleteOwnedPushByEndpoint(store, query.endpoint);
    const rows = await listOwnedPushSubscriptions(store);
    const row = rows.find((r) => r.id === id);
    const endpoint = typeof row?.endpoint === "string" ? row.endpoint : "";
    return endpoint ? deleteOwnedPushByEndpoint(store, endpoint) : 0;
  }
  if (table === "connections") {
    const row = await updateOwnedConnection(store, id, { revoked_at: new Date().toISOString() });
    return row ? 1 : 0;
  }
  return 0;
}

export function extraNotFound(): Response {
  return json({ error: "not found" }, 404, OPEN_CORS);
}

export function extraBadRequest(): Response {
  return json({ error: "cannot insert" }, 400, OPEN_CORS);
}

export function extraOk(data: unknown, status = 200): Response {
  return json({ data }, status, OPEN_CORS);
}

export function extraDeleted(n: number): Response {
  return json({ deleted: n }, 200, OPEN_CORS);
}

export function extraTableParam(c: Context<AppEnv>): ExtraDataTable | null {
  const table = c.req.param("table") ?? "";
  return isExtraDataTable(table) ? table : null;
}
