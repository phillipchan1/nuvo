// The curated domain face — categories, search, and the local guess.
//
// src/lib/domainEmoji.ts landed 2026-08-31 with IconPicker and had no test.
// IconPicker only calls these two functions; this file drives them directly
// (no picker, no product edits). ALL_EMOJI is private — the empty-query
// search *is* the flat deduped list.

import { describe, expect, it } from "vitest";
import {
  DOMAIN_EMOJI_CATEGORIES,
  searchDomainEmoji,
  suggestDomainEmoji,
} from "../src/lib/domainEmoji";

const CATEGORY_LABELS = [
  "Work",
  "Money",
  "Health",
  "Family",
  "Home",
  "Spirit",
  "Growth",
  "Creative",
  "Community",
  "Play",
] as const;

const rawEntries = () => DOMAIN_EMOJI_CATEGORIES.flatMap((c) => c.entries);
const fullList = () => searchDomainEmoji("");

describe("curated categories", () => {
  it("declares the standing fixtures, each with at least one face", () => {
    expect(DOMAIN_EMOJI_CATEGORIES.map((c) => c.label)).toEqual([...CATEGORY_LABELS]);
    for (const cat of DOMAIN_EMOJI_CATEGORIES) {
      expect(cat.entries.length, `${cat.label} is empty`).toBeGreaterThan(0);
      for (const entry of cat.entries) {
        expect(entry.emoji, `${cat.label} has a faceless row`).toBeTruthy();
        expect(entry.keywords.length, `${entry.emoji} has no keywords`).toBeGreaterThan(0);
      }
    }
  });
});

describe("searchDomainEmoji", () => {
  it("empty or whitespace returns the full deduped list", () => {
    const full = fullList();
    const raw = rawEntries();
    const firstSeen = [...new Set(raw.map((e) => e.emoji))];

    expect(searchDomainEmoji("")).toEqual(full);
    expect(searchDomainEmoji("   ")).toEqual(full);
    expect(searchDomainEmoji("\t\n")).toEqual(full);

    expect(full.map((e) => e.emoji)).toEqual(firstSeen);
    expect(new Set(full.map((e) => e.emoji)).size).toBe(full.length);
    expect(full.length, "cross-category dupes must collapse").toBeLessThan(raw.length);
  });

  it("otherwise matches a case-insensitive keyword substring", () => {
    const work = searchDomainEmoji("WORK");
    expect(work.map((e) => e.emoji)).toContain("💼");
    expect(work.every((e) => e.keywords.some((k) => k.includes("work")))).toBe(true);

    const fin = searchDomainEmoji("Fin");
    expect(fin.map((e) => e.emoji)).toEqual(
      expect.arrayContaining(["💰", "💵", "🏦", "📊", "🧾"]),
    );
    expect(fin.every((e) => e.keywords.some((k) => k.includes("fin")))).toBe(true);

    // Substring of a keyword, not the other way around — "workplace" is not in "work".
    expect(searchDomainEmoji("workplace")).toEqual([]);
    expect(searchDomainEmoji("zzzznotanemoji")).toEqual([]);
  });
});

describe("duplicates across categories merge keywords", () => {
  it("one row per emoji, keywords unioned from every category that lists it", () => {
    const raw = rawEntries();
    const full = fullList();
    const dupes = raw.map((e) => e.emoji).filter((e, i, all) => all.indexOf(e) !== i);
    expect(dupes, "the set still has 🎯 and 🌱 in two categories").toEqual(
      expect.arrayContaining(["🎯", "🌱"]),
    );

    for (const emoji of new Set(dupes)) {
      const merged = full.find((e) => e.emoji === emoji);
      const union = [...new Set(raw.filter((e) => e.emoji === emoji).flatMap((e) => e.keywords))];
      expect(merged, `${emoji} missing from the flat list`).toBeTruthy();
      expect(new Set(merged!.keywords)).toEqual(new Set(union));
      expect(full.filter((e) => e.emoji === emoji)).toHaveLength(1);
    }

    // A Work-only keyword on 🎯 still finds it after the Growth copy merged in.
    expect(searchDomainEmoji("priorities").map((e) => e.emoji)).toContain("🎯");
    // A Growth-only keyword on 🌱 still finds it after the Home copy merged in.
    expect(searchDomainEmoji("learning").map((e) => e.emoji)).toContain("🌱");
    expect(searchDomainEmoji("yard").map((e) => e.emoji)).toContain("🌱");
  });
});

describe("suggestDomainEmoji", () => {
  it("returns null when nothing scores, else the first-highest keyword hit", () => {
    expect(suggestDomainEmoji("")).toBeNull();
    expect(suggestDomainEmoji("zzzzqwerty")).toBeNull();

    // "career" hits 💼, 📈, 🎓 equally (score 1). First-seen in the flat list wins.
    expect(suggestDomainEmoji("career")).toBe("💼");
    expect(suggestDomainEmoji("Work")).toBe("💼");
  });

  it("scores keyword hits in the passed text; a multi-word keyword is worth 2", () => {
    // Callers (IconPicker) concatenate name + context; this function just scores the string.
    expect(suggestDomainEmoji("Work engineering")).toBe("💻");
    // "health career" is one keyword on 🩺 (score 2) and beats a lone "health" (1).
    expect(suggestDomainEmoji("Health career")).toBe("🩺");
    expect(suggestDomainEmoji("personal development")).toBe("🌱");
    expect(suggestDomainEmoji("mental health")).toBe("🧘");
  });
});
