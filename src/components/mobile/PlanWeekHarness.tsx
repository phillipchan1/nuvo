// Standalone verify harness for Plan the week — the three steps rendered over
// fixture data at phone width, so the layout can be eyeballed (and checked for
// overflow / tap targets) without a real account. Reached at ?planweek, mounted
// in main.tsx. Not part of any real surface. Precedent: EmblemHarness (?emblem).

import { SlateStep, PullStep, ShapeStep } from "./MobilePlanWeek";
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

const SUGGESTIONS: PullSuggestion[] = [
  { task: TASKS[0], reason: "slipped 10× — give it a new time", projectId: "p1" },
  { task: TASKS[1], reason: "Clearstream custom domains moves this week", projectId: "p1" },
  { task: TASKS[2], reason: "Fall retreat logistics moves this week", projectId: "p2" },
  { task: TASKS[4], reason: "Family has been quiet 9d", projectId: null },
];

const PLACEMENTS = [
  { task: { id: "slot:p1", title: "Clearstream custom domains", project_id: "p1" }, dayISO: dayISO(0), startMin: 9 * 60, durationMin: 90, reason: "biggest push first" },
  { task: { id: "t3", title: "Confirm the retreat center deposit", project_id: "p2" }, dayISO: dayISO(1), startMin: 14 * 60, durationMin: 30, reason: "fits the afternoon" },
  { task: { id: "t5", title: "Renew the car registration", project_id: null }, dayISO: dayISO(2), startMin: 15 * 60 + 30, durationMin: 20, reason: "admin trough" },
] as unknown as Placement[];

const SLOTS = new Map<string, Batch>([
  ["slot:p1", { id: "slot:p1", name: "Clearstream custom domains", taskIds: ["t1", "t2"], domainId: "d1", color: "#7a6cc4", mins: 90 } as unknown as Batch],
]);

const GAIN = { doneCount: 11, doneMins: 540, topMove: { name: "Clearstream", from: 40, to: 62 }, quiet: ["Family"] };

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ width: 375 }} className="shrink-0">
      <div className="section-label px-3 py-2">{label}</div>
      <div
        className="atmosphere overflow-y-auto border border-line"
        style={{ height: 760 }}
        data-frame={label}
      >
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
      <div className="flex gap-4 overflow-x-auto">
        <Frame label="1 · Slate">
          <SlateStep
            data={DATA}
            weekStartISO={weekISO}
            pushes={PUSHES}
            gain={GAIN}
            onBringIn={() => {}}
            onTakeOff={() => {}}
          />
        </Frame>
        <Frame label="2 · Pull">
          <PullStep
            data={DATA}
            suggestions={SUGGESTIONS}
            kept={new Set(["t1", "t2", "t3"])}
            setKept={() => {}}
            keptMins={195}
            inboxCount={7}
            onThemeInbox={() => {}}
            theming={false}
            themeErr={null}
            onThemeCarried={() => {}}
            themingCarried={false}
            carriedErr={null}
          />
        </Frame>
        <Frame label="3 · Shape">
          <ShapeStep
            data={DATA}
            days={days}
            placements={PLACEMENTS}
            slotNameById={SLOTS}
            unplaced={[{ task: TASKS[3], reason: "no room" } as never]}
            routedCount={2}
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
