import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  appleTokenMayAttach,
  confirmAppleTransaction,
  evaluateAppleTransaction,
  iapRejectionBody,
  iapVerifyLogLine,
  rejectIap,
  type AppleIapDeps,
  type RailRow,
} from "../supabase/functions/_shared/appleIap";
import * as sharedJws from "../supabase/functions/_shared/appleJws";
import * as workerJws from "../worker/src/billing/appleJws";
import { appStoreApiCredentialsFrom } from "../supabase/functions/_shared/appStoreServerApi";
import { planRowPatch } from "../supabase/functions/_shared/planRules";
import {
  b64,
  basicConstraints,
  cert,
  ext,
  makeAppleTestCa,
  newKey,
  OID_INTER,
  OID_LEAF,
  past,
  future,
  u8,
  type AppleTestCa,
} from "./fixtures/appleTestCa";

// P0 (QA2 #129 P1): `apple-iap` used to write an active Apple plan from
// whatever productId / originalTransactionId / expiresDate the client sent.
// The Supabase function and the Worker route now both run
// `confirmAppleTransaction`; these drive it with a generated Apple-shaped CA.
// The Worker route itself is exercised end to end in worker/src/billing.check.ts.

const USER = "3f2c1a9e-7b4d-4e2a-9c1f-0a1b2c3d4e5f";
const OTHER = "11111111-2222-4333-8444-555555555555";
const SIGNED = Date.parse("2026-11-06T00:00:00Z");
const NOW = new Date("2026-11-09T00:00:00Z");
const EXPIRES = Date.parse("2026-12-09T00:00:00Z");

let ca: AppleTestCa;
let otherCa: AppleTestCa;
beforeAll(async () => {
  ca = await makeAppleTestCa();
  otherCa = await makeAppleTestCa();
});

function txPayload(over: Record<string, unknown> = {}) {
  return {
    bundleId: "day.nuvo.app",
    productId: "NUVO_IAP_MONTHLY",
    transactionId: "2000000001",
    originalTransactionId: "1000000001",
    expiresDate: EXPIRES,
    environment: "Production",
    appAccountToken: USER,
    signedDate: SIGNED,
    type: "Auto-Renewable Subscription",
    ...over,
  };
}

function deps(over: Partial<AppleIapDeps> = {}): AppleIapDeps & { owner: ReturnType<typeof vi.fn> } {
  const owner = vi.fn(async () => null as string | null);
  return {
    bundleId: "day.nuvo.app",
    iapEnv: { NUVO_IAP_MONTHLY: "NUVO_IAP_MONTHLY", NUVO_IAP_ANNUAL: "NUVO_IAP_ANNUAL" },
    apiCredentials: null,
    jwsOptions: { rootFingerprints: [ca.rootFp] },
    now: NOW,
    ownerOfOriginalTransaction: owner,
    railRowOf: async () => null,
    owner,
    ...over,
  };
}

describe("confirmAppleTransaction — the JWS is the only truth", () => {
  it("accepts a verified transaction and writes only signed values (client copies ignored)", async () => {
    const d = deps();
    const r = await confirmAppleTransaction(
      {
        jwsRepresentation: await ca.jws(txPayload()),
        // Every one of these is a lie the old function would have written.
        productId: "NUVO_IAP_ANNUAL",
        originalTransactionId: "999",
        expiresDate: 4_102_444_800_000,
        cancelAtPeriodEnd: true,
        environment: "production",
      },
      USER,
      d,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("jws");
    expect(r.write).toEqual({
      userId: USER,
      plan: "active",
      planSource: "apple",
      currentPeriodEnd: new Date(EXPIRES).toISOString(),
      cancelAtPeriodEnd: false,
      appleOriginalTransactionId: "1000000001",
      appleProductId: "NUVO_IAP_MONTHLY",
      appleEnvironment: "production",
    });
    expect(d.owner).toHaveBeenCalledWith("1000000001");
  });

  it("refuses a forged / unsigned transaction id (old 1.1 body, no API key) — fail closed, 503", async () => {
    const d = deps();
    const r = await confirmAppleTransaction(
      { productId: "NUVO_IAP_MONTHLY", originalTransactionId: "1000000001", transactionId: "2000000001", expiresDate: 4_102_444_800_000 },
      USER,
      d,
    );
    expect(r).toMatchObject({ ok: false, status: 503, code: "verification_unavailable", retriable: true });
    expect(d.owner).not.toHaveBeenCalled();
  });

  it("refuses a body with neither JWS nor transaction id", async () => {
    const r = await confirmAppleTransaction({ productId: "NUVO_IAP_MONTHLY" }, USER, deps());
    expect(r).toMatchObject({ ok: false, status: 400, code: "missing_transaction" });
  });

  it("refuses an unsigned (alg none) / malformed / tampered JWS", async () => {
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const good = await ca.jws(txPayload());
    const [h, , s] = good.split(".");
    const cases = [
      `${enc({ alg: "none" })}.${enc(txPayload())}.`,
      `${enc({ alg: "none", x5c: ca.x5c })}.${enc(txPayload())}.${s}`,
      "not-a-jws",
      `${h}.${enc(txPayload({ expiresDate: 4_102_444_800_000 }))}.${s}`,
    ];
    for (const jwsRepresentation of cases) {
      const d = deps();
      const r = await confirmAppleTransaction({ jwsRepresentation }, USER, d);
      expect(r).toMatchObject({ ok: false, status: 400, code: "unverified" });
      expect(d.owner).not.toHaveBeenCalled();
    }
  });

  it("fails closed on a wrong root, a bad chain and a bad signature", async () => {
    // Wrong root: a perfectly valid chain to a root that isn't pinned.
    expect(await confirmAppleTransaction({ jwsRepresentation: await otherCa.jws(txPayload()) }, USER, deps())).toMatchObject({ code: "unverified" });
    // Real Apple pin (default options): the generated root is refused.
    expect(await confirmAppleTransaction({ jwsRepresentation: await ca.jws(txPayload()) }, USER, deps({ jwsOptions: undefined }))).toMatchObject({ code: "unverified" });
    // Bad chain: leaf not issued by the intermediate.
    const rogue = await newKey("P-256");
    const rogueLeaf = await cert("Rogue", rogue, "Rogue Issuer", rogue, OID_LEAF, past, future);
    const badChain = await ca.jws(txPayload(), { key: rogue, chain: [b64(rogueLeaf), ca.x5c[1]!, ca.x5c[2]!] });
    expect(await confirmAppleTransaction({ jwsRepresentation: badChain }, USER, deps())).toMatchObject({ code: "unverified" });
    // Bad signature: signed by a key that isn't the leaf's.
    const badSig = await ca.jws(txPayload(), { key: await newKey("P-256") });
    expect(await confirmAppleTransaction({ jwsRepresentation: badSig }, USER, deps())).toMatchObject({ code: "unverified" });
  });

  it("accepts Sandbox (App Review / TestFlight) and tags it sandbox", async () => {
    const r = await confirmAppleTransaction({ jwsRepresentation: await ca.jws(txPayload({ environment: "Sandbox" })) }, USER, deps());
    expect(r.ok && r.write.appleEnvironment).toBe("sandbox");
    expect(r.ok && r.tx.environment).toBe("sandbox");
  });

  it("refuses an appAccountToken that is another user; matches case-insensitively and compact", async () => {
    const mismatch = await confirmAppleTransaction({ jwsRepresentation: await ca.jws(txPayload({ appAccountToken: OTHER })) }, USER, deps());
    expect(mismatch).toMatchObject({ ok: false, status: 403, code: "account_mismatch" });
    const garbage = await confirmAppleTransaction({ jwsRepresentation: await ca.jws(txPayload({ appAccountToken: "nope" })) }, USER, deps());
    expect(garbage).toMatchObject({ ok: false, code: "account_mismatch" });
    const upper = await confirmAppleTransaction(
      { jwsRepresentation: await ca.jws(txPayload({ appAccountToken: USER.replace(/-/g, "").toUpperCase() })) },
      USER.toUpperCase(),
      deps(),
    );
    expect(upper.ok).toBe(true);
  });

  it("refuses a lineage already linked to another user; accepts the same user's own", async () => {
    const jwsRepresentation = await ca.jws(txPayload({ appAccountToken: undefined }));
    const taken = await confirmAppleTransaction({ jwsRepresentation }, USER, deps({ ownerOfOriginalTransaction: async () => OTHER }));
    expect(taken).toMatchObject({ ok: false, status: 409, code: "linked_elsewhere" });
    const mine = await confirmAppleTransaction({ jwsRepresentation }, USER, deps({ ownerOfOriginalTransaction: async () => USER.toUpperCase() }));
    expect(mine.ok).toBe(true);
    // A 1.1 purchase (no token) on an unlinked lineage is accepted.
    const fresh = await confirmAppleTransaction({ jwsRepresentation }, USER, deps());
    expect(fresh.ok && fresh.tx.appAccountToken).toBe(null);
  });

  it("propagates a DB error from the ownership lookup (caller answers a generic 500, no write)", async () => {
    await expect(
      confirmAppleTransaction({ jwsRepresentation: await ca.jws(txPayload()) }, USER, deps({ ownerOfOriginalTransaction: async () => { throw new Error("db down"); } })),
    ).rejects.toThrow();
  });

  it("refuses wrong bundle, unknown product, revoked, expired, odd environment, missing bundle config", async () => {
    const run = async (over: Record<string, unknown>, d = deps()) =>
      confirmAppleTransaction({ jwsRepresentation: await ca.jws(txPayload(over)) }, USER, d);
    expect(await run({ bundleId: "com.someone.else" })).toMatchObject({ code: "wrong_bundle", status: 400 });
    expect(await run({ productId: "com.other.app" })).toMatchObject({ code: "unknown_product", status: 400 });
    expect(await run({ revocationDate: SIGNED })).toMatchObject({ code: "revoked", status: 400 });
    expect(await run({ expiresDate: NOW.getTime() })).toMatchObject({ code: "expired", status: 400 });
    expect(await run({ expiresDate: undefined })).toMatchObject({ code: "expired", status: 400 });
    expect(await run({ environment: "Xcode" })).toMatchObject({ code: "bad_environment", status: 400 });
    expect(await run({}, deps({ bundleId: null }))).toMatchObject({ code: "not_configured", status: 503 });
  });
});

describe("confirmAppleTransaction — iOS 1.1 (no JWS) through the App Store Server API", () => {
  async function creds() {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
    const env: Record<string, string> = {
      APPLE_IAP_KEY_ID: "KEY123",
      APPLE_IAP_ISSUER_ID: "issuer-1",
      APPLE_IAP_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----`,
    };
    return { creds: appStoreApiCredentialsFrom((k) => env[k])!, publicKey: pair.publicKey };
  }

  it("asks production, then sandbox, and verifies Apple's answer with the same rules", async () => {
    const { creds: c, publicKey } = await creds();
    const signed = await ca.jws(txPayload({ environment: "Sandbox", appAccountToken: undefined }));
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      seen.push(new URL(url).hostname);
      const token = new Headers(init?.headers).get("authorization")!.replace(/^Bearer /, "");
      const [h, p, s] = token.split(".");
      const header = JSON.parse(Buffer.from(h!, "base64url").toString());
      const claims = JSON.parse(Buffer.from(p!, "base64url").toString());
      const sigOk = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, Buffer.from(s!, "base64url"), new TextEncoder().encode(`${h}.${p}`));
      expect(sigOk).toBe(true);
      expect(header).toMatchObject({ alg: "ES256", kid: "KEY123", typ: "JWT" });
      expect(claims).toMatchObject({ iss: "issuer-1", aud: "appstoreconnect-v1", bid: "day.nuvo.app" });
      expect(new URL(url).pathname).toBe("/inApps/v1/transactions/2000000001");
      return url.includes("sandbox")
        ? new Response(JSON.stringify({ signedTransactionInfo: signed }), { status: 200 })
        : new Response(JSON.stringify({ errorCode: 4040010 }), { status: 404 });
    });
    const r = await confirmAppleTransaction(
      { transactionId: "2000000001", productId: "NUVO_IAP_ANNUAL", expiresDate: 4_102_444_800_000 },
      USER,
      deps({ apiCredentials: c, fetchImpl }),
    );
    expect(seen).toEqual(["api.storekit.itunes.apple.com", "api.storekit-sandbox.itunes.apple.com"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("server_api");
    expect(r.write.appleProductId).toBe("NUVO_IAP_MONTHLY");
    expect(r.write.currentPeriodEnd).toBe(new Date(EXPIRES).toISOString());
    expect(r.write.appleEnvironment).toBe("sandbox");
  });

  it("fails closed on network error, 5xx, unknown transaction, a forged answer, or an answer for another id", async () => {
    const { creds: c } = await creds();
    const run = (fetchImpl: AppleIapDeps["fetchImpl"], transactionId = "2000000001") =>
      confirmAppleTransaction({ transactionId }, USER, deps({ apiCredentials: c, fetchImpl }));
    expect(await run(async () => { throw new TypeError("network"); })).toMatchObject({ code: "apple_unreachable", status: 503 });
    expect(await run(async () => new Response("{}", { status: 500 }))).toMatchObject({ code: "apple_unreachable", status: 503 });
    expect(await run(async () => new Response("{}", { status: 401 }))).toMatchObject({ code: "apple_unreachable", status: 503 });
    expect(await run(async () => new Response("{}", { status: 404 }))).toMatchObject({ code: "unverified", status: 400 });
    const forged = await otherCa.jws(txPayload());
    expect(await run(async () => new Response(JSON.stringify({ signedTransactionInfo: forged })))).toMatchObject({ code: "unverified" });
    const another = await ca.jws(txPayload({ transactionId: "2000000002" }));
    expect(await run(async () => new Response(JSON.stringify({ signedTransactionInfo: another })))).toMatchObject({ code: "unverified" });
    const neverCalled = vi.fn();
    expect(await run(neverCalled as never, "../../v1/notifications")).toMatchObject({ code: "unverified" });
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it("needs all three key parts — a partial set is 'not configured'", () => {
    expect(appStoreApiCredentialsFrom((k) => ({ APPLE_IAP_KEY_ID: "K", APPLE_IAP_ISSUER_ID: "I" } as Record<string, string>)[k])).toBeNull();
  });
});

describe("S2 — a confirm never flips a Stripe-paying account to Apple", () => {
  const stripeActive: RailRow = { status: "active", plan_source: "stripe", stripe_subscription_id: "sub_1" };
  const run = (row: RailRow | null, env = "Production") =>
    ca.jws(txPayload({ environment: env })).then((jwsRepresentation) =>
      confirmAppleTransaction({ jwsRepresentation }, USER, deps({ railRowOf: async () => row })),
    );

  it("refuses 409 active_on_other_rail — production and (especially) sandbox", async () => {
    for (const env of ["Production", "Sandbox"]) {
      expect(await run(stripeActive, env)).toMatchObject({ ok: false, status: 409, code: "active_on_other_rail", retriable: false });
    }
    // A legacy Stripe row with no plan_source yet still counts.
    expect(await run({ status: "active", plan_source: null, stripe_subscription_id: "sub_1" })).toMatchObject({ code: "active_on_other_rail" });
    expect(iapRejectionBody(rejectIap("active_on_other_rail")).error).toMatch(/already has an active subscription/);
  });

  it("allows a trial, a lapsed Stripe row, and the account's own Apple plan", async () => {
    expect((await run(null)).ok).toBe(true);
    expect((await run({ status: "trialing", plan_source: null, stripe_subscription_id: null })).ok).toBe(true);
    expect((await run({ status: "cancelled", plan_source: "stripe", stripe_subscription_id: "sub_1" })).ok).toBe(true);
    expect((await run({ status: "past_due", plan_source: "stripe", stripe_subscription_id: "sub_1" })).ok).toBe(true);
    expect((await run({ status: "active", plan_source: "apple", apple_original_transaction_id: "1000000001" })).ok).toBe(true);
  });

  it("a DB error reading the account's row throws (callers answer a generic 500, no write)", async () => {
    await expect(
      confirmAppleTransaction({ jwsRepresentation: await ca.jws(txPayload()) }, USER, deps({ railRowOf: async () => { throw new Error("db down"); } })),
    ).rejects.toThrow();
  });
});

describe("S7 — every refused confirm is one alertable JSON line, codes only", () => {
  it("apple_unreachable (and every other code) logs event/outcome/code/status/runtime and nothing else", () => {
    for (const runtime of ["supabase", "worker"] as const) {
      const line = iapVerifyLogLine(rejectIap("apple_unreachable"), runtime);
      expect(line).not.toMatch(/\n/);
      expect(JSON.parse(line)).toEqual({ event: "apple_iap_verify", outcome: "rejected", code: "apple_unreachable", status: 503, runtime });
    }
    expect(JSON.parse(iapVerifyLogLine(rejectIap("active_on_other_rail"), "worker"))).toMatchObject({ code: "active_on_other_rail", status: 409 });
  });

  it("both entry points emit it on refusal", () => {
    const root = join(__dirname, "..");
    expect(readFileSync(join(root, "supabase/functions/apple-iap/index.ts"), "utf8")).toMatch(/console\.warn\(iapVerifyLogLine\(verdict, "supabase"\)\)/);
    expect(readFileSync(join(root, "worker/src/billing/handlers.ts"), "utf8")).toMatch(/console\.warn\(iapVerifyLogLine\(verdict, "worker"\)\)/);
  });
});

describe("S1 — certificate extensions are parsed, not searched", () => {
  const pins = () => ({ rootFingerprints: [ca.rootFp] });
  const verify = (chain: string[], key = ca.leafKey) =>
    ca.jws({ hello: 1, signedDate: SIGNED }, { chain, key }).then((j) => sharedJws.verifyAppleJws(j, pins()).then(() => "ok", (e: Error) => e.message));

  it("the generated chain (root + intermediate cA=TRUE, leaf without basicConstraints) verifies", async () => {
    expect(await verify(ca.x5c)).toBe("ok");
    const parsed = sharedJws.parseCertificate(ca.interDer);
    expect(parsed.isCa).toBe(true);
    expect(sharedJws.parseCertificate(ca.leafDer).isCa).toBeNull();
  });

  it("a leaf with an explicit cA=FALSE verifies; a leaf with cA=TRUE is refused", async () => {
    const notCa = await cert("Test Prod ECC Mac App Store", ca.leafKey, "Test WWDR G6", ca.interKey, OID_LEAF, past, future, { ca: false });
    expect(await verify([b64(notCa), ca.x5c[1]!, ca.x5c[2]!])).toBe("ok");
    const isCa = await cert("Test Prod ECC Mac App Store", ca.leafKey, "Test WWDR G6", ca.interKey, OID_LEAF, past, future, { ca: true });
    expect(await verify([b64(isCa), ca.x5c[1]!, ca.x5c[2]!])).toBe("leaf must not be a CA");
  });

  it("an intermediate without cA=TRUE is refused — absent or explicitly FALSE", async () => {
    for (const opt of [{}, { ca: false }]) {
      const inter = await cert("Test WWDR G6", ca.interKey, "Test Root CA - G3", ca.rootKey, OID_INTER, past, future, opt);
      expect(await verify([ca.x5c[0]!, b64(inter), ca.x5c[2]!])).toBe("intermediate is not a CA");
    }
  });

  it("the marker OID as bytes anywhere but an extnID does not count", async () => {
    // Leaf: the App Store OID buried inside another extension's value (old substring search passed this).
    const buried = await cert("Test Prod ECC Mac App Store", ca.leafKey, "Test WWDR G6", ca.interKey, null, past, future, {
      extensions: [ext(u8(0x06, 0x03, 0x2a, 0x03, 0x04), OID_LEAF)],
    });
    expect(await verify([b64(buried), ca.x5c[1]!, ca.x5c[2]!])).toBe("leaf is not an App Store signing certificate");
    // Intermediate: CA, but the WWDR OID only inside the basicConstraints-adjacent value of another extension.
    const inter = await cert("Test WWDR G6", ca.interKey, "Test Root CA - G3", ca.rootKey, null, past, future, {
      extensions: [basicConstraints(true), ext(u8(0x06, 0x03, 0x2a, 0x03, 0x05), OID_INTER)],
    });
    expect(await verify([ca.x5c[0]!, b64(inter), ca.x5c[2]!])).toBe("intermediate is not Apple WWDR");
    // …and the same OID as an extnID does count.
    expect(sharedJws.hasExtension(sharedJws.parseCertificate(ca.leafDer), OID_LEAF)).toBe(true);
    expect(sharedJws.hasExtension(sharedJws.parseCertificate(buried), OID_LEAF)).toBe(false);
  });

  it("a duplicated extension is malformed; names must chain leaf → intermediate → root", async () => {
    const dup = await cert("Test Prod ECC Mac App Store", ca.leafKey, "Test WWDR G6", ca.interKey, null, past, future, {
      extensions: [ext(OID_LEAF, u8(0x05, 0x00)), ext(OID_LEAF, u8(0x05, 0x00))],
    });
    expect(await verify([b64(dup), ca.x5c[1]!, ca.x5c[2]!])).toBe("duplicate extension");
    // Signed by the real intermediate key, but naming a different issuer.
    const misnamed = await cert("Test Prod ECC Mac App Store", ca.leafKey, "Someone Else", ca.interKey, OID_LEAF, past, future);
    expect(await verify([b64(misnamed), ca.x5c[1]!, ca.x5c[2]!])).toBe("x5c names do not chain");
  });
});

describe("pieces", () => {
  it("evaluateAppleTransaction never reads anything but the payload", () => {
    const r = evaluateAppleTransaction(txPayload(), { userId: USER, bundleId: "day.nuvo.app", iapEnv: {}, now: NOW });
    expect(r.ok && r.tx.expiresAt).toBe(new Date(EXPIRES).toISOString());
  });

  it("rejection bodies are generic — no stack, no DB detail", () => {
    const body = iapRejectionBody({ ok: false, status: 409, code: "linked_elsewhere", retriable: false });
    expect(Object.keys(body).sort()).toEqual(["code", "error", "retriable"]);
  });

  it("appleTokenMayAttach: only an account with no Apple lineage that isn't paying on Stripe", () => {
    expect(appleTokenMayAttach(null)).toBe(true);
    expect(appleTokenMayAttach({ status: "trialing", plan_source: null, stripe_subscription_id: null })).toBe(true);
    expect(appleTokenMayAttach({ status: "cancelled", plan_source: "stripe", stripe_subscription_id: "sub_1" })).toBe(true);
    expect(appleTokenMayAttach({ apple_original_transaction_id: "otx", status: "cancelled" })).toBe(false);
    expect(appleTokenMayAttach({ status: "active", plan_source: "stripe", stripe_subscription_id: "sub_1" })).toBe(false);
    expect(appleTokenMayAttach({ status: "trialing", plan_source: "stripe", stripe_subscription_id: "sub_1" })).toBe(false);
  });

  it("planRowPatch carries apple_environment", () => {
    const patch = planRowPatch(null, { plan: "active", planSource: "apple", appleEnvironment: "sandbox" });
    expect(patch.apple_environment).toBe("sandbox");
    expect("apple_environment" in planRowPatch(null, { plan: "active", planSource: "stripe" })).toBe(false);
  });

  it("the Worker and the Supabase functions run ONE verifier", () => {
    expect(workerJws.verifyAppleJws).toBe(sharedJws.verifyAppleJws);
    expect(workerJws.APPLE_ROOT_CA_G3_SHA256).toBe("63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179");
  });
});

describe("both runtimes call the shared decision and trust no body field", () => {
  const root = join(__dirname, "..");
  const fn = readFileSync(join(root, "supabase/functions/apple-iap/index.ts"), "utf8");
  const handlers = readFileSync(join(root, "worker/src/billing/handlers.ts"), "utf8");
  const iapHandler = handlers.slice(handlers.indexOf("export async function handleAppleIap"), handlers.indexOf("// ── referral-code"));

  it("supabase/functions/apple-iap", () => {
    expect(fn).toContain("confirmAppleTransaction(body, user.id");
    expect(fn).toContain("applyPlanUpdate(verdict.write)");
    expect(fn).not.toMatch(/body\??\.(productId|originalTransactionId|expiresDate|cancelAtPeriodEnd|environment|bundleId)/);
    expect(fn).not.toMatch(/json\(\{ error: msg/);
  });

  it("worker handleAppleIap", () => {
    expect(iapHandler).toContain("confirmAppleTransaction(body, user.id");
    expect(iapHandler).toContain("applyPlanUpdate(sql, verdict.write)");
    expect(iapHandler).not.toMatch(/body\??\.(productId|originalTransactionId|expiresDate|cancelAtPeriodEnd|environment|bundleId)/);
  });
});
