// The planning kernel — ONE definition of the week's rules, for BOTH runtimes.
//
// Nuvo answers "what is my week" on two surfaces that run in different places:
// the SPA (browser, `src/lib/*`) and the agent (Deno, `supabase/functions/*`).
// Every rule written twice has drifted at least once:
//
//   · the agent read the sprint's `big_rocks` while every UI surface derived the
//     slate from project spans — so Nuvo said "no priorities set" over a full deck
//   · `planningWeekStart` shifted Saturday to next Monday in the app and to *this*
//     Monday on the server — so on Saturdays the two planned different weeks
//   · `_shared/nlp.ts` is a 92-line re-implementation of the 207-line
//     `src/lib/nlp.ts`, so the same capture parses differently in the two paths
//
// So: the rules live here, once, and both sides import this file. It is checked
// by `tests/planning-kernel.test.ts`, which fails if any surface defines its own
// copy of a rule named here.
//
// Constraints that keep it importable from both runtimes — don't break them:
//   1 · ZERO imports. Deno resolves no bare specifiers here (no date-fns), and
//       the browser bundle should not grow a dependency for four date rules.
//   2 · Pure. No `Deno`, no `window`, no `supabase`, no I/O. A rule returns a
//       value or a PATCH; each side applies the patch with its own client.
//   3 · It lives under `supabase/functions/_shared/` because the edge bundler
//       only guarantees that path; Vite can import from anywhere in the repo.
//       Read it as "shared kernel", not as "server code".

// ── the vocabulary ───────────────────────────────────────────────────────────

/** Everything a week rule needs to know about a project. Both runtimes map into
 *  this: the client's `Project` already matches structurally, the server's row
 *  goes through `fromProjectRow`. */
export interface SpanProject {
  startDate: string | null;
  targetDate: string | null;
  status: string;
  shippedAt: string | null;
}

/** A Supabase `projects` row, as far as the week rules care. */
export interface ProjectRow {
  start_date?: string | null;
  target_date?: string | null;
  status?: string | null;
  shipped_at?: string | null;
}

export function fromProjectRow(row: ProjectRow): SpanProject {
  return {
    startDate: row.start_date ?? null,
    targetDate: row.target_date ?? null,
    status: row.status ?? "",
    shippedAt: row.shipped_at ?? null,
  };
}

/** The project-status vocabulary. `done` is a legacy synonym for `complete`;
 *  `dropped` for `cancelled`. Mirrors `isProjectComplete` / `isOpenStatus`. */
export const isCompleteStatus = (s: string): boolean => s === "complete" || s === "done";
export const isDroppedStatus = (s: string): boolean => s === "cancelled" || s === "dropped";
export const isOpenProjectStatus = (s: string): boolean => !isCompleteStatus(s) && !isDroppedStatus(s);

// ── dates: pure UTC arithmetic over YYYY-MM-DD ───────────────────────────────
// Date-only values compared in one fixed zone. UTC, not local: a rule that
// parses "2026-07-20" as local midnight gives a different answer either side of
// a DST boundary depending on where the runtime is, which is precisely the class
// of bug this file exists to remove.

const DAY_MS = 86_400_000;

/** ms at UTC midnight of a YYYY-MM-DD date. NaN when unparseable. */
export function dayMs(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** YYYY-MM-DD for a UTC-midnight timestamp. */
export function isoOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a date-only ISO string. */
export function dayOfWeek(iso: string): number {
  return new Date(dayMs(iso)).getUTCDay();
}

/**
 * Monday of the week you are planning, from the calendar date you are standing
 * in. **The weekend plans the week ahead** — on Saturday and Sunday "this week"
 * means the one that starts Monday, because the week you are in is over.
 *
 * The server used to shift only Sunday, so from Saturday the agent planned the
 * week that was ending while the app planned the week ahead. One rule now.
 */
export function planningWeekStart(todayISO: string): string {
  const base = dayMs(todayISO);
  if (Number.isNaN(base)) return todayISO;
  const dow = new Date(base).getUTCDay();
  const shift = dow === 0 ? 1 : dow === 6 ? 2 : 0; // weekend → next Monday
  const shifted = base + shift * DAY_MS;
  const sinceMonday = (new Date(shifted).getUTCDay() + 6) % 7;
  return isoOf(shifted - sinceMonday * DAY_MS);
}

/**
 * The span a project takes when it is committed to a week: Monday → Friday,
 * widened by whole weeks for anything that already spanned several. This is the
 * ONE placement formula — the desktop deck's drag, the phone's drop, the sprint
 * picker in the record, "bring it in" on the Priorities editor, and the agent's
 * create_priority all land identically because they all come through here.
 */
export function weekSpanFor(weekStartISO: string, widthWeeks = 1): { startDate: string; targetDate: string } {
  const w = Math.max(1, Math.floor(widthWeeks));
  return { startDate: weekStartISO, targetDate: isoOf(dayMs(weekStartISO) + ((w - 1) * 7 + 4) * DAY_MS) };
}

/** How many whole weeks a project currently occupies (1 without a start). */
export function spanWidthWeeks(p: Pick<SpanProject, "startDate" | "targetDate">): number {
  if (!p.startDate || !p.targetDate) return 1;
  const d = dayMs(p.targetDate) - dayMs(p.startDate);
  if (Number.isNaN(d)) return 1;
  return Math.max(1, Math.floor(d / (7 * DAY_MS)) + 1);
}

// ── naming a day out loud ────────────────────────────────────────────────────
// "Next Wednesday" said on a Tuesday means Wednesday of NEXT week — never
// tomorrow. The agent read it as tomorrow, put a dinner on the wrong day, and
// then had to be talked out of it; the correction produced a second event. A
// spoken day is a rule, not a judgement call, so it lives here and both runtimes
// resolve it identically.

export const WEEKDAY_NAMES = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;
export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

/** `iso` shifted by whole days, still YYYY-MM-DD. */
export function addDaysISO(iso: string, days: number): string {
  const base = dayMs(iso);
  return Number.isNaN(base) ? iso : isoOf(base + days * DAY_MS);
}

/**
 * Monday of the calendar week `iso` falls in — the week the user is *standing*
 * in, with no weekend shift. Deliberately NOT `planningWeekStart`: that one
 * rolls the weekend forward to the week being planned, which is right for a
 * sprint and wrong for a sentence. Reading "next Friday" on a Saturday through
 * the planning week lands 13 days out; through the calendar week it lands 6,
 * which is what a person means.
 */
export function calendarWeekStart(iso: string): string {
  const base = dayMs(iso);
  if (Number.isNaN(base)) return iso;
  const sinceMonday = (new Date(base).getUTCDay() + 6) % 7;
  return isoOf(base - sinceMonday * DAY_MS);
}

/** The seven dates of a Monday-started week, keyed by weekday name. */
export function weekDates(weekStartISO: string): Record<WeekdayName, string> {
  const monday = calendarWeekStart(weekStartISO);
  const out = {} as Record<WeekdayName, string>;
  for (let i = 0; i < 7; i++) {
    const iso = addDaysISO(monday, i);
    out[WEEKDAY_NAMES[dayOfWeek(iso)]] = iso;
  }
  return out;
}

/** The weekday a phrase names ("wed", "Wednesday"), or null. */
export function weekdayFromName(name: string): WeekdayName | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  return WEEKDAY_NAMES.find((d) => d === n || (n.length >= 3 && d.startsWith(n))) ?? null;
}

/**
 * The date a spoken day phrase means, from the day the user is standing in.
 *
 *   · `"next"`  → that weekday in the week AFTER this calendar week. Always a
 *                 different week, so "next Wednesday" on a Tuesday is 8 days
 *                 out, never tomorrow.
 *   · `"this"`  → that weekday in this calendar week, even if it has passed
 *                 (the caller decides whether a past date is an error).
 *   · `"soonest"` (a bare "Wednesday") → the next occurrence strictly after
 *                 today, which is what "put it on Wednesday" asks for.
 */
export function resolveDayPhrase(
  todayISO: string,
  weekday: WeekdayName,
  qualifier: "next" | "this" | "soonest",
): string {
  const target = WEEKDAY_NAMES.indexOf(weekday);
  if (target < 0 || Number.isNaN(dayMs(todayISO))) return todayISO;
  if (qualifier === "soonest") {
    const ahead = (target - dayOfWeek(todayISO) + 7) % 7;
    return addDaysISO(todayISO, ahead === 0 ? 7 : ahead);
  }
  const week = calendarWeekStart(todayISO);
  return weekDates(qualifier === "next" ? addDaysISO(week, 7) : week)[weekday];
}

// ── the two membership rules ─────────────────────────────────────────────────

/**
 * Does the project's committed span cover any of this week's WORKING days
 * (Mon–Fri)?
 *
 * Weekdays, not the whole 7, on purpose: the deck anchors a span to its own
 * column's week start, which a user's `week_start` setting can put on a Sunday —
 * while the sprint week here is always Monday-based. Testing all 7 makes those
 * grids share a boundary day, so a project committed to *next* week leaks into
 * this one through that single overlapping Sunday.
 */
export function spansWeek(p: Pick<SpanProject, "startDate" | "targetDate">, weekStartISO: string): boolean {
  const monday = dayMs(weekStartISO);
  const saturday = monday + 5 * DAY_MS; // exclusive — Mon 00:00 → Sat 00:00
  if (!p.targetDate) return false; // no finish line = still needs a sprint
  const end = dayMs(p.targetDate) + DAY_MS - 1; // through the end of that day
  const start = p.startDate ? dayMs(p.startDate) : end;
  if (Number.isNaN(monday) || Number.isNaN(end) || Number.isNaN(start)) return false;
  return start < saturday && end >= monday;
}

/** Did the project ship *inside* this week? `shippedAt` is the only honest
 *  answer — `targetDate` is when it was DUE. */
export function shippedInWeek(p: Pick<SpanProject, "status" | "shippedAt">, weekStartISO: string): boolean {
  if (!isCompleteStatus(p.status) || !p.shippedAt) return false;
  const monday = dayMs(weekStartISO);
  const at = new Date(p.shippedAt).getTime();
  if (Number.isNaN(monday) || Number.isNaN(at)) return false;
  return at >= monday && at < monday + 7 * DAY_MS;
}

/**
 * THE SLATE — what you committed to this week, for the scoreboard.
 *
 * Keeps a project that shipped *inside* this week: finishing your biggest thing
 * on Wednesday must not erase it from the week's plan and quietly shrink
 * "N of M landed". One that shipped in an earlier week is correctly gone.
 */
export function isOnSlate(p: SpanProject, weekStartISO: string): boolean {
  if (isDroppedStatus(p.status)) return false;
  if (!spansWeek(p, weekStartISO)) return false;
  return isCompleteStatus(p.status) ? shippedInWeek(p, weekStartISO) : true;
}

/**
 * ON DECK — what you can still WORK on this week. The planning/pull question, so
 * shipped and dropped projects are correctly gone. (For the scoreboard, which
 * must keep what you shipped, use `isOnSlate`.)
 */
export function isOnDeckThisWeek(p: SpanProject, weekStartISO: string): boolean {
  if (!isOpenProjectStatus(p.status)) return false;
  return spansWeek(p, weekStartISO);
}

/** A project that exists but has no week yet — the "needs a sprint" pool, the
 *  candidates any surface offers when you're adding to the slate. */
export function needsASprint(p: SpanProject): boolean {
  return isOpenProjectStatus(p.status) && !p.targetDate;
}

/** Ids on the slate, in the order given. The whole derivation in one call, so a
 *  surface can never "nearly" implement it. */
export function deriveSlateIds<T extends SpanProject & { id: string }>(projects: T[], weekStartISO: string): string[] {
  return projects.filter((p) => isOnSlate(p, weekStartISO)).map((p) => p.id);
}

/** Ids workable this week, in the order given. */
export function deriveOnDeckIds<T extends SpanProject & { id: string }>(projects: T[], weekStartISO: string): string[] {
  return projects.filter((p) => isOnDeckThisWeek(p, weekStartISO)).map((p) => p.id);
}

// ── the two write acts ───────────────────────────────────────────────────────
// A patch, not a write. Each runtime applies it with its own client (the browser
// through `useVertical.updateProject`, the agent through the service role), but
// what the act MEANS is decided once, here — so "bring it into the week" cannot
// mean one thing on a thumb and another in the chat.

/** Bring a project onto a week's slate. `null` when it is already there — the
 *  caller can then say "already this week's" instead of writing a no-op. */
export function bringIntoWeekPatch(
  p: SpanProject,
  weekStartISO: string,
  // The literal type (not `string`) keeps the patch assignable to the client's
  // `Partial<Project>` without the kernel importing the client's status union.
): { startDate: string; targetDate: string; status?: "in_progress" } | null {
  if (spansWeek(p, weekStartISO)) return null;
  const span = weekSpanFor(weekStartISO, spanWidthWeeks(p));
  // A backlog project being pulled into a week is being started.
  return p.status === "backlog" ? { ...span, status: "in_progress" } : span;
}

/** Take a project off the week — back to "needs a sprint", work intact. The
 *  exact inverse of the above, and the same act as dragging its card off. */
export function takeOffWeekPatch(): { startDate: null; targetDate: null } {
  return { startDate: null, targetDate: null };
}

/**
 * Give a project **another week** — keep it starting where it starts, push its
 * finish out by one. The remediation when a week has room for some of a
 * project's work but not all of it: the same project simply runs longer, which
 * is what an On Deck span already means. One project, one outcome, one pace
 * number — a second "Part 2" *project* would be a new object with a near-identical
 * name and no outcome of its own, and would split the ship and pace math in two.
 */
export function spanAnotherWeekPatch(
  p: Pick<SpanProject, "startDate" | "targetDate">,
  weekStartISO: string,
): { startDate: string; targetDate: string } {
  const start = p.startDate ?? weekStartISO;
  return weekSpanFor(start, spanWidthWeeks({ startDate: start, targetDate: p.targetDate }) + 1);
}

/**
 * Move a project **out to the next week**, keeping how long it runs. The
 * remediation when none of it fits: it isn't dropped and it isn't half-done, it's
 * deliberately later — the honest answer to "this week can't carry it".
 */
export function pushToNextWeekPatch(
  p: Pick<SpanProject, "startDate" | "targetDate">,
  weekStartISO: string,
): { startDate: string; targetDate: string } {
  const nextMonday = isoOf(dayMs(weekStartISO) + 7 * DAY_MS);
  return weekSpanFor(nextMonday, spanWidthWeeks(p));
}

/** The same two patches in row shape, for the runtime that speaks snake_case. */
export function toRowPatch(patch: { startDate: string | null; targetDate: string | null; status?: string }): Record<string, unknown> {
  const out: Record<string, unknown> = { start_date: patch.startDate, target_date: patch.targetDate };
  if (patch.status) out.status = patch.status;
  return out;
}
