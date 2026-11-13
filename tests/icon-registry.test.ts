// The Icon wrapper (src/components/Icon.tsx) maps every IconName to one Lucide
// glyph (D-189 retired the per-material hand-drawn set). The one real failure
// mode is drift — a name added to the union but not the map renders
// `undefined` and throws at runtime — so it is asserted here.
//
// Kept DOM-free on purpose: this suite runs in milliseconds on every push, and
// pulling in jsdom to render two <svg>s would cost more than it proves.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "..", "src", "components", "Icon.tsx"), "utf8");

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
  const glyphs = mapKeys("GLYPHS");

  it("declares at least one icon", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it("GLYPHS covers every IconName, and nothing else", () => {
    expect([...glyphs].sort()).toEqual([...names].sort());
  });
});
