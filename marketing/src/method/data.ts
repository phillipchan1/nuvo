/**
 * The method page's example world — five habits, one task followed through all
 * of them, and one week whose arithmetic is checkable on the page (the four
 * projects' pace sums to DEMAND; CAPACITY is the open hours of that week).
 *
 * Example data in the domain kinds of personas.md §1 (work · craft · health),
 * not one operator's life — P16. Nothing here is a statistic about users, and
 * every "Nuvo does" line names something shipped (D-246).
 */
import { CRAFT, HEALTH, WORK } from '../components/hues'

export const HABITS = [
  {
    id: 'one-place',
    n: '01',
    short: 'One place',
    title: 'Everything goes in one place.',
    habit:
      'Nothing lives in their head, in a second app, or at the bottom of an email. One place catches all of it, so nothing is waiting on memory.',
    nuvo: '⌥Space from anywhere on your Mac, ⌘K in the app, the ＋ or your voice on the phone. Type it the way you’d text it and it lands with its day, time and length, beside every calendar you own.',
  },
  {
    id: 'long-term',
    n: '02',
    short: 'The long view',
    title: 'They plan in quarters, not just days.',
    habit:
      'They know the few big outcomes this season is for, and every task traces back to one. A to-do list can’t see a quarter. They can.',
    nuvo: 'Initiatives hold the outcome and its date. Projects break it into things that finish, each with a pace. Tasks are the next real action, never orphaned from why they matter.',
  },
  {
    id: 'time-place',
    n: '03',
    short: 'A time and a place',
    title: 'Everything has a time and a place.',
    habit:
      'If it doesn’t have a time, it isn’t a plan. It’s a hope. They give the important work an hour before the urgent work takes it.',
    nuvo: 'A scheduled task is the block on your calendar: one thing, not two to keep in sync. On Sunday the week gets drafted into the hours that are actually open, around every meeting you can’t move. You adjust it and commit.',
  },
  {
    id: 'the-day',
    n: '04',
    short: 'The measured day',
    title: 'Every day is measured.',
    habit:
      'They start the day knowing its shape and end it knowing what landed. Not to grade it. So tomorrow starts warm instead of from scratch.',
    nuvo: 'A morning brief lays the day out before your inbox does. The next block knows which project it moves. The evening close says what landed, and what didn’t rolls forward with its project still attached.',
  },
  {
    id: 'tied-together',
    n: '05',
    short: 'Tied together',
    title: 'It all ties together.',
    habit:
      'They can tell you whether this week moved the quarter, with numbers instead of a feeling, while there’s still time to do something about it.',
    nuvo: 'Every project carries a pace. Every week carries a Commitment: what you took on against the hours you really have. Friday shows what moved, with evidence, and your real pace makes next Sunday’s plan more honest.',
  },
] as const

/* ── habit 01 — a sentence becomes structure ─────────────────────────────── */
export const CAPTURE_LINE = 'call Priya tomorrow 9am 30m #work'
export const CAPTURE_CHIPS = [
  { k: 'Task', v: 'Call Priya' },
  { k: 'When', v: 'Tomorrow, 9am' },
  { k: 'Length', v: '30m' },
  { k: 'Domain', v: 'Work', hue: WORK },
] as const

/* ── habit 03 — the week: the meetings you can't move, and the work placed
   in the hours they leave open. Same 8am–6pm grid as the home page. ──────── */
export const MEETINGS = [
  { day: 0, start: 9, end: 10, title: 'Standup' },
  { day: 0, start: 11, end: 12.5, title: 'Client call' },
  { day: 0, start: 14, end: 15, title: 'Hiring sync' },
  { day: 1, start: 9, end: 11, title: 'Board prep' },
  { day: 1, start: 14, end: 15, title: '1:1 · Priya' },
  { day: 2, start: 10, end: 11, title: 'Design review' },
  { day: 2, start: 12, end: 13, title: 'Lunch · Sam' },
  { day: 2, start: 14.5, end: 16, title: 'Quarterly plan' },
  { day: 3, start: 9, end: 10, title: 'Standup' },
  { day: 3, start: 10.5, end: 12.5, title: 'Offsite' },
  { day: 4, start: 9.5, end: 11, title: 'Interview' },
  { day: 4, start: 12, end: 13, title: 'Team lunch' },
] as const

export const PLACED = [
  { day: 0, start: 15.5, end: 17, title: 'Tier copy', sub: 'Pricing page', hue: WORK },
  { day: 1, start: 11.5, end: 13.5, title: 'Draft', sub: 'Chapter 4', hue: CRAFT },
  { day: 2, start: 8, end: 9, title: 'Run', sub: 'Half marathon', hue: HEALTH },
  { day: 3, start: 13.5, end: 15.5, title: 'Step 2', sub: 'Onboarding', hue: WORK },
  { day: 4, start: 14, end: 16, title: 'Revise', sub: 'Chapter 4', hue: CRAFT },
] as const

/* ── habit 04 — one day, measured at both ends ───────────────────────────── */
export const DAY = [
  { at: '7:30am', label: 'Morning brief', line: 'Three blocks. Two meetings. Four open hours.' },
  { at: '9:00am', label: 'Up now', line: 'Draft tier copy · Pricing page', prepared: true },
  { at: '6:00pm', label: 'Evening close', line: 'Two of three landed. One rolls to tomorrow.' },
] as const

/* ── habit 05 — the week against the quarter ─────────────────────────────── */
export const PROJECTS = [
  { name: 'Pricing page', left: 12, weeks: 3, hue: WORK, status: 'On pace' },
  { name: 'Onboarding rewrite', left: 12, weeks: 2, hue: WORK, status: '1 week behind', behind: true },
  { name: 'Chapter 4', left: 15, weeks: 3, hue: CRAFT, status: 'On pace' },
  { name: 'Half marathon', left: 64, weeks: 16, hue: HEALTH, status: 'On pace' },
] as const

/** Friday's read of the same week — agrees with the thread (Pricing page 6 of 7). */
export const FRIDAY = ['Pricing page · 6 of 7, on pace', 'Chapter 4 · 4,200 words', 'Three runs, all of them'] as const

export const PACE = PROJECTS.map((p) => ({ ...p, pace: p.left / p.weeks }))
export const DEMAND = PACE.reduce((s, p) => s + p.pace, 0) // 19
export const CAPACITY = 17
export const COMMITMENT = Math.round((DEMAND / CAPACITY) * 100) // 112

/* ── why it's hard: where each habit usually lives ───────────────────────── */
export const SCATTER = [
  { habit: 'One place', tool: 'A notes app', lost: 'The note never becomes a task' },
  { habit: 'The long view', tool: 'A project board', lost: 'The project never reaches Tuesday' },
  { habit: 'A time and a place', tool: 'A calendar', lost: 'The calendar only knows meetings' },
  { habit: 'The measured day', tool: 'Your memory', lost: 'Friday can’t say what moved' },
  { habit: 'Tied together', tool: 'A spreadsheet, or nothing', lost: 'The quarter finds out in March' },
] as const

/* ── one task, through all five habits ───────────────────────────────────── */
export const THREAD = [
  { habit: 'One place', when: 'Mon 8:02am', what: '“draft tier copy 45m”', note: 'Typed once, from anywhere.' },
  { habit: 'The long view', when: 'Mon 8:03am', what: 'Pricing page → Launch v2', note: 'Filed under the project, under the outcome.' },
  { habit: 'A time and a place', when: 'Sunday plan', what: 'Tue 9–9:45am', note: 'Placed between standup and board prep.' },
  { habit: 'The measured day', when: 'Tue 9:44am', what: 'Done ✓', note: 'The prepared draft was waiting when it started.' },
  { habit: 'Tied together', when: 'Friday', what: 'Pricing page · 6 of 7', note: 'On pace for its date. The quarter knows.' },
] as const

/* ── the partner: what Nuvo does inside each habit (all shipped) ─────────── */
export const PARTNER = [
  ['One place', 'Reads what you typed: the day, the time, the length, where it belongs.'],
  ['The long view', 'Starting a project? It drafts the first steps, sized, and adds nothing until you keep it.'],
  ['A time and a place', 'Drafts your week into the open hours, and learns the hours you actually keep.'],
  ['The measured day', 'Prepares the next block, an approach and a first draft, before you sit down.'],
  ['Tied together', 'Reads Friday back with evidence, and points out at most one thing worth noticing.'],
] as const
