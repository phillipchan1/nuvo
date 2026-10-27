// Neon-only Better Auth users are not in GoTrue auth.users. After the
// pre-flip FK drop, a subscriptions row and a plan UPDATE must work.
// Applies the committed SQL (not a copy). CI: postgres:17.
// Run: DATABASE_URL=postgresql://… node --experimental-strip-types worker/src/billingFk.check.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { postgresSsl } from "./db.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const dropSql = readFileSync(join(root, "docs/cloudflare-migration/drop-billing-auth-fk.sql"), "utf8");
const rollbackSql = readFileSync(
  join(root, "docs/cloudflare-migration/drop-billing-auth-fk.rollback.sql"),
  "utf8",
);
const runbook = readFileSync(join(root, "docs/cloudflare-cutover.md"), "utf8");
const live = readFileSync(join(root, "docs/cloudflare-migration/billing-live-check.md"), "utf8");
const ensureSrc = readFileSync(join(here, "lib/ensureSubscription.ts"), "utf8");
const authSrc = readFileSync(join(here, "auth.ts"), "utf8");
const webhookSrc = readFileSync(join(root, "supabase/functions/stripe-webhook/index.ts"), "utf8");
const notifySrc = readFileSync(join(root, "supabase/functions/_shared/referralNotify.ts"), "utf8");
const proxySrc = readFileSync(join(here, "billingProxy.ts"), "utf8");
const indexSrc = readFileSync(join(here, "index.ts"), "utf8");

ok(dropSql.includes("Phil's yes on #120"), "drop SQL waits for Phil's yes on #120");
ok(dropSql.includes("never earlier"), "drop SQL says never earlier");
ok(dropSql.includes("Hand-applied as postgres"), "drop SQL is hand-applied as postgres");
ok(!dropSql.includes("supabase/migrations"), "drop SQL is not a merge-time migration");
ok(dropSql.includes("subscriptions_pkey"), "drop SQL keeps subscriptions_pkey as the user_id index");
ok(dropSql.includes("subscriptions_user_id_fkey"), "drops subscriptions.user_id → auth.users");
ok(dropSql.includes("subscriptions_referred_by_fkey"), "drops subscriptions.referred_by → auth.users");
ok(rollbackSql.includes("NOT VALID"), "rollback re-adds FKs as NOT VALID");
ok(rollbackSql.includes("subscriptions_user_id_fkey"), "rollback re-adds user_id FK");
ok(rollbackSql.includes("subscriptions_referred_by_fkey"), "rollback re-adds referred_by FK");

ok(runbook.includes("drop-billing-auth-fk.sql"), "runbook names the drop SQL");
ok(runbook.includes("Phil's yes on #120"), "runbook applies the drop only after Phil's yes on #120");
ok(runbook.includes("never earlier"), "runbook says never earlier");
ok(runbook.includes("drop-billing-auth-fk.rollback.sql"), "runbook names the rollback SQL");
ok(runbook.includes("NOT VALID"), "runbook rollback re-adds FKs as NOT VALID");

ok(live.includes("Neon-only"), "live check covers a Neon-only user");
ok(live.includes("Apple sandbox") || live.includes("sandbox"), "live check covers Apple sandbox");
ok(/Stripe TEST/i.test(live), "live check covers Stripe TEST");
ok(live.includes("right after") || live.includes("row exists"), "live check: row exists right after signup");

ok(/res\.ok \|\| res\.status === 409/.test(ensureSrc) === false, "ensureSubscription does not treat 409 as success");
ok(ensureSrc.includes("23503"), "ensureSubscription names 23503 as a failure");
ok(ensureSrc.includes("retry: true"), "ensureSubscription surfaces retry to the caller");
ok(/result\.ok/.test(authSrc), "user.create.after surfaces the ensure result");
ok(!/getUserById/.test(webhookSrc), "stripe-webhook does not call getUserById");
ok(!/\.delete\(\)\.eq\("event_id"/.test(webhookSrc), "stripe-webhook keeps the ledger row on handler failure");
ok(webhookSrc.includes("stripePayerEmail"), "stripe-webhook takes email from the Stripe object");
ok(notifySrc.includes("workerUserEmail"), "referralNotify looks the user up through the Worker");
ok(!/getUserById/.test(notifySrc), "referralNotify does not call getUserById");
ok(/proxyBillingFunction\(c, name, got\.user\)/.test(indexSrc), "billing writes use the verified session user");
ok(!/body\.user_id|body\.actingUserId/.test(proxySrc), "proxy does not take a client-supplied user id");
ok(indexSrc.includes("handleInternalUserEmail"), "Worker mounts GET /api/internal/user-email");

const pgUrl =
  process.env.BILLING_FK_DATABASE_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  "postgresql://postgres:postgres@127.0.0.1:5432/nuvo";

const sql = postgres(pgUrl, { max: 1, connect_timeout: 5, ssl: postgresSsl(pgUrl) });

try {
  await sql`SELECT 1`;
} catch (err) {
  await sql.end({ timeout: 2 }).catch(() => undefined);
  if (process.env.CI) {
    console.error(`billing FK: cannot reach Postgres at ${pgUrl}`);
    console.error(err);
    process.exit(1);
  }
  console.log("billing FK: skipped (no Postgres). Set DATABASE_URL to run.");
  if (fails.length) {
    for (const f of fails) console.error("  FAIL", f);
    process.exit(1);
  }
  process.exit(0);
}

const NEON_ONLY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

try {
  await sql.unsafe(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY
    );
    DROP TABLE IF EXISTS public.subscriptions CASCADE;
    CREATE TABLE public.subscriptions (
      user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
      referred_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
      status text NOT NULL DEFAULT 'trialing',
      trial_ends_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  let blocked = false;
  try {
    await sql.unsafe(
      `INSERT INTO public.subscriptions (user_id, status) VALUES ('${NEON_ONLY}', 'trialing')`,
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    blocked = code === "23503";
  }
  ok(blocked, "before the drop, a user absent from auth.users is rejected (23503)");

  await sql.unsafe(dropSql);

  const inserted = await sql.unsafe(
    `INSERT INTO public.subscriptions (user_id, status) VALUES ('${NEON_ONLY}', 'trialing') RETURNING user_id, status`,
  );
  ok(inserted.length === 1 && inserted[0]?.user_id === NEON_ONLY, "after the drop, a Neon-only user gets a subscriptions row");

  const updated = await sql.unsafe(
    `UPDATE public.subscriptions SET status = 'active' WHERE user_id = '${NEON_ONLY}' RETURNING status`,
  );
  ok(updated[0]?.status === "active", "plan UPDATE works for a user absent from auth.users");

  const indexes = await sql<{ indexname: string; indexdef: string }[]>`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'subscriptions'
  `;
  ok(
    indexes.some((row) => row.indexname === "subscriptions_pkey" && /user_id/.test(row.indexdef)),
    "subscriptions.user_id keeps its PRIMARY KEY index",
  );

  const fksAfterDrop = await sql<{ conname: string }[]>`
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'subscriptions'
      AND con.contype = 'f'
  `;
  ok(fksAfterDrop.length === 0, "both billing FKs to auth.users are gone after the drop");

  await sql.unsafe(rollbackSql);

  const fksAfterRollback = await sql<{ conname: string; convalidated: boolean }[]>`
    SELECT con.conname, con.convalidated
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'subscriptions'
      AND con.contype = 'f'
    ORDER BY con.conname
  `;
  ok(
    fksAfterRollback.some((row) => row.conname === "subscriptions_user_id_fkey" && row.convalidated === false),
    "rollback re-adds user_id FK as NOT VALID",
  );
  ok(
    fksAfterRollback.some((row) => row.conname === "subscriptions_referred_by_fkey" && row.convalidated === false),
    "rollback re-adds referred_by FK as NOT VALID",
  );
} finally {
  await sql.unsafe("DROP TABLE IF EXISTS public.subscriptions CASCADE").catch(() => undefined);
  await sql.end({ timeout: 5 }).catch(() => undefined);
}

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("billing FK check: ok");
