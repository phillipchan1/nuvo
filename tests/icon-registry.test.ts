// The Icon wrapper (src/components/Icon.tsx) serves a different drawing per
// MATERIAL: the hand-drawn set on paper/terminal/blueprint/eink, Lucide on flat.
// Two maps keyed by the same union is the whole design, and its one real failure
// mode is drift — a name added to FLAT but not PAPER renders `undefined` and
// throws, and it throws only in the skin the author wasn't looking at. That is
// exactly the class of bug nobody catches by eye, so it is asserted here.
//
// Kept DOM-free on purpose: this suite runs in milliseconds on every push, and
// pulling in jsdom to render two <svg>s would cost more than it proves.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "..", "src", "components", "Icon.tsx"), "utf8");

/** The source text between the braces of `const NAME: … = { … }`. */
function mapBody(mapName: string): string {
  const start = src.indexOf(`const ${mapName}:`);
  expect(start, `${mapName} map not found in Icon.tsx`).toBeGreaterThan(-1);
  const open = src.indexOf("{", src.indexOf("=", start));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces in ${mapName}`);
}

/** Pull the keys out of one `const NAME: Record<IconName, …> = { … }` block. */
function mapKeys(mapName: string): string[] {
  const start = src.indexOf(`const ${mapName}:`);
  expect(start, `${mapName} map not found in Icon.tsx`).toBeGreaterThan(-1);
  const open = src.indexOf("{", src.indexOf("=", start));
  // Walk braces so nested JSX/objects inside a glyph don't end the block early.
  let depth = 0;
  let end = open;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  const body = src.slice(open + 1, end);
  // Top-level keys only: `name:` or `"name":` at brace depth 0 of the body.
  const keys: string[] = [];
  let d = 0;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (d === 0) {
      const m = trimmed.match(/^"?([a-z-]+)"?:\s/);
      if (m) keys.push(m[1]);
    }
    for (const ch of line) {
      if (ch === "{" || ch === "(" || ch === "[") d++;
      else if (ch === "}" || ch === ")" || ch === "]") d--;
    }
  }
  return keys;
}

/** The names declared in the IconName union. */
function unionNames(): string[] {
  const start = src.indexOf("export type IconName");
  const end = src.indexOf(";", start);
  return [...src.slice(start, end).matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
}

describe("Icon registry", () => {
  const names = unionNames();
  const paper = mapKeys("PAPER");
  const flat = mapKeys("FLAT");

  it("declares at least one icon", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it("PAPER covers every IconName", () => {
    expect([...paper].sort()).toEqual([...names].sort());
  });

  it("FLAT covers every IconName", () => {
    expect([...flat].sort()).toEqual([...names].sort());
  });

  it("the two materials draw the same vocabulary", () => {
    // The point of the wrapper: switching skin can never change which icons
    // exist, only how they are drawn.
    expect([...paper].sort()).toEqual([...flat].sort());
  });

  it("every paper glyph declares its own viewBox", () => {
    // Paper glyphs are drawn on per-icon grids (8, 10, 12, 14, 19…) and scale
    // via width/height. A missing vb silently renders at the wrong scale.
    const glyphBlocks = mapBody("PAPER").split(/\n  "?[a-z-]+"?:\s/).slice(1);
    expect(glyphBlocks.length).toBe(paper.length);
    for (const [i, block] of glyphBlocks.entries()) {
      expect(block, `paper glyph "${paper[i]}" is missing a vb`).toContain("vb:");
    }
  });
});
