import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Anchor,
  Baby,
  BarChart3,
  Bike,
  BookOpen,
  Brain,
  Briefcase,
  Broom,
  Building2,
  Camera,
  Car,
  ChartNoAxesCombined,
  ChessKnight,
  Church,
  CircleDot,
  Clapperboard,
  CloudSun,
  Code2,
  Coffee,
  Compass,
  Cross,
  Diamond,
  Dog,
  Dumbbell,
  Factory,
  Flame,
  Flower2,
  Footprints,
  Gamepad2,
  Gem,
  Globe2,
  GraduationCap,
  Guitar,
  Hammer,
  HandHeart,
  Handshake,
  HeartHandshake,
  HeartPulse,
  House,
  Landmark,
  Languages,
  Laptop,
  Leaf,
  Microscope,
  Moon,
  Mountain,
  Music,
  Package,
  Palette,
  PartyPopper,
  PawPrint,
  PenLine,
  PersonStanding,
  Plane,
  Plus,
  Presentation,
  Receipt,
  Salad,
  Scale,
  Scissors,
  Shapes,
  Shield,
  ShoppingBasket,
  Sparkles,
  Sprout,
  Star,
  Stethoscope,
  Store,
  Sun,
  Target,
  TentTree,
  TreePine,
  TrendingUp,
  Trophy,
  University,
  Utensils,
  Vote,
  Wallet,
  Waves,
  Wrench,
} from "lucide-react";
import {
  DEFAULT_DOMAIN_SYMBOL,
  normalizeDomainSymbol,
} from "./domainSymbolKeys";
export {
  DEFAULT_DOMAIN_SYMBOL,
  DOMAIN_SYMBOL_KEYS,
  LEGACY_DOMAIN_SYMBOLS,
  normalizeDomainSymbol,
} from "./domainSymbolKeys";

export type DomainSymbolCategory =
  | "Work"
  | "Money"
  | "Health"
  | "Relationships"
  | "Home"
  | "Faith & meaning"
  | "Learning"
  | "Creative"
  | "Community"
  | "Travel & outdoors"
  | "Play & sport"
  | "General";

export interface DomainSymbolEntry {
  key: string;
  label: string;
  category: DomainSymbolCategory;
  keywords: string[];
  icon: LucideIcon;
}

const symbol = (
  key: string,
  label: string,
  category: DomainSymbolCategory,
  icon: LucideIcon,
  keywords: string[],
): DomainSymbolEntry => ({ key, label, category, icon, keywords: [label.toLowerCase(), ...keywords] });

/** One compact identity vocabulary for every domain surface.
 * Explicit imports keep the Lucide bundle tree-shakeable; this is deliberately
 * broad enough for a stranger's account without becoming an icon browser. */
export const DOMAIN_SYMBOLS: DomainSymbolEntry[] = [
  symbol("briefcase", "Briefcase", "Work", Briefcase, ["work", "job", "career", "business", "office"]),
  symbol("building", "Building", "Work", Building2, ["company", "corporate", "organization"]),
  symbol("laptop", "Laptop", "Work", Laptop, ["work", "code", "engineering", "software", "computer", "technology"]),
  symbol("code", "Code", "Work", Code2, ["developer", "programming", "technical"]),
  symbol("trending-up", "Growth chart", "Work", TrendingUp, ["sales", "revenue", "metrics", "progress"]),
  symbol("handshake", "Handshake", "Work", Handshake, ["team", "partnership", "clients", "networking"]),
  symbol("target", "Target", "Work", Target, ["goals", "focus", "priorities", "aim"]),
  symbol("hammer", "Hammer", "Work", Hammer, ["building", "tools", "maker", "trade", "repair"]),
  symbol("factory", "Factory", "Work", Factory, ["operations", "industry", "manufacturing"]),
  symbol("store", "Store", "Work", Store, ["retail", "shop", "commerce"]),
  symbol("presentation", "Presentation", "Work", Presentation, ["speaking", "teaching", "meeting"]),
  symbol("package", "Package", "Work", Package, ["product", "shipping", "delivery"]),
  symbol("scale", "Scales", "Work", Scale, ["law", "legal", "justice", "balance"]),
  symbol("stethoscope", "Stethoscope", "Work", Stethoscope, ["medicine", "doctor", "clinical", "healthcare"]),

  symbol("wallet", "Wallet", "Money", Wallet, ["finance", "savings", "wealth", "cash", "budget"]),
  symbol("landmark", "Bank", "Money", Landmark, ["finance", "institution", "investing"]),
  symbol("chart", "Chart", "Money", BarChart3, ["finance", "budget", "investing", "statistics", "reports"]),
  symbol("analytics", "Analytics", "Money", ChartNoAxesCombined, ["performance", "market", "trading"]),
  symbol("receipt", "Receipt", "Money", Receipt, ["finance", "bills", "taxes", "admin", "expenses"]),

  symbol("heart-pulse", "Heart pulse", "Health", HeartPulse, ["wellbeing", "medical", "cardio"]),
  symbol("activity", "Activity", "Health", Activity, ["fitness", "running", "exercise", "movement"]),
  symbol("dumbbell", "Dumbbell", "Health", Dumbbell, ["gym", "strength", "workout", "lifting"]),
  symbol("person-standing", "Standing person", "Health", PersonStanding, ["mindfulness", "yoga", "meditation", "posture"]),
  symbol("salad", "Salad", "Health", Salad, ["nutrition", "diet", "food", "eating"]),
  symbol("moon", "Moon", "Health", Moon, ["sleep", "rest", "recovery", "night"]),
  symbol("bike", "Bicycle", "Health", Bike, ["cycling", "fitness", "exercise"]),
  symbol("footprints", "Footprints", "Health", Footprints, ["walking", "running", "steps"]),
  symbol("cross", "Care cross", "Health", Cross, ["first aid", "recovery", "care"]),

  symbol("heart-handshake", "Caring hands", "Relationships", HeartHandshake, ["family", "relationship", "partner", "care"]),
  symbol("baby", "Baby", "Relationships", Baby, ["children", "kids", "parenting"]),
  symbol("gem", "Gem", "Relationships", Gem, ["marriage", "spouse", "commitment"]),
  symbol("paw-print", "Paw print", "Relationships", PawPrint, ["pets", "animals"]),
  symbol("dog", "Dog", "Relationships", Dog, ["pet", "animal"]),

  symbol("house", "House", "Home", House, ["household", "family", "property"]),
  symbol("broom", "Broom", "Home", Broom, ["chores", "cleaning", "housework"]),
  symbol("wrench", "Wrench", "Home", Wrench, ["maintenance", "fix", "tools"]),
  symbol("sprout", "Sprout", "Home", Sprout, ["garden", "plants", "yard", "growth"]),
  symbol("shopping", "Shopping basket", "Home", ShoppingBasket, ["groceries", "errands", "buy"]),
  symbol("utensils", "Utensils", "Home", Utensils, ["cooking", "meals", "food"]),
  symbol("car", "Car", "Home", Car, ["commute", "errands", "driving", "vehicle"]),

  symbol("hand-heart", "Open hand", "Faith & meaning", HandHeart, ["faith", "prayer", "gratitude", "spiritual"]),
  symbol("church", "Church", "Faith & meaning", Church, ["worship", "christian", "religion"]),
  symbol("flame", "Flame", "Faith & meaning", Flame, ["candle", "reflection", "ritual", "spirit"]),
  symbol("compass", "Compass", "Faith & meaning", Compass, ["purpose", "direction", "values", "guidance"]),
  symbol("shield", "Shield", "Faith & meaning", Shield, ["protection", "integrity", "principles"]),
  symbol("anchor", "Anchor", "Faith & meaning", Anchor, ["grounding", "steadiness", "hope"]),

  symbol("book-open", "Open book", "Learning", BookOpen, ["reading", "books", "study", "education"]),
  symbol("graduation-cap", "Graduation cap", "Learning", GraduationCap, ["school", "academic", "teaching"]),
  symbol("brain", "Brain", "Learning", Brain, ["mindset", "thinking", "knowledge"]),
  symbol("microscope", "Microscope", "Learning", Microscope, ["science", "research", "discovery"]),
  symbol("languages", "Languages", "Learning", Languages, ["language", "translation", "study"]),

  symbol("palette", "Palette", "Creative", Palette, ["art", "design", "painting"]),
  symbol("pen-line", "Writing pen", "Creative", PenLine, ["writing", "journaling", "notes"]),
  symbol("music", "Music", "Creative", Music, ["audio", "song", "band"]),
  symbol("guitar", "Guitar", "Creative", Guitar, ["instrument", "band", "song"]),
  symbol("camera", "Camera", "Creative", Camera, ["photography", "photo"]),
  symbol("clapperboard", "Film", "Creative", Clapperboard, ["video", "movie", "production"]),
  symbol("scissors", "Scissors", "Creative", Scissors, ["craft", "making", "sewing"]),

  symbol("globe", "Globe", "Community", Globe2, ["world", "global", "international"]),
  symbol("party-popper", "Celebration", "Community", PartyPopper, ["social", "party", "friends"]),
  symbol("vote", "Ballot", "Community", Vote, ["civic", "volunteering", "service"]),
  symbol("university", "Institution", "Community", University, ["government", "community", "public"]),

  symbol("plane", "Plane", "Travel & outdoors", Plane, ["travel", "trip", "vacation", "flight"]),
  symbol("mountain", "Mountain", "Travel & outdoors", Mountain, ["adventure", "hiking", "climbing"]),
  symbol("tent", "Tent", "Travel & outdoors", TentTree, ["camping", "adventure"]),
  symbol("tree", "Tree", "Travel & outdoors", TreePine, ["forest", "nature", "outdoors"]),
  symbol("leaf", "Leaf", "Travel & outdoors", Leaf, ["nature", "environment", "garden"]),
  symbol("waves", "Waves", "Travel & outdoors", Waves, ["water", "ocean", "swimming", "surf"]),
  symbol("sun", "Sun", "Travel & outdoors", Sun, ["weather", "summer", "light"]),
  symbol("cloud-sun", "Changing weather", "Travel & outdoors", CloudSun, ["weather", "outside"]),

  symbol("gamepad", "Game controller", "Play & sport", Gamepad2, ["gaming", "hobby", "fun"]),
  symbol("chess-knight", "Chess knight", "Play & sport", ChessKnight, ["strategy", "games", "chess"]),
  symbol("trophy", "Trophy", "Play & sport", Trophy, ["sports", "competition", "achievement"]),
  symbol("coffee", "Coffee", "Play & sport", Coffee, ["social", "cafe", "break"]),

  symbol(DEFAULT_DOMAIN_SYMBOL, "Diamond", "General", Diamond, ["default", "neutral"]),
  symbol("circle-dot", "Circle and dot", "General", CircleDot, ["center", "focus"]),
  symbol("star", "Star", "General", Star, ["favorite", "important"]),
  symbol("sparkles", "Sparkles", "General", Sparkles, ["possibility", "new", "special"]),
  symbol("shapes", "Shapes", "General", Shapes, ["varied", "collection"]),
  symbol("flower", "Flower", "General", Flower2, ["beauty", "growth"]),
  symbol("plus", "Plus", "General", Plus, ["add", "positive", "cross"]),
];

const BY_KEY = new Map(DOMAIN_SYMBOLS.map((entry) => [entry.key, entry]));

export function domainSymbolEntry(value: string | null | undefined): DomainSymbolEntry {
  const key = normalizeDomainSymbol(value);
  return BY_KEY.get(key) ?? BY_KEY.get(DEFAULT_DOMAIN_SYMBOL)!;
}

export function searchDomainSymbols(query: string): DomainSymbolEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return DOMAIN_SYMBOLS;
  return DOMAIN_SYMBOLS.filter((entry) =>
    entry.category.toLowerCase().includes(q)
    || entry.key.includes(q)
    || entry.keywords.some((keyword) => keyword.includes(q)),
  );
}

export function suggestDomainSymbol(text: string): string | null {
  const lower = text.toLowerCase();
  const words = lower.split(/\W+/).filter(Boolean);
  let best: DomainSymbolEntry | null = null;
  let bestScore = 0;
  for (const entry of DOMAIN_SYMBOLS) {
    let score = 0;
    for (const keyword of entry.keywords) {
      if (lower.includes(keyword)) score += keyword.includes(" ") ? 2 : 1;
      else if (words.includes(keyword)) score += 1;
    }
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best?.key ?? null;
}
