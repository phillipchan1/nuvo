import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readWriteFreezeFlag,
  refuseFrozenWrite,
  WRITE_FROZEN_MESSAGE,
  writeFreezeOn,
} from "../supabase/functions/_shared/writeFreeze.ts";

const ROOT = join(import.meta.dirname, "..");
const FUNCTIONS = join(ROOT, "supabase/functions");

const WRITE_FUNCTIONS = [
  "agent",
  "capture",
  "mcp",
  "inbound-email",
  "google-webhook",
  "delete-account",
  "google-sync",
  "google-oauth",
  "google-events",
  "google-contacts",
  "m365-oauth",
  "m365-sync",
  "ics-sync",
  "ics-subscribe",
  "icloud-connect",
  "icloud-sync",
  "icloud-events",
  "icloud-contacts",
  "calendar-refresh",
  "slot-mirror",
  "task-mirror",
  "route-events",
  "rollover",
  "push-dispatch",
  "github-activity",
  "apple-identity",
] as const;

const BILLING_UNTOUCHED = [
  "stripe-webhook",
  "apple-webhook",
  "stripe-checkout",
  "stripe-portal",
  "apple-iap",
  "iap-catalog",
  "referral-code",
] as const;

describe("writeFreezeOn", () => {
  it("treats 1/true/yes/on as frozen", () => {
    for (const raw of ["1", "true", "YES", "On", " true "]) {
      expect(writeFreezeOn(raw), raw).toBe(true);
    }
  });

  it("treats empty and other values as open", () => {
    for (const raw of [undefined, null, "", "0", "false", "off", "maybe"]) {
      expect(writeFreezeOn(raw), String(raw)).toBe(false);
    }
  });
});

describe("readWriteFreezeFlag", () => {
  it("ORs WRITE_FREEZE and MAINTENANCE_WRITE_FREEZE (empty/false does not hide the other)", () => {
    expect(readWriteFreezeFlag((name) => (name === "WRITE_FREEZE" ? "1" : undefined))).toBe(true);
    expect(readWriteFreezeFlag((name) => (name === "MAINTENANCE_WRITE_FREEZE" ? "yes" : undefined))).toBe(true);
    expect(readWriteFreezeFlag((name) => (name === "WRITE_FREEZE" ? "" : "true"))).toBe(true);
    expect(readWriteFreezeFlag((name) => (name === "WRITE_FREEZE" ? "0" : "1"))).toBe(true);
    expect(readWriteFreezeFlag((name) => (name === "WRITE_FREEZE" ? "false" : "on"))).toBe(true);
    expect(readWriteFreezeFlag(() => "0")).toBe(false);
    expect(readWriteFreezeFlag(() => undefined)).toBe(false);
  });
});

describe("refuseFrozenWrite", () => {
  const on = { getEnv: () => "1" };

  it("returns 503 on writes when the flag is on", async () => {
    const res = refuseFrozenWrite({ method: "POST" }, on);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    const body = await res!.json();
    expect(body.error).toBe(WRITE_FROZEN_MESSAGE);
    expect(body.write_freeze).toBe(true);
  });

  it("lets OPTIONS through while frozen", () => {
    expect(refuseFrozenWrite({ method: "OPTIONS" }, on)).toBeNull();
  });

  it("freezes GET by default (oauth callbacks write)", () => {
    const res = refuseFrozenWrite({ method: "GET" }, on);
    expect(res?.status).toBe(503);
  });

  it("lets GET through when allowReads is set (capture poll)", () => {
    expect(refuseFrozenWrite({ method: "GET" }, { ...on, allowReads: true })).toBeNull();
    expect(refuseFrozenWrite({ method: "POST" }, { ...on, allowReads: true })?.status).toBe(503);
  });

  it("is a no-op when the flag is off", () => {
    expect(refuseFrozenWrite({ method: "POST" }, { getEnv: () => "" })).toBeNull();
  });
});

describe("edge function wiring", () => {
  it("covers every non-billing service_role write function", () => {
    const names = readdirSync(FUNCTIONS, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "_shared")
      .map((d) => d.name)
      .sort();
    const expected = [...WRITE_FUNCTIONS, ...BILLING_UNTOUCHED, "day"].sort();
    expect(names).toEqual(expected);
  });

  it.each(WRITE_FUNCTIONS)("%s imports refuseFrozenWrite on its own line", (name) => {
    const src = readFileSync(join(FUNCTIONS, name, "index.ts"), "utf8");
    expect(src).toContain('from "../_shared/writeFreeze.ts"');
    expect(src).toContain("refuseFrozenWrite(req");
    expect(src).not.toMatch(/import \{\s*import \{ refuseFrozenWrite/);
  });

  it("no edge-function file nests an import inside another import {…}", () => {
    const files = readdirSync(FUNCTIONS, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "_shared")
      .map((d) => join(FUNCTIONS, d.name, "index.ts"));
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      let depth = 0;
      let inImportBrace = false;
      for (const line of src.split("\n")) {
        if (!inImportBrace && /^\s*import\s*\{/.test(line)) {
          inImportBrace = true;
          depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
          if (depth <= 0) inImportBrace = false;
          continue;
        }
        if (inImportBrace) {
          expect(line, file).not.toMatch(/^\s*import\s/);
          depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
          if (depth <= 0) inImportBrace = false;
        }
      }
    }
  });

  it("CI Parse the edge functions step is the esbuild --bundle=false walk", () => {
    const ci = readFileSync(join(ROOT, ".github/workflows/checks.yml"), "utf8");
    expect(ci).toMatch(/name: Parse the edge functions/);
    expect(ci).toMatch(/npx esbuild --bundle=false --outfile=\/dev\/null/);
    expect(ci).toMatch(/find supabase\/functions -name '\*\.ts'/);
  });

  it("capture freezes POST only (GET is a poll)", () => {
    const src = readFileSync(join(FUNCTIONS, "capture/index.ts"), "utf8");
    expect(src).toContain("allowReads: true");
  });

  it.each(BILLING_UNTOUCHED)("%s does not import the freeze helper", (name) => {
    const src = readFileSync(join(FUNCTIONS, name, "index.ts"), "utf8");
    expect(src).not.toContain("writeFreeze");
    expect(src).not.toContain("refuseFrozenWrite");
  });

  it("day stays a read and is not frozen", () => {
    const src = readFileSync(join(FUNCTIONS, "day/index.ts"), "utf8");
    expect(src).not.toContain("refuseFrozenWrite");
  });
});

describe("runbook names the edge freeze", () => {
  const doc = readFileSync(join(ROOT, "docs/cloudflare-cutover.md"), "utf8");

  it("documents WRITE_FREEZE on non-billing functions", () => {
    expect(doc).toMatch(/WRITE_FREEZE=1/);
    expect(doc).toMatch(/writeFreeze\.ts/);
    expect(doc).toMatch(/stripe-webhook/);
    expect(doc).toMatch(/apple-webhook/);
  });
});
