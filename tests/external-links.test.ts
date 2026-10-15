/**
 * External links — the native shells open them through tauri-plugin-opener.
 *
 * On the phone, Join Google Meet did nothing. So did a location (Apple Maps), a
 * link in an event's notes, and the paywall's Terms and Privacy. Every one is an
 * `<a target="_blank">`, and the iOS webview won't open a new window on its own;
 * the app relied on tauri-plugin-shell's injected click handler. That handler
 * cancels the tap, then calls the shell's `open` — which on iOS runs the `open`
 * crate, and that tries to spawn a `uiopen` binary a sandboxed app can't run.
 * The promise rejects unobserved; the sheet closes; nothing opens. No error, no
 * log, only on the device. The opener plugin hands iOS to UIApplication.open.
 *
 * None of it shows up in a browser, a typecheck or `cargo check` on a Mac, so
 * the wiring is pinned here.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) return sourceFiles(rel);
    return /\.tsx?$/.test(name) ? [rel] : [];
  });
}

/** `2.5` out of `"~2.5"` / `"~2.5.5"` / `"^2.5.5"`. */
const minorOf = (range: string) => range.match(/(\d+)\.(\d+)/)?.slice(1, 3).join(".");

describe("external links open through the opener plugin", () => {
  const cargo = read("src-tauri/Cargo.toml");
  const appLib = read("src-tauri/src/lib.rs");
  const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };

  it("the shell plugin is gone, end to end — its link handler is what breaks iOS", () => {
    expect(cargo).not.toMatch(/^tauri-plugin-shell\s*=/m);
    expect(appLib).not.toContain("tauri_plugin_shell");
    expect(read("src-tauri/capabilities/default.json")).not.toContain("shell:");
    expect(pkg.dependencies).not.toHaveProperty("@tauri-apps/plugin-shell");
    const importers = sourceFiles("src").filter((f) => read(f).includes("@tauri-apps/plugin-shell"));
    expect(importers).toEqual([]);
  });

  it("the opener is registered once, with its link handler on", () => {
    expect(cargo).toMatch(/^tauri-plugin-opener\s*=/m);
    expect(appLib.split("tauri_plugin_opener::init()").length - 1).toBe(1);
    // `Builder::new().open_js_links_on_click(false)` would silently bring the bug back.
    expect(appLib).not.toContain("open_js_links_on_click");
    // Plugin commands are permission-gated in Tauri v2.
    expect(read("src-tauri/capabilities/default.json")).toContain('"opener:default"');
  });

  it("the crate and the npm package share a minor — `tauri build` refuses a mismatch", () => {
    const crate = cargo.match(/^tauri-plugin-opener\s*=\s*"([^"]+)"/m)?.[1];
    const npm = pkg.dependencies["@tauri-apps/plugin-opener"];
    expect(crate).toBeDefined();
    expect(npm).toBeDefined();
    expect(minorOf(npm!)).toBe(minorOf(crate!));
    // Both pinned to the minor, so an `npm update` can't drift one side alone.
    expect(crate).toMatch(/^~/);
    expect(npm).toMatch(/^~/);
  });
});
