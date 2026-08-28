// Standalone verify harness for the phone Calendar — Day, List, and Month
// over fixture data at phone width. Month is here so D-121 (tap selects,
// second tap / header opens Day, list stays on a day that isn't today) can
// be driven without an account. Reached at ?daycal, mounted in main.tsx.

import { useState } from "react";
import { addDays, addMonths, format, startOfDay, startOfMonth } from "date-fns";
import MobileDayView from "./MobileDayView";
import { MonthView, ScheduleView } from "./MobileCalendar";
import { clampDayToMonth } from "./monthTap";
import type { DayCtx } from "./dayPlan";
import type { CalendarTap } from "./MobileEventSheet";
import { deriveSlotTitle } from "../../lib/slots";
import type { VerticalData } from "../../lib/vertical";
import type { ExternalEvent, Slot, Task } from "../../lib/types";

const today = startOfDay(new Date());
// A fixed mid-morning "now" so gaps, the now line and Today/Tomorrow labels are
// deterministic whenever the harness is opened.
const NOW = new Date(today.getTime() + (10 * 60 + 15) * 60_000);

const iso = (dayOffset: number, h: number, m = 0) =>
  new Date(today.getTime() + dayOffset * 24 * 3600_000 + (h * 60 + m) * 60_000).toISOString();

let seq = 0;
const ev = (dayOffset: number, h: number, m: number, durMins: number, title: string, o: Partial<ExternalEvent> = {}): ExternalEvent =>
  ({
    id: `e${++seq}`,
    account_id: "a1",
    provider_event_id: `p${seq}`,
    calendar_id: "c1",
    title,
    start_at: iso(dayOffset, h, m),
    end_at: iso(dayOffset, h, m + durMins),
    all_day: false,
    location: null,
    busy: true,
    self_rsvp: null,
    ...o,
  }) as ExternalEvent;

const blk = (dayOffset: number, h: number, m: number, durMins: number, title: string, o: Partial<Task> = {}): Task =>
  ({
    id: `t${++seq}`,
    title,
    start_time: iso(dayOffset, h, m),
    duration_minutes: durMins,
    status: "ready",
    project_id: null,
    ...o,
  }) as Task;

const EVENTS: ExternalEvent[] = [
  // Today — the dense frame: short, overlapping, out-of-window, all-day.
  ev(0, 0, 0, 24 * 60, "Team offsite week", { all_day: true, end_at: iso(1, 0, 0) }),
  ev(0, 9, 0, 30, "Standup"),
  ev(0, 10, 0, 90, "Design review", { location: "Zoom" }),
  ev(0, 10, 30, 30, "1:1 with Dana"),
  ev(0, 11, 45, 15, "Quick sync"),
  ev(0, 19, 0, 60, "Dinner with the Parks", { location: "Causwells" }),
  // Tomorrow — one meeting, otherwise open.
  ev(1, 9, 0, 30, "Standup"),
  // Yesterday — a bygone read.
  ev(-1, 9, 0, 60, "Board prep"),
  ev(-1, 14, 0, 45, "Dentist", { location: "Sutter St" }),
];

const BLOCKS: Task[] = [
  blk(0, 13, 0, 90, "Write launch notes", { status: "done" }),
  blk(0, 15, 0, 90, "Clearstream domains — DNS cutover", { project_id: "p1" }),
  blk(1, 14, 0, 45, "Groom the retreat backlog"),
];

// A standing slot — a container tasks ride instead of carrying their own
// start_time (see assignToSlot, useTasks.ts). Fixture proves D-044's "one
// buildDayPlan" actually renders one on the phone, not just the desktop
// CalendarPane — the bug this harness addition guards against.
const slot = (dayOffset: number, h: number, m: number, durMins: number, title: string, o: Partial<Slot> = {}): Slot =>
  ({
    id: `s${++seq}`,
    user_id: "u1",
    created_at: iso(dayOffset, h, m),
    updated_at: iso(dayOffset, h, m),
    title,
    do_date: iso(dayOffset, 0, 0).slice(0, 10),
    start_time: iso(dayOffset, h, m),
    duration_minutes: durMins,
    project_id: null,
    domain_id: null,
    color: null,
    google_event_id: null,
    recurrence_id: null,
    recurrence_date: null,
    recurrence_overridden: false,
    ...o,
  }) as Slot;

// Two sittings, because they are not the same block: a plain one (teal, named
// by what's in it) and a PROJECT sitting — the block a project gets when it's
// dragged onto the Schedule, which wears its designation in words rather than a
// `▸` you'd have to be taught. Rendering them side by side is the point: the
// phone has to say the same thing the desk does.
const SLOTS: Slot[] = [
  slot(0, 9, 30, 60, ""),
  slot(0, 13, 0, 90, "", { project_id: "p1", domain_id: "d1" }),
];
const SLOT_CHILDREN: Record<string, Task[]> = {
  [SLOTS[0].id]: [
    blk(0, 0, 0, 20, "Call the roofer", { start_time: null, slot_id: SLOTS[0].id }),
    blk(0, 0, 0, 20, "Pay the HOA invoice", { start_time: null, slot_id: SLOTS[0].id, status: "done" }),
  ],
  [SLOTS[1].id]: [
    blk(0, 0, 0, 45, "Cut over the DNS", { start_time: null, slot_id: SLOTS[1].id, project_id: "p1" }),
    blk(0, 0, 0, 30, "Update the runbook", { start_time: null, slot_id: SLOTS[1].id, project_id: "p1" }),
    blk(0, 0, 0, 20, "Tell the team", { start_time: null, slot_id: SLOTS[1].id, project_id: "p1", status: "done" }),
  ],
};
const EMPTY_VERTICAL: VerticalData = {
  domains: [{ id: "d1", name: "Clearstream", color: "#7c6f9f" } as VerticalData["domains"][number]],
  initiatives: [],
  projects: [
    { id: "p1", name: "Clearstream domains", domainId: "d1" } as VerticalData["projects"][number],
  ],
  tasks: [],
  sprint: null,
  focusInitiativeIds: [],
  bigRocks: [],
  lastActivityByProject: {},
};
const SLOT_TITLES = new Map(
  SLOTS.map((s) => [s.id, deriveSlotTitle(s, SLOT_CHILDREN[s.id] ?? [], EMPTY_VERTICAL)]),
);

const CTX: DayCtx = {
  visibleEvents: EVENTS,
  blocks: BLOCKS,
  slots: SLOTS,
  slotChildren: SLOT_CHILDREN,
  slotTitles: SLOT_TITLES,
  hidden: new Set(),
  workStart: 8 * 60,
  workEnd: 16 * 60 + 30,
  now: NOW,
};

function Frame({ label, initial }: { label: string; initial: Date }) {
  const [sel, setSel] = useState(initial);
  const [tap, setTap] = useState<CalendarTap | null>(null);
  return (
    <div style={{ width: 375 }} className="shrink-0">
      <div className="section-label px-3 py-2">{label}</div>
      <div className="mono px-3 pb-1 text-micro text-muted" data-tapout={label}>
        {tap ? `tap → ${tap.title}` : "tap → —"}
      </div>
      <div className="atmosphere overflow-y-auto border border-line" style={{ height: 720 }} data-frame={label}>
        <MobileDayView
          selected={sel}
          ctx={CTX}
          weatherIndex={null}
          onSelect={setSel}
          onLens={() => {}}
          onBack={() => {}}
          onTapEvent={setTap}
        />
      </div>
    </div>
  );
}

function MonthFrame() {
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [opened, setOpened] = useState<string | null>(null);
  const [tap, setTap] = useState<CalendarTap | null>(null);

  return (
    <div style={{ width: 375 }} className="shrink-0">
      <div className="section-label px-3 py-2">month</div>
      <div className="mono px-3 pb-1 text-micro text-muted" data-tapout="month">
        {opened ? `open → ${opened}` : `sel → ${format(selected, "MMM d")}`}
        {tap ? ` · row → ${tap.title}` : ""}
      </div>
      {/* h-full column, same as the live shell: grid sizes to the days, list
          fills leftover and scrolls. overflow hidden so the page doesn't steal
          the list's scroll. */}
      <div className="atmosphere flex flex-col overflow-hidden border border-line" style={{ height: 720 }} data-frame="month">
        <div className="fab-clear flex h-full min-h-0 flex-col">
          <MonthView
            monthCursor={month}
            ctx={CTX}
            now={NOW}
            selected={selected}
            weekStartsOn={1}
            weatherIndex={null}
            onPrev={() => {
              const next = startOfMonth(addMonths(month, -1));
              setMonth(next);
              setSelected((s) => clampDayToMonth(s, next));
            }}
            onNext={() => {
              const next = startOfMonth(addMonths(month, 1));
              setMonth(next);
              setSelected((s) => clampDayToMonth(s, next));
            }}
            onToday={() => {
              setMonth(startOfMonth(today));
              setSelected(today);
            }}
            onSelect={(d) => {
              setOpened(null);
              setSelected(startOfDay(d));
              setMonth(startOfMonth(d));
            }}
            onOpen={(d) => {
              setSelected(startOfDay(d));
              setOpened(format(d, "MMM d"));
            }}
            onOpenSchedule={() => setOpened("schedule")}
            onOpenYear={() => setOpened("year")}
            onTapEvent={(t) => {
              setTap(t);
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default function MobileDayHarness() {
  return (
    <div className="atmosphere min-h-screen p-4">
      <div className="mb-3 flex items-center gap-3">
        <h1 className="masthead text-head">The Day lens (fixtures)</h1>
        <button
          className="rounded-full border border-line px-3 py-1 text-label text-muted"
          onClick={() => {
            const el = document.documentElement;
            el.dataset.theme = el.dataset.theme === "dark" ? "light" : "dark";
          }}
        >
          theme
        </button>
      </div>
      <div className="flex gap-4 overflow-x-auto">
        <MonthFrame />
        <Frame label="today" initial={today} />
        <Frame label="tomorrow" initial={addDays(today, 1)} />
        <Frame label="bygone" initial={addDays(today, -1)} />
        <Frame label="empty" initial={addDays(today, 3)} />
        {/* The List lens beside it — same chrome, other face of the pill. */}
        <div style={{ width: 375 }} className="shrink-0">
          <div className="section-label px-3 py-2">list</div>
          <div className="mono px-3 pb-1 text-micro text-muted">&nbsp;</div>
          <div className="atmosphere overflow-y-auto border border-line" style={{ height: 720 }} data-frame="list">
            <ScheduleView
              anchor={today}
              ctx={CTX}
              weatherIndex={null}
              loading={false}
              pastDays={0}
              onLoadEarlier={() => {}}
              onTapEvent={() => {}}
              onBack={() => {}}
              onDayLens={() => {}}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
