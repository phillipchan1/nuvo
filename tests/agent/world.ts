// The worlds a scenario runs in — a fixture account, shaped exactly like the
// snapshot `buildContext` reads out of the database.
//
// Why fixtures and not a live account: a battery that ran against real data
// would pass or fail for reasons nobody chose (Principle 16 — "only works in
// the builder's own account"). These worlds are deliberately awkward: a name
// that fuzzy-matches two projects, a calendar hidden months ago, a week that is
// already full, an account with nothing in it at all. Each one exists because
// it is where a plausible-looking answer goes wrong.
//
// Every world is frozen at a fixed instant, so "today", "tomorrow" and "this
// week" mean the same thing on every run — a battery whose expectations drift
// with the wall clock is a battery you learn to ignore.

import type { AgentContext } from "../../supabase/functions/agent/contextShape.ts";

/** Frozen "now" — Friday, July 31 2026, 8:13 AM Pacific (the moment in the
 *  screenshot that started this suite). The planning week is Mon Jul 27. */
export const NOW_ISO = "2026-07-31T15:13:00.000Z";
export const TODAY = "2026-07-31";
export const WEEK_START = "2026-07-27";
export const TZ = "America/Los_Angeles";

const ids = {
  domWork: "11111111-1111-4111-8111-111111111111",
  domChurch: "11111111-1111-4111-8111-111111111112",
  domHealth: "11111111-1111-4111-8111-111111111113",
  initStampede: "22222222-2222-4222-8222-222222222221",
  initDayspring: "22222222-2222-4222-8222-222222222222",
  projStampede: "33333333-3333-4333-8333-333333333331",
  projDayspring: "33333333-3333-4333-8333-333333333332",
  projDayspringDocs: "33333333-3333-4333-8333-333333333333",
  projSermon: "33333333-3333-4333-8333-333333333334",
  taskSubdomains: "44444444-4444-4444-8444-444444444441",
  taskDeploy: "44444444-4444-4444-8444-444444444442",
  taskRolled: "44444444-4444-4444-8444-444444444443",
  taskGym: "44444444-4444-4444-8444-444444444444",
  taskAmbiguous: "44444444-4444-4444-8444-444444444445",
  evtStandup: "55555555-5555-4555-8555-555555555551",
  evtLunch: "55555555-5555-4555-8555-555555555552",
  slotMorning: "66666666-6666-4666-8666-666666666661",
} as const;

export const ID = ids;

/** The account this app was built in, roughly: a full week, two live bets, an
 *  inbox with rollovers, three calendars on the board and one hidden. */
function loadedWorld(): AgentContext {
  return {
    today: TODAY,
    nowISO: NOW_ISO,
    nowLabel: "Fri, 8:13 AM",
    laUtcOffset: "-07:00",
    rangeStart: "2026-07-24T00:00:00.000Z",
    rangeEnd: "2026-08-07T00:00:00.000Z",
    settings: { dayStartHour: 8, dayEndHour: 16.5 },
    todaySchedule: [
      { kind: "task", id: ids.taskGym, title: "Gym", localDate: TODAY, timeRange: "8:00 AM – 9:15 AM", past: false, ongoing: true },
      { kind: "event", id: ids.evtStandup, title: "AI Powered SDLC", localDate: TODAY, timeRange: "9:00 AM – 12:00 PM", past: false },
      { kind: "event", id: ids.evtLunch, title: "Lunch", localDate: TODAY, timeRange: "12:00 PM – 1:00 PM", past: false },
    ],
    todayOpenWindows: [
      { startISO: "2026-07-31T20:00:00.000Z", endISO: "2026-07-31T21:30:00.000Z", timeRange: "1:00 PM – 2:30 PM", minutes: 90 },
      { startISO: "2026-07-31T22:00:00.000Z", endISO: "2026-07-31T23:30:00.000Z", timeRange: "3:00 PM – 4:30 PM", minutes: 90 },
    ],
    // Empty on the loaded world on purpose: the slot scenarios start from a day
    // with none, which is the state the 2026-07-31 screenshot was taken in.
    todaySlots: [],
    inbox: [
      { id: ids.taskRolled, title: "Follow up with the ATC reviewer", status: "inbox", doDate: null, startTime: null, durationMinutes: 30, rollCount: 4, priority: "none" },
      { id: ids.taskAmbiguous, title: "Review the deck", status: "inbox", doDate: null, startTime: null, durationMinutes: 30, rollCount: 0, priority: "none" },
    ],
    todayTasks: [],
    scheduled: [
      { id: ids.taskGym, title: "Gym", status: "planned", doDate: TODAY, startTime: "2026-07-31T15:00:00.000Z", durationMinutes: 75, rollCount: 0 },
    ],
    weekStart: WEEK_START,
    weekSlate: [
      {
        id: ids.projStampede,
        name: "Get Stampede Ready for ATC Review",
        outcome: "ATC signs off on the Stampede build",
        status: "in_progress",
        domainId: ids.domWork,
        startDate: WEEK_START,
        targetDate: "2026-07-31",
        priorityId: null,
        landed: false,
        shipped: false,
        openTasks: [
          { id: ids.taskSubdomains, title: "Fix Stampede subdomains", status: "backlog", durationMinutes: 60, rollCount: 2, scheduled: false },
        ],
        openTaskCount: 1,
        scheduledTaskCount: 0,
      },
      {
        id: ids.projDayspring,
        name: "Dayspring",
        outcome: "Dayspring is live for the pilot cohort",
        status: "in_progress",
        domainId: ids.domWork,
        startDate: WEEK_START,
        targetDate: "2026-08-07",
        priorityId: null,
        landed: false,
        shipped: false,
        openTasks: [
          { id: ids.taskDeploy, title: "Deploy Dayspring", status: "backlog", durationMinutes: 60, rollCount: 0, scheduled: false },
        ],
        openTaskCount: 1,
        scheduledTaskCount: 0,
      },
    ],
    needsASprint: [
      { id: ids.projSermon, name: "Fall sermon series", outcome: "Six weeks planned and assigned", domainId: ids.domChurch, openTaskCount: 5 },
    ],
    nextWeekSlate: [],
    sprintGoal: null,
    unattachedPriorities: [],
    weekPool: [
      { id: ids.taskSubdomains, title: "Fix Stampede subdomains", status: "backlog", rollCount: 2 },
    ],
    events: [
      { id: ids.evtStandup, title: "AI Powered SDLC", startAt: "2026-07-31T16:00:00.000Z", endAt: "2026-07-31T19:00:00.000Z", localDate: TODAY, timeRange: "9:00 AM – 12:00 PM", past: false },
      { id: ids.evtLunch, title: "Lunch", startAt: "2026-07-31T19:00:00.000Z", endAt: "2026-07-31T20:00:00.000Z", localDate: TODAY, timeRange: "12:00 PM – 1:00 PM", past: false },
    ],
    writableCalendars: [
      { accountId: "acct-personal", provider: "google", accountEmail: "phillipchan1@gmail.com", calendarId: "phillipchan1@gmail.com", name: "phillipchan1@gmail.com", isDefault: true },
      { accountId: "acct-frontier", provider: "google", accountEmail: "phil@frontierchurch.com", calendarId: "phil@frontierchurch.com", name: "phil@frontierchurch.com" },
      { accountId: "acct-icloud", provider: "icloud", accountEmail: "phillipchan1@gmail.com", calendarId: "cal-family", name: "Family" },
    ],
    labels: [{ id: "lab-1", name: "work" }],
    vertical: {
      domains: [
        { id: ids.domWork, name: "Work", intention: "Ship the things I said I'd ship" },
        { id: ids.domChurch, name: "Church", intention: "Serve Frontier well" },
        { id: ids.domHealth, name: "Health", intention: "Stay in the game" },
      ],
      initiatives: [
        { id: ids.initStampede, name: "Stampede", domainId: ids.domWork, outcome: "Stampede in production", status: "active" },
        { id: ids.initDayspring, name: "Dayspring", domainId: ids.domWork, outcome: "Dayspring launched", status: "active" },
      ],
      projects: [
        { id: ids.projStampede, name: "Get Stampede Ready for ATC Review", domainId: ids.domWork, initiativeId: ids.initStampede, outcome: "ATC sign-off", status: "in_progress" },
        { id: ids.projDayspring, name: "Dayspring", domainId: ids.domWork, initiativeId: ids.initDayspring, outcome: "Live for the pilot", status: "in_progress" },
        // Deliberate near-collision: "Dayspring docs" fuzzy-matches "Dayspring".
        { id: ids.projDayspringDocs, name: "Dayspring docs", domainId: ids.domWork, initiativeId: ids.initDayspring, outcome: "Docs a stranger can follow", status: "planned" },
        { id: ids.projSermon, name: "Fall sermon series", domainId: ids.domChurch, initiativeId: null, outcome: "Six weeks planned", status: "planned" },
      ],
    },
  };
}

/** Day one. Nothing to read, nothing to pull from, and every honest answer is
 *  about that — the world where a confident planner invents a week. */
function coldWorld(): AgentContext {
  const w = loadedWorld();
  return {
    ...w,
    todaySchedule: [],
    todayOpenWindows: [],
    todaySlots: [],
    inbox: [],
    todayTasks: [],
    scheduled: [],
    weekSlate: [],
    needsASprint: [],
    nextWeekSlate: [],
    unattachedPriorities: [],
    weekPool: [],
    events: [],
    writableCalendars: [],
    labels: [],
    vertical: { domains: [{ id: ids.domWork, name: "Work", intention: "" }], initiatives: [], projects: [] },
  };
}

/** Same account, standing in New York. Every time the user says is Eastern —
 *  the zone bug that landed "3pm" three hours off while traveling. */
function travelingWorld(): AgentContext {
  return {
    ...loadedWorld(),
    nowLabel: "Fri, 11:13 AM",
    laUtcOffset: "-04:00",
  };
}

/** A week already over capacity, so "add one more thing" has a real cost. */
function overloadedWorld(): AgentContext {
  const w = loadedWorld();
  return {
    ...w,
    todayOpenWindows: [],
    weekSlate: [
      ...w.weekSlate,
      {
        id: ids.projSermon,
        name: "Fall sermon series",
        outcome: "Six weeks planned and assigned",
        status: "in_progress",
        domainId: ids.domChurch,
        startDate: WEEK_START,
        targetDate: "2026-07-31",
        priorityId: null,
        landed: false,
        shipped: false,
        openTasks: Array.from({ length: 5 }, (_, i) => ({
          id: `77777777-7777-4777-8777-77777777777${i}`,
          title: `Sermon week ${i + 1}`,
          status: "backlog",
          durationMinutes: 90,
          rollCount: 3,
          scheduled: false,
        })),
        openTaskCount: 5,
        scheduledTaskCount: 0,
      },
    ],
    needsASprint: [],
  };
}

export type WorldName = "loaded" | "cold" | "traveling" | "overloaded";

const BUILDERS: Record<WorldName, () => AgentContext> = {
  loaded: loadedWorld,
  cold: coldWorld,
  traveling: travelingWorld,
  overloaded: overloadedWorld,
};

/** A fresh copy every time — a scenario that mutated a shared world would make
 *  the run order matter, which is the fastest way to an unreliable suite. */
export function world(name: WorldName): AgentContext {
  return structuredClone(BUILDERS[name]());
}

export function tzFor(name: WorldName): string {
  return name === "traveling" ? "America/New_York" : TZ;
}

/** The marquee targets the client actually sends (src/lib/marqueeRegistry.ts).
 *  Kept short — the battery cares that point_at is called with a sane target,
 *  not that the full registry round-trips. */
export const MARQUEE_TARGETS = [
  { key: "schedule", describe: "The Schedule — today's calendar and time blocks." },
  { key: "priorities", describe: "The week's priorities — the projects committed to this week." },
  { key: "inbox", describe: "The inbox — unprocessed captures." },
  { key: "project", describe: "One project's record. Pass its id as ref." },
  { key: "hours", describe: "Where the hours went this week." },
];
