// Type-scale gate.
//
// The scale in `@theme` (display 22 · lead 18 · head 15 · body 13 · caption 12 ·
// label 11 · meta 10.5 · micro 9.5) is what makes a dense planner read as
// authored rather than accumulated. It had drifted: 27 arbitrary `text-[Npx]`
// declarations across 14 values, of which eight simply re-declared a step the
// scale already owned (`text-[15px]` IS `--text-head`) and three sat *below* the
// floor — including a `text-[8px]` on the inbox triage row, the
// highest-frequency loop in the product.
//
// Duplicates are the quiet half of that: a future change to `--text-head`
// silently misses every hand-written `text-[15px]`.
//
// The rule this enforces is deliberately narrow, because the scale is a *UI*
// type scale and not every size in the app is UI type:
//
//   No arbitrary `text-[Npx]` at or below the scale's top step (22px).
//
// Above 22px is ceremony — the Domain floor's serif hero, the orientation
// masthead, a capacity numeral — one per screen, bespoke on purpose, and
// nothing the ladder is trying to govern. At or below it, there is a step for
// what you want; use it.
//
// Reads the deployed source, never a copy — same contract as the token-contrast
// and keyboard-operability gates next door.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") || p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const rel = (p: string) => p.slice(p.indexOf("/src/") + 1);

/** The scale's top step. At or below this, a token exists — so use it. */
const SCALE_TOP_PX = 22;

describe("type scale", () => {
  it("declares the eight steps it documents", () => {
    const css = readFileSync(join(SRC, "index.css"), "utf8");
    const steps: [string, string][] = [
      ["--text-display", "22px"],
      ["--text-lead", "18px"],
      ["--text-head", "15px"],
      ["--text-body", "13px"],
      ["--text-caption", "12px"],
      ["--text-label", "11px"],
      ["--text-meta", "10.5px"],
      ["--text-micro", "9.5px"],
    ];
    for (const [tok, px] of steps) {
      expect(css, `${tok} missing or moved`).toMatch(
        new RegExp(`${tok}:\\s*${px.replace(".", "\\.")}`),
      );
    }
  });

  it("every step owns a line-height, so 12px text can't render three ways", () => {
    const css = readFileSync(join(SRC, "index.css"), "utf8");
    for (const tok of [
      "--text-display",
      "--text-lead",
      "--text-head",
      "--text-body",
      "--text-caption",
      "--text-label",
      "--text-meta",
      "--text-micro",
    ]) {
      expect(css, `${tok} has no --line-height`).toContain(`${tok}--line-height`);
    }
  });

  it("no arbitrary text size at or below the scale's top step", () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
        const px = parseFloat(m[1]);
        if (px > SCALE_TOP_PX) continue; // ceremony, above the ladder
        // Prose in a comment describing the old value is not a declaration.
        const lineStart = src.lastIndexOf("\n", m.index) + 1;
        const line = src.slice(lineStart, src.indexOf("\n", m.index));
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        offenders.push(`${rel(f)}:${src.slice(0, m.index).split("\n").length}  ${m[0]}`);
      }
    }
    expect(
      offenders,
      `These re-declare (or undercut) a step the scale already owns. Use the token ` +
        `class — text-display/lead/head/body/caption/label/meta/micro — so a change to ` +
        `the scale reaches every call site.\n` + offenders.join("\n"),
    ).toEqual([]);
  });
});
