// Standalone verify harness for the phone's detail sheets — the Event, the Task
// and the standing Block — in every state they have, at whatever width the
// viewport is. Reached at ?sheets, then ?sheets=<state> to open one. Mounted in
// main.tsx, DEV only. Not part of any real surface. Precedent: CaptureHarness
// (?capture), DomainHarness (?domains), CalendarHarness (?horizon).
//
// The live app can only show the states a real account happens to hold: no Meet
// link, no read-only feed, no pending invite, no repeating series, nothing that
// runs to three lines. Each of those is a fixture here, so the states that break
// are the ones that get looked at. Writes go nowhere — every mutation is a stub
// that logs its name into `[data-harness-log]`.
//
// The sheets portal to <body> at the VIEWPORT's width, so to see 320 / 375 / 430
// resize the preview rather than the frame.

import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import MobileEventSheet, { type CalendarTap } from "./MobileEventSheet";
import MobileTaskSheet from "./MobileTaskSheet";
import { VerticalStoreProvider, type VerticalStore } from "../../hooks/useVertical";
import { HARNESS_CALENDAR_ACCOUNTS, HARNESS_SETTINGS } from "../calendar/calendarFixtures";
import type { AttendeeStatus, ExternalEvent, GoogleRawEvent, Label, Slot, Task } from "../../lib/types";
import type { Domain, Project, VTask, VerticalData } from "../../lib/vertical";
import { toDateISO } from "../../lib/dates";
import { slotTasksKey, slotsKey } from "../../hooks/useSlots";
import { scheduledTasksKey } from "../../hooks/useTasks";

// ── fixtures ─────────────────────────────────────────────────────────────────
const dom = (id: string, name: string, color: string, icon: string, sort: number) =>
  ({
    id, name, color, icon, sort, intention: "", charter: "", context: null,
    weeklyTargetHours: 0, investedThisWeek: 0, meetingHoursThisWeek: 0, quarterHours: 0,
    lastTouchedDays: null, lastShip: null, weeks: new Array(13).fill(0), days: new Array(7).fill(0),
  }) as unknown as Domain;

const DOMAINS = [
  dom("d1", "Studio", "#4F5BD5", "building", 0),
  dom("d2", "Family", "#C2467A", "house", 1),
  dom("d3", "Health", "#1F8F7E", "activity", 2),
  dom("d4", "Side project", "#C98A2B", "pen-line", 3),
];

const proj = (id: string, domainId: string, name: string) =>
  ({ id, domainId, initiativeId: null, keyResultId: null, name, outcome: "", description: "", status: "in_progress", sort: 0 }) as unknown as Project;

const PROJECTS = [
  proj("p1", "d1", "Marketing site v2"),
  proj("p2", "d1", "Billing migration"),
  proj("p3", "d2", "Garage clean-out"),
  proj("p4", "d4", "Meetup talk"),
  proj("p5", "d1", "Pricing page experiment"),
  proj("p6", "d2", "Family photo book"),
  proj("p7", "d3", "Half-marathon block"),
  proj("p8", "d1", "Onboarding emails, the long rewrite for the spring cohort"),
];

const LABELS: Label[] = [
  { id: "l1", name: "calls", color: "#4F5BD5" },
  { id: "l2", name: "errand", color: "#C98A2B" },
  { id: "l3", name: "deep work", color: "#1F8F7E" },
] as unknown as Label[];

const at = (h: number, m = 0, plusDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + plusDays);
  d.setHours(h, m, 0, 0);
  return d;
};

const mkTask = (o: Partial<Task> & { id: string; title: string }): Task =>
  ({
    user_id: "h", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    notes: "", status: "backlog", do_date: null, start_time: null, duration_minutes: null, deadline: null,
    priority: "none", roll_count: 0, completed_at: null, trashed_at: null, project_id: null,
    initiative_id: null, domain_id: null, key_result_id: null, sprint_id: null, big_rock_id: null,
    energy: null, assignee: "me", prework: "", prework_at: null, suggestion: null, suggested_at: null,
    google_event_id: null, sort_order: 0, slot_id: null, parent_task_id: null, recurrence_id: null,
    recurrence_date: null, recurrence_overridden: false, task_labels: [],
    ...o,
  }) as Task;

const mkSlot = (o: Partial<Slot> & { id: string }): Slot => {
  const start = at(13);
  return {
    user_id: "h", created_at: start.toISOString(), updated_at: start.toISOString(), title: "",
    do_date: toDateISO(start), start_time: start.toISOString(), duration_minutes: 120,
    project_id: null, domain_id: null, color: null, google_event_id: null, recurrence_id: null,
    recurrence_date: null, recurrence_overridden: false, ...o,
  } as Slot;
};

const GOOGLE = "you@example.com";
const mkEvent = (o: Partial<ExternalEvent> & { id: string; title: string }, start: Date, end: Date): ExternalEvent =>
  ({
    account_id: "acct-google", provider_event_id: `pe-${o.id}`, calendar_id: GOOGLE,
    start_at: start.toISOString(), end_at: end.toISOString(), all_day: false, location: null, busy: true,
    recurring_event_id: null, self_rsvp: null, ...o,
  }) as ExternalEvent;

const tapOf = (e: ExternalEvent): CalendarTap => ({
  kind: "event", id: e.id, providerEventId: e.provider_event_id, title: e.title,
  start: new Date(e.start_at), end: new Date(e.end_at), allDay: e.all_day, location: e.location,
  self_rsvp: e.self_rsvp, accountId: e.account_id, calendarId: e.calendar_id,
});

const guests = (n: number): NonNullable<GoogleRawEvent["attendees"]> => {
  const names = ["Maya Okafor", "Dev Patel", "Sam Rivera", "Jo Lindqvist", "Priya Raman", "Tomás Beltrán", "Ines Duarte", "Kofi Mensah"];
  const st: AttendeeStatus[] = ["accepted", "accepted", "tentative", "declined", "needsAction", "accepted", "needsAction", "accepted"];
  return Array.from({ length: n }, (_, i) => ({
    email: `${names[i % names.length].split(" ")[0].toLowerCase()}@example.com`,
    displayName: names[i % names.length],
    responseStatus: st[i % st.length],
    optional: i === 4,
    organizer: i === 0,
  })) as NonNullable<GoogleRawEvent["attendees"]>;
};

type Scenario = {
  label: string;
  group: "Event" | "Task" | "Block";
  offline?: boolean;
  events?: ExternalEvent[];
  details?: Record<string, GoogleRawEvent>;
  tap?: CalendarTap;
  task?: Task;
  slot?: { tap: CalendarTap; children: Task[] };
  steps?: Task[];
};

// ── today's blocks, for "Put in a slot" (D-172) ──────────────────────────────
// What the task sheet reads for the day: slots (one already holding a task, one
// a project's sitting, one repeating) and timed tasks (one open, one done). The
// done one and any event must never be offered.
function todaysBlocks() {
  const morning = mkSlot({ id: "s-morning", start_time: at(8).toISOString(), duration_minutes: 60, domain_id: "d1" });
  const sitting = mkSlot({ id: "s-proj", project_id: "p1", domain_id: "d1" });
  const admin = mkSlot({ id: "s-admin", title: "Admin hour", start_time: at(17).toISOString(), duration_minutes: 60, recurrence_id: "r-admin", recurrence_date: toDateISO(at(17)) });
  const children = [
    mkTask({ id: "t-inslot", title: "Clear the studio inbox", status: "planned", do_date: toDateISO(at(8)), duration_minutes: 30, domain_id: "d1", slot_id: "s-morning" }),
    mkTask({ id: "c1", title: "Nav + footer pass", status: "planned", duration_minutes: 30, project_id: "p1", slot_id: "s-proj" }),
    mkTask({ id: "c2", title: "Case study photos", status: "planned", duration_minutes: 45, project_id: "p1", slot_id: "s-proj" }),
  ];
  const timed = [
    mkTask({ id: "t-call", title: "Call the bank about the wire", status: "planned", do_date: toDateISO(at(11)), start_time: at(11).toISOString(), duration_minutes: 30, domain_id: "d2" }),
    mkTask({ id: "t-standup", title: "Stand-up notes", status: "done", do_date: toDateISO(at(10, 30)), start_time: at(10, 30).toISOString(), duration_minutes: 15, domain_id: "d1", completed_at: new Date().toISOString() }),
  ];
  return { slots: [morning, sitting, admin], children, timed };
}

function scenarios(): Record<string, Scenario> {
  const basic = mkEvent({ id: "e-basic", title: "Design review" }, at(10), at(10, 45));
  const meet = mkEvent(
    { id: "e-meet", title: "Q4 planning with the whole leadership team", location: "Studio B · 4th floor, 410 Townsend St", self_rsvp: "needsAction" },
    at(14), at(15, 30),
  );
  const allDay = mkEvent({ id: "e-all", title: "Offsite" }, at(0), at(0, 0, 1));
  allDay.all_day = true;
  const ro = mkEvent(
    { id: "e-ro", title: "Thanksgiving", calendar_id: "en.usa#holiday@group.v.calendar.google.com", busy: false },
    at(0), at(0, 0, 1),
  );
  ro.all_day = true;
  const recurring = mkEvent({ id: "e-rec", title: "Weekly 1:1", recurring_event_id: "series-1", self_rsvp: "tentative" }, at(11), at(11, 30));
  const long = mkEvent(
    { id: "e-long", title: "Review of the cross-functional onboarding experience redesign proposal before the board meeting", location: "The big conference room next to the kitchen on the second floor of the east building" },
    at(16), at(17),
  );
  const offline = mkEvent({ id: "e-off", title: "Dentist" }, at(9), at(9, 45));

  const blockTask = mkTask({
    id: "t-block", title: "Draft the launch email", status: "backlog", do_date: toDateISO(at(9)), start_time: at(9, 30).toISOString(),
    duration_minutes: 45, project_id: "p1", domain_id: "d1", priority: "high",
    // A number, an email and a link — the note reads with them tappable (TaskNotes). The
    // other task fixtures keep plain notes, so both faces of the field are on this page.
    notes: "Lead with the pricing change.\n\nAsk Maya about the screenshot — maya@example.com, or call her on (626) 555-0142.\nDraft: https://docs.example.com/launch.",
    task_labels: [{ label_id: "l1" }],
  });
  const slotChildren = [
    mkTask({ id: "c1", title: "Nav + footer pass", duration_minutes: 30, project_id: "p1", slot_id: "s-proj" }),
    mkTask({ id: "c2", title: "Case study photos", duration_minutes: 45, project_id: "p1", slot_id: "s-proj" }),
    mkTask({ id: "c3", title: "Review copy with Sam", status: "done", duration_minutes: 20, project_id: "p1", slot_id: "s-proj", completed_at: new Date().toISOString() }),
  ];
  const slotP = mkSlot({ id: "s-proj", project_id: "p1", domain_id: "d1" });
  const slotE = mkSlot({ id: "s-empty", title: "Deep work", duration_minutes: 90 });

  const raw = (extra: Partial<GoogleRawEvent> = {}) => extra as GoogleRawEvent;

  return {
    "event-basic": { label: "writable, nothing else", group: "Event", events: [basic], tap: tapOf(basic) },
    "event-meet": {
      label: "Meet · pending invite · 8 guests · place · notes", group: "Event", events: [meet], tap: tapOf(meet),
      details: {
        "e-meet": raw({
          hangoutLink: "https://meet.google.com/abc-defg-hij",
          organizer: { email: "maya@example.com", displayName: "Maya Okafor" },
          attendees: guests(8),
          description: "Agenda:\n1. Roadmap check-in\n2. Hiring plan\n3. Budget — bring the revised numbers.",
        }),
      },
    },
    "event-allday": { label: "all-day", group: "Event", events: [allDay], tap: tapOf(allDay) },
    "event-readonly": {
      label: "read-only feed + notes", group: "Event", events: [ro], tap: tapOf(ro),
      details: { "e-ro": raw({ description: "Federal holiday. Most offices are closed." }) },
    },
    "event-offline": { label: "writable but offline", group: "Event", offline: true, events: [offline], tap: tapOf(offline) },
    "event-recurring": {
      label: "repeating series (scope question)", group: "Event", events: [recurring], tap: tapOf(recurring),
      details: {
        "e-rec": raw({
          recurringEventId: "series-1",
          recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
          organizer: { email: "you@example.com", displayName: "You", self: true },
          attendees: guests(2),
        }),
      },
    },
    "event-long": { label: "three-line title + long place", group: "Event", events: [long], tap: tapOf(long) },

    "task-loose": {
      label: "loose · no date", group: "Task",
      task: mkTask({ id: "t-loose", title: "Call the pediatrician about the form", status: "inbox" }),
    },
    "task-project": {
      label: "in a project · steps · notes · labels · deadline", group: "Task",
      task: mkTask({
        id: "t-proj", title: "Write the pricing page copy", status: "backlog", do_date: toDateISO(at(9, 0, 1)), duration_minutes: 60,
        project_id: "p5", domain_id: "d1", priority: "medium", deadline: toDateISO(at(9, 0, 5)),
        notes: "Three tiers. Keep it under 120 words each.\nCheck the competitor grid first.",
        task_labels: [{ label_id: "l3" }],
      }),
      steps: [
        mkTask({ id: "st1", title: "Outline the tiers", parent_task_id: "t-proj", status: "done" }),
        mkTask({ id: "st2", title: "Draft headline options", parent_task_id: "t-proj" }),
        mkTask({ id: "st3", title: "Get Sam's read", parent_task_id: "t-proj" }),
      ],
    },
    "task-done": {
      label: "done", group: "Task",
      task: mkTask({ id: "t-done", title: "Send the invoice", status: "done", do_date: toDateISO(at(9)), duration_minutes: 20, domain_id: "d1", completed_at: new Date().toISOString() }),
    },
    "task-block": { label: "on the calendar (timed block) · notes with a number, email, link", group: "Task", task: blockTask },
    "task-long": {
      label: "three-line title", group: "Task",
      task: mkTask({
        id: "t-long", title: "Follow up with the facilities team about the water damage in the east stairwell before the inspection next week",
        status: "backlog", do_date: toDateISO(at(9)), duration_minutes: 30, project_id: "p3", domain_id: "d2",
      }),
    },

    "task-in-slot": {
      label: "inside a slot · Put in a slot names it", group: "Task",
      task: todaysBlocks().children[0],
    },

    "block-project": {
      label: "project block · 3 tasks", group: "Block",
      slot: { tap: { kind: "slot", slot: slotP, title: "Marketing site v2", start: at(13), end: at(15), childCount: 3, doneCount: 1 }, children: slotChildren },
    },
    "block-empty": {
      label: "own title · empty", group: "Block",
      slot: { tap: { kind: "slot", slot: slotE, title: "Deep work", start: at(13), end: at(14, 30), childCount: 0, doneCount: 0 }, children: [] },
    },
  };
}

// Every mutation is a stub that logs; nothing here reaches a database.
function stubs(log: (name: string) => void) {
  return new Proxy(
    {},
    {
      get: (_t, name: string) =>
        (..._a: unknown[]) => {
          log(name);
          return Promise.resolve(undefined);
        },
    },
  ) as never;
}

/** Like `stubs`, but each write is logged with the ids (and times) it was given. */
function slotStubs(log: (line: string) => void) {
  const say = (a: unknown): string => {
    if (Array.isArray(a)) return `[${a.map(say).filter(Boolean).join(", ")}]`;
    if (a instanceof Date) return `at ${a.toTimeString().slice(0, 5)}`;
    if (a && typeof a === "object" && "id" in a) return String((a as { id: string }).id);
    return "";
  };
  return new Proxy(
    {},
    {
      get: (_t, name: string) =>
        (...args: unknown[]) => {
          log(`${name} ${args.map(say).filter(Boolean).join(" ")}`);
          return Promise.resolve(null);
        },
    },
  ) as never;
}

export default function SheetsHarness() {
  const key = new URLSearchParams(window.location.search).get("sheets") ?? "";
  const all = useMemo(scenarios, []);
  const sc = all[key];
  const [open, setOpen] = useState(true);
  const [last, setLast] = useState("—");

  const client = useMemo(() => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false } } });
    qc.setQueryData(["calendar_accounts"], HARNESS_CALENDAR_ACCOUNTS);
    qc.setQueryData(["settings"], HARNESS_SETTINGS);
    qc.setQueryData(["reminders"], []);
    qc.setQueryData(["recurrences"], []);
    qc.setQueryData(["event_domain_routing"], {});
    if (sc?.events) qc.setQueryData(["external_events", "h", "h"], sc.events);
    for (const e of sc?.events ?? []) qc.setQueryData(["event_details", e.id], sc.details?.[e.id] ?? {});
    if (sc?.task) qc.setQueryData(["tasks", "steps", sc.task.id], sc.steps ?? []);
    // Today's blocks under the keys the task sheet asks for (any other day is
    // left unseeded, so a task on tomorrow shows no "Put in a slot" row). The
    // timed-block task joins the day's scheduled tasks, as it would live.
    if (sc?.group === "Task") {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      const [from, to] = [day.toISOString(), next.toISOString()];
      const blocks = todaysBlocks();
      const timed = sc.task?.start_time ? [...blocks.timed, sc.task] : blocks.timed;
      qc.setQueryData(slotsKey(from, to), blocks.slots);
      qc.setQueryData(scheduledTasksKey(from, to), timed);
      qc.setQueryData(slotTasksKey(blocks.slots.map((x) => x.id)), blocks.children);
    }
    return qc;
  }, [sc]);

  // The offline scenario: `useOnline` listens for the window event.
  useEffect(() => {
    if (!sc?.offline) return;
    window.dispatchEvent(new Event("offline"));
    return () => void window.dispatchEvent(new Event("online"));
  }, [sc]);

  const mutations = useMemo(() => stubs((n) => setLast(n)), []);
  // Slot writes say WHICH blocks they were handed, so a pick can be read back.
  const slotMutations = useMemo(() => slotStubs((n) => setLast(n)), []);
  const store = useMemo(() => {
    const data: VerticalData = {
      domains: DOMAINS, initiatives: [], projects: PROJECTS, tasks: [] as VTask[],
      sprint: null, focusInitiativeIds: [], bigRocks: [], lastActivityByProject: {},
    };
    return { data, ready: true } as unknown as VerticalStore;
  }, []);

  const close = () => setOpen(false);
  const groups = ["Event", "Task", "Block"] as const;

  return (
    <QueryClientProvider client={client}>
      <VerticalStoreProvider value={store}>
        <div className="atmosphere min-h-screen p-4 pb-24">
          <div className="mb-2 flex items-center gap-3">
            <h1 className="masthead text-head">Phone sheets (fixtures)</h1>
            <button
              type="button"
              className="rounded-full border border-line px-3 py-1 text-label text-muted"
              onClick={() => {
                const el = document.documentElement;
                el.dataset.theme = el.dataset.theme === "dark" ? "light" : "dark";
              }}
            >
              theme
            </button>
          </div>
          <p className="mb-3 text-caption text-muted">
            Resize the preview to 320 · 375 · 430 to check the width; the sheets portal at the viewport&rsquo;s.
          </p>
          <div className="mb-4 text-label text-muted" data-harness-log>
            last write: {last}
          </div>
          {groups.map((g) => (
            <div key={g} className="mb-3">
              <div className="section-label mb-1">{g}</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(all)
                  .filter(([, s]) => s.group === g)
                  .map(([k, s]) => (
                    <a
                      key={k}
                      href={`?sheets=${k}`}
                      className={`rounded-full border px-3 py-1.5 text-label ${
                        k === key ? "border-accent bg-accent-soft text-accent" : "border-line text-muted"
                      }`}
                    >
                      {k.replace(/^[a-z]+-/, "")} <span className="opacity-60">· {s.label}</span>
                    </a>
                  ))}
              </div>
            </div>
          ))}
          {sc && !open && (
            <button type="button" className="mt-2 rounded-full border border-accent px-4 py-2 text-label text-accent" onClick={() => setOpen(true)}>
              reopen {key}
            </button>
          )}
        </div>

        {sc && open && sc.group === "Event" && sc.tap && (
          <MobileEventSheet tap={sc.tap} mutations={mutations} labels={LABELS} onClose={close} onAskNuvo={() => setLast("askNuvo")} />
        )}
        {sc && open && sc.group === "Block" && sc.slot && (
          <MobileEventSheet
            tap={sc.slot.tap}
            slotChildren={sc.slot.children}
            mutations={mutations}
            labels={LABELS}
            onClose={close}
            onAskNuvo={() => setLast("askNuvo")}
            onEditTask={(id) => setLast(`openTask ${id}`)}
          />
        )}
        {sc && open && sc.group === "Task" && sc.task && (
          <MobileTaskSheet
            task={sc.task}
            labels={LABELS}
            vertical={store.data}
            mutations={mutations}
            slotMutations={slotMutations}
            accent={DOMAINS.find((d) => d.id === sc.task!.domain_id)?.color ?? null}
            onClose={close}
            onAskNuvo={() => setLast("askNuvo")}
          />
        )}
        <Toaster position="top-center" />
      </VerticalStoreProvider>
    </QueryClientProvider>
  );
}
