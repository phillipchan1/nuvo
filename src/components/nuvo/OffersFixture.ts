// The busy rail (D-205) — fixtures for `?rail=offers` / `?rail=offers-phone`
// and `?weekcrown`'s chips: three projects on the week (two of them thin
// paths), six things today (three with no time), five captures (four the
// router has a guess for). Enough candidates to overflow every budget, so the
// harness shows what the rail looks like when Nuvo has MORE to say than it is
// allowed to: three chips on the desktop rail, two per phone screen, nothing
// past that. Seeded, never fetched — no account, no network.

import { QueryClient } from "@tanstack/react-query";
import { addDays, startOfDay, startOfWeek } from "date-fns";
import { parseDateISO, planningWeekStartISO, toDateISO, todayISO } from "../../lib/dates";
import { suggestionSig } from "../../lib/grooming";
import { thinWindow } from "../../hooks/useThinPaths";
import { scheduledTasksKey } from "../../hooks/useTasks";
import { slotsKey } from "../../hooks/useSlots";
import { externalEventsKey } from "../../hooks/useCalendar";
import type { Domain, Project, VTask, VerticalData } from "../../lib/vertical";
import type { Slot, Sprint, Task } from "../../lib/types";

const DAY = startOfDay(new Date());
export const OFFERS_TODAY = toDateISO(DAY);
const WEEK_ISO = planningWeekStartISO();
const at = (h: number, m = 0) => new Date(DAY.getTime() + (h * 60 + m) * 60_000).toISOString();
/** The harness's clock: mid-morning, so today still has room. */
export const OFFERS_NOW = new Date(DAY.getTime() + (10 * 60 + 15) * 60_000);

const dom = (id: string, name: string, color: string): Domain =>
  ({ id, name, color, icon: "diamond", intention: "", charter: "", context: null, weeklyTargetHours: 0, investedThisWeek: 0, meetingHoursThisWeek: 0, quarterHours: 0, lastTouchedDays: null, lastShip: null, weeks: new Array(13).fill(0), days: new Array(7).fill(0), sort: 0 }) as unknown as Domain;

const DOMAINS = [dom("d1", "Studio", "#7c6f9f"), dom("d2", "Home", "#5f8f7a")];

const proj = (id: string, name: string, domainId: string): Project =>
  ({
    id,
    name,
    domainId,
    initiativeId: null,
    keyResultId: null,
    outcome: "",
    description: "",
    status: "in_progress",
    startDate: WEEK_ISO,
    targetDate: toDateISO(addDays(parseDateISO(WEEK_ISO), 4)),
    shippedAt: null,
  }) as unknown as Project;

const PROJECTS = [
  proj("p1", "Launch pricing page", "d1"), // thin: 3h held, 20m of work
  proj("p2", "Garage studio", "d2"), // thin: 2h held, no steps
  proj("p3", "Quarterly taxes", "d2"), // shaped
];

let seq = 0;
const task = (title: string, o: Partial<Task> = {}): Task =>
  ({
    id: `o${++seq}`,
    user_id: "u",
    title,
    notes: "",
    status: "planned",
    duration_minutes: 30,
    start_time: null,
    do_date: OFFERS_TODAY,
    slot_id: null,
    project_id: null,
    initiative_id: null,
    domain_id: null,
    recurrence_id: null,
    recurrence_overridden: false,
    roll_count: 0,
    priority: "none",
    sort_order: seq,
    suggestion: null,
    ...o,
  }) as Task;

const guess = (t: Task, targetId: string, targetLabel: string, domainId: string, domainColor: string): Task => ({
  ...t,
  suggestion: {
    sig: suggestionSig(t.title, t.notes),
    level: "project",
    targetId,
    targetLabel,
    domainId,
    domainColor,
    durationMinutes: null,
    energy: null,
    rationale: "Like the last captures you filed there",
    confidence: 0.72,
  },
});

/** Six things today: three with no time (the hold candidates), two on the
 *  clock, one inside the pricing page's sitting. */
export function offersToday(): Task[] {
  seq = 0; // the same ids on every call: the cache and the list must agree
  return [
    task("Reply to the framer", { duration_minutes: 15 }),
    task("Write the pricing FAQ", { project_id: "p1", domain_id: "d1", duration_minutes: 20 }),
    task("Order shelving brackets", { duration_minutes: 30 }),
    task("Call the accountant", { start_time: at(11), duration_minutes: 60, project_id: "p3", domain_id: "d2" }),
    task("Pick up the prints", { start_time: at(16), duration_minutes: 30 }),
    task("Swim", { start_time: at(7), duration_minutes: 45, status: "done" }),
  ];
}

/** Five captures; the router has a guess for four. */
export function offersInbox(): Task[] {
  seq = 100;
  const inbox = (title: string) => task(title, { status: "inbox", do_date: null });
  return [
    guess(inbox("Measure the back wall for pegboard"), "p2", "Garage studio", "d2", "#5f8f7a"),
    guess(inbox("Find last year's 1099s"), "p3", "Quarterly taxes", "d2", "#5f8f7a"),
    inbox("Something about the dentist"),
    guess(inbox("Screenshot competitor tiers"), "p1", "Launch pricing page", "d1", "#7c6f9f"),
    guess(inbox("Ask Sam about a dust extractor"), "p2", "Garage studio", "d2", "#5f8f7a"),
  ];
}

/** The pricing page's sitting this afternoon — held time with almost nothing in it. */
export const OFFERS_SLOTS: Slot[] = [
  { id: "os1", user_id: "u", title: "Pricing page", project_id: "p1", domain_id: "d1", color: null, do_date: OFFERS_TODAY, start_time: at(13), duration_minutes: 180, google_event_id: null, recurrence_id: null, recurrence_date: null, recurrence_overridden: false } as unknown as Slot,
];
const LATER: Slot[] = [
  { id: "os2", user_id: "u", title: "Garage", project_id: "p2", domain_id: "d2", color: null, do_date: toDateISO(addDays(DAY, 1)), start_time: new Date(addDays(DAY, 1).getTime() + 10 * 3_600_000).toISOString(), duration_minutes: 120, google_event_id: null, recurrence_id: null, recurrence_date: null, recurrence_overridden: false } as unknown as Slot,
];

const vt = (id: string, title: string, projectId: string, durationMins: number, status = "ready"): VTask =>
  ({ id, title, projectId, durationMins, status, initiativeId: null, domainId: null, keyResultId: null, bigRockId: null, energy: null, deadlineDaysAway: null, doDate: null, startTime: null, slotId: null, createdAt: null }) as unknown as VTask;

export const OFFERS_VERTICAL: VerticalData = {
  domains: DOMAINS,
  initiatives: [],
  projects: PROJECTS,
  tasks: [
    vt("o2", "Write the pricing FAQ", "p1", 20),
    vt("v1", "File the estimate", "p3", 90),
    vt("v2", "Gather receipts", "p3", 60, "done"),
  ],
  sprint: { id: "sp", week_start: WEEK_ISO, reviewed_at: new Date().toISOString(), big_rocks: [] } as unknown as Sprint,
  focusInitiativeIds: [],
  bigRocks: [],
  lastActivityByProject: {},
} as unknown as VerticalData;

/** The query cache every offer reads — thin window, the crown's week, today's
 *  calendar week — seeded with the fixtures above. */
export function offersClient(today: Task[]): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false } },
  });
  const all = [...today, task("File the estimate", { id: "v1", project_id: "p3", status: "backlog", do_date: null, duration_minutes: 90 })];
  qc.setQueryData(["tasks", "all"], all);
  const tw = thinWindow(todayISO());
  qc.setQueryData(slotsKey(tw.start, tw.end), [...OFFERS_SLOTS, ...LATER]);
  const weeks = new Set([WEEK_ISO, toDateISO(startOfWeek(DAY, { weekStartsOn: 1 }))]);
  for (const w of weeks) {
    const monday = parseDateISO(w);
    const start = monday.toISOString();
    const end = addDays(monday, 7).toISOString();
    qc.setQueryData(scheduledTasksKey(start, end), today.filter((t) => t.start_time));
    qc.setQueryData(slotsKey(start, end), OFFERS_SLOTS);
    qc.setQueryData(externalEventsKey(start, end), []);
  }
  return qc;
}
