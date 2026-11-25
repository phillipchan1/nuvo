/**
 * Notion → inbox (D-257).
 *
 * One-way. A page in a database the person switched on, **assigned to them and
 * still open**, arrives once as an inbox task labelled "From Notion" with a link
 * back. After that it's their task: nothing upstream rewrites it, ticking it in
 * Nuvo doesn't touch Notion, and deleting it here doesn't bring it back
 * (`task_source_items` remembers every page ever imported).
 *
 * Auth is Notion's public OAuth (`owner=user`), because "me" has to be a Notion
 * *user* — the token response names them (`owner.user.id`). Notion's own consent
 * screen is where the person picks which pages the integration can see; here
 * they only switch databases on.
 *
 * Tokens are sealed like every other provider token (AAD `task_sources:row:user`).
 */
import type { Context, Hono } from "hono";
import { json, OPEN_CORS } from "../cors.ts";
import { bearerToken, cronAuthorized } from "../cron.ts";
import { gateCronBearerRoute } from "../cutoverFlip.ts";
import { jsonParam, type Sql } from "../db.ts";
import type { Env } from "../env.ts";
import { BadRequestError, readJson } from "../http.ts";
import { outboundFetch } from "../lib/outboundFetch.ts";
import { signState, verifyState } from "../lib/oauthState.ts";
import { logServerError } from "../lib/redact.ts";
import { WRITE_FROZEN_MESSAGE, writeFrozen } from "../maintenance.ts";
import { openToken, parseTokenKeyring, sealToken, TokenCryptoError, type TokenAad } from "../secrets.ts";
import { requestIo, requireStore, type AppEnv } from "../session.ts";
import { insertTask, makeStore } from "../store.ts";
import { workerOrigin } from "../google/sync.ts";
import {
  feedFilter,
  importNotes,
  mergeFeeds,
  pageTitle,
  plain,
  readFeeds,
  type Feed,
  type NotionPropSchema,
} from "./feeds.ts";

const API = "https://api.notion.com/v1";
const VERSION = "2025-09-03";
export const NOTION_POLL_CRON = "*/10 * * * *";

/** Per source per run. The rest arrive on the next tick — a first connect to a
 *  busy workspace shouldn't land three hundred rows in one go. */
const MAX_NEW_PER_RUN = 50;
const MAX_PAGES_PER_FEED = 3;

interface SourceRow {
  id: string;
  user_id: string;
  account_name: string | null;
  me_id: string | null;
  token_enc: unknown;
  token_iv: unknown;
  key_version: number | null;
  feeds: unknown;
}

function aad(rowId: string, userId: string): TokenAad {
  return { table: "task_sources", rowId, userId };
}

function asBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string" && value.startsWith("\\x")) {
    const hex = value.slice(2);
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  return null;
}

export function notionRedirectUri(env: Env, reqUrl?: string): string {
  return `${workerOrigin(env, reqUrl)}/functions/v1/notion-oauth`;
}

// ── Notion HTTP ────────────────────────────────────────────────────────────

class NotionAuthError extends Error {
  override name = "NotionAuthError";
}

async function notion<T>(token: string, path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await outboundFetch(`${API}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": VERSION,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 || res.status === 403) throw new NotionAuthError(`notion ${res.status}`);
    if (res.status === 429) {
      const wait = Math.min(Number(res.headers.get("retry-after") ?? "1") || 1, 5);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`notion ${res.status} on ${path.split("?")[0]}`);
    return (await res.json()) as T;
  }
  throw new Error("notion rate limited");
}

interface DataSourceObj {
  id: string;
  title?: unknown;
  properties?: Record<string, NotionPropSchema>;
  parent?: { type?: string; database_id?: string };
}

function dbUrl(ds: DataSourceObj): string | null {
  const dbId = ds.parent?.database_id;
  return dbId ? `https://www.notion.so/${dbId.replaceAll("-", "")}` : null;
}

/** Every data source the integration was given, with its schema. */
async function listDataSources(token: string): Promise<
  Array<{ id: string; title: string; url: string | null; props: NotionPropSchema[] }>
> {
  const out: Array<{ id: string; title: string; url: string | null; props: NotionPropSchema[] }> = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const res = await notion<{ results?: DataSourceObj[]; has_more?: boolean; next_cursor?: string | null }>(
      token,
      "/search",
      {
        filter: { property: "object", value: "data_source" },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      },
    );
    for (const ds of res.results ?? []) {
      let props = ds.properties;
      if (!props) {
        const full = await notion<DataSourceObj>(token, `/data_sources/${ds.id}`);
        props = full.properties;
      }
      out.push({
        id: ds.id,
        title: plain(ds.title) || "Untitled database",
        url: dbUrl(ds),
        props: Object.entries(props ?? {}).map(([name, p]) => ({ ...p, name: p.name ?? name })),
      });
    }
    if (!res.has_more || !res.next_cursor) break;
    cursor = res.next_cursor;
  }
  return out;
}

interface PageObj {
  id: string;
  url?: string;
  in_trash?: boolean;
  archived?: boolean;
  properties?: Record<string, { type?: string; title?: unknown }>;
}

async function queryFeed(token: string, feed: Feed, me: string): Promise<PageObj[]> {
  const filter = feedFilter(feed, me);
  if (!filter) return [];
  const out: PageObj[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES_PER_FEED; page++) {
    const res = await notion<{ results?: PageObj[]; has_more?: boolean; next_cursor?: string | null }>(
      token,
      `/data_sources/${feed.id}/query`,
      { filter, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) },
    );
    for (const p of res.results ?? []) if (!p.in_trash && !p.archived) out.push(p);
    if (!res.has_more || !res.next_cursor) break;
    cursor = res.next_cursor;
  }
  return out;
}

// ── Storage ────────────────────────────────────────────────────────────────

async function openSourceToken(env: Env, src: SourceRow): Promise<string | null> {
  const enc = asBytes(src.token_enc);
  const iv = asBytes(src.token_iv);
  if (!enc || !iv) return null;
  try {
    return await openToken(
      { ciphertext: enc, iv, keyVersion: src.key_version ?? 1 },
      aad(src.id, src.user_id),
      await parseTokenKeyring(env),
    );
  } catch {
    return null;
  }
}

async function markReconnect(sql: Sql, src: SourceRow): Promise<void> {
  await sql`
    UPDATE task_sources SET needs_reconnect = true, updated_at = now()
    WHERE id = ${src.id} AND user_id = ${src.user_id}
  `;
}

async function ownedSources(sql: Sql, userId: string): Promise<SourceRow[]> {
  return (await sql`
    SELECT id, user_id, account_name, me_id, token_enc, token_iv, key_version, feeds
    FROM task_sources
    WHERE user_id = ${userId} AND kind = 'notion'
  `) as SourceRow[];
}

/** Refresh the database list from Notion, keeping the person's switches. */
async function refreshFeeds(sql: Sql, env: Env, src: SourceRow): Promise<Feed[] | null> {
  const token = await openSourceToken(env, src);
  if (!token) {
    await markReconnect(sql, src);
    return null;
  }
  let fresh;
  try {
    fresh = await listDataSources(token);
  } catch (e) {
    if (e instanceof NotionAuthError) {
      await markReconnect(sql, src);
      return null;
    }
    throw e;
  }
  const feeds = mergeFeeds(fresh, readFeeds(src.feeds));
  await sql`
    UPDATE task_sources SET feeds = ${jsonParam(sql, feeds)}, needs_reconnect = false, updated_at = now()
    WHERE id = ${src.id} AND user_id = ${src.user_id}
  `;
  return feeds;
}

/**
 * Bring in what's new. A page lands at most once, ever: the ledger row is
 * claimed first (`ON CONFLICT DO NOTHING`), the task is written only if this
 * run won the claim, and the claim is released if the write fails.
 */
export async function syncNotionSource(sql: Sql, env: Env, src: SourceRow): Promise<{ added: number }> {
  const feeds = readFeeds(src.feeds).filter((f) => f.on && f.assignee);
  if (!feeds.length || !src.me_id) return { added: 0 };
  const token = await openSourceToken(env, src);
  if (!token) {
    await markReconnect(sql, src);
    return { added: 0 };
  }
  const store = makeStore(sql, src.user_id);
  let added = 0;
  try {
    for (const feed of feeds) {
      if (added >= MAX_NEW_PER_RUN) break;
      const pages = await queryFeed(token, feed, src.me_id);
      for (const page of pages) {
        if (added >= MAX_NEW_PER_RUN) break;
        const claimed = (await sql`
          INSERT INTO task_source_items (user_id, kind, external_id, source_id)
          VALUES (${src.user_id}, 'notion', ${page.id}, ${src.id})
          ON CONFLICT (user_id, kind, external_id) DO NOTHING
          RETURNING external_id
        `) as { external_id: string }[];
        if (!claimed.length) continue;
        try {
          const task = await insertTask(store, {
            title: pageTitle(page).slice(0, 500),
            notes: importNotes(feed.title, page.url ?? null),
            status: "inbox",
          });
          if (!task) throw new Error("task insert refused");
          await sql`
            UPDATE tasks SET source = 'notion', external_id = ${page.id}
            WHERE id = ${String(task.id)} AND user_id = ${src.user_id}
          `;
          await sql`
            UPDATE task_source_items SET task_id = ${String(task.id)}
            WHERE user_id = ${src.user_id} AND kind = 'notion' AND external_id = ${page.id}
          `;
          added += 1;
        } catch (e) {
          await sql`
            DELETE FROM task_source_items
            WHERE user_id = ${src.user_id} AND kind = 'notion' AND external_id = ${page.id}
          `;
          throw e;
        }
      }
    }
  } catch (e) {
    if (e instanceof NotionAuthError) {
      await markReconnect(sql, src);
      return { added };
    }
    throw e;
  }
  await sql`
    UPDATE task_sources SET last_synced_at = now(), needs_reconnect = false, updated_at = now()
    WHERE id = ${src.id} AND user_id = ${src.user_id}
  `;
  return { added };
}

async function logSync(sql: Sql, userId: string, status: "ok" | "error", error?: string): Promise<void> {
  await sql`
    INSERT INTO sync_log (user_id, provider, operation, status, error)
    VALUES (${userId}, 'notion', 'sync', ${status}, ${error ?? null})
  `.catch(() => undefined);
}

/** Cron: every connected Notion source. Only sources with a feed switched on cost a request. */
export async function runNotionPoll(sql: Sql, env: Env): Promise<{ ok: true; added: number; sources: number }> {
  const rows = (await sql`
    SELECT id, user_id, account_name, me_id, token_enc, token_iv, key_version, feeds
    FROM task_sources
    WHERE kind = 'notion' AND needs_reconnect = false
  `) as SourceRow[];
  let added = 0;
  for (const src of rows) {
    try {
      added += (await syncNotionSource(sql, env, src)).added;
    } catch (e) {
      await logSync(sql, src.user_id, "error", String((e as Error)?.message ?? e).slice(0, 300));
    }
  }
  return { ok: true, added, sources: rows.length };
}

// ── OAuth ──────────────────────────────────────────────────────────────────

async function startOauth(env: Env, userId: string, redirect: string, reqUrl: string): Promise<Response> {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || !env.NOTION_CLIENT_ID) return json({ error: "notion is not configured" }, 500, OPEN_CORS);
  const state = await signState(secret, { u: userId, r: redirect });
  const consent = new URL(`${API}/oauth/authorize`);
  consent.searchParams.set("client_id", env.NOTION_CLIENT_ID);
  consent.searchParams.set("response_type", "code");
  consent.searchParams.set("owner", "user");
  consent.searchParams.set("redirect_uri", notionRedirectUri(env, reqUrl));
  consent.searchParams.set("state", state);
  return Response.redirect(consent.toString(), 302);
}

/** Only ever send the person back to the app itself. */
function safeReturn(env: Env, r: string | undefined): string {
  const fallback = env.APP_URL || "/";
  if (!r) return fallback;
  try {
    const u = new URL(r);
    const allowed = [env.APP_URL, "https://app.nuvo.day", "tauri://localhost", "http://localhost:5717"]
      .filter(Boolean)
      .map((o) => new URL(String(o)).origin);
    return allowed.includes(u.origin) ? r : fallback;
  } catch {
    return fallback;
  }
}

function withFlag(url: string, flag: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("notion", flag);
    return u.toString();
  } catch {
    return url;
  }
}

async function handleCallback(sql: Sql, env: Env, reqUrl: string): Promise<Response> {
  const url = new URL(reqUrl);
  const stateParam = url.searchParams.get("state");
  if (!stateParam) return json({ error: "missing state" }, 400, OPEN_CORS);
  const state = await verifyState(env.BETTER_AUTH_SECRET ?? "", stateParam);
  const userId = state.u;
  if (!userId) return json({ error: "bad oauth state" }, 400, OPEN_CORS);
  const back = safeReturn(env, state.r);

  // The person pressed Cancel on Notion's screen.
  const code = url.searchParams.get("code");
  if (!code) return Response.redirect(withFlag(back, "cancelled"), 302);

  const basic = btoa(`${env.NOTION_CLIENT_ID ?? ""}:${env.NOTION_CLIENT_SECRET ?? ""}`);
  const tokRes = await outboundFetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json", "Notion-Version": VERSION },
    body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: notionRedirectUri(env, reqUrl) }),
  });
  if (!tokRes.ok) throw new Error(`notion token exchange ${tokRes.status}`);
  const tok = (await tokRes.json()) as {
    access_token?: string;
    workspace_id?: string;
    workspace_name?: string | null;
    owner?: { type?: string; user?: { id?: string } };
  };
  const meId = tok.owner?.type === "user" ? tok.owner.user?.id : undefined;
  if (!tok.access_token || !tok.workspace_id || !meId) throw new Error("notion token response incomplete");

  const rows = (await sql`
    INSERT INTO task_sources (user_id, kind, account_id, account_name, me_id, needs_reconnect)
    VALUES (${userId}, 'notion', ${tok.workspace_id}, ${tok.workspace_name ?? null}, ${meId}, false)
    ON CONFLICT (user_id, kind, account_id) DO UPDATE SET
      account_name = EXCLUDED.account_name,
      me_id = EXCLUDED.me_id,
      needs_reconnect = false,
      updated_at = now()
    RETURNING id, user_id, account_name, me_id, token_enc, token_iv, key_version, feeds
  `) as SourceRow[];
  const src = rows[0];
  if (!src) throw new Error("task_sources upsert returned nothing");

  const sealed = await sealToken(tok.access_token, aad(src.id, userId), await parseTokenKeyring(env));
  await sql`
    UPDATE task_sources
    SET token_enc = ${sealed.ciphertext}, token_iv = ${sealed.iv}, key_version = ${sealed.keyVersion}, updated_at = now()
    WHERE id = ${src.id} AND user_id = ${userId}
  `;
  // List the databases now, so Settings opens on them rather than on a spinner.
  await refreshFeeds(sql, env, {
    ...src,
    token_enc: sealed.ciphertext,
    token_iv: sealed.iv,
    key_version: sealed.keyVersion,
  }).catch((e) => logServerError("notion-oauth", e));
  return Response.redirect(withFlag(back, "connected"), 302);
}

// ── HTTP ───────────────────────────────────────────────────────────────────

type Deps = {
  requireUser: (c: Context<AppEnv>, raw?: Request) => Promise<{ userId: string } | { error: Response }>;
  refuseIfFrozen?: (c: Context<AppEnv>) => Response | null;
};

function frozen(c: Context<AppEnv>): Response | null {
  return writeFrozen(c.env.MAINTENANCE_WRITE_FREEZE)
    ? json({ error: "write_frozen", message: WRITE_FROZEN_MESSAGE }, 503, OPEN_CORS)
    : null;
}

async function handleNotion(c: Context<AppEnv>): Promise<Response> {
  if (c.req.method === "OPTIONS") return new Response("ok", { headers: OPEN_CORS });
  if (c.req.method !== "POST") return json({ error: "method not allowed" }, 405, OPEN_CORS);

  let body: Record<string, unknown>;
  try {
    const raw = await readJson<unknown>(c);
    body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch (err) {
    if (err instanceof BadRequestError) return json({ error: "bad request" }, 400, OPEN_CORS);
    throw err;
  }
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "sync" && cronAuthorized(bearerToken(c.req.header("authorization")), c.env.CRON_SECRET)) {
    const skipped = gateCronBearerRoute(c.env, "notion-poll");
    if (skipped) return skipped;
    const blocked = frozen(c);
    if (blocked) return blocked;
    const io = await requestIo(c);
    return json(await runNotionPoll(io.sql, c.env), 200, OPEN_CORS);
  }

  const got = await requireStore(c);
  if ("error" in got) return got.error;
  const blocked = frozen(c);
  if (blocked) return blocked;
  const { store } = got;
  const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";

  try {
    const sources = await ownedSources(store.sql, store.userId);
    const src = sourceId ? sources.find((s) => s.id === sourceId) : sources[0];

    if (action === "refresh") {
      if (!src) return json({ feeds: [] }, 200, OPEN_CORS);
      const feeds = await refreshFeeds(store.sql, c.env, src);
      if (!feeds) return json({ error: "Notion needs to reconnect." }, 409, OPEN_CORS);
      return json({ feeds }, 200, OPEN_CORS);
    }

    if (action === "feed") {
      // The only two things a person sets: on/off, and which people field means "me".
      if (!src) return json({ error: "not found" }, 404, OPEN_CORS);
      const feedId = typeof body.feedId === "string" ? body.feedId : "";
      const feeds = readFeeds(src.feeds);
      const feed = feeds.find((f) => f.id === feedId);
      if (!feed) return json({ error: "not found" }, 404, OPEN_CORS);
      if (typeof body.assignee === "string" && feed.people.some((p) => p.id === body.assignee)) {
        feed.assignee = body.assignee;
      }
      if (typeof body.on === "boolean") feed.on = body.on && Boolean(feed.assignee);
      await store.sql`
        UPDATE task_sources SET feeds = ${jsonParam(store.sql, feeds)}, updated_at = now()
        WHERE id = ${src.id} AND user_id = ${store.userId}
      `;
      // Switching one on brings its work in now, not in ten minutes.
      const r = feed.on ? await syncNotionSource(store.sql, c.env, { ...src, feeds }) : { added: 0 };
      return json({ ok: true, feed, added: r.added }, 200, OPEN_CORS);
    }

    if (action === "sync") {
      let added = 0;
      for (const s of src ? [src] : []) added += (await syncNotionSource(store.sql, c.env, s)).added;
      return json({ ok: true, added }, 200, OPEN_CORS);
    }

    if (action === "disconnect") {
      if (!src) return json({ ok: true }, 200, OPEN_CORS);
      // The imported tasks stay — they're the person's. The ledger stays too,
      // so reconnecting doesn't land everything a second time.
      await store.sql`DELETE FROM task_sources WHERE id = ${src.id} AND user_id = ${store.userId}`;
      return json({ ok: true }, 200, OPEN_CORS);
    }

    return json({ error: `Unknown action: ${action}` }, 400, OPEN_CORS);
  } catch (err) {
    if (err instanceof TokenCryptoError) return json({ error: "service unavailable" }, 503, OPEN_CORS);
    if (err instanceof NotionAuthError) return json({ error: "Notion needs to reconnect." }, 409, OPEN_CORS);
    throw err;
  }
}

export function registerNotionRoutes(app: Hono<AppEnv>, deps: Deps): void {
  for (const base of ["/functions/v1", "/api"]) {
    app.all(`${base}/notion`, (c) => handleNotion(c));
    app.all(`${base}/notion-oauth`, async (c) => {
      if (c.req.method === "OPTIONS") return new Response("ok", { headers: OPEN_CORS });
      const blocked = deps.refuseIfFrozen?.(c);
      if (blocked) return blocked;
      const url = new URL(c.req.url);
      if (url.searchParams.get("action") === "start") {
        const token = url.searchParams.get("token");
        const headers = new Headers(c.req.raw.headers);
        if (token && !headers.get("authorization")) headers.set("authorization", `Bearer ${token}`);
        const got = await deps.requireUser(c, new Request(c.req.raw, { headers }));
        if ("error" in got) return got.error;
        return startOauth(c.env, got.userId, url.searchParams.get("redirect") ?? "", c.req.url);
      }
      const io = await requestIo(c);
      try {
        return await handleCallback(io.sql, c.env, c.req.url);
      } catch (e) {
        logServerError("notion-oauth", e);
        return json({ error: "oauth_failed" }, 500, OPEN_CORS);
      }
    });
  }
}
