#!/usr/bin/env node
/**
 * Prove every billed user keeps the same entitlement after the auth copy.
 *
 * Live (cutover): SOURCE_DATABASE_URL + TARGET_DATABASE_URL
 *   source auth ids via migration_tmp.auth_users() (fallback auth.users)
 *   target ids from Better Auth "user"
 *   subscriptions stay on the source (Supabase)
 *
 * Fixtures (CI): --source-ids --target-ids --subscriptions JSON files
 *   each file is a JSON array. Subscription objects need user_id, status,
 *   trial_ends_at, plan_source.
 *
 * Prints counts only. Never emails, tokens, stripe ids, or row payloads.
 *
 * Run: node --experimental-strip-types scripts/check-entitlement-parity.ts
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { postgresSsl } from "../worker/src/db.ts";
import { entitlementOf, type SubscriptionColumns } from "../worker/src/entitlement.ts";
import { compareEntitlementParity, formatParityCounts } from "../worker/src/entitlementParity.ts";

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function asIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (typeof row === "string") return row;
      if (row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string") {
        return (row as { id: string }).id;
      }
      return "";
    })
    .filter(Boolean);
}

function asSubscriptions(value: unknown): SubscriptionColumns[] {
  if (!Array.isArray(value)) return [];
  const rows: SubscriptionColumns[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.user_id !== "string") continue;
    rows.push({
      user_id: row.user_id,
      status: typeof row.status === "string" ? (row.status as SubscriptionColumns["status"]) : null,
      trial_ends_at: typeof row.trial_ends_at === "string" ? row.trial_ends_at : null,
      plan_source:
        row.plan_source === "stripe" || row.plan_source === "apple" ? row.plan_source : null,
    });
  }
  return rows;
}

async function sqlIds(url: string, query: string): Promise<string[]> {
  const sql = postgres(url, { max: 1, ssl: postgresSsl(url) });
  try {
    const rows = (await sql.unsafe(query)) as { id?: string }[];
    return rows.map((row) => row.id).filter((id): id is string => typeof id === "string");
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

async function sqlSubscriptions(url: string): Promise<SubscriptionColumns[]> {
  const sql = postgres(url, { max: 1, ssl: postgresSsl(url) });
  try {
    const rows = await sql<SubscriptionColumns[]>`
      SELECT user_id::text AS user_id,
             status,
             trial_ends_at::text AS trial_ends_at,
             plan_source
      FROM public.subscriptions
    `;
    return rows.map((row) => ({
      user_id: row.user_id,
      status: row.status ?? null,
      trial_ends_at: row.trial_ends_at ?? null,
      plan_source: row.plan_source === "stripe" || row.plan_source === "apple" ? row.plan_source : null,
    }));
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

async function sourceAuthIds(url: string): Promise<string[]> {
  const sql = postgres(url, { max: 1, ssl: postgresSsl(url) });
  try {
    const tmp = await sql<{ ok?: boolean }[]>`
      SELECT to_regclass('migration_tmp.auth_users') IS NOT NULL AS ok
    `;
    if (tmp[0]?.ok) {
      const rows = await sql<{ id?: string }[]>`SELECT id::text AS id FROM migration_tmp.auth_users()`;
      return rows.map((row) => row.id).filter((id): id is string => typeof id === "string");
    }
    const rows = await sql<{ id?: string }[]>`SELECT id::text AS id FROM auth.users`;
    return rows.map((row) => row.id).filter((id): id is string => typeof id === "string");
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

async function loadFromEnv(): Promise<{
  sourceUserIds: string[];
  targetUserIds: string[];
  subscriptions: SubscriptionColumns[];
} | null> {
  const source = process.env.SOURCE_DATABASE_URL?.trim();
  const target = process.env.TARGET_DATABASE_URL?.trim() || process.env.SCRATCH_DATABASE_URL?.trim();
  if (!source || !target) return null;
  const [sourceUserIds, targetUserIds, subscriptions] = await Promise.all([
    sourceAuthIds(source),
    sqlIds(target, 'SELECT id::text AS id FROM "user"'),
    sqlSubscriptions(source),
  ]);
  return { sourceUserIds, targetUserIds, subscriptions };
}

function loadFromFiles(): {
  sourceUserIds: string[];
  targetUserIds: string[];
  subscriptions: SubscriptionColumns[];
} | null {
  const sourcePath = argValue("--source-ids");
  const targetPath = argValue("--target-ids");
  const subPath = argValue("--subscriptions");
  if (!sourcePath || !targetPath || !subPath) return null;
  return {
    sourceUserIds: asIds(readJsonFile(sourcePath)),
    targetUserIds: asIds(readJsonFile(targetPath)),
    subscriptions: asSubscriptions(readJsonFile(subPath)),
  };
}

const now = process.env.ENTITLEMENT_NOW ? new Date(process.env.ENTITLEMENT_NOW) : new Date();

const fromFiles = loadFromFiles();
const loaded = fromFiles ?? (await loadFromEnv());
if (!loaded) {
  console.error(
    "usage: check-entitlement-parity --source-ids a.json --target-ids b.json --subscriptions c.json",
  );
  console.error("   or: SOURCE_DATABASE_URL + TARGET_DATABASE_URL");
  process.exit(2);
}

const report = compareEntitlementParity({
  ...loaded,
  now,
  readAfter: (userId) => {
    const row = loaded.subscriptions.find((item) => item.user_id === userId) ?? null;
    return entitlementOf(row, userId, now);
  },
});

console.log(formatParityCounts(report));
if (!report.ok) {
  for (const problem of report.problems) console.error(`parity: ${problem}`);
  process.exit(1);
}
console.log("entitlement parity: ok");
