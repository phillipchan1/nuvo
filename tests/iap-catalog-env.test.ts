import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

// iap.ts imports the real Supabase client for `confirmApplePurchase`; the
// catalog half is pure and is what's under test here.
vi.mock("../src/lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

const { catalogProductIds, fetchIapCatalog } = await import("../src/lib/iap");

const MONTHLY = "NUVO_IAP_MONTHLY";
const ANNUAL = "NUVO_IAP_ANNUAL";
/** App Store Connect's internal IDs. They are not product identifiers and
 *  StoreKit returns nothing for them. */
const APPLE_INTERNAL = ["6804259519", "6804258767"];

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A build whose VITE_NUVO_IAP_* env never got set still has to price the
 *  paywall. An empty catalog is the "Subscriptions aren't available from the
 *  App Store on this build yet" stub, which is what a forgotten CI env looked
 *  like on TestFlight. */
describe("the iOS catalog survives a missing Vite env", () => {
  it("yields the two StoreKit ids when the env is absent", async () => {
    expect(catalogProductIds(await fetchIapCatalog())).toEqual([MONTHLY, ANNUAL]);
  });

  it("yields them when the env is present but blank", async () => {
    vi.stubEnv("VITE_NUVO_IAP_MONTHLY", "");
    vi.stubEnv("VITE_NUVO_IAP_ANNUAL", "   ");
    expect(catalogProductIds(await fetchIapCatalog())).toEqual([MONTHLY, ANNUAL]);
  });

  it("never hands StoreKit an all-digit Apple internal ID", async () => {
    vi.stubEnv("VITE_NUVO_IAP_MONTHLY", APPLE_INTERNAL[0]);
    vi.stubEnv("VITE_NUVO_IAP_ANNUAL", APPLE_INTERNAL[1]);
    const ids = catalogProductIds(await fetchIapCatalog());
    expect(ids).toEqual([MONTHLY, ANNUAL]);
    for (const id of ids) expect(id).not.toMatch(/^\d+$/);
  });

  it("honours real overrides", async () => {
    vi.stubEnv("VITE_NUVO_IAP_MONTHLY", "NUVO_IAP_MONTHLY_TEST");
    expect(catalogProductIds(await fetchIapCatalog())).toEqual(["NUVO_IAP_MONTHLY_TEST", ANNUAL]);
  });
});

/** The fallback is the net; the workflow is the contract. Vite only bakes
 *  VITE_* vars that exist at build time, so the step that builds the IPA is
 *  where the ids have to be named. */
describe("ios-release.yml bakes the product ids into the IPA", () => {
  const yml = readFileSync(".github/workflows/ios-release.yml", "utf8");
  const step = yml.slice(yml.indexOf("- name: Build signed IPA")).split(/\n      - name: /)[0];

  it("finds the step", () => {
    expect(step).toContain("tauri ios build");
  });

  for (const [key, value] of [
    ["VITE_NUVO_IAP_MONTHLY", MONTHLY],
    ["VITE_NUVO_IAP_ANNUAL", ANNUAL],
  ]) {
    it(`sets ${key} to ${value} as a plain value`, () => {
      expect(step).toMatch(new RegExp(`^\\s+${key}: ${value}\\s*$`, "m"));
    });
  }

  it("never passes an Apple internal ID as a product id", () => {
    for (const id of APPLE_INTERNAL) expect(yml).not.toContain(id);
  });
});
