import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOMAIN_SYMBOL,
  DOMAIN_SYMBOL_KEYS,
  DOMAIN_SYMBOLS,
  LEGACY_DOMAIN_SYMBOLS,
  domainSymbolEntry,
  normalizeDomainSymbol,
  searchDomainSymbols,
  suggestDomainSymbol,
} from "../src/lib/domainSymbols";

const CATEGORY_LABELS = [
  "Work",
  "Money",
  "Health",
  "Relationships",
  "Home",
  "Faith & meaning",
  "Learning",
  "Creative",
  "Community",
  "Travel & outdoors",
  "Play & sport",
  "General",
] as const;

describe("domain symbol catalog", () => {
  it("is broad, uniquely keyed, and renderable", () => {
    expect(DOMAIN_SYMBOLS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(DOMAIN_SYMBOLS.map((entry) => entry.key)).size).toBe(DOMAIN_SYMBOLS.length);
    expect(new Set(DOMAIN_SYMBOLS.map((entry) => entry.key))).toEqual(new Set(DOMAIN_SYMBOL_KEYS));
    expect(new Set(DOMAIN_SYMBOLS.map((entry) => entry.category))).toEqual(new Set(CATEGORY_LABELS));

    for (const entry of DOMAIN_SYMBOLS) {
      expect(entry.key).toMatch(/^[a-z0-9-]+$/);
      expect(entry.label).toBeTruthy();
      expect(entry.keywords.length).toBeGreaterThan(0);
      expect(typeof entry.icon, `${entry.key} has no Lucide component`).toBe("object");
    }
  });

  it("keeps every legacy assignment inside the new vocabulary", () => {
    const keys = new Set(DOMAIN_SYMBOLS.map((entry) => entry.key));
    for (const [legacy, key] of Object.entries(LEGACY_DOMAIN_SYMBOLS)) {
      expect(legacy).toBeTruthy();
      expect(keys.has(key), `${legacy} maps to missing symbol ${key}`).toBe(true);
      expect(normalizeDomainSymbol(legacy)).toBe(key);
    }
  });

  it("migrates every legacy assignment and permits every catalog key", () => {
    const migration = readFileSync(
      join(__dirname, "../supabase/migrations/00000000000078_domain_symbols.sql"),
      "utf8",
    );
    for (const [legacy, key] of Object.entries(LEGACY_DOMAIN_SYMBOLS)) {
      expect(migration, `migration misses legacy value ${legacy}`).toContain(`'${legacy}'`);
      expect(migration, `migration misses mapped key ${key}`).toContain(`'${key}'`);
    }
    for (const key of DOMAIN_SYMBOL_KEYS) {
      expect(migration, `migration rejects catalog key ${key}`).toContain(`'${key}'`);
    }
  });

  it("uses a neutral symbol for empty or unknown legacy values", () => {
    expect(normalizeDomainSymbol("")).toBe(DEFAULT_DOMAIN_SYMBOL);
    expect(normalizeDomainSymbol(null)).toBe(DEFAULT_DOMAIN_SYMBOL);
    expect(normalizeDomainSymbol("an arbitrary native glyph")).toBe(DEFAULT_DOMAIN_SYMBOL);
    expect(domainSymbolEntry("not-a-key").key).toBe(DEFAULT_DOMAIN_SYMBOL);
  });
});

describe("searchDomainSymbols", () => {
  it("returns the full catalog for an empty query", () => {
    expect(searchDomainSymbols("")).toEqual(DOMAIN_SYMBOLS);
    expect(searchDomainSymbols("   ")).toEqual(DOMAIN_SYMBOLS);
  });

  it("matches labels, categories, keys, and keyword substrings", () => {
    expect(searchDomainSymbols("WORK").map((entry) => entry.key)).toContain("briefcase");
    expect(searchDomainSymbols("fin").map((entry) => entry.key)).toEqual(
      expect.arrayContaining(["wallet", "landmark", "chart", "receipt"]),
    );
    expect(searchDomainSymbols("faith").map((entry) => entry.key)).toEqual(
      expect.arrayContaining(["hand-heart", "church"]),
    );
    expect(searchDomainSymbols("zzzznotasymbol")).toEqual([]);
  });
});

describe("suggestDomainSymbol", () => {
  it("returns null when nothing scores", () => {
    expect(suggestDomainSymbol("")).toBeNull();
    expect(suggestDomainSymbol("zzzzqwerty")).toBeNull();
  });

  it("suggests from a domain's name and context", () => {
    expect(suggestDomainSymbol("Work")).toBe("briefcase");
    expect(suggestDomainSymbol("Work engineering")).toBe("laptop");
    expect(suggestDomainSymbol("personal finance and savings")).toBe("wallet");
    expect(suggestDomainSymbol("writing and journaling")).toBe("pen-line");
    expect(suggestDomainSymbol("camping outdoors")).toBe("tent");
  });
});
