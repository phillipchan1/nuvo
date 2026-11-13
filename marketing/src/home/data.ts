/**
 * Scene data for the home page. Markup and motion read the same numbers, so a
 * block drawn at Tue 9am is animated *to* Tue 9am — never two copies of a
 * coordinate that can drift.
 *
 * Every name here is example data in the domain *kinds* of personas.md §1
 * (work · craft · health · family · money), not any one operator's life — P16.
 */
import { CRAFT, FAMILY, HEALTH, MONEY, WORK } from '../components/hues'

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const
export const DATES = [16, 17, 18, 19, 20] as const

/** Hours shown on the week grids. */
export const H0 = 8
export const H1 = 18

export type Block = {
  day: number
  start: number
  end: number
  title: string
  /** meetings wear the calendar's quiet outline; tasks wear their domain */
  hue?: string
  sub?: string
}

/** Grid placement as percentages of the grid body. */
export function place(b: { day: number; start: number; end: number }) {
  const span = H1 - H0
  return {
    left: `calc(${(b.day / 5) * 100}% + 3px)`,
    width: `calc(${100 / 5}% - 6px)`,
    top: `${((b.start - H0) / span) * 100}%`,
    height: `calc(${((b.end - b.start) / span) * 100}% - 3px)`,
  }
}

/* ── Hero: a lived-in week on the Schedule ─────────────────────────────── */

export const HERO_MEETINGS: Block[] = [
  { day: 0, start: 8.5, end: 9, title: 'Standup' },
  { day: 0, start: 12, end: 13, title: 'Lunch · Sam' },
  { day: 1, start: 14, end: 15, title: '1:1 · Priya' },
  { day: 2, start: 9, end: 10.5, title: 'Board prep' },
  { day: 3, start: 13, end: 14, title: 'Design review' },
  { day: 4, start: 12, end: 13, title: 'Team lunch' },
]

export const HERO_TASKS: Block[] = [
  { day: 0, start: 9, end: 11, title: 'Pricing page', sub: 'Tiers copy', hue: WORK },
  { day: 0, start: 15, end: 16.5, title: 'Investor update', sub: 'Draft', hue: CRAFT },
  { day: 1, start: 8, end: 9, title: 'Run · 5k', hue: HEALTH },
  { day: 1, start: 10, end: 12, title: 'Onboarding', sub: 'Rewrite step 2', hue: WORK },
  { day: 2, start: 11, end: 12.5, title: 'Chapter 4', sub: 'First draft', hue: CRAFT },
  { day: 2, start: 16, end: 17, title: 'Pickup + dinner', hue: FAMILY },
  { day: 3, start: 9, end: 11.5, title: 'Launch film', sub: 'Edit pass', hue: WORK },
  { day: 3, start: 15, end: 16, title: 'Budget review', hue: MONEY },
  { day: 4, start: 8, end: 9, title: 'Run · intervals', hue: HEALTH },
  { day: 4, start: 10, end: 11, title: 'Weekly review', hue: 'var(--accent)' },
  { day: 4, start: 13, end: 15, title: 'Ship pricing', sub: 'Go live', hue: WORK },
]

export const HERO_CARRIES = [
  { name: 'Pricing page', hue: WORK, done: 5, of: 7 },
  { name: 'Chapter 4', hue: CRAFT, done: 2, of: 5 },
  { name: 'Onboarding rewrite', hue: WORK, done: 3, of: 6 },
  { name: 'Half marathon', hue: HEALTH, done: 4, of: 4 },
]

/* ── The cascade: one initiative, all the way down to the hour ───────────
   Coordinates are % of a fixed-aspect canvas. Tasks carry two positions:
   `list` (hanging under their project) and `cal` (landed on the week). */

export const CASCADE_INITIATIVE = {
  name: 'Launch v2',
  meta: 'Initiative · Q4 · due Dec 12',
  hue: WORK,
}

export const CASCADE_PROJECTS = [
  { name: 'Pricing page', meta: '4h left · on pace', x: 1, hue: WORK },
  { name: 'Onboarding rewrite', meta: '6h left · 1 wk behind', x: 34.5, hue: WORK, behind: true },
  { name: 'Launch film', meta: '9h left · on pace', x: 68, hue: WORK },
]

/** the mini week the tasks land in */
export const CASCADE_GRID = { top: 53, bottom: 100, left: 7, h0: 9, h1: 13 }

function calPos(day: number, start: number, end: number) {
  const g = CASCADE_GRID
  const colW = (100 - g.left) / 5
  const hourH = (g.bottom - g.top - 5) / (g.h1 - g.h0)
  return {
    left: g.left + colW * day + 0.6,
    top: g.top + 5 + (start - g.h0) * hourH,
    width: colW - 1.2,
    height: (end - start) * hourH - 0.5,
  }
}

export const CASCADE_TASKS = [
  {
    name: 'Tier copy',
    size: '45m',
    when: 'Tue 9–9:45am',
    list: { left: 1, top: 33, width: 31, height: 7 },
    cal: calPos(1, 9, 9.75),
  },
  {
    name: 'Benchmark',
    size: '1h',
    when: 'Mon 10–11am',
    list: { left: 1, top: 41.5, width: 31, height: 7 },
    cal: calPos(0, 10, 11),
  },
  {
    name: 'Step 2',
    size: '1h30',
    when: 'Wed 9:30–11am',
    list: { left: 34.5, top: 33, width: 31, height: 7 },
    cal: calPos(2, 9.5, 11),
  },
  {
    name: 'Voiceover',
    size: '1h30',
    when: 'Thu 11am–12:30',
    list: { left: 68, top: 33, width: 31, height: 7 },
    cal: calPos(3, 11, 12.5),
  },
]

export const CASCADE_MEETINGS = [
  { ...calPos(0, 9, 10), name: 'Standup' },
  { ...calPos(1, 11, 12.5), name: 'Hiring panel' },
  { ...calPos(2, 11.5, 13), name: 'Board prep' },
  { ...calPos(4, 9, 11), name: 'Offsite' },
]

export const CASCADE_STEPS = [
  {
    n: '01',
    label: 'Initiative',
    title: 'Start with the outcome.',
    body: 'The big thing this quarter is for. Named, dated, owned by you.',
  },
  {
    n: '02',
    label: 'Projects',
    title: 'Break it into things that finish.',
    body: 'Every project carries a pace, so you see it slipping weeks before the deadline does.',
  },
  {
    n: '03',
    label: 'Tasks',
    title: 'Down to the next real action.',
    body: 'Typed like a text message. Sized in minutes. Never orphaned from why it matters.',
  },
  {
    n: '04',
    label: 'The hour',
    title: 'Then give it a time.',
    body: 'A scheduled task is the block on your calendar. One thing, not two to keep in sync.',
  },
]

/* ── Plan the week ───────────────────────────────────────────────────────── */

export const WEEK_MEETINGS: Block[] = [
  { day: 0, start: 9, end: 10, title: 'Standup' },
  { day: 0, start: 14, end: 15, title: 'Client call' },
  { day: 1, start: 11, end: 12, title: 'Hiring panel' },
  { day: 2, start: 9, end: 11, title: 'Board prep' },
  { day: 2, start: 15, end: 16, title: '1:1 · Priya' },
  { day: 3, start: 13, end: 14.5, title: 'Design review' },
  { day: 4, start: 9, end: 10, title: 'Standup' },
  { day: 4, start: 12, end: 13, title: 'Team lunch' },
]

export type DraftBlock = Block & {
  project: string
  size: string
  /** where the draft first put it, if the walk moves it */
  from?: { day: number; start: number; end: number }
  /** the other places it fits, numbered like the keys that pick them */
  alts?: { day: number; start: number; end: number }[]
}

export const WEEK_DRAFT: DraftBlock[] = [
  { day: 0, start: 10, end: 11.5, title: 'Tier copy', project: 'Pricing page', size: '1h30', hue: WORK },
  { day: 1, start: 9, end: 10, title: 'FAQ', project: 'Pricing page', size: '1h', hue: WORK },
  { day: 1, start: 13, end: 15, title: 'Draft', project: 'Chapter 4', size: '2h', hue: CRAFT },
  {
    day: 3,
    start: 9,
    end: 10.5,
    title: 'Step 2',
    project: 'Onboarding',
    size: '1h30',
    hue: WORK,
    from: { day: 2, start: 12.5, end: 14 },
    alts: [
      { day: 2, start: 12.5, end: 14 },
      { day: 3, start: 9, end: 10.5 },
      { day: 0, start: 15.5, end: 17 },
    ],
  },
  { day: 3, start: 8, end: 9, title: 'Long run', project: 'Half marathon', size: '1h', hue: HEALTH },
  { day: 4, start: 15, end: 16, title: 'Book the trip', project: 'Home', size: '1h', hue: FAMILY },
]

export const WEEK_STEPS = [
  {
    n: '1',
    label: 'Pull',
    body: 'Choose what this week carries. The work comes from your projects, already sized.',
  },
  {
    n: '2',
    label: 'Place',
    body: 'Nuvo drafts it into the hours that are actually open, around every meeting you can’t move.',
  },
  {
    n: '3',
    label: 'Walk',
    body: 'One block at a time. ↵ keeps it. Drag it, or press a number for another spot that fits.',
  },
  {
    n: '4',
    label: 'Commit',
    body: 'If the week doesn’t fit, it tells you now. Not on Wednesday afternoon.',
  },
]

/* ── The day ─────────────────────────────────────────────────────────────── */

export type Moment = {
  time: string
  /** decimal hour, for the clock */
  h: number
  label: string
  title: string
  body: string
  kind: 'brief' | 'block' | 'ask' | 'close'
}

export const DAY_MOMENTS: Moment[] = [
  {
    time: '7:30am',
    h: 7.5,
    label: 'Morning brief',
    title: 'Three blocks. Two meetings. Four open hours.',
    body: 'Today, laid out before you open your inbox — and the tier copy is already prepared ✦, with an approach and a first draft waiting.',
    kind: 'brief',
  },
  {
    time: '9:00am',
    h: 9,
    label: 'Up now',
    title: 'Pricing page · Draft tier copy',
    body: 'The next block knows which project it moves and how far behind that project is. You just start.',
    kind: 'block',
  },
  {
    time: '1:10pm',
    h: 13.17,
    label: 'Ask Nuvo',
    title: 'The board call ran long.',
    body: '',
    kind: 'ask',
  },
  {
    time: '6:00pm',
    h: 18,
    label: 'Evening close',
    title: 'Two of three landed.',
    body: 'What didn’t happen rolls forward with its project attached. Tomorrow starts warm, not from scratch.',
    kind: 'close',
  },
]

/* ── Friday ──────────────────────────────────────────────────────────────── */

export const FRIDAY_HOURS = [
  { name: 'Work', hue: WORK, h: 21.5, max: 24 },
  { name: 'Writing', hue: CRAFT, h: 6, max: 24 },
  { name: 'Training', hue: HEALTH, h: 4.5, max: 24 },
  { name: 'Family', hue: FAMILY, h: 11, max: 24 },
]

export const FRIDAY_MOVED = [
  'Pricing page shipped',
  'Chapter 4 — 4,200 words',
  'Onboarding back on pace',
]

/* ── Words ───────────────────────────────────────────────────────────────── */

export const AMBITIONS = [
  'Ship the launch',
  'Write the book',
  'Raise the round',
  'Run the marathon',
  'Open the second location',
  'Finish the degree',
  'Build the house',
  'Start the podcast',
  'Hit the number',
]

/* ── Memory — what Nuvo learns about you (docs/memory.md) ─────────────────
   Every line here is the spec's own grammar: a statement, its evidence (a
   count, a window, one pip per period oldest first), a confidence word — never
   a percentage (N-04) — where it came from, and exactly what Keep would change.
   Example data in the persona kinds, not one operator's life (P16). */

export type Noticed = {
  area: 'Time' | 'Work' | 'Projects'
  statement: string
  evidence: string
  /** one per period, oldest first: true = the pattern held */
  pips: boolean[]
  confidence: 'Sure' | 'Fairly sure'
  source: string
  keep: string
  hue: string
}

export const MEMORY_NOTICED: Noticed[] = [
  {
    area: 'Time',
    statement: 'Training is Monday, Wednesday and Friday, 6–7am.',
    evidence: '21 of 24 sessions',
    pips: [true, true, true, true, true, true, true, true],
    confidence: 'Sure',
    source: 'From your calendar',
    keep: 'A standing slot, Mon · Wed · Fri 6–7am. Plan the week works around it.',
    hue: HEALTH,
  },
  {
    area: 'Time',
    statement: 'Your workday runs 7:30am–5pm, Monday to Thursday.',
    evidence: 'Your first and last meetings, 6 of 8 weeks',
    pips: [true, true, false, true, true, true, false, true],
    confidence: 'Fairly sure',
    source: 'From your calendar',
    keep: 'Your working hours, per weekday. Capacity counts from them.',
    hue: WORK,
  },
  {
    area: 'Time',
    statement: 'Tuesday and Thursday, 1–4pm, stay open.',
    evidence: '7 of 8 weeks',
    pips: [true, true, true, false, true, true, true, true],
    confidence: 'Sure',
    source: 'From your calendar',
    keep: 'A Deep work slot. Project sittings land there first.',
    hue: CRAFT,
  },
]

export const MEMORY_TABS = ['Noticed', 'What Nuvo uses', 'Still watching', 'You said no'] as const

export const MEMORY_RULES = [
  ['It asks before it acts.', 'Nothing it notices changes your plan until you keep it.'],
  ['It shows its evidence.', 'Sure, fairly sure, not sure yet — with the count behind each.'],
  ['It stays yours.', 'Only you can see it. Forget one, or everything, any time.'],
] as const
