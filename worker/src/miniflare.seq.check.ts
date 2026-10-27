// workerd / miniflare sequential requests against real Postgres.
// create → read → patch → list + cross-user isolation, each on a fresh
// per-request client. This is the CONNECTION_ENDED path the Node+PGlite
// harness cannot see.
// Run: DATABASE_URL=postgresql://… node --experimental-strip-types worker/src/miniflare.seq.check.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { unstable_dev, type Unstable_DevWorker } from "wrangler";
import { postgresSsl } from "./db.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const pgUrl =
  process.env.WORKER_SEQ_DATABASE_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  "postgresql://postgres:postgres@127.0.0.1:5432/nuvo";

async function canConnect(url: string): Promise<boolean> {
  const sql = postgres(url, { max: 1, connect_timeout: 3, ssl: postgresSsl(url) });
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 2 }).catch(() => undefined);
  }
}

if (!(await canConnect(pgUrl))) {
  if (process.env.CI) {
    console.error(`miniflare seq: cannot reach Postgres at ${pgUrl}`);
    process.exit(1);
  }
  console.log("miniflare seq: skipped (no Postgres). Set DATABASE_URL to run.");
  process.exit(0);
}

const apply = postgres(pgUrl, { max: 1, ssl: postgresSsl(pgUrl) });
try {
  await apply.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  const { readFileSync } = await import("node:fs");
  const schemaDir = join(root, "worker/schema");
  await apply.unsafe(readFileSync(join(schemaDir, "neon.sql"), "utf8"));
  await apply.unsafe(readFileSync(join(schemaDir, "better-auth.sql"), "utf8"));
} finally {
  await apply.end({ timeout: 5 });
}

mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist/index.html"), "<!doctype html><title>nuvo</title>\n");

const port = 18787;
const origin = `http://127.0.0.1:${port}`;
const secret = "miniflare-seq-secret-32-bytes-long!";
const cronSecret = "miniflare-seq-cron-secret";

let worker: Unstable_DevWorker | undefined;
try {
  worker = await unstable_dev(join(root, "worker/src/index.ts"), {
    env: "preview",
    ip: "127.0.0.1",
    port,
    local: true,
    persist: false,
    inspect: false,
    logLevel: "error",
    vars: {
      DATABASE_URL: pgUrl,
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: origin,
      ENVIRONMENT: "preview",
      CRON_SECRET: cronSecret,
      CUTOVER_FLIPPED: "1",
    },
    experimental: {
      disableExperimentalWarning: true,
      disableDevRegistry: true,
      watch: false,
      showInteractiveDevSession: false,
    },
  });

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (!headers.has("Origin")) headers.set("Origin", origin);
    return worker!.fetch(`${origin}${path}`, { ...init, headers });
  }

  function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} hung after ${ms}ms`)), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  const health = await withTimeout(request("/api/health"), 8000, "health");
  ok(health.status === 200, `health: HTTP ${health.status}`);
  ok(health.headers.get("x-content-type-options") === "nosniff", "health: cloned security headers");

  function cookieHeader(res: Response): string {
    const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const parts = typeof getSetCookie === "function" ? getSetCookie.call(res.headers) : [];
    if (parts.length) {
      return parts.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
    }
    const single = res.headers.get("set-cookie");
    return single ? single.split(";")[0] : "";
  }

  async function readOtp(email: string): Promise<string> {
    const inspect = postgres(pgUrl, { max: 1, ssl: postgresSsl(pgUrl) });
    try {
      const rows = await inspect<{ value: string }[]>`
        SELECT value FROM verification
        WHERE identifier = ${`sign-in-otp-${email}`}
        ORDER BY "expiresAt" DESC
        LIMIT 1
      `;
      return (rows[0]?.value ?? "").split(":")[0];
    } finally {
      await inspect.end({ timeout: 5 });
    }
  }

  async function signInOtp(email: string): Promise<{ token: string; id: string; cookie: string }> {
    const send = await withTimeout(
      request("/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, type: "sign-in" }),
      }),
      15000,
      `OTP send ${email}`,
    );
    ok(send.status === 200, `OTP send ${email}: HTTP ${send.status}`);
    const otp = await readOtp(email);
    ok(/^\d{6}$/.test(otp), `OTP send ${email}: captured a 6-digit code`);
    const res = await withTimeout(
      request("/api/auth/sign-in/email-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp }),
      }),
      15000,
      `OTP sign-in ${email}`,
    );
    const text = await res.text();
    ok(res.status === 200, `OTP sign-in ${email}: HTTP ${res.status} ${text.slice(0, 160)}`);
    const body = JSON.parse(text || "{}") as { token?: string; user?: { id?: string } };
    ok(typeof body.token === "string" && body.token.length > 8, `OTP sign-in ${email}: token`);
    ok(typeof body.user?.id === "string", `OTP sign-in ${email}: user id`);
    return { token: body.token ?? "", id: body.user?.id ?? "", cookie: cookieHeader(res) };
  }

  const seedEmail = "seq-seed@example.test";
  const SEED = "44444444-4444-4444-4444-444444444444";
  const SEED_DOMAIN = "44444444-0000-4000-8000-000000000001";
  const seedSql = postgres(pgUrl, { max: 1, ssl: postgresSsl(pgUrl) });
  try {
    await seedSql`
      INSERT INTO users (id, email) VALUES (${SEED}, ${seedEmail})
    `;
    await seedSql`
      INSERT INTO domains (id, user_id, name, color)
      VALUES (${SEED_DOMAIN}, ${SEED}, 'Seed Work', '#2563EB')
    `;
  } finally {
    await seedSql.end({ timeout: 5 });
  }

  const takeover = await withTimeout(
    request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: seedEmail, password: "password12", name: "Takeover" }),
    }),
    15000,
    "unverified sign-up",
  );
  const takeoverText = await takeover.text();
  ok(takeover.status === 200, `unverified sign-up: HTTP ${takeover.status} ${takeoverText.slice(0, 160)}`);
  const takeoverBody = JSON.parse(takeoverText || "{}") as { token?: string | null };
  ok(takeoverBody.token == null, "unverified sign-up: no session (cannot adopt seed data)");

  const a = await signInOtp("seq-a@example.test");
  const b = await signInOtp("seq-b@example.test");
  ok(a.token.includes("."), "OTP A: JSON token is signed");

  const inspect = postgres(pgUrl, { max: 1, ssl: postgresSsl(pgUrl) });
  let rawDbToken = "";
  try {
    const rows = await inspect<{ token: string }[]>`
      SELECT token FROM session WHERE "userId" = ${a.id} LIMIT 1
    `;
    rawDbToken = rows[0]?.token ?? "";
  } finally {
    await inspect.end({ timeout: 5 });
  }
  ok(rawDbToken.length > 8, "session table has a raw token for A");
  ok(rawDbToken !== a.token, "JSON token is not the raw DB session token");
  ok(!rawDbToken.includes("."), "raw DB token is unsigned");

  const rawBearer = await withTimeout(
    request("/api/data/tasks", {
      headers: { Authorization: `Bearer ${rawDbToken}` },
    }),
    15000,
    "raw DB bearer",
  );
  ok(rawBearer.status === 401, `raw DB token as Bearer: HTTP ${rawBearer.status}`);
  ok((rawBearer.headers.get("content-type") ?? "").includes("application/json"), "raw DB token 401 is JSON");

  const createRes = await withTimeout(
    request("/api/data/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${a.token}`,
      },
      body: JSON.stringify({ title: "seq create" }),
    }),
    15000,
    "create",
  );
  const createText = await createRes.text();
  ok(createRes.status === 200, `create: HTTP ${createRes.status} ${createText.slice(0, 200)}`);
  const created = JSON.parse(createText || "{}") as { data?: { id?: string; title?: string; user_id?: string } };
  ok(created.data?.title === "seq create", "create: title stored");
  ok(typeof created.data?.id === "string", "create: id");
  const taskId = created.data?.id ?? "";

  const readRes = await withTimeout(
    request(`/api/data/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${a.token}` },
    }),
    15000,
    "read",
  );
  const readText = await readRes.text();
  ok(readRes.status === 200, `read: HTTP ${readRes.status} ${readText.slice(0, 200)}`);
  const read = JSON.parse(readText || "{}") as { data?: { title?: string } };
  ok(read.data?.title === "seq create", "read: same task");

  const patchRes = await withTimeout(
    request(`/api/data/tasks/${taskId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${a.token}`,
      },
      body: JSON.stringify({ title: "seq patched" }),
    }),
    15000,
    "patch",
  );
  const patchText = await patchRes.text();
  ok(patchRes.status === 200, `patch: HTTP ${patchRes.status} ${patchText.slice(0, 200)}`);
  const patched = JSON.parse(patchText || "{}") as { data?: { title?: string } };
  ok(patched.data?.title === "seq patched", "patch: title updated");

  const listRes = await withTimeout(
    request("/api/data/tasks", {
      headers: { Authorization: `Bearer ${a.token}` },
    }),
    15000,
    "list",
  );
  const listText = await listRes.text();
  ok(listRes.status === 200, `list: HTTP ${listRes.status} ${listText.slice(0, 200)}`);
  const listed = JSON.parse(listText || "{}") as { data?: { id?: string; title?: string }[] };
  ok(Array.isArray(listed.data) && listed.data.some((row) => row.id === taskId && row.title === "seq patched"), "list: includes patched task");

  const bList = await withTimeout(
    request("/api/data/tasks", {
      headers: { Authorization: `Bearer ${b.token}` },
    }),
    15000,
    "B list",
  );
  const bListBody = await bList.json() as { data?: { id?: string }[] };
  ok(bList.status === 200, `B list: HTTP ${bList.status}`);
  ok(Array.isArray(bListBody.data) && !bListBody.data.some((row) => row.id === taskId), "isolation: B list omits A's task");

  const bRead = await withTimeout(
    request(`/api/data/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${b.token}` },
    }),
    15000,
    "B read",
  );
  ok(bRead.status === 404, `isolation: B read of A is HTTP ${bRead.status}`);
  ok((bRead.headers.get("content-type") ?? "").includes("application/json"), "isolation: B 404 is JSON, not a plain-text 500");

  const bPatch = await withTimeout(
    request(`/api/data/tasks/${taskId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${b.token}`,
      },
      body: JSON.stringify({ title: "hijacked" }),
    }),
    15000,
    "B patch",
  );
  ok(bPatch.status === 404, `isolation: B patch of A is HTTP ${bPatch.status}`);

  const aReadAfter = await withTimeout(
    request(`/api/data/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${a.token}` },
    }),
    15000,
    "A re-read",
  );
  const after = await aReadAfter.json() as { data?: { title?: string } };
  ok(aReadAfter.status === 200 && after.data?.title === "seq patched", "isolation: A title unchanged after B patch");

  const steal = await withTimeout(
    request("/api/data/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${b.token}`,
      },
      body: JSON.stringify({ id: taskId, title: "steal" }),
    }),
    15000,
    "foreign id",
  );
  const stealText = await steal.clone().text();
  const stealBody = JSON.parse(stealText || "{}") as { data?: { id?: string } };
  ok(steal.status === 200, `POST other owner's id: HTTP ${steal.status} (new owned row, not 500)`);
  ok(stealText.includes("hyperdrive") === false, "foreign id: no internal host");
  ok(stealBody.data?.id !== taskId, "foreign id: did not take A's id");
  const aReadSteal = await withTimeout(
    request(`/api/data/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${a.token}` },
    }),
    15000,
    "A re-read after steal",
  );
  const afterSteal = await aReadSteal.json() as { data?: { title?: string } };
  ok(aReadSteal.status === 200 && afterSteal.data?.title === "seq patched", "foreign id: A title unchanged");

  const adopted = await signInOtp(seedEmail);
  const adoptedDomains = await withTimeout(
    request("/api/data/domains", {
      headers: { Authorization: `Bearer ${adopted.token}` },
    }),
    15000,
    "OTP adopt",
  );
  const adoptedBody = await adoptedDomains.json() as { data?: { id?: string; name?: string }[] };
  ok(adoptedDomains.status === 200, `OTP adopt: HTTP ${adoptedDomains.status}`);
  ok(
    Array.isArray(adoptedBody.data) && adoptedBody.data.some((row) => row.id === SEED_DOMAIN),
    "verified OTP user adopts the seeded planner row",
  );

  const renameSql = postgres(pgUrl, { max: 1, ssl: postgresSsl(pgUrl) });
  try {
    await renameSql`UPDATE "user" SET email = ${"renamed-seq-seed@example.test"} WHERE id = ${adopted.id}`;
  } finally {
    await renameSql.end({ timeout: 5 });
  }
  const afterRename = await withTimeout(
    request("/api/data/domains", {
      headers: { Authorization: `Bearer ${adopted.token}` },
    }),
    15000,
    "email-change",
  );
  const afterRenameBody = await afterRename.json() as { data?: { id?: string }[] };
  ok(afterRename.status === 200, `email-change: HTTP ${afterRename.status}`);
  ok(
    Array.isArray(afterRenameBody.data) && afterRenameBody.data.some((row) => row.id === SEED_DOMAIN),
    "auth_id link survives an email change",
  );

  ok(a.cookie.length > 0, "OTP A set a session cookie");
  const cookieSession = await withTimeout(
    request("/api/auth/get-session", {
      headers: { Cookie: a.cookie },
    }),
    15000,
    "cookie-only get-session",
  );
  const cookieText = await cookieSession.text();
  ok(cookieSession.status === 200, `cookie-only get-session: HTTP ${cookieSession.status}`);
  const cookieBody = JSON.parse(cookieText || "null") as { session?: { token?: string } } | null;
  ok(cookieBody?.session?.token?.includes(".") === true, "cookie-only get-session: token is signed");
  ok(cookieBody?.session?.token !== rawDbToken, "cookie-only get-session: not the raw DB token");
  const cookieList = await withTimeout(
    request("/api/data/tasks", {
      headers: { Authorization: `Bearer ${cookieBody?.session?.token}` },
    }),
    15000,
    "get-session bearer",
  );
  ok(cookieList.status === 200, `cookie-only get-session token as Bearer: HTTP ${cookieList.status}`);

  const badJson = await withTimeout(
    request("/api/data/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${a.token}`,
      },
      body: "{",
    }),
    15000,
    "bad JSON",
  );
  ok(badJson.status === 400, `bad JSON: HTTP ${badJson.status}`);

  const beforeBad = await withTimeout(
    request("/api/data/tasks", { headers: { Authorization: `Bearer ${a.token}` } }),
    15000,
    "list before bad bodies",
  );
  const beforeBadBody = await beforeBad.json() as { data?: { title?: string }[] };
  const beforeCount = Array.isArray(beforeBadBody.data) ? beforeBadBody.data.length : 0;
  for (const [label, body] of [
    ["JSON string", '"just a string"'],
    ["null body", "null"],
    ["array body", "[]"],
  ] as const) {
    const res = await withTimeout(
      request("/api/data/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${a.token}`,
        },
        body,
      }),
      15000,
      label,
    );
    ok(res.status === 400, `${label}: HTTP ${res.status} (not 500)`);
  }
  const afterBad = await withTimeout(
    request("/api/data/tasks", { headers: { Authorization: `Bearer ${a.token}` } }),
    15000,
    "list after bad bodies",
  );
  const afterBadBody = await afterBad.json() as { data?: { title?: string }[] };
  const afterCount = Array.isArray(afterBadBody.data) ? afterBadBody.data.length : 0;
  ok(afterCount === beforeCount, "non-object POST: no task row written");
  ok(!(afterBadBody.data ?? []).some((row) => row.title === "Untitled"), "non-object POST: no Untitled task");

  const badId = await withTimeout(
    request(`/api/data/tasks/not-a-uuid`, {
      headers: { Authorization: `Bearer ${a.token}` },
    }),
    15000,
    "malformed id",
  );
  ok(badId.status === 400, `malformed id: HTTP ${badId.status}`);

  const cron = await withTimeout(
    request("/api/cron/push-dispatch", {
      headers: { Authorization: `Bearer ${cronSecret}` },
    }),
    8000,
    "cron",
  );
  ok(cron.status === 200, `cron authorized push-dispatch: HTTP ${cron.status}`);
  const cronBody = await cron.json() as { ok?: boolean; skipped?: boolean };
  ok(cronBody.ok === true && cronBody.skipped !== true, "cron push-dispatch runs after flip");

  const maintenance = await withTimeout(request("/api/maintenance"), 8000, "maintenance");
  ok(maintenance.status === 200, `GET /api/maintenance: HTTP ${maintenance.status}`);
  const maintenanceBody = (await maintenance.json()) as { write_freeze?: boolean };
  ok(maintenanceBody.write_freeze === false, "preview write_freeze is off");
} finally {
  await worker?.stop();
}

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("miniflare seq: ok");
