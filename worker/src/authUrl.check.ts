// Run: node --experimental-strip-types worker/src/authUrl.check.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import app from "./index.ts";
import { otpConsoleAllowed } from "./auth.ts";
import { authConfigErrorResponse, beginAuthCors } from "./cors.ts";
import { bearerToken, cronAuthorized, timingSafeEqualString } from "./cron.ts";
import {
  authCookieSecure,
  connectionHostname,
  isLocalAuthHost,
  isLocalAuthRuntime,
  isLoopbackHostname,
  resolveAuthBaseURL,
} from "./authUrl.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const neon = "postgresql://neondb@ep-prod.us-east-1.aws.neon.tech/nuvo";
const prodWithLocalUser = "postgresql://localhost_admin@ep-prod.neon.tech/nuvo";
const prodWithLocalDb = "postgresql://app@ep-prod.neon.tech/localhost";
const prodWithLocalQuery = "postgresql://app@ep-prod.neon.tech/nuvo?application_name=localhost&sslmode=require";
const loopbackPg = "postgresql://postgres@localhost:5432/nuvo";
const loopbackV4 = "postgresql://postgres@127.0.0.1:5432/nuvo";
const loopbackV6 = "postgresql://postgres:postgres@[::1]:5432/nuvo";

ok(isLoopbackHostname("::1"), "::1 hostname is loopback");
ok(isLoopbackHostname("[::1]"), "[::1] hostname is loopback");
ok(isLocalAuthHost("http://[::1]:8787"), "[::1] auth origin is local");
ok(isLocalAuthHost("http://[::1]"), "[::1] without port is local");
ok(!authCookieSecure("http://[::1]:8787"), "[::1] cookies are not Secure");
ok(isLocalAuthRuntime({ DATABASE_URL: loopbackV6 }), "[::1] DB hostname is local runtime");
ok(connectionHostname(loopbackV6) === "[::1]" || connectionHostname(loopbackV6) === "::1", "[::1] postgres hostname parses");

ok(isLocalAuthHost("http://localhost:8787"), "localhost is local");
ok(isLocalAuthHost("http://127.0.0.1:5717"), "127.0.0.1 is local");
ok(isLoopbackHostname("127.1"), "127.1 hostname is loopback");
ok(isLocalAuthHost("http://127.1:8787"), "127.1 auth origin is local");
ok(isLocalAuthRuntime({ DATABASE_URL: "postgresql://postgres@127.1:5432/nuvo" }), "127.1 DB hostname is local");
ok(!isLocalAuthHost("https://nuvo-preview.example.workers.dev"), "workers.dev is not local");
ok(!authCookieSecure("http://localhost:8787"), "localhost cookies are not Secure");
ok(authCookieSecure("https://nuvo-preview.example.workers.dev"), "prod cookies are Secure");

ok(!isLocalAuthRuntime({ DATABASE_URL: prodWithLocalUser }), "user localhost_admin is not local");
ok(!isLocalAuthRuntime({ DATABASE_URL: prodWithLocalDb }), "db name localhost is not local");
ok(!isLocalAuthRuntime({ DATABASE_URL: prodWithLocalQuery }), "query localhost is not local");
ok(!isLocalAuthRuntime({ DATABASE_URL: neon }), "Neon URL is not local");
ok(!isLocalAuthRuntime({}), "empty env is not local");
ok(!isLocalAuthRuntime({ ENVIRONMENT: "dev" }), "ENVIRONMENT=dev is not local");
ok(!isLocalAuthRuntime({ ENVIRONMENT: "development" }), "ENVIRONMENT=development is not local");
ok(!isLocalAuthRuntime({ ENVIRONMENT: "preview" }), "ENVIRONMENT=preview is not a localhost fallback");
ok(!isLocalAuthRuntime({ ENVIRONMENT: "production" }), "ENVIRONMENT=production is not local");
ok(isLocalAuthRuntime({ ENVIRONMENT: "local" }), "ENVIRONMENT=local is local");
ok(isLocalAuthRuntime({ ENVIRONMENT: "LOCAL" }), "ENVIRONMENT=LOCAL is local");
ok(isLocalAuthRuntime({ DATABASE_URL: loopbackPg }), "hostname localhost is local");
ok(isLocalAuthRuntime({ DATABASE_URL: loopbackV4 }), "hostname 127.0.0.1 is local");
ok(
  isLocalAuthRuntime({ HYPERDRIVE: { connectionString: loopbackV4 } }),
  "Hyperdrive loopback hostname is local",
);
ok(
  isLocalAuthRuntime({ ENVIRONMENT: "local", DATABASE_URL: prodWithLocalUser }),
  "ENVIRONMENT=local wins even with a prod-looking URL",
);
ok(connectionHostname(prodWithLocalUser) === "ep-prod.neon.tech", "parses host not user");
ok(connectionHostname(prodWithLocalDb) === "ep-prod.neon.tech", "parses host not db name");
ok(connectionHostname(prodWithLocalQuery) === "ep-prod.neon.tech", "parses host not query");

ok(
  resolveAuthBaseURL({ BETTER_AUTH_URL: "https://nuvo-preview.example.workers.dev/" }) ===
    "https://nuvo-preview.example.workers.dev",
  "configured URL wins and strips trailing slash",
);
ok(
  resolveAuthBaseURL({ DATABASE_URL: loopbackPg }) === "http://localhost:8787",
  "unset URL falls back when DB hostname is loopback",
);
ok(
  resolveAuthBaseURL({ ENVIRONMENT: "local" }) === "http://localhost:8787",
  "unset URL falls back when ENVIRONMENT=local",
);

function throwsUnset(env: Parameters<typeof resolveAuthBaseURL>[0]): boolean {
  try {
    resolveAuthBaseURL(env);
    return false;
  } catch (err) {
    return err instanceof Error && err.message.includes("BETTER_AUTH_URL must be set");
  }
}

ok(throwsUnset({ DATABASE_URL: neon }), "unset URL + Neon throws");
ok(throwsUnset({}), "unset URL with no local signal throws");
ok(throwsUnset({ BETTER_AUTH_URL: "   ", DATABASE_URL: neon }), "whitespace URL throws outside local");
ok(throwsUnset({ DATABASE_URL: prodWithLocalUser }), "unset URL + localhost in user throws");
ok(throwsUnset({ DATABASE_URL: prodWithLocalDb }), "unset URL + localhost in db name throws");
ok(throwsUnset({ DATABASE_URL: prodWithLocalQuery }), "unset URL + localhost in query throws");
ok(throwsUnset({ ENVIRONMENT: "dev", DATABASE_URL: neon }), "ENVIRONMENT=dev + Neon throws");

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
ok(
  readFileSync(join(root, "wrangler.jsonc"), "utf8").includes("ENVIRONMENT=local"),
  "wrangler.jsonc documents ENVIRONMENT=local",
);
ok(
  /"ENVIRONMENT": "preview"/.test(readFileSync(join(root, "wrangler.jsonc"), "utf8")),
  "wrangler preview sets ENVIRONMENT=preview",
);
ok(otpConsoleAllowed({ ENVIRONMENT: "local" }), "OTP console: local");
ok(otpConsoleAllowed({ ENVIRONMENT: "LOCAL" }), "OTP console: LOCAL");
ok(otpConsoleAllowed({ ENVIRONMENT: "preview" }), "OTP console: preview");
ok(otpConsoleAllowed({ ENVIRONMENT: "PREVIEW" }), "OTP console: PREVIEW");
ok(!otpConsoleAllowed({ ENVIRONMENT: "production" }), "OTP console: never production");
ok(!otpConsoleAllowed({ ENVIRONMENT: "prod" }), "OTP console: never prod");
ok(!otpConsoleAllowed({}), "OTP console: unset ENVIRONMENT is silent");
ok(!otpConsoleAllowed({ ENVIRONMENT: "dev" }), "OTP console: never dev");
ok(timingSafeEqualString("abc", "abc"), "timing-safe: equal");
ok(!timingSafeEqualString("abc", "abd"), "timing-safe: different bytes");
ok(!timingSafeEqualString("abc", "ab"), "timing-safe: different length");
ok(timingSafeEqualString("", ""), "timing-safe: empty strings compare equal");
ok(!cronAuthorized("", ""), "cron: empty provided vs empty secret is deny");
ok(!cronAuthorized("secret", undefined), "cron: unset secret is deny");
ok(!cronAuthorized("secret", ""), "cron: empty secret is deny");
ok(cronAuthorized("secret", "secret"), "cron: matching secret is allow");
ok(!cronAuthorized("secret", "Secret"), "cron: case-sensitive");
ok(bearerToken("Bearer abc") === "abc", "bearer: strips Bearer");
ok(bearerToken("bearer abc") === "abc", "bearer: strips bearer");
ok(bearerToken("abc") === "abc", "bearer: raw token");
ok(
  /ENVIRONMENT=local/.test(readFileSync(join(root, ".dev.vars.example"), "utf8")),
  ".dev.vars.example sets ENVIRONMENT=local",
);
ok(
  readFileSync(join(root, "docs/cloudflare-cutover.md"), "utf8").includes("ENVIRONMENT"),
  "cutover docs mention ENVIRONMENT",
);

const prodEnv = {
  DATABASE_URL: prodWithLocalUser,
  BETTER_AUTH_SECRET: "x".repeat(32),
};
const started = beginAuthCors("https://nuvo.example", prodEnv);
ok(!started.ok, "beginAuthCors fails closed when URL unset outside local");
if (!started.ok) {
  ok(started.response.status === 500, "misconfig status is 500");
  ok(
    (started.response.headers.get("content-type") ?? "").includes("application/json"),
    "misconfig is JSON",
  );
  ok(
    started.response.headers.get("access-control-allow-origin") == null,
    "non-loopback misconfig omits ACAO",
  );
  ok(
    started.response.headers.get("access-control-allow-credentials") == null,
    "non-loopback misconfig omits credentials",
  );
  const body = await started.response.json() as { error?: string };
  ok(body.error === "internal error", "misconfig body is generic");
}

const loopbackErr = authConfigErrorResponse("http://localhost:5717", new Error("BETTER_AUTH_URL must be set"));
ok(loopbackErr.headers.get("access-control-allow-origin") === "http://localhost:5717", "loopback misconfig echoes Origin");
ok(loopbackErr.headers.get("access-control-allow-credentials") === "true", "loopback misconfig keeps credentials");

const noOrigin = authConfigErrorResponse(null, new Error("BETTER_AUTH_URL must be set"));
ok(noOrigin.status === 500, "misconfig without Origin is 500");
ok(noOrigin.headers.get("access-control-allow-origin") == null, "no-Origin misconfig omits ACAO");
ok(noOrigin.headers.get("access-control-allow-credentials") == null, "no-Origin misconfig omits credentials");

for (const method of ["OPTIONS", "GET", "POST"] as const) {
  const res = await app.request(`http://localhost/api/auth/ok`, {
    method,
    headers: { Origin: "https://evil.example" },
  }, prodEnv);
  ok(res.status === 500, `${method} evil.example: JSON 500`);
  ok(res.headers.get("access-control-allow-origin") == null, `${method} evil.example: no ACAO`);
  ok(res.headers.get("access-control-allow-credentials") == null, `${method} evil.example: no credentials`);
}

const localOk = beginAuthCors("http://localhost:5717", { ENVIRONMENT: "local" });
ok(localOk.ok, "beginAuthCors succeeds when ENVIRONMENT=local");
if (localOk.ok) {
  ok(
    localOk.cors["Access-Control-Allow-Origin"] === "http://localhost:5717",
    "local CORS echoes vite origin",
  );
}

const health = await app.request("http://localhost/api/health");
ok(health.status === 200, "GET /api/health is 200");
const healthBody = await health.json() as { ok?: boolean; service?: string; write_freeze?: boolean };
ok(healthBody.ok === true && healthBody.service === "nuvo", "health body names nuvo");
ok(healthBody.write_freeze === false, "health write_freeze defaults off");
ok(health.headers.get("x-content-type-options") === "nosniff", "health: cloned security headers");

const cronDenied = await app.request("http://localhost/api/cron/push-dispatch", {
  headers: { Authorization: "Bearer nope" },
}, { ...prodEnv, CRON_SECRET: "cron-test-secret" });
ok(cronDenied.status === 401, `cron wrong secret: HTTP ${cronDenied.status}`);
ok((cronDenied.headers.get("content-type") ?? "").includes("application/json"), "cron 401 is JSON");

const cronUnset = await app.request("http://localhost/api/cron/push-dispatch", {
  headers: { Authorization: "Bearer cron-test-secret" },
}, prodEnv);
ok(cronUnset.status === 401, "cron unset secret: 401");

const { installRequestIoForTests } = await import("./requestIo.ts");
const restoreCronIo = installRequestIoForTests(() => ({
  sql: Object.assign(async () => [], { json: (value: unknown) => value }),
  auth: {} as never,
  close: async () => {},
}));
const cronOk = await app.request("http://localhost/api/cron/push-dispatch", {
  headers: { Authorization: "Bearer cron-test-secret" },
}, { ...prodEnv, CRON_SECRET: "cron-test-secret" });
ok(cronOk.status === 200, `cron matching secret: HTTP ${cronOk.status} (skip until flip)`);
const cronBody = await cronOk.json() as { ok?: boolean; skipped?: boolean; reason?: string; job?: string };
ok(cronBody.ok === true && cronBody.skipped === true && cronBody.reason === "cutover_not_flipped" && cronBody.job === "push-dispatch", "cron matching secret skips until flip");

const cronFlipped = await app.request("http://localhost/api/cron/push-dispatch", {
  headers: { Authorization: "Bearer cron-test-secret" },
}, { ...prodEnv, CRON_SECRET: "cron-test-secret", CUTOVER_FLIPPED: "1" });
restoreCronIo();
ok(cronFlipped.status === 200, `cron matching secret after flip: HTTP ${cronFlipped.status}`);
const flippedBody = await cronFlipped.json() as { ok?: boolean; skipped?: boolean; stay_on_supabase?: boolean };
ok(flippedBody.ok === true && flippedBody.skipped !== true && flippedBody.stay_on_supabase !== true, "cron matching secret runs push-dispatch after flip");

ok(
  !/c\.res\.headers\.set/.test(readFileSync(join(root, "worker/src/index.ts"), "utf8")),
  "index.ts does not mutate immutable c.res.headers",
);

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("authUrl: ok");
