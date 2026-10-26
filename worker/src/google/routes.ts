import type { Context } from "hono";
import type { Hono } from "hono";
import { json, OPEN_CORS } from "../cors.ts";
import type { Env } from "../env.ts";
import { readJson, requireUuid } from "../http.ts";
import { bearerToken, cronAuthorized } from "../cron.ts";
import type { RequestIo } from "../requestIo.ts";
import { handleGoogleOauthCallback, startGoogleOauth } from "./oauth.ts";
import { handleGoogleEvents } from "./events.ts";
import { handleGoogleWebhook } from "./webhook.ts";
import { runGoogleContacts } from "./contacts.ts";
import { runCalendarRefreshGoogle } from "./refresh.ts";
import { runGoogleSync, type SyncMode } from "./sync.ts";
import { getOwnedGoogleAccount, makeCalendarStore } from "./owned.ts";

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

export function registerGoogleRoutes(app: Hono<AppEnv>, deps: GoogleRouteDeps): void {
  const paths = (suffix: string) => [`/functions/v1/${suffix}`, `/api/${suffix}`] as const;
  const frozen = (c: Context<AppEnv>) => deps.refuseIfFrozen?.(c) ?? null;

  for (const path of paths("google-oauth")) {
    app.options(path, preflight);
    app.all(path, async (c) => {
      const blocked = frozen(c);
      if (blocked) return blocked;
      const url = new URL(c.req.url);
      if (url.searchParams.get("action") === "start") {
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
        const msg = e instanceof Error ? e.message : "oauth failed";
        return json({ error: msg }, 500, OPEN_CORS);
      }
    });
  }

  for (const path of paths("google-sync")) {
    app.options(path, preflight);
    app.all(path, async (c) => {
      const blocked = frozen(c);
      if (blocked) return blocked;
      const body = await readJson<{ mode?: string; accountId?: string; calendarId?: string }>(c).catch(
        (): { mode?: string; accountId?: string; calendarId?: string } => ({}),
      );
      const cronOk = cronAuthorized(bearerToken(c.req.header("authorization")), c.env.CRON_SECRET);
      const io = await deps.requestIo(c);
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
    });
  }

  for (const path of paths("google-events")) {
    app.options(path, preflight);
    app.all(path, async (c) => {
      const blocked = frozen(c);
      if (blocked) return blocked;
      const body = await readJson<Record<string, unknown>>(c).catch(() => ({} as Record<string, unknown>));
      const cronOk = cronAuthorized(bearerToken(c.req.header("authorization")), c.env.CRON_SECRET);
      const acting = typeof body.actingUserId === "string" ? body.actingUserId : "";
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
        const msg = e instanceof Error ? e.message : "request failed";
        return json({ error: msg }, 500, OPEN_CORS);
      }
    });
  }

  for (const path of paths("google-webhook")) {
    app.options(path, preflight);
    app.all(path, async (c) => {
      const blocked = frozen(c);
      if (blocked) return blocked;
      const io = await deps.requestIo(c);
      return handleGoogleWebhook(io.sql, c.env, c.req.raw);
    });
  }

  for (const path of paths("google-contacts")) {
    app.options(path, preflight);
    app.all(path, async (c) => {
      const blocked = frozen(c);
      if (blocked) return blocked;
      const body = await readJson<{ accountId?: string }>(c).catch(
        (): { accountId?: string } => ({}),
      );
      const cronOk = cronAuthorized(bearerToken(c.req.header("authorization")), c.env.CRON_SECRET);
      const io = await deps.requestIo(c);
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
    });
  }

  for (const path of paths("calendar-refresh")) {
    app.options(path, preflight);
    app.all(path, async (c) => {
      const blocked = frozen(c);
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
        return json({ error: e instanceof Error ? e.message : "refresh failed" }, 500, OPEN_CORS);
      }
    });
  }
}
