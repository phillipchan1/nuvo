// WCAG contrast gate for the colour tokens — the regression net for the
// "light-mode muted/signal/slot text under AA" class of bug. Parses the token
// blocks straight out of src/index.css (the deployed values, never a copy) and
// checks every text-role token against every ground it can sit on.
//
// Scope: the three PAPER palettes (daybreak / fog / dusk) × light/dark — the
// app's default material — at AA (4.5:1) for text roles, plus --on-accent
// against --accent for every skin base block and colour scheme. The terminal
// skin's editor schemes (Solarized, One, Gruvbox…) reproduce their published
// palettes verbatim — several are deliberately low-contrast (Solarized's
// comment grey is the whole point) — so their muted/slot values are exempt
// here; --on-accent is NOT exempt anywhere, since a filled primary button must
// be readable in every material.

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
const PAPER_PALETTES = ["daybreak", "fog", "dusk"] as const;
const THEMES = ["light", "dark"] as const;
const TEXT_TOKENS = ["--muted", "--signal", "--slot", "--accent"] as const;
const GROUNDS = ["--bg", "--surface", "--surface-2"] as const;

describe("token contrast (WCAG AA)", () => {
  for (const palette of PAPER_PALETTES) {
    for (const theme of THEMES) {
      const tokens = resolveTokens(rules, { "data-theme": theme, "data-palette": palette });
      describe(`${palette} ${theme}`, () => {
        for (const tok of TEXT_TOKENS) {
          for (const ground of GROUNDS) {
            it(`${tok} on ${ground} ≥ ${AA_TEXT}:1`, () => {
              const ratio = contrastRatio(tokens[tok], tokens[ground]);
              expect(ratio, `${tok} ${tokens[tok]} on ${ground} ${tokens[ground]}`).toBeGreaterThanOrEqual(AA_TEXT);
            });
          }
        }
        it(`--on-accent on --accent ≥ ${AA_TEXT}:1`, () => {
          const ratio = contrastRatio(tokens["--on-accent"], tokens["--accent"]);
          expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
        });
      });
    }
  }

  // Every block that redefines --accent must ship a readable --on-accent —
  // skins and colour schemes included. Resolve each (skin, palette, theme)
  // combination that exists in the file and check the pair.
  describe("--on-accent across skins and schemes", () => {
    const combos: Record<string, string>[] = [];
    for (const skin of ["flat", "terminal", "blueprint", "eink"]) {
      for (const theme of THEMES) combos.push({ "data-skin": skin, "data-theme": theme });
    }
    const schemePalettes: Record<string, string[]> = {
      terminal: ["crt", "ayu", "ocean", "dracula", "nord", "gruvbox", "one", "tokyonight", "monokai", "solarized", "catppuccin"],
      flat: ["arctic", "linen"],
      blueprint: ["whiteprint", "sepia"],
      eink: ["sepia", "carta"],
    };
    for (const [skin, palettes] of Object.entries(schemePalettes)) {
      for (const palette of palettes) {
        for (const theme of THEMES) {
          combos.push({ "data-skin": skin, "data-palette": palette, "data-theme": theme });
        }
      }
    }
    for (const attrs of combos) {
      const name = `${attrs["data-skin"]}${attrs["data-palette"] ? `/${attrs["data-palette"]}` : ""} ${attrs["data-theme"]}`;
      it(`${name}: --on-accent on --accent ≥ ${AA_TEXT}:1`, () => {
        const tokens = resolveTokens(rules, attrs);
        const ratio = contrastRatio(tokens["--on-accent"], tokens["--accent"]);
        expect(ratio, `on-accent ${tokens["--on-accent"]} on accent ${tokens["--accent"]}`).toBeGreaterThanOrEqual(AA_TEXT);
      });
    }
  });
});
