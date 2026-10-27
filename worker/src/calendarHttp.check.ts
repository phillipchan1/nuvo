// HTTP A/B isolation for M365 / iCloud / ICS Worker routes (PR C).
// Companion to googleHttp.check.ts. Run: node --experimental-strip-types worker/src/calendarHttp.check.ts
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
const M365_A = "aaaaaaaa-eeee-4000-8000-000000000011";
const ICLOUD_A = "aaaaaaaa-eeee-4000-8000-000000000012";
const ICS_A = "aaaaaaaa-eeee-4000-8000-000000000013";
const EVENT_A = "aaaaaaaa-ffff-4000-8000-000000000001";
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

let ioOpened = 0;
installRequestIoForTests(() => {
  ioOpened += 1;
  return {
    sql,
    auth: fakeAuth as never,
    close: async () => undefined,
  };
});

const restoreFetch = installOutboundFetchForTests(async () => new Response("not mocked", { status: 404 }));

const env: Env = {
  BETTER_AUTH_SECRET: "access-http-secret-32-bytes-long!!",
  BETTER_AUTH_URL: "http://localhost:8787",
  ENVIRONMENT: "preview",
  CRON_SECRET: "cron-secret",
  TOKEN_ENC_KEY_V1: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
  MS_CLIENT_ID: "test-ms-client",
  MS_CLIENT_SECRET: "test-ms-secret",
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

for (const name of ["m365-sync", "icloud-sync", "icloud-contacts", "ics-sync", "icloud-connect", "ics-subscribe", "icloud-events"] as const) {
  const unauth = await call(`/functions/v1/${name}`, { method: "POST", ...auth("none"), body: JSON.stringify({}) });
  ok(unauth.status === 401, `unauthenticated ${name} is 401`);
}

const unauthOauth = await call("/functions/v1/m365-oauth?action=start", { method: "GET" });
ok(unauthOauth.status === 401, "unauthenticated m365-oauth start is 401");

for (const name of ["m365-sync", "icloud-sync", "icloud-contacts", "ics-sync"] as const) {
  const accountId = name.startsWith("icloud") ? ICLOUD_A : name.startsWith("ics") ? ICS_A : M365_A;
  const bOwned = await call(`/functions/v1/${name}`, {
    method: "POST",
    ...auth("b"),
    body: JSON.stringify({ accountId }),
  });
  const bUnknown = await call(`/functions/v1/${name}`, {
    method: "POST",
    ...auth("b"),
    body: JSON.stringify({ accountId: UNKNOWN }),
  });
  ok(bOwned.status === 404, `B ${name} A's account is 404`);
  ok(
    bOwned.status === bUnknown.status && JSON.stringify(bOwned.body) === JSON.stringify(bUnknown.body),
    `B ${name} A vs unknown: same body (no existence oracle)`,
  );
  ok(
    typeof bOwned.body === "object" && bOwned.body.error === "not found",
    `B ${name} body is generic not found`,
  );
}

const bEventA = await call("/functions/v1/icloud-events", {
  method: "POST",
  ...auth("b"),
  body: JSON.stringify({ eventId: EVENT_A, action: "delete" }),
});
const bEventUnknown = await call("/functions/v1/icloud-events", {
  method: "POST",
  ...auth("b"),
  body: JSON.stringify({ eventId: UNKNOWN, action: "delete" }),
});
ok(bEventA.status === 404, "B icloud-events A's event is 404");
ok(
  bEventA.status === bEventUnknown.status && JSON.stringify(bEventA.body) === JSON.stringify(bEventUnknown.body),
  "B icloud-events A vs unknown: same body (no existence oracle)",
);

const icsLocal = await call("/functions/v1/ics-subscribe", {
  method: "POST",
  ...auth("a"),
  body: JSON.stringify({ url: "https://localhost/feed.ics" }),
});
ok(icsLocal.status === 400, "ICS localhost subscribe is 400");
ok(
  typeof icsLocal.body === "object" && icsLocal.body.error === "bad_request",
  "ICS localhost body is generic bad_request",
);

const unflipped: Env = { ...env, CUTOVER_FLIPPED: undefined };
const openedBeforeSkip = ioOpened;
for (const name of ["m365-sync", "icloud-sync", "icloud-contacts", "ics-sync"] as const) {
  const skip = await call(
    `/functions/v1/${name}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
      body: JSON.stringify({}),
    },
    unflipped,
  );
  ok(skip.status === 200, `${name} cron bearer before flip: HTTP ${skip.status}`);
  ok(
    typeof skip.body === "object" &&
      skip.body.ok === true &&
      skip.body.skipped === true &&
      skip.body.reason === "cutover_not_flipped" &&
      skip.body.job === name,
    `${name} cron bearer before flip: skip body`,
  );
}
ok(ioOpened === openedBeforeSkip, "calendar cron-bearer skip before flip opens no SQL");

const cronHttp = await call(
  "/api/cron/m365-sync",
  { method: "POST", headers: { Authorization: `Bearer ${env.CRON_SECRET}` } },
  unflipped,
);
ok(cronHttp.status === 200 && typeof cronHttp.body === "object" && cronHttp.body.skipped === true, "handleCron m365-sync before flip skips");

restoreFetch();
await db.close();

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("calendarHttp: ok");
