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

function expandDateAliases(s: string): string {
  let out = s;
  for (const [re, full] of DATE_ALIASES) out = out.replace(re, full);
  return out;
}

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

/**
 * Parse a capture string like:
 *   "call David tomorrow 9am 30m #church !high @sermon // bring the outline"
 * into a structured task draft. Tokens are stripped from the title.
 */
export function parseCapture(input: string, refDate: Date = new Date()): ParsedCapture {
  let working = input;
  const chips: ParsedCapture["chips"] = [];
  const refISO = toDateISO(refDate);

  // Recurrence — strip cadence phrases before title/date mining.
  const rec = parseRecurrencePhrase(working, refISO);
  const recurrence: RecurrenceRule | null = rec.rule;
  const recurrenceAnchor: string | null = rec.anchorDate;
  if (rec.rule) {
    working = rec.stripped;
    chips.push({ kind: "repeat", text: describeRule(rec.rule, recurrenceAnchor ?? refISO) });
  }

  // // note — pull the freeform tail out FIRST so its text isn't mined for tokens
  // (dates, #labels) that belong to the description, not the task structure.
  let notes: string | null = null;
  const noteMatch = working.match(NOTE_RE);
  if (noteMatch) {
    const body = noteMatch[2].trim();
    if (body) {
      notes = body;
      chips.push({ kind: "note", text: body.length > 32 ? body.slice(0, 32) + "…" : body });
    }
    working = working.replace(NOTE_RE, "");
  }

  // #labels
  const labels: string[] = [];
  working = working.replace(LABEL_RE, (_, name: string) => {
    labels.push(name);
    chips.push({ kind: "label", text: `#${name}` });
    return "";
  });

  // @route — a single slug the consumer resolves to a project/initiative/domain.
  let route: string | null = null;
  const routeMatch = working.match(ROUTE_RE);
  if (routeMatch) {
    route = routeMatch[2];
    chips.push({ kind: "route", text: `@${route}` });
    working = working.replace(ROUTE_RE, "$1");
  }

  // !priority
  let priority: TaskPriority = "none";
  working = working.replace(PRIORITY_RE, (_, p: string) => {
    priority = parsePriority(p);
    chips.push({ kind: "priority", text: `!${priority}` });
    return "";
  });

  // duration token (check before chrono so "30m" isn't eaten as a time)
  let durationMinutes: number | null = null;
  const dMatch = working.match(DURATION_TOKEN_RE);
  if (dMatch) {
    const parsed = parseDurationToken(dMatch[1]);
    if (parsed && parsed >= 5 && parsed <= 24 * 60) {
      durationMinutes = parsed;
      chips.push({ kind: "duration", text: dMatch[1].replace(/\s+/g, "") });
      working = working.replace(dMatch[0], "");
    }
  }

  // natural-language date/time via chrono. Expand casual abbreviations into
  // `working` itself first so chrono's matched span strips cleanly from the title
  // (an alias only survives in the title if chrono didn't claim it as a date).
  working = expandDateAliases(working);
  let doDate: string | null = null;
  let startTime: Date | null = null;
  const results = chrono ? chrono.parse(working, refDate, { forwardDate: true }) : [];
  if (results.length > 0) {
    const r = results[0];
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
    working = working.replace(r.text, "");
  }

  const title = working.replace(/\s{2,}/g, " ").trim();
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
  };
}
