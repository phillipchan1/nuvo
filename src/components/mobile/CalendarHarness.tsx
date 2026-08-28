// Standalone verify harness for the mobile Calendar — all five horizons side by
// side at 375px over ONE set of fixtures, so the thing this surface is actually
// judged on can be judged: that the chrome does not move when the horizon does.
// Reached at ?horizon (and ?daycal, which used to open the Day lens alone).
// Mounted in main.tsx; not part of any real surface. Precedent: DomainHarness
// (?domains), BuildFacesHarness (?build), WeekCrownHarness (?weekcrown).
//
// Each frame is a real `CalendarSurface` with its rung pinned, so each is also
// LIVE: tap the ladder (☰ D W M Y) inside any frame and you can watch the zoom,
// and see that the hero, the ladder, travel and the seven columns stay exactly
// where they were while only the body scales through the column of the selected
// day. Pinning `initialMode` also keeps the harness from writing the real app's
// remembered rung.
//
// The week's crown is deliberately absent here: it needs a live vertical store,
// and it has its own frame — in situ, above both a week-scoped lens and the
// month — in `WeekCrownHarness` (?weekcrown).

import { useState } from "react";
import { startOfDay } from "date-fns";
import CalendarSurface from "./CalendarSurface";
import type { CalHero, CalHorizon } from "./CalendarChrome";
import type { DayCtx } from "./dayPlan";
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
const ev = (
  dayOffset: number,
  h: number,
  m: number,
  durMins: number,
  title: string,
  o: Partial<ExternalEvent> = {},
): ExternalEvent =>
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

const blk = (
  dayOffset: number,
  h: number,
  m: number,
  durMins: number,
  title: string,
  o: Partial<Task> = {},
): Task =>
  ({
    id: `t${++seq}`,
    title,
    start_time: iso(dayOffset, h, m),
    duration_minutes: durMins,
    status: "ready",
    project_id: null,
    ...o,
  }) as Task;

// The dense frame is today; the days around it carry enough to shade a month
// grid and a year wall, because a month of empty cells verifies nothing about
// the one thing the month lens exists to show.
const EVENTS: ExternalEvent[] = [
  ev(0, 0, 0, 24 * 60, "Team offsite week", { all_day: true, end_at: iso(1, 0, 0) }),
  ev(0, 9, 0, 30, "Standup"),
  ev(0, 10, 0, 90, "Design review", { location: "Zoom" }),
  ev(0, 10, 30, 30, "1:1 with Dana"),
  ev(0, 11, 45, 15, "Quick sync"),
  ev(0, 19, 0, 60, "Dinner with the Parks", { location: "Causwells" }),
  ev(1, 9, 0, 30, "Standup"),
  ev(-1, 9, 0, 60, "Board prep"),
  ev(-1, 14, 0, 45, "Dentist", { location: "Sutter St" }),
  // A spread either side, thinning out as it goes — so density reads as
  // density rather than as one loud day.
  ...[-40, -33, -26, -19, -12, -5, 2, 4, 6, 9, 11, 13, 16, 20, 27, 34, 41].flatMap((d, i) => [
    ev(d, 9, 0, 30, "Standup"),
    ...(i % 2 === 0 ? [ev(d, 13, 0, 60, "Partner sync")] : []),
    ...(i % 3 === 0 ? [ev(d, 16, 0, 45, "Interview")] : []),
  ]),
];

const BLOCKS: Task[] = [
  blk(0, 13, 0, 90, "Write launch notes", { status: "done" }),
  blk(0, 15, 0, 90, "Clearstream domains — DNS cutover", { project_id: "p1" }),
  blk(1, 14, 0, 45, "Groom the retreat backlog"),
  ...[-30, -16, -7, 3, 5, 8, 15, 22, 30].map((d) => blk(d, 11, 0, 60, "Deep work", { project_id: "p1" })),
];

// A standing slot — a container tasks ride instead of carrying their own
// start_time (see assignToSlot, useTasks.ts). Fixture proves D-044's "one
// buildDayPlan" actually renders one on the phone, not just the desktop
// CalendarPane.
const slot = (
  dayOffset: number,
  h: number,
  m: number,
  durMins: number,
  title: string,
  o: Partial<Slot> = {},
): Slot =>
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

// Two sittings, because they are not the same block: a plain one (teal, named by
// what's in it) and a PROJECT sitting — the block a project gets when it's
// dragged onto the Schedule, which wears its designation in words rather than a
// `▸` you'd have to be taught.
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
    blk(0, 0, 0, 20, "Tell the team", {
      start_time: null,
      slot_id: SLOTS[1].id,
      project_id: "p1",
      status: "done",
    }),
  ],
};

// Planned for a day, no clock — the chips that share the all-day row.
const ANYTIME: Task[] = [
  blk(0, 0, 0, 30, "Read the Q3 brief", { start_time: null, do_date: iso(0, 0, 0).slice(0, 10) }),
  blk(2, 0, 0, 30, "Renew the passport", { start_time: null, do_date: iso(2, 0, 0).slice(0, 10) }),
];

const VERTICAL: VerticalData = {
  domains: [{ id: "d1", name: "Clearstream", color: "#7c6f9f" } as VerticalData["domains"][number]],
  initiatives: [],
  projects: [{ id: "p1", name: "Clearstream domains", domainId: "d1" } as VerticalData["projects"][number]],
  tasks: [],
  sprint: null,
  focusInitiativeIds: [],
  bigRocks: [],
  lastActivityByProject: {},
};
const SLOT_TITLES = new Map(
  SLOTS.map((s) => [s.id, deriveSlotTitle(s, SLOT_CHILDREN[s.id] ?? [], VERTICAL)]),
);

const CTX: DayCtx = {
  visibleEvents: EVENTS,
  blocks: BLOCKS,
  anytime: ANYTIME,
  slots: SLOTS,
  slotChildren: SLOT_CHILDREN,
  slotTitles: SLOT_TITLES,
  hidden: new Set(),
  workStart: 8 * 60,
  workEnd: 16 * 60 + 30,
  now: NOW,
};

function Frame({ label, mode }: { label: string; mode: CalHorizon }) {
  // The hero lives in the app's top bar now (D-125), so the harness has to
  // mount a stand-in for it — otherwise this would be verifying a chrome the
  // phone doesn't actually wear, and the one composition question here ("does
  // anything move when the horizon does?") includes the title.
  const [hero, setHero] = useState<CalHero | null>(null);
  return (
    <div style={{ width: 375 }} className="shrink-0">
      <div className="section-label px-3 py-2">{label}</div>
      {/* Its own scroll parent, because that is what `scrollParent()` finds in
          the real shell — the bodies' "park the now line" and the chrome's
          sticky stack both depend on it. */}
      <div
        className="atmosphere overflow-y-auto border border-line"
        style={{ height: 720 }}
        data-frame={label}
      >
        {/* The shell's top bar, in miniature — wordmark, the span, the icons. */}
        <div className="flex items-center gap-2 border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur">
          {/* No wordmark: on the Calendar tab the bar's title IS the span. */}
          {hero && (
            <div className="flex min-w-0 items-baseline gap-1.5 px-1">
              <span className="masthead shrink-0 text-head text-ink">{hero.hero}</span>
              {hero.fact && (
                <span
                  className="mono min-w-0 truncate text-label"
                  style={{ color: hero.factAccent ? "var(--accent)" : "var(--muted)" }}
                >
                  {hero.fact}
                </span>
              )}
            </div>
          )}
          <div className="flex-1" />
          {/* Three of them, because the real bar has three (search · theme ·
              settings) and a mock with one would prove the span fits when it
              doesn't. */}
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-9 w-9 shrink-0 rounded-full border border-line" />
          ))}
        </div>
        <CalendarSurface
          now={NOW}
          ctx={CTX}
          loading={false}
          weekStartsOn={0}
          weatherIndex={null}
          initialMode={mode}
          onHero={setHero}
        />
      </div>
    </div>
  );
}

export default function CalendarHarness() {
  return (
    <div className="atmosphere min-h-screen p-4">
      <div className="mb-1 flex items-center gap-3">
        <h1 className="masthead text-head">The Calendar's five horizons (fixtures)</h1>
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
      <p className="mb-3 max-w-[70ch] text-caption text-muted">
        Every frame is live — tap the ladder inside one and watch what moves. The hero, the ladder,
        travel and the seven columns should hold still; only the body should scale, through the
        column of the day you're standing on. Swipe (or drag) a body sideways to travel at that
        horizon.
      </p>
      <div className="flex gap-4 overflow-x-auto">
        <Frame label="month" mode="month" />
        <Frame label="week" mode="week" />
        <Frame label="day" mode="day" />
        <Frame label="agenda" mode="schedule" />
        <Frame label="year" mode="year" />
      </div>
    </div>
  );
}
