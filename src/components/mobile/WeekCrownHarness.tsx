// Standalone verify harness for the week's crown — the phone's
// `MobileWeekCrown` (at 375px) and the desktop's `WeekPanel` beside it, over
// ONE set of fixtures. Reached at ?weekcrown, mounted in main.tsx. Not part of
// any real surface. Precedent: DomainHarness (?domains), BuildFacesHarness
// (?build), CalendarHarness (?horizon).
//
// The two crowns share `useWeekCrown`, so this frame is where a divergence
// would show up as a difference you can *see*: the same project must report the
// same verdict, the same progress and the same placed/loose split on both.
//
// The fixtures cover every state a row can be in — in motion with homeless
// work, carried from an earlier week, fully placed, every task done (ready to
// ship), a landed week-verdict over a project that continues, one shipped
// inside the week, and one whose week lapsed and is now carrying (D-108).

import { useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { addDays } from "date-fns";
import { VerticalStoreProvider, type VerticalStore } from "../../hooks/useVertical";
import { AppNavigationProvider } from "../../hooks/useAppNavigation";
import { parseDateISO, planningWeekStartISO, toDateISO } from "../../lib/dates";
import type { Domain, Project, VTask, VerticalData } from "../../lib/vertical";
import type { BigRock, Slot, Sprint, Task } from "../../lib/types";
import MobileWeekCrown from "./MobileWeekCrown";
import MobileCalendar from "./MobileCalendar";
import WeekPanel from "../WeekPanel";
import TaskRow from "../TaskRow";

const WEEK_ISO = planningWeekStartISO();
const MONDAY = parseDateISO(WEEK_ISO);
const day = (n: number) => toDateISO(addDays(MONDAY, n));
/** A block at a real clock time on the nth day of this week. */
const at = (n: number, hour: number, min = 0) => {
  const d = addDays(MONDAY, n);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
};

const dom = (o: Partial<Domain> & { id: string; name: string; color: string }): Domain => ({
  icon: "◆",
  intention: "",
  charter: "",
  context: null,
  weeklyTargetHours: 0,
  investedThisWeek: 0,
  meetingHoursThisWeek: 0,
  quarterHours: 0,
  lastTouchedDays: null,
  lastShip: null,
  weeks: new Array(13).fill(0),
  days: new Array(7).fill(0),
  sort: 0,
  ...o,
});

const DOMAINS: Domain[] = [
  dom({ id: "d1", name: "SCE", color: "#2563EB", icon: "🏢" }),
  dom({ id: "d2", name: "Family", color: "#DB2777", icon: "🏡" }),
  dom({ id: "d3", name: "Health", color: "#059669", icon: "🌿" }),
];

const proj = (o: Partial<Project> & { id: string; domainId: string; name: string }): Project =>
  ({
    initiativeId: null,
    keyResultId: null,
    outcome: "",
    description: "",
    status: "in_progress",
    startDate: day(0),
    targetDate: day(4),
    shippedAt: null,
    ...o,
  }) as unknown as Project;

const PROJECTS: Project[] = [
  // in motion, with homeless work — the row the crown exists for
  proj({ id: "p1", domainId: "d1", name: "Region 4 cutover" }),
  // carried from two weeks back, everything placed
  proj({ id: "p2", domainId: "d3", name: "Rebuild the morning routine" }),
  // every task done — ready to ship
  proj({ id: "p3", domainId: "d2", name: "Sort the garage" }),
  // a landed week-verdict over a project that still has open work
  proj({ id: "p4", domainId: "d1", name: "Vendor consolidation" }),
  // shipped inside this week — stays on the slate as the win it is
  proj({ id: "p5", domainId: "d1", name: "Obi handoff doc", status: "complete", shippedAt: at(1, 16) }),
  // NOT on this week — proves the slate is derived from the span, not the list
  proj({ id: "p6", domainId: "d2", name: "Family photo album", startDate: day(14), targetDate: day(18) }),
  // its week ended a fortnight ago and it's still open — it CARRIES onto this
  // week (D-108), arriving marked `wk 3` and ordered after the chosen rows
  proj({ id: "p7", domainId: "d3", name: "Teach the kids to ride", startDate: day(-14), targetDate: day(-10) }),
];

const vt = (o: Partial<VTask> & { id: string; title: string; projectId: string }): VTask =>
  ({
    initiativeId: null,
    domainId: null,
    keyResultId: null,
    bigRockId: null,
    energy: null,
    durationMins: 60,
    deadlineDaysAway: null,
    status: "ready",
    doDate: null,
    startTime: null,
    slotId: null,
    createdAt: null,
    ...o,
  }) as unknown as VTask;

// The vertical's view of the work (progress lives here) …
const VTASKS: VTask[] = [
  vt({ id: "t1", title: "Freeze the region-4 config", projectId: "p1", status: "done" }),
  vt({ id: "t2", title: "Dry-run the cutover script", projectId: "p1", status: "scheduled", startTime: at(2, 9) }),
  vt({ id: "t3", title: "Brief the on-call rota", projectId: "p1" }),
  vt({ id: "t4", title: "Write the rollback note", projectId: "p1" }),
  vt({ id: "t5", title: "Lay out the evening routine", projectId: "p2", status: "scheduled", startTime: at(0, 20) }),
  vt({ id: "t6", title: "Move the alarm 15m earlier", projectId: "p2", status: "done" }),
  vt({ id: "t7", title: "Hire the skip", projectId: "p3", status: "done" }),
  vt({ id: "t8", title: "Clear the shelving", projectId: "p3", status: "done" }),
  vt({ id: "t9", title: "Collect the last two quotes", projectId: "p4" }),
  vt({ id: "t10", title: "Send Obi the doc", projectId: "p5", status: "done" }),
  vt({ id: "t11", title: "Find the training wheels", projectId: "p7" }),
];

const task = (o: Partial<Task> & { id: string; title: string; project_id: string }): Task =>
  ({
    user_id: "u",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    notes: "",
    status: "backlog",
    do_date: null,
    start_time: null,
    duration_minutes: 60,
    deadline: null,
    priority: "normal",
    roll_count: 0,
    completed_at: null,
    trashed_at: null,
    initiative_id: null,
    domain_id: null,
    key_result_id: null,
    sprint_id: null,
    big_rock_id: null,
    energy: null,
    assignee: "me",
    prework: "",
    prework_at: null,
    suggestion: null,
    suggested_at: null,
    google_event_id: null,
    sort_order: 0,
    slot_id: null,
    ...o,
  }) as unknown as Task;

// … and the tasks table's view of the same rows, which is what the placed/loose
// split reads. `t2` has its own block, `t3` rides a sitting, `t4` is homeless.
const TASKS: Task[] = [
  task({ id: "t1", title: "Freeze the region-4 config", project_id: "p1", status: "done" }),
  task({ id: "t2", title: "Dry-run the cutover script", project_id: "p1", status: "planned", do_date: day(2), start_time: at(2, 9), duration_minutes: 90 }),
  task({ id: "t3", title: "Brief the on-call rota", project_id: "p1", slot_id: "s1", duration_minutes: 30 }),
  task({ id: "t4", title: "Write the rollback note", project_id: "p1", duration_minutes: 45 }),
  task({ id: "t5", title: "Lay out the evening routine", project_id: "p2", status: "planned", do_date: day(0), start_time: at(0, 20) }),
  task({ id: "t6", title: "Move the alarm 15m earlier", project_id: "p2", status: "done" }),
  task({ id: "t7", title: "Hire the skip", project_id: "p3", status: "done" }),
  task({ id: "t8", title: "Clear the shelving", project_id: "p3", status: "done" }),
  task({ id: "t9", title: "Collect the last two quotes", project_id: "p4", duration_minutes: 30 }),
  task({ id: "t10", title: "Send Obi the doc", project_id: "p5", status: "done" }),
  task({ id: "t11", title: "Find the training wheels", project_id: "p7", duration_minutes: 60 }),
];

// The blocks query is range-scoped — same window `useLooseWork` asks for.
const WEEK_START_ISO = MONDAY.toISOString();
const WEEK_END_ISO = addDays(MONDAY, 7).toISOString();
const BLOCKS: Task[] = TASKS.filter(
  (t) => t.start_time && t.start_time >= WEEK_START_ISO && t.start_time < WEEK_END_ISO,
);
const SLOTS: Slot[] = [
  {
    id: "s1",
    user_id: "u",
    title: "Rollout sitting",
    project_id: "p1",
    start_time: at(3, 14),
    duration_minutes: 90,
  } as unknown as Slot,
];

// The stored verdicts: p4 landed as a week-push while the project rolls on, and
// p1 has been carried twice.
const BIG_ROCKS: BigRock[] = [
  { id: "r1", title: "Region 4 cutover", win: "", initiative_id: null, project_id: "p1", done_at: null, roll_count: 2 },
  { id: "r4", title: "Vendor consolidation", win: "", initiative_id: null, project_id: "p4", done_at: at(3, 11), roll_count: 0 },
];

const SPRINT = { id: "sp1", week_start: WEEK_ISO, reviewed_at: new Date().toISOString(), big_rocks: BIG_ROCKS } as unknown as Sprint;

function useHarnessStore(): VerticalStore {
  const data: VerticalData = useMemo(
    () => ({
      domains: DOMAINS,
      initiatives: [],
      projects: PROJECTS,
      tasks: VTASKS,
      sprint: SPRINT,
      focusInitiativeIds: [],
      bigRocks: BIG_ROCKS,
      lastActivityByProject: {},
    }),
    [],
  );
  return {
    data,
    ready: true,
    togglePushLanded: () => {},
  } as unknown as VerticalStore;
}

/** The query cache the placed/loose split reads — seeded, never fetched, so the
 *  harness needs no account and no network. Keys mirror `useLooseWork`. */
function seededClient(): QueryClient {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
    },
  });
  qc.setQueryData(["tasks", "all"], TASKS);
  qc.setQueryData(["tasks", "scheduled", WEEK_START_ISO, WEEK_END_ISO], BLOCKS);
  qc.setQueryData(["slots", WEEK_START_ISO, WEEK_END_ISO], SLOTS);
  return qc;
}

export default function WeekCrownHarness() {
  const [client] = useState(seededClient);
  const store = useHarnessStore();
  const [log, setLog] = useState<string[]>([]);
  const say = (s: string) => setLog((l) => [s, ...l].slice(0, 6));

  return (
    <QueryClientProvider client={client}>
      <VerticalStoreProvider value={store}>
        <AppNavigationProvider>
          <div className="atmosphere min-h-screen p-4">
            <div className="mb-4">
              <div className="section-label !p-0">Verify · the week's crown</div>
              <div className="text-caption text-muted">
                One read model (`useWeekCrown`), two layouts. Same verdicts, same progress, same split.
              </div>
            </div>

            <div className="flex flex-wrap items-start gap-6">
              {/* The phone, at the width it has to survive. */}
              <div>
                <div className="section-label !p-0 !pb-1">Phone · 375px (Calendar tab)</div>
                <div
                  className="overflow-hidden rounded-[28px] border border-line-strong"
                  style={{ width: 375, height: 640 }}
                >
                  <div className="atmosphere h-full overflow-y-auto">
                    <MobileWeekCrown
                      now={new Date()}
                      onOpenProject={(id) => say(`open project ${id}`)}
                      onOpenDay={(d) => say(`jump to ${toDateISO(d)}`)}
                      onPlanWeek={() => say("plan the week")}
                      renderTask={(t, { action, whenShown }) => (
                        <TaskRow
                          key={t.id}
                          task={t}
                          labels={[]}
                          selected={false}
                          draggable={false}
                          action={action}
                          whenShown={whenShown}
                          onSelect={() => say(`select ${t.title}`)}
                          onOpen={() => say(`open ${t.title}`)}
                          onToggleDone={() => say(`toggle ${t.title}`)}
                        />
                      )}
                    />
                    <div className="px-4 py-6 text-caption text-muted">
                      (the week lens would continue here)
                    </div>
                  </div>
                </div>
              </div>

              {/* In situ, at two horizons — the whole point of the strip. The
                  slate used to be on the week-scoped lenses and absent from the
                  month, so standing back cost you the one thing you were
                  orienting by. Now it rides sticky under the chrome at BOTH, and
                  on the month it can't open (D-119 still holds: the month
                  answers a different question) — a tap takes you to the week.
                  The calendar's own queries aren't seeded here, so the bodies
                  are empty; what these frames verify is the composition — the
                  chrome, the strip under it, and no horizontal scroll. */}
              <InSitu label="in situ · week (slate opens)" mode="week" say={say} />
              <InSitu label="in situ · month (slate anchors)" mode="month" say={say} />

              {/* The desktop rail crown, over the same fixtures. */}
              <div>
                <div className="section-label !p-0 !pb-1">Desktop · the Schedule rail</div>
                <div className="overflow-hidden rounded-xl border border-line-strong" style={{ width: 320 }}>
                  <div className="atmosphere">
                    <WeekPanel
                      // The harness renders the REAL row, so the crown's one
                      // grammar is what gets verified here — a stub list would
                      // verify a layout the app doesn't ship.
                      renderTask={(t, { action, draggable, dragData, whenShown }) => (
                        <TaskRow
                          key={t.id}
                          task={t}
                          labels={[]}
                          selected={false}
                          draggable={draggable ?? false}
                          action={action}
                          whenShown={whenShown}
                          dragData={dragData}
                          onSelect={() => say(`select ${t.title}`)}
                          onOpen={() => say(`open ${t.title}`)}
                          onToggleDone={() => say(`toggle ${t.title}`)}
                        />
                      )}
                    />
                  </div>
                </div>
              </div>

              <div className="min-w-[200px]">
                <div className="section-label !p-0 !pb-1">Taps</div>
                {log.length === 0 ? (
                  <div className="text-caption text-muted">nothing yet</div>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {log.map((l, i) => (
                      <li key={i} className="mono text-micro text-muted">
                        {l}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </AppNavigationProvider>
      </VerticalStoreProvider>
    </QueryClientProvider>
  );
}

/** The real Calendar tab at 375px, wired exactly as `MobileShell` wires it —
 *  including the ＋ and the upkeep glyph, so the header here is as crowded as
 *  the real one. A frame missing a control measures a header the phone never
 *  has. Parameterised by horizon, because "the strip survives the stand-back"
 *  is only verifiable by looking at two horizons at once. */
function InSitu({
  label,
  mode,
  say,
}: {
  label: string;
  mode: "week" | "month";
  say: (s: string) => void;
}) {
  return (
    <div>
      <div className="section-label !p-0 !pb-1">Phone · {label}</div>
      <div
        className="overflow-hidden rounded-[28px] border border-line-strong"
        style={{ width: 375, height: 640 }}
      >
        <div className="atmosphere h-full overflow-y-auto">
          <MobileCalendar
            now={new Date()}
            initialMode={mode}
            onOpenProject={(id) => say(`open project ${id}`)}
            onPlanWeek={() => say("plan the week")}
            renderCrownTask={(t, { action, whenShown, draggable, dragData }) => (
              <TaskRow
                key={t.id}
                task={t}
                labels={[]}
                selected={false}
                draggable={draggable ?? false}
                action={action}
                whenShown={whenShown}
                dragData={dragData}
                onSelect={() => say(`select ${t.title}`)}
                onOpen={() => say(`open ${t.title}`)}
                onToggleDone={() => say(`toggle ${t.title}`)}
              />
            )}
            onNewEvent={(d) => say(`new event ${toDateISO(d)}`)}
            onTapEvent={() => say("tap event")}
            onOpenUpkeep={() => say("open upkeep")}
          />
        </div>
      </div>
    </div>
  );
}
