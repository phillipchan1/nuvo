// ICS fetch bounds, SSRF, iCloud URL pin, reconnect policy.
// Run: node --experimental-strip-types worker/src/calendarGuard.check.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { applyIsolationSchema } from "./isolationDb.ts";
import { makePgliteSql } from "./pgliteSql.ts";
import { installRequestIoForTests } from "./requestIo.ts";
import { installOutboundFetchForTests } from "./lib/outboundFetch.ts";
import {
  assertPublicFeedUrl,
  fetchIcsFeed,
  ICS_MAX_BYTES,
  installDnsLookupForTests,
  installIcsDeadlineForTests,
  installIcsFetchTimeoutForTests,
  isBlockedHost,
} from "./lib/ssrf.ts";
import { deleteEvent, isIcloudDavUrl, putEvent } from "./lib/caldav.ts";
import { discoverAddressBooks, fetchContacts } from "./lib/carddav.ts";
import { handleIcloudEvents, pickVisibleCalendar } from "./calendar/icloudEvents.ts";
import { runIcsSync } from "./calendar/icsFeed.ts";
import { runM365Sync } from "./calendar/m365.ts";
import { sealAccountSecret } from "./calendar/store.ts";
import { MS_TOKEN_URL } from "./lib/ms.ts";
import { bootstrapUser, makeStore } from "./store.ts";
import app from "./index.ts";
import type { Env } from "./env.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const here = dirname(fileURLToPath(import.meta.url));
const A = "11111111-1111-1111-1111-111111111111";
const M365_A = "aaaaaaaa-eeee-4000-8000-000000000011";
const ICLOUD_A = "aaaaaaaa-eeee-4000-8000-000000000012";
const ICS_A = "aaaaaaaa-eeee-4000-8000-000000000013";

const ssrfSrc = readFileSync(join(here, "lib/ssrf.ts"), "utf8");
const caldavSrc = readFileSync(join(here, "lib/caldav.ts"), "utf8");
const carddavSrc = readFileSync(join(here, "lib/carddav.ts"), "utf8");
const msSrc = readFileSync(join(here, "lib/ms.ts"), "utf8");
const m365Src = readFileSync(join(here, "calendar/m365.ts"), "utf8");
ok(ssrfSrc.includes('redirect: "manual"'), "ICS fetch uses redirect:manual");
ok(ssrfSrc.includes("AbortSignal.timeout"), "ICS fetch uses AbortSignal.timeout");
ok(ssrfSrc.includes("ICS_MAX_BYTES"), "ICS fetch caps the body");
ok(ssrfSrc.includes("ICS_MAX_REDIRECTS"), "ICS fetch caps redirects");
ok(!/put event failed: HTTP \$\{res\.status\} \$\{await res\.text\(\)\}/.test(caldavSrc), "caldav put error omits response body");
ok(/hostname !== "graph\.microsoft\.com"/.test(m365Src), "m365 pins @odata.nextLink to graph.microsoft.com");
ok(caldavSrc.includes("isIcloudDavUrl"), "caldav pins request URLs to *.icloud.com");
ok(carddavSrc.includes("icloudDavFetch") && carddavSrc.includes("isIcloudDavUrl"), "carddav uses the shared icloud pin");
ok(!/await fetch\(/.test(carddavSrc), "carddav dav does not call plain fetch");
ok(/reconnect/.test(msSrc) && /invalid_grant/.test(msSrc), "m365 reconnects only on invalid_grant / 401 / 403");
ok(ssrfSrc.includes("ICS_DEADLINE_MS"), "ICS fetch has an overall deadline");

const SSRF_URLS = [
  ["https://[::ffff:127.0.0.1]/feed.ics", "IPv4-mapped loopback"],
  ["https://[::ffff:169.254.169.254]/feed.ics", "IPv4-mapped link-local"],
  ["https://[fd00::1]/feed.ics", "fd00::/7 ULA"],
  ["https://[fe80::1]/feed.ics", "fe80::/10 link-local"],
  ["https://[::]/feed.ics", "unspecified ::"],
  ["https://100.64.0.1/feed.ics", "CGNAT 100.64.0.0/10"],
  ["https://100.127.255.254/feed.ics", "CGNAT top of 100.64.0.0/10"],
  ["https://198.18.0.1/feed.ics", "benchmark 198.18.0.0/15"],
  ["https://198.19.255.254/feed.ics", "benchmark top of 198.18.0.0/15"],
  ["https://localhost./feed.ics", "localhost with trailing dot"],
  ["https://localhost/feed.ics", "localhost"],
  ["https://127.0.0.1/feed.ics", "loopback v4"],
  ["https://10.1.2.3/feed.ics", "10/8"],
  ["https://192.168.1.1/feed.ics", "192.168/16"],
  ["https://169.254.169.254/feed.ics", "link-local metadata"],
  ["https://172.16.0.1/feed.ics", "172.16/12"],
  ["https://[::7f00:1]/feed.ics", "IPv4-compatible loopback"],
  ["https://[64:ff9b::a00:1]/feed.ics", "NAT64 64:ff9b::/96 embedding 10.0.0.1"],
  ["https://[2002:a00:1::]/feed.ics", "6to4 2002::/16 embedding 10.0.0.1"],
  ["https://[ff02::1]/feed.ics", "IPv6 multicast"],
  ["https://224.0.0.1/feed.ics", "IPv4 multicast"],
  ["https://255.255.255.255/feed.ics", "IPv4 broadcast"],
  ["https://192.0.0.7/feed.ics", "192.0.0.0/24"],
];

for (const [url, label] of SSRF_URLS) {
  const host = new URL(url).hostname;
  ok(isBlockedHost(host), `isBlockedHost: ${label}`);
  const out = await assertPublicFeedUrl(url);
  ok(!out.ok, `assertPublicFeedUrl blocks ${label}`);
}

{
  const restore = installDnsLookupForTests(async () => ["127.0.0.1"]);
  const out = await assertPublicFeedUrl("https://evil.example.test/feed.ics");
  ok(!out.ok, "hostname that resolves to loopback is blocked");
  restore();
}
{
  const restore = installDnsLookupForTests(async () => ["::ffff:169.254.169.254"]);
  const out = await assertPublicFeedUrl("https://meta.example.test/feed.ics");
  ok(!out.ok, "hostname that resolves to IPv4-mapped link-local is blocked");
  restore();
}
{
  const restore = installDnsLookupForTests(async () => ["8.8.8.8", "10.0.0.1"]);
  const out = await assertPublicFeedUrl("https://mixed.example.test/feed.ics");
  ok(!out.ok, "hostname with any private DNS answer is blocked");
  restore();
}
{
  const restore = installDnsLookupForTests(async () => {
    throw new Error("servfail");
  });
  const out = await assertPublicFeedUrl("https://down.example.test/feed.ics");
  ok(!out.ok, "DNS failure is fail-closed");
  restore();
}
{
  const restore = installDnsLookupForTests(async () => []);
  const out = await assertPublicFeedUrl("https://empty.example.test/feed.ics");
  ok(!out.ok, "empty DNS answer is fail-closed");
  restore();
}
{
  const restore = installDnsLookupForTests(async () => ["203.0.113.10"]);
  const out = await assertPublicFeedUrl("https://cal.example.test/feed.ics");
  ok(out.ok && out.url.startsWith("https://cal.example.test/"), "public hostname with public DNS is allowed");
  const on443 = await assertPublicFeedUrl("https://cal.example.test:443/feed.ics");
  ok(on443.ok, "ICS allows explicit port 443");
  const otherPort = await assertPublicFeedUrl("https://cal.example.test:8443/feed.ics");
  ok(!otherPort.ok, "ICS rejects a non-443 port");
  restore();
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

{
  const restoreDns = installDnsLookupForTests(async () => ["203.0.113.10"]);
  const seen: string[] = [];
  const restoreFetch = installOutboundFetchForTests(async (input) => {
    const url = urlOf(input);
    seen.push(url);
    return new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/stolen.ics" } });
  });
  const out = await fetchIcsFeed("https://cal.example.test/feed.ics");
  ok(!out.ok, "redirect to a private host is blocked");
  ok(seen.length === 1, "private redirect is not fetched");
  ok(!seen.some((u) => u.includes("127.0.0.1")), "no request is sent to the private hop");
  restoreFetch();
  restoreDns();
}

{
  const restoreDns = installDnsLookupForTests(async () => ["203.0.113.10"]);
  let fetches = 0;
  const restoreFetch = installOutboundFetchForTests(async (input) => {
    fetches += 1;
    const url = new URL(urlOf(input));
    return new Response(null, {
      status: 302,
      headers: { Location: `https://cal.example.test/hop-${fetches}` },
    });
  });
  const out = await fetchIcsFeed("https://cal.example.test/start.ics");
  ok(!out.ok, "hop cap rejects a redirect chain");
  ok(out.ok === false && out.error === "too many redirects", "hop cap error is too many redirects");
  ok(fetches === 4, `hop cap fetches original + 3 hops (got ${fetches})`);
  restoreFetch();
  restoreDns();
}

{
  const restoreDns = installDnsLookupForTests(async () => ["203.0.113.10"]);
  const restoreTimeout = installIcsFetchTimeoutForTests(30);
  let sawSignal = false;
  const restoreFetch = installOutboundFetchForTests((_input, init) => {
    return new Promise<Response>((_, reject) => {
      const abort = () => reject(Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" }));
      const signal = init?.signal;
      sawSignal = Boolean(signal);
      if (!signal || signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      setTimeout(abort, 150);
    });
  });
  const out = await fetchIcsFeed("https://cal.example.test/slow.ics");
  ok(sawSignal, "ICS fetch passes an abort signal");
  ok(!out.ok && out.error === "feed fetch timed out", "timeout is a bounded failure");
  restoreFetch();
  restoreTimeout();
  restoreDns();
}

{
  const restoreDns = installDnsLookupForTests(async () => ["203.0.113.10"]);
  const restoreFetch = installOutboundFetchForTests(async () => {
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = new Uint8Array(64 * 1024);
        sent += chunk.byteLength;
        controller.enqueue(chunk);
        if (sent > ICS_MAX_BYTES + 1024) controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/calendar" } });
  });
  const out = await fetchIcsFeed("https://cal.example.test/huge.ics");
  ok(!out.ok && out.error === "feed too large", "size cap aborts an oversized stream");
  restoreFetch();
  restoreDns();
}

{
  const restoreDns = installDnsLookupForTests(async () => ["203.0.113.10"]);
  const restoreFetch = installOutboundFetchForTests(async () => {
    return new Response(null, { status: 302, headers: { Location: "http://[" } });
  });
  let threw = false;
  let out: Awaited<ReturnType<typeof fetchIcsFeed>> | null = null;
  try {
    out = await fetchIcsFeed("https://cal.example.test/redir.ics");
  } catch {
    threw = true;
  }
  ok(!threw && out && !out.ok && out.error === "feed fetch failed", "malformed Location is a normal fetch failure");
  restoreFetch();
  restoreDns();
}

{
  const restoreDns = installDnsLookupForTests(async () => ["203.0.113.10"]);
  const restoreHop = installIcsFetchTimeoutForTests(40);
  const restoreDeadline = installIcsDeadlineForTests(40);
  const restoreFetch = installOutboundFetchForTests(async () => {
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        controller.enqueue(new Uint8Array([1]));
        await new Promise((resolve) => setTimeout(resolve, 80));
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/calendar" } });
  });
  const out = await fetchIcsFeed("https://cal.example.test/drip.ics");
  ok(!out.ok && out.error === "feed fetch timed out", "slow-drip abort is a timeout, not too large");
  restoreFetch();
  restoreDeadline();
  restoreHop();
  restoreDns();
}

ok(isIcloudDavUrl("https://caldav.icloud.com/"), "caldav.icloud.com is allowed");
ok(isIcloudDavUrl("https://p12-caldav.icloud.com/123/"), "shard host is allowed");
ok(!isIcloudDavUrl("https://evil.example/cal"), "non-icloud URL is rejected");
ok(!isIcloudDavUrl("http://caldav.icloud.com/"), "non-https icloud URL is rejected");
ok(!isIcloudDavUrl("https://icloud.com.evil.example/"), "suffix spoof is rejected");

{
  const calls: { url: string; auth: boolean }[] = [];
  const restoreFetch = installOutboundFetchForTests(async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: urlOf(input), auth: headers.has("Authorization") });
    return new Response("nope", { status: 201 });
  });
  let threw = false;
  try {
    await putEvent("https://evil.example/x.ics", "BEGIN:VCALENDAR", "user", "pass");
  } catch (e) {
    threw = /non-icloud/.test(e instanceof Error ? e.message : String(e));
  }
  ok(threw, "putEvent rejects a non-icloud URL");
  ok(calls.length === 0, "putEvent sends no request to a non-icloud URL");
  restoreFetch();
}

{
  const calls: { url: string; auth: boolean }[] = [];
  const restoreFetch = installOutboundFetchForTests(async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: urlOf(input), auth: headers.has("Authorization") });
    return new Response(null, { status: 302, headers: { Location: "https://evil.example/steal" } });
  });
  let threw = false;
  try {
    await putEvent("https://caldav.icloud.com/cal/x.ics", "BEGIN:VCALENDAR", "user", "pass");
  } catch (e) {
    threw = /non-icloud/.test(e instanceof Error ? e.message : String(e));
  }
  ok(threw, "putEvent rejects a non-icloud redirect");
  ok(calls.length === 1 && calls[0].url.startsWith("https://caldav.icloud.com/"), "only the icloud hop is fetched");
  ok(!calls.some((c) => c.url.includes("evil.example")), "auth is not sent to the non-icloud redirect");
  restoreFetch();
}

{
  const calls: { url: string; auth: boolean }[] = [];
  const restoreFetch = installOutboundFetchForTests(async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: urlOf(input), auth: headers.has("Authorization") });
    return new Response(null, { status: 302, headers: { Location: "https://attacker.test/x" } });
  });
  let threw = false;
  try {
    await deleteEvent("https://p42-caldav.icloud.com/cal/x.ics", "user", "pass");
  } catch (e) {
    threw = /non-icloud/.test(e instanceof Error ? e.message : String(e));
  }
  ok(threw, "deleteEvent rejects a non-icloud redirect");
  ok(!calls.some((c) => c.url.includes("attacker.test") && c.auth), "deleteEvent does not send Basic auth off-host");
  restoreFetch();
}

{
  const calls: { url: string; auth: boolean }[] = [];
  const restoreFetch = installOutboundFetchForTests(async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: urlOf(input), auth: headers.has("Authorization") });
    return new Response("nope", { status: 207 });
  });
  let threw = false;
  try {
    await fetchContacts("https://evil.example/book/", "user", "pass");
  } catch (e) {
    threw = /non-icloud/.test(e instanceof Error ? e.message : String(e));
  }
  ok(threw, "CardDAV rejects an off-host href");
  ok(calls.length === 0, "CardDAV sends no request for an off-host href");
  restoreFetch();
}

{
  const calls: { url: string; auth: boolean }[] = [];
  const restoreFetch = installOutboundFetchForTests(async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: urlOf(input), auth: headers.has("Authorization") });
    return new Response(null, { status: 301, headers: { Location: "https://evil.example/steal" } });
  });
  let threw = false;
  try {
    await discoverAddressBooks("user", "pass");
  } catch (e) {
    threw = /non-icloud/.test(e instanceof Error ? e.message : String(e));
  }
  ok(threw, "CardDAV rejects an off-host 301");
  ok(calls.every((c) => c.url.includes("icloud.com")), "CardDAV only fetches an icloud hop");
  ok(!calls.some((c) => c.url.includes("evil.example") && c.auth), "CardDAV off-host 301 sends no auth");
  restoreFetch();
}

const visible = pickVisibleCalendar(
  { calendars: [{ id: "https://caldav.icloud.com/own/", summary: "Own" }] } as never,
  new Set(),
  "https://evil.example/cal",
);
ok(visible === null, "pickVisibleCalendar rejects a calendarId outside account.calendars");
ok(
  pickVisibleCalendar(
    { calendars: [{ id: "https://caldav.icloud.com/own/" }] } as never,
    new Set(),
    "https://caldav.icloud.com/own/",
  ) === "https://caldav.icloud.com/own/",
  "pickVisibleCalendar accepts a visible calendarId",
);

const env: Env = {
  BETTER_AUTH_SECRET: "access-http-secret-32-bytes-long!!",
  BETTER_AUTH_URL: "http://localhost:8787",
  ENVIRONMENT: "preview",
  CRON_SECRET: "cron-secret",
  TOKEN_ENC_KEY_V1: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
  APP_URL: "http://localhost:5717",
  CUTOVER_FLIPPED: "1",
};

const db = new PGlite();
await applyIsolationSchema(db);
const sql = makePgliteSql(db);
installRequestIoForTests(() => ({
  sql,
  auth: {
    api: {
      async getSession({ headers }: { headers: Headers }) {
        return headers.get("authorization") === "Bearer user-a"
          ? { user: { id: A, email: "a@example.test", emailVerified: true } }
          : null;
      },
    },
    handler: async () => new Response("not used"),
  } as never,
  close: async () => undefined,
}));

const store = makeStore(sql, A);
await bootstrapUser(store, null, { emailVerified: true });
const created = await handleIcloudEvents(store, env, {
  action: "create",
  title: "x",
  start_at: "2026-10-27T17:00:00Z",
  end_at: "2026-10-27T18:00:00Z",
  calendarId: "https://evil.example/cal",
  accountId: ICLOUD_A,
});
ok(created.status === 400, "create with a foreign calendarId is 4xx");
ok(created.body.error === "calendar not visible", "create foreign calendarId uses a generic code");

const httpCreate = await app.request(
  "/functions/v1/icloud-events",
  {
    method: "POST",
    headers: { authorization: "Bearer user-a", "content-type": "application/json" },
    body: JSON.stringify({
      action: "create",
      title: "x",
      start_at: "2026-10-27T17:00:00Z",
      end_at: "2026-10-27T18:00:00Z",
      calendarId: "https://attacker.test/cal",
      accountId: ICLOUD_A,
    }),
  },
  env,
);
const httpBody = (await httpCreate.json()) as { error?: string };
ok(httpCreate.status === 400, "HTTP create with a foreign calendarId is 400");
ok(httpBody.error === "bad_request", "HTTP create foreign calendarId body is generic bad_request");

await sealAccountSecret(sql, ICS_A, A, env, "https://cal.example.test/huge.ics");
const before = await db.query<{ sync_failures: number; next_sync_at: string | null; needs_reconnect: boolean }>(
  "SELECT sync_failures, next_sync_at, needs_reconnect FROM calendar_accounts WHERE id = $1",
  [ICS_A],
);
const restoreDns = installDnsLookupForTests(async () => ["203.0.113.10"]);
const restoreFetch = installOutboundFetchForTests(async () => {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = new Uint8Array(64 * 1024);
      sent += chunk.byteLength;
      controller.enqueue(chunk);
      if (sent > ICS_MAX_BYTES + 1024) controller.close();
    },
  });
  return new Response(stream, { status: 200 });
});
const synced = await runIcsSync(sql, env, { accountId: ICS_A, userId: A });
ok(synced.ok === true, "size-cap failure does not kill the ICS batch");
const after = await db.query<{ sync_failures: number; next_sync_at: string | Date | null; needs_reconnect: boolean }>(
  "SELECT sync_failures, next_sync_at, needs_reconnect FROM calendar_accounts WHERE id = $1",
  [ICS_A],
);
const nextAt = after.rows[0]?.next_sync_at ? new Date(after.rows[0].next_sync_at).getTime() : 0;
ok(
  Number(after.rows[0]?.sync_failures ?? 0) > Number(before.rows[0]?.sync_failures ?? 0),
  "size cap marks the account failed (sync_failures++)",
);
ok(nextAt > Date.now(), "size cap moves next_sync_at forward");
ok(after.rows[0]?.needs_reconnect !== true, "size cap does not mark needs_reconnect");
restoreFetch();
restoreDns();

await db.query("UPDATE calendar_accounts SET needs_reconnect = true, sync_failures = 3 WHERE id = $1", [ICS_A]);
let skippedFetches = 0;
const restoreSkipFetch = installOutboundFetchForTests(async () => {
  skippedFetches += 1;
  return new Response("nope", { status: 500 });
});
const skipped = await runIcsSync(sql, env);
ok(skipped.ok === true, "cron ICS sync returns ok while skipping reconnect");
ok(skippedFetches === 0, "cron skips needs-reconnect ICS accounts");
const skippedRow = await db.query<{ sync_failures: number }>(
  "SELECT sync_failures FROM calendar_accounts WHERE id = $1",
  [ICS_A],
);
ok(Number(skippedRow.rows[0]?.sync_failures) === 3, "skipped reconnect account keeps sync_failures");
restoreSkipFetch();

await db.query("UPDATE calendar_accounts SET needs_reconnect = false WHERE id = $1", [ICS_A]);
const restore5xxDns = installDnsLookupForTests(async () => ["203.0.113.10"]);
const restore5xx = installOutboundFetchForTests(async () => new Response("down", { status: 503 }));
await runIcsSync(sql, env, { accountId: ICS_A, userId: A });
const after5xx = await db.query<{ needs_reconnect: boolean }>(
  "SELECT needs_reconnect FROM calendar_accounts WHERE id = $1",
  [ICS_A],
);
ok(after5xx.rows[0]?.needs_reconnect !== true, "transient 5xx does not mark needs_reconnect");
restore5xx();
restore5xxDns();

const restore401Dns = installDnsLookupForTests(async () => ["203.0.113.10"]);
const restore401 = installOutboundFetchForTests(async () => new Response("no", { status: 401 }));
await runIcsSync(sql, env, { accountId: ICS_A, userId: A });
const after401 = await db.query<{ needs_reconnect: boolean }>(
  "SELECT needs_reconnect FROM calendar_accounts WHERE id = $1",
  [ICS_A],
);
ok(after401.rows[0]?.needs_reconnect === true, "HTTP 401 marks needs_reconnect");
restore401();
restore401Dns();

await sealAccountSecret(sql, M365_A, A, env, "m365-refresh-token-value-xxxxx");
const m365Env: Env = { ...env, MS_CLIENT_ID: "test-ms-client", MS_CLIENT_SECRET: "test-ms-secret" };

async function m365RefreshCase(
  label: string,
  spec: {
    status?: number;
    body?: string;
    network?: boolean;
    env?: Env;
    reconnect: boolean;
  },
): Promise<void> {
  await db.query(
    "UPDATE calendar_accounts SET needs_reconnect = false, sync_failures = 0, next_sync_at = NULL WHERE id = $1",
    [M365_A],
  );
  const restore = installOutboundFetchForTests(async (input) => {
    if (urlOf(input) !== MS_TOKEN_URL && !urlOf(input).startsWith(MS_TOKEN_URL)) {
      return new Response("not token", { status: 404 });
    }
    if (spec.network) throw new TypeError("network down");
    return new Response(spec.body ?? "", {
      status: spec.status ?? 500,
      headers: { "content-type": "application/json" },
    });
  });
  const before = await db.query<{ sync_failures: number }>(
    "SELECT sync_failures FROM calendar_accounts WHERE id = $1",
    [M365_A],
  );
  await runM365Sync(sql, spec.env ?? m365Env, { accountId: M365_A, userId: A });
  const after = await db.query<{
    sync_failures: number;
    next_sync_at: string | Date | null;
    needs_reconnect: boolean;
  }>("SELECT sync_failures, next_sync_at, needs_reconnect FROM calendar_accounts WHERE id = $1", [M365_A]);
  const nextAt = after.rows[0]?.next_sync_at ? new Date(after.rows[0].next_sync_at).getTime() : 0;
  ok(
    Number(after.rows[0]?.sync_failures ?? 0) > Number(before.rows[0]?.sync_failures ?? 0),
    `${label}: increments sync_failures`,
  );
  ok(nextAt > Date.now(), `${label}: moves next_sync_at`);
  ok(Boolean(after.rows[0]?.needs_reconnect) === spec.reconnect, `${label}: needs_reconnect=${spec.reconnect}`);
  restore();
}

await m365RefreshCase("400 invalid_grant", {
  status: 400,
  body: JSON.stringify({ error: "invalid_grant" }),
  reconnect: true,
});
await m365RefreshCase("401", { status: 401, body: "{}", reconnect: true });
await m365RefreshCase("403", { status: 403, body: "{}", reconnect: true });
await m365RefreshCase("5xx", { status: 503, body: "{}", reconnect: false });
await m365RefreshCase("429", { status: 429, body: "{}", reconnect: false });
await m365RefreshCase("network", { network: true, reconnect: false });
await m365RefreshCase("missing access_token", { status: 200, body: JSON.stringify({ expires_in: 3600 }), reconnect: false });
await m365RefreshCase("missing MS client", { env, reconnect: false });

await db.close();

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("calendarGuard: ok");
