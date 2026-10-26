// HTTP A/B isolation for the Google Worker routes (PR B).
// Companion to accessHttp.check.ts (planner CRUD from #97).
// Run: node --experimental-strip-types worker/src/googleHttp.check.ts
import { PGlite } from "@electric-sql/pglite";
import { applyIsolationSchema } from "./isolationDb.ts";
import { makePgliteSql } from "./pgliteSql.ts";
import { installRequestIoForTests } from "./requestIo.ts";
import { installOutboundFetchForTests } from "./lib/outboundFetch.ts";
import app from "./index.ts";
import type { Env } from "./env.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const ACCOUNT_A = "aaaaaaaa-eeee-4000-8000-000000000001";
const ACCOUNT_B = "bbbbbbbb-eeee-4000-8000-000000000001";
const EVENT_A = "aaaaaaaa-ffff-4000-8000-000000000001";
const EVENT_B = "bbbbbbbb-ffff-4000-8000-000000000001";
const UNKNOWN = "cccccccc-0000-4000-8000-000000000099";

const db = new PGlite();
await applyIsolationSchema(db);
const sql = makePgliteSql(db);

const fakeAuth = {
  api: {
    async getSession({ headers }: { headers: Headers }) {
      const auth = headers.get("authorization") ?? "";
      if (auth === "Bearer user-a") {
        return { user: { id: A, email: "a@example.test", emailVerified: true } };
      }
      if (auth === "Bearer user-b") {
        return { user: { id: B, email: "b@example.test", emailVerified: true } };
      }
      return null;
    },
  },
  handler: async () => new Response("not used"),
};

installRequestIoForTests(() => ({
  sql,
  auth: fakeAuth as never,
  close: async () => undefined,
}));

const restoreFetch = installOutboundFetchForTests(async (input) => {
  const url = String(input);
  if (url.includes("oauth2.googleapis.com/token")) {
    return new Response(JSON.stringify({ access_token: "ya29.refreshed", expires_in: 3600 }), { status: 200 });
  }
  if (url.includes("/calendars/") && url.includes("/events") && !url.includes("/watch")) {
    return new Response(JSON.stringify({ items: [], nextSyncToken: "sync-1" }), { status: 200 });
  }
  if (url.includes("/events/watch")) {
    return new Response(JSON.stringify({ resourceId: "res-new", expiration: String(Date.now() + 7 * 86400_000) }), {
      status: 200,
    });
  }
  if (url.includes("/channels/stop")) return new Response("ok", { status: 200 });
  if (url.includes("people.googleapis.com")) {
    return new Response(JSON.stringify({ connections: [], otherContacts: [] }), { status: 200 });
  }
  if (url.includes("/calendar/v3/calendars") && !url.includes("/events")) {
    return new Response(JSON.stringify({ id: "mirror-cal", summary: "Nuvo" }), { status: 200 });
  }
  return new Response("not mocked", { status: 404 });
});

const env: Env = {
  BETTER_AUTH_SECRET: "access-http-secret-32-bytes-long!!",
  BETTER_AUTH_URL: "http://localhost:8787",
  ENVIRONMENT: "preview",
  CRON_SECRET: "cron-secret",
  TOKEN_ENC_KEY_V1: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
  GOOGLE_CLIENT_ID: "test-google-client",
  GOOGLE_CLIENT_SECRET: "test-google-secret",
  APP_URL: "http://localhost:5717",
};

async function call(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> | string }> {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  const res = await app.request(path, { ...init, headers }, env);
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { status: res.status, body: text };
  }
}

function auth(user: "a" | "b" | "none", extra: RequestInit = {}): RequestInit {
  const headers = new Headers(extra.headers);
  if (user !== "none") headers.set("authorization", `Bearer user-${user}`);
  return { ...extra, headers };
}

const unauthEvents = await call("/functions/v1/google-events", {
  method: "POST",
  ...auth("none"),
  body: JSON.stringify({ eventId: EVENT_A, action: "delete" }),
});
ok(unauthEvents.status === 401, "unauthenticated google-events is 401");

const unauthRefresh = await call("/functions/v1/calendar-refresh", {
  method: "POST",
  ...auth("none"),
  body: JSON.stringify({}),
});
ok(unauthRefresh.status === 401, "unauthenticated calendar-refresh is 401");

const unauthSync = await call("/functions/v1/google-sync", {
  method: "POST",
  ...auth("none"),
  body: JSON.stringify({ accountId: ACCOUNT_A }),
});
ok(unauthSync.status === 401, "unauthenticated google-sync is 401");

const unauthOauth = await call("/functions/v1/google-oauth?action=start&token=", { method: "GET" });
ok(unauthOauth.status === 401, "unauthenticated google-oauth start is 401");

const unauthCron = await call("/api/cron/google-renew", { method: "POST" });
ok(unauthCron.status === 401, "cron without secret is 401");

const bDeleteA = await call("/functions/v1/google-events", {
  method: "POST",
  ...auth("b"),
  body: JSON.stringify({ eventId: EVENT_A, action: "delete" }),
});
const bDeleteUnknown = await call("/functions/v1/google-events", {
  method: "POST",
  ...auth("b"),
  body: JSON.stringify({ eventId: UNKNOWN, action: "delete" }),
});
ok(bDeleteA.status === 404, "B delete A's event is 404 (no existence oracle)");
ok(bDeleteUnknown.status === 404, "B delete unknown event is 404");
ok(
  JSON.stringify(bDeleteA.body) === JSON.stringify(bDeleteUnknown.body),
  "B delete A vs unknown: same body (no existence oracle)",
);

const bRsvpA = await call("/functions/v1/google-events", {
  method: "POST",
  ...auth("b"),
  body: JSON.stringify({ eventId: EVENT_A, action: "rsvp", responseStatus: "accepted" }),
});
ok(bRsvpA.status === 404, "B RSVP A's event is 404");

const bCreateOnA = await call("/functions/v1/google-events", {
  method: "POST",
  ...auth("b"),
  body: JSON.stringify({
    action: "create",
    accountId: ACCOUNT_A,
    title: "planted",
    start_at: "2026-10-26T19:00:00Z",
    end_at: "2026-10-26T20:00:00Z",
  }),
});
ok(bCreateOnA.status === 400 || bCreateOnA.status === 404, "B create on A's account is 400/404");
const bCreateUnknown = await call("/functions/v1/google-events", {
  method: "POST",
  ...auth("b"),
  body: JSON.stringify({
    action: "create",
    accountId: UNKNOWN,
    title: "planted",
    start_at: "2026-10-26T19:00:00Z",
    end_at: "2026-10-26T20:00:00Z",
  }),
});
ok(
  bCreateOnA.status === bCreateUnknown.status &&
    JSON.stringify(bCreateOnA.body) === JSON.stringify(bCreateUnknown.body),
  "B create A vs unknown: same status/body (no existence oracle)",
);
ok(
  !JSON.stringify(bCreateOnA.body).toLowerCase().includes("a private") &&
    !JSON.stringify(bCreateOnA.body).includes(ACCOUNT_A),
  "B create on A's account does not leak A's event title or id",
);

const stillB = await db.query<{ n: number }>(
  "SELECT count(*)::int AS n FROM external_events WHERE id = $1",
  [EVENT_B],
);
const stillA = await db.query<{ title: string }>("SELECT title FROM external_events WHERE id = $1", [EVENT_A]);
ok(Number(stillB.rows[0]?.n ?? 0) === 1, "B event still present after A's-id POSTs");
ok(stillA.rows[0]?.title === "A private event", "A event title unchanged after B POSTs");

const bSyncA = await call("/functions/v1/google-sync", {
  method: "POST",
  ...auth("b"),
  body: JSON.stringify({ mode: "incremental", accountId: ACCOUNT_A }),
});
const bSyncUnknown = await call("/functions/v1/google-sync", {
  method: "POST",
  ...auth("b"),
  body: JSON.stringify({ mode: "incremental", accountId: UNKNOWN }),
});
ok(bSyncA.status === 404, "B sync A's account is 404");
ok(
  bSyncA.status === bSyncUnknown.status && JSON.stringify(bSyncA.body) === JSON.stringify(bSyncUnknown.body),
  "B sync A vs unknown: same body (no existence oracle)",
);

const bContactsA = await call("/functions/v1/google-contacts", {
  method: "POST",
  ...auth("b"),
  body: JSON.stringify({ accountId: ACCOUNT_A }),
});
ok(bContactsA.status === 404, "B contacts A's account is 404");

const bRefreshA = await call("/functions/v1/calendar-refresh", {
  method: "POST",
  ...auth("b"),
  body: JSON.stringify({ accountId: ACCOUNT_A }),
});
ok(bRefreshA.status === 404, "B calendar-refresh A's account is 404");

const aRefresh = await call("/functions/v1/calendar-refresh", {
  method: "POST",
  ...auth("a"),
  body: JSON.stringify({}),
});
ok(aRefresh.status === 200, `A calendar-refresh own is 200 (got ${aRefresh.status})`);
ok((aRefresh.body as { synced?: number }).synced === 1, "A calendar-refresh synced own Google account");

const aSync = await call("/api/google-sync", {
  method: "POST",
  ...auth("a"),
  body: JSON.stringify({ mode: "incremental", accountId: ACCOUNT_A }),
});
ok(aSync.status === 200, "A google-sync own is 200");

const webhookBad = await call("/functions/v1/google-webhook", {
  method: "POST",
  headers: {
    "X-Goog-Channel-ID": "ch-a",
    "X-Goog-Resource-State": "exists",
    "X-Goog-Channel-Token": `${ACCOUNT_B}:cal-a@group.calendar.google.com`,
  },
});
ok(webhookBad.status === 404, "webhook with mismatched account/channel is 404");

const webhookSync = await call("/functions/v1/google-webhook", {
  method: "POST",
  headers: { "X-Goog-Channel-ID": "ch-a", "X-Goog-Resource-State": "sync" },
});
ok(webhookSync.status === 200, "webhook sync handshake is 200");

const cronOk = await call("/api/cron/google-renew", {
  method: "POST",
  headers: { authorization: "Bearer cron-secret" },
});
ok(cronOk.status === 200, `cron google-renew with secret is 200 (got ${cronOk.status})`);

const dispatch = await call("/api/cron/calendar-dispatch", {
  method: "POST",
  headers: { authorization: "Bearer cron-secret" },
});
ok(dispatch.status === 200, "cron calendar-dispatch with secret is 200");

const resub = await call("/api/cron/google-resubscribe", {
  method: "POST",
  headers: { authorization: "Bearer cron-secret" },
});
ok(resub.status === 200, "cron google-resubscribe (flip tooling) is 200");

restoreFetch();

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("googleHttp isolation: ok");
