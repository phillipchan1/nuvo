import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Paths that ship inside (or only exist for) the iOS / Tauri-iOS binary.
 *  Apple rejects Stripe UI, web prices, "cheaper on the web" copy, and any
 *  hardcoded App Store Connect dollar amounts. Localized price comes from
 *  StoreKit product objects only. */
const IOS_PATHS = [
  "src-tauri/ios",
  "src-tauri/plugins/nuvo-iap",
  "src/components/billing/iap",
  "src/lib/iap.ts",
];

const FORBIDDEN = [
  /stripe/i,
  /\$29\b/,
  /\$19\b/,
  /\$228\b/,
  // App Store Connect prices — named, but they must not ship in the binary.
  // Localized amounts come from StoreKit product objects only.
  /\$29\.99/,
  /\$229\.99/,
  /29\.99/,
  /229\.99/,
  /cheaper on the web/i,
  /billed yearly/i,
  /secure checkout/i,
  /continue to checkout/i,
];

function walk(path: string, out: string[] = []): string[] {
  try {
    const st = statSync(path);
    if (st.isFile()) {
      out.push(path);
      return out;
    }
    if (!st.isDirectory()) return out;
  } catch {
    return out;
  }
  for (const entry of readdirSync(path)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    walk(join(path, entry), out);
  }
  return out;
}

describe("iOS / Tauri-iOS path has no Stripe, no web prices, and no ASC dollars", () => {
  const files = IOS_PATHS.flatMap((p) => walk(p)).filter((f) =>
    /\.(swift|ts|tsx|rs|toml|md)$/.test(f),
  );

  it("finds the iOS billing surfaces", () => {
    expect(files.some((f) => f.endsWith("IapChooser.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("NuvoIapPlugin.swift"))).toBe(true);
  });

  for (const pattern of FORBIDDEN) {
    it(`no ${pattern} in the iOS path`, () => {
      const hits: string[] = [];
      for (const file of files) {
        const src = readFileSync(file, "utf8");
        if (pattern.test(src)) hits.push(file);
      }
      expect(hits, `these files match ${pattern}`).toEqual([]);
    });
  }
});
