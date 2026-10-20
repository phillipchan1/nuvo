import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const apple = (...parts: string[]) => resolve(root, "src-tauri/gen/apple", ...parts);
const read = (...parts: string[]) => readFileSync(apple(...parts), "utf8");

const REQUIRED_CLOUD_VARS = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_POSTHOG_PROJECT_TOKEN",
  "VITE_POSTHOG_HOST",
  "VITE_NUVO_IAP_MONTHLY",
  "VITE_NUVO_IAP_ANNUAL",
  "APPLE_DEVELOPMENT_TEAM",
] as const;

describe("committed Xcode project (Xcode Cloud)", () => {
  it("exposes scheme nuvo_iOS", () => {
    expect(read("nuvo.xcodeproj/xcshareddata/xcschemes/nuvo_iOS.xcscheme")).toContain(
      'BlueprintName = "nuvo_iOS"',
    );
    expect(read("project.yml")).toMatch(/^name: nuvo$/m);
    expect(read("project.yml")).toContain("nuvo_iOS:");
  });

  it("signs day.nuvo.app + day.nuvo.app.widgets with the app group", () => {
    const spec = read("project.yml");
    expect(spec).toContain("PRODUCT_BUNDLE_IDENTIFIER: day.nuvo.app");
    expect(spec).toContain("PRODUCT_BUNDLE_IDENTIFIER: day.nuvo.app.widgets");
    expect(spec).toContain("group.day.nuvo.app");
    expect(read("nuvo_iOS/nuvo_iOS.entitlements")).toContain("com.apple.developer.applesignin");
    expect(read("nuvo_iOS/nuvo_iOS.entitlements")).toContain("group.day.nuvo.app");
  });

  it("does not set the app CFBundleVersion (Xcode Cloud's build number wins)", () => {
    const appPlist = read("nuvo_iOS/Info.plist");
    expect(appPlist).not.toContain("CFBundleVersion");
    const spec = read("project.yml");
    const appBlock = spec.slice(spec.indexOf("nuvo_iOS:"), spec.indexOf("NuvoWidgets:"));
    expect(appBlock).not.toMatch(/CFBundleVersion:/);
  });

  it("makes the widget build number follow CURRENT_PROJECT_VERSION", () => {
    expect(read("NuvoWidgets/Info.plist")).toContain("$(CURRENT_PROJECT_VERSION)");
    expect(read("project.yml")).toContain('CFBundleVersion: "$(CURRENT_PROJECT_VERSION)"');
    expect(readFileSync(resolve(root, "scripts/ios-widgets.rb"), "utf8")).toContain(
      "$(CURRENT_PROJECT_VERSION)",
    );
  });

  it("keeps apple-generic versioning so agvtool and Cloud can assign the build number", () => {
    const pbx = read("nuvo.xcodeproj/project.pbxproj");
    expect(pbx).toContain("VERSIONING_SYSTEM = \"apple-generic\"");
    expect(pbx).toMatch(/CURRENT_PROJECT_VERSION = 1;/);
    expect(read("project.yml")).toContain("VERSIONING_SYSTEM: apple-generic");
    expect(read("project.yml")).toContain("CURRENT_PROJECT_VERSION: 1");
    expect(read("nuvo_iOS/Info.plist")).not.toContain("CFBundleVersion");
  });

  it("embeds NuvoWidgets and does not embed the watch app", () => {
    const spec = read("project.yml");
    expect(spec).toContain("target: NuvoWidgets");
    expect(spec).not.toContain("NuvoWatch");
    expect(read("nuvo.xcodeproj/project.pbxproj")).toContain("Embed App Extensions");
    expect(read("nuvo.xcodeproj/project.pbxproj")).toContain("CODE_SIGN_ENTITLEMENTS = nuvo_iOS/nuvo_iOS.entitlements");
  });
});

describe("Xcode Cloud ci_scripts", () => {
  it("installs Node 20 + Rust aarch64-apple-ios, then npm ci", () => {
    const post = read("ci_scripts/ci_post_clone.sh");
    expect(post.startsWith("#!/bin/bash")).toBe(true);
    expect(post).toContain("node@20");
    expect(post).toContain("aarch64-apple-ios");
    expect(post).toContain("npm ci");
    expect(post).toContain("pod install");
    expect(post).toContain("NUVO_IOS_WATCH");
    expect(post).toContain("--no-codegen");
    expect(statSync(apple("ci_scripts/ci_post_clone.sh")).mode & 0o111).toBeTruthy();
  });

  it("restores Node/Rust on PATH before xcodebuild", () => {
    const pre = read("ci_scripts/ci_pre_xcodebuild.sh");
    expect(pre.startsWith("#!/bin/bash")).toBe(true);
    expect(pre).toContain(".cargo/env");
    expect(pre).toContain("nuvo_write_xcode_cloud_env");
    expect(pre).toContain("node_modules/.bin/tauri");
    expect(statSync(apple("ci_scripts/ci_pre_xcodebuild.sh")).mode & 0o111).toBeTruthy();
  });

  it("fails clearly when a required Cloud env var is missing", () => {
    const env = read("ci_scripts/env.sh");
    for (const name of REQUIRED_CLOUD_VARS) {
      expect(env).toContain(name);
    }
    expect(env).toContain("missing required Xcode Cloud environment variables");
    expect(read("ci_scripts/ci_post_clone.sh")).toContain("REQUIRED_VARS");
  });

  it("does not mention StoreKit configuration", () => {
    const post = read("ci_scripts/ci_post_clone.sh");
    const pre = read("ci_scripts/ci_pre_xcodebuild.sh");
    expect(post + pre).not.toMatch(/StoreKit|Configuration\.storekit/i);
  });
});

describe("GitHub Actions still uses the committed project", () => {
  it("does not re-init over an existing gen/apple", () => {
    const workflow = readFileSync(resolve(root, ".github/workflows/ios-release.yml"), "utf8");
    expect(workflow).toContain("Using committed Xcode project");
    expect(workflow).toContain("scheme nuvo_iOS");
    expect(workflow).toContain("tauri ios init");
    // Fallback only — the happy path skips init.
    const prepare = workflow.slice(workflow.indexOf("Prepare committed iOS project"));
    expect(prepare).toContain("not re-running tauri ios init");
  });
});
