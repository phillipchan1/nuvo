// Standalone verify harness for Plan the week — the four steps rendered over
// fixture data at phone width, so the layout can be eyeballed (and checked for
// overflow / tap targets) without a real account. Reached at ?planweek, mounted
// in main.tsx. Not part of any real surface. Precedent: EmblemHarness (?emblem).

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VerticalStoreProvider, type VerticalStore } from "../../hooks/useVertical";
import WeekSetMoment from "../plan/WeekSetMoment";
import { ProjectsStep, CarriedStep, WeekStep, OpenStep, PlanWeekFrame } from "./MobilePlanWeek";
import { Button } from "../kit";
import SourceSwitch, { CapacityMeter, WEEK_STEPS, type WeekStep as Step } from "../rituals/WeekIntake";
import { readIntake } from "../../lib/intake";
import type { Placement } from "../../lib/compose";
import type { Batch } from "../../lib/batch";
import type { PullSuggestion } from "../../lib/pull";
import type { Domain, Project, VerticalData, VTask } from "../../lib/vertical";
import { addDays, format, startOfWeek } from "date-fns";
import { toDateISO } from "../../lib/dates";
import RepairRail from "../plan/RepairRail";
import RepairLine from "../plan/RepairLine";
import { useRepairs } from "../plan/repairActs";
import type { Repair } from "../../hooks/useWeekRepair";

const weekISO = toDateISO(startOfWeek(new Date(), { weekStartsOn: 1 }));
const dayISO = (i: number) => toDateISO(addDays(new Date(weekISO + "T00:00:00"), i));

const domain = (id: string, name: string, color: string): Domain => ({
  id, name, color, icon: "diamond", intention: "", charter: "", context: null,
  weeklyTargetHours: 6, investedThisWeek: 2, meetingHoursThisWeek: 0, quarterHours: 40,
  lastTouchedDays: 1, lastShip: null, weeks: [], days: [0, 0, 0, 0, 0, 0, 0], sort: 0,
});

const project = (id: string, name: string, domainId: string, o: Partial<Project> = {}): Project => ({
  id, initiativeId: null, keyResultId: null, domainId, name,
  outcome: "A clear finish line stated in one line", description: "",
  startDate: weekISO, targetDate: dayISO(4), status: "in_progress", storedStatus: "in_progress",
  progress: 30, shippedAt: null, createdAt: null, tendedAt: null, verification: null,
  verifiedAt: null, brief: null, sortOrder: 0, ...o,
});

const task = (id: string, title: string, projectId: string | null, domainId: string, o: Partial<VTask> = {}): VTask => ({
  id, projectId, initiativeId: null, domainId, keyResultId: null, bigRockId: null, title,
  energy: null, durationMins: 60, deadlineDaysAway: null, status: "ready", doDate: null,
  startTime: null, slotId: null, createdAt: null, completedAt: null, assignee: "me", rollCount: 0, ...o,
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
  { project: PROJECTS[0], rock: null, done: false, shipped: false, carried: 0 },
  // one carrying, so the harness shows what a project whose week passed looks like
  { project: PROJECTS[1], rock: null, done: false, shipped: false, carried: 2 },
];

// the pull, already split the way `useWeekDraft.byLane` splits it
const PROJECT_WORK: PullSuggestion[] = [
  { task: TASKS[1], reason: "Clearstream custom domains moves this week", kind: "project", projectId: "p1" },
  { task: TASKS[2], reason: "Fall retreat logistics moves this week", kind: "project", projectId: "p2" },
];
const LEFTOVERS: PullSuggestion[] = [
  { task: TASKS[0], reason: "slipped 10× — give it a new time", kind: "carried", projectId: "p1" },
  { task: TASKS[5], reason: "due in 2d", kind: "due", projectId: null },
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


function Frame({ label, step, children }: { label: string; step: Step; children: React.ReactNode }) {
  return (
    <div style={{ width: 375 }} className="shrink-0">
      <div className="px-3 py-2 text-caption font-semibold text-muted">{label}</div>
      <div
        className="atmosphere overflow-y-auto border border-[var(--line-1)]"
        style={{ height: 760 }}
        data-frame={label}
      >
        <div className="border-b border-[var(--line-1)] px-4 pb-2 pt-2">
          <SourceSwitch step={step} onStep={() => {}} steps={WEEK_STEPS} dense />
          <div className="mt-2.5">
            <CapacityMeter intake={INTAKE} fit={{ placed: 6, unplaced: 2 }} dense />
          </div>
        </div>
        <div className="px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

const DAYS = [0, 1, 2, 3, 4].map((i) => ({ iso: dayISO(i), past: false }));

/** One step's body over the fixtures — what both the side-by-side frames and
 *  the solo flow render. */
function StepBody({ step }: { step: Step }) {
  if (step === "open") return <OpenStep blockedMins={180} />;
  if (step === "projects")
    return (
      <ProjectsStep
        data={DATA}
        weekStartISO={weekISO}
        pushes={PUSHES}
        suggestions={PROJECT_WORK}
        kept={KEPT}
        setKept={() => {}}
        onDuration={() => {}}
        onBringIn={() => {}}
        onTakeOff={() => {}}
      />
    );
  if (step === "rest")
    return (
      <CarriedStep
        data={DATA}
        carried={LEFTOVERS}
        captures={[]}
        runs={RUNS}
        kept={KEPT}
        setKept={() => {}}
        onDuration={() => {}}
        inboxCount={7}
        onSlot={() => {}}
        slotting={false}
        slotErr={null}
      />
    );
  return (
    <WeekStep
      data={DATA}
      days={DAYS}
      placements={PLACEMENTS}
      slotNameById={SLOTS}
      unplaced={[{ task: TASKS[3], reason: "no room" } as never]}
      routedCount={2}
      busy={BUSY}
      workStart={8 * 60}
      workEnd={17 * 60}
      onDrop={() => {}}
    />
  );
}

/** `?planweek=<step>` — the whole flow, live, in its real frame at the
 *  viewport's own width (open · projects · rest · week · commit). The frames
 *  side by side below make a touch-emulated viewport zoom out. */
function Solo({ initial }: { initial: Step | "commit" }) {
  const [step, setStep] = useState<Step | "commit">(initial);
  if (step === "commit") {
    return (
      <div className="ph-overlay !pt-0">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8">
          <WeekSetMoment
            eyebrow="This week"
            bands={COMMIT_BANDS}
            facts="9 scheduled · 12 committed · 2 standing"
            goal="Ship the cutover and keep Thursday evening clear"
          />
        </div>
      </div>
    );
  }
  return (
    <PlanWeekFrame
      weekStartISO={weekISO}
      step={step}
      onStep={setStep}
      onClose={() => {}}
      meter={<CapacityMeter intake={INTAKE} fit={{ placed: 6, unplaced: 2 }} compact dense />}
      onCommit={() => setStep("commit")}
    >
      <StepBody step={step} />
    </PlanWeekFrame>
  );
}

const COMMIT_BANDS = DOMAINS.map((d, i) => ({ key: d.id, label: d.name, color: d.color, mins: [540, 240, 180][i] ?? 60 }));

function CommitFrames() {
  const [n, setN] = useState(0);
  return (
    <div className="mb-6 border-b border-[var(--line-1)] pb-4" data-commit-frames>
      <div className="mb-2 flex items-center gap-3">
        <div className="text-caption font-semibold text-muted">Commit · the week is set</div>
        <Button size="xs" onClick={() => setN((x) => x + 1)} data-replay>
          Replay
        </Button>
      </div>
      <div className="flex flex-wrap items-start gap-6" key={n}>
        <div className="atmosphere flex items-center justify-center border border-[var(--line-1)] px-8" style={{ width: 375, height: 420 }} data-frame="commit-phone">
          <WeekSetMoment
            eyebrow="This week"
            bands={COMMIT_BANDS}
            facts="9 scheduled · 12 committed · 2 standing"
            goal="Ship the cutover and keep Thursday evening clear"
          />
        </div>
        <div className="atmosphere border border-[var(--line-1)] p-4" style={{ width: 320 }} data-frame="commit-rail">
          <WeekSetMoment
            align="start"
            eyebrow="Committed"
            bands={COMMIT_BANDS}
            facts="12 things → 7 blocks · 1m 42s · 3 changes by you"
            action={
              <Button kind="primary" size="md" full>
                Done
              </Button>
            }
          />
        </div>
      </div>
    </div>
  );
}

// Repair as a rail mode (D-204): the crown's line at rest, and the rail it
// opens. Fixture breaks; the acts write nothing.
const REPAIRS: Repair[] = [
  {
    key: "r1", kind: "task", id: "t-pricing", title: "Pricing page copy for the spring catalogue launch", why: "landed", event: "Call with Dana",
    from: { dayISO: dayISO(1), startMin: 10 * 60, durationMin: 60 },
    options: [
      { task: { id: "t-pricing" }, dayISO: dayISO(2), startMin: 9 * 60, durationMin: 60, reason: "first open hour" },
      { task: { id: "t-pricing" }, dayISO: dayISO(3), startMin: 14 * 60, durationMin: 60, reason: "afternoon" },
    ] as unknown as Placement[],
  },
  {
    key: "r2", kind: "task", id: "t-calls", title: "Calls", why: "missed",
    from: { dayISO: dayISO(0), startMin: 16 * 60, durationMin: 45 },
    options: [{ task: { id: "t-calls" }, dayISO: dayISO(3), startMin: 11 * 60, durationMin: 45, reason: "morning" }] as unknown as Placement[],
  },
];

const CROWN_CLIENT = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
const CROWN_STORE = { data: DATA, ready: true } as unknown as VerticalStore;

function RepairFrames() {
  const state = useRepairs(REPAIRS, { apply: () => () => {} });
  const [mode, setMode] = useState(false);
  return (
    <div className="mb-6 border-b border-[var(--line-1)] pb-4" data-repair-frames>
      <div className="mb-2 text-caption font-semibold text-muted">Repair · a rail mode (D-204) — the crown's line, then the rail it opens</div>
      <div className="flex flex-wrap items-start gap-6">
        <div className="crown border border-[var(--line-1)] p-3" style={{ width: 340 }} data-frame="repair-line">
          <RepairLine state={state} onOpen={() => setMode(true)} />
        </div>
        {mode && (
          <div className="flex border border-[var(--line-1)]" style={{ height: 560 }} data-frame="repair-rail">
            <RepairRail state={state} onOverlay={() => {}} onClose={() => setMode(false)} />
          </div>
        )}
      </div>
    </div>
  );
}

const SOLO_STEPS = ["open", "projects", "rest", "week", "commit"] as const;

export default function PlanWeekHarness() {
  const solo = new URLSearchParams(window.location.search).get("planweek") as Step | "commit" | null;
  if (solo && (SOLO_STEPS as readonly string[]).includes(solo)) return <Solo initial={solo} />;
  return (
    <div className="atmosphere min-h-screen p-4">
      <h1 className="mb-3 text-head font-semibold">
        Plan the week — {format(new Date(weekISO + "T00:00:00"), "MMM d")} (fixtures) · ?planweek=projects for the live flow
      </h1>
      {/* the two shared pieces at desktop density — the switch rides the planner
          rail, the meter rides the week grid, so both are checked in one place */}
      <div className="mb-6 flex max-w-[1080px] gap-8 border-b border-[var(--line-1)] pb-3">
        <div className="w-[320px] shrink-0">
          <div className="mb-1 text-caption font-semibold text-muted">The source switch · rail density</div>
          <SourceSwitch step="rest" onStep={() => {}} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-caption font-semibold text-muted">The capacity meter · over the week</div>
          <CapacityMeter intake={INTAKE} fit={{ placed: 6, unplaced: 2 }} />
        </div>
      </div>

      {/* COMMIT (D-187) — the moment both shells end Plan the week on: the
          phone's full-screen close at 375, and the desktop rail's at rail
          width. "Replay" remounts both, because the motion is the point and it
          only plays once. */}
      <CommitFrames />

      {/* The repair rail pins the week's crown (rail-modes §2), which reads the
          vertical — so the frames get the fixture week, and a query cache that
          never fetches (no account here). */}
      <QueryClientProvider client={CROWN_CLIENT}>
        <VerticalStoreProvider value={CROWN_STORE}>
          <RepairFrames />
        </VerticalStoreProvider>
      </QueryClientProvider>

      <div className="flex gap-4 overflow-x-auto">
        <Frame label="1 · Projects" step="projects">
          <StepBody step="projects" />
        </Frame>
        <Frame label="3 · The rest" step="rest">
          <StepBody step="rest" />
        </Frame>
        <Frame label="4 · The week" step="week">
          <StepBody step="week" />
        </Frame>
      </div>
    </div>
  );
}
