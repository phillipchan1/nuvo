/**
 * Credentialed CORS via the live Hono app. Hono 4.13 copies old ACAO *
 * onto a newly assigned Response, so reflectAllowOrigin must run last.
 *
 * Run: node --experimental-strip-types worker/src/cors.check.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import app from "./index.ts";
import { needsCredentialedCors, reflectAllowOrigin } from "./cors.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const here = dirname(fileURLToPath(import.meta.url));
const corsSrc = readFileSync(join(here, "cors.ts"), "utf8");
ok(
  /export function reflectAllowOrigin\(res: Response, origin: string \| null \| undefined\): void/.test(corsSrc),
  "reflectAllowOrigin name and signature match #120",
);
ok(/res\.headers\.set\("Vary", "Origin"\)/.test(corsSrc), "reflectAllowOrigin always sets Vary: Origin");
ok(
  /res\.headers\.get\("Access-Control-Allow-Credentials"\) === "true"/.test(corsSrc),
  "reflectAllowOrigin never leaves * with credentials",
);

const indexSrc = readFileSync(join(here, "index.ts"), "utf8");
ok(/c\.res = withClonedHeaders\(c\.res, extra, replaceCors\)/.test(indexSrc), "middleware assigns c.res first");
ok(
  /reflectAllowOrigin\(c\.res, extra\["Access-Control-Allow-Origin"\]\)/.test(indexSrc),
  "reflectAllowOrigin runs after c.res assignment",
);

const CLIENT_ROUTES = [
  "/api/data/tasks",
  "/api/rpc/apply_patch",
  "/api/auth/ok",
  "/api/agent",
  "/api/mcp",
  "/api/capture",
  "/api/delete-account",
  "/api/apple-identity",
  "/api/github-activity",
  "/api/google-oauth",
  "/api/google-events",
  "/api/calendar-refresh",
  "/api/m365-oauth",
  "/api/icloud-connect",
  "/api/icloud-events",
  "/api/ics-subscribe",
  "/api/task-mirror",
  "/api/slot-mirror",
  "/api/route-events",
  "/api/rollover",
  "/api/day",
  "/functions/v1/agent",
  "/functions/v1/mcp",
  "/functions/v1/capture",
  "/functions/v1/delete-account",
  "/functions/v1/apple-identity",
  "/functions/v1/github-activity",
  "/functions/v1/google-oauth",
  "/functions/v1/google-events",
  "/functions/v1/calendar-refresh",
  "/functions/v1/m365-oauth",
  "/functions/v1/icloud-connect",
  "/functions/v1/icloud-events",
  "/functions/v1/ics-subscribe",
  "/functions/v1/task-mirror",
  "/functions/v1/slot-mirror",
  "/functions/v1/route-events",
  "/functions/v1/rollover",
  "/functions/v1/day",
];

for (const path of CLIENT_ROUTES) {
  ok(needsCredentialedCors(path), `${path} uses credentialed CORS`);
}

ok(!needsCredentialedCors("/api/entitlement"), "entitlement stays off the credentialed list");
ok(!needsCredentialedCors("/api/apple-iap"), "billing apple-iap stays off this PR");
ok(!needsCredentialedCors("/api/stripe-checkout"), "billing stripe-checkout stays off this PR");
ok(!needsCredentialedCors("/api/stripe-portal"), "billing stripe-portal stays off this PR");
ok(!needsCredentialedCors("/api/referral-code"), "billing referral-code stays off this PR");
ok(!needsCredentialedCors("/functions/v1/apple-iap"), "functions billing prefix stays off this PR");

const env = { BETTER_AUTH_URL: "https://api.nuvo.day" };
const origins = ["https://app.nuvo.day", "tauri://localhost", "https://tauri.localhost"] as const;

function assertCredentialed(res: Response, origin: string, label: string) {
  const acao = res.headers.get("access-control-allow-origin");
  const creds = res.headers.get("access-control-allow-credentials");
  const vary = res.headers.get("vary") ?? "";
  ok(acao === origin, `${label}: reflected ${origin} (got ${acao})`);
  ok(acao !== "*", `${label}: never ACAO *`);
  ok(creds === "true", `${label}: credentials true`);
  ok(vary.toLowerCase().includes("origin"), `${label}: Vary Origin`);
  if (creds === "true") ok(acao !== "*", `${label}: never * with credentials`);
}

for (const origin of origins) {
  for (const path of CLIENT_ROUTES) {
    const options = await app.fetch(
      new Request(`http://localhost${path}`, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "POST",
        },
      }),
      env,
    );
    assertCredentialed(options, origin, `OPTIONS ${path} ${origin}`);

    const get = await app.fetch(
      new Request(`http://localhost${path}`, {
        method: "GET",
        headers: { Origin: origin },
      }),
      env,
    );
    assertCredentialed(get, origin, `GET ${path} ${origin}`);
  }
}

const entitlement = await app.fetch(
  new Request("http://localhost/api/entitlement", {
    method: "OPTIONS",
    headers: { Origin: "https://app.nuvo.day" },
  }),
  env,
);
ok(
  entitlement.headers.get("access-control-allow-credentials") !== "true",
  "entitlement OPTIONS is not credentialed",
);

const helper = new Response("ok", {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
  },
});
reflectAllowOrigin(helper, "https://app.nuvo.day");
ok(helper.headers.get("access-control-allow-origin") === "https://app.nuvo.day", "helper stamps origin last");
ok((helper.headers.get("vary") ?? "").includes("Origin"), "helper sets Vary: Origin");
ok(helper.headers.get("access-control-allow-origin") !== "*", "helper never leaves *");

const starCreds = new Response("ok", {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
  },
});
reflectAllowOrigin(starCreds, "*");
ok(starCreds.headers.get("access-control-allow-origin") == null, "helper deletes * when credentials true");

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
