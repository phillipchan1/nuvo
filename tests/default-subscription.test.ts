import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TRIAL_DAYS,
  canInsertDefaultSubscription,
  defaultSubscriptionRow,
  subscriptionInsertHeaders,
  subscriptionInsertUrl,
} from "../supabase/functions/_shared/defaultSubscription.ts";
import {
  ensureDefaultSubscription,
  installSubscriptionInsertFetchForTests,
} from "../worker/src/lib/ensureSubscription.ts";

const ROOT = join(import.meta.dirname, "..");
const USER = "11111111-1111-4111-8111-111111111111";

describe("default subscriptions row", () => {
  it("matches handle_new_user (trialing + 14 days)", () => {
    const now = new Date("2026-10-27T00:00:00.000Z");
    expect(defaultSubscriptionRow(USER, now)).toEqual({
      user_id: USER,
      status: "trialing",
      trial_ends_at: "2026-11-10T00:00:00.000Z",
    });
    expect(TRIAL_DAYS).toBe(14);
  });

  it("PostgREST URL is ON CONFLICT DO NOTHING", () => {
    expect(subscriptionInsertUrl("https://example.supabase.co/")).toBe(
      "https://example.supabase.co/rest/v1/subscriptions?on_conflict=user_id",
    );
    expect(subscriptionInsertHeaders("svc").Prefer).toMatch(/resolution=ignore-duplicates/);
  });

  it("refuses a non-UUID or missing secrets", () => {
    expect(canInsertDefaultSubscription("nope", "https://example.supabase.co", "svc")).toBe(false);
    expect(canInsertDefaultSubscription(USER, "", "svc")).toBe(false);
    expect(canInsertDefaultSubscription(USER, "https://example.supabase.co", "")).toBe(false);
    expect(canInsertDefaultSubscription(USER, "https://example.supabase.co", "svc")).toBe(true);
  });
});

describe("fresh signup after the flip", () => {
  afterEach(() => {
    installSubscriptionInsertFetchForTests();
  });

  it("Better Auth user.create.after writes the default row to Supabase", async () => {
    const calls: { url: string; prefer?: string | null; body: string }[] = [];
    installSubscriptionInsertFetchForTests(async (input, init) => {
      calls.push({
        url: String(input),
        prefer: new Headers(init?.headers).get("Prefer"),
        body: String(init?.body ?? ""),
      });
      return new Response(null, { status: 201 });
    });
    const ok = await ensureDefaultSubscription(
      { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc" },
      USER,
    );
    expect(ok).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/rest/v1/subscriptions?on_conflict=user_id");
    expect(calls[0]?.prefer).toMatch(/ignore-duplicates/);
    expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({
      user_id: USER,
      status: "trialing",
    });
  });

  it("is a no-op without secrets so signup still succeeds", async () => {
    let called = false;
    installSubscriptionInsertFetchForTests(async () => {
      called = true;
      return new Response(null, { status: 201 });
    });
    expect(await ensureDefaultSubscription({}, USER)).toEqual({ ok: false, retry: true });
    expect(called).toBe(false);
  });

  it("treats 409 / 23503 as a failure and retries", async () => {
    let n = 0;
    installSubscriptionInsertFetchForTests(async () => {
      n += 1;
      return new Response(JSON.stringify({ code: "23503", message: "fk" }), { status: 409 });
    });
    const got = await ensureDefaultSubscription(
      { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc" },
      USER,
    );
    expect(got).toEqual({ ok: false, status: 409, code: "23503", retry: true });
    expect(n).toBe(3);
  });

  it("auth.ts hooks user.create.after and applyPlanUpdate upserts", () => {
    const auth = readFileSync(join(ROOT, "worker/src/auth.ts"), "utf8");
    expect(auth).toMatch(/user:\s*\{/);
    expect(auth).toMatch(/after:\s*async \(user\)/);
    expect(auth).toContain("ensureDefaultSubscription");
    expect(auth).toMatch(/result\.ok/);
    expect(auth).toContain("trustedAuthOrigins(env)");

    const plan = readFileSync(join(ROOT, "supabase/functions/_shared/plan.ts"), "utf8");
    expect(plan).toContain("ensureDefaultRow");
    expect(plan).toContain("ignoreDuplicates: true");
    expect(plan).toContain("defaultSubscriptionRow");

    const live = readFileSync(join(ROOT, "docs/cloudflare-migration/billing-live-check.md"), "utf8");
    expect(live).toMatch(/Fresh signup after the flip/);
    expect(live).toMatch(/user\.create\.after/);
  });
});
