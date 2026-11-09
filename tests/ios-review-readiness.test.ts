import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  STRIPE_DELETE_AUTO_CANCEL_NOTICE,
  STRIPE_DELETE_BLOCK_MESSAGE,
  STRIPE_DELETE_BLOCK_MESSAGE_IOS,
  stripeDeleteCopy,
} from "../supabase/functions/_shared/accountDeletion.ts";
import { DIAL_NOTE } from "../src/lib/planDial";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("iOS 1.2 App Review readiness", () => {
  it("ships marketing version 1.2.x from package.json and tauri.conf.json", () => {
    expect(JSON.parse(read("package.json")).version).toBe("1.2.0");
    expect(JSON.parse(read("src-tauri/tauri.conf.json")).version).toBe("1.2.0");
  });

  it("shows no trial/beta or internal ticket wording in the plan dial (Guideline 2.2)", () => {
    for (const note of Object.values(DIAL_NOTE)) {
      expect(note).not.toMatch(/trial|beta|Q-\d+/i);
    }
  });

  it("keeps pinch zoom: no maximum-scale / user-scalable=no in the viewport", () => {
    const viewport = read("index.html").match(/name="viewport"[\s\S]*?content="([^"]*)"/)?.[1] ?? "";
    expect(viewport).toContain("width=device-width");
    expect(viewport).not.toMatch(/maximum-scale|user-scalable\s*=\s*no/);
  });

  it("makes the release WKWebView inspectable on desktop only (devtools off on iOS)", () => {
    const cargo = read("src-tauri/Cargo.toml");
    const base = cargo.split(/^\[target\./m)[0];
    expect(base).not.toMatch(/"devtools"/);
    const desktop = cargo.match(
      /\[target\.'cfg\(not\(any\(target_os = "android", target_os = "ios"\)\)\)'\.dependencies\]([\s\S]*?)(?=^\[)/m,
    )?.[1];
    expect(desktop).toMatch(/^tauri = \{[^}]*"devtools"/m);
  });

  it("does not track Python bytecode", () => {
    expect(read(".gitignore")).toMatch(/^__pycache__\/$/m);
  });
});

describe("delete-account Stripe copy", () => {
  it("flag off (Supabase cancels Stripe itself): never says cancel first", () => {
    for (const iapOnly of [false, true]) {
      expect(stripeDeleteCopy({ workers: false, iapOnly })).toBe(STRIPE_DELETE_AUTO_CANCEL_NOTICE);
    }
  });
  it("flag on, desktop/web: cancel in Billing first (the Worker 409s a live Stripe row)", () => {
    expect(stripeDeleteCopy({ workers: true, iapOnly: false })).toBe(STRIPE_DELETE_BLOCK_MESSAGE);
  });
  it("flag on, iOS: no pointer to the phone's Billing pane and no Stripe wording", () => {
    const copy = stripeDeleteCopy({ workers: true, iapOnly: true });
    expect(copy).toBe(STRIPE_DELETE_BLOCK_MESSAGE_IOS);
    expect(copy).not.toMatch(/Stripe|Settings → Billing/);
  });
});
