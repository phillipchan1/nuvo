// HTTP A/B isolation for the Google Worker routes (PR B).
// Companion to accessHttp.check.ts (planner CRUD from #97).
// Run: node --experimental-strip-types worker/src/googleHttp.check.ts
import { PGlite } from "@electric-sql/pglite";
import { applyIsolationSchema } from "./isolationDb.ts";
import { makePgliteSql } from "./pgliteSql.ts";
import { installRequestIoForTests } from "./requestIo.ts";
import { installOutboundFetchForTests } from "./lib/outboundFetch.ts";
import { openToken, parseTokenKeyring, sealToken } from "./secrets.ts";
import { getAccessToken } from "./google/tokens.ts";
import { loadGoogleAccountById } from "./google/owned.ts";
import { runGoogleSync } from "./google/sync.ts";
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
  CUTOVER_FLIPPED: "1",
};

async function call(
  path: string,
  init: RequestInit = {},
  bindings: Env = env,
): Promise<{ status: number; body: Record<string, unknown> | string }> {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  const res = await app.request(path, { ...init, headers }, bindings);
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

const ringSetup = await parseTokenKeyring(env);
for (const row of [
  { id: ACCOUNT_A, userId: A, token: "ya29.a-access" },
  { id: ACCOUNT_B, userId: B, token: "ya29.b-access" },
]) {
  const sealedAccess = await sealToken(row.token, { table: "calendar_accounts", rowId: row.id, userId: row.userId }, ringSetup);
  await sql`
    UPDATE calendar_accounts
    SET access_token = NULL,
        access_token_enc = ${sealedAccess.ciphertext},
        access_token_iv = ${sealedAccess.iv},
        key_version = ${sealedAccess.keyVersion}
    WHERE id = ${row.id}
      AND user_id = ${row.userId}
  `;
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

const skipEnv: Env = { ...env, CUTOVER_FLIPPED: undefined };
for (const job of ["google-renew", "calendar-dispatch", "google-resubscribe"] as const) {
  const skipped = await call(`/api/cron/${job}`, {
    method: "POST",
    headers: { authorization: "Bearer cron-secret" },
  }, skipEnv);
  ok(skipped.status === 200, `cron ${job} before flip is 200 (got ${skipped.status})`);
  ok((skipped.body as { skipped?: boolean }).skipped === true, `cron ${job} before flip is skipped:true`);
  ok((skipped.body as { stay_on_supabase?: boolean }).stay_on_supabase === true, `cron ${job} before flip stays on supabase`);
}

const unknownFlip = await call("/api/cron/google-renew", {
  method: "POST",
  headers: { authorization: "Bearer cron-secret" },
}, { ...env, CUTOVER_FLIPPED: "maybe" });
ok((unknownFlip.body as { skipped?: boolean }).skipped === true, "cron google-renew unknown flip value is skipped");

const cronOk = await call("/api/cron/google-renew", {
  method: "POST",
  headers: { authorization: "Bearer cron-secret" },
});
ok(cronOk.status === 200, `cron google-renew with secret is 200 (got ${cronOk.status})`);
ok((cronOk.body as { skipped?: boolean }).skipped !== true, "cron google-renew after flip actually runs");

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

const frozenEnv: Env = { ...env, MAINTENANCE_WRITE_FREEZE: "1" };

const getSyncFrozen = await call("/functions/v1/google-sync", { method: "GET", ...auth("a") }, frozenEnv);
ok(getSyncFrozen.status === 200, `GET google-sync while frozen is 200 (got ${getSyncFrozen.status})`);
const statusBody = JSON.stringify(getSyncFrozen.body);
ok(!statusBody.includes("ya29"), "GET google-sync status does not leak access tokens");
ok(!statusBody.includes("access_token"), "GET google-sync status omits access_token");
ok((getSyncFrozen.body as { ok?: boolean }).ok === true, "GET google-sync status is ok");

await db.query(
  `INSERT INTO external_events (id, user_id, account_id, provider_event_id, calendar_id, title, start_at, end_at, all_day, busy)
   VALUES ($1, $2, $3, 'evt-a-1', 'cal-a@group.calendar.google.com', 'A private event', '2026-10-26T17:00:00Z', '2026-10-26T18:00:00Z', false, true)
   ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, account_id = EXCLUDED.account_id`,
  [EVENT_A, A, ACCOUNT_A],
);

const getEventsFrozen = await call("/functions/v1/google-events", { method: "GET", ...auth("a") }, frozenEnv);
ok(getEventsFrozen.status === 200, `GET google-events while frozen is 200 (got ${getEventsFrozen.status})`);
const listed = (getEventsFrozen.body as { events?: Array<{ id?: string; title?: string; raw?: unknown }> }).events ?? [];
ok(listed.some((e) => e.id === EVENT_A && e.title === "A private event"), "GET google-events lists own events while frozen");
ok(listed.every((e) => e.raw == null), "GET google-events does not return raw payloads");
ok(!listed.some((e) => e.id === EVENT_B), "GET google-events while frozen does not list B's events");

const getRefreshFrozen = await call("/functions/v1/calendar-refresh", { method: "GET", ...auth("a") }, frozenEnv);
ok(getRefreshFrozen.status === 200, "GET calendar-refresh while frozen is 200");

const postSyncFrozen = await call(
  "/functions/v1/google-sync",
  { method: "POST", ...auth("a"), body: JSON.stringify({ mode: "incremental", accountId: ACCOUNT_A }) },
  frozenEnv,
);
ok(postSyncFrozen.status === 503, `POST google-sync while frozen is 503 (got ${postSyncFrozen.status})`);

const postEventsFrozen = await call(
  "/functions/v1/google-events",
  { method: "POST", ...auth("a"), body: JSON.stringify({ eventId: EVENT_A, action: "delete" }) },
  frozenEnv,
);
ok(postEventsFrozen.status === 503, "POST google-events while frozen is 503");

const oauthStartFrozen = await call("/functions/v1/google-oauth?action=start", { method: "GET", ...auth("a") }, frozenEnv);
ok(oauthStartFrozen.status === 302 || oauthStartFrozen.status === 200, `GET oauth start while frozen is not 503 (got ${oauthStartFrozen.status})`);

const oauthCbFrozen = await call("/functions/v1/google-oauth?code=x&state=y", { method: "GET" }, frozenEnv);
ok(oauthCbFrozen.status === 503, `GET oauth callback while frozen is 503 (got ${oauthCbFrozen.status})`);

const webhookFrozen = await call(
  "/functions/v1/google-webhook",
  { method: "POST", headers: { "X-Goog-Channel-ID": "ch-a", "X-Goog-Resource-State": "exists" } },
  frozenEnv,
);
ok(webhookFrozen.status === 503, "POST google-webhook while frozen is 503");

const ring = await parseTokenKeyring(env);
const aad = { table: "calendar_accounts" as const, rowId: ACCOUNT_A, userId: A };
const liveAccount = await loadGoogleAccountById(sql, ACCOUNT_A);
ok(Boolean(liveAccount?.access_token_enc && liveAccount.access_token_iv && liveAccount.key_version != null), "seed access token is sealed");
if (liveAccount?.access_token_enc && liveAccount.access_token_iv && liveAccount.key_version != null) {
  const liveSealed = {
    ciphertext: liveAccount.access_token_enc,
    iv: liveAccount.access_token_iv,
    keyVersion: liveAccount.key_version,
  };
  ok((await openToken(liveSealed, aad, ring)) === "ya29.a-access", "unseal access token for the owning row");
  let otherUser = false;
  try {
    await openToken(liveSealed, { ...aad, userId: B }, ring);
    otherUser = true;
  } catch {
    otherUser = false;
  }
  ok(!otherUser, "unseal fails for a different user");
  let otherRow = false;
  try {
    await openToken(liveSealed, { ...aad, rowId: ACCOUNT_B }, ring);
    otherRow = true;
  } catch {
    otherRow = false;
  }
  ok(!otherRow, "unseal fails for a different account row");
  const flipped = new Uint8Array(liveSealed.ciphertext);
  flipped[0] ^= 0xff;
  let cipherTamper = false;
  try {
    await openToken({ ...liveSealed, ciphertext: flipped }, aad, ring);
    cipherTamper = true;
  } catch {
    cipherTamper = false;
  }
  ok(!cipherTamper, "unseal fails after ciphertext tampering");
  let aadTamper = false;
  try {
    await openToken(liveSealed, { ...aad, table: "activity_sources" }, ring);
    aadTamper = true;
  } catch {
    aadTamper = false;
  }
  ok(!aadTamper, "unseal fails after AAD tampering");
  const unsealed = await getAccessToken(sql, env, liveAccount);
  ok(unsealed === "ya29.a-access", "getAccessToken unseals a live access token without refresh");
}

await db.query(
  `UPDATE calendar_accounts
   SET calendars = $1::jsonb
   WHERE id = $2`,
  [
    JSON.stringify([
      {
        id: "cal-a@group.calendar.google.com",
        summary: "A Cal",
        color: null,
        visible: true,
        channel_id: "ch-a",
        resource_id: "res-a",
      },
    ]),
    ACCOUNT_A,
  ],
);

const stops: Array<{ id?: string; resourceId?: string }> = [];
let listCalls = 0;
restoreFetch();
const restoreWatchFail = installOutboundFetchForTests(async (input, init) => {
  const url = String(input);
  if (url.includes("oauth2.googleapis.com/token")) {
    return new Response(JSON.stringify({ access_token: "ya29.refreshed", expires_in: 3600 }), { status: 200 });
  }
  if (url.includes("/channels/stop")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { id?: string; resourceId?: string };
    stops.push(body);
    return new Response("ok", { status: 200 });
  }
  if (url.includes("/events/watch")) {
    return new Response("watch disabled", { status: 403 });
  }
  if (url.includes("/calendars/") && url.includes("/events")) {
    listCalls += 1;
    return new Response(
      JSON.stringify({
        items: [
          {
            id: "evt-a-1",
            summary: "A private event",
            start: { dateTime: "2026-10-26T17:00:00Z" },
            end: { dateTime: "2026-10-26T18:00:00Z" },
          },
        ],
        nextSyncToken: "sync-poll",
      }),
      { status: 200 },
    );
  }
  return new Response("not mocked", { status: 404 });
});

await runGoogleSync(sql, env, { mode: "resubscribe", accountId: ACCOUNT_A, userId: A, reqUrl: "http://localhost:8787" });
await runGoogleSync(sql, env, { mode: "resubscribe", accountId: ACCOUNT_A, userId: A, reqUrl: "http://localhost:8787" });
ok(
  stops.some((s) => s.id === "ch-a" && s.resourceId === "res-a"),
  "watch failure stops the old channel",
);
ok(listCalls >= 1, "watch failure falls back to polling");
const polled = await db.query<{ n: number }>(
  "SELECT count(*)::int AS n FROM external_events WHERE account_id = $1 AND provider_event_id = $2",
  [ACCOUNT_A, "evt-a-1"],
);
ok(Number(polled.rows[0]?.n ?? 0) === 1, "poll fallback does not duplicate events");
const channelAfter = await db.query<{ calendars: unknown }>(
  "SELECT calendars FROM calendar_accounts WHERE id = $1",
  [ACCOUNT_A],
);
const cals = channelAfter.rows[0]?.calendars;
const calList = typeof cals === "string" ? JSON.parse(cals) as Array<{ channel_id?: string | null }> : (cals as Array<{ channel_id?: string | null }>);
ok(calList?.[0]?.channel_id == null, "failed watch clears the old channel id");

const refresh = "1//mock-google-refresh-token";
const sealed = await sealToken(refresh, aad, ring);
const opened = await openToken(sealed, aad, ring);
ok(opened === refresh && opened.startsWith("1//"), "sealed google refresh opens with row AAD");
let moved = false;
try {
  await openToken(sealed, { ...aad, userId: B }, ring);
  moved = true;
} catch {
  moved = false;
}
ok(!moved, "openToken refuses a moved AAD (other user)");
await sql`
  UPDATE calendar_accounts
  SET refresh_token_enc = ${sealed.ciphertext},
      refresh_token_iv = ${sealed.iv},
      key_version = ${sealed.keyVersion},
      access_token = NULL,
      access_token_enc = NULL,
      access_token_iv = NULL,
      access_token_expires_at = ${"2000-01-01T00:00:00Z"}
  WHERE id = ${ACCOUNT_A}
    AND user_id = ${A}
`;
const account = await loadGoogleAccountById(sql, ACCOUNT_A);
ok(Boolean(account), "seed google account loads for decrypt+refresh");
if (account) {
  const access = await getAccessToken(sql, env, account);
  ok(access === "ya29.refreshed", "mocked google refresh returns a new access token");
  const stored = await db.query<{ access_token: string | null }>(
    "SELECT access_token FROM calendar_accounts WHERE id = $1",
    [ACCOUNT_A],
  );
  ok(stored.rows[0]?.access_token == null, "saveAccessToken does not persist plaintext access_token");
}

restoreWatchFail();

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("googleHttp isolation: ok");
