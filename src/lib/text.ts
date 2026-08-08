// Title-case a name the way a headline reads: capitalize the significant
// words, leave the small joining words (and/of/the…) lowercase mid-phrase,
// and never touch an existing acronym (SCE, IFVG, AI).
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "per", "the", "to", "vs", "via", "with"]);

export function titleCase(raw: string): string {
  const words = raw.trim().split(/\s+/);
  if (words.length === 0) return raw;
  return words
    .map((w, i) => {
      if (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w; // keep acronyms
      const lower = w.toLowerCase();
      const bare = lower.replace(/[^a-z]/g, "");
      if (i !== 0 && i !== words.length - 1 && SMALL_WORDS.has(bare)) return lower;
      return lower.replace(/[a-z]/, (c) => c.toUpperCase()); // capitalize first letter
    })
    .join(" ");
}
