// Credentialed CORS on /api/entitlement, /api/agent and /functions/v1/agent:
// the auth routes' allowlist, echoed with credentials, never `*`, and nothing
// at all for an Origin off the list. Preflights need no DB; real requests run
// with request I/O stubbed to fail, so they exercise the onError path (the one
// that used to leave with ACAO *).
// Run: node --experimental-strip-types worker/src/apiCors.check.ts

import { allowedApiOrigin } from "./cors.ts";
import type { Env } from "./env.ts";
import app from "./index.ts";
import { installRequestIoForTests } from "./requestIo.ts";

const restoreIo = installRequestIoForTests(() => {
  throw new Error("apiCors.check: no database");
});

const fails: string[] = [];
let checks = 0;
function ok(cond: unknown, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const env = {
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://api.nuvo.day",
  ENVIRONMENT: "production",
  DATABASE_URL: "postgresql://u@ep-x.us-east-1.aws.neon.tech/db",
} as unknown as Env;

const REQUESTED = ["authorization", "x-client-info", "apikey", "content-type"];
const ROUTES = [
  { path: "/api/entitlement", method: "GET" },
  { path: "/api/agent", method: "POST" },
  { path: "/functions/v1/agent", method: "POST" },
];

function list(v: string | null): string[] {
  return (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

async function preflight(path: string, origin: string, method: string, e: Env = env): Promise<Response> {
  return app.request(
    `https://api.nuvo.day${path}`,
    {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": REQUESTED.join(", "),
      },
    },
    e,
  );
}

// workers.dev previews: refused in production, echoed only on ENVIRONMENT=preview.
const PREVIEW_ORIGIN = "https://nuvo-app-preview.nq-morning-briefing.workers.dev";
const previewEnv = {
  ...env,
  BETTER_AUTH_URL: "https://nuvo-preview.nq-morning-briefing.workers.dev",
  ENVIRONMENT: "preview",
} as unknown as Env;
for (const { path, method } of ROUTES) {
  const prod = await preflight(path, PREVIEW_ORIGIN, method);
  ok(!prod.headers.has("Access-Control-Allow-Origin"), `${path} prod: preview origin gets no ACAO`);
  ok(!prod.headers.has("Access-Control-Allow-Credentials"), `${path} prod: preview origin gets no ACAC`);
  const prev = await preflight(path, PREVIEW_ORIGIN, method, previewEnv);
  ok(prev.headers.get("Access-Control-Allow-Origin") === PREVIEW_ORIGIN, `${path} preview: ACAO echoes the preview origin`);
  ok(prev.headers.get("Access-Control-Allow-Credentials") === "true", `${path} preview: ACAC true`);
}
ok(allowedApiOrigin(PREVIEW_ORIGIN, env) === null, "allowedApiOrigin prod: preview origin -> null");
ok(allowedApiOrigin(PREVIEW_ORIGIN, previewEnv) === PREVIEW_ORIGIN, "allowedApiOrigin preview: preview origin ok");

for (const { path, method } of ROUTES) {
  for (const origin of ["tauri://localhost", "https://app.nuvo.day"]) {
    const res = await preflight(path, origin, method);
    const tag = `${path} ${origin}`;
    ok(res.status >= 200 && res.status < 300, `${tag}: preflight is 2xx (${res.status})`);
    ok(res.headers.get("Access-Control-Allow-Origin") === origin, `${tag}: ACAO echoes the origin`);
    ok(res.headers.get("Access-Control-Allow-Credentials") === "true", `${tag}: ACAC true`);
    ok(list(res.headers.get("Vary")).includes("origin"), `${tag}: Vary includes Origin`);
    const allowHeaders = list(res.headers.get("Access-Control-Allow-Headers"));
    for (const h of REQUESTED) ok(allowHeaders.includes(h), `${tag}: allow-headers includes ${h}`);
    ok(
      list(res.headers.get("Access-Control-Allow-Methods")).includes(method.toLowerCase()),
      `${tag}: allow-methods includes ${method}`,
    );
  }

  for (const origin of ["https://evil.example", "https://app.nuvo.day.evil.example"]) {
    const res = await preflight(path, origin, method);
    const tag = `${path} ${origin}`;
    ok(!res.headers.has("Access-Control-Allow-Origin"), `${tag}: no ACAO`);
    ok(!res.headers.has("Access-Control-Allow-Credentials"), `${tag}: no ACAC`);
    ok(list(res.headers.get("Vary")).includes("origin"), `${tag}: Vary includes Origin`);
  }
}

// Never `*`, for any origin on any route.
for (const { path, method } of ROUTES) {
  for (const origin of [
    "tauri://localhost",
    "https://app.nuvo.day",
    "https://evil.example",
    "https://app.nuvo.day.evil.example",
  ]) {
    const res = await preflight(path, origin, method);
    ok(res.headers.get("Access-Control-Allow-Origin") !== "*", `${path} ${origin}: never ACAO *`);
  }
}

// Real (non-preflight) responses: request I/O throws, so these leave through
// onError; the error must still carry the credentialed CORS headers so the
// shell can read it instead of seeing an opaque CORS failure.
for (const [path, method] of [["/api/entitlement", "GET"], ["/functions/v1/agent", "POST"], ["/api/agent", "POST"]] as const) {
  for (const origin of ["tauri://localhost", "https://app.nuvo.day"]) {
    const res = await app.request(`https://api.nuvo.day${path}`, { method, headers: { Origin: origin, "Content-Type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) }, env);
    ok(res.status >= 400, `${method} ${path} ${origin}: error status (got ${res.status})`);
    ok(res.headers.get("Access-Control-Allow-Origin") === origin, `${method} ${path} ${origin}: response echoes origin`);
    ok(res.headers.get("Access-Control-Allow-Credentials") === "true", `${method} ${path} ${origin}: response allow-credentials`);
    ok(list(res.headers.get("Vary")).includes("origin"), `${method} ${path} ${origin}: response Vary Origin`);
  }
  const bad = await app.request(`https://api.nuvo.day${path}`, { method, headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) }, env);
  ok(!bad.headers.has("Access-Control-Allow-Origin"), `${method} ${path} evil: response has no ACAO (got ${bad.headers.get("Access-Control-Allow-Origin")})`);
  ok(!bad.headers.has("Access-Control-Allow-Credentials"), `${method} ${path} evil: response has no ACAC`);
}

// allowedApiOrigin: allowlist only, no fallback echo.
ok(allowedApiOrigin("tauri://localhost", env) === "tauri://localhost", "allowedApiOrigin: tauri ok");
ok(allowedApiOrigin("https://app.nuvo.day", env) === "https://app.nuvo.day", "allowedApiOrigin: app.nuvo.day ok");
ok(allowedApiOrigin("https://evil.example", env) === null, "allowedApiOrigin: evil -> null");
ok(allowedApiOrigin("null", env) === null, 'allowedApiOrigin: "null" -> null');
ok(allowedApiOrigin(undefined, env) === null, "allowedApiOrigin: undefined -> null");

restoreIo();
console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("api cors (credentialed): ok");
