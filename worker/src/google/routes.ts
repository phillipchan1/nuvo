import type { Context } from "hono";
import type { Hono } from "hono";
import { json, OPEN_CORS } from "../cors.ts";
import type { Env } from "../env.ts";
import { readJson, requireUuid } from "../http.ts";
import { bearerToken, cronAuthorized } from "../cron.ts";
import { gateCronBearerRoute } from "../cutoverFlip.ts";
import { logServerError } from "../lib/redact.ts";
import type { RequestIo } from "../requestIo.ts";
import { handleGoogleOauthCallback, startGoogleOauth } from "./oauth.ts";
import { handleGoogleEvents } from "./events.ts";
import { handleGoogleWebhook } from "./webhook.ts";
import { runGoogleContacts } from "./contacts.ts";
import { runCalendarRefreshGoogle } from "./refresh.ts";
import { runGoogleSync, type SyncMode } from "./sync.ts";
import {
  getOwnedGoogleAccount,
  listOwnedGoogleAccounts,
  listOwnedGoogleEvents,
  makeCalendarStore,
  publicGoogleAccount,
} from "./owned.ts";

type AppEnv = { Bindings: Env; Variables: { io?: RequestIo } };

export type GoogleRouteDeps = {
  /** Bootstrapped planner user id (not the raw Better Auth id). */
  requireUser: (c: Context<AppEnv>, raw?: Request) => Promise<{ userId: string } | { error: Response }>;
  requestIo: (c: Context<AppEnv>) => Promise<RequestIo>;
  refuseIfFrozen?: (c: Context<AppEnv>) => Response | null;
};

function preflight(): Response {
  return new Response("ok", { headers: OPEN_CORS });
}

function isSyncMode(value: unknown): value is SyncMode {
  return value === "full" || value === "incremental" || value === "poll" ||
    value === "renew-channels" || value === "resubscribe";
}

function isReadMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD";
}

function clientError(code: string, status = 500): Response {
  return json({ error: code }, status, OPEN_CORS);
}

export function registerGoogleRoutes(app: Hono<AppEnv>, deps: GoogleRouteDeps): void {
  const paths = (suffix: string) => [`/functions/v1/${suffix}`, `/api/${suffix}`] as const;
  const freezeWrite = (c: Context<AppEnv>, write: boolean) =>
    write ? (deps.refuseIfFrozen?.(c) ?? null) : null;

  for (const path of paths("google-oauth")) {
    app.options(path, preflight);
    app.all(path, async (c) => {
      const url = new URL(c.req.url);
      const isStart = url.searchParams.get("action") === "start";
      const isCallback = Boolean(url.searchParams.get("code"));
      const write = isCallback || (!isStart && !isReadMethod(c.req.method));
      const blocked = freezeWrite(c, write);
      if (blocked) return blocked;
      if (isStart) {
        const token = url.searchParams.get("token");
        const headers = new Headers(c.req.raw.headers);
        if (token && !headers.get("authorization")) headers.set("authorization", `Bearer ${token}`);
        const raw = new Request(c.req.raw, { headers });
        const got = await deps.requireUser(c, raw);
        if ("error" in got) return got.error;
        const redirect = url.searchParams.get("redirect") ?? "";
        return startGoogleOauth(c.env, got.userId, redirect, c.req.url);
      }
      const io = await deps.requestIo(c);
      try {
        return await handleGoogleOauthCallback(io.sql, c.env, c.req.url);
      } catch (e) {
        logServerError("google-oauth", e);
        return clientError("oauth_failed");
      }
    });
  }

  for (const path of paths("google-sync")) {
    app.options(path, preflight);
    app.all(path, async (c) => {
      if (isReadMethod(c.req.method)) {
        const got = await deps.requireUser(c);
        if ("error" in got) return got.error;
        const io = await deps.requestIo(c);
        const accounts = await listOwnedGoogleAccounts(makeCalendarStore(io.sql, got.userId));
        return json({ ok: true, accounts: accounts.map(publicGoogleAccount) }, 200, OPEN_CORS);
      }
      const blocked = freezeWrite(c, true);
      if (blocked) return blocked;
      const body = await readJson<{ mode?: string; accountId?: string; calendarId?: string }>(c).catch(
        (): { mode?: string; accountId?: string; calendarId?: string } => ({}),
      );
      const cronOk = cronAuthorized(bearerToken(c.req.header("authorization")), c.env.CRON_SECRET);
      if (cronOk) {
        const gated = gateCronBearerRoute(c.env, "google-sync");
        if (gated) return gated;
      }
      const io = await deps.requestIo(c);
      try {
        if (cronOk) {
          const result = await runGoogleSync(io.sql, c.env, {
            mode: isSyncMode(body.mode) ? body.mode : "poll",
            accountId: body.accountId,
            calendarId: body.calendarId,
            reqUrl: c.req.url,
          });
          return json(result, 200, OPEN_CORS);
        }
        const got = await deps.requireUser(c);
        if ("error" in got) return got.error;
        if (body.accountId) {
          requireUuid(body.accountId, "accountId");
          const owned = await getOwnedGoogleAccount(makeCalendarStore(io.sql, got.userId), body.accountId);
          if (!owned) return json({ error: "not found" }, 404, OPEN_CORS);
        }
        const result = await runGoogleSync(io.sql, c.env, {
          mode: isSyncMode(body.mode) ? body.mode : "incremental",
          accountId: body.accountId,
          calendarId: body.calendarId,
          userId: got.userId,
          reqUrl: c.req.url,
        });
        return json(result, 200, OPEN_CORS);
      } catch (e) {
        logServerError("google-sync", e);
        return clientError("request_failed");
      }
    });
  }

  for (const path of paths("google-events")) {
    app.options(path, preflight);
    app.all(path, async (c) => {
      if (isReadMethod(c.req.method)) {
        const got = await deps.requireUser(c);
        if ("error" in got) return got.error;
        const io = await deps.requestIo(c);
        const events = await listOwnedGoogleEvents(makeCalendarStore(io.sql, got.userId));
        return json({ ok: true, events }, 200, OPEN_CORS);
      }
      const blocked = freezeWrite(c, true);
      if (blocked) return blocked;
      const body = await readJson<Record<string, unknown>>(c).catch(() => ({} as Record<string, unknown>));
      const cronOk = cronAuthorized(bearerToken(c.req.header("authorization")), c.env.CRON_SECRET);
      const acting = typeof body.actingUserId === "string" ? body.actingUserId : "";
      if (cronOk && acting) {
        const gated = gateCronBearerRoute(c.env, "google-events");
        if (gated) return gated;
      }
      const io = await deps.requestIo(c);
      let userId: string;
      if (cronOk && acting) {
        requireUuid(acting, "actingUserId");
        userId = acting;
      } else {
        const got = await deps.requireUser(c);
        if ("error" in got) return got.error;
        userId = got.userId;
      }
      if (typeof body.accountId === "string") requireUuid(body.accountId, "accountId");
      if (typeof body.eventId === "string") requireUuid(body.eventId, "eventId");
      try {
        const result = await handleGoogleEvents(io.sql, c.env, userId, body, c.req.url);
        return json(result.data, result.status, OPEN_CORS);
      } catch (e) {
        logServerError("google-events", e);
        return clientError("request_failed");
      }
    });
  }

  for (const path of paths("google-webhook")) {
    app.options(path, preflight);
    app.all(path, async (c) => {
      const blocked = freezeWrite(c, true);
      if (blocked) return blocked;
      const io = await deps.requestIo(c);
      try {
        return await handleGoogleWebhook(io.sql, c.env, c.req.raw);
      } catch (e) {
        logServerError("google-webhook", e);
        return clientError("request_failed");
      }
    });
  }

  for (const path of paths("google-contacts")) {
    app.options(path, preflight);
    app.all(path, async (c) => {
      if (isReadMethod(c.req.method)) {
        const got = await deps.requireUser(c);
        if ("error" in got) return got.error;
        const io = await deps.requestIo(c);
        const accounts = await listOwnedGoogleAccounts(makeCalendarStore(io.sql, got.userId));
        return json({ ok: true, accounts: accounts.map(publicGoogleAccount) }, 200, OPEN_CORS);
      }
      const blocked = freezeWrite(c, true);
      if (blocked) return blocked;
      const body = await readJson<{ accountId?: string }>(c).catch(
        (): { accountId?: string } => ({}),
      );
      const cronOk = cronAuthorized(bearerToken(c.req.header("authorization")), c.env.CRON_SECRET);
      if (cronOk) {
        const gated = gateCronBearerRoute(c.env, "google-contacts");
        if (gated) return gated;
      }
      const io = await deps.requestIo(c);
      try {
        if (cronOk) {
          const result = await runGoogleContacts(io.sql, c.env, { accountId: body.accountId });
          return json(result, 200, OPEN_CORS);
        }
        const got = await deps.requireUser(c);
        if ("error" in got) return got.error;
        if (body.accountId) {
          requireUuid(body.accountId, "accountId");
          const owned = await getOwnedGoogleAccount(makeCalendarStore(io.sql, got.userId), body.accountId);
          if (!owned) return json({ error: "not found" }, 404, OPEN_CORS);
        }
        const result = await runGoogleContacts(io.sql, c.env, {
          accountId: body.accountId,
          userId: got.userId,
        });
        return json(result, 200, OPEN_CORS);
      } catch (e) {
        logServerError("google-contacts", e);
        return clientError("request_failed");
      }
    });
  }

  for (const path of paths("calendar-refresh")) {
    app.options(path, preflight);
    app.all(path, async (c) => {
      if (isReadMethod(c.req.method)) {
        const got = await deps.requireUser(c);
        if ("error" in got) return got.error;
        const io = await deps.requestIo(c);
        const accounts = await listOwnedGoogleAccounts(makeCalendarStore(io.sql, got.userId));
        return json({ ok: true, accounts: accounts.map(publicGoogleAccount) }, 200, OPEN_CORS);
      }
      const blocked = freezeWrite(c, true);
      if (blocked) return blocked;
      const got = await deps.requireUser(c);
      if ("error" in got) return got.error;
      const body = await readJson<{ fullSync?: boolean; accountId?: string }>(c).catch(
        (): { fullSync?: boolean; accountId?: string } => ({}),
      );
      const io = await deps.requestIo(c);
      if (body.accountId) {
        requireUuid(body.accountId, "accountId");
        const owned = await getOwnedGoogleAccount(makeCalendarStore(io.sql, got.userId), body.accountId);
        if (!owned) return json({ error: "not found" }, 404, OPEN_CORS);
      }
      try {
        const result = await runCalendarRefreshGoogle(
          io.sql,
          c.env,
          got.userId,
          body.fullSync === true,
          c.req.url,
        );
        return json(result, 200, OPEN_CORS);
      } catch (e) {
        logServerError("calendar-refresh", e);
        return clientError("refresh_failed");
      }
    });
  }
}
