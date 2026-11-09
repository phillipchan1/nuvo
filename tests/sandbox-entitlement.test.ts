import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isEntitled, type EntitlementRow } from "../supabase/functions/_shared/planRules";
import { entitlementOf } from "../worker/src/entitlement";
import { subscriptionFromWorkerBody } from "../src/lib/entitlementRead";

// Tech Lead ruling (b), 2026-11-09 (decisions.md D-185): an App Store SANDBOX
// row is entitled only until its verified current_period_end. Production rows
// and rows with no recorded environment are not held to it (yet). Enforced in
// `isEntitled` (SPA + Worker) and its SQL twin `public.entitled` (migration 93)
// — this file holds all of them to the same cases. The cut-off applies to
// plan_source='apple' rows only: a Stripe row with a stale sandbox tag stays entitled.

const NOW = new Date("2026-11-09T18:00:00Z");
const PAST = "2026-11-01T00:00:00.000Z";
const FUTURE = "2026-12-01T00:00:00.000Z";
const LONG_AGO = "2020-01-01T00:00:00.000Z";

interface Case {
  name: string;
  row: {
    status: "active" | "trialing" | "cancelled" | "past_due";
    plan_source: "apple" | "stripe" | null;
    apple_environment: "production" | "sandbox" | null;
    current_period_end: string | null;
    trial_ends_at?: string;
  };
  entitled: boolean;
}

const CASES: Case[] = [
  { name: "sandbox apple row past period end → not entitled", row: { status: "active", plan_source: "apple", apple_environment: "sandbox", current_period_end: PAST }, entitled: false },
  { name: "sandbox apple row whose period ended in 2020 → not entitled", row: { status: "active", plan_source: "apple", apple_environment: "sandbox", current_period_end: LONG_AGO }, entitled: false },
  { name: "sandbox apple row with no period end → not entitled", row: { status: "active", plan_source: "apple", apple_environment: "sandbox", current_period_end: null }, entitled: false },
  { name: "sandbox apple row inside its period → entitled", row: { status: "active", plan_source: "apple", apple_environment: "sandbox", current_period_end: FUTURE }, entitled: true },
  { name: "production apple row past period end → still entitled", row: { status: "active", plan_source: "apple", apple_environment: "production", current_period_end: PAST }, entitled: true },
  { name: "null-environment apple row past period end → still entitled (current behaviour)", row: { status: "active", plan_source: "apple", apple_environment: null, current_period_end: PAST }, entitled: true },
  { name: "Stripe-active row carrying a stale sandbox tag → Stripe rules (entitled)", row: { status: "active", plan_source: "stripe", apple_environment: "sandbox", current_period_end: PAST }, entitled: true },
  { name: "cancelled sandbox row inside its period → not entitled", row: { status: "cancelled", plan_source: "apple", apple_environment: "sandbox", current_period_end: FUTURE }, entitled: false },
  { name: "trial → by trial_ends_at", row: { status: "trialing", plan_source: null, apple_environment: null, current_period_end: null, trial_ends_at: FUTURE }, entitled: true },
  { name: "lapsed trial → not entitled", row: { status: "trialing", plan_source: null, apple_environment: null, current_period_end: null, trial_ends_at: PAST }, entitled: false },
];

describe("isEntitled — sandbox rows end at the verified period end", () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(isEntitled({ ...c.row, trial_ends_at: c.row.trial_ends_at ?? PAST } as EntitlementRow, NOW)).toBe(c.entitled);
    });
  }

  it("the Worker's entitlement (Supabase and Neon reads) uses it, with apple_environment selected", () => {
    for (const c of CASES) {
      const e = entitlementOf({ user_id: "u", trial_ends_at: c.row.trial_ends_at ?? PAST, ...c.row }, "u", NOW);
      expect(e.entitled, c.name).toBe(c.entitled);
    }
    const src = readFileSync("worker/src/entitlement.ts", "utf8");
    expect(src).toMatch(/"apple_environment",/); // PostgREST select
    expect(src).toMatch(/cancel_at_period_end, apple_environment,/); // Neon select
  });

  it("the SPA's Worker path keeps apple_environment, so its isEntitled agrees", () => {
    const sub = subscriptionFromWorkerBody({
      present: true,
      entitled: false,
      status: "active",
      plan_source: "apple",
      apple_environment: "sandbox",
      current_period_end: LONG_AGO,
      trial_ends_at: LONG_AGO,
    });
    expect(sub?.apple_environment).toBe("sandbox");
    expect(isEntitled(sub, NOW)).toBe(false);
  });

  it("the SPA's Worker path leaves a Stripe row with a stale sandbox tag entitled", () => {
    const sub = subscriptionFromWorkerBody({
      present: true,
      entitled: true,
      status: "active",
      plan_source: "stripe",
      apple_environment: "sandbox",
      current_period_end: PAST,
      trial_ends_at: LONG_AGO,
    });
    expect(sub?.plan_source).toBe("stripe");
    expect(sub?.apple_environment).toBe("sandbox");
    expect(isEntitled(sub, NOW)).toBe(true);
  });
});

describe("public.entitled (SQL twin, migration 93) agrees case by case", () => {
  let db: PGlite;
  const migration = readFileSync("supabase/migrations/00000000000093_sandbox_entitlement_period.sql", "utf8");

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create table public.subscriptions (
        user_id uuid primary key,
        status text not null,
        trial_ends_at timestamptz not null,
        current_period_end timestamptz,
        plan_source text,
        apple_environment text
      );
    `);
    await db.exec(migration);
    await db.exec(`create or replace function public.is_entitled(s public.subscriptions) returns boolean language sql stable as $$ select public.entitled(s); $$;`);
  });
  afterAll(async () => db.close());

  it("matches isEntitled for every case (at the database's now())", async () => {
    // Shift the fixed dates so they sit the same distance from the DB's real now().
    const shift = Date.now() - NOW.getTime();
    const at = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() + shift).toISOString() : null);
    for (const [i, c] of CASES.entries()) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      await db.query(
        `insert into public.subscriptions values ($1, $2, $3, $4, $5, $6)`,
        [id, c.row.status, at(c.row.trial_ends_at ?? PAST), at(c.row.current_period_end), c.row.plan_source, c.row.apple_environment],
      );
      const r = await db.query<{ e: boolean; ie: boolean }>(
        `select public.entitled(s) as e, public.is_entitled(s) as ie from public.subscriptions s where user_id = $1`,
        [id],
      );
      expect(r.rows[0], c.name).toEqual({ e: c.entitled, ie: c.entitled });
    }
  });

  it("migration 93 is the latest definition of public.entitled", () => {
    const later = readdirSync("supabase/migrations")
      .filter((f) => f > "00000000000093_sandbox_entitlement_period.sql")
      .filter((f) => /function\s+public\.entitled\s*\(/i.test(readFileSync(`supabase/migrations/${f}`, "utf8")));
    expect(later).toEqual([]);
  });
});
