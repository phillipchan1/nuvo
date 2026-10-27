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
  billingSubscriptionQueryUrl,
  installBillingReaderForTests,
  readBillingSubscription,
  stripeSubscriptionBlocksDelete,
} from "../worker/src/lib/billingRead.ts";
import { fetchSubscriptionByUserId } from "../worker/src/entitlement.ts";
import { makePgliteSql } from "../worker/src/pgliteSql.ts";
import { wipeOwnedAccount, type Store } from "../worker/src/store.ts";
import type { Sql } from "../worker/src/db.ts";

const SESSION = "aaaaaaaa-aaaa-4000-8000-000000000001";
const PLANNER = "11111111-1111-1111-1111-111111111111";
const ENV = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" };

function postgrest(status: number, body: unknown): typeof fetch {
  return async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
}

function stripeRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: SESSION,
    status: "active",
    plan_source: "stripe",
    stripe_subscription_id: "sub_live",
    stripe_customer_id: "cus_live",
    current_period_end: null,
    ...overrides,
  };
}

describe("Worker delete-account Stripe gate", () => {
  afterEach(() => {
    installBillingReaderForTests(async () => null)();
  });

  it("reads through readBillingSubscription and never puts Stripe ids on the row", async () => {
    const url = billingSubscriptionQueryUrl(ENV.SUPABASE_URL, SESSION);
    expect(url).toContain("user_id=eq." + SESSION);
    expect(url).toContain("stripe_subscription_id");
    expect(url).not.toContain("stripe_customer_id");

    const row = await readBillingSubscription(
      ENV,
      SESSION,
      postgrest(200, [stripeRow({ current_period_end: null })]),
    );
    expect(row?.hasStripeSubscription).toBe(true);
    expect(row).not.toHaveProperty("stripe_subscription_id");
    expect(row).not.toHaveProperty("stripe_customer_id");
    expect(stripeSubscriptionBlocksDelete(row)).toBe(true);
  });

  it("active / past_due / unpaid Stripe subscriptions refuse, even with a null period end", async () => {
    for (const status of ["active", "past_due", "unpaid"] as const) {
      const row = await readBillingSubscription(
        ENV,
        SESSION,
        postgrest(200, [stripeRow({ status, current_period_end: null })]),
      );
      expect(stripeSubscriptionBlocksDelete(row), status).toBe(true);
    }
  });

  it("canceled / incomplete_expired / no row all allow", async () => {
    for (const status of ["cancelled", "canceled", "incomplete_expired"] as const) {
      const row = await readBillingSubscription(
        ENV,
        SESSION,
        postgrest(200, [stripeRow({ status })]),
      );
      expect(stripeSubscriptionBlocksDelete(row), status).toBe(false);
    }
    await expect(readBillingSubscription(ENV, SESSION, postgrest(200, []))).resolves.toBeNull();
    expect(stripeSubscriptionBlocksDelete(null)).toBe(false);
    expect(stripeSubscriptionBlocksDelete({ present: false })).toBe(false);
  });

  it("an apple-labeled user with an active Stripe subscription refuses", async () => {
    const row = await readBillingSubscription(
      ENV,
      SESSION,
      postgrest(200, [
        stripeRow({
          plan_source: "apple",
          status: "active",
          stripe_subscription_id: "sub_still_live",
        }),
      ]),
    );
    expect(row?.plan_source).toBe("apple");
    expect(row?.hasStripeSubscription).toBe(true);
    expect(stripeSubscriptionBlocksDelete(row)).toBe(true);
  });

  it("an apple user without a Stripe subscription allows", async () => {
    const row = await readBillingSubscription(
      ENV,
      SESSION,
      postgrest(200, [
        {
          user_id: SESSION,
          status: "active",
          plan_source: "apple",
          stripe_subscription_id: null,
          stripe_customer_id: "cus_leftover",
        },
      ]),
    );
    expect(row?.plan_source).toBe("apple");
    expect(row?.hasStripeSubscription).toBe(false);
    expect(stripeSubscriptionBlocksDelete(row)).toBe(false);
  });

  it("does not gate on stripe_customer_id alone", async () => {
    const row = await readBillingSubscription(
      ENV,
      SESSION,
      postgrest(200, [
        {
          user_id: SESSION,
          status: "active",
          plan_source: "apple",
          stripe_customer_id: "cus_only",
          stripe_subscription_id: null,
        },
      ]),
    );
    expect(row?.hasStripeSubscription).toBe(false);
    expect(stripeSubscriptionBlocksDelete(row)).toBe(false);
  });

  it("a no-card trial with no Stripe subscription can delete", async () => {
    const live = await readBillingSubscription(
      ENV,
      SESSION,
      postgrest(200, [
        {
          user_id: SESSION,
          status: "trialing",
          plan_source: null,
          trial_ends_at: "2099-01-01T00:00:00Z",
          stripe_subscription_id: null,
        },
      ]),
    );
    const lapsed = await readBillingSubscription(
      ENV,
      SESSION,
      postgrest(200, [
        {
          user_id: SESSION,
          status: "trialing",
          plan_source: null,
          trial_ends_at: "2020-01-01T00:00:00Z",
          stripe_subscription_id: null,
        },
      ]),
    );
    expect(stripeSubscriptionBlocksDelete(live)).toBe(false);
    expect(stripeSubscriptionBlocksDelete(lapsed)).toBe(false);
  });

  it("fails closed on an unknown stripe status", async () => {
    const row = await readBillingSubscription(
      ENV,
      SESSION,
      postgrest(200, [stripeRow({ status: "paused" })]),
    );
    expect(stripeSubscriptionBlocksDelete(row)).toBe(true);
  });

  it("Apple users can delete and are told to cancel in Apple Settings, with no Stripe wording", async () => {
    const res = await deleteOwnedAccount(
      dummyStore(),
      { id: SESSION },
      { confirm: ACCOUNT_DELETE_CONFIRM },
      ENV,
      postgrest(200, [
        {
          user_id: SESSION,
          status: "active",
          plan_source: "apple",
          stripe_subscription_id: null,
        },
      ]),
    );
    expect(res.status).not.toBe(409);
    const body = (await res.json()) as { error?: string; notice?: string; ok?: boolean };
    expect(JSON.stringify(body)).not.toMatch(/Stripe/i);
    expect(body.notice).toBe(APPLE_DELETE_NOTICE);
    expect(body.notice).toMatch(/Apple Account settings/i);
  });

  it("reads billing by the session user.id, not the adopted planner id", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      seen.push(href);
      return new Response(JSON.stringify([stripeRow()]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const res = await deleteOwnedAccount(
      dummyStore(PLANNER),
      { id: SESSION },
      { confirm: ACCOUNT_DELETE_CONFIRM },
      ENV,
      fetchImpl,
    );
    expect(res.status).toBe(409);
    expect(seen.some((u) => u.includes(SESSION) && !u.includes(PLANNER))).toBe(true);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe(ACTIVE_STRIPE_DELETE_MESSAGE);
  });

  it("tells Stripe subscribers to cancel in Billing first", () => {
    expect(ACTIVE_STRIPE_DELETE_MESSAGE).toMatch(/Billing/);
    expect(ACTIVE_STRIPE_DELETE_MESSAGE).toMatch(/cancel/i);
    expect(ACTIVE_STRIPE_DELETE_MESSAGE).toMatch(/Stripe/);
  });

  it("fails closed when the Supabase billing reader is unconfigured", async () => {
    await expect(
      readBillingSubscription({ SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" }, SESSION, postgrest(200, [])),
    ).rejects.toBeInstanceOf(BillingLookupError);
  });

  it("treats PostgREST 404/406 as fail-closed on the delete-gate read only", async () => {
    await expect(readBillingSubscription(ENV, SESSION, postgrest(404, "no"))).rejects.toBeInstanceOf(
      BillingLookupError,
    );
    await expect(readBillingSubscription(ENV, SESSION, postgrest(406, "no"))).rejects.toBeInstanceOf(
      BillingLookupError,
    );
    await expect(readBillingSubscription(ENV, SESSION, postgrest(200, []))).resolves.toBeNull();

    await expect(
      fetchSubscriptionByUserId(ENV, SESSION, postgrest(404, "no")),
    ).resolves.toBeNull();
    await expect(
      fetchSubscriptionByUserId(ENV, SESSION, postgrest(406, "no")),
    ).resolves.toBeNull();
  });

  it("revokes Apple only after the wipe transaction commits", () => {
    const src = readFileSync("worker/src/deleteAccount.ts", "utf8");
    const load = src.indexOf("loadOwnedAppleRefreshToken");
    const wipe = src.indexOf("wipeOwnedAccount");
    const revoke = src.indexOf("revokeAppleToken");
    expect(load).toBeGreaterThan(-1);
    expect(wipe).toBeGreaterThan(load);
    expect(revoke).toBeGreaterThan(wipe);
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
    expect(src).not.toMatch(/hasStripeBilling/);
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
