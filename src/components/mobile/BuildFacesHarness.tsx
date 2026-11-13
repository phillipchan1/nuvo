// Standalone verify harness for the phone's two NEW Build faces — Groom
// (MobileGroom) and Shipped (MobileShipped) — plus the long-press record acts
// (MobileRecordActions), over fixture data at phone width. Reached at ?build,
// mounted in main.tsx. Not part of any real surface. Precedent: DomainHarness
// (?domains), CalendarHarness (?horizon), PlanWeekHarness (?planweek).
//
// Both faces existed only on the desktop until now, so this frame is where the
// phone's version gets driven — type an outcome, add a step, add a key result,
// file a shipped project under an area, hold a row for its acts — without a real
// account. The fixtures deliberately cover the states each face has to tell
// apart: raw / mid-groom / ready / parked work, and shipped work both attributed
// and orphaned.

import { useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VerticalStoreProvider, type VerticalStore } from "../../hooks/useVertical";
import { TaskCaptureSinkContext, type TaskCaptureSink } from "../../hooks/useTaskCapture";

// Fixtures only: a capture lands in the harness's own fixture list (its
// `addTask` stub), and nothing typed or ticked here is written anywhere.
function harnessSink(store: VerticalStore): TaskCaptureSink {
  const fixtures = store as unknown as {
    addTask: (parent: { projectId?: string | null; initiativeId?: string | null; domainId?: string | null }, patch: { title: string; durationMins?: number }) => void;
  };
  return {
    create: async (input) =>
      fixtures.addTask(
        { projectId: input.project_id, initiativeId: input.initiative_id, domainId: input.domain_id },
        { title: input.title, durationMins: input.duration_minutes ?? undefined },
      ),
    createSeries: async () => undefined,
  };
}
import type {
  Domain,
  Initiative,
  KeyResult,
  Project,
  VTask,
  VerticalData,
} from "../../lib/vertical";
import MobileGroom from "./MobileGroom";
import MobileShipped from "./MobileShipped";
import MobileProjects from "./MobileProjects";
import MobileInitiatives from "./MobileInitiatives";
import MobileReadiness from "./MobileReadiness";
import WeekPlanCard from "./WeekPlanCard";
import { PlanWeekCard } from "./MobilePlanWeek";
import { useVertical } from "../../hooks/useVertical";
import { PhoneNav, PhoneTopBar, type Place } from "./ShellChrome";
import { Button } from "../kit";

// ── fixtures ─────────────────────────────────────────────────────────────────
const dom = (o: Partial<Domain> & { id: string; name: string; color: string }): Domain => ({
  icon: "diamond",
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
  dom({ id: "d1", name: "SCE", color: "#2563EB", icon: "building", sort: 0 }),
  dom({ id: "d2", name: "Family", color: "#DB2777", icon: "house", sort: 1 }),
  dom({ id: "d3", name: "Health", color: "#059669", icon: "heart-pulse", sort: 2 }),
];

// Dates are relative to whenever the harness runs, so a fixture never rots into
// "everything is overdue" the way a hardcoded month would.
const iso = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

const kr = (o: Partial<KeyResult> & { id: string; name: string }): KeyResult => ({
  baseline: 0,
  current: 0,
  target: 10,
  unit: "",
  updatedAt: null,
  ...o,
});

const INITIATIVES: Initiative[] = [
  // ready — objective, finish line, and a number to move
  {
    id: "i1", domainId: "d1", name: "Enterprise rollout", outcome: "Every region live on the new stack.",
    description: "", status: "in_progress", momentum: "up", startDate: iso(-30), targetDate: iso(45), sort: 0,
    keyResults: [kr({ id: "k1", name: "Regions live", current: 3, target: 8, unit: "regions" })],
  } as unknown as Initiative,
  // mid-groom — says what it wins, but nothing measures it
  {
    id: "i2", domainId: "d3", name: "Get back under 15% body fat", outcome: "Fit into the old suit by the wedding.",
    description: "", status: "in_progress", momentum: "flat", startDate: null, targetDate: iso(70), sort: 1,
    keyResults: [],
  } as unknown as Initiative,
  // raw — a name and nothing else
  {
    id: "i3", domainId: "d2", name: "Family sabbatical", outcome: "", description: "",
    status: "backlog", momentum: "flat", startDate: null, targetDate: null, sort: 2, keyResults: [],
  } as unknown as Initiative,
  // shipped last quarter
  {
    id: "i4", domainId: "d1", name: "Kill the legacy billing path", outcome: "One billing system.",
    description: "", status: "complete", momentum: "up", startDate: iso(-200), targetDate: iso(-100), sort: 3,
    keyResults: [],
  } as unknown as Initiative,
];

const PROJECTS: Project[] = [
  // ready-ish — outcome + steps, placed on a week
  {
    id: "p1", domainId: "d1", initiativeId: "i1", keyResultId: null, name: "Region 4 cutover",
    outcome: "Region 4 running on the new stack with no rollback.", description: "",
    status: "in_progress", startDate: iso(0), targetDate: iso(6), sort: 0,
  } as unknown as Project,
  // mid-groom — outcome, no steps
  {
    id: "p2", domainId: "d3", initiativeId: null, keyResultId: null, name: "Rebuild the morning routine",
    outcome: "Up at six without an alarm fight.", description: "",
    status: "in_progress", startDate: iso(7), targetDate: iso(13), sort: 1,
  } as unknown as Project,
  // raw — a name on a week and nothing else. The card Groom exists for.
  {
    id: "p3", domainId: "d2", initiativeId: null, keyResultId: null, name: "Sort the garage",
    outcome: "", description: "", status: "in_progress", startDate: iso(14), targetDate: iso(20), sort: 2,
  } as unknown as Project,
  // parked — rests at the end, dimmed
  {
    id: "p4", domainId: "d1", initiativeId: null, keyResultId: null, name: "Vendor consolidation",
    outcome: "", description: "", status: "waiting", startDate: null, targetDate: iso(30), sort: 3,
  } as unknown as Project,
  // shipped, attributed
  {
    id: "p5", domainId: "d1", initiativeId: null, keyResultId: null, name: "Obi handoff doc",
    outcome: "", description: "", status: "complete", shippedAt: iso(-4), startDate: null, targetDate: null, sort: 4,
  } as unknown as Project,
  {
    id: "p6", domainId: "d3", initiativeId: null, keyResultId: null, name: "Annual physical",
    outcome: "", description: "", status: "complete", shippedAt: iso(-11), startDate: null, targetDate: null, sort: 5,
  } as unknown as Project,
  // shipped last month, and ORPHANED — the attribution act the wall exists for
  {
    id: "p7", domainId: "", initiativeId: null, keyResultId: null, name: "Family photo album",
    outcome: "", description: "", status: "complete", shippedAt: iso(-38), startDate: null, targetDate: null, sort: 6,
  } as unknown as Project,
];

const TASKS: VTask[] = [
  { id: "t1", title: "Freeze the region-4 config", status: "backlog", domainId: "d1", initiativeId: "i1", projectId: "p1", durationMins: 45 } as unknown as VTask,
  { id: "t2", title: "Dry-run the cutover script", status: "backlog", domainId: "d1", initiativeId: "i1", projectId: "p1", durationMins: 60 } as unknown as VTask,
];

// ── a live-enough store: the writes these two faces actually make ─────────────
function useHarnessStore(): VerticalStore {
  const [initiatives, setInitiatives] = useState(INITIATIVES);
  const [projects, setProjects] = useState(PROJECTS);
  const [tasks, setTasks] = useState(TASKS);

  const data: VerticalData = useMemo(
    () => ({
      domains: DOMAINS,
      initiatives,
      projects,
      tasks,
      sprint: null,
      focusInitiativeIds: [],
      bigRocks: [],
      lastActivityByProject: {},
    }),
    [initiatives, projects, tasks],
  );

  const store = {
    data,
    ready: true,
    updateProject: (id: string, patch: Partial<Project>) =>
      setProjects((s) => s.map((p) => (p.id === id ? { ...p, ...patch } : p))),
    deleteProject: (id: string) => setProjects((s) => s.filter((p) => p.id !== id)),
    updateInitiative: (id: string, patch: Partial<Initiative>) =>
      setInitiatives((s) => s.map((i) => (i.id === id ? { ...i, ...patch } : i))),
    deleteInitiative: (id: string) => setInitiatives((s) => s.filter((i) => i.id !== id)),
    addKeyResult: async (initiativeId: string) =>
      setInitiatives((s) =>
        s.map((i) =>
          i.id === initiativeId
            ? { ...i, keyResults: [...i.keyResults, kr({ id: `k${Date.now()}`, name: "" })] }
            : i,
        ),
      ),
    addTask: (parent: { projectId?: string | null; initiativeId?: string | null; domainId?: string | null }, patch?: { title?: string; durationMins?: number }) =>
      setTasks((s) => [
        ...s,
        {
          id: `t${Date.now()}`,
          title: patch?.title ?? "Untitled",
          status: "backlog",
          domainId: parent.domainId ?? null,
          initiativeId: parent.initiativeId ?? null,
          projectId: parent.projectId ?? null,
          durationMins: patch?.durationMins ?? null,
        } as unknown as VTask,
      ]),
    toggleTask: (id: string) =>
      setTasks((s) => s.map((t) => (t.id === id ? ({ ...t, status: t.status === "done" ? "backlog" : "done" } as VTask) : t))),
    deleteTask: (id: string) => {
      setTasks((s) => s.filter((t) => t.id !== id));
      return undefined;
    },
  };

  // Everything else the interface declares is unreachable from these two faces;
  // a harness that stubbed all forty would be noise.
  return store as unknown as VerticalStore;
}

// ── the harness ──────────────────────────────────────────────────────────────
function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ width: 375 }} className="shrink-0">
      <div className="px-3 py-2 text-caption font-semibold text-muted">{label}</div>
      {/* The real shell is a flex column that owns its own scrolling, so the
          frame has to be one too — a plain overflow box would hide the
          faces' internal scrollers and the sticky group headers with them. */}
      <div className="atmosphere flex flex-col border border-[var(--line-1)]" style={{ height: 780 }}>
        {children}
      </div>
    </div>
  );
}

const PLACES: Place<string>[] = [
  { id: "calendar", label: "Calendar", kind: "day" },
  { id: "tasks", label: "Tasks", kind: "task" },
  { id: "projects", label: "Projects", kind: "project" },
  { id: "initiatives", label: "Initiatives", kind: "initiative" },
  { id: "domains", label: "Domains", kind: "domain" },
];

/** `?build=<face>` frames ONE face at the viewport's own width, inside the
 *  shell's real chrome — what a 375px or 320px phone actually gets. The faces
 *  side by side below would make a touch-emulated viewport zoom out. */
/** The Tasks › Week segment's cards over the same fixtures (?build=week). */
function WeekCards() {
  const { data } = useVertical();
  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      <MobileReadiness data={data} onPlanWeek={() => {}} onReview={() => {}} />
      <PlanWeekCard onOpen={() => {}} />
      <WeekPlanCard variant="link" />
      <WeekPlanCard />
      <PlanWeekCard onOpen={() => {}} variant="link" />
    </div>
  );
}

const SOLO: Record<string, { tab: "projects" | "initiatives" | "tasks"; render: () => React.ReactNode }> = {
  week: { tab: "tasks", render: () => <WeekCards /> },
  projects: { tab: "projects", render: () => <MobileProjects onOpenItem={() => {}} /> },
  initiatives: { tab: "initiatives", render: () => <MobileInitiatives onOpenItem={() => {}} /> },
  groom: { tab: "projects", render: () => <MobileGroom scope="project" onOpenItem={() => {}} /> },
  shipped: { tab: "projects", render: () => <MobileShipped scope="project" onOpenItem={() => {}} /> },
  igroom: { tab: "initiatives", render: () => <MobileGroom scope="initiative" onOpenItem={() => {}} /> },
  ishipped: { tab: "initiatives", render: () => <MobileShipped scope="initiative" onOpenItem={() => {}} /> },
};

function toggleTheme() {
  const el = document.documentElement;
  el.dataset.theme = el.dataset.theme === "dark" ? "light" : "dark";
}

function Solo({ face }: { face: string }) {
  const f = SOLO[face];
  return (
    <div className="atmosphere fixed inset-0 flex flex-col">
      <PhoneTopBar
        title={f.tab === "projects" ? "Projects" : f.tab === "tasks" ? "Tasks" : "Initiatives"}
        fact="Thursday, November 12"
        onSearch={() => {}}
        onToggleTheme={toggleTheme}
        onSettings={() => {}}
      />
      <main className="mobile-scroll relative min-h-0 flex-1 overflow-y-auto">{f.render()}</main>
      <PhoneNav places={PLACES} current={f.tab} onPick={() => {}} onCapture={() => {}} onAskNuvo={() => {}} />
    </div>
  );
}

// The faces call useCapacity (→ react-query) for the "fits" axis. No account
// here, so the queries simply resolve empty and the axis reads unmet — which is
// itself one of the states worth looking at.
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

export default function BuildFacesHarness() {
  const store = useHarnessStore();
  const sink = useMemo(() => harnessSink(store), [store]);
  const noop = () => {};
  const solo = new URLSearchParams(window.location.search).get("build") ?? "";

  return (
    <QueryClientProvider client={qc}>
      <TaskCaptureSinkContext.Provider value={sink}>
      <VerticalStoreProvider value={store}>
        {SOLO[solo] ? (
          <Solo face={solo} />
        ) : (
        <div className="atmosphere min-h-screen p-4">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-caption text-muted">
              The phone's Build faces at 375px — or one at a time: ?build=projects · initiatives · groom ·
              shipped · igroom · ishipped
            </span>
            <Button size="xs" onClick={toggleTheme}>
              Theme
            </Button>
          </div>
          <div className="flex gap-5 overflow-x-auto pb-6">
            <Frame label="Projects › Groom">
              <MobileGroom scope="project" onOpenItem={noop} />
            </Frame>
            <Frame label="Projects › Shipped">
              <MobileShipped scope="project" onOpenItem={noop} />
            </Frame>
            <Frame label="Initiatives › Groom">
              <MobileGroom scope="initiative" onOpenItem={noop} />
            </Frame>
            <Frame label="Initiatives › Shipped">
              <MobileShipped scope="initiative" onOpenItem={noop} />
            </Frame>
          </div>
        </div>
        )}
      </VerticalStoreProvider>
      </TaskCaptureSinkContext.Provider>
    </QueryClientProvider>
  );
}
