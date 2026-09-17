// chrono-node is ~45 KB of parser tables the boot path never executes — capture
// is the only consumer. Loaded off the entry chunk the moment this module
// evaluates; in the sliver before it lands, parseCapture still handles every
// deterministic token and only skips natural-language dates (the next keystroke
// re-parses, so a capture preview self-heals).
let chrono: typeof import("chrono-node") | null = null;
/** Resolves once natural-language date parsing is available (tests await it). */
export const nlpReady = import("chrono-node").then((m) => {
  chrono = m;
});
import type { TaskPriority } from "./types";
import { snapMinutes, toDateISO } from "./dates";
import { parseRecurrencePhrase, describeRule, type RecurrenceRule } from "./recurrence";

export interface ParsedCapture {
  title: string;
  doDate: string | null; // 'YYYY-MM-DD'
  startTime: Date | null; // concrete instant if a time was given
  durationMinutes: number | null;
  labels: string[];
  priority: TaskPriority;
  /** A `//` note — the freeform description tail, verbatim. */
  notes: string | null;
  /** The raw `@token` text (a slug), to be resolved against the vertical by the
   *  consumer (the way `labels` are resolved to ids). */
  route: string | null;
  /** Parsed repeat rule, if the capture names a cadence. */
  recurrence: RecurrenceRule | null;
  /** Anchor date for the series when "starting today/tomorrow" is given. */
  recurrenceAnchor: string | null;
  /** Human-readable fragments for the live preview chips. */
  chips: { kind: "date" | "time" | "duration" | "label" | "priority" | "note" | "route" | "repeat"; text: string }[];
  /** Where each recognised token sits in the input, in order. */
  spans: CaptureSpan[];
}

const DURATION_RE = /\b(?:(\d+)\s*h(?:r|our)?s?)?\s*(?:(\d+)\s*m(?:in|ins|inutes)?\b)?/i;
const DURATION_TOKEN_RE = /\b(\d+h(?:\d+m?)?|\d+\s*h(?:ours?|rs?)?(?:\s*\d+\s*m(?:ins?)?)?|\d+\s*m(?:ins?)?)\b/i;
const LABEL_RE = /#([\w-]+)/g;
const PRIORITY_RE = /!(high|medium|med|low|none|h|m|l)\b/i;
// @route — a single slug token (letters/digits/-/_), e.g. "@church" or
// "@Sermon-prep". Must be preceded by start/space so "a@b" emails don't match.
const ROUTE_RE = /(^|\s)@([\w][\w-]*)/;
// // note — everything after a "// " marks the freeform description tail. Must be
// preceded by start/space so URLs ("https://…") aren't mistaken for a note.
const NOTE_RE = /(^|\s)\/\/(.*)$/;

// Casual date abbreviations chrono doesn't know natively (verified: it handles
// "tomorrow", "next tuesday", "next week" but not these). Expanded before chrono
// so the date still strips cleanly from the title. Whole-word, case-insensitive.
// NOTE: "tom" → "tomorrow" can misfire on the name "Tom"; the live preview chip
// surfaces the guess so a wrong read is visible and one tap to remove.
const DATE_ALIASES: [RegExp, string][] = [
  [/\btom\b/gi, "tomorrow"],
  [/\btmrw\b/gi, "tomorrow"],
  [/\btmr\b/gi, "tomorrow"],
  [/\bmon\b/gi, "monday"],
  [/\btues\b/gi, "tuesday"],
  [/\btue\b/gi, "tuesday"],
  [/\bweds\b/gi, "wednesday"],
  [/\bwed\b/gi, "wednesday"],
  [/\bthurs\b/gi, "thursday"],
  [/\bthur\b/gi, "thursday"],
  [/\bthu\b/gi, "thursday"],
  [/\bnext wk\b/gi, "next week"],
  [/\beod\b/gi, "today"],
  [/\beow\b/gi, "friday"],
  [/\bend of week\b/gi, "friday"],
];

function parsePriority(token: string): TaskPriority {
  const t = token.toLowerCase();
  if (t === "high" || t === "h") return "high";
  if (t === "medium" || t === "med" || t === "m") return "medium";
  if (t === "low" || t === "l") return "low";
  return "none";
}

function parseDurationToken(token: string): number | null {
  const compact = token.replace(/\s+/g, "").toLowerCase();
  // forms: 30m, 90m, 1h, 1h30, 1h30m, 2hours
  const hm = compact.match(/^(\d+)h(?:ours?|rs?)?(?:(\d+)m?(?:ins?)?)?$/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] ?? 0);
  const m = compact.match(/^(\d+)m(?:ins?)?$/);
  if (m) return Number(m[1]);
  void DURATION_RE;
  return null;
}

/** Fold a name to a comparable key — spaces/hyphens/case dropped — so the typed
 *  slug "@sermonprep" or "@Sermon-prep" both match the project "Sermon prep". */
export function routeKey(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, "");
}

export interface RouteTarget {
  id: string;
  kind: "project" | "initiative" | "domain";
  name: string;
}

/**
 * The title for a capture surface that does NOT resolve `@routes` itself — folds
 * an unresolved route back into the title so the intent survives into the Inbox
 * for grooming to home, rather than being silently stripped and lost.
 */
export function captureTitle(p: ParsedCapture, raw: string): string {
  const t = p.route ? `${p.title} @${p.route}`.trim() : p.title;
  return t || raw;
}

/**
 * Resolve a parsed `@route` slug against the open vertical. Exact key match wins;
 * otherwise a prefix match, biasing to the most specific altitude (project →
 * initiative → domain). Returns null when nothing matches — the consumer then
 * leaves the token literal in the title for inbox grooming to home.
 */
export function resolveRoute(route: string, targets: RouteTarget[]): RouteTarget | null {
  if (!route) return null;
  const key = routeKey(route);
  const rank = { project: 0, initiative: 1, domain: 2 } as const;
  const byRank = (a: RouteTarget, b: RouteTarget) => rank[a.kind] - rank[b.kind];
  const exact = targets.filter((t) => routeKey(t.name) === key).sort(byRank);
  if (exact.length) return exact[0];
  const prefix = targets.filter((t) => routeKey(t.name).startsWith(key)).sort(byRank);
  return prefix[0] ?? null;
}

export type CaptureTokenKind = ParsedCapture["chips"][number]["kind"];

/** Where a recognised token sits in the text the user typed. */
export interface CaptureSpan {
  kind: CaptureTokenKind;
  start: number;
  end: number;
  /** The token exactly as typed — the key a "keep as text" choice is stored under. */
  text: string;
}

export interface ParseOptions {
  /**
   * Tokens the user asked to keep as plain words (clicked a highlight, or a
   * chip's ×). Keyed by `literalKey(kind, text)`. A kept token stays in the
   * title and the next candidate of that kind, if any, is used instead.
   */
  literal?: ReadonlySet<string>;
}

/** The key a kept-as-text token is remembered by. Case-insensitive, like the grammar. */
export function literalKey(kind: CaptureTokenKind, text: string): string {
  return `${kind}:${text.trim().toLowerCase()}`;
}

/**
 * Casual date aliases expanded in place, with a map from each index of the
 * expanded string back to the typed one — so a date chrono finds in "tomorrow"
 * highlights the "tom" that was actually typed.
 */
function expandWithMap(s: string): { text: string; map: number[] } {
  type Hit = { start: number; end: number; full: string };
  const hits: Hit[] = [];
  for (const [re, full] of DATE_ALIASES) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of s.matchAll(g)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (hits.some((h) => start < h.end && end > h.start)) continue;
      hits.push({ start, end, full });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  let text = "";
  const map: number[] = [];
  let i = 0;
  for (const h of hits) {
    for (; i < h.start; i++) {
      text += s[i];
      map.push(i);
    }
    for (let k = 0; k < h.full.length; k++) {
      text += h.full[k];
      // Every expanded character points into the typed alias it came from.
      map.push(h.start + Math.min(k, h.end - h.start - 1));
    }
    i = h.end;
  }
  for (; i < s.length; i++) {
    text += s[i];
    map.push(i);
  }
  map.push(s.length);
  return { text, map };
}

/**
 * Parse a capture string like:
 *   "call David tomorrow 9am 30m #church !high @sermon // bring the outline"
 * into a structured task draft. Tokens are stripped from the title, and each
 * one's position in `input` is reported in `spans` so a capture box can
 * highlight what it understood without a second parser.
 *
 * Tokens are blanked to spaces rather than cut while parsing, so every index
 * stays an index into what the user typed; the title collapses the gaps.
 */
export function parseCapture(input: string, refDate: Date = new Date(), opts: ParseOptions = {}): ParsedCapture {
  const chips: ParsedCapture["chips"] = [];
  const spans: CaptureSpan[] = [];
  const kept = opts.literal;
  const isKept = (kind: CaptureTokenKind, text: string) => Boolean(kept?.has(literalKey(kind, text)));
  const refISO = toDateISO(refDate);

  // `working` becomes the title (claimed tokens blanked). `scan` is what every
  // matcher reads: claimed tokens blanked too, and kept ones masked so a later
  // matcher can't re-read them (a kept "5m" is not then a date).
  let working = input;
  let scan = input;
  const fill = (s: string, start: number, end: number, ch: string) =>
    s.slice(0, start) + ch.repeat(end - start) + s.slice(end);
  const claim = (kind: CaptureTokenKind, start: number, end: number) => {
    spans.push({ kind, start, end, text: input.slice(start, end) });
    working = fill(working, start, end, " ");
    scan = fill(scan, start, end, " ");
  };
  const protect = (start: number, end: number) => {
    scan = fill(scan, start, end, "\u00a4");
  };

  // Recurrence — strip cadence phrases before title/date mining.
  let recurrence: RecurrenceRule | null = null;
  let recurrenceAnchor: string | null = null;
  const rec = parseRecurrencePhrase(scan, refISO);
  const recText = rec.spans.map((s) => input.slice(s.start, s.end)).join(" ");
  if (rec.rule && isKept("repeat", recText)) {
    for (const s of rec.spans) protect(s.start, s.end);
  } else if (rec.rule) {
    recurrence = rec.rule;
    recurrenceAnchor = rec.anchorDate;
    for (const s of rec.spans) claim("repeat", s.start, s.end);
    chips.push({ kind: "repeat", text: describeRule(rec.rule, recurrenceAnchor ?? refISO) });
  }

  // // note — pull the freeform tail out FIRST so its text isn't mined for tokens
  // (dates, #labels) that belong to the description, not the task structure.
  let notes: string | null = null;
  const noteMatch = scan.match(NOTE_RE);
  if (noteMatch && noteMatch.index != null) {
    const start = noteMatch.index + noteMatch[1].length;
    const body = noteMatch[2].trim();
    if (!isKept("note", input.slice(start))) {
      if (body) {
        notes = body;
        chips.push({ kind: "note", text: body.length > 32 ? body.slice(0, 32) + "…" : body });
      }
      claim("note", start, input.length);
    } else {
      protect(start, input.length);
    }
  }

  // #labels
  const labels: string[] = [];
  for (const m of [...scan.matchAll(LABEL_RE)]) {
    const start = m.index ?? 0;
    if (isKept("label", m[0])) {
      protect(start, start + m[0].length);
      continue;
    }
    labels.push(m[1]);
    chips.push({ kind: "label", text: `#${m[1]}` });
    claim("label", start, start + m[0].length);
  }

  // @route — a single slug the consumer resolves to a project/initiative/domain.
  let route: string | null = null;
  for (const m of [...scan.matchAll(new RegExp(ROUTE_RE.source, "g"))]) {
    const start = (m.index ?? 0) + m[1].length;
    if (isKept("route", `@${m[2]}`)) {
      protect(start, start + m[2].length + 1);
      continue;
    }
    route = m[2];
    chips.push({ kind: "route", text: `@${route}` });
    claim("route", start, start + m[2].length + 1);
    break;
  }

  // !priority
  let priority: TaskPriority = "none";
  for (const m of [...scan.matchAll(new RegExp(PRIORITY_RE.source, "gi"))]) {
    const start = m.index ?? 0;
    if (isKept("priority", m[0])) {
      protect(start, start + m[0].length);
      continue;
    }
    priority = parsePriority(m[1]);
    chips.push({ kind: "priority", text: `!${priority}` });
    claim("priority", start, start + m[0].length);
    break;
  }

  // duration token (check before chrono so "30m" isn't eaten as a time)
  let durationMinutes: number | null = null;
  for (const m of [...scan.matchAll(new RegExp(DURATION_TOKEN_RE.source, "gi"))]) {
    const parsed = parseDurationToken(m[1]);
    if (!parsed || parsed < 5 || parsed > 24 * 60) continue;
    const start = (m.index ?? 0) + m[0].indexOf(m[1]);
    if (isKept("duration", m[1])) {
      protect(start, start + m[1].length);
      continue;
    }
    durationMinutes = parsed;
    chips.push({ kind: "duration", text: m[1].replace(/\s+/g, "") });
    claim("duration", start, start + m[1].length);
    break;
  }

  // natural-language date/time via chrono, over a copy with casual
  // abbreviations expanded — mapped back so the typed alias is what's claimed.
  let doDate: string | null = null;
  let startTime: Date | null = null;
  const expanded = expandWithMap(scan);
  const results = chrono ? chrono.parse(expanded.text, refDate, { forwardDate: true }) : [];
  for (const r of results) {
    const start = expanded.map[r.index];
    const end = (expanded.map[r.index + r.text.length - 1] ?? start) + 1;
    if (isKept("date", input.slice(start, end))) continue;
    const d = r.start.date();
    doDate = toDateISO(d);
    chips.push({ kind: "date", text: doDate });
    if (r.start.isCertain("hour")) {
      startTime = snapMinutes(d);
      chips.push({
        kind: "time",
        text: startTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      });
      // chrono ranges ("9-10am") give us a duration too
      if (r.end && durationMinutes == null) {
        const mins = Math.round((r.end.date().getTime() - d.getTime()) / 60_000);
        if (mins > 0) durationMinutes = mins;
      }
    }
    claim("date", start, end);
    break;
  }

  const title = working.replace(/\s{2,}/g, " ").trim();
  spans.sort((a, b) => a.start - b.start);
  return {
    title,
    doDate,
    startTime,
    durationMinutes,
    labels,
    priority,
    notes,
    route,
    recurrence,
    recurrenceAnchor,
    chips,
    spans,
  };
}
