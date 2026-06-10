import * as chrono from "chrono-node";
import type { TaskPriority } from "./types";
import { snapMinutes, toDateISO } from "./dates";

export interface ParsedCapture {
  title: string;
  doDate: string | null; // 'YYYY-MM-DD'
  startTime: Date | null; // concrete instant if a time was given
  durationMinutes: number | null;
  labels: string[];
  priority: TaskPriority;
  /** Human-readable fragments for the live preview chips. */
  chips: { kind: "date" | "time" | "duration" | "label" | "priority"; text: string }[];
}

const DURATION_RE = /\b(?:(\d+)\s*h(?:r|our)?s?)?\s*(?:(\d+)\s*m(?:in|ins|inutes)?\b)?/i;
const DURATION_TOKEN_RE = /\b(\d+h(?:\d+m?)?|\d+\s*h(?:ours?|rs?)?(?:\s*\d+\s*m(?:ins?)?)?|\d+\s*m(?:ins?)?)\b/i;
const LABEL_RE = /#([\w-]+)/g;
const PRIORITY_RE = /!(high|medium|med|low|none|h|m|l)\b/i;

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

/**
 * Parse a capture string like:
 *   "call David tomorrow 9am 30m #church !high"
 * into a structured task draft. Tokens are stripped from the title.
 */
export function parseCapture(input: string, refDate: Date = new Date()): ParsedCapture {
  let working = input;
  const chips: ParsedCapture["chips"] = [];

  // #labels
  const labels: string[] = [];
  working = working.replace(LABEL_RE, (_, name: string) => {
    labels.push(name);
    chips.push({ kind: "label", text: `#${name}` });
    return "";
  });

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

  // natural-language date/time via chrono
  let doDate: string | null = null;
  let startTime: Date | null = null;
  const results = chrono.parse(working, refDate, { forwardDate: true });
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
  return { title, doDate, startTime, durationMinutes, labels, priority, chips };
}
