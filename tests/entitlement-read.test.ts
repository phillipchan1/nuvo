import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { entitlementUrl } from "../src/lib/backend";
import {
  ENTITLEMENT_TIMEOUT_MS,
  VERIFY_ERROR,
  fetchPostgrestSubscription,
  fetchWorkerEntitlement,
  interpretWorkerEntitlementHttp,
  readSubscription,
  subscriptionFromWorkerBody,
} from "../src/lib/entitlementRead";
import {
  isEntitled,
  resolveEntitlementView,
  type Subscription,
} from "../src/lib/subscription";

const paidPostgrest: Subscription = {
  user_id: "u1",
  status: "active",
  plan: "active",
  plan_source: "stripe",
  trial_ends_at: "2026-08-01T00:00:00Z",
  stripe_customer_id: "cus_x",
  stripe_subscription_id: "sub_x",
  price_id: "price_x",
  current_period_end: "2026-09-01T00:00:00Z",
  cancel_at_period_end: false,
  entitled: true,
};

const freePostgrest: Subscription = {
  ...paidPostgrest,
  status: "trialing",
  plan: "trialing",
  trial_ends_at: "2026-01-01T00:00:00Z",
  entitled: false,
};

const workerPaid = {
  entitled: true,
  present: true,
  plan: "active",
  plan_source: "stripe",
  status: "active",
  trial_ends_at: "2026-08-01T00:00:00Z",
};

const workerFree = {
  entitled: false,
  present: true,
  plan: "trialing",
  plan_source: null,
  status: "trialing",
  trial_ends_at: "2026-01-01T00:00:00Z",
};

const workerApplePaid = {
  ...workerPaid,
  plan_source: "apple",
};

function view(args: {
  subscription?: Subscription | null;
  subPending?: boolean;
  subError?: boolean;
  wasEntitled?: boolean;
}) {
  return resolveEntitlementView({
    subPending: args.subPending ?? false,
    subError: args.subError ?? false,
    subscription: args.subscription,
    checkoutPending: false,
    wasEntitled: args.wasEntitled ?? false,
  });
}

describe("entitlementUrl follows the Worker flag", () => {
  it("is empty when the auth base is empty (today's path)", () => {
    expect(entitlementUrl("")).toBe("");
  });

  it("is GET /api/entitlement when the auth base points at the Worker", () => {
    expect(entitlementUrl("/api")).toBe("/api/entitlement");
    expect(entitlementUrl("https://nuvo-preview.example.workers.dev/api")).toBe(
      "https://nuvo-preview.example.workers.dev/api/entitlement",
    );
  });
});

describe("an entitled user stays entitled on both paths", () => {
  it("PostgREST paid row opens", () => {
    expect(isEntitled(paidPostgrest)).toBe(true);
    expect(view({ subscription: paidPostgrest })).toBe("open");
  });

  it("Worker paid body maps to the same yes", () => {
    const row = subscriptionFromWorkerBody(workerPaid);
    expect(row).not.toBeNull();
    expect(isEntitled(row)).toBe(true);
    expect(view({ subscription: row })).toBe("open");
  });

  it("Worker Apple-paid body is the same yes as Stripe", () => {
    const row = subscriptionFromWorkerBody(workerApplePaid);
    expect(isEntitled(row)).toBe(true);
    expect(view({ subscription: row })).toBe("open");
  });
});

describe("a free user stays free on both paths", () => {
  it("PostgREST lapsed trial locks", () => {
    expect(isEntitled(freePostgrest)).toBe(false);
    expect(view({ subscription: freePostgrest })).toBe("locked");
  });

  it("Worker lapsed body maps to the same no", () => {
    const row = subscriptionFromWorkerBody(workerFree);
    expect(row).not.toBeNull();
    expect(isEntitled(row)).toBe(false);
    expect(view({ subscription: row })).toBe("locked");
  });

  it("Worker present:false is an empty row, not a paid unlock", () => {
    expect(subscriptionFromWorkerBody({ present: false, entitled: false })).toBeNull();
    expect(isEntitled(null)).toBe(false);
    expect(view({ subscription: null })).toBe("locked");
  });
});

describe("the Worker path failing does not silently unlock paid features", () => {
  it("503 is fail, never a row", () => {
    expect(interpretWorkerEntitlementHttp(503, { error: "service unavailable" })).toEqual({
      action: "fail",
      reason: "entitlement 503",
    });
  });

  it("401 is fail, never not-entitled", () => {
    expect(interpretWorkerEntitlementHttp(401, { error: "unauthorized" })).toEqual({
      action: "fail",
      reason: "unauthorized",
    });
  });

  it("a malformed 200 is fail", () => {
    expect(interpretWorkerEntitlementHttp(200, { entitled: true })).toEqual({
      action: "fail",
      reason: "invalid entitlement body",
    });
    expect(interpretWorkerEntitlementHttp(200, { present: true, status: "nope" })).toEqual({
      action: "fail",
      reason: "invalid entitlement body",
    });
  });

  it("network / 503 throws and the shell stays on verify-error without a hint", async () => {
    await expect(
      fetchWorkerEntitlement({
        url: "/api/entitlement",
        token: "tok.hmac",
        fetchImpl: async () => {
          throw new Error("network down");
        },
      }),
    ).rejects.toThrow(VERIFY_ERROR);
    await expect(
      fetchWorkerEntitlement({
        url: "/api/entitlement",
        token: "tok.hmac",
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "service unavailable" }), { status: 503 }),
      }),
    ).rejects.toThrow(VERIFY_ERROR);
    expect(view({ subError: true, wasEntitled: false })).toBe("verify-error");
  });

  it("a last-launch hint still holds the planner open through a Worker blip", () => {
    expect(view({ subError: true, wasEntitled: true })).toBe("open");
  });

  it("readSubscription on the Worker path never falls through to PostgREST on error", async () => {
    const postgrest = vi.fn();
    await expect(
      readSubscription({
        workersEnabled: true,
        token: "tok.hmac",
        url: "/api/entitlement",
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "service unavailable" }), { status: 503 }),
        postgrest: postgrest as never,
      }),
    ).rejects.toThrow(VERIFY_ERROR);
    expect(postgrest).not.toHaveBeenCalled();
  });
});

describe("loading states match on both paths", () => {
  const pending = { subPending: true as const, wasEntitled: false };

  it("first fetch with nothing to trust is loading, Worker or PostgREST", () => {
    expect(view({ ...pending, subscription: undefined })).toBe("loading");
  });

  it("an in-memory paid row opens on both paths while a refetch is in flight", () => {
    expect(view({ ...pending, subscription: paidPostgrest })).toBe("open");
    expect(view({ ...pending, subscription: subscriptionFromWorkerBody(workerPaid) })).toBe("open");
  });

  it("a last-launch hint opens instead of blocking on either path", () => {
    expect(view({ subPending: true, wasEntitled: true })).toBe("open");
    expect(view({ subPending: true, wasEntitled: true, subscription: undefined })).toBe("open");
  });
});

describe("fetchWorkerEntitlement sends the Better Auth session", () => {
  it("GETs the entitlement URL with Bearer + credentials", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/entitlement");
      expect(init?.method).toBe("GET");
      expect(init?.credentials).toBe("include");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer tok.hmac");
      return new Response(JSON.stringify(workerPaid), { status: 200 });
    });
    const row = await fetchWorkerEntitlement({
      url: "/api/entitlement",
      token: "tok.hmac",
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(isEntitled(row)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("times out on the same 8s bound as PostgREST", () => {
    expect(ENTITLEMENT_TIMEOUT_MS).toBe(8_000);
  });
});

describe("the PostgREST path is unchanged when the flag is off", () => {
  it("readSubscription does not call fetch when workersEnabled is false", async () => {
    const fetchImpl = vi.fn();
    const client = {
      from: () => ({
        select: () => ({
          abortSignal: () => ({
            maybeSingle: async () => ({ data: paidPostgrest, error: null }),
          }),
        }),
      }),
      auth: {
        getSession: async () => ({ data: { session: { access_token: "jwt" } } }),
        refreshSession: async () => ({}),
      },
    };
    const row = await readSubscription({
      workersEnabled: false,
      fetchImpl: fetchImpl as typeof fetch,
      postgrest: client,
    });
    expect(row).toEqual(paidPostgrest);
    expect(isEntitled(row)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries a null PostgREST read with a live session once, then fails", async () => {
    let calls = 0;
    const client = {
      from: () => ({
        select: () => ({
          abortSignal: () => ({
            maybeSingle: async () => {
              calls += 1;
              return { data: null, error: null };
            },
          }),
        }),
      }),
      auth: {
        getSession: async () => ({ data: { session: { access_token: "jwt" } } }),
        refreshSession: async () => ({}),
      },
    };
    await expect(fetchPostgrestSubscription(client)).rejects.toThrow(VERIFY_ERROR);
    expect(calls).toBe(2);
  });
});

describe("this plumbing does not touch billing writers", () => {
  const files = [
    new URL("../src/lib/entitlementRead.ts", import.meta.url).pathname,
    new URL("../src/hooks/useSubscription.ts", import.meta.url).pathname,
  ];
  const bannedImport = /from\s+["'][^"']*(stripeBilling|\/iap(?:\/|"|')|stripe-checkout|stripe-portal|stripe-webhook|apple-iap|apple-webhook)/;

  it("does not import payment-rail writers", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} imports a billing writer`).not.toMatch(bannedImport);
      expect(source).not.toContain("confirmApplePurchase");
      expect(source).not.toContain("restorePurchases");
    }
  });
});
