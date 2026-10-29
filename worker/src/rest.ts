/**
 * PostgREST — the slice of it Nuvo speaks — over Neon, scoped by the session.
 *
 * The SPA keeps its stock supabase-js query builder. With `VITE_API_BASE_URL`
 * set, `src/lib/supabase.ts` sends the builder's `/rest/v1/*` traffic here
 * instead of to PostgREST, so every `.from()` / `.rpc()` call site, filter,
 * upsert and `.single()` is the same code that runs on Supabase today. One
 * seam, no second client to drift.
 *
 * Neon has no RLS, and the cutover restore carries no functions or triggers
 * (`SKIP_TOC_HEAD` in cutover-migrate.yml). What RLS, `auth.uid()` and the
 * triggers did for these tables, this file does:
 *
 *  • every statement is ANDed with the owner clause — `user_id = <session>`,
 *    or the owning task for `task_labels` — never a client-supplied owner;
 *  • every identifier is checked against the live catalog before it reaches
 *    SQL, and every value is a bound parameter cast to the column's own type;
 *  • a foreign key may only point at a row the same owner holds (stricter than
 *    Supabase, where FK checks bypass RLS), and steps stay one level deep;
 *  • `updated_at` is bumped and `field_ts` stamped the way `set_updated_at` /
 *    `stamp_unstamped_field_ts` did, so per-field last-write-wins still holds
 *    for writes that do not come through the outbox;
 *  • `inbound_token` only changes through `rotate_inbound_token`.
 *
 * JSON is built by Postgres (`json_agg`), as PostgREST builds it — a `date`
 * stays `"2026-10-29"` and a timestamp keeps its offset, instead of passing
 * through JS `Date`s.
 */
import type { Context } from "hono";
import type { Sql } from "./db.ts";
import { isDatabaseUnavailable } from "./http.ts";
import { WRITE_FROZEN_MESSAGE, writeFrozen } from "./maintenance.ts";
import { SessionLookupError } from "./auth.ts";
import { API_SECURITY } from "./cors.ts";
import { requireStore, type AppEnv } from "./session.ts";
import { rotateInboundToken, type Store } from "./store.ts";

export const REST_PREFIX = "/api/rest/v1";

export const REST_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, prefer, accept, accept-profile, content-profile, range, x-supabase-api-version",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "content-range, content-location",
  // Every builder call carries Authorization, so every new URL is preflighted.
  // Let the browser keep the answer (Chromium caps this at two hours).
  "Access-Control-Max-Age": "86400",
  ...API_SECURITY,
};

// ---------------------------------------------------------------------------
// What a client may touch
// ---------------------------------------------------------------------------

type Op = "select" | "insert" | "update" | "delete";

interface Policy {
  /** How a row belongs to the session. */
  owner: "user_id" | "task";
  ops: readonly Op[];
  /** Readable columns. Omitted = every column. Token-bearing tables list theirs. */
  read?: readonly string[];
  /** Writable on insert. Omitted = every readable column. */
  insert?: readonly string[];
  /** Writable on update. Omitted = the insert set. */
  update?: readonly string[];
  /** Written only by a server path (a trigger guarded it on Supabase). */
  guarded?: readonly string[];
}

const ALL: readonly Op[] = ["select", "insert", "update", "delete"];

const PLANNER: Policy = { owner: "user_id", ops: ALL };

export const REST_TABLES: Readonly<Record<string, Policy>> = {
  tasks: PLANNER,
  domains: PLANNER,
  projects: PLANNER,
  initiatives: PLANNER,
  key_results: PLANNER,
  slots: PLANNER,
  labels: PLANNER,
  recurrences: PLANNER,
  record_comments: PLANNER,
  week_reviews: PLANNER,
  sprints: PLANNER,
  reminders: PLANNER,
  event_domain_routing: PLANNER,
  user_settings: { owner: "user_id", ops: ["select", "insert", "update"], guarded: ["inbound_token"] },
  task_labels: { owner: "task", ops: ALL },
  // Synced from providers. The client re-times an instance in place; the rest
  // of the row is the sync's to write.
  external_events: {
    owner: "user_id",
    ops: ["select", "update"],
    update: ["title", "start_at", "end_at", "all_day", "location", "busy", "updated_at"],
  },
  calendar_accounts: {
    owner: "user_id",
    ops: ["select", "delete"],
    read: [
      "id", "user_id", "provider", "email", "sync_direction", "calendars",
      "mirror_calendar_id", "needs_reconnect", "created_at", "updated_at",
    ],
  },
  connections: {
    owner: "user_id",
    ops: ["select", "insert", "update"],
    read: ["id", "user_id", "app", "name", "scopes", "last_four", "created_at", "updated_at", "last_used_at", "revoked_at"],
    insert: ["id", "app", "name", "scopes", "token_hash", "last_four", "created_at"],
    update: ["name", "revoked_at"],
  },
  activity_sources: {
    owner: "user_id",
    ops: ["select"],
    read: ["id", "user_id", "kind", "login", "avatar_url", "repos", "needs_reconnect", "last_synced_at", "created_at", "updated_at"],
  },
  activity_bindings: { owner: "user_id", ops: ALL },
  activity_units: { owner: "user_id", ops: ["select"] },
  push_subscriptions: { owner: "user_id", ops: ALL },
};

/** Embeds the app asks for, and how each child row is reached from its parent. */
const EMBEDS: Readonly<Record<string, Readonly<Record<string, { child: string; fk: string }>>>> = {
  tasks: { task_labels: { child: "task_labels", fk: "task_id" } },
  initiatives: { key_results: { child: "key_results", fk: "initiative_id" } },
};

/** `apply_patch`'s own allowlist (migration 57). */
const PATCHABLE = new Set([
  "tasks", "projects", "initiatives", "domains", "key_results", "slots", "labels",
  "user_settings", "record_comments", "week_reviews", "sprints", "task_labels",
  "recurrences", "reminders",
]);

/** Never stamped, never patched (`stamp_unstamped_field_ts` / `apply_patch`). */
const UNSTAMPED = new Set(["field_ts", "id", "user_id", "created_at", "updated_at"]);

// ---------------------------------------------------------------------------
// Catalog — identifiers are only ever names Postgres just told us exist
// ---------------------------------------------------------------------------

interface TableInfo {
  columns: Map<string, string>; // name → format_type
  pk: string[];
  uniques: string[][];
  fks: Map<string, { table: string; column: string }>;
}

type Catalog = Map<string, TableInfo>;

const CATALOG_TTL_MS = 5 * 60 * 1000;
let catalogCache: { at: number; value: Promise<Catalog> } | null = null;

export function resetRestCatalogForTests(): void {
  catalogCache = null;
}

async function catalog(sql: Sql): Promise<Catalog> {
  const now = Date.now();
  if (catalogCache && now - catalogCache.at < CATALOG_TTL_MS) return catalogCache.value;
  const value = loadCatalog(sql);
  catalogCache = { at: now, value };
  value.catch(() => {
    if (catalogCache?.value === value) catalogCache = null;
  });
  return value;
}

/** Not exposed as tables, but the RPCs read their shape. */
const RPC_TABLES = ["contacts_directory", "reminder_deliveries"];

async function loadCatalog(sql: Sql): Promise<Catalog> {
  const names = literalArray([...Object.keys(REST_TABLES), ...RPC_TABLES]);
  const cols = await sql.unsafe<{ tbl: string; col: string; typ: string }[]>(
    `SELECT c.relname AS tbl, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS typ
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND c.relname = ANY (CAST($1::text AS text[]))
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY c.relname, a.attnum`,
    [names],
  );
  const keys = await sql.unsafe<{ tbl: string; is_pk: boolean; cols: string }[]>(
    `SELECT c.relname AS tbl, i.indisprimary AS is_pk,
            string_agg(a.attname, ',' ORDER BY k.ord) AS cols
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL unnest(CAST(i.indkey AS int2[])) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
      WHERE n.nspname = 'public' AND c.relname = ANY (CAST($1::text AS text[]))
        AND i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL
      GROUP BY c.relname, i.indexrelid, i.indisprimary`,
    [names],
  );
  const fks = await sql.unsafe<{ tbl: string; col: string; ref_tbl: string; ref_col: string }[]>(
    `SELECT c.relname AS tbl, a.attname AS col, rc.relname AS ref_tbl, ra.attname AS ref_col
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_class rc ON rc.oid = con.confrelid
       JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
       JOIN pg_attribute ra ON ra.attrelid = con.confrelid AND ra.attnum = con.confkey[1]
      WHERE con.contype = 'f' AND n.nspname = 'public'
        AND c.relname = ANY (CAST($1::text AS text[]))
        AND array_length(con.conkey, 1) = 1`,
    [names],
  );
  const out: Catalog = new Map();
  for (const row of cols) {
    // Only plain names are ever spliced into SQL text.
    if (!IDENT.test(row.col)) continue;
    let info = out.get(row.tbl);
    if (!info) {
      info = { columns: new Map(), pk: [], uniques: [], fks: new Map() };
      out.set(row.tbl, info);
    }
    info.columns.set(row.col, row.typ);
  }
  for (const row of keys) {
    const info = out.get(row.tbl);
    if (!info) continue;
    const list = row.cols.split(",");
    if (row.is_pk) info.pk = list;
    info.uniques.push(list);
  }
  for (const row of fks) {
    out.get(row.tbl)?.fks.set(row.col, { table: row.ref_tbl, column: row.ref_col });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Errors — PostgREST's shape, so the client's classifyError reads them as today
// ---------------------------------------------------------------------------

export class RestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: string | null;
  constructor(status: number, code: string, message: string, details: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function bad(message: string, details: string | null = null): RestError {
  return new RestError(400, "PGRST100", message, details);
}

function denied(message: string): RestError {
  return new RestError(403, "42501", message);
}

function restResponse(status: number, body: string | null, extra: Record<string, string> = {}): Response {
  const headers: Record<string, string> = { ...REST_CORS, ...extra };
  if (body != null) headers["Content-Type"] = "application/json; charset=utf-8";
  return new Response(body, { status, headers });
}

function errorResponse(err: RestError): Response {
  return restResponse(
    err.status,
    JSON.stringify({ code: err.code, message: err.message, details: err.details, hint: null }),
  );
}

const PG_STATUS: Record<string, number> = {
  "23505": 409,
  "23503": 409,
  "23502": 400,
  "23514": 400,
  "22P02": 400,
  "22007": 400,
  "22008": 400,
  "22023": 400,
  "42703": 400,
  "42P10": 400,
  "42501": 403,
  "40001": 503,
  "40P01": 503,
  "53300": 503,
};

/** A Postgres failure, said the way PostgREST says it. Never echoes row data. */
function fromPostgres(err: unknown): RestError {
  if (err instanceof RestError) return err;
  if (isDatabaseUnavailable(err)) return new RestError(503, "PGRST000", "database unavailable");
  const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
  if (/^[0-9A-Z]{5}$/.test(code)) {
    const message = err instanceof Error ? err.message : "request failed";
    return new RestError(PG_STATUS[code] ?? 400, code, message);
  }
  return new RestError(500, "PGRST000", "request failed");
}

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

type CmpOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "in" | "is";

type Cond =
  | { kind: "cmp"; col: string; op: CmpOp; value: string | string[]; negate: boolean }
  | { kind: "logic"; op: "and" | "or"; items: Cond[]; negate: boolean };

interface Order {
  col: string;
  desc: boolean;
  nulls: "first" | "last" | null;
}

interface SelectSpec {
  columns: string[] | "*";
  embeds: { name: string; columns: string[] | "*" }[];
}

const CMP_OPS = new Set<CmpOp>(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is"]);
const RESERVED_PARAMS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  const trimmed = name.trim();
  if (!IDENT.test(trimmed)) throw bad(`"${trimmed.slice(0, 40)}" is not a column name`);
  return trimmed;
}

/** Split on commas outside parentheses and double quotes. */
function splitTop(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      current += ch;
      if (ch === "\\" && i + 1 < input.length) current += input[++i];
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (depth !== 0 || quoted) throw bad("unbalanced parentheses or quotes");
  out.push(current);
  return out;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return value;
}

export function parseSelect(raw: string | null): SelectSpec {
  const text = (raw ?? "*").trim() || "*";
  const spec: SelectSpec = { columns: [], embeds: [] };
  let star = false;
  for (const part of splitTop(text)) {
    const item = part.trim();
    if (!item) continue;
    if (item === "*") {
      star = true;
      continue;
    }
    const embed = /^([a-z_][a-z0-9_]*)\((.*)\)$/s.exec(item);
    if (embed) {
      const inner = embed[2].trim();
      const columns = !inner || inner === "*" ? "*" : splitTop(inner).map(ident);
      spec.embeds.push({ name: embed[1], columns });
      continue;
    }
    (spec.columns as string[]).push(ident(item));
  }
  if (star) spec.columns = "*";
  return spec;
}

function parseCmp(col: string, expr: string): Cond {
  let rest = expr;
  let negate = false;
  if (rest.startsWith("not.")) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf(".");
  if (dot < 0) throw bad(`"${col}" has no operator`);
  const op = rest.slice(0, dot) as CmpOp;
  if (!CMP_OPS.has(op)) throw bad(`operator "${op.slice(0, 20)}" is not supported`);
  const value = rest.slice(dot + 1);
  if (op === "in") {
    if (!value.startsWith("(") || !value.endsWith(")")) throw bad("in. expects a list");
    const inner = value.slice(1, -1);
    return { kind: "cmp", col: ident(col), op, value: inner ? splitTop(inner).map((v) => unquote(v.trim())) : [], negate };
  }
  return { kind: "cmp", col: ident(col), op, value: unquote(value), negate };
}

/** `a.eq.1,or(b.is.null,c.gt.2)` — the inside of `or=(…)` / `and=(…)`. */
function parseLogicItems(inner: string): Cond[] {
  return splitTop(inner).map((part) => {
    const item = part.trim();
    const logic = /^(not\.)?(and|or)\((.*)\)$/s.exec(item);
    if (logic) {
      return { kind: "logic", op: logic[2] as "and" | "or", items: parseLogicItems(logic[3]), negate: Boolean(logic[1]) };
    }
    const dot = item.indexOf(".");
    if (dot < 0) throw bad("malformed logic tree");
    return parseCmp(item.slice(0, dot), item.slice(dot + 1));
  });
}

export function parseFilters(params: URLSearchParams): Cond[] {
  const out: Cond[] = [];
  for (const [key, value] of params) {
    if (RESERVED_PARAMS.has(key)) continue;
    const logic = /^(not\.)?(and|or)$/.exec(key);
    if (logic) {
      if (!value.startsWith("(") || !value.endsWith(")")) throw bad(`${key} expects (…)`);
      out.push({ kind: "logic", op: logic[2] as "and" | "or", items: parseLogicItems(value.slice(1, -1)), negate: Boolean(logic[1]) });
      continue;
    }
    if (key.includes(".")) throw bad("filters on embedded resources are not supported");
    out.push(parseCmp(key, value));
  }
  return out;
}

export function parseOrder(raw: string | null): Order[] {
  if (!raw) return [];
  return splitTop(raw).map((part) => {
    const bits = part.trim().split(".");
    const col = ident(bits[0] ?? "");
    let desc = false;
    let nulls: Order["nulls"] = null;
    for (const bit of bits.slice(1)) {
      if (bit === "asc") desc = false;
      else if (bit === "desc") desc = true;
      else if (bit === "nullsfirst") nulls = "first";
      else if (bit === "nullslast") nulls = "last";
      else throw bad(`order modifier "${bit.slice(0, 20)}" is not supported`);
    }
    return { col, desc, nulls };
  });
}

function parseCount(raw: string | null, label: string): number | null {
  if (raw == null || raw === "") return null;
  if (!/^\d{1,7}$/.test(raw)) throw bad(`${label} must be a non-negative integer`);
  return Number(raw);
}

function preferences(header: string | undefined): Set<string> {
  return new Set((header ?? "").split(",").map((p) => p.trim().toLowerCase()).filter(Boolean));
}

// ---------------------------------------------------------------------------
// SQL building
// ---------------------------------------------------------------------------

/**
 * Every value is bound as text and cast by Postgres. postgres.js otherwise
 * learns each parameter's type and re-serializes by it — a JSON string bound
 * as `jsonb` is encoded twice, and the string "true" bound as `boolean` is
 * `'f'`. PGlite does neither, so only the text bind keeps both drivers honest.
 */
class Params {
  readonly values: (string | null)[] = [];
  add(value: unknown): string {
    this.values.push(
      value == null ? null : typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value),
    );
    return `$${this.values.length}::text`;
  }
  typed(value: unknown, type: string): string {
    return `CAST(${this.add(value)} AS ${type})`;
  }
}

function q(name: string): string {
  return `"${name}"`;
}

/** A Postgres array literal of text. Passed as one string so both drivers bind it alike. */
function literalArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

interface Target {
  table: string;
  policy: Policy;
  info: TableInfo;
  uid: string;
}

function readable(target: Target): string[] {
  const all = [...target.info.columns.keys()];
  const allow = target.policy.read;
  return allow ? all.filter((c) => allow.includes(c)) : all;
}

function requireColumn(target: Target, col: string, readOnly = true): string {
  if (!target.info.columns.has(col)) {
    throw new RestError(400, "42703", `column ${target.table}.${col} does not exist`);
  }
  if (readOnly && target.policy.read && !target.policy.read.includes(col)) {
    throw denied(`permission denied for column ${col}`);
  }
  return col;
}

/** The owner clause. The one place a session becomes a WHERE. */
function scopeClause(target: Target, params: Params, alias = "t"): string {
  if (target.policy.owner === "task") {
    return `EXISTS (SELECT 1 FROM public."tasks" o WHERE o."id" = ${alias}."task_id" AND o."user_id" = ${params.typed(target.uid, "uuid")})`;
  }
  return `${alias}."user_id" = ${params.typed(target.uid, "uuid")}`;
}

function condSql(target: Target, cond: Cond, params: Params): string {
  if (cond.kind === "logic") {
    if (!cond.items.length) return cond.negate ? "FALSE" : "TRUE";
    const joined = cond.items.map((c) => `(${condSql(target, c, params)})`).join(cond.op === "and" ? " AND " : " OR ");
    return cond.negate ? `NOT (${joined})` : joined;
  }
  const col = requireColumn(target, cond.col);
  const type = target.info.columns.get(col)!;
  const ref = `t.${q(col)}`;
  let expr: string;
  switch (cond.op) {
    case "is": {
      const v = String(cond.value).toLowerCase();
      if (v === "null") expr = `${ref} IS NULL`;
      else if (v === "true") expr = `${ref} IS TRUE`;
      else if (v === "false") expr = `${ref} IS FALSE`;
      else if (v === "unknown") expr = `${ref} IS UNKNOWN`;
      else throw bad("is. takes null, true, false or unknown");
      break;
    }
    case "in": {
      if (type.endsWith("[]")) throw bad(`in. is not supported on array column ${col}`);
      const list = cond.value as string[];
      expr = list.length ? `${ref} = ANY (${params.typed(literalArray(list), `${type}[]`)})` : "FALSE";
      break;
    }
    case "like":
    case "ilike":
      expr = `${ref}::text ${cond.op === "like" ? "LIKE" : "ILIKE"} ${params.add(String(cond.value).replace(/\*/g, "%"))}`;
      break;
    default: {
      const sym = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[cond.op];
      expr = `${ref} ${sym} ${params.typed(cond.value, type)}`;
    }
  }
  return cond.negate ? `NOT (${expr})` : expr;
}

function whereSql(target: Target, conds: Cond[], params: Params): string {
  return [scopeClause(target, params), ...conds.map((c) => `(${condSql(target, c, params)})`)].join(" AND ");
}

function columnList(target: Target, spec: SelectSpec, alias = "t"): string[] {
  const cols = spec.columns === "*" ? readable(target) : spec.columns.map((c) => requireColumn(target, c));
  return cols.map((c) => `${alias}.${q(c)}`);
}

async function embedSql(target: Target, spec: SelectSpec, params: Params, cat: Catalog): Promise<string[]> {
  const out: string[] = [];
  for (const embed of spec.embeds) {
    const rel = EMBEDS[target.table]?.[embed.name];
    const childInfo = rel ? cat.get(rel.child) : undefined;
    if (!rel || !childInfo) {
      throw new RestError(400, "PGRST200", `no relationship between ${target.table} and ${embed.name}`);
    }
    const child: Target = { table: rel.child, policy: REST_TABLES[rel.child], info: childInfo, uid: target.uid };
    const cols = embed.columns === "*" ? readable(child) : embed.columns.map((c) => requireColumn(child, c));
    const pairs = cols.map((c) => `'${c}', e.${q(c)}`).join(", ");
    out.push(
      `COALESCE((SELECT json_agg(json_build_object(${pairs})) FROM public.${q(rel.child)} e
        WHERE e.${q(rel.fk)} = t."id" AND ${scopeClause(child, params, "e")}), '[]'::json) AS ${q(embed.name)}`,
    );
  }
  return out;
}

function orderSql(target: Target, orders: Order[]): string {
  if (!orders.length) return "";
  return ` ORDER BY ${orders
    .map((o) => {
      requireColumn(target, o.col);
      const nulls = o.nulls ? ` NULLS ${o.nulls.toUpperCase()}` : "";
      return `t.${q(o.col)} ${o.desc ? "DESC" : "ASC"}${nulls}`;
    })
    .join(", ")}`;
}

/**
 * Wrap a row source as the response body: an array, or the one object asked
 * for. A CTE, because INSERT/UPDATE/DELETE … RETURNING cannot be a subquery.
 */
function bodySql(source: string, singular: boolean): string {
  const body = singular ? "(json_agg(_r) -> 0)::text" : "COALESCE(json_agg(_r), '[]'::json)::text";
  return `WITH _r AS (${source}) SELECT ${body} AS body, count(*)::int AS n FROM _r`;
}

async function run(sql: Sql, text: string, params: Params): Promise<{ body: string | null; n: number }> {
  const rows = await sql.unsafe<{ body: string | null; n: number }[]>(text, params.values as never[]);
  const row = rows[0];
  return { body: row?.body ?? null, n: Number(row?.n ?? 0) };
}

// ---------------------------------------------------------------------------
// Writes — what RLS + the triggers enforced on Supabase
// ---------------------------------------------------------------------------

/** Every foreign key a write names must resolve to a row this owner holds. */
async function assertOwnedRefs(
  sql: Sql,
  target: Target,
  rows: Record<string, unknown>[],
  cat: Catalog,
): Promise<void> {
  for (const [col, ref] of target.info.fks) {
    const values = [...new Set(rows.map((r) => r[col]).filter((v): v is string => typeof v === "string" && v !== ""))];
    if (!values.length) continue;
    if (ref.table === "users") {
      if (values.some((v) => v !== target.uid)) throw denied(`${col} must be your own account`);
      continue;
    }
    const refInfo = cat.get(ref.table);
    const refPolicy = REST_TABLES[ref.table];
    if (!refInfo || !refPolicy || refPolicy.owner !== "user_id") throw denied(`${col} cannot be set here`);
    const params = new Params();
    const flat = target.table === "tasks" && col === "parent_task_id" ? ` AND r."parent_task_id" IS NULL` : "";
    const owned = await sql.unsafe<{ n: number }[]>(
      `SELECT count(DISTINCT r.${q(ref.column)})::int AS n FROM public.${q(ref.table)} r
        WHERE r."user_id" = ${params.typed(target.uid, "uuid")}
          AND r.${q(ref.column)}::text = ANY (${params.typed(literalArray(values), "text[]")})${flat}`,
      params.values as never[],
    );
    if (Number(owned[0]?.n ?? 0) !== values.length) {
      if (flat) {
        throw new RestError(400, "23514", "steps are one level deep — a step cannot hold steps");
      }
      throw denied(`${col} points at a row you do not own`);
    }
  }
  if (target.table === "tasks") {
    for (const r of rows) {
      if (r.parent_task_id != null && r.parent_task_id === r.id) {
        throw new RestError(400, "23514", "a task cannot be its own step");
      }
    }
  }
  if (target.table === "reminders") await assertOwnedReminderTargets(sql, target, rows);
}

/** `reminders.target_id` is polymorphic, so no FK speaks for it. */
async function assertOwnedReminderTargets(sql: Sql, target: Target, rows: Record<string, unknown>[]): Promise<void> {
  for (const r of rows) {
    if (r.target_id == null || r.target_id === "") continue;
    const kind = r.target_kind ?? "task";
    const table = kind === "task" ? "tasks" : kind === "slot" ? "slots" : null;
    if (!table || typeof r.target_id !== "string") throw denied("target_id cannot be set for this target_kind");
    const params = new Params();
    const hit = await sql.unsafe(
      `SELECT 1 FROM public.${q(table)} r WHERE r."id"::text = ${params.add(r.target_id)}
          AND r."user_id" = ${params.typed(target.uid, "uuid")} LIMIT 1`,
      params.values as never[],
    );
    if (!hit.length) throw denied("target_id points at a row you do not own");
  }
}

function writable(target: Target, mode: "insert" | "update"): Set<string> {
  const p = target.policy;
  const base = mode === "update" ? p.update ?? p.insert : p.insert;
  const cols = base ? [...target.info.columns.keys()].filter((c) => base.includes(c)) : readable(target);
  const guarded = new Set(p.guarded ?? []);
  return new Set(cols.filter((c) => !guarded.has(c) && c !== "user_id"));
}

/**
 * The columns a write sets. A body naming another owner is refused, as RLS's
 * `with check` refused it; naming yourself is a no-op. Guarded columns drop
 * silently, as `guard_inbound_token` kept OLD.
 */
function writeColumns(target: Target, rows: Record<string, unknown>[], mode: "insert" | "update"): string[] {
  const allowed = writable(target, mode);
  const guarded = new Set(target.policy.guarded ?? []);
  const cols = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (key === "user_id") {
        if (row[key] != null && row[key] !== target.uid) throw denied("new row violates row-level security policy");
        continue;
      }
      if (guarded.has(key)) continue;
      if (!target.info.columns.has(key)) {
        throw new RestError(400, "PGRST204", `Could not find the '${key.slice(0, 40)}' column of '${target.table}'`);
      }
      if (!allowed.has(key)) throw denied(`permission denied for column ${key}`);
      cols.add(key);
    }
  }
  return [...cols];
}

/**
 * `stamp_unstamped_field_ts`: a field written without its own timestamp is
 * stamped now, so an older offline edit cannot later overwrite it. Inserts
 * stamp what they set non-null; updates stamp what they set.
 */
function stampFieldTs(target: Target, rows: Record<string, unknown>[], cols: string[], mode: "insert" | "update"): string[] {
  if (!target.info.columns.has("field_ts")) return cols;
  const now = new Date().toISOString();
  for (const row of rows) {
    const given = row.field_ts && typeof row.field_ts === "object" && !Array.isArray(row.field_ts)
      ? (row.field_ts as Record<string, unknown>)
      : {};
    const stamped: Record<string, unknown> = { ...given };
    for (const c of cols) {
      if (UNSTAMPED.has(c)) continue;
      if (mode === "insert" && row[c] == null) continue;
      if (stamped[c] == null) stamped[c] = now;
    }
    row.field_ts = stamped;
  }
  return cols.includes("field_ts") ? cols : [...cols, "field_ts"];
}

function returningSql(target: Target, spec: SelectSpec): string {
  if (spec.embeds.length) throw bad("embeds are not supported on writes");
  return columnList(target, spec).join(", ");
}

function conflictTarget(target: Target, raw: string | null): string[] {
  const cols = raw ? splitTop(raw).map((c) => requireColumn(target, ident(c), false)) : target.info.pk;
  if (!cols.length) throw new RestError(400, "42P10", "no unique constraint to resolve on");
  const match = target.info.uniques.some((u) => u.length === cols.length && u.every((c) => cols.includes(c)));
  if (!match) {
    throw new RestError(400, "42P10", "there is no unique or exclusion constraint matching the ON CONFLICT specification");
  }
  return cols;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

interface RestRequest {
  method: string;
  table: string;
  params: URLSearchParams;
  prefer: Set<string>;
  singular: boolean;
  body: unknown;
}

function requireTarget(cat: Catalog, table: string, uid: string, op: Op): Target {
  const policy = REST_TABLES[table];
  const info = cat.get(table);
  if (!policy || !info) {
    throw new RestError(404, "42P01", `relation "public.${table.slice(0, 60)}" does not exist`);
  }
  if (!policy.ops.includes(op)) throw denied(`permission denied for table ${table}`);
  return { table, policy, info, uid };
}

function finish(req: RestRequest, result: { body: string | null; n: number }, okStatus: number): Response {
  const wantsRows = req.method === "GET" || req.method === "HEAD" || req.prefer.has("return=representation");
  if (req.singular && wantsRows && result.n !== 1) {
    return errorResponse(
      new RestError(406, "PGRST116", "JSON object requested, multiple (or no) rows returned", `The result contains ${result.n} rows`),
    );
  }
  const range = result.n ? `0-${result.n - 1}/*` : "*/*";
  if (!wantsRows) return restResponse(okStatus === 200 ? 204 : okStatus, null, { "Content-Range": range });
  return restResponse(okStatus, req.method === "HEAD" ? null : result.body ?? (req.singular ? "null" : "[]"), {
    "Content-Range": range,
  });
}

async function handleSelect(sql: Sql, cat: Catalog, req: RestRequest, uid: string): Promise<Response> {
  const target = requireTarget(cat, req.table, uid, "select");
  const params = new Params();
  const spec = parseSelect(req.params.get("select"));
  const cols = [...columnList(target, spec), ...(await embedSql(target, spec, params, cat))];
  if (!cols.length) throw bad("select names no columns");
  const where = whereSql(target, parseFilters(req.params), params);
  const limit = parseCount(req.params.get("limit"), "limit");
  const offset = parseCount(req.params.get("offset"), "offset");
  const source =
    `SELECT ${cols.join(", ")} FROM public.${q(target.table)} t WHERE ${where}` +
    orderSql(target, parseOrder(req.params.get("order"))) +
    (limit != null ? ` LIMIT ${limit}` : "") +
    (offset != null ? ` OFFSET ${offset}` : "");
  return finish(req, await run(sql, bodySql(source, req.singular), params), 200);
}

async function handleInsert(sql: Sql, cat: Catalog, req: RestRequest, uid: string): Promise<Response> {
  const target = requireTarget(cat, req.table, uid, "insert");
  const list = Array.isArray(req.body) ? req.body : [req.body];
  if (!list.every((r) => r && typeof r === "object" && !Array.isArray(r))) throw bad("body must be an object or an array of objects");
  const rows = (list as Record<string, unknown>[]).map((r) => ({ ...r }));
  if (!rows.length) return finish(req, { body: "[]", n: 0 }, 201);
  const spec = parseSelect(req.params.get("select"));
  const merge = req.prefer.has("resolution=merge-duplicates");
  const ignore = req.prefer.has("resolution=ignore-duplicates");
  if (merge || ignore) requireTarget(cat, req.table, uid, "update");

  let cols = writeColumns(target, rows, "insert");
  await assertOwnedRefs(sql, target, rows, cat);
  cols = stampFieldTs(target, rows, cols, "insert");

  const params = new Params();
  const owned = target.policy.owner === "user_id";
  const insertCols = [...(owned ? ['"user_id"'] : []), ...cols.map(q)];
  const selectCols = [...(owned ? [params.typed(uid, "uuid")] : []), ...cols.map((c) => `r.${q(c)}`)];
  let text =
    `INSERT INTO public.${q(target.table)} AS t (${insertCols.join(", ")})
     SELECT ${selectCols.join(", ")}
       FROM jsonb_populate_recordset(NULL::public.${q(target.table)}, ${params.typed(JSON.stringify(rows), "jsonb")}) r`;
  if (merge || ignore) {
    const conflict = conflictTarget(target, req.params.get("on_conflict"));
    const setCols = cols.filter((c) => !conflict.includes(c));
    if (ignore || !setCols.length) {
      text += ` ON CONFLICT (${conflict.map(q).join(", ")}) DO NOTHING`;
    } else {
      const sets = setCols.map((c) =>
        c === "field_ts"
          ? `"field_ts" = COALESCE(t."field_ts", '{}'::jsonb) || COALESCE(EXCLUDED."field_ts", '{}'::jsonb)`
          : `${q(c)} = EXCLUDED.${q(c)}`,
      );
      if (target.info.columns.has("updated_at") && !setCols.includes("updated_at")) sets.push(`"updated_at" = now()`);
      text += ` ON CONFLICT (${conflict.map(q).join(", ")}) DO UPDATE SET ${sets.join(", ")} WHERE ${scopeClause(target, params)}`;
    }
  }
  text += ` RETURNING ${returningSql(target, spec)}`;
  return finish(req, await run(sql, bodySql(text, req.singular), params), 201);
}

async function handleUpdate(sql: Sql, cat: Catalog, req: RestRequest, uid: string): Promise<Response> {
  const target = requireTarget(cat, req.table, uid, "update");
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw bad("body must be an object");
  const row = { ...(req.body as Record<string, unknown>) };
  const conds = parseFilters(req.params);
  if (!conds.length) throw bad("an update needs a filter");
  const spec = parseSelect(req.params.get("select"));

  let cols = writeColumns(target, [row], "update");
  await assertOwnedRefs(sql, target, [row], cat);
  if (!cols.length) {
    // Nothing writable left (a guarded column only): answer with the rows, unchanged.
    return handleSelect(sql, cat, { ...req, method: "GET" }, uid);
  }
  cols = stampFieldTs(target, [row], cols, "update");
  const params = new Params();
  const sets = cols.map((c) =>
    c === "field_ts" ? `"field_ts" = COALESCE(t."field_ts", '{}'::jsonb) || COALESCE(r."field_ts", '{}'::jsonb)` : `${q(c)} = r.${q(c)}`,
  );
  if (target.info.columns.has("updated_at") && !cols.includes("updated_at")) sets.push(`"updated_at" = now()`);
  const record = params.typed(JSON.stringify(row), "jsonb");
  const text =
    `UPDATE public.${q(target.table)} AS t SET ${sets.join(", ")}
       FROM jsonb_populate_record(NULL::public.${q(target.table)}, ${record}) r
      WHERE ${whereSql(target, conds, params)}
      RETURNING ${returningSql(target, spec)}`;
  return finish(req, await run(sql, bodySql(text, req.singular), params), 200);
}

async function handleDelete(sql: Sql, cat: Catalog, req: RestRequest, uid: string): Promise<Response> {
  const target = requireTarget(cat, req.table, uid, "delete");
  const conds = parseFilters(req.params);
  if (!conds.length) throw bad("a delete needs a filter");
  const spec = parseSelect(req.params.get("select"));
  const params = new Params();
  const text =
    `DELETE FROM public.${q(target.table)} AS t WHERE ${whereSql(target, conds, params)}
      RETURNING ${returningSql(target, spec)}`;
  return finish(req, await run(sql, bodySql(text, req.singular), params), 200);
}

// ---------------------------------------------------------------------------
// RPCs — the four the client calls, re-said without auth.uid()
// ---------------------------------------------------------------------------

function rpcJson(value: unknown): Response {
  return restResponse(200, JSON.stringify(value));
}

/**
 * `apply_patch` (migration 57): per-field last-write-wins against `field_ts`.
 * A field applies when its timestamp — clamped to now, so a fast clock cannot
 * win forever — is newer than the stored one.
 */
async function applyPatchRpc(store: Store, cat: Catalog, args: Record<string, unknown>): Promise<Response> {
  const table = typeof args.p_table === "string" ? args.p_table : "";
  if (!PATCHABLE.has(table)) throw new RestError(403, "42501", `apply_patch: ${table.slice(0, 60)} is not a syncable table`);
  const match = args.p_match;
  if (!match || typeof match !== "object" || Array.isArray(match) || !Object.keys(match).length) {
    throw new RestError(400, "22023", "apply_patch: a match is required");
  }
  const patch = args.p_patch && typeof args.p_patch === "object" && !Array.isArray(args.p_patch)
    ? (args.p_patch as Record<string, unknown>)
    : {};
  const fieldTs = args.p_field_ts && typeof args.p_field_ts === "object" && !Array.isArray(args.p_field_ts)
    ? (args.p_field_ts as Record<string, unknown>)
    : {};
  const target = requireTarget(cat, table, store.userId, "update");
  if (!target.info.columns.has("field_ts")) {
    // A schema without field_ts (the preview's neon.sql) cannot merge per field.
    // Say "no such function" so the outbox degrades to row-level updates.
    throw new RestError(404, "PGRST202", "Could not find the function public.apply_patch without field_ts");
  }
  if (!Object.keys(patch).length) return rpcJson({ applied: [], rejected: [], matched: 0 });

  const allowed = writable(target, "update");
  return store.sql.begin(async (tx) => {
    const sql = tx as unknown as Sql;
    const matchConds: Cond[] = Object.entries(match as Record<string, unknown>).map(([col, value]) => ({
      kind: "cmp",
      col: ident(col),
      op: "eq",
      value: String(value),
      negate: false,
    }));
    const params = new Params();
    const found = await sql.unsafe<{ field_ts: Record<string, string> | null; now: string }[]>(
      `SELECT t."field_ts" AS field_ts, to_json(now()) #>> '{}' AS now
         FROM public.${q(table)} t WHERE ${whereSql(target, matchConds, params)} FOR UPDATE`,
      params.values as never[],
    );
    if (!found.length) return rpcJson({ applied: [], rejected: [], matched: 0 });
    const stored = found[0].field_ts ?? {};
    const now = Date.parse(found[0].now);
    const applied: string[] = [];
    const rejected: string[] = [];
    const nextTs: Record<string, string> = {};
    for (const key of Object.keys(patch)) {
      if (UNSTAMPED.has(key) || !allowed.has(key) || !target.info.columns.has(key)) {
        rejected.push(key);
        continue;
      }
      const given = Date.parse(String(fieldTs[key] ?? ""));
      const mine = Math.min(Number.isFinite(given) ? given : now, now);
      const theirs = Date.parse(String(stored[key] ?? ""));
      if (Number.isFinite(theirs) && mine <= theirs) {
        rejected.push(key);
      } else {
        applied.push(key);
        nextTs[key] = new Date(mine).toISOString();
      }
    }
    if (!applied.length) return rpcJson({ applied, rejected, matched: 1 });

    const values = Object.fromEntries(applied.map((k) => [k, patch[k]]));
    await assertOwnedRefs(sql, target, [{ ...(match as Record<string, unknown>), ...values }], cat);
    const up = new Params();
    const sets = applied.map((c) => `${q(c)} = r.${q(c)}`);
    sets.push(`"field_ts" = COALESCE(t."field_ts", '{}'::jsonb) || ${up.typed(JSON.stringify(nextTs), "jsonb")}`);
    if (target.info.columns.has("updated_at") && !applied.includes("updated_at")) sets.push(`"updated_at" = now()`);
    const record = up.typed(JSON.stringify(values), "jsonb");
    await sql.unsafe(
      `UPDATE public.${q(table)} AS t SET ${sets.join(", ")}
         FROM jsonb_populate_record(NULL::public.${q(table)}, ${record}) r
        WHERE ${whereSql(target, matchConds, up)}`,
      up.values as never[],
    );
    return rpcJson({ applied, rejected, matched: 1 });
  });
}

/** `claim_reminder` (migration 61): true when this device is the first to fire it. */
async function claimReminderRpc(store: Store, cat: Catalog, args: Record<string, unknown>): Promise<Response> {
  const key = typeof args.p_key === "string" ? args.p_key : "";
  const fireAt = typeof args.p_fire_at === "string" ? args.p_fire_at : "";
  if (!key || !fireAt) throw new RestError(400, "22023", "p_key and p_fire_at are required");
  const hasChannel = cat.get("reminder_deliveries")?.columns.has("channel") ?? false;
  const params = new Params();
  const cols = ['"user_id"', '"reminder_key"', '"fire_at"', ...(hasChannel ? ['"channel"'] : [])];
  const vals = [
    params.typed(store.userId, "uuid"),
    params.add(key),
    `date_trunc('second', ${params.typed(fireAt, "timestamptz")})`,
    ...(hasChannel ? [params.add(typeof args.p_channel === "string" ? args.p_channel : null)] : []),
  ];
  const rows = await store.sql.unsafe(
    `INSERT INTO public."reminder_deliveries" (${cols.join(", ")}) VALUES (${vals.join(", ")})
     ON CONFLICT DO NOTHING RETURNING 1`,
    params.values as never[],
  );
  return rpcJson(rows.length > 0);
}

/**
 * `contacts` → `contacts_for` (migration 50): the address book plus people met
 * on synced events. Same rows and ranking, without pg_trgm's fuzzy match — the
 * cutover restore does not carry extensions.
 */
async function contactsRpc(store: Store, cat: Catalog, args: Record<string, unknown>): Promise<Response> {
  const search = (typeof args.search === "string" ? args.search : "").trim().toLowerCase();
  const dir = cat.get("contacts_directory")?.columns;
  const events = cat.get("external_events")?.columns;
  const params = new Params();
  const uid = params.typed(store.userId, "uuid");
  const sources: string[] = [];
  if (dir) {
    const name = dir.has("display_name") && dir.has("name")
      ? `COALESCE(cd."display_name", cd."name")`
      : dir.has("display_name") ? `cd."display_name"` : dir.has("name") ? `cd."name"` : "NULL";
    const source = dir.has("source") ? `COALESCE(cd."source", 'google')` : `'google'`;
    sources.push(
      `SELECT lower(cd."email") AS email, ${name} AS display_name, ${source} AS source, 0::bigint AS freq
         FROM public."contacts_directory" cd WHERE cd."user_id" = ${uid}`,
    );
  }
  if (events?.has("raw")) {
    sources.push(
      `SELECT email, mode() WITHIN GROUP (ORDER BY display_name) AS display_name, 'meeting' AS source, count(*) AS freq
         FROM (SELECT lower(elem->>'email') AS email, nullif(elem->>'displayName', '') AS display_name
                 FROM public."external_events" ev
                 CROSS JOIN LATERAL jsonb_array_elements(ev."raw"->'attendees') AS a(elem)
                WHERE ev."user_id" = ${uid} AND (ev."raw"->'attendees') IS NOT NULL
                  AND (elem->>'self') IS DISTINCT FROM 'true' AND (elem->>'email') IS NOT NULL) m
        GROUP BY email`,
    );
  }
  if (!sources.length) return rpcJson([]);
  const like = params.add(`%${search}%`);
  const exact = params.add(search);
  const text =
    `SELECT COALESCE(json_agg(_r), '[]'::json)::text AS body, count(*)::int AS n FROM (
       SELECT a.email,
              COALESCE(mode() WITHIN GROUP (ORDER BY nullif(lower(a.display_name), a.email)), a.email) AS display_name,
              max(a.freq) AS freq,
              array_agg(DISTINCT a.source ORDER BY a.source) AS sources
         FROM (${sources.join(" UNION ALL ")}) a
        GROUP BY a.email
       HAVING ${exact} = '' OR a.email LIKE ${like}
           OR lower(COALESCE(mode() WITHIN GROUP (ORDER BY nullif(lower(a.display_name), a.email)), a.email)) LIKE ${like}
        ORDER BY (a.email = ${exact}) DESC, max(a.freq) DESC, 2
        LIMIT 20) _r`;
  const { body } = await run(store.sql, text, params);
  return restResponse(200, body ?? "[]");
}

async function handleRpc(store: Store, cat: Catalog, fn: string, args: Record<string, unknown>): Promise<Response> {
  switch (fn) {
    case "apply_patch":
      return applyPatchRpc(store, cat, args);
    case "claim_reminder":
      return claimReminderRpc(store, cat, args);
    case "contacts":
      return contactsRpc(store, cat, args);
    case "rotate_inbound_token":
      return rpcJson(await rotateInboundToken(store));
    default:
      throw new RestError(404, "PGRST202", `Could not find the function public.${fn.slice(0, 60)}`);
  }
}

/** Read-only RPCs stay open during a write freeze, as on the Supabase path. */
const READ_RPCS = new Set(["contacts"]);

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function readBody(c: Context<AppEnv>): Promise<unknown> {
  const text = await c.req.text();
  if (!text) return null;
  if (text.includes("\0")) throw bad("malformed body");
  try {
    return JSON.parse(text);
  } catch {
    throw bad("malformed body");
  }
}

export async function handleRest(c: Context<AppEnv>): Promise<Response> {
  try {
    const url = new URL(c.req.url);
    const path = url.pathname.slice(REST_PREFIX.length).replace(/^\/+/, "");
    const method = c.req.method.toUpperCase();
    const profile = c.req.header("Accept-Profile") ?? c.req.header("Content-Profile");
    if (profile && profile !== "public") throw new RestError(406, "PGRST106", "only the public schema is exposed");

    const rpc = /^rpc\/([a-z_][a-z0-9_]*)$/.exec(path);
    const table = /^([a-z_][a-z0-9_]*)$/.exec(path);
    if (!rpc && !table) throw new RestError(404, "PGRST125", "invalid path");

    const writes = rpc ? !READ_RPCS.has(rpc[1]) : method !== "GET" && method !== "HEAD";
    const got = await requireStore(c);
    if ("error" in got) {
      const status = got.error.status;
      return errorResponse(
        status === 401
          ? new RestError(401, "PGRST301", "not signed in")
          : new RestError(status >= 500 ? 503 : status, "PGRST000", "service unavailable"),
      );
    }
    if (writes && writeFrozen(c.env.MAINTENANCE_WRITE_FREEZE)) {
      return errorResponse(new RestError(503, "PGRST000", WRITE_FROZEN_MESSAGE));
    }
    const cat = await catalog(got.store.sql);

    if (rpc) {
      if (method !== "POST" && method !== "GET") throw new RestError(405, "PGRST117", "rpc takes GET or POST");
      const body = method === "POST" ? await readBody(c) : Object.fromEntries(url.searchParams);
      const args = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
      return await handleRpc(got.store, cat, rpc[1], args);
    }

    const accept = (c.req.header("Accept") ?? "").toLowerCase();
    const req: RestRequest = {
      method,
      table: table![1],
      params: url.searchParams,
      prefer: preferences(c.req.header("Prefer")),
      singular: accept.includes("application/vnd.pgrst.object+json"),
      body: method === "POST" || method === "PATCH" ? await readBody(c) : null,
    };
    const uid = got.store.userId;
    switch (method) {
      case "GET":
      case "HEAD":
        return await handleSelect(got.store.sql, cat, req, uid);
      case "POST":
        return await handleInsert(got.store.sql, cat, req, uid);
      case "PATCH":
        return await handleUpdate(got.store.sql, cat, req, uid);
      case "DELETE":
        return await handleDelete(got.store.sql, cat, req, uid);
      default:
        throw new RestError(405, "PGRST117", `${method} is not supported`);
    }
  } catch (err) {
    if (err instanceof SessionLookupError) return errorResponse(new RestError(503, "PGRST000", "service unavailable"));
    const rest = fromPostgres(err);
    if (rest.status >= 500 && !(err instanceof RestError)) console.error("[rest]", err);
    return errorResponse(rest);
  }
}
