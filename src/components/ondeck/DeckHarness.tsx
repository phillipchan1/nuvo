// `?decks` — both planner decks over fixtures, as FloorPane mounts them
// (D-207, docs/rail-line.md §3, §5, §7). The rail owns its corner (the page bar
// is handed down and drawn over the grid), the crown is the kit's, and the line
// opens the deck's Get ready stack. Fixtures cover what the stack has to rank:
// an overdue project, a gap near and far, a ready one, a shipped one; a bet at
// risk, one with no key results, one on track.
//
// `?decks=plan` opens both decks straight into their walks (D-216, Plan
// projects / Plan initiatives) over the same fixtures, with a stand-in drafter
// — Draft the path's agent can't run without an account — so the walk's two
// phases, R12's pinning on a steer, and the span costs can be seen and driven.

import { useMemo, useState, type ReactNode } from "react";
import { addDays, format, startOfWeek } from "date-fns";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VerticalStoreProvider, type VerticalStore } from "../../hooks/useVertical";
import { AppNavigationProvider } from "../../hooks/useAppNavigation";
import type { Domain, Initiative, KeyResult, Project, VTask, VerticalData } from "../../lib/vertical";
import type { ProposedStep } from "../../lib/pathDraft";
import type { AskScaffold } from "../../lib/scaffoldAsk";
import type { AddPlannedTasks } from "./PlanProjectsRail";
import { PageBar, Tabs } from "../kit";
import OnDeckPlanner from "./OnDeckPlanner";
import InitiativeDeck from "./InitiativeDeck";

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const monday = startOfWeek(new Date(), { weekStartsOn: 1 });
const wk = (n: number) => ({ startDate: iso(addDays(monday, n * 7)), targetDate: iso(addDays(monday, n * 7 + 4)) });

const dom = (id: string, name: string, color: string, sort: number): Domain =>
  ({
    id, name, color, sort, icon: "diamond", intention: "", charter: "", context: null, weeklyTargetHours: 0, investedThisWeek: 0,
    meetingHoursThisWeek: 0, quarterHours: 0, lastTouchedDays: 3, lastShip: null, weeks: new Array(13).fill(1), days: new Array(7).fill(0),
  }) as unknown as Domain;

const DOMAINS = [dom("d1", "Frontier", "#8e2fa3", 0), dom("d2", "Family", "#c42b5a", 1), dom("d3", "Made for", "#56606e", 2)];
// Family has no logged weeks: its spans are sized at the named default.
(DOMAINS[1] as unknown as { weeks: number[] }).weeks = new Array(13).fill(0);

const proj = (id: string, domainId: string, name: string, outcome: string, span: { startDate: string; targetDate: string }, status = "in_progress", extra: Partial<Project> = {}): Project =>
  ({ id, domainId, initiativeId: null, keyResultId: null, name, outcome, status, sort: 0, ...span, ...extra }) as unknown as Project;

const PROJECTS: Project[] = [
  proj("p1", "d1", "Stand up security team", "A trained team on every Sunday", wk(0)),
  proj("p2", "d1", "Build Staff Rigor Plan", "Every lead has a written plan", wk(1)),
  proj("p3", "d2", "Rebuild Families Newsletter", "", wk(1)),
  proj("p4", "d2", "Start Treasured Reading Book Project", "", wk(3)),
  proj("p5", "d3", "Cloudflare migration", "The app runs on the Worker", { startDate: iso(addDays(monday, -21)), targetDate: iso(addDays(monday, -10)) }),
  // a third open project this week — over the default cap, so the stack offers a move
  proj("p7", "d2", "Fix the volunteer roster", "", wk(0)),
  proj("p6", "d1", "Create Spiritual Gifts Test V1", "A test the staff can take", wk(0), "complete", { shippedAt: iso(addDays(monday, 1)) } as Partial<Project>),
];

const task = (id: string, projectId: string, domainId: string, title: string, status = "backlog"): VTask =>
  ({ id, title, status: status === "done" ? "done" : "ready", projectId, domainId, initiativeId: null, durationMins: 60 }) as unknown as VTask;

const TASKS: VTask[] = [
  task("t1", "p1", "d1", "Draft the team roles"),
  task("t2", "p1", "d1", "Review the roster", "done"),
  task("t3", "p2", "d1", "Interview two leads"),
  task("t4", "p5", "d3", "Check the DNS cutover"),
];

const qEnd = (n: number) => {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + n;
  return iso(new Date(d.getFullYear(), q * 3 + 3, 0));
};
const bet = (id: string, domainId: string, name: string, targetDate: string, keyResults: unknown[], extra: Partial<Initiative> = {}): Initiative =>
  ({ id, domainId, name, outcome: "A clear finish line", description: "", status: "in_progress", momentum: "flat", startDate: null, targetDate, progress: 0, keyResults, sort: 0, ...extra }) as unknown as Initiative;
const kr = (current: number) => [{ id: `k${current}`, name: "Members reached", baseline: 0, current, target: 100, unit: "members", updatedAt: new Date().toISOString() }];

const INITIATIVES: Initiative[] = [
  bet("i1", "d1", "Grow the church to 400", qEnd(0), kr(5), { momentum: "down" } as Partial<Initiative>),
  bet("i2", "d2", "A summer the kids remember", qEnd(1), []),
  bet("i3", "d1", "Staff rigor", qEnd(1), kr(60)),
];

function useStore() {
  const [projects, setProjects] = useState(PROJECTS);
  const [initiatives, setInitiatives] = useState(INITIATIVES);
  const [tasks, setTasks] = useState(TASKS);
  const data: VerticalData = useMemo(
    () => ({ domains: DOMAINS, initiatives, projects, tasks, sprint: null, focusInitiativeIds: [], bigRocks: [], lastActivityByProject: {} }),
    [projects, initiatives, tasks],
  );
  const store = {
    data,
    ready: true,
    updateProject: (id: string, patch: Partial<Project>) => setProjects((s) => s.map((p) => (p.id === id ? { ...p, ...patch } : p))),
    updateInitiative: (id: string, patch: Partial<Initiative>) => setInitiatives((s) => s.map((i) => (i.id === id ? { ...i, ...patch } : i))),
    addKeyResult: (initiativeId: string, init?: Partial<KeyResult>) =>
      setInitiatives((s) =>
        s.map((i) => (i.id === initiativeId ? { ...i, keyResults: [...i.keyResults, { id: `k${Date.now()}`, name: init?.name ?? "New result", baseline: 0, current: 0, target: 100, unit: "", updatedAt: new Date().toISOString() } as KeyResult] } : i)),
      ),
    addProject: async () => PROJECTS[0],
  } as unknown as VerticalStore;
  // the walk's one write, over the fixtures: the kept lines become tasks
  const addTasks: AddPlannedTasks = (project, lines, outcome) => {
    if (outcome) store.updateProject(project.id, { outcome });
    const stamp = Date.now();
    setTasks((ts) => [...ts, ...lines.map((l, i) => ({ ...task(`n${stamp}${i}`, project.id, project.domainId ?? "", l.title), durationMins: l.mins }) as VTask)]);
  };
  return { store, addTasks };
}

/** A stand-in for Draft the path's agent: four lines, two on "fewer", a short
 *  wait so the drafting state is visible. */
const fakeAsk: AskScaffold = (_projectId, guidance) =>
  new Promise<ProposedStep[]>((resolve) => {
    const all: ProposedStep[] = [
      { title: "Call Ana about the first issue", energy: "quick", durationMins: 30 },
      { title: "Draft the first issue", energy: "deep", durationMins: 90 },
      { title: "Collect three family stories", energy: "delegate", durationMins: 45 },
      { title: "Send it to the list", energy: "quick", durationMins: 15 },
    ];
    const g = (guidance ?? "").toLowerCase();
    window.setTimeout(() => resolve(g.includes("fewer") ? all.slice(0, 2) : g.includes("smaller") ? all.map((p) => ({ ...p, title: `${p.title} (part 1)`, durationMins: 15 })) : all), 400);
  });

const FACES = [
  { value: "ondeck", label: "On Deck" },
  { value: "groom", label: "Groom" },
  { value: "all", label: "Table" },
  { value: "shipped", label: "Shipped" },
];

function Frame({ label, bar, children }: { label: string; bar: ReactNode; children: ReactNode }) {
  return (
    <section style={{ display: "grid", gap: 6 }}>
      <div className="text-caption text-muted">{label}</div>
      <div className="app-panel" style={{ height: 620, display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid var(--line-1)", borderRadius: 10 }}>
        {bar}
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </section>
  );
}

export default function DeckHarness() {
  const { store, addTasks } = useStore();
  const plan = new URLSearchParams(window.location.search).get("decks") === "plan";
  const qc = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }), []);
  const bar = (page: string) => <PageBar trail={[page]} tabs={<Tabs label={`${page} views`} value="ondeck" onChange={() => {}} tabs={FACES} />} />;
  return (
    <QueryClientProvider client={qc}>
      <VerticalStoreProvider value={store}>
        <AppNavigationProvider>
          <div className="atmosphere" style={{ minHeight: "100vh", padding: 16, display: "grid", gap: 20 }}>
            <h1 className="text-head">{plan ? "Decks · Plan projects and Plan initiatives (D-216)" : "Decks · the crown, the line and Get ready (D-207)"}</h1>
            <Frame label="Projects · On Deck" bar={bar("Projects")}>
              <OnDeckPlanner startIn={plan ? "plan" : undefined} planDeps={{ ask: fakeAsk, addTasks }} />
            </Frame>
            <Frame label="Initiatives · On Deck" bar={bar("Initiatives")}>
              <InitiativeDeck startIn={plan ? "plan" : undefined} />
            </Frame>
          </div>
        </AppNavigationProvider>
      </VerticalStoreProvider>
    </QueryClientProvider>
  );
}
