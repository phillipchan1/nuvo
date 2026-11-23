import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { ACCOUNT_DELETE_CONFIRM } from "../supabase/functions/_shared/accountDeletion.ts";
import { deleteOwnedAccount } from "../worker/src/deleteAccount.ts";
import { applyIsolationSchema } from "../worker/src/isolationDb.ts";
import {
  ACTIVE_STRIPE_DELETE_MESSAGE,
  APPLE_DELETE_NOTICE,
  BillingLookupError,
  installBillingReaderForTests,
  readBillingSubscription,
  stripeSubscriptionBlocksDelete,
  type DeleteGateRow,
} from "../worker/src/lib/billingRead.ts";
import { makePgliteSql } from "../worker/src/pgliteSql.ts";
import { wipeOwnedAccount, type Store } from "../worker/src/store.ts";
import type { Sql } from "../worker/src/db.ts";

const SESSION = "aaaaaaaa-aaaa-4000-8000-000000000001";
const PLANNER = "11111111-1111-1111-1111-111111111111";
const FLIPPED = { CUTOVER_FLIPPED: "1" };

function stripeGate(overrides: DeleteGateRow = {}): DeleteGateRow {
  return {
    status: "active",
    plan_source: "stripe",
    hasStripeSubscription: true,
    present: true,
    ...overrides,
  };
}

describe("Worker delete-account Stripe gate", () => {
  afterEach(() => {
    installBillingReaderForTests(async () => null)();
  });

  it("reads through Neon and never puts Stripe ids on the row", async () => {
    const db = new PGlite();
    await applyIsolationSchema(db);
    const sql = makePgliteSql(db);
    await db.query(
      `INSERT INTO subscriptions (user_id, status, trial_ends_at, plan_source, stripe_subscription_id, stripe_customer_id)
       VALUES ($1, 'active', '2099-01-01T00:00:00Z', 'stripe', 'sub_live', 'cus_live')`,
      [SESSION],
    );
    const row = await readBillingSubscription(FLIPPED, SESSION, sql);
    expect(row?.hasStripeSubscription).toBe(true);
    expect(row).not.toHaveProperty("stripe_subscription_id");
    expect(row).not.toHaveProperty("stripe_customer_id");
    expect(stripeSubscriptionBlocksDelete(row)).toBe(true);
    await db.close();
  });

  it("active / past_due / unpaid / trialing Stripe subscriptions refuse, even with a null period end", () => {
    for (const status of ["active", "past_due", "unpaid", "trialing"] as const) {
      expect(stripeSubscriptionBlocksDelete(stripeGate({ status })), status).toBe(true);
    }
  });

  it("canceled / incomplete_expired / no row all allow", () => {
    for (const status of ["cancelled", "canceled", "incomplete_expired"] as const) {
      expect(stripeSubscriptionBlocksDelete(stripeGate({ status })), status).toBe(false);
    }
    expect(stripeSubscriptionBlocksDelete(null)).toBe(false);
    expect(stripeSubscriptionBlocksDelete({ present: false })).toBe(false);
  });

  it("an apple-labeled user with an active Stripe subscription refuses", () => {
    const row = stripeGate({ plan_source: "apple", status: "active", hasStripeSubscription: true });
    expect(row.plan_source).toBe("apple");
    expect(row.hasStripeSubscription).toBe(true);
    expect(stripeSubscriptionBlocksDelete(row)).toBe(true);
  });

  it("an apple user without a Stripe subscription allows", () => {
    const row = stripeGate({ plan_source: "apple", status: "active", hasStripeSubscription: false });
    expect(row.plan_source).toBe("apple");
    expect(row.hasStripeSubscription).toBe(false);
    expect(stripeSubscriptionBlocksDelete(row)).toBe(false);
  });

  it("does not gate on stripe_customer_id alone", async () => {
    const db = new PGlite();
    await applyIsolationSchema(db);
    const sql = makePgliteSql(db);
    await db.query(
      `INSERT INTO subscriptions (user_id, status, trial_ends_at, plan_source, stripe_customer_id)
       VALUES ($1, 'active', '2099-01-01T00:00:00Z', 'apple', 'cus_only')`,
      [SESSION],
    );
    const row = await readBillingSubscription(FLIPPED, SESSION, sql);
    expect(row?.hasStripeSubscription).toBe(false);
    expect(stripeSubscriptionBlocksDelete(row)).toBe(false);
    await db.close();
  });

  it("a no-card trial with no Stripe subscription can delete", () => {
    expect(
      stripeSubscriptionBlocksDelete({
        status: "trialing",
        plan_source: null,
        trial_ends_at: "2099-01-01T00:00:00Z",
        hasStripeSubscription: false,
        present: true,
      }),
    ).toBe(false);
    expect(
      stripeSubscriptionBlocksDelete({
        status: "trialing",
        plan_source: null,
        trial_ends_at: "2020-01-01T00:00:00Z",
        hasStripeSubscription: false,
        present: true,
      }),
    ).toBe(false);
  });

  it("fails closed on an unknown stripe status", () => {
    expect(stripeSubscriptionBlocksDelete(stripeGate({ status: "paused" }))).toBe(true);
  });

  it("Apple users can delete and are told to cancel in Apple Settings, with no Stripe wording", async () => {
    installBillingReaderForTests(async () => ({
      status: "active",
      plan_source: "apple",
      hasStripeSubscription: false,
      present: true,
    }));
    const res = await deleteOwnedAccount(
      dummyStore(),
      { id: SESSION },
      { confirm: ACCOUNT_DELETE_CONFIRM },
      FLIPPED,
    );
    expect(res.status).not.toBe(409);
    const body = (await res.json()) as { error?: string; notice?: string; ok?: boolean };
    expect(JSON.stringify(body)).not.toMatch(/Stripe/i);
    expect(body.notice).toBe(APPLE_DELETE_NOTICE);
    expect(body.notice).toMatch(/Apple Account settings/i);
  });

  it("reads billing by the session user.id, not the adopted planner id", async () => {
    const seen: string[] = [];
    installBillingReaderForTests(async (_env, userId) => {
      seen.push(userId);
      return stripeGate();
    });
    const res = await deleteOwnedAccount(
      dummyStore(PLANNER),
      { id: SESSION },
      { confirm: ACCOUNT_DELETE_CONFIRM },
      FLIPPED,
    );
    expect(res.status).toBe(409);
    expect(seen).toEqual([SESSION]);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe(ACTIVE_STRIPE_DELETE_MESSAGE);
  });

  it("tells Stripe subscribers to cancel in Billing first", () => {
    expect(ACTIVE_STRIPE_DELETE_MESSAGE).toMatch(/Billing/);
    expect(ACTIVE_STRIPE_DELETE_MESSAGE).toMatch(/cancel/i);
    expect(ACTIVE_STRIPE_DELETE_MESSAGE).toMatch(/Stripe/);
  });

  it("returns 502 when the delete-gate billing read fail-closes", async () => {
    installBillingReaderForTests(async () => {
      throw new BillingLookupError();
    });
    const res = await deleteOwnedAccount(
      dummyStore(),
      { id: SESSION },
      { confirm: ACCOUNT_DELETE_CONFIRM },
      FLIPPED,
    );
    expect(res.status).toBe(502);
  });

  it("fails closed when there is no Neon store", async () => {
    await expect(readBillingSubscription(FLIPPED, SESSION)).rejects.toBeInstanceOf(BillingLookupError);
    await expect(readBillingSubscription({ CUTOVER_FLIPPED: "" }, SESSION, dummyStore().sql)).rejects.toBeInstanceOf(
      BillingLookupError,
    );
  });

  it("Neon empty is allow; a row for someone else fail-closes", async () => {
    const db = new PGlite();
    await applyIsolationSchema(db);
    const sql = makePgliteSql(db);
    await expect(readBillingSubscription(FLIPPED, SESSION, sql)).resolves.toBeNull();

    await db.query(
      `INSERT INTO subscriptions (user_id, status, trial_ends_at, plan_source, stripe_subscription_id)
       VALUES ($1, 'active', '2099-01-01T00:00:00Z', 'stripe', 'sub_other')`,
      [PLANNER],
    );
    await expect(readBillingSubscription(FLIPPED, SESSION, sql)).resolves.toBeNull();
    await db.close();
  });

  it("revokes Apple only after the wipe transaction commits", () => {
    const src = readFileSync("worker/src/deleteAccount.ts", "utf8");
    const body = src.slice(src.indexOf("export async function deleteOwnedAccount"));
    const load = body.indexOf("await loadOwnedAppleRefreshToken");
    const wipe = body.indexOf("await wipeOwnedAccount");
    const revoke = body.indexOf("await revokeAppleToken");
    expect(load).toBeGreaterThan(-1);
    expect(wipe).toBeGreaterThan(load);
    expect(revoke).toBeGreaterThan(wipe);
  });

  it("the Worker wipe never holds a Stripe secret or calls Stripe", () => {
    const src = [
      readFileSync("worker/src/deleteAccount.ts", "utf8"),
      readFileSync("worker/src/lib/billingRead.ts", "utf8"),
      readFileSync("worker/src/index.ts", "utf8"),
      readFileSync("worker/src/entitlement.ts", "utf8"),
    ].join("\n");
    // env.ts declares STRIPE_SECRET_KEY now that billing runs on the Worker
    // (worker/src/billing); the delete path itself must still never read it.
    expect(src).not.toMatch(/STRIPE_SECRET/);
    expect(src).not.toMatch(/stripe\.subscriptions/);
    expect(src).not.toMatch(/api\.stripe\.com/);
    expect(src).toContain("user.id");
    expect(src).toContain("wipeOwnedAccount");
    expect(src).not.toMatch(/hasStripeBilling/);
    expect(src).toMatch(/sql && cutoverFlipped\(env\.CUTOVER_FLIPPED\)/);
    expect(src).toContain("readBillingSubscriptionFromNeon");
    expect(src).not.toMatch(/env\.SUPABASE_/);
  });
});

describe("delete-account wipe is one transaction", () => {
  it("rolls back the planner row when the Better Auth delete fails", async () => {
    const db = new PGlite();
    await applyIsolationSchema(db);
    await db.query(
      `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, 'Ada', 'ada-wipe@example.test', true)`,
      [PLANNER],
    );
    const base = makePgliteSql(db);
    const sql = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => base(strings, ...values),
      {
        json: (value: unknown) => base.json(value),
        begin: async <T>(fn: (tx: Sql) => Promise<T>): Promise<T> =>
          base.begin(async (tx) => {
            const failing = Object.assign(
              (strings: TemplateStringsArray, ...values: unknown[]) => {
                if (strings.join("?").includes('DELETE FROM "user"')) {
                  throw new Error("forced second delete");
                }
                return tx(strings, ...values);
              },
              { json: (value: unknown) => tx.json(value) },
            ) as Sql;
            return fn(failing);
          }),
      },
    ) as Sql;

    await expect(wipeOwnedAccount(sql, { plannerUserId: PLANNER, authUserId: PLANNER })).rejects.toThrow(
      /forced second delete/,
    );
    const users = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE id = $1", [PLANNER]);
    const auth = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "user" WHERE id = $1`, [PLANNER]);
    expect(users.rows[0]?.n).toBe(1);
    expect(auth.rows[0]?.n).toBe(1);
    await db.close();
  });
});

function dummyStore(userId = SESSION): Store {
  const sql = Object.assign(
    async (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("DELETE FROM")) return [{ id: userId }];
      return [];
    },
    {
      json: (value: unknown) => value,
      begin: async <T>(fn: (tx: Sql) => Promise<T>) => fn(sql as Sql),
    },
  ) as Sql;
  return { sql, userId };
}
