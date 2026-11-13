// WCAG contrast gate for the colour tokens — the regression net for the
// "light-mode muted/signal/slot text under AA" class of bug. Parses the token
// blocks straight out of src/index.css (the deployed values, never a copy) and
// checks every text-role token against every ground it can sit on, plus every
// ink-on-fill pair, in both of Instrument's themes (D-189: Light and Dark are
// the only themes, so there is nothing else to exempt).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── WCAG relative-luminance ratio ──────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 1, 2].map((i) => parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function luminance(rgb: [number, number, number]): number {
  const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** Hue angle in degrees, for the "these two must not look like the same
 *  colour" checks that a contrast ratio structurally cannot make. */
function hueOf(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) throw new Error(`not a hex colour: ${hex}`);
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) % 360 + 360) % 360;
}

/** Shortest angular distance between two hues, in degrees (0–180). */
function hueGap(a: string, b: string): number {
  const raw = Math.abs(hueOf(a) - hueOf(b)) % 360;
  return raw > 180 ? 360 - raw : raw;
}

export function contrastRatio(a: string, b: string): number {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) throw new Error(`not hex colours: ${a} / ${b}`);
  const [hi, lo] = [luminance(ra), luminance(rb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ── A just-enough CSS reader for the flat token blocks ─────────────────────
// Token blocks in index.css are flat rules whose selectors are only html/:root
// plus attribute selectors ([data-theme="dark"], [data-palette="fog"]…). We
// walk the stylesheet in order, merge every block whose selector matches a
// simulated <html> attribute set, and read the custom properties off the
// result — file order stands in for specificity, which holds for how these
// blocks are actually layered (base → palette → skin → scheme).
interface Rule {
  selectors: string[];
  props: Record<string, string>;
}

function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  const skipBlock = (from: number): number => {
    let depth = 0;
    for (let j = from; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") {
        depth--;
        if (depth === 0) return j + 1;
      }
    }
    return css.length;
  };
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) break;
    const selector = css.slice(i, open).trim();
    // strip comments that precede the selector
    const clean = selector.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (clean.startsWith("@")) {
      i = skipBlock(open);
      continue;
    }
    const close = css.indexOf("}", open);
    const body = css.slice(open + 1, close === -1 ? css.length : close);
    const props: Record<string, string> = {};
    for (const m of body.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
      props[m[1]] = m[2].trim();
    }
    if (Object.keys(props).length > 0) {
      rules.push({ selectors: clean.split(",").map((s) => s.trim()), props });
    }
    i = close === -1 ? css.length : close + 1;
  }
  return rules;
}

const ATTR_RE = /\[([a-z-]+)(?:="([^"]*)")?\]/g;

function compoundMatches(compound: string, attrs: Record<string, string>): boolean {
  if (!compound || compound.includes(" ") || compound.includes(".") || compound.includes(":", 1))
    return false;
  const rest = compound.replace(/^html/, "").replace(/^:root/, "");
  for (const m of rest.matchAll(ATTR_RE)) {
    const [, name, val] = m;
    if (!(name in attrs)) return false;
    if (val !== undefined && attrs[name] !== val) return false;
  }
  return rest.replace(ATTR_RE, "").trim() === "";
}

function resolveTokens(rules: Rule[], attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of rules) {
    if (rule.selectors.some((s) => compoundMatches(s, attrs))) Object.assign(out, rule.props);
  }
  return out;
}

const css = readFileSync(join(__dirname, "..", "src", "index.css"), "utf8");
const rules = parseRules(css);

// ── the gate ───────────────────────────────────────────────────────────────
const AA_TEXT = 4.5;
const THEMES = ["light", "dark"] as const;
// Every token the app renders as *words* belongs here. --ok/--warn were the
// two that weren't, and they were exactly the strings that carry state ("no
// outcome", "N to ready", "shipped", "at risk") — the least legible text in the
// app was the text saying something needed attention. --danger joins them as
// the error/overcommitted hue. A token used as text and missing from this list
// is the whole bug class this file exists to prevent.
const TEXT_TOKENS = ["--muted", "--signal", "--slot", "--accent", "--ok", "--warn", "--danger"] as const;
const GROUNDS = ["--bg", "--surface", "--surface-2"] as const;
// Ink-on-fill pairs: a filled control must be readable in both directions.
const ON_PAIRS = [
  ["--on-accent", "--accent"],
  ["--on-danger", "--danger"],
  ["--on-signal", "--signal"],
] as const;

describe("token contrast (WCAG AA)", () => {
  {
    for (const theme of THEMES) {
      const tokens = resolveTokens(rules, { "data-theme": theme });
      describe(theme, () => {
        for (const tok of TEXT_TOKENS) {
          for (const ground of GROUNDS) {
            it(`${tok} on ${ground} ≥ ${AA_TEXT}:1`, () => {
              const ratio = contrastRatio(tokens[tok], tokens[ground]);
              expect(ratio, `${tok} ${tokens[tok]} on ${ground} ${tokens[ground]}`).toBeGreaterThanOrEqual(AA_TEXT);
            });
          }
        }
        for (const [ink, fill] of ON_PAIRS) {
          it(`${ink} on ${fill} ≥ ${AA_TEXT}:1`, () => {
            const ratio = contrastRatio(tokens[ink], tokens[fill]);
            expect(ratio, `${ink} ${tokens[ink]} on ${fill} ${tokens[fill]}`).toBeGreaterThanOrEqual(AA_TEXT);
          });
        }

        // --danger and --signal must stay tellable apart: the whole point of
        // splitting them is that "wrong" and "now" stop sharing a hue. Pure
        // contrast can't see that (two reds of equal darkness score 1.0), so
        // this checks hue separation directly.
        it("--danger is hue-distinct from --signal", () => {
          const gap = hueGap(tokens["--danger"], tokens["--signal"]);
          expect(gap, `danger ${tokens["--danger"]} vs signal ${tokens["--signal"]}`).toBeGreaterThanOrEqual(12);
        });

        // Same argument one step over: --warn is an amber and --signal an
        // ember, and at AA weight on a light ground they both want to collapse
        // into the same brown.
        it("--warn is hue-distinct from --signal", () => {
          const gap = hueGap(tokens["--warn"], tokens["--signal"]);
          expect(gap, `warn ${tokens["--warn"]} vs signal ${tokens["--signal"]}`).toBeGreaterThanOrEqual(10);
        });
      });
    }
  }
});
