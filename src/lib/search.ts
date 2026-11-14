/**
 * Search — what "find X" means, once, for both shells (D-210).
 *
 * The phone's Search sheet and the desktop's `/` door are two layouts over this
 * read model; neither ranks anything itself. It is pure and local — the vertical
 * and the task rows are already in memory, so a keystroke never waits on a
 * network round-trip. The calendar half stays where it was (`eventSearch.ts`,
 * a bounded server read that lands a beat later in its own group).
 *
 * What it knows about the person searching, beyond string matching:
 *
 *   · **Words, in any order, at the start of words.** "deck sce" finds
 *     "SCE — rebuild the deck". Every word you type has to land somewhere;
 *     none of them has to be in order. Initials count ("sce" →
 *     "Sunday Church Experience").
 *   · **Live work outranks the archive.** A task due today, a project in
 *     flight, something you opened from here last week — those are what an
 *     operator mid-day is reaching for. Done and shipped things are still found
 *     (*"did I actually finish that?"* is a real question, D7) but sit below
 *     the live match with the same words.
 *   · **A date is a place.** "friday", "dec 3", "tomorrow" — the same parser
 *     capture uses (`parseCapture`) — offers to take you to that day.
 *   · **Where you went last.** An empty search shows the last things you
 *     opened from it, on this device. Nothing more: the empty state is not a
 *     dashboard, and the week's slate already has a home (useWeekCrown).
 */

import { parseCapture } from "./nlp";
import type { Task } from "./types";
import {
  domainById,
  initiativeById,
  isProjectComplete,
  projectById,
  taskDomainColor,
  type Domain,
  type Initiative,
  type Project,
  type VerticalData,
} from "./vertical";

export type SearchKind = "task" | "project" | "initiative" | "domain";

/** A matched stretch of the title — `[start, end)` — for the row to embolden. */
export type MatchRange = readonly [number, number];

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  /** Where it lives: "Domain · Initiative", a task's project, "Inbox". */
  context?: string;
  /** Its domain's hue, when it has one. */
  color?: string;
  /** The domain's symbol key — only domain hits carry one. */
  icon?: string;
  /** Done task · shipped/cancelled record. Still found, drawn receded. */
  done: boolean;
  /** A short, honest "when" for a task: `Today`, `Tue`, `Nov 30`, `Overdue`. */
  when?: string;
  ranges: MatchRange[];
  score: number;
}

export interface SearchSection {
  kind: SearchKind;
  label: string;
  hits: SearchHit[];
}

export interface SearchInput {
  vertical: VerticalData;
  tasks: readonly Task[];
  /** Local `YYYY-MM-DD` — the day "today" and "overdue" are measured against. */
  today: string;
  /** Most recent first — what was opened from search on this device. */
  recent?: readonly RecentRef[];
}

const LABEL: Record<SearchKind, string> = {
  task: "Tasks",
  project: "Projects",
  initiative: "Initiatives",
  domain: "Domains",
};

/** Per section. The best of each kind is what matters; a wall of 40 task rows
 *  is a list view, and the list views already exist. */
const PER_KIND = 6;

// ── Matching ────────────────────────────────────────────────────────────────

/** Lower-case and strip accents, keeping string length 1:1 so ranges map back
 *  onto the original title. */
function fold(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const lower = c.toLowerCase();
    out += lower.length === 1 ? (lower.normalize("NFD")[0] ?? lower) : c;
  }
  return out;
}

export function queryWords(q: string): string[] {
  return fold(q)
    .split(/[\s,·/]+/)
    .map((w) => w.replace(/^[#@]+/, ""))
    .filter(Boolean);
}

/** Start index of every word in `s` (after a non-alphanumeric, or a case hump). */
function wordStarts(s: string): number[] {
  const starts: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!/[\p{L}\p{N}]/u.test(c)) continue;
    const prev = i === 0 ? "" : s[i - 1];
    if (i === 0 || !/[\p{L}\p{N}]/u.test(prev)) starts.push(i);
  }
  return starts;
}

interface TextMatch {
  score: number;
  ranges: MatchRange[];
}

/**
 * How well a query's words land in one string.
 *
 * Every word must land, or it's no match at all. Per word: at the start of a
 * word in the text (strong), inside a word (weak). Bonuses for the whole query
 * being the text, or its opening. A single word may also land as the text's
 * initials. Returns null when any word misses.
 */
export function matchText(words: readonly string[], raw: string, initials = true): TextMatch | null {
  if (!raw || words.length === 0) return null;
  const text = fold(raw);
  const starts = wordStarts(text);
  const ranges: MatchRange[] = [];
  let score = 0;

  // Initials: "sce" → Sunday Church Experience. Only a single, short-ish word —
  // a longer one is a word, not an acronym.
  if (initials && words.length === 1 && words[0].length >= 2 && words[0].length <= 6 && starts.length >= words[0].length) {
    const initials = starts.map((i) => text[i]).join("");
    const at = initials.indexOf(words[0]);
    if (at >= 0 && !text.includes(words[0])) {
      return {
        score: 70 + (at === 0 ? 20 : 0),
        ranges: starts.slice(at, at + words[0].length).map((i) => [i, i + 1] as const),
      };
    }
  }

  for (const w of words) {
    let best: { s: number; at: number } | null = null;
    for (const st of starts) {
      if (text.startsWith(w, st)) {
        best = { s: st === 0 ? 120 : 100, at: st };
        break;
      }
    }
    if (!best) {
      // Inside a word — only for 3+ characters, or "a" matches every title.
      const at = w.length >= 3 ? text.indexOf(w) : -1;
      if (at < 0) return null;
      best = { s: 40, at };
    }
    score += best.s;
    ranges.push([best.at, best.at + w.length]);
  }

  const whole = words.join(" ");
  if (text.trim() === whole) score += 400;
  else if (text.startsWith(whole)) score += 150;
  // Shorter texts with the same words are the more specific match.
  score += Math.max(0, 30 - Math.floor(text.length / 4));

  return { score, ranges: mergeRanges(ranges) };
}

function mergeRanges(rs: MatchRange[]): MatchRange[] {
  const sorted = [...rs].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * Title first; a secondary field (an outcome, a project name, notes) may carry
 * words the title lacks. A hit that needs the secondary is a weaker hit, and it
 * emboldens only what landed in the title.
 */
function matchItem(words: readonly string[], title: string, secondary: readonly (string | null | undefined)[]): TextMatch | null {
  const t = matchText(words, title);
  if (t) return t;
  const hay = [title, ...secondary.filter(Boolean)].join(" · ");
  // No initials here: an acronym names a thing, and a task isn't "mbd" because
  // its project is "Move billing database".
  const all = matchText(words, hay, false);
  if (!all) return null;
  const inTitle = all.ranges
    .filter(([a]) => a < title.length)
    .map(([a, b]) => [a, Math.min(b, title.length)] as const);
  return { score: Math.round(all.score * 0.45), ranges: inTitle };
}

// ── Liveness — what an operator mid-day is reaching for ─────────────────────

function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

const SHORT_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The one-word "when" a task row carries — relative where a word pins it. */
export function taskWhen(t: Pick<Task, "do_date" | "status" | "deadline">, today: string): string | undefined {
  if (t.status === "done") return undefined;
  const date = t.do_date ?? null;
  if (!date) return t.deadline ? `Due ${shortDate(t.deadline, today)}` : undefined;
  const d = daysBetween(today, date);
  if (d < 0) return "Overdue";
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  return shortDate(date, today);
}

function shortDate(iso: string, today: string): string {
  const [y, m, day] = iso.split("-").map(Number);
  const d = daysBetween(today, iso);
  if (d > 1 && d < 7) return SHORT_DOW[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
  const ty = Number(today.slice(0, 4));
  return y === ty ? `${SHORT_MON[m - 1]} ${day}` : `${SHORT_MON[m - 1]} ${day}, ${y}`;
}

function taskLiveness(t: Task, today: string): number {
  if (t.status === "done") return 0;
  let s = 0;
  if (t.do_date) {
    const d = daysBetween(today, t.do_date);
    if (d <= 0) s += 45; // today, or overdue — the thing in your head right now
    else if (d <= 7) s += 25;
    else s += 5;
  } else if (t.status === "inbox") s += 12; // just captured — "where did I put that?"
  if (t.deadline && daysBetween(today, t.deadline) <= 7) s += 15;
  return s;
}

function recordLiveness(status: string): number {
  if (status === "in_progress") return 30;
  if (status === "waiting") return 15;
  if (status === "backlog") return 5;
  return 0;
}

// ── Recents ─────────────────────────────────────────────────────────────────

export interface RecentRef {
  kind: SearchKind;
  id: string;
}

const RECENT_KEY = "nuvo-search-recent";
const RECENT_MAX = 6;

/** Per device, per browser — a convenience, never state that must survive. */
export function readRecent(): RecentRef[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as RecentRef[]) : [];
    return Array.isArray(list) ? list.filter((r) => r && typeof r.id === "string" && r.kind in LABEL) : [];
  } catch {
    return [];
  }
}

export function rememberRecent(ref: RecentRef): void {
  try {
    const next = [ref, ...readRecent().filter((r) => !(r.kind === ref.kind && r.id === ref.id))].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private window — search still works, it just won't remember */
  }
}

// ── Hits ────────────────────────────────────────────────────────────────────

function projectContext(v: VerticalData, p: Project): string | undefined {
  const dom = domainById(v, p.domainId)?.name;
  const init = p.initiativeId ? initiativeById(v, p.initiativeId)?.name : undefined;
  return [dom, init].filter(Boolean).join(" · ") || undefined;
}

export function taskContext(v: VerticalData, t: Task): string {
  if (t.project_id) return projectById(v, t.project_id)?.name ?? "Project";
  if (t.initiative_id) return initiativeById(v, t.initiative_id)?.name ?? "Initiative";
  if (t.domain_id) return domainById(v, t.domain_id)?.name ?? "Domain";
  return t.status === "inbox" ? "Inbox" : "Loose";
}

function projectHit(v: VerticalData, p: Project, m: TextMatch | null): SearchHit {
  return {
    kind: "project",
    id: p.id,
    title: p.name,
    context: projectContext(v, p),
    color: domainById(v, p.domainId)?.color,
    done: isProjectComplete(p.status) || p.status === "cancelled",
    ranges: m?.ranges ?? [],
    score: (m?.score ?? 0) + recordLiveness(p.status) + 10,
  };
}

function initiativeHit(v: VerticalData, i: Initiative, m: TextMatch | null): SearchHit {
  return {
    kind: "initiative",
    id: i.id,
    title: i.name,
    context: domainById(v, i.domainId)?.name,
    color: domainById(v, i.domainId)?.color,
    done: isProjectComplete(i.status) || i.status === "cancelled",
    ranges: m?.ranges ?? [],
    score: (m?.score ?? 0) + recordLiveness(i.status) + 8,
  };
}

function domainHit(d: Domain, m: TextMatch | null): SearchHit {
  return {
    kind: "domain",
    id: d.id,
    title: d.name,
    context: d.intention || undefined,
    color: d.color,
    icon: d.icon,
    done: false,
    ranges: m?.ranges ?? [],
    score: (m?.score ?? 0) + 15,
  };
}

function taskHit(v: VerticalData, t: Task, today: string, m: TextMatch | null): SearchHit {
  return {
    kind: "task",
    id: t.id,
    title: t.title,
    context: taskContext(v, t),
    color: taskDomainColor(v, t) ?? undefined,
    done: t.status === "done",
    when: taskWhen(t, today),
    ranges: m?.ranges ?? [],
    score: (m?.score ?? 0) + taskLiveness(t, today),
  };
}

/** A task the search can show: not trashed, and not a step of another task. */
function searchable(t: Task): boolean {
  return t.status !== "trashed" && !t.parent_task_id;
}

/**
 * The ranked answer for a query, as sections — each kind's best few, and the
 * sections ordered by their best hit, so ↵ on the first row is the best answer
 * whatever kind it is. An empty query returns no sections (see `recentHits`).
 */
export function searchSections(query: string, input: SearchInput): SearchSection[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const { vertical: v, tasks, today } = input;
  const recentRank = new Map((input.recent ?? []).map((r, i) => [`${r.kind}:${r.id}`, i]));
  const bump = (h: SearchHit): SearchHit => {
    const r = recentRank.get(`${h.kind}:${h.id}`);
    // Something you went to from here before — very likely what you're after again.
    if (r != null) h.score += 60 - r * 6;
    // Done sinks below the live match with the same words, never out of sight.
    // (a done title match must not outrank live work found through its project).
    if (h.done) h.score = Math.round(h.score * 0.4) - 30;
    return h;
  };

  const hits: Record<SearchKind, SearchHit[]> = { task: [], project: [], initiative: [], domain: [] };

  for (const p of v.projects) {
    const m = matchItem(words, p.name, [p.outcome, domainById(v, p.domainId)?.name]);
    if (m) hits.project.push(bump(projectHit(v, p, m)));
  }
  for (const i of v.initiatives) {
    const m = matchItem(words, i.name, [i.outcome, domainById(v, i.domainId)?.name]);
    if (m) hits.initiative.push(bump(initiativeHit(v, i, m)));
  }
  for (const d of v.domains) {
    const m = matchItem(words, d.name, [d.intention]);
    if (m) hits.domain.push(bump(domainHit(d, m)));
  }
  for (const t of tasks) {
    if (!searchable(t)) continue;
    // The parent's name lets "deck slides" find the task "slides" in project "Deck".
    const parent = t.project_id ? projectById(v, t.project_id)?.name : t.initiative_id ? initiativeById(v, t.initiative_id)?.name : null;
    const m = matchItem(words, t.title, [parent, t.notes]);
    if (m) hits.task.push(bump(taskHit(v, t, today, m)));
  }

  const sections: SearchSection[] = [];
  for (const kind of ["task", "project", "initiative", "domain"] as const) {
    const list = hits[kind].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, PER_KIND);
    if (list.length) sections.push({ kind, label: LABEL[kind], hits: list });
  }
  return sections.sort((a, b) => b.hits[0].score - a.hits[0].score);
}

/** The empty search: the last few things opened from it, still alive. */
export function recentHits(input: SearchInput): SearchHit[] {
  const { vertical: v, tasks, today } = input;
  const out: SearchHit[] = [];
  for (const r of input.recent ?? []) {
    if (r.kind === "project") {
      const p = projectById(v, r.id);
      if (p) out.push(projectHit(v, p, null));
    } else if (r.kind === "initiative") {
      const i = initiativeById(v, r.id);
      if (i) out.push(initiativeHit(v, i, null));
    } else if (r.kind === "domain") {
      const d = domainById(v, r.id);
      if (d) out.push(domainHit(d, null));
    } else {
      const t = tasks.find((x) => x.id === r.id);
      if (t && searchable(t)) out.push(taskHit(v, t, today, null));
    }
  }
  return out;
}

// ── A date is a place ───────────────────────────────────────────────────────

export interface DateIntent {
  /** Local `YYYY-MM-DD`. */
  dateISO: string;
  /** "Friday, November 20" — what the row says. */
  label: string;
}

/**
 * "friday", "dec 3", "tomorrow", "in 2 weeks" → that day, when the WHOLE query
 * is a date. Parsed by capture's own parser, so a date means the same thing in
 * search as it does when you type it into ⌘K. "call mom friday" is not a date —
 * it's a search that happens to contain one.
 */
export function dateIntent(query: string, now: Date = new Date()): DateIntent | null {
  const q = query.trim();
  if (q.length < 3) return null;
  let parsed;
  try {
    parsed = parseCapture(q, now);
  } catch {
    return null;
  }
  if (!parsed.doDate || parsed.title.trim() || parsed.recurrence) return null;
  const [y, m, d] = parsed.doDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const label = date.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: y === now.getFullYear() ? undefined : "numeric",
  });
  return { dateISO: parsed.doDate, label };
}
