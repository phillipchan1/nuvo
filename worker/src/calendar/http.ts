import type { Context } from "hono";
import type { Hono } from "hono";
import { bearerToken, cronAuthorized } from "../cron.ts";
import { json, OPEN_CORS } from "../cors.ts";
import { gateCronBearerRoute } from "../cutoverFlip.ts";
import type { Env } from "../env.ts";
import { BadRequestError, readJson, requireJsonObject, requireUuid } from "../http.ts";
import { GRAPH, MS_AUTH_URL, MS_SCOPES, MS_TOKEN_URL } from "../lib/ms.ts";
import { signState, verifyState } from "../lib/oauthState.ts";
import { discoverCalendars } from "../lib/caldav.ts";
import { withoutMirrorCalendar } from "../lib/mirror.ts";
import { logServerError } from "../lib/redact.ts";
import type { RequestIo } from "../requestIo.ts";
import { bootstrapUser, makeStore, type Store } from "../store.ts";
import { handleIcloudEvents } from "./icloudEvents.ts";
import { runIcloudContacts, runIcloudSync, syncIcloudAccount } from "./icloud.ts";
import { assertPublicFeedUrl, fetchIcsFeed, runIcsSync, syncIcsAccount } from "./icsFeed.ts";
import { runM365Sync, syncM365Account } from "./m365.ts";
import {
  getOwnedAccount,
  listOwnedAccounts,
  loggedError,
  logSync,
  sealAccountSecret,
  upsertAccount,
} from "./store.ts";

type AppEnv = { Bindings: Env; Variables: { io?: RequestIo } };

export type CalendarRouteDeps = {
  requireUser: (c: Context<AppEnv>, raw?: Request) => Promise<{ userId: string } | { error: Response }>;
  requestIo: (c: Context<AppEnv>) => Promise<RequestIo>;
  refuseIfFrozen?: (c: Context<AppEnv>) => Response | null;
};

const BEARER_SYNC = ["m365-sync", "icloud-sync", "icloud-contacts", "ics-sync"] as const;
export type CalendarBearerRoute = (typeof BEARER_SYNC)[number];

function preflight(): Response {
  return new Response("ok", { headers: OPEN_CORS });
}

function clientError(code: string, status = 500): Response {
  return json({ error: code }, status, OPEN_CORS);
}

function isReadMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD";
}

function syncSelfUrl(c: Context<AppEnv>, name: string): string {
  const url = new URL(c.req.url);
  return `${url.origin}/functions/v1/${name}`;
}

export function registerCalendarRoutes(app: Hono<AppEnv>, deps: CalendarRouteDeps): void {
  const paths = (suffix: string) => [`/functions/v1/${suffix}`, `/api/${suffix}`] as const;
  const freezeWrite = (c: Context<AppEnv>, write: boolean) =>
    write ? (deps.refuseIfFrozen?.(c) ?? null) : null;

  for (const path of paths("m365-oauth")) {
    app.options(path, preflight);
    app.all(path, (c) => handleM365Oauth(c, deps));
  }
  for (const path of paths("icloud-connect")) {
    app.options(path, preflight);
    app.all(path, (c) => handleIcloudConnect(c, deps));
  }
  for (const path of paths("ics-subscribe")) {
    app.options(path, preflight);
    app.all(path, (c) => handleIcsSubscribe(c, deps));
  }
  for (const path of paths("icloud-events")) {
    app.options(path, preflight);
    app.all(path, (c) => handleEvents(c, deps));
  }
  for (const name of BEARER_SYNC) {
    for (const path of paths(name)) {
      app.options(path, preflight);
      app.all(path, (c) => handleBearerSync(c, deps, name));
    }
  }
}

async function handleBearerSync(
  c: Context<AppEnv>,
  deps: CalendarRouteDeps,
  name: CalendarBearerRoute,
): Promise<Response> {
  if (isReadMethod(c.req.method)) {
    const got = await deps.requireUser(c);
    if ("error" in got) return got.error;
    return json({ ok: true }, 200, OPEN_CORS);
  }
  const blocked = deps.refuseIfFrozen?.(c) ?? null;
  if (blocked) return blocked;
  const body = await readJson<{ accountId?: string }>(c).catch(() => ({} as { accountId?: string }));
  const cronOk = cronAuthorized(bearerToken(c.req.header("authorization")), c.env.CRON_SECRET);
  if (cronOk) {
    const gated = gateCronBearerRoute(c.env, name);
    if (gated) return gated;
  }
  const io = await deps.requestIo(c);
  try {
    if (cronOk) {
      const accountId = typeof body.accountId === "string" && body.accountId
        ? requireUuid(body.accountId, "accountId")
        : undefined;
      const out = await runNamedSync(io.sql, c.env, name, { accountId });
      return json(out, 200, OPEN_CORS);
    }
    const got = await deps.requireUser(c);
    if ("error" in got) return got.error;
    if (body.accountId) {
      requireUuid(body.accountId, "accountId");
      const owned = await getOwnedAccount(makeStore(io.sql, got.userId), body.accountId);
      if (!owned) return json({ error: "not found" }, 404, OPEN_CORS);
    }
    const out = await runNamedSync(io.sql, c.env, name, {
      accountId: typeof body.accountId === "string" ? body.accountId : undefined,
      userId: got.userId,
    });
    return json(out, 200, OPEN_CORS);
  } catch (e) {
    logServerError(name, e);
    return clientError("request_failed");
  }
}

async function runNamedSync(
  sql: RequestIo["sql"],
  env: Env,
  name: CalendarBearerRoute,
  opts: { accountId?: string; userId?: string },
) {
  if (name === "m365-sync") return runM365Sync(sql, env, opts);
  if (name === "icloud-sync") return runIcloudSync(sql, env, opts);
  if (name === "icloud-contacts") return runIcloudContacts(sql, env, opts);
  return runIcsSync(sql, env, opts);
}

export async function runCalendarRefreshOthers(
  sql: RequestIo["sql"],
  env: Env,
  userId: string,
): Promise<{ synced: number; errors: string[] }> {
  const store = makeStore(sql, userId);
  const accounts = (await listOwnedAccounts(store)).filter(
    (a) => !a.needs_reconnect && (a.provider === "m365" || a.provider === "icloud" || a.provider === "ics"),
  );
  const errors: string[] = [];
  let synced = 0;
  for (const account of accounts) {
    try {
      if (account.provider === "m365") await syncM365Account(sql, account, env);
      else if (account.provider === "icloud") {
        await syncIcloudAccount(sql, account, env);
        await runIcloudContacts(sql, env, { accountId: account.id, userId }).catch(() => undefined);
      } else await syncIcsAccount(sql, account, env);
      synced += 1;
    } catch (e) {
      logServerError("calendar-refresh", e);
      errors.push(`${account.provider}: sync failed`);
    }
  }
  return { synced, errors };
}

async function handleM365Oauth(c: Context<AppEnv>, deps: CalendarRouteDeps): Promise<Response> {
  const url = new URL(c.req.url);
  const isStart = url.searchParams.get("action") === "start";
  const isCallback = Boolean(url.searchParams.get("code"));
  const write = isCallback || (!isStart && !isReadMethod(c.req.method));
  const blocked = write ? deps.refuseIfFrozen?.(c) ?? null : null;
  if (blocked) return blocked;

  if (isStart) {
    const token = url.searchParams.get("token");
    const headers = new Headers(c.req.raw.headers);
    if (token && !headers.get("authorization")) headers.set("authorization", `Bearer ${token}`);
    const raw = new Request(c.req.raw, { headers });
    const got = await deps.requireUser(c, raw);
    if ("error" in got) return got.error;
    if (!c.env.MS_CLIENT_ID) return clientError("oauth_not_configured");
    const state = await signState(c.env.BETTER_AUTH_SECRET ?? "", {
      u: got.userId,
      r: url.searchParams.get("redirect") ?? "",
    });
    const consent = new URL(MS_AUTH_URL);
    consent.searchParams.set("client_id", c.env.MS_CLIENT_ID);
    consent.searchParams.set("redirect_uri", syncSelfUrl(c, "m365-oauth"));
    consent.searchParams.set("response_type", "code");
    consent.searchParams.set("scope", MS_SCOPES);
    consent.searchParams.set("response_mode", "query");
    consent.searchParams.set("state", state);
    return Response.redirect(consent.toString(), 302);
  }

  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  if (!code || !stateParam) return clientError("bad_request", 400);
  let state: Record<string, string>;
  try {
    state = await verifyState(c.env.BETTER_AUTH_SECRET ?? "", stateParam);
  } catch {
    return clientError("bad_request", 400);
  }
  if (!state.u || !c.env.MS_CLIENT_ID || !c.env.MS_CLIENT_SECRET) {
    return clientError("oauth_not_configured");
  }

  const io = await deps.requestIo(c);
  try {
    const tokenRes = await fetch(MS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: c.env.MS_CLIENT_ID,
        client_secret: c.env.MS_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: syncSelfUrl(c, "m365-oauth"),
        scope: MS_SCOPES,
      }),
    });
    if (!tokenRes.ok) throw new Error("token exchange failed");
    const tok = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    const meRes = await fetch(`${GRAPH}/me`, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const me = (await meRes.json()) as { mail?: string; userPrincipalName?: string };
    const email = me.mail ?? me.userPrincipalName ?? "";
    if (!email) throw new Error("graph profile missing email");

    const account = await upsertAccount(io.sql, state.u, {
      provider: "m365",
      email,
      sync_direction: "read_only",
      calendars: [{ id: "primary", summary: `Outlook (${email})`, color: null, visible: true }],
      access_token: tok.access_token ?? null,
      access_token_expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
      delta_link: null,
      needs_reconnect: false,
    });
    if (tok.refresh_token) {
      await sealAccountSecret(io.sql, account.id, state.u, c.env, tok.refresh_token);
    }
    await logSync(io.sql, "m365", "oauth-connect", "ok", undefined, state.u);
    try {
      c.executionCtx.waitUntil(runM365Sync(io.sql, c.env, { accountId: account.id, userId: state.u }).then(() => undefined));
    } catch {
      await runM365Sync(io.sql, c.env, { accountId: account.id, userId: state.u });
    }
    return Response.redirect(state.r || c.env.APP_URL || "/", 302);
  } catch (e) {
    logServerError("m365-oauth", e);
    await logSync(io.sql, "m365", "oauth", "error", loggedError(e), state.u);
    return clientError("oauth_failed");
  }
}

async function handleIcloudConnect(c: Context<AppEnv>, deps: CalendarRouteDeps): Promise<Response> {
  if (isReadMethod(c.req.method)) {
    const got = await deps.requireUser(c);
    if ("error" in got) return got.error;
    return json({ ok: true }, 200, OPEN_CORS);
  }
  const blocked = deps.refuseIfFrozen?.(c) ?? null;
  if (blocked) return blocked;
  const got = await deps.requireUser(c);
  if ("error" in got) return got.error;
  const body = requireJsonObject(await readJson<unknown>(c));
  const appleId = body.appleId;
  const appPassword = body.appPassword;
  if (!appleId || typeof appleId !== "string" || !/^[^@\s]+@[^@\s]+$/.test(appleId.trim())) {
    return clientError("bad_request", 400);
  }
  if (!appPassword || typeof appPassword !== "string" || appPassword.trim().length < 8) {
    return clientError("bad_request", 400);
  }
  const username = appleId.trim();
  const password = appPassword.trim().replace(/\s+/g, "");

  let calendars;
  try {
    calendars = await discoverCalendars(username, password);
  } catch (e) {
    logServerError("icloud-connect", e);
    return clientError("bad_request", 400);
  }

  const io = await deps.requestIo(c);
  const store = makeStore(io.sql, got.userId);
  const existing = (await listOwnedAccounts(store, "icloud")).find((a) => a.email === username);
  calendars = withoutMirrorCalendar(calendars, existing?.mirror_calendar_id ?? null);

  try {
    const account = await upsertAccount(io.sql, got.userId, {
      provider: "icloud",
      email: username,
      sync_direction: "two_way",
      calendars: calendars.map((cal) => ({
        id: cal.url,
        summary: cal.displayName,
        color: cal.color,
        visible: true,
      })),
      needs_reconnect: false,
    });
    await sealAccountSecret(io.sql, account.id, got.userId, c.env, password);
    await logSync(io.sql, "icloud", "connect", "ok", undefined, got.userId);
    try {
      c.executionCtx.waitUntil(
        Promise.all([
          runIcloudSync(io.sql, c.env, { accountId: account.id, userId: got.userId }),
          runIcloudContacts(io.sql, c.env, { accountId: account.id, userId: got.userId }),
        ]).then(() => undefined),
      );
    } catch {
      await Promise.all([
        runIcloudSync(io.sql, c.env, { accountId: account.id, userId: got.userId }),
        runIcloudContacts(io.sql, c.env, { accountId: account.id, userId: got.userId }),
      ]);
    }
    return json({ ok: true, id: account.id, calendars: calendars.length }, 200, OPEN_CORS);
  } catch (e) {
    logServerError("icloud-connect", e);
    await logSync(io.sql, "icloud", "connect", "error", loggedError(e), got.userId);
    return clientError("request_failed");
  }
}

async function handleIcsSubscribe(c: Context<AppEnv>, deps: CalendarRouteDeps): Promise<Response> {
  if (isReadMethod(c.req.method)) {
    const got = await deps.requireUser(c);
    if ("error" in got) return got.error;
    return json({ ok: true }, 200, OPEN_CORS);
  }
  const blocked = deps.refuseIfFrozen?.(c) ?? null;
  if (blocked) return blocked;
  const got = await deps.requireUser(c);
  if ("error" in got) return got.error;
  const body = requireJsonObject(await readJson<unknown>(c));
  const checked = await assertPublicFeedUrl(typeof body.url === "string" ? body.url : "");
  if (!checked.ok) return clientError("bad_request", 400);

  const fetched = await fetchIcsFeed(checked.url);
  if (!fetched.ok) return clientError("bad_request", 400);
  const text = fetched.text;
  if (!text.includes("BEGIN:VCALENDAR")) return clientError("bad_request", 400);
  const calName = (text.match(/X-WR-CALNAME:(.+)/)?.[1] ?? "").trim();
  const email =
    (typeof body.label === "string" && body.label.trim()) || calName || "Subscribed calendar";

  const io = await deps.requestIo(c);
  try {
    const account = await upsertAccount(io.sql, got.userId, {
      provider: "ics",
      email,
      sync_direction: "read_only",
      calendars: [{ id: "primary", summary: calName || email, color: "#0EA5E9", visible: true }],
      needs_reconnect: false,
    });
    await sealAccountSecret(io.sql, account.id, got.userId, c.env, checked.url);
    await logSync(io.sql, "ics", "subscribe", "ok", undefined, got.userId);
    try {
      c.executionCtx.waitUntil(runIcsSync(io.sql, c.env, { accountId: account.id, userId: got.userId }).then(() => undefined));
    } catch {
      await runIcsSync(io.sql, c.env, { accountId: account.id, userId: got.userId });
    }
    return json({ ok: true, id: account.id }, 200, OPEN_CORS);
  } catch (e) {
    logServerError("ics-subscribe", e);
    await logSync(io.sql, "ics", "subscribe", "error", loggedError(e), got.userId);
    return clientError("request_failed");
  }
}

async function handleEvents(c: Context<AppEnv>, deps: CalendarRouteDeps): Promise<Response> {
  if (isReadMethod(c.req.method)) {
    const got = await deps.requireUser(c);
    if ("error" in got) return got.error;
    return json({ ok: true }, 200, OPEN_CORS);
  }
  const blocked = deps.refuseIfFrozen?.(c) ?? null;
  if (blocked) return blocked;
  const got = await deps.requireUser(c);
  if ("error" in got) return got.error;
  const body = requireJsonObject(await readJson<unknown>(c));
  if (typeof body.eventId === "string" && body.eventId) {
    try {
      requireUuid(body.eventId, "eventId");
    } catch {
      throw new BadRequestError("eventId is not a uuid");
    }
  }
  if (typeof body.accountId === "string" && body.accountId) {
    try {
      requireUuid(body.accountId, "accountId");
    } catch {
      throw new BadRequestError("accountId is not a uuid");
    }
  }
  const io = await deps.requestIo(c);
  try {
    const store = makeStore(io.sql, got.userId) as Store;
    await bootstrapUser(store, null, { emailVerified: true });
    const out = await handleIcloudEvents(store, c.env, body);
    if (typeof out.body.error === "string" && out.status >= 400) {
      const generic = out.status === 404 ? "not found" : out.status === 400 ? "bad_request" : "request_failed";
      return json({ error: generic }, out.status, OPEN_CORS);
    }
    return json(out.body, out.status, OPEN_CORS);
  } catch (e) {
    if (e instanceof BadRequestError) return clientError("bad_request", 400);
    logServerError("icloud-events", e);
    await logSync(io.sql, "icloud", "event-writeback", "error", loggedError(e), got.userId);
    return clientError("request_failed");
  }
}
