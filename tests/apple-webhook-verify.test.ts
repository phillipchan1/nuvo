import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideAppleNotification,
  handleAppleNotification,
  type AppleLinkedRow,
  type AppleWebhookApplyArgs,
  type AppleWebhookApplyResult,
  type AppleWebhookConfig,
  type AppleWebhookStore,
} from "../supabase/functions/_shared/appleWebhook";
import { b64url, makeAppleTestCa, type AppleTestCa } from "./fixtures/appleTestCa";

// P0: the Supabase `apple-webhook` decoded `signedPayload` and the nested
// `signedTransactionInfo` without checking a signature, so anyone with the URL
// could post a plan change. It now runs `handleAppleNotification`
// (_shared/appleWebhook.ts) and writes through `public.apple_webhook_apply`
// (migration 92) — driven here end to end: a generated Apple-shaped CA signs
// the notifications, PGlite runs the real migration.

const USER = "3f2c1a9e-7b4d-4e2a-9c1f-0a1b2c3d4e5f";
const OTHER_USER = "11111111-2222-4333-8444-555555555555";
const OTX = "1000000001";
const SIGNED = Date.parse("2026-11-06T00:00:00Z");
const EXPIRES = Date.parse("2026-12-09T00:00:00Z");
const MIGRATION = readFileSync("supabase/migrations/00000000000092_apple_webhook_apply.sql", "utf8");

const ROLES = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
`;

// The production columns the webhook touches (41 + 70 + 75), with their checks.
const SCHEMA = ROLES + `
  create table public.subscriptions (
    user_id uuid primary key,
    status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'cancelled')),
    trial_ends_at timestamptz not null default now() + interval '14 days',
    stripe_customer_id text unique,
    stripe_subscription_id text unique,
    current_period_end timestamptz,
    cancel_at_period_end boolean not null default false,
    plan_source text check (plan_source is null or plan_source in ('stripe', 'apple')),
    apple_original_transaction_id text unique,
    apple_product_id text,
    apple_environment text check (apple_environment in ('production', 'sandbox'))
  );
  create table public.apple_webhook_events (event_id text primary key, created_at timestamptz not null default now());
  -- Fault injection: while fail_next has a row, every subscriptions UPDATE raises.
  create table public.fail_next (x int);
  create function public.fail_while_flagged() returns trigger language plpgsql as $$
  begin
    if exists (select 1 from public.fail_next) then
      raise exception 'injected failure';
    end if;
    return new;
  end $$;
  create trigger subscriptions_fail before update on public.subscriptions
    for each row execute function public.fail_while_flagged();
`;

let ca: AppleTestCa;
let otherCa: AppleTestCa;
let db: PGlite;

beforeAll(async () => {
  ca = await makeAppleTestCa();
  otherCa = await makeAppleTestCa();
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(MIGRATION);
});

beforeEach(async () => {
  await db.exec(`truncate public.subscriptions, public.apple_webhook_events, public.fail_next`);
  // Linked by an earlier `apple-iap` confirm; the webhook only ever matches on the lineage.
  await db.query(
    `insert into public.subscriptions (user_id, status, plan_source, apple_original_transaction_id) values ($1, 'trialing', null, $2)`,
    [USER, OTX],
  );
  await db.query(`insert into public.subscriptions (user_id, status) values ($1, 'trialing')`, [OTHER_USER]);
});

function cfg(over: Partial<AppleWebhookConfig> = {}): AppleWebhookConfig {
  return {
    bundleId: "day.nuvo.app",
    iapEnv: { NUVO_IAP_MONTHLY: "NUVO_IAP_MONTHLY", NUVO_IAP_ANNUAL: "NUVO_IAP_ANNUAL" },
    jwsOptions: { rootFingerprints: [ca.rootFp] },
    ...over,
  };
}

const logs: string[] = [];
function pgStore(): AppleWebhookStore & { applyCalls: number } {
  const s = {
    applyCalls: 0,
    async findByOriginalTransaction(otx: string) {
      const r = await db.query<AppleLinkedRow>(
        `select user_id::text as user_id, status, plan_source from public.subscriptions where apple_original_transaction_id = $1`,
        [otx],
      );
      return r.rows[0] ?? null;
    },
    async claimAndApply(args: AppleWebhookApplyArgs) {
      s.applyCalls++;
      return await rpc(args);
    },
    async log(operation: string, status: "ok" | "error", message: string) {
      logs.push(`${operation} ${status} ${message}`);
    },
  };
  return s;
}

async function rpc(args: AppleWebhookApplyArgs): Promise<AppleWebhookApplyResult> {
  const r = await db.query<{ r: AppleWebhookApplyResult }>(
    `select public.apple_webhook_apply($1, $2, $3, $4, $5, $6::jsonb) as r`,
    [
      args.p_event_id,
      args.p_original_transaction_id,
      args.p_expected_user_id,
      args.p_expected_status,
      args.p_expected_plan_source,
      JSON.stringify(args.p_patch),
    ],
  );
  return r.rows[0]!.r;
}

function tx(over: Record<string, unknown> = {}) {
  return {
    bundleId: "day.nuvo.app",
    productId: "NUVO_IAP_MONTHLY",
    transactionId: "2000000001",
    originalTransactionId: OTX,
    expiresDate: EXPIRES,
    environment: "Production",
    signedDate: SIGNED,
    type: "Auto-Renewable Subscription",
    ...over,
  };
}

function renewal(over: Record<string, unknown> = {}) {
  return {
    originalTransactionId: OTX,
    productId: "NUVO_IAP_MONTHLY",
    autoRenewProductId: "NUVO_IAP_MONTHLY",
    autoRenewStatus: 1,
    environment: "Production",
    signedDate: SIGNED,
    ...over,
  };
}

interface NoteOpts {
  type?: string;
  subtype?: string;
  uuid?: string;
  data?: Record<string, unknown>;
  tx?: Record<string, unknown> | null;
  renewal?: Record<string, unknown> | null;
  signer?: AppleTestCa;
  txSigner?: AppleTestCa;
  renewalSigner?: AppleTestCa;
}

async function notification(o: NoteOpts = {}) {
  const data: Record<string, unknown> = {
    bundleId: "day.nuvo.app",
    environment: "Production",
    ...(o.tx === null ? {} : { signedTransactionInfo: await (o.txSigner ?? ca).jws(tx(o.tx)) }),
    ...(o.renewal === undefined || o.renewal === null
      ? {}
      : { signedRenewalInfo: await (o.renewalSigner ?? ca).jws(renewal(o.renewal)) }),
    ...o.data,
  };
  const signedPayload = await (o.signer ?? ca).jws({
    notificationType: o.type ?? "DID_RENEW",
    ...(o.subtype ? { subtype: o.subtype } : {}),
    notificationUUID: o.uuid ?? "6f0a1d2e-0000-4000-8000-000000000001",
    data,
    version: "2.0",
    signedDate: SIGNED,
  });
  return { signedPayload };
}

async function post(body: unknown, opts: { cfg?: AppleWebhookConfig; store?: AppleWebhookStore; secretOk?: boolean } = {}) {
  return handleAppleNotification(
    { method: "POST", secretOk: opts.secretOk ?? true, body },
    opts.cfg ?? cfg(),
    opts.store ?? pgStore(),
  );
}

async function row(userId = USER) {
  const r = await db.query<{
    status: string;
    plan_source: string | null;
    current_period_end: Date | null;
    cancel_at_period_end: boolean;
    apple_product_id: string | null;
    apple_environment: string | null;
    apple_original_transaction_id: string | null;
  }>(`select * from public.subscriptions where user_id = $1`, [userId]);
  return r.rows[0]!;
}

async function ledger(): Promise<string[]> {
  return (await db.query<{ event_id: string }>(`select event_id from public.apple_webhook_events order by 1`)).rows.map((r) => r.event_id);
}

async function expectNoWrite() {
  const r = await row();
  expect(r.status).toBe("trialing");
  expect(r.plan_source).toBeNull();
  expect(r.current_period_end).toBeNull();
  expect(r.apple_environment).toBeNull();
  expect(await ledger()).toEqual([]);
}

describe("apple-webhook — verification fails closed", () => {
  it("applies a genuine production notification", async () => {
    const res = await post(await notification());
    expect(res).toEqual({ status: 200, body: { received: true } });
    const r = await row();
    expect(r.status).toBe("active");
    expect(r.plan_source).toBe("apple");
    expect(r.current_period_end?.toISOString()).toBe(new Date(EXPIRES).toISOString());
    expect(r.apple_environment).toBe("production");
    expect(r.apple_product_id).toBe("NUVO_IAP_MONTHLY");
    expect(await ledger()).toEqual(["6f0a1d2e-0000-4000-8000-000000000001"]);
  });

  it("rejects an unsigned payload (decodable, but no signature) with no write", async () => {
    const forged = await notification();
    const [h, p] = forged.signedPayload.split(".");
    for (const signedPayload of [`${h}.${p}.`, `${h}.${p}`, `${b64url(new TextEncoder().encode('{"alg":"none"}'))}.${p}.x`]) {
      const res = await post({ signedPayload });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "rejected", code: "unverified" });
    }
    await expectNoWrite();
  });

  it("rejects a forged payload: the genuine chain, signed by someone else's key", async () => {
    const res = await post({ signedPayload: await ca.jws({ notificationType: "DID_RENEW", notificationUUID: "u" }, { key: otherCa.leafKey }) });
    expect(res).toMatchObject({ status: 400, body: { code: "unverified" } });
    await expectNoWrite();
  });

  it("rejects a payload whose signed segment was edited after signing", async () => {
    const genuine = (await notification()).signedPayload;
    const [h, , s] = genuine.split(".");
    const edited = b64url(new TextEncoder().encode(JSON.stringify({ notificationType: "DID_RENEW", notificationUUID: "x" })));
    expect((await post({ signedPayload: `${h}.${edited}.${s}` })).status).toBe(400);
    await expectNoWrite();
  });

  it("rejects a chain that ends in a root other than the pinned one", async () => {
    const res = await post(await notification({ signer: otherCa, txSigner: otherCa }));
    expect(res).toMatchObject({ status: 400, body: { code: "unverified" } });
    // And under the real Apple G3 pin, the test CA itself is refused.
    const real = await post(await notification(), { cfg: cfg({ jwsOptions: undefined }) });
    expect(real).toMatchObject({ status: 400, body: { code: "unverified" } });
    await expectNoWrite();
  });

  it("rejects a genuine envelope around a badly signed signedTransactionInfo — no write, no claim", async () => {
    const res = await post(await notification({ txSigner: otherCa }));
    expect(res).toMatchObject({ status: 400, body: { code: "unverified_transaction" } });
    await expectNoWrite();

    const garbage = await notification({ data: { signedTransactionInfo: "not.a.jws" } });
    expect(await post(garbage)).toMatchObject({ status: 400, body: { code: "unverified_transaction" } });
    await expectNoWrite();
  });

  it("rejects a badly signed signedRenewalInfo, and renewal info for another lineage", async () => {
    expect(await post(await notification({ renewal: {}, renewalSigner: otherCa }))).toMatchObject({
      status: 400,
      body: { code: "unverified_renewal" },
    });
    expect(await post(await notification({ renewal: { originalTransactionId: "999" } }))).toMatchObject({
      status: 400,
      body: { code: "lineage_mismatch" },
    });
    await expectNoWrite();
    // A genuine one is fine.
    expect((await post(await notification({ renewal: {} }))).status).toBe(200);
    expect((await row()).status).toBe("active");
  });

  it("refuses with 401 when the URL secret is configured and wrong, before anything else", async () => {
    const store = pgStore();
    expect(await post(await notification(), { secretOk: false, store })).toEqual({ status: 401, body: { error: "unauthorized" } });
    expect(store.applyCalls).toBe(0);
    await expectNoWrite();
  });
});

describe("apple-webhook — bundle and environment", () => {
  it("missing APPLE_BUNDLE_ID fails closed with a retriable 503 and no write", async () => {
    const store = pgStore();
    const res = await post(await notification(), { cfg: cfg({ bundleId: null }), store });
    expect(res).toEqual({ status: 503, body: { error: "rejected", code: "not_configured" } });
    expect(store.applyCalls).toBe(0);
    await expectNoWrite();
  });

  it("a verified notification for another bundle is refused (4xx, so Apple keeps retrying) with no write", async () => {
    expect(await post(await notification({ data: { bundleId: "com.nuvo.app" } }))).toMatchObject({
      status: 400,
      body: { code: "wrong_bundle" },
    });
    expect(await post(await notification({ tx: { bundleId: "com.nuvo.app" } }))).toMatchObject({
      status: 400,
      body: { code: "wrong_bundle" },
    });
    // tauri.conf.json's identifier is com.nuvo.app — it is NOT what Apple signs.
    expect(await post(await notification(), { cfg: cfg({ bundleId: "com.nuvo.app" }) })).toMatchObject({
      status: 400,
      body: { code: "wrong_bundle" },
    });
    await expectNoWrite();
  });

  it("accepts a sandbox notification and tags the row environment=sandbox", async () => {
    const res = await post(await notification({ data: { environment: "Sandbox" }, tx: { environment: "Sandbox" } }));
    expect(res.status).toBe(200);
    const r = await row();
    expect(r.status).toBe("active");
    expect(r.apple_environment).toBe("sandbox");
  });

  it("rejects when the envelope and the transaction disagree about the environment", async () => {
    expect(await post(await notification({ data: { environment: "Sandbox" } }))).toMatchObject({
      status: 400,
      body: { code: "environment_mismatch" },
    });
    expect(await post(await notification({ renewal: { environment: "Sandbox" } }))).toMatchObject({
      status: 400,
      body: { code: "environment_mismatch" },
    });
    expect(await post(await notification({ data: { environment: "Xcode" }, tx: { environment: "Xcode" } }))).toMatchObject({
      status: 400,
      body: { code: "bad_environment" },
    });
    await expectNoWrite();
  });
});

describe("apple-webhook — what gets written comes only from verified data", () => {
  it("expiry is the verified transaction's, never a field beside it", async () => {
    const genuine = await notification();
    const LIE = Date.parse("2099-01-01T00:00:00Z");
    // Unsigned siblings of signedPayload are ignored…
    const res = await post({ ...genuine, expiresDate: LIE, data: { expiresDate: LIE }, environment: "Sandbox" });
    expect(res.status).toBe(200);
    const r = await row();
    expect(r.current_period_end?.toISOString()).toBe(new Date(EXPIRES).toISOString());
    expect(r.apple_environment).toBe("production");

    // …and a transaction whose expiry was edited after signing is refused.
    const signedTx = await ca.jws(tx());
    const [h, , s] = signedTx.split(".");
    const lie = b64url(new TextEncoder().encode(JSON.stringify(tx({ expiresDate: LIE }))));
    const tampered = await post(await notification({ uuid: "second", data: { signedTransactionInfo: `${h}.${lie}.${s}` } }));
    expect(tampered).toMatchObject({ status: 400, body: { code: "unverified_transaction" } });
    expect((await row()).current_period_end?.toISOString()).toBe(new Date(EXPIRES).toISOString());
  });

  it("a revoked transaction never yields active, whatever the notification type says", async () => {
    for (const type of ["DID_RENEW", "REFUND_REVERSED", "SUBSCRIBED"]) {
      const d = await decideAppleNotification(await notification({ type, tx: { revocationDate: SIGNED } }), cfg());
      expect(d.kind).toBe("apply");
      if (d.kind === "apply") {
        expect(d.write.plan).toBe("cancelled");
        expect(d.write.cancelAtPeriodEnd).toBe(false);
      }
    }
    await post(await notification({ tx: { revocationDate: SIGNED } }));
    expect((await row()).status).toBe("cancelled");
  });

  it("keeps the notification → plan mapping (auto-renew off, grace, refund)", async () => {
    await post(await notification({ type: "DID_CHANGE_RENEWAL_STATUS", subtype: "AUTO_RENEW_DISABLED", uuid: "a" }));
    expect(await row()).toMatchObject({ status: "active", cancel_at_period_end: true });
    await post(await notification({ type: "DID_FAIL_TO_RENEW", uuid: "b" }));
    expect(await row()).toMatchObject({ status: "past_due", cancel_at_period_end: false });
    await post(await notification({ type: "REFUND", uuid: "c" }));
    expect((await row()).status).toBe("cancelled");
  });

  it("acks with no write and no claim: unmapped types, no transaction, foreign product", async () => {
    const store = pgStore();
    for (const body of [
      await notification({ type: "TEST", tx: null }),
      await notification({ type: "CONSUMPTION_REQUEST" }),
      await notification({ tx: null }),
      await notification({ tx: { productId: "SOMEONE_ELSES_PRODUCT" } }),
    ]) {
      expect(await post(body, { store })).toEqual({ status: 200, body: { received: true, ignored: true } });
    }
    expect(store.applyCalls).toBe(0);
    await expectNoWrite();
  });

  it("matches by originalTransactionId only: an unlinked lineage writes nothing, even with a token", async () => {
    const res = await post(await notification({ tx: { originalTransactionId: "7777", appAccountToken: OTHER_USER } }));
    expect(res).toEqual({ status: 200, body: { received: true } });
    expect(await row(OTHER_USER)).toMatchObject({ status: "trialing", apple_original_transaction_id: null });
    expect(await row()).toMatchObject({ status: "trialing", apple_environment: null });
  });

  it("never lets an Apple EXPIRED cancel a row Stripe is paying for (kernel precedence)", async () => {
    await db.query(`update public.subscriptions set status = 'active', plan_source = 'stripe' where user_id = $1`, [USER]);
    await post(await notification({ type: "EXPIRED" }));
    expect(await row()).toMatchObject({ status: "active", plan_source: "stripe", apple_environment: "production" });
  });

  it("logs codes only — no ids, no bundle, no payload — and a refusal never reaches sync_log", async () => {
    logs.length = 0;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await post(await notification({ data: { bundleId: "com.example.other" } }));
    await post(await notification({ txSigner: otherCa }));
    expect(logs).toEqual([]);
    expect(warn.mock.calls.map((c) => c.join(" "))).toEqual([
      "apple-webhook: refused wrong_bundle",
      "apple-webhook: refused unverified_transaction",
    ]);
    warn.mockRestore();
    await post(await notification({ tx: { originalTransactionId: "7777" } }));
    expect(logs.join("\n")).not.toMatch(/7777|1000000001|day\.nuvo|eyJ/);
  });
});

describe("apple-webhook — ledger claim and row write are one transaction", () => {
  it("a replayed notificationUUID is acked as a duplicate with no second write", async () => {
    const uuid = "replayed-uuid";
    expect(await post(await notification({ uuid }))).toEqual({ status: 200, body: { received: true } });
    const first = await row();
    // Same UUID, a different (still genuine) expiry: must not be applied.
    const replay = await post(await notification({ uuid, tx: { expiresDate: EXPIRES + 86_400_000 } }));
    expect(replay).toEqual({ status: 200, body: { received: true, duplicate: true } });
    expect((await row()).current_period_end?.toISOString()).toBe(first.current_period_end?.toISOString());
    expect(await ledger()).toEqual([uuid]);
  });

  it("a DB error answers a generic 500, leaves no claim, and Apple's retry is processed", async () => {
    await db.exec(`insert into public.fail_next values (1)`);
    const body = await notification({ uuid: "retry-me" });
    const res = await post(body);
    expect(res).toEqual({ status: 500, body: { error: "handler failed" } });
    expect(JSON.stringify(res.body)).not.toMatch(/injected|subscriptions|apple_webhook/);
    await expectNoWrite();

    await db.exec(`delete from public.fail_next`); // the outage ends
    const retry = await post(body);
    expect(retry).toEqual({ status: 200, body: { received: true } });
    expect((await row()).status).toBe("active");
    expect(await ledger()).toEqual(["retry-me"]);
  });

  it("a lookup error is a 500 with nothing claimed", async () => {
    const store = pgStore();
    store.findByOriginalTransaction = async () => {
      throw new Error("connection reset");
    };
    expect(await post(await notification(), { store })).toEqual({ status: 500, body: { error: "handler failed" } });
    await expectNoWrite();
  });

  it("a row that changed between the read and the write rolls the claim back (500), then the retry applies", async () => {
    const store = pgStore();
    const read = store.findByOriginalTransaction.bind(store);
    store.findByOriginalTransaction = async (otx) => {
      const r = await read(otx);
      // A Stripe checkout lands in between.
      await db.query(`update public.subscriptions set status = 'active', plan_source = 'stripe' where user_id = $1`, [USER]);
      return r;
    };
    const body = await notification({ type: "EXPIRED", uuid: "raced" });
    expect((await post(body, { store })).status).toBe(500);
    expect(await ledger()).toEqual([]);
    // Recomputed against the fresh row, the kernel keeps Stripe's active plan.
    expect((await post(body)).status).toBe(200);
    expect(await row()).toMatchObject({ status: "active", plan_source: "stripe" });
    expect(await ledger()).toEqual(["raced"]);
  });
});

describe("public.apple_webhook_apply (migration 92) on Postgres", () => {
  const base: AppleWebhookApplyArgs = {
    p_event_id: "e1",
    p_original_transaction_id: OTX,
    p_expected_user_id: USER,
    p_expected_status: "trialing",
    p_expected_plan_source: null,
    p_patch: { status: "active", plan_source: "apple", apple_environment: "sandbox" },
  };

  it("claims and writes together; a second call with the same event is a duplicate", async () => {
    expect(await rpc(base)).toBe("applied");
    expect(await rpc({ ...base, p_expected_status: "active", p_expected_plan_source: "apple", p_patch: { status: "cancelled" } })).toBe("duplicate");
    expect((await row()).status).toBe("active");
    expect(await ledger()).toEqual(["e1"]);
  });

  it("a failing write leaves no claim (constraint violation inside the function)", async () => {
    await expect(rpc({ ...base, p_patch: { status: "bogus" } })).rejects.toThrow();
    expect(await ledger()).toEqual([]);
    expect(await rpc(base)).toBe("applied");
  });

  it("refuses patches that write other columns or move the lineage, without claiming", async () => {
    await expect(rpc({ ...base, p_patch: { user_id: OTHER_USER } })).rejects.toThrow(/may not write/);
    await expect(rpc({ ...base, p_patch: { stripe_customer_id: "cus_x" } })).rejects.toThrow(/may not write/);
    await expect(rpc({ ...base, p_patch: { apple_original_transaction_id: "999" } })).rejects.toThrow(/move the lineage/);
    await expect(rpc({ ...base, p_expected_user_id: OTHER_USER })).rejects.toThrow(/stale/);
    expect(await ledger()).toEqual([]);
  });

  it("no_row claims, writes nothing — and raises if the lineage appeared since the read", async () => {
    expect(await rpc({ ...base, p_original_transaction_id: "7777", p_expected_user_id: null, p_patch: {} })).toBe("no_row");
    await expect(rpc({ ...base, p_event_id: "e2", p_expected_user_id: null, p_patch: {} })).rejects.toThrow(/stale/);
    expect(await ledger()).toEqual(["e1"]);
  });

  it("is executable by the service role only", async () => {
    const sig = "public.apple_webhook_apply(text, text, uuid, text, text, jsonb)";
    const r = await db.query<{ anon: boolean; authed: boolean; service: boolean; pub: boolean }>(
      `select has_function_privilege('anon', '${sig}', 'execute') as anon,
              has_function_privilege('authenticated', '${sig}', 'execute') as authed,
              has_function_privilege('service_role', '${sig}', 'execute') as service,
              exists (select 1 from information_schema.routine_privileges
                      where routine_name = 'apple_webhook_apply' and grantee = 'PUBLIC') as pub`,
    );
    expect(r.rows[0]).toEqual({ anon: false, authed: false, service: true, pub: false });
  });
});

// Concurrency needs two real sessions — PGlite has one. Same harness rule as
// tests/migration-tmp-apply.test.ts: required in CI (postgres:17 service),
// skipped locally without DATABASE_URL.
const pgUrl = (process.env.DATABASE_URL || "").trim() ||
  (process.env.GITHUB_ACTIONS ? "postgresql://postgres:postgres@127.0.0.1:5432/nuvo" : "");
const PG_DB = "nuvo_apple_webhook_apply_test";

(pgUrl ? describe : describe.skip)("public.apple_webhook_apply — concurrent deliveries on real Postgres", () => {
  let admin: Client;
  let a: Client;
  let b: Client;
  const call = `select public.apple_webhook_apply($1, $2, $3::uuid, 'trialing', null, $4::jsonb) as r`;
  const patch = JSON.stringify({ status: "active", plan_source: "apple" });

  beforeAll(async () => {
    admin = new Client({ connectionString: pgUrl, connectionTimeoutMillis: 8000 });
    await admin.connect();
    await admin.query(`drop database if exists ${PG_DB} with (force)`);
    await admin.query(`create database ${PG_DB}`);
    const url = new URL(pgUrl);
    url.pathname = `/${PG_DB}`;
    a = new Client({ connectionString: url.href });
    b = new Client({ connectionString: url.href });
    await a.connect();
    await b.connect();
    await a.query(SCHEMA);
    await a.query(MIGRATION);
  }, 30_000);

  afterAll(async () => {
    await a?.end().catch(() => undefined);
    await b?.end().catch(() => undefined);
    await admin?.query(`drop database if exists ${PG_DB} with (force)`).catch(() => undefined);
    await admin?.end().catch(() => undefined);
  });

  beforeEach(async () => {
    await a.query(`truncate public.subscriptions, public.apple_webhook_events, public.fail_next`);
    await a.query(`insert into public.subscriptions (user_id, apple_original_transaction_id) values ($1, $2)`, [USER, OTX]);
  });

  it("a duplicate racing an in-flight delivery waits, then acks as a duplicate", async () => {
    await a.query("begin");
    expect((await a.query(call, ["race", OTX, USER, patch])).rows[0].r).toBe("applied");
    const second = b.query(call, ["race", OTX, USER, patch]); // blocks on the ledger's primary key
    await new Promise((r) => setTimeout(r, 150));
    await a.query("commit");
    expect((await second).rows[0].r).toBe("duplicate");
    expect((await a.query(`select count(*)::int as n from public.apple_webhook_events`)).rows[0].n).toBe(1);
  });

  it("when the in-flight delivery rolls back, the waiting one owns the claim and writes", async () => {
    await a.query("begin");
    await a.query(call, ["race", OTX, USER, patch]);
    const second = b.query(call, ["race", OTX, USER, patch]);
    await new Promise((r) => setTimeout(r, 150));
    await a.query("rollback");
    expect((await second).rows[0].r).toBe("applied");
    expect((await a.query(`select status from public.subscriptions where user_id = $1`, [USER])).rows[0].status).toBe("active");
  });

  it("a write that fails inside the function leaves no claim behind", async () => {
    await a.query(`insert into public.fail_next values (1)`);
    await expect(b.query(call, ["boom", OTX, USER, patch])).rejects.toThrow(/injected/);
    expect((await a.query(`select count(*)::int as n from public.apple_webhook_events`)).rows[0].n).toBe(0);
  });
});
