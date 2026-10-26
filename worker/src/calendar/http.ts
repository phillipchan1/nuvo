import type { Context } from "hono";
import { SessionLookupError, sessionUser } from "../auth.ts";
import { OPEN_CORS, json } from "../cors.ts";
import { bearerToken, cronAuthorized } from "../cron.ts";
import type { Env } from "../env.ts";
import { BadRequestError, readJson, requireJsonObject, requireUuid } from "../http.ts";
import { GRAPH, MS_AUTH_URL, MS_SCOPES, MS_TOKEN_URL } from "../lib/ms.ts";
import { signState, verifyState } from "../lib/oauthState.ts";
import { discoverCalendars } from "../lib/caldav.ts";
import { withoutMirrorCalendar } from "../lib/mirror.ts";
import type { RequestIo } from "../requestIo.ts";
import { bootstrapUser, makeStore, type Store } from "../store.ts";
import { handleIcloudEvents } from "./icloudEvents.ts";
import { runIcloudContacts, runIcloudSync } from "./icloud.ts";
import { assertPublicFeedUrl, runIcsSync } from "./icsFeed.ts";
import { runM365Sync } from "./m365.ts";
import {
  getOwnedAccount,
  listOwnedAccounts,
  logSync,
  sealAccountSecret,
  upsertAccount,
} from "./store.ts";

type AppEnv = { Bindings: Env; Variables: { io?: RequestIo } };

const CALENDAR_ROUTES = [
  "m365-oauth",
  "m365-sync",
  "icloud-connect",
  "icloud-sync",
  "icloud-events",
  "icloud-contacts",
  "ics-subscribe",
  "ics-sync",
  "calendar-refresh",
] as const;

export type CalendarRoute = (typeof CALENDAR_ROUTES)[number];

export function isCalendarRoute(name: string): name is CalendarRoute {
  return (CALENDAR_ROUTES as readonly string[]).includes(name);
}

type SessionUser = { id: string; email?: string | null; emailVerified: boolean };
type SessionOk = { store: Store; user: SessionUser };
type SessionErr = { error: Response };

async function requireSessionStore(c: Context<AppEnv>, io: RequestIo): Promise<SessionOk | SessionErr> {
  let user;
  try {
    user = await sessionUser(io.auth, c.req.raw);
  } catch (err) {
    if (err instanceof SessionLookupError) {
      return { error: json({ error: "service unavailable" }, 503, OPEN_CORS) };
    }
    throw err;
  }
  if (!user) return { error: json({ error: "unauthorized" }, 401, OPEN_CORS) };
  const store = await bootstrapUser(makeStore(io.sql, user.id), user.email ?? null, {
    emailVerified: user.emailVerified,
  });
  return { store, user };
}

async function sessionFromTokenQuery(c: Context<AppEnv>, io: RequestIo): Promise<SessionOk | SessionErr> {
  const token = c.req.query("token") ?? "";
  if (!token) return requireSessionStore(c, io);
  const headers = new Headers(c.req.raw.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const fake = new Request(c.req.url, { method: c.req.method, headers });
  let user;
  try {
    user = await sessionUser(io.auth, fake);
  } catch (err) {
    if (err instanceof SessionLookupError) {
      return { error: json({ error: "service unavailable" }, 503, OPEN_CORS) };
    }
    throw err;
  }
  if (!user) return { error: json({ error: "unauthorized" }, 401, OPEN_CORS) };
  const store = await bootstrapUser(makeStore(io.sql, user.id), user.email ?? null, {
    emailVerified: user.emailVerified,
  });
  return { store, user };
}

function syncSelfUrl(c: Context<AppEnv>, name: string): string {
  const url = new URL(c.req.url);
  return `${url.origin}/functions/v1/${name}`;
}

async function ownedAccountId(store: ReturnType<typeof makeStore>, raw: unknown): Promise<string | undefined> {
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    requireUuid(raw, "accountId");
  } catch {
    return "00000000-0000-4000-8000-000000000000";
  }
  const owned = await getOwnedAccount(store, raw);
  return owned?.id ?? "00000000-0000-4000-8000-000000000000";
}

export async function handleCalendarRoute(
  c: Context<AppEnv>,
  io: RequestIo,
  name: CalendarRoute,
): Promise<Response> {
  if (c.req.method === "OPTIONS") return new Response("ok", { headers: OPEN_CORS });
  const env = c.env;

  if (name === "m365-oauth") return handleM365Oauth(c, io, env);
  if (name === "icloud-connect") return handleIcloudConnect(c, io, env);
  if (name === "ics-subscribe") return handleIcsSubscribe(c, io, env);
  if (name === "icloud-events") return handleEvents(c, io, env);
  if (name === "calendar-refresh") return handleRefresh(c, io, env);

  const cronTok = bearerToken(c.req.header("authorization"));
  const asCron = cronAuthorized(cronTok, env.CRON_SECRET);
  if (asCron) {
    const body = await readJson<{ accountId?: string }>(c).catch(() => ({} as { accountId?: string }));
    const accountId = typeof body.accountId === "string" && body.accountId ? requireUuid(body.accountId, "accountId") : undefined;
    if (name === "m365-sync") {
      const out = await runM365Sync(io.sql, env, accountId);
      return json(out, "error" in out ? 500 : 200, OPEN_CORS);
    }
    if (name === "icloud-sync") {
      const out = await runIcloudSync(io.sql, env, accountId);
      return json(out, "error" in out ? 500 : 200, OPEN_CORS);
    }
    if (name === "icloud-contacts") {
      const out = await runIcloudContacts(io.sql, env, accountId);
      return json(out, "error" in out ? 500 : 200, OPEN_CORS);
    }
    if (name === "ics-sync") {
      const out = await runIcsSync(io.sql, env, accountId);
      return json(out, "error" in out ? 500 : 200, OPEN_CORS);
    }
  }

  const got = await requireSessionStore(c, io);
  if ("error" in got) return got.error;
  const body = await readJson<{ accountId?: string }>(c).catch(() => ({} as { accountId?: string }));
  const accountId = await ownedAccountId(got.store, body.accountId);

  if (name === "m365-sync") {
    const out = await runM365Sync(io.sql, env, accountId);
    return json(out, "error" in out ? 500 : 200, OPEN_CORS);
  }
  if (name === "icloud-sync") {
    const out = await runIcloudSync(io.sql, env, accountId);
    return json(out, "error" in out ? 500 : 200, OPEN_CORS);
  }
  if (name === "icloud-contacts") {
    const out = await runIcloudContacts(io.sql, env, accountId);
    return json(out, "error" in out ? 500 : 200, OPEN_CORS);
  }
  if (name === "ics-sync") {
    const out = await runIcsSync(io.sql, env, accountId);
    return json(out, "error" in out ? 500 : 200, OPEN_CORS);
  }
  return json({ error: "not found" }, 404, OPEN_CORS);
}

async function handleM365Oauth(c: Context<AppEnv>, io: RequestIo, env: Env): Promise<Response> {
  const url = new URL(c.req.url);
  const secret = env.BETTER_AUTH_SECRET ?? "";
  if (url.searchParams.get("action") === "start") {
    const got = await sessionFromTokenQuery(c, io);
    if ("error" in got) return got.error;
    if (!env.MS_CLIENT_ID) return json({ error: "MS client is not configured" }, 500, OPEN_CORS);
    const state = await signState(secret, {
      u: got.store.userId,
      r: url.searchParams.get("redirect") ?? "",
    });
    const consent = new URL(MS_AUTH_URL);
    consent.searchParams.set("client_id", env.MS_CLIENT_ID);
    consent.searchParams.set("redirect_uri", syncSelfUrl(c, "m365-oauth"));
    consent.searchParams.set("response_type", "code");
    consent.searchParams.set("scope", MS_SCOPES);
    consent.searchParams.set("response_mode", "query");
    consent.searchParams.set("state", state);
    return Response.redirect(consent.toString(), 302);
  }

  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  if (!code || !stateParam) return json({ error: "missing code/state" }, 400, OPEN_CORS);
  let state: Record<string, string>;
  try {
    state = await verifyState(secret, stateParam);
  } catch {
    return json({ error: "bad oauth state" }, 400, OPEN_CORS);
  }
  if (!state.u || !env.MS_CLIENT_ID || !env.MS_CLIENT_SECRET || !env.TOKEN_ENC_KEY_V1) {
    return json({ error: "oauth is not configured" }, 500, OPEN_CORS);
  }

  try {
    const tokenRes = await fetch(MS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.MS_CLIENT_ID,
        client_secret: env.MS_CLIENT_SECRET,
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
      await sealAccountSecret(io.sql, account.id, state.u, env.TOKEN_ENC_KEY_V1, tok.refresh_token);
    }
    await logSync(io.sql, "m365", "oauth-connect", "ok", undefined, state.u);
    try {
      c.executionCtx.waitUntil(runM365Sync(io.sql, env, account.id).then(() => undefined));
    } catch {
      await runM365Sync(io.sql, env, account.id);
    }
    return Response.redirect(state.r || env.APP_URL || "/", 302);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync(io.sql, "m365", "oauth", "error", msg);
    return json({ error: msg }, 500, OPEN_CORS);
  }
}

async function handleIcloudConnect(c: Context<AppEnv>, io: RequestIo, env: Env): Promise<Response> {
  const got = await requireSessionStore(c, io);
  if ("error" in got) return got.error;
  if (!env.TOKEN_ENC_KEY_V1) return json({ error: "token key is not configured" }, 500, OPEN_CORS);
  const body = requireJsonObject(await readJson<unknown>(c));
  const appleId = body.appleId;
  const appPassword = body.appPassword;
  if (!appleId || typeof appleId !== "string" || !/^[^@\s]+@[^@\s]+$/.test(appleId.trim())) {
    return json({ error: "A valid Apple ID email is required" }, 400, OPEN_CORS);
  }
  if (!appPassword || typeof appPassword !== "string" || appPassword.trim().length < 8) {
    return json({ error: "An app-specific password is required" }, 400, OPEN_CORS);
  }
  const username = appleId.trim();
  const password = appPassword.trim().replace(/\s+/g, "");

  let calendars;
  try {
    calendars = await discoverCalendars(username, password);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400, OPEN_CORS);
  }

  const existing = (await listOwnedAccounts(got.store, "icloud")).find((a) => a.email === username);
  calendars = withoutMirrorCalendar(calendars, existing?.mirror_calendar_id ?? null);

  try {
    const account = await upsertAccount(io.sql, got.store.userId, {
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
    await sealAccountSecret(io.sql, account.id, got.store.userId, env.TOKEN_ENC_KEY_V1, password);
    await logSync(io.sql, "icloud", "connect", "ok", undefined, got.store.userId);
    try {
      c.executionCtx.waitUntil(
        Promise.all([
          runIcloudSync(io.sql, env, account.id),
          runIcloudContacts(io.sql, env, account.id),
        ]).then(() => undefined),
      );
    } catch {
      await Promise.all([runIcloudSync(io.sql, env, account.id), runIcloudContacts(io.sql, env, account.id)]);
    }
    return json({ ok: true, id: account.id, calendars: calendars.length }, 200, OPEN_CORS);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync(io.sql, "icloud", "connect", "error", msg);
    return json({ error: msg }, 500, OPEN_CORS);
  }
}

async function handleIcsSubscribe(c: Context<AppEnv>, io: RequestIo, env: Env): Promise<Response> {
  const got = await requireSessionStore(c, io);
  if ("error" in got) return got.error;
  if (!env.TOKEN_ENC_KEY_V1) return json({ error: "token key is not configured" }, 500, OPEN_CORS);
  const body = requireJsonObject(await readJson<unknown>(c));
  const checked = assertPublicFeedUrl(typeof body.url === "string" ? body.url : "");
  if (!checked.ok) return json({ error: checked.error }, 400, OPEN_CORS);

  const res = await fetch(checked.url, { headers: { Accept: "text/calendar" } });
  if (!res.ok) return json({ error: `Feed returned HTTP ${res.status}` }, 400, OPEN_CORS);
  const text = await res.text();
  if (!text.includes("BEGIN:VCALENDAR")) {
    return json({ error: "That URL doesn't return an iCalendar feed" }, 400, OPEN_CORS);
  }
  const calName = (text.match(/X-WR-CALNAME:(.+)/)?.[1] ?? "").trim();
  const email =
    (typeof body.label === "string" && body.label.trim()) || calName || "Subscribed calendar";

  try {
    const account = await upsertAccount(io.sql, got.store.userId, {
      provider: "ics",
      email,
      sync_direction: "read_only",
      calendars: [{ id: "primary", summary: calName || email, color: "#0EA5E9", visible: true }],
      needs_reconnect: false,
    });
    await sealAccountSecret(io.sql, account.id, got.store.userId, env.TOKEN_ENC_KEY_V1, checked.url);
    await logSync(io.sql, "ics", "subscribe", "ok", undefined, got.store.userId);
    try {
      c.executionCtx.waitUntil(runIcsSync(io.sql, env, account.id).then(() => undefined));
    } catch {
      await runIcsSync(io.sql, env, account.id);
    }
    return json({ ok: true, id: account.id }, 200, OPEN_CORS);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync(io.sql, "ics", "subscribe", "error", msg);
    return json({ error: msg }, 500, OPEN_CORS);
  }
}

async function handleEvents(c: Context<AppEnv>, io: RequestIo, env: Env): Promise<Response> {
  const got = await requireSessionStore(c, io);
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
  try {
    const out = await handleIcloudEvents(got.store, env, body);
    return json(out.body, out.status, OPEN_CORS);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    await logSync(io.sql, "icloud", "event-writeback", "error", msg);
    return json({ error: msg }, 500, OPEN_CORS);
  }
}

async function handleRefresh(c: Context<AppEnv>, io: RequestIo, env: Env): Promise<Response> {
  const got = await requireSessionStore(c, io);
  if ("error" in got) return got.error;
  await readJson<unknown>(c).catch(() => ({}));
  const accounts = (await listOwnedAccounts(got.store)).filter(
    (a) => !a.needs_reconnect && (a.provider === "m365" || a.provider === "icloud" || a.provider === "ics"),
  );
  const errors: string[] = [];
  for (const account of accounts) {
    const out =
      account.provider === "m365"
        ? await runM365Sync(io.sql, env, account.id)
        : account.provider === "icloud"
          ? await runIcloudSync(io.sql, env, account.id)
          : await runIcsSync(io.sql, env, account.id);
    if ("error" in out) errors.push(account.provider);
    if (account.provider === "icloud") {
      try {
        c.executionCtx.waitUntil(runIcloudContacts(io.sql, env, account.id).then(() => undefined));
      } catch {
        await runIcloudContacts(io.sql, env, account.id);
      }
    }
  }
  if (errors.length === accounts.length && errors.length > 0) {
    return json({ error: "refresh failed" }, 500, OPEN_CORS);
  }
  return json(
    { ok: true, synced: accounts.length, errors: errors.length ? errors : undefined },
    200,
    OPEN_CORS,
  );
}
