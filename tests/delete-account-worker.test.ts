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
  readBillingSubscription,
  stripePaymentOnFile,
  stripeSubscriptionBlocksDelete,
} from "../worker/src/lib/billingRead.ts";
import { EntitlementUnavailableError, fetchSubscriptionByUserId, installSubscriptionFetcherForTests } from "../worker/src/entitlement.ts";
import { makePgliteSql } from "../worker/src/pgliteSql.ts";
import { wipeOwnedAccount, type Store } from "../worker/src/store.ts";
import type { Sql } from "../worker/src/db.ts";

const SESSION = "aaaaaaaa-aaaa-4000-8000-000000000001";
const PLANNER = "11111111-1111-1111-1111-111111111111";

describe("Worker delete-account Stripe gate", () => {
  afterEach(() => {
    installSubscriptionFetcherForTests(fetchSubscriptionByUserId);
  });

  it("blocks Stripe active / past_due only when a customer or period is on file", () => {
    expect(
      stripeSubscriptionBlocksDelete({
        status: "active",
        plan_source: "stripe",
        stripe_customer_id: "cus_live",
        present: true,
      }),
    ).toBe(true);
    expect(
      stripeSubscriptionBlocksDelete({
        status: "past_due",
        plan_source: "stripe",
        current_period_end: "2026-12-01T00:00:00Z",
        present: true,
      }),
    ).toBe(true);
    expect(
      stripeSubscriptionBlocksDelete({
        status: "active",
        plan_source: "stripe",
        stripe_customer_id: null,
        present: true,
      }),
    ).toBe(false);
    expect(stripePaymentOnFile({ plan_source: "stripe", stripe_customer_id: "cus_live" })).toBe(true);
    expect(stripePaymentOnFile({ plan_source: "stripe", stripe_customer_id: null })).toBe(false);
  });

  it("fails closed on an unknown stripe status even without a visible customer", () => {
    expect(
      stripeSubscriptionBlocksDelete({ status: "paused", plan_source: "stripe", present: true }),
    ).toBe(true);
    expect(
      stripeSubscriptionBlocksDelete({
        status: "unpaid",
        plan_source: "stripe",
        stripe_customer_id: null,
        present: true,
      }),
    ).toBe(true);
  });

  it("does not block a live no-card trial (plan_source null)", () => {
    expect(
      stripeSubscriptionBlocksDelete({
        status: "trialing",
        plan_source: null,
        trial_ends_at: "2099-01-01T00:00:00Z",
        present: true,
      }),
    ).toBe(false);
  });

  it("does not block a lapsed no-card trial (plan_source null)", () => {
    expect(
      stripeSubscriptionBlocksDelete({
        status: "trialing",
        plan_source: null,
        trial_ends_at: "2020-01-01T00:00:00Z",
        present: true,
      }),
    ).toBe(false);
  });

  it("does not block an active StoreKit subscription", () => {
    expect(
      stripeSubscriptionBlocksDelete({ status: "active", plan_source: "apple", present: true }),
    ).toBe(false);
  });

  it("does not block cancelled / incomplete_expired / no row", () => {
    expect(
      stripeSubscriptionBlocksDelete({ status: "cancelled", plan_source: "stripe", present: true }),
    ).toBe(false);
    expect(
      stripeSubscriptionBlocksDelete({
        status: "incomplete_expired",
        plan_source: "stripe",
        present: true,
      }),
    ).toBe(false);
    expect(stripeSubscriptionBlocksDelete(null)).toBe(false);
    expect(stripeSubscriptionBlocksDelete({ present: false })).toBe(false);
  });

  it("does not block a Stripe trial", () => {
    expect(
      stripeSubscriptionBlocksDelete({
        status: "trialing",
        plan_source: "stripe",
        trial_ends_at: "2099-01-01T00:00:00Z",
        present: true,
      }),
    ).toBe(false);
  });

  it("Apple users can delete and are told to cancel in Apple Settings, with no Stripe wording", async () => {
    const restore = installSubscriptionFetcherForTests(async (_env, userId) => ({
      user_id: userId,
      status: "active",
      trial_ends_at: null,
      plan_source: "apple",
    }));
    try {
      const res = await deleteOwnedAccount(
        dummyStore(),
        { id: SESSION },
        { confirm: ACCOUNT_DELETE_CONFIRM },
        { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" },
      );
      expect(res.status).not.toBe(409);
      const body = (await res.json()) as { error?: string; notice?: string; ok?: boolean };
      expect(JSON.stringify(body)).not.toMatch(/Stripe/i);
      expect(body.notice).toBe(APPLE_DELETE_NOTICE);
      expect(body.notice).toMatch(/Apple Account settings/i);
    } finally {
      restore();
    }
  });

  it("reads billing by the session user.id, not the adopted planner id", async () => {
    const restore = installSubscriptionFetcherForTests(async (_env, userId) => {
      if (userId !== SESSION) return null;
      return {
        user_id: SESSION,
        status: "active",
        trial_ends_at: null,
        plan_source: "stripe",
        current_period_end: "2026-12-01T00:00:00Z",
      };
    });
    try {
      const res = await deleteOwnedAccount(
        dummyStore(PLANNER),
        { id: SESSION },
        { confirm: ACCOUNT_DELETE_CONFIRM },
        { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" },
      );
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe(ACTIVE_STRIPE_DELETE_MESSAGE);
    } finally {
      restore();
    }
  });

  it("tells Stripe subscribers to cancel in Billing first", () => {
    expect(ACTIVE_STRIPE_DELETE_MESSAGE).toMatch(/Billing/);
    expect(ACTIVE_STRIPE_DELETE_MESSAGE).toMatch(/cancel/i);
    expect(ACTIVE_STRIPE_DELETE_MESSAGE).toMatch(/Stripe/);
  });

  it("fails closed when the Supabase billing reader is unconfigured", async () => {
    await expect(
      readBillingSubscription({ SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" }, SESSION),
    ).rejects.toBeInstanceOf(BillingLookupError);
  });

  it("treats PostgREST 404/406 as fail-closed, and 200 [] as no row", async () => {
    await expect(
      fetchSubscriptionByUserId(
        { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" },
        SESSION,
        async () => new Response("no", { status: 404 }),
      ),
    ).rejects.toBeInstanceOf(EntitlementUnavailableError);
    await expect(
      fetchSubscriptionByUserId(
        { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" },
        SESSION,
        async () => new Response("no", { status: 406 }),
      ),
    ).rejects.toBeInstanceOf(EntitlementUnavailableError);
    await expect(
      fetchSubscriptionByUserId(
        { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" },
        SESSION,
        async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
      ),
    ).resolves.toBeNull();
  });

  it("the Worker wipe never holds a Stripe secret or calls Stripe", () => {
    const src = [
      readFileSync("worker/src/deleteAccount.ts", "utf8"),
      readFileSync("worker/src/lib/billingRead.ts", "utf8"),
      readFileSync("worker/src/index.ts", "utf8"),
      readFileSync("worker/src/env.ts", "utf8"),
      readFileSync("worker/src/entitlement.ts", "utf8"),
    ].join("\n");
    expect(src).not.toMatch(/STRIPE_SECRET/);
    expect(src).not.toMatch(/stripe\.subscriptions/);
    expect(src).not.toMatch(/api\.stripe\.com/);
    expect(src).toContain("user.id");
    expect(src).toContain("wipeOwnedAccount");
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
