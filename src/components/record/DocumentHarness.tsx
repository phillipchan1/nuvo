// Standalone verify harness for the Document and Dialog layouts and the chat
// (D-190) — reached at ?docs, mounted in main.tsx. Not part of any real
// surface. Precedent: DomainHarness (?domains), RailHarness (?rail).
//
// Every surface here runs over fixtures: the record modal (project and
// initiative), the create sheet, Settings at any section, Shortcuts, the ship
// dialog, recurring upkeep, and the chat rail. There is no Supabase in a
// harness, so anything that would write is a local stub or a quiet no-op.

import { useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { VerticalStoreProvider, type VerticalStore } from "../../hooks/useVertical";
import { TaskCaptureSinkContext, type TaskCaptureSink } from "../../hooks/useTaskCapture";
import { AppNavigationProvider } from "../../hooks/useAppNavigation";
import type { Domain, Initiative, Project, VTask, VerticalData } from "../../lib/vertical";
import type { SettingsSection } from "../../lib/appNav";
import type { UserSettings } from "../../lib/types";
import RecordModal from "./RecordModal";
import CreateRecord from "../floors/CreateRecord";
import ShipAssess from "./ShipAssess";
import SettingsModal from "../SettingsModal";
import ShortcutsModal from "../ShortcutsModal";
import RecurringUpkeepPanel from "../RecurringUpkeepPanel";
import AgentSidebar from "../AgentSidebar";
import { Button, Segmented } from "../kit";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });

const iso = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const dom = (o: Partial<Domain> & { id: string; name: string; color: string }): Domain =>
  ({
    icon: "briefcase",
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
  }) as Domain;

const DOMAINS: Domain[] = [
  dom({ id: "d1", name: "Work", color: "#4f5fd6", icon: "briefcase", sort: 0 }),
  dom({ id: "d2", name: "Health", color: "#1e9467", icon: "heart", sort: 1 }),
  dom({ id: "d3", name: "Writing", color: "#c23f72", icon: "pen", sort: 2 }),
];

const INITIATIVES: Initiative[] = [
  {
    id: "i1",
    domainId: "d1",
    name: "Hiring v2",
    outcome: "Two senior engineers start before the quarter closes.",
    description: "",
    status: "in_progress",
    momentum: "up",
    startDate: iso(-30),
    targetDate: iso(45),
    progress: 0,
    keyResults: [
      { id: "k1", name: "Offers accepted", baseline: 0, current: 1, target: 2, unit: "people", updatedAt: new Date().toISOString() },
      { id: "k2", name: "Onsite pass rate", baseline: 20, current: 34, target: 50, unit: "%", updatedAt: new Date().toISOString() },
    ],
    sort: 0,
  } as unknown as Initiative,
];

const PROJECTS: Project[] = [
  {
    id: "p1",
    domainId: "d1",
    initiativeId: "i1",
    keyResultId: null,
    name: "Onboarding flow v2",
    outcome: "New users reach their first planned week in under five minutes.",
    status: "in_progress",
    storedStatus: "in_progress",
    startDate: iso(-3),
    targetDate: iso(4),
    sort: 0,
  } as unknown as Project,
  {
    id: "p2",
    domainId: "d1",
    initiativeId: "i1",
    keyResultId: null,
    name: "Interview loop redesign",
    outcome: "",
    status: "backlog",
    storedStatus: "backlog",
    startDate: null,
    targetDate: null,
    sort: 1,
  } as unknown as Project,
];

const task = (id: string, title: string, o: Partial<VTask> = {}): VTask =>
  ({ id, title, status: "backlog", domainId: "d1", initiativeId: "i1", projectId: "p1", durationMins: 30, sortOrder: 0, ...o }) as unknown as VTask;

const TASKS: VTask[] = [
  task("t1", "Map the empty states", { status: "done", durationMins: 60 }),
  task("t2", "Write the first-run copy", { status: "done", durationMins: 120 }),
  task("t3", "Ship onboarding flow v2", { status: "done" }),
  task("t4", "Instrument the funnel", { durationMins: 60 }),
  task("t5", "Review with Priya", { durationMins: 30 }),
  task("t6", "Book the dentist", { projectId: null, initiativeId: null, domainId: "d1" }),
];

// The record's list reads the task rows themselves from the ["tasks","all"]
// cache (the vertical carries only VTasks), so the harness seeds that cache.
queryClient.setQueryData(
  ["tasks", "all"],
  TASKS.map((t, i) => ({
    id: t.id,
    title: t.title,
    status: t.status === "done" ? "done" : "backlog",
    duration_minutes: (t as unknown as { durationMins: number }).durationMins,
    start_time: null,
    do_date: i === 3 ? iso(1) : null,
    slot_id: null,
    project_id: (t as unknown as { projectId: string | null }).projectId,
    initiative_id: null,
    domain_id: "d1",
    recurrence_id: null,
    recurrence_overridden: false,
    roll_count: 0,
    priority: "none",
    sort_order: i,
    completed_at: t.status === "done" ? new Date().toISOString() : null,
  })),
);

function useHarnessStore(): VerticalStore {
  const [domains] = useState(DOMAINS);
  const [initiatives, setInitiatives] = useState(INITIATIVES);
  const [projects, setProjects] = useState(PROJECTS);
  const [tasks, setTasks] = useState(TASKS);
  const data: VerticalData = useMemo(
    () => ({ domains, initiatives, projects, tasks, sprint: null, focusInitiativeIds: [], bigRocks: [], lastActivityByProject: {} }) as unknown as VerticalData,
    [domains, initiatives, projects, tasks],
  );
  const store = {
    data,
    ready: true,
    updateProject: (id: string, patch: Partial<Project>) =>
      setProjects((s) => s.map((p) => (p.id === id ? ({ ...p, ...patch, storedStatus: patch.status ?? p.storedStatus } as Project) : p))),
    updateInitiative: (id: string, patch: Partial<Initiative>) => setInitiatives((s) => s.map((i) => (i.id === id ? { ...i, ...patch } : i))),
    addProject: async (domainId: string, initiativeId: string | null, init?: Partial<Project>) => {
      const p = { ...PROJECTS[1], id: `p${Date.now()}`, domainId, initiativeId, name: init?.name ?? "New project", ...init } as Project;
      setProjects((s) => [...s, p]);
      return p;
    },
    addInitiative: async (domainId: string, init?: Partial<Initiative>) => {
      const i = { ...INITIATIVES[0], id: `i${Date.now()}`, domainId, keyResults: [], ...init } as Initiative;
      setInitiatives((s) => [...s, i]);
      return i;
    },
    addKeyResult: (id: string) =>
      setInitiatives((s) =>
        s.map((i) =>
          i.id === id
            ? { ...i, keyResults: [...i.keyResults, { id: `k${Date.now()}`, name: "", baseline: 0, current: 0, target: 1, unit: "", updatedAt: new Date().toISOString() }] }
            : i,
        ),
      ),
    updateKeyResult: (id: string, krId: string, patch: Record<string, unknown>) =>
      setInitiatives((s) => s.map((i) => (i.id === id ? { ...i, keyResults: i.keyResults.map((k) => (k.id === krId ? { ...k, ...patch } : k)) } : i))),
    deleteKeyResult: (id: string, krId: string) =>
      setInitiatives((s) => s.map((i) => (i.id === id ? { ...i, keyResults: i.keyResults.filter((k) => k.id !== krId) } : i))),
    toggleTask: (id: string) => setTasks((s) => s.map((t) => (t.id === id ? ({ ...t, status: t.status === "done" ? "backlog" : "done" } as VTask) : t))),
    deleteTask: (id: string) => setTasks((s) => s.filter((t) => t.id !== id)),
    updateTask: (id: string, patch: Partial<VTask>) => setTasks((s) => s.map((t) => (t.id === id ? ({ ...t, ...patch } as VTask) : t))),
    routeTask: () => undefined,
    reorderProjects: () => undefined,
    deleteProject: (id: string) => setProjects((s) => s.filter((p) => p.id !== id)),
    deleteInitiative: (id: string) => setInitiatives((s) => s.filter((i) => i.id !== id)),
    addDomain: async () => DOMAINS[0],
    addTask: (parent: { projectId?: string | null }, patch?: { title?: string; durationMins?: number }) =>
      setTasks((s) => [...s, task(`t${Date.now()}`, patch?.title ?? "Untitled", { projectId: parent.projectId ?? null, durationMins: patch?.durationMins ?? 30 })]),
  };
  // Everything else the interface declares is unreachable from these surfaces.
  return store as unknown as VerticalStore;
}

function harnessSink(store: VerticalStore): TaskCaptureSink {
  const fx = store as unknown as { addTask: (p: { projectId?: string | null }, patch: { title: string; durationMins?: number }) => void };
  return {
    create: async (input) => fx.addTask({ projectId: input.project_id }, { title: input.title, durationMins: input.duration_minutes ?? undefined }),
    createSeries: async () => undefined,
  };
}



type Mode = "project" | "initiative" | "new-project" | "new-initiative" | "settings" | "shortcuts" | "ship" | "upkeep" | "nuvo";

const SECTIONS: SettingsSection[] = ["appearance", "schedule", "reminders", "connections", "inbound", "apps", "labels", "account", "billing", "about"] as SettingsSection[];


export default function DocumentHarness() {
  const store = useHarnessStore();
  const sink = useMemo(() => harnessSink(store), [store]);
  const params = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState<Mode>((params.get("docs") as Mode) || "project");
  const [section, setSection] = useState<SettingsSection>((params.get("section") as SettingsSection) || "appearance");
  const [dark, setDark] = useState(document.documentElement.getAttribute("data-theme") === "dark");
  const [settings, setSettings] = useState<UserSettings>({
    theme: "system",
    hidden_events: [{ key: "acc:series:abc", title: "Weekly 1:1" }],
  } as unknown as UserSettings);

  const close = () => setMode("project");
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
  };

  return (
    <QueryClientProvider client={queryClient}>
      <AppNavigationProvider>
        <TaskCaptureSinkContext.Provider value={sink}>
          <VerticalStoreProvider value={store}>
            <div className="app-ground min-h-screen">
              <div className="flex flex-wrap items-center gap-2 p-3">
                <div className="max-w-full overflow-x-auto">
                <Segmented
                  label="Surface"
                  size="sm"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "project", label: "Project" },
                    { value: "initiative", label: "Initiative" },
                    { value: "new-project", label: "New project" },
                    { value: "new-initiative", label: "New bet" },
                    { value: "settings", label: "Settings" },
                    { value: "shortcuts", label: "Shortcuts" },
                    { value: "ship", label: "Ship" },
                    { value: "upkeep", label: "Upkeep" },
                    { value: "nuvo", label: "Nuvo panel" },
                  ]}
                />
                </div>
                {mode === "settings" && (
                  <select value={section} onChange={(e) => setSection(e.target.value as SettingsSection)} className="k-field !h-7 !w-auto text-caption">
                    {SECTIONS.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                )}
                <Button size="xs" onClick={toggleTheme}>
                  {dark ? "Light" : "Dark"}
                </Button>
              </div>

              {mode === "nuvo" && (
                <div className="flex h-[calc(100vh-64px)] app-ground">
                  <div className="app-panel !m-2 flex-1" data-land="page" />
                  <div className="app-chat-slot" style={{ width: 380 }}>
                    <AgentSidebar open onToggle={() => setMode("project")} />
                  </div>
                </div>
              )}
              {mode === "project" && <RecordModal kind="project" id="p1" onClose={close} onOpenProject={() => setMode("project")} onOpenInitiative={() => setMode("initiative")} />}
              {mode === "initiative" && <RecordModal kind="initiative" id="i1" onClose={close} onOpenProject={() => setMode("project")} onOpenInitiative={() => setMode("initiative")} />}
              {mode === "new-project" && <CreateRecord kind="project" initialDomainId="d1" onClose={close} onCreated={close} />}
              {mode === "new-initiative" && <CreateRecord kind="initiative" initialDomainId="d1" onClose={close} onCreated={close} />}
              {mode === "settings" && (
                <SettingsModal
                  settings={settings}
                  updateSettings={(p) => setSettings((s) => ({ ...s, ...p }))}
                  accounts={[
                    {
                      id: "acc1",
                      provider: "google",
                      email: "you@gmail.com",
                      sync_direction: "two_way",
                      mirror_calendar_id: "m1",
                      needs_reconnect: false,
                      calendars: [
                        { id: "primary", summary: "you@gmail.com", color: "#4f5fd6" },
                        { id: "fam", summary: "Family", color: "#1e9467" },
                        { id: "hol", summary: "Holidays", color: "#c0841a" },
                      ],
                    },
                  ] as never}
                  section={section}
                  onClose={close}
                />
              )}
              {mode === "shortcuts" && <ShortcutsModal onClose={close} />}
              {mode === "upkeep" && <RecurringUpkeepPanel onClose={close} />}
              {mode === "ship" && (
                <ShipAssess
                  name="Onboarding flow v2"
                  outcome="New users reach their first planned week in under five minutes."
                  accent="#4f5fd6"
                  done={3}
                  total={5}
                  openTasks={TASKS.slice(3, 5)}
                  onCancel={close}
                  onShip={close}
                />
              )}
            </div>
            <Toaster />
          </VerticalStoreProvider>
        </TaskCaptureSinkContext.Provider>
      </AppNavigationProvider>
    </QueryClientProvider>
  );
}
