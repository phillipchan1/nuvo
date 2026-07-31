import * as chrono from "npm:chrono-node@2.7.7";
import { parseRecurrencePhrase, type RecurrenceRule } from "./recurrence.ts";

export type TaskPriority = "none" | "low" | "medium" | "high";

export interface ParsedCapture {
  title: string;
  doDate: string | null;
  startTime: Date | null;
  durationMinutes: number | null;
  labels: string[];
  priority: TaskPriority;
  recurrence: RecurrenceRule | null;
  recurrenceAnchor: string | null;
}

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
  const hm = compact.match(/^(\d+)h(?:ours?|rs?)?(?:(\d+)m?(?:ins?)?)?$/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] ?? 0);
  const m = compact.match(/^(\d+)m(?:ins?)?$/);
  if (m) return Number(m[1]);
  return null;
}

function toDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function snapMinutes(d: Date, step = 15): Date {
  const out = new Date(d);
  out.setMinutes(Math.round(out.getMinutes() / step) * step, 0, 0);
  return out;
}

/** Parse capture syntax: "call David tomorrow 9am 30m #church !high" */
export function parseCapture(input: string, refDate: Date = new Date()): ParsedCapture {
  let working = input;
  const refISO = toDateISO(refDate);

  const rec = parseRecurrencePhrase(working, refISO);
  const recurrence = rec.rule;
  const recurrenceAnchor = rec.anchorDate;
  if (rec.rule) working = rec.stripped;

  const labels: string[] = [];
  working = working.replace(LABEL_RE, (_, name: string) => {
    labels.push(name);
    return "";
  });

  let priority: TaskPriority = "none";
  working = working.replace(PRIORITY_RE, (_, p: string) => {
    priority = parsePriority(p);
    return "";
  });

  let durationMinutes: number | null = null;
  const dMatch = working.match(DURATION_TOKEN_RE);
  if (dMatch) {
    const parsed = parseDurationToken(dMatch[1]);
    if (parsed && parsed >= 5 && parsed <= 24 * 60) {
      durationMinutes = parsed;
      working = working.replace(dMatch[0], "");
    }
  }

  let doDate: string | null = recurrenceAnchor;
  let startTime: Date | null = null;
  const results = chrono.parse(working, refDate, { forwardDate: true });
  if (results.length > 0) {
    const r = results[0];
    const d = r.start.date();
    doDate = toDateISO(d);
    if (r.start.isCertain("hour")) {
      startTime = snapMinutes(d);
      if (r.end && durationMinutes == null) {
        const mins = Math.round((r.end.date().getTime() - d.getTime()) / 60_000);
        if (mins > 0) durationMinutes = mins;
      }
    }
    working = working.replace(r.text, "");
  }

  const title = working.replace(/\s{2,}/g, " ").trim();
  return { title, doDate, startTime, durationMinutes, labels, priority, recurrence, recurrenceAnchor };
}
