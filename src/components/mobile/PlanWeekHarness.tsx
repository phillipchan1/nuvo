// Standalone verify harness for Plan the week — the four steps rendered over
// fixture data at phone width, so the layout can be eyeballed (and checked for
// overflow / tap targets) without a real account. Reached at ?planweek, mounted
// in main.tsx. Not part of any real surface. Precedent: EmblemHarness (?emblem).

import { ProjectsStep, LeftoversStep, InboxStep, WeekStep } from "./MobilePlanWeek";
import SourceSwitch, { CapacityMeter, WEEK_STEPS, type WeekStep as Step } from "../rituals/WeekIntake";
import { readIntake } from "../../lib/intake";
import type { Placement } from "../../lib/compose";
import type { Batch } from "../../lib/batch";
import type { PullSuggestion } from "../../lib/pull";
import type { Domain, Project, VerticalData, VTask } from "../../lib/vertical";
import { addDays, format, startOfWeek } from "date-fns";
import { toDateISO } from "../../lib/dates";

const weekISO = toDateISO(startOfWeek(new Date(), { weekStartsOn: 1 }));
const dayISO = (i: number) => toDateISO(addDays(new Date(weekISO + "T00:00:00"), i));

const domain = (id: string, name: string, color: string): Domain => ({
  id, name, color, icon: "◆", intention: "", charter: "", context: null,
  weeklyTargetHours: 6, investedThisWeek: 2, meetingHoursThisWeek: 0, quarterHours: 40,
  lastTouchedDays: 1, weeks: [], sort: 0,
});

const project = (id: string, name: string, domainId: string, o: Partial<Project> = {}): Project => ({
  id, initiativeId: null, keyResultId: null, domainId, name,
  outcome: "A clear finish line stated in one line", description: "",
  startDate: weekISO, targetDate: dayISO(4), status: "in_progress", storedStatus: "in_progress",
  progress: 30, shippedAt: null, createdAt: null, tendedAt: null, verification: null,
  verifiedAt: null, brief: null, ...o,
});

const task = (id: string, title: string, projectId: string | null, domainId: string, o: Partial<VTask> = {}): VTask => ({
  id, projectId, initiativeId: null, domainId, keyResultId: null, bigRockId: null, title,
  energy: null, durationMins: 60, deadlineDaysAway: null, status: "ready", doDate: null,
  slotId: null, createdAt: null, completedAt: null, assignee: "me", rollCount: 0, ...o,
});

const DOMAINS = [domain("d1", "Work", "#7a6cc4"), domain("d2", "Church", "#6f8fb0"), domain("d3", "Family", "#c6708f")];
const PROJECTS = [
  project("p1", "Clearstream custom domains", "d1"),
  project("p2", "Fall retreat logistics", "d2", { outcome: "" }),
  project("p3", "Kitchen remodel quotes", "d3", { startDate: null, targetDate: null, status: "backlog" }),
  project("p4", "Q3 board deck", "d1", { startDate: dayISO(7), targetDate: dayISO(11) }),
];
const TASKS = [
  task("t1", "Verify DNS records with the vendor", "p1", "d1", { rollCount: 10 }),
  task("t2", "Write the migration note for support", "p1", "d1", { durationMins: 45 }),
  task("t3", "Confirm the retreat center deposit", "p2", "d2", { durationMins: 30 }),
  task("t4", "Collect three contractor quotes", "p3", "d3", { durationMins: 90 }),
  task("t5", "Renew the car registration", null, "d3", { durationMins: 20, loose: true }),
  task("t6", "Reply to the insurance adjuster", null, "d3", { durationMins: 15, deadlineDaysAway: 2 }),
];

const DATA: VerticalData = {
  domains: DOMAINS, initiatives: [], projects: PROJECTS, tasks: TASKS,
  sprint: null, sprintGoal: "Ship the domains migration", focusInitiativeIds: [],
  bigRocks: [], lastActivityByProject: {},
};

const PUSHES = [
  { project: PROJECTS[0], rock: null, done: false, shipped: false },
  { project: PROJECTS[1], rock: null, done: false, shipped: false },
];

// the pull, already split the way `useWeekDraft.byLane` splits it
const PROJECT_WORK: PullSuggestion[] = [
  { task: TASKS[1], reason: "Clearstream custom domains moves this week", kind: "project", projectId: "p1" },
  { task: TASKS[2], reason: "Fall retreat logistics moves this week", kind: "project", projectId: "p2" },
];
const LEFTOVERS: PullSuggestion[] = [
  { task: TASKS[0], reason: "slipped 10× — give it a new time", kind: "carried", projectId: "p1" },
  { task: TASKS[5], reason: "due in 2d", kind: "due", projectId: null },
  { task: TASKS[4], reason: "Family has been quiet 9d", kind: "quiet", projectId: null },
];

const KEPT = new Set(["t1", "t2", "t3", "t6"]);
const INTAKE = readIntake(
  [...PROJECT_WORK, ...LEFTOVERS].filter((s) => KEPT.has(s.task.id)).map((s) => s.task),
  { blockedMins: 180, budgetMins: 12 * 60 },
);

const PLACEMENTS = [
  { task: { id: "slot:p1", title: "Clearstream custom domains", project_id: "p1" }, dayISO: dayISO(0), startMin: 9 * 60, durationMin: 90, reason: "biggest push first" },
  { task: { id: "t3", title: "Confirm the retreat center deposit", project_id: "p2" }, dayISO: dayISO(1), startMin: 14 * 60, durationMin: 30, reason: "fits the afternoon" },
  { task: { id: "t5", title: "Renew the car registration", project_id: null }, dayISO: dayISO(2), startMin: 15 * 60 + 30, durationMin: 20, reason: "admin trough" },
] as unknown as Placement[];

const SLOTS = new Map<string, Batch>([
  ["slot:p1", { id: "slot:p1", name: "Clearstream custom domains", taskIds: ["t1", "t2"], domainId: "d1", color: "#7a6cc4", durationMins: 90 } as unknown as Batch],
]);

const RUNS = [
  { id: "run:1", name: "Errands & admin", taskIds: ["i1", "i2", "i3"], domainId: "d3", color: "#c6708f", durationMins: 45 } as unknown as Batch,
];

const busyAt = (d: number, h: number, mins: number, title: string) => ({
  title, kind: "event" as const,
  start: new Date(`${dayISO(d)}T${String(h).padStart(2, "0")}:00:00`),
  end: new Date(new Date(`${dayISO(d)}T${String(h).padStart(2, "0")}:00:00`).getTime() + mins * 60_000),
});
const BUSY = [busyAt(0, 11, 60, "Standup"), busyAt(1, 9, 90, "Board sync"), busyAt(3, 13, 120, "Offsite")];

const GAIN = { doneCount: 11, doneMins: 540, topMove: { name: "Clearstream", from: 40, to: 62 }, quiet: ["Family"] };

function Frame({ label, step, children }: { label: string; step: Step; children: React.ReactNode }) {
  return (
    <div style={{ width: 375 }} className="shrink-0">
      <div className="section-label px-3 py-2">{label}</div>
      <div
        className="atmosphere overflow-y-auto border border-line"
        style={{ height: 760 }}
        data-frame={label}
      >
        <div className="border-b border-line px-4 pb-2 pt-2">
          <SourceSwitch intake={INTAKE} step={step} onStep={() => {}} steps={WEEK_STEPS} waitingInbox={7} dense />
          <div className="mt-2.5">
            <CapacityMeter intake={INTAKE} fit={{ placed: 6, unplaced: 2 }} dense />
          </div>
        </div>
        <div className="px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

export default function PlanWeekHarness() {
  const days = [0, 1, 2, 3, 4].map((i) => ({ iso: dayISO(i), past: false }));
  return (
    <div className="atmosphere min-h-screen p-4">
      <h1 className="masthead mb-3 text-head">
        Plan the week — {format(new Date(weekISO + "T00:00:00"), "MMM d")} (fixtures)
      </h1>
      {/* the two shared pieces at desktop density — the switch rides the planner
          rail, the meter rides the week grid, so both are checked in one place */}
      <div className="mb-6 flex max-w-[1080px] gap-8 border-b border-line pb-3">
        <div className="w-[320px] shrink-0">
          <div className="section-label mb-1">The source switch · rail density</div>
          <SourceSwitch intake={INTAKE} step="loose" onStep={() => {}} waitingInbox={7} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="section-label mb-1">The capacity meter · over the week</div>
          <CapacityMeter intake={INTAKE} fit={{ placed: 6, unplaced: 2 }} />
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto">
        <Frame label="1 · Projects" step="projects">
          <ProjectsStep
            data={DATA}
            weekStartISO={weekISO}
            pushes={PUSHES}
            gain={GAIN}
            suggestions={PROJECT_WORK}
            kept={KEPT}
            setKept={() => {}}
            onDuration={() => {}}
            onBringIn={() => {}}
            onTakeOff={() => {}}
          />
        </Frame>
        <Frame label="2 · Leftovers" step="loose">
          <LeftoversStep
            data={DATA}
            suggestions={LEFTOVERS}
            kept={KEPT}
            setKept={() => {}}
            onDuration={() => {}}
            onBundleCarried={() => {}}
            bundling={false}
            bundleErr={null}
          />
        </Frame>
        <Frame label="3 · Inbox" step="inbox">
          <InboxStep
            data={DATA}
            suggestions={[]}
            runs={RUNS}
            kept={KEPT}
            setKept={() => {}}
            onDuration={() => {}}
            inboxCount={7}
            onGroup={() => {}}
            grouping={false}
            groupErr={null}
          />
        </Frame>
        <Frame label="4 · The week" step="week">
          <WeekStep
            data={DATA}
            days={days}
            placements={PLACEMENTS}
            slotNameById={SLOTS}
            unplaced={[{ task: TASKS[3], reason: "no room" } as never]}
            routedCount={2}
            busy={BUSY}
            workStart={8 * 60}
            workEnd={17 * 60}
            onDrop={() => {}}
            goal=""
            setGoal={() => {}}
            lastGoal="Ship the domains migration"
          />
        </Frame>
      </div>
    </div>
  );
}
