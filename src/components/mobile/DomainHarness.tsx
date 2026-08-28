// Standalone verify harness for the Domains tab — the wall (MobileDomains) and
// the open domain (detail/MobileDomainScreen) over fixture data at phone width,
// so both can be eyeballed and *driven* (rename, retarget, pick a sigil form,
// change the domain's light, park a task) without a real account. Reached at
// ?domains, mounted in main.tsx. Not part of any real surface. Precedent:
// CalendarHarness (?horizon), PlanWeekHarness (?planweek).
//
// The fixtures deliberately cover the states the wall has to tell apart: a
// tended domain over its intent, one that's gone quiet, one never touched, and
// one with a drifting bet in it.

import { useMemo, useState } from "react";
import { VerticalStoreProvider, type VerticalStore } from "../../hooks/useVertical";
import type { Domain, Initiative, Project, VTask, VerticalData } from "../../lib/vertical";
import { todayISO } from "../../lib/dates";
import MobileDomains from "./MobileDomains";
import MobileDomainScreen from "./detail/MobileDomainScreen";
// The open domain as the app actually mounts it — inside the bottom Sheet, whose
// swipe-to-dismiss shares the touch stream with the content's scroll. A frame
// that renders the screen in a plain scroller cannot catch a scroll bug here.
import MobileDetailSheet from "./detail/MobileDetailSheet";
// The desktop floor over the same fixtures, beside the phone — the two shells
// share `lib/domainRead.ts` and `components/domain/DomainParts.tsx`, so this is
// where a divergence would show up as a difference you can see.
import DomainFloor from "../floors/DomainFloor";

// ── fixtures ─────────────────────────────────────────────────────────────────
const pulse = (...w: number[]) => {
  const out = new Array(13).fill(0) as number[];
  w.slice(-13).forEach((h, i) => (out[13 - Math.min(13, w.length) + i] = h));
  return out;
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
  dom({
    id: "d1",
    name: "SCE",
    color: "#2563EB",
    icon: "🏢",
    sort: 0,
    intention: "Lead the Enterprise rollout without letting it eat the family.",
    charter: "My day job at SCE — Obi, the Enterprise rollout, Super Leader.",
    context: { scope: "The day job.", entities: ["Obi", "Enterprise rollout"], keywords: ["standup", "roadmap"], boundary: "Not side projects.", exemplars: [] },
    weeklyTargetHours: 20,
    investedThisWeek: 23.5,
    meetingHoursThisWeek: 13,
    quarterHours: 214,
    lastTouchedDays: 0,
    weeks: pulse(18, 21, 19, 24, 22, 17, 20, 23, 19, 21, 22, 20, 23.5),
    days: [7, 6.5, 5, 4, 1, 0, 0],
  }),
  dom({
    id: "d2",
    name: "Family",
    color: "#DB2777",
    icon: "🏡",
    sort: 1,
    intention: "Be present, not merely around.",
    charter: "",
    weeklyTargetHours: 10,
    investedThisWeek: 4,
    meetingHoursThisWeek: 0,
    quarterHours: 61,
    lastTouchedDays: 1,
    weeks: pulse(9, 8, 6, 0, 0, 7, 5, 9, 4, 6, 8, 5, 4),
    days: [1, 0, 1.5, 1.5, 0, 0, 0],
  }),
  dom({
    id: "d3",
    name: "Health",
    color: "#0D9488",
    icon: "🏃",
    sort: 2,
    intention: "Strong at 50.",
    weeklyTargetHours: 4,
    quarterHours: 12,
    lastTouchedDays: 23,
    weeks: pulse(3, 2, 4, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0),
  }),
  dom({ id: "d4", name: "Writing", color: "#D97706", icon: "✍️", sort: 3 }),
  // ── the three states the ship-aware ledger added (D-087) ──────────────────
  // d5 reproduces the reported bug exactly: a major project shipped 2 days ago,
  // the last task under it checked off 7 days ago, zero hours this week. Before
  // the fix this read "Quiet for 7 days — when did you last show up here?".
  dom({
    id: "d5",
    name: "Stampede",
    color: "#7C3AED",
    icon: "🐎",
    sort: 4,
    intention: "Ship the thing, then let it breathe.",
    quarterHours: 88,
    lastTouchedDays: 7,
    lastShip: { name: "Stampede rebrand", daysAgo: 2 },
    weeks: pulse(6, 9, 7, 11, 8, 6, 10, 12, 9, 7, 11, 8, 0),
  }),
  // d6 — the same domain a month on: the glow has passed, but the last thing
  // that happened here was still a FINISH, not a drift
  dom({
    id: "d6",
    name: "Sabbatical",
    color: "#0891B2",
    icon: "⛵",
    sort: 5,
    intention: "Rest is part of the work.",
    quarterHours: 40,
    lastTouchedDays: 30,
    lastShip: { name: "The book proposal", daysAgo: 30 },
    weeks: pulse(5, 6, 4, 7, 5, 0, 0, 0, 0, 0, 0, 0, 0),
  }),
  // d7 — genuinely dark for four months. Under the old 99 sentinel this claimed
  // "no time has been kept here yet", which was false: it has real history.
  dom({
    id: "d7",
    name: "Woodworking",
    color: "#B45309",
    icon: "🪵",
    sort: 6,
    intention: "Make one thing a season with my hands.",
    quarterHours: 0,
    lastTouchedDays: 120,
    weeks: new Array(13).fill(0),
  }),
];

const INITIATIVES: Initiative[] = [
  {
    id: "i1",
    domainId: "d1",
    name: "Ship Enterprise v2",
    outcome: "Every enterprise tenant migrated off the legacy plan.",
    description: "",
    status: "in_progress",
    momentum: "up",
    startDate: null,
    targetDate: todayISO(new Date()),
    progress: 0,
    keyResults: [
      { id: "k1", name: "Tenants migrated", baseline: 0, current: 34, target: 80, unit: "tenants", updatedAt: new Date().toISOString() },
    ],
    sort: 0,
  } as unknown as Initiative,
  {
    id: "i2",
    domainId: "d1",
    name: "Super Leader cohort",
    outcome: "Run the cohort end to end.",
    description: "",
    status: "in_progress",
    momentum: "down",
    startDate: null,
    targetDate: "2026-01-15",
    progress: 40,
    keyResults: [],
    sort: 1,
  } as unknown as Initiative,
  {
    id: "i3",
    domainId: "d2",
    name: "Summer with the kids",
    outcome: "A summer they remember.",
    description: "",
    status: "in_progress",
    momentum: "flat",
    startDate: null,
    targetDate: null,
    progress: 15,
    keyResults: [],
    sort: 0,
  } as unknown as Initiative,
];

const PROJECTS: Project[] = [
  {
    id: "p1", domainId: "d1", initiativeId: null, keyResultId: null,
    name: "Retire the legacy billing job", outcome: "", status: "in_progress",
    startDate: null, targetDate: null, sort: 0,
  } as unknown as Project,
  {
    id: "p2", domainId: "d2", initiativeId: null, keyResultId: null,
    name: "Fix the back fence", outcome: "", status: "waiting",
    startDate: null, targetDate: null, sort: 1,
  } as unknown as Project,
  // d5 ("Stampede") has shipped everything and has nothing open — the case that
  // used to print the same rows in BOTH "what you've built" and "what you're
  // building toward" (D-088's sibling fix), and now has to land on its own
  // empty state rather than the never-started one.
  {
    id: "p3", domainId: "d5", initiativeId: null, keyResultId: null,
    name: "Stampede v3", outcome: "", status: "complete",
    shippedAt: "2026-07-30", startDate: null, targetDate: null, sort: 2,
  } as unknown as Project,
  {
    id: "p4", domainId: "d5", initiativeId: null, keyResultId: null,
    name: "Stampede marketing website", outcome: "", status: "complete",
    shippedAt: "2026-07-24", startDate: null, targetDate: null, sort: 3,
  } as unknown as Project,
];

const TASKS: VTask[] = [
  { id: "t1", title: "Call the pediatrician", status: "backlog", domainId: "d2", initiativeId: null, projectId: null, durationMins: 15 } as unknown as VTask,
  { id: "t2", title: "Renew the gym membership", status: "backlog", domainId: "d3", initiativeId: null, projectId: null, durationMins: 10 } as unknown as VTask,
];

// ── a live-enough store: the writes the domain surfaces actually make ─────────
function useHarnessStore(): VerticalStore {
  const [domains, setDomains] = useState(DOMAINS);
  const [initiatives, setInitiatives] = useState(INITIATIVES);
  const [projects, setProjects] = useState(PROJECTS);
  const [tasks, setTasks] = useState(TASKS);
  let seq = 0;

  const data: VerticalData = useMemo(
    () => ({ domains, initiatives, projects, tasks, sprint: null, focusInitiativeIds: [], bigRocks: [], lastActivityByProject: {} }),
    [domains, initiatives, projects, tasks],
  );

  const store = {
    data,
    ready: true,
    addDomain: async () => {
      const d = dom({ id: `d${Date.now()}`, name: "New domain", color: "#7C3AED", sort: domains.length });
      setDomains((s) => [...s, d]);
      return d;
    },
    updateDomain: (id: string, patch: Partial<Domain>) =>
      setDomains((s) => s.map((d) => (d.id === id ? { ...d, ...patch } : d))),
    deleteDomain: (id: string) => setDomains((s) => s.filter((d) => d.id !== id)),
    addInitiative: async (domainId: string) => {
      const i = { ...INITIATIVES[2], id: `i${++seq}${Date.now()}`, domainId, name: "New initiative" } as Initiative;
      setInitiatives((s) => [...s, i]);
      return i;
    },
    updateInitiative: (id: string, patch: Partial<Initiative>) =>
      setInitiatives((s) => s.map((i) => (i.id === id ? { ...i, ...patch } : i))),
    addProject: async (domainId: string) => {
      const p = { ...PROJECTS[0], id: `p${++seq}${Date.now()}`, domainId, name: "New project" } as Project;
      setProjects((s) => [...s, p]);
      return p;
    },
    updateProject: (id: string, patch: Partial<Project>) =>
      setProjects((s) => s.map((p) => (p.id === id ? { ...p, ...patch } : p))),
    addTask: (parent: { domainId?: string | null }, patch?: { title?: string; durationMins?: number }) =>
      setTasks((s) => [
        ...s,
        { id: `t${Date.now()}`, title: patch?.title ?? "Untitled", status: "backlog", domainId: parent.domainId ?? null, initiativeId: null, projectId: null, durationMins: patch?.durationMins ?? null } as unknown as VTask,
      ]),
    toggleTask: (id: string) =>
      setTasks((s) => s.map((t) => (t.id === id ? ({ ...t, status: t.status === "done" ? "backlog" : "done" } as VTask) : t))),
    deleteTask: (id: string) => {
      setTasks((s) => s.filter((t) => t.id !== id));
      return undefined;
    },
    routeTask: (id: string, dest: { domainId?: string | null }) =>
      setTasks((s) => s.map((t) => (t.id === id ? ({ ...t, domainId: dest.domainId ?? null } as VTask) : t))),
  };

  // Everything else the interface declares is unreachable from these two
  // surfaces; a harness that stubbed all forty would be noise.
  return store as unknown as VerticalStore;
}

// ── the harness ──────────────────────────────────────────────────────────────
function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ width: 375 }} className="shrink-0">
      <div className="section-label px-3 py-2">{label}</div>
      <div className="atmosphere overflow-y-auto border border-line" style={{ height: 780 }}>
        {children}
      </div>
    </div>
  );
}

export default function DomainHarness() {
  const store = useHarnessStore();
  const [openId, setOpenId] = useState<string>("d1");
  const [deskId, setDeskId] = useState<string>("");
  const [sheet, setSheet] = useState(false);

  return (
    <VerticalStoreProvider value={store}>
      <div className="atmosphere min-h-screen p-4">
        <div className="mb-3 flex items-center gap-3">
          <h1 className="masthead text-head">Domains on the phone (fixtures)</h1>
          <button
            className="rounded-full border border-line px-3 py-1 text-label text-muted"
            onClick={() => {
              const el = document.documentElement;
              el.dataset.theme = el.dataset.theme === "dark" ? "light" : "dark";
            }}
          >
            theme
          </button>
          <span className="text-meta text-muted">open: {openId}</span>
          <button
            className="rounded-full border border-line px-3 py-1 text-label text-muted"
            onClick={() => setSheet((s) => !s)}
          >
            {sheet ? "close sheet" : "open in Sheet"}
          </button>
        </div>
        <div className="flex gap-4 overflow-x-auto">
          <Frame label="the wall">
            <MobileDomains onOpenItem={(_k, id) => setOpenId(id)} />
          </Frame>
          <Frame label={`open domain · ${openId}`}>
            <div className="pb-8">
              <MobileDomainScreen
                key={openId}
                d={store.data}
                store={store}
                id={openId}
                onOpenInitiative={() => {}}
                onOpenProject={() => {}}
              />
            </div>
          </Frame>
          <Frame label="open domain · never touched">
            <div className="pb-8">
              <MobileDomainScreen d={store.data} store={store} id="d4" onOpenInitiative={() => {}} onOpenProject={() => {}} />
            </div>
          </Frame>

          {/* the desktop floor, same fixtures — wall then open domain */}
          <div style={{ width: 1180 }} className="shrink-0">
            <div className="section-label px-3 py-2">desktop floor</div>
            <div className="atmosphere overflow-y-auto border border-line p-6" style={{ height: 780 }}>
              <DomainFloor
                focus={{ domainId: deskId, initiativeId: "", projectId: "" }}
                onSwitchDomain={setDeskId}
                onExitDomain={() => setDeskId("")}
                onOpenInitiative={() => {}}
                onOpenProject={() => {}}
              />
            </div>
          </div>
        </div>
      </div>

      {/* The real mount: the shared bottom Sheet, portalled over everything. */}
      {sheet && (
        <MobileDetailSheet target={{ kind: "domain", id: openId, n: 1 }} onClose={() => setSheet(false)} />
      )}
    </VerticalStoreProvider>
  );
}
