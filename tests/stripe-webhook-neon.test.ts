import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const webhook = readFileSync(join(ROOT, "supabase/functions/stripe-webhook/index.ts"), "utf8");
const notify = readFileSync(join(ROOT, "supabase/functions/_shared/referralNotify.ts"), "utf8");
const functions = ["apple-iap", "stripe-checkout", "stripe-portal", "referral-code"] as const;

describe("stripe-webhook after the flip", () => {
  it("does not look the user up in GoTrue", () => {
    expect(webhook).not.toMatch(/getUserById/);
    expect(webhook).toContain("stripePayerEmail");
  });

  it("keeps the ledger row when the handler fails", () => {
    expect(webhook).not.toMatch(/stripe_webhook_events"\)\.delete/);
    expect(webhook).toMatch(/Keep the ledger row/);
    expect(webhook).toContain('return json({ error: "handler failed" }, 500)');
  });
});

describe("referralNotify after the flip", () => {
  it("looks the user up through the Worker, not GoTrue", () => {
    expect(notify).toContain("workerUserEmail");
    expect(notify).toContain("NUVO_API_URL");
    expect(notify).not.toMatch(/getUserById/);
  });
});

describe("billing write paths ignore a client-supplied user id", () => {
  it("each proxied function writes requireUser().id, never body.user_id", () => {
    for (const name of functions) {
      const src = readFileSync(join(ROOT, `supabase/functions/${name}/index.ts`), "utf8");
      expect(src, name).toContain("requireUser");
      expect(src, name).toMatch(/user\.id/);
      expect(src, name).not.toMatch(/body\.user_id/);
      expect(src, name).not.toMatch(/body\.actingUserId/);
    }
  });

  it("the Worker proxy forwards only the verified session id", () => {
    const proxy = readFileSync(join(ROOT, "worker/src/billingProxy.ts"), "utf8");
    const index = readFileSync(join(ROOT, "worker/src/index.ts"), "utf8");
    expect(index).toMatch(/proxyBillingFunction\(c, name, got\.user\)/);
    expect(proxy).not.toMatch(/body\.user_id|body\.actingUserId/);
    expect(proxy).not.toMatch(/c\.req\.header\(["']x-nuvo-acting-user["']\)/);
    expect(proxy).toContain("headers.set(ACTING_USER_HEADER, user.id)");
  });
});
