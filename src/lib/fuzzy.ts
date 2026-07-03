// Tiny dependency-free fuzzy matcher — subsequence match with boundary/contiguity
// scoring. Good enough for picker lists (repos, mentions, commands). Higher score
// = better; -Infinity means the query isn't even a subsequence of the target.

export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;
  if (!t) return -Infinity;

  // Contiguous substring — the common case (you typed the actual name). Decisive:
  // it must beat any gapped subsequence, so a greedy scan can't grab an earlier
  // stray letter (the "n" in "philchan") over the real "nuvo".
  const sub = t.indexOf(q);
  if (sub >= 0) {
    let s = 40 + q.length;
    if (sub === 0 || /[/\-_. ]/.test(t[sub - 1])) s += 8; // starts on a word boundary
    s -= sub * 0.1; // earlier start edges a later one
    return s - (t.length - q.length) * 0.05; // prefer tighter
  }

  // Subsequence fallback — abbreviations ("sld" → super-leader-dashboard).
  let qi = 0;
  let score = 0;
  let streak = 0;
  let prev = -1;
  let firstIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    if (firstIdx < 0) firstIdx = ti;
    let s = 2; // base per matched char
    if (prev >= 0) {
      const gap = ti - prev - 1;
      if (gap === 0) {
        streak += 1;
        s += 3 + streak * 2; // contiguous run — strongly preferred
      } else {
        streak = 0;
        s -= Math.min(3, gap * 0.5); // penalize skipped chars (capped)
      }
    }
    // word-boundary hit (start, or after a separator) — what people aim at
    if (ti === 0 || /[/\-_. ]/.test(t[ti - 1])) s += 4;
    score += s;
    prev = ti;
    qi += 1;
  }
  if (qi < q.length) return -Infinity; // not all query chars consumed, in order
  score -= firstIdx * 0.1; // a match that starts earlier edges one that starts late
  return score - (t.length - q.length) * 0.05; // prefer tighter matches
}

/** Filter + rank `items` by how well `query` fuzzy-matches `key(item)`. Empty
 *  query returns the input order, capped at `limit`. */
export function fuzzyFilter<T>(query: string, items: T[], key: (item: T) => string, limit = 50): T[] {
  const q = query.trim();
  if (!q) return items.slice(0, limit);
  return items
    .map((item) => ({ item, score: fuzzyScore(q, key(item)) }))
    .filter((x) => x.score > -Infinity)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.item);
}
