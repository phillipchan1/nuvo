// A curated face for a domain — deliberately not the full emoji keyboard.
// Nuvo's domains are a handful of standing fixtures (Work, Family, Health…),
// not a chat, so the set stays small, professional, and legible at 14px
// rather than exhaustive. Same doctrine as SWATCHES in DomainParts.tsx: a
// short, considered list beats "everything Unicode allows."

export interface DomainEmojiEntry {
  emoji: string;
  /** What a search box matches against — the words a person actually types. */
  keywords: string[];
}

export const DOMAIN_EMOJI_CATEGORIES: { label: string; entries: DomainEmojiEntry[] }[] = [
  {
    label: "Work",
    entries: [
      { emoji: "💼", keywords: ["work", "job", "career", "business", "office"] },
      { emoji: "🏢", keywords: ["work", "office", "company", "corporate", "building"] },
      { emoji: "💻", keywords: ["work", "code", "engineering", "software", "computer", "tech", "dev"] },
      { emoji: "📈", keywords: ["growth", "sales", "revenue", "career", "business", "metrics"] },
      { emoji: "🤝", keywords: ["work", "team", "partnership", "clients", "networking"] },
      { emoji: "🎯", keywords: ["goals", "focus", "targets", "work", "priorities"] },
      { emoji: "🛠️", keywords: ["work", "building", "tools", "maker", "trade", "repair"] },
      { emoji: "⚖️", keywords: ["law", "legal", "justice", "balance"] },
      { emoji: "🩺", keywords: ["medicine", "doctor", "clinical", "health career"] },
      { emoji: "🎓", keywords: ["school", "teaching", "academic", "career", "graduation"] },
    ],
  },
  {
    label: "Money",
    entries: [
      { emoji: "💰", keywords: ["money", "finance", "savings", "wealth"] },
      { emoji: "💵", keywords: ["money", "cash", "budget", "finance"] },
      { emoji: "🏦", keywords: ["bank", "finance", "money", "savings"] },
      { emoji: "📊", keywords: ["finance", "budget", "investing", "stats", "reports"] },
      { emoji: "🧾", keywords: ["bills", "receipts", "taxes", "admin", "finance"] },
    ],
  },
  {
    label: "Health",
    entries: [
      { emoji: "❤️", keywords: ["health", "heart", "love", "wellbeing"] },
      { emoji: "🏃", keywords: ["fitness", "running", "exercise", "health", "cardio"] },
      { emoji: "🏋️", keywords: ["fitness", "gym", "strength", "workout", "health"] },
      { emoji: "🧘", keywords: ["mindfulness", "yoga", "calm", "meditation", "mental health"] },
      { emoji: "🥗", keywords: ["nutrition", "diet", "food", "eating", "health"] },
      { emoji: "😴", keywords: ["sleep", "rest", "recovery", "health"] },
      { emoji: "🩹", keywords: ["health", "medical", "recovery", "injury"] },
      { emoji: "🚴", keywords: ["cycling", "fitness", "biking", "exercise"] },
    ],
  },
  {
    label: "Family",
    entries: [
      { emoji: "👪", keywords: ["family", "parents", "household", "kids"] },
      { emoji: "👶", keywords: ["baby", "kids", "family", "children"] },
      { emoji: "🧑‍🤝‍🧑", keywords: ["relationships", "friends", "partner", "family"] },
      { emoji: "💍", keywords: ["marriage", "spouse", "relationship", "wedding"] },
      { emoji: "🐾", keywords: ["pets", "dog", "cat", "animal", "family"] },
    ],
  },
  {
    label: "Home",
    entries: [
      { emoji: "🏡", keywords: ["home", "house", "household", "family"] },
      { emoji: "🏠", keywords: ["home", "house", "household"] },
      { emoji: "🧹", keywords: ["chores", "cleaning", "home", "housework"] },
      { emoji: "🔧", keywords: ["repair", "maintenance", "home", "fix", "tools"] },
      { emoji: "🌱", keywords: ["garden", "plants", "home", "yard", "growth"] },
      { emoji: "🚗", keywords: ["car", "commute", "errands", "driving"] },
    ],
  },
  {
    label: "Spirit",
    entries: [
      { emoji: "🙏", keywords: ["faith", "prayer", "gratitude", "spiritual"] },
      { emoji: "✝️", keywords: ["faith", "church", "christian", "religion"] },
      { emoji: "⛪", keywords: ["church", "faith", "worship"] },
      { emoji: "🕯️", keywords: ["reflection", "faith", "calm", "spiritual", "ritual"] },
      { emoji: "🧭", keywords: ["purpose", "direction", "values", "guidance"] },
    ],
  },
  {
    label: "Growth",
    entries: [
      { emoji: "📚", keywords: ["reading", "learning", "books", "study", "growth"] },
      { emoji: "✍️", keywords: ["writing", "journaling", "creative", "notes"] },
      { emoji: "🧠", keywords: ["learning", "mindset", "growth", "thinking", "mental"] },
      { emoji: "🌱", keywords: ["growth", "personal development", "new", "learning"] },
      { emoji: "🎯", keywords: ["goals", "development", "growth", "focus"] },
    ],
  },
  {
    label: "Creative",
    entries: [
      { emoji: "🎨", keywords: ["art", "creative", "design", "painting"] },
      { emoji: "🎵", keywords: ["music", "creative", "audio", "band"] },
      { emoji: "🎸", keywords: ["music", "guitar", "band", "creative"] },
      { emoji: "📷", keywords: ["photography", "creative", "camera"] },
      { emoji: "🎬", keywords: ["film", "video", "creative", "production"] },
    ],
  },
  {
    label: "Community",
    entries: [
      { emoji: "🌍", keywords: ["community", "world", "global", "travel"] },
      { emoji: "🎉", keywords: ["social", "celebration", "party", "friends"] },
      { emoji: "🗳️", keywords: ["civic", "volunteering", "community", "service"] },
      { emoji: "🏛️", keywords: ["civic", "community", "government", "institution"] },
    ],
  },
  {
    label: "Play",
    entries: [
      { emoji: "✈️", keywords: ["travel", "trip", "vacation", "flight"] },
      { emoji: "🏔️", keywords: ["adventure", "outdoors", "hiking", "travel"] },
      { emoji: "⛺", keywords: ["camping", "outdoors", "adventure"] },
      { emoji: "🎮", keywords: ["gaming", "hobby", "play", "fun"] },
      { emoji: "♟️", keywords: ["strategy", "games", "hobby", "chess"] },
      { emoji: "⚽", keywords: ["sports", "hobby", "recreation", "soccer"] },
    ],
  },
];

// A few emoji earn a slot in more than one category (🎯 fits Work and Growth
// alike) — merge those into one entry so the flat list never shows a duplicate.
const ALL_EMOJI: DomainEmojiEntry[] = (() => {
  const byEmoji = new Map<string, Set<string>>();
  for (const { emoji, keywords } of DOMAIN_EMOJI_CATEGORIES.flatMap((c) => c.entries)) {
    const set = byEmoji.get(emoji) ?? new Set<string>();
    keywords.forEach((k) => set.add(k));
    byEmoji.set(emoji, set);
  }
  return [...byEmoji.entries()].map(([emoji, keywords]) => ({ emoji, keywords: [...keywords] }));
})();

export function searchDomainEmoji(query: string): DomainEmojiEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_EMOJI;
  return ALL_EMOJI.filter((e) => e.keywords.some((k) => k.includes(q)));
}

/** A fast, local guess from the domain's own words — no model round-trip.
 *  Same technique as `suggestedDomain` in SlideOver.tsx: score every entry by
 *  how many of its keywords appear in the text, keep the best. */
export function suggestDomainEmoji(text: string): string | null {
  const lower = text.toLowerCase();
  const words = lower.split(/\W+/).filter(Boolean);
  let best: DomainEmojiEntry | null = null;
  let bestScore = 0;
  for (const entry of ALL_EMOJI) {
    let score = 0;
    for (const k of entry.keywords) {
      if (lower.includes(k)) score += k.includes(" ") ? 2 : 1;
      else if (words.includes(k)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best?.emoji ?? null;
}
