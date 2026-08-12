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
import { SCHEMES } from "../src/hooks/useSkin";

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

// The non-default materials were split into on-demand stylesheets (P2-11) —
// the deployed values now live across index.css + src/skins/*.css, so the
// gate reads them all. Still straight from the source files, never a copy.
const css = [
  readFileSync(join(__dirname, "..", "src", "index.css"), "utf8"),
  readFileSync(join(__dirname, "..", "src", "skins", "flat.css"), "utf8"),
  readFileSync(join(__dirname, "..", "src", "skins", "terminal.css"), "utf8"),
  readFileSync(join(__dirname, "..", "src", "skins", "blueprint.css"), "utf8"),
  readFileSync(join(__dirname, "..", "src", "skins", "eink.css"), "utf8"),
].join("\n");
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
    // Derived from the real catalogue, never a copy of it. This list used to be
    // hardcoded here, which meant a newly added scheme was silently exempt from
    // the one check that stops it shipping unreadable — the drift this whole
    // file exists to prevent. Paper is excluded: its palettes are covered above.
    const schemePalettes: Record<string, string[]> = Object.fromEntries(
      Object.entries(SCHEMES)
        .filter(([skin]) => skin !== "paper")
        .map(([skin, schemes]) => [skin, schemes.map((s) => s.id)]),
    );
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

  // ── Terminal event ink ────────────────────────────────────────────────────
  // A calendar event under the Terminal skin doesn't wear a token directly: the
  // label and the block are both color-mix()es of the scheme's syntax ramp
  // (--syn-ground / --syn-base / --syn-ink), so a scheme can pass every gate
  // above and still render an illegible week.
  //
  // What this gate protects, precisely: the ink-forward values drop the ground
  // to 10% and push the label to 88% raw chroma, and on a dark scheme --text is
  // LIGHT — so mixing *less* of it in costs contrast. The dim published ramps
  // (Solarized's #6c71c4, One-dark's greys) are the ones with no margin; this
  // is what stops the next scheme, or the next tweak to those two numbers, from
  // going unreadable. The values are read from terminal.css, never a copy.
  //
  // What it does NOT catch: the washed-out bug that prompted the rewrite. Ayu's
  // old #EBBD7F-on-#41382F scored 6.62:1 and passed comfortably — the failure
  // there was lost *chroma*, not lost contrast, and the two are independent.
  // Saturation is a design judgement the eye makes; don't read a green suite as
  // proof the palette still looks like itself.
  //
  // The floor is 3:1, not AA. These schemes reproduce published editor palettes
  // verbatim and several are deliberately dim (same reason their muted/slot
  // values are exempt at the top of this file) — a catastrophe gate, not a
  // promise of AA.
  const EVENT_MIN = 3;

  // `color-mix(in srgb, …)` interpolates in gamma-encoded sRGB, so an opaque
  // mix is a straight per-channel lerp of the 0–255 values.
  function mix(a: string, pct: number, b: string): string {
    const ra = hexToRgb(a);
    const rb = hexToRgb(b);
    if (!ra || !rb) throw new Error(`not hex colours: ${a} / ${b}`);
    const t = pct / 100;
    return (
      "#" +
      [0, 1, 2]
        .map((i) => Math.round((ra[i] * t + rb[i] * (1 - t)) * 255))
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("")
    );
  }

  // Read the .fc-event rules straight out of terminal.css. parseRules keeps
  // file order and compoundMatches only understands attribute compounds, so we
  // strip the descendant part off the selector and reuse both.
  const EVENT_SEL = " .fc-event:not(.evt-slot)";
  interface EventRule {
    prefixes: string[];
    ground?: string;
    ink?: string;
    base?: string;
  }
  const eventRules: EventRule[] = parseRules(css)
    .filter((r) => r.selectors.some((s) => s.endsWith(EVENT_SEL)))
    .map((r) => ({
      prefixes: r.selectors
        .filter((s) => s.endsWith(EVENT_SEL))
        .map((s) => s.slice(0, -EVENT_SEL.length)),
      ground: r.props["--syn-ground"],
      ink: r.props["--syn-ink"],
      base: /var\((--[a-z0-9-]+)\)/i.exec(r.props["--syn-base"] ?? "")?.[1],
    }));

  describe("terminal event ink", () => {
    const terminalSchemes = (SCHEMES.terminal ?? []).map((s) => s.id);
    for (const palette of terminalSchemes) {
      for (const theme of THEMES) {
        const attrs = { "data-skin": "terminal", "data-palette": palette, "data-theme": theme };
        const tokens = resolveTokens(rules, attrs);
        // Cascade the event rules the way the browser does for these blocks.
        let ground = "", ink = "", base = "";
        for (const er of eventRules) {
          if (!er.prefixes.some((p) => compoundMatches(p, attrs))) continue;
          if (er.ground) ground = er.ground;
          if (er.ink) ink = er.ink;
          if (er.base) base = er.base;
        }
        // --accent = your own tasks, --signal = overdue, --syn-N = each calendar.
        const inks = ["--accent", "--signal", ...[1, 2, 3, 4, 5, 6].map((n) => `--syn-${n}`)];
        for (const tok of inks) {
          it(`${palette} ${theme}: ${tok} label on its block ≥ ${EVENT_MIN}:1`, () => {
            const syn = tokens[tok];
            expect(syn, `${tok} undefined for terminal/${palette} ${theme}`).toBeTruthy();
            const block = mix(syn, parseFloat(ground), tokens[base]);
            const label = mix(syn, parseFloat(ink), tokens["--text"]);
            const ratio = contrastRatio(label, block);
            expect(ratio, `${tok} ${syn}: ink ${label} on block ${block}`).toBeGreaterThanOrEqual(EVENT_MIN);
          });
        }
      }
    }
  });
});
