// Standalone verify harness for D-196 — the just-in-time thin-path mark and Draft
// the projects — over a stranger's fixtures, with the agent stubbed in the page.
// Reached at ?drafts (desktop decks) or ?drafts=initiatives · projects (one phone
// face at the viewport's own width). Not part of any real surface; nothing here
// is written anywhere. Precedent: BuildFacesHarness (?build), DocumentHarness.
//
// The fixtures are deliberately not the builder's life (P16): a ceramicist opening
// a studio. One project has a 3h sitting tomorrow holding a 20m step (the mark);
// one far-out project has no steps (its word goes quiet); one bet next quarter has
// an outcome and no projects (the ✦ door).

import { useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { addDays, endOfQuarter, startOfQuarter, addQuarters } from "date-fns";
import { VerticalStoreProvider, type VerticalStore } from "../../hooks/useVertical";
import { AppNavigationProvider, useAppNavigation } from "../../hooks/useAppNavigation";
import { TaskCaptureSinkContext, type TaskCaptureSink } from "../../hooks/useTaskCapture";
import { supabase } from "../../lib/supabase";
import { slotsKey } from "../../hooks/useSlots";
import { thinWindow } from "../../hooks/useThinPaths";
import { toDateISO } from "../../lib/dates";
import type { Slot } from "../../lib/types";
import type { Domain, Initiative, Project, VTask, VerticalData } from "../../lib/vertical";
import InitiativeDeck from "./InitiativeDeck";
import OnDeckPlanner from "./OnDeckPlanner";
import RecordModal from "../record/RecordModal";
import MobileInitiatives from "../mobile/MobileInitiatives";
import MobileProjects from "../mobile/MobileProjects";
import { PhoneNav, PhoneTopBar, type Place } from "../mobile/ShellChrome";
import { Button, Segmented } from "../kit";

const iso = (days: number) => toDateISO(addDays(new Date(), days));
const at = (days: number, hour: number) => {
  const d = addDays(new Date(), days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const dom = (o: Partial<Domain> & { id: string; name: string; color: string }): Domain =>
  ({ icon: "diamond", intention: "", charter: "", context: null, weeklyTargetHours: 0, investedThisWeek: 0, meetingHoursThisWeek: 0, quarterHours: 0, lastTouchedDays: null, lastShip: null, weeks: new Array(13).fill(0), days: new Array(7).fill(0), sort: 0, ...o }) as Domain;

const DOMAINS: Domain[] = [
  dom({ id: "d1", name: "Studio", color: "#0E7C86", sort: 0 }),
  dom({ id: "d2", name: "Writing", color: "#3B5BB5", sort: 1 }),
  dom({ id: "d3", name: "Home", color: "#A35D12", sort: 2 }),
];

const nextQ = addQuarters(startOfQuarter(new Date()), 1);
const INITIATIVES: Initiative[] = [
  {
    id: "i1", domainId: "d1", name: "Open the studio to clients", outcome: "Ten paying commissions booked by the end of the quarter.",
    description: "", status: "backlog", momentum: "flat", startDate: null, targetDate: toDateISO(addDays(endOfQuarter(nextQ), -6)), sort: 0, keyResults: [],
  } as unknown as Initiative,
  {
    id: "i2", domainId: "d2", name: "Finish the novel draft", outcome: "All 24 chapters in a first draft.",
    description: "", status: "in_progress", momentum: "up", startDate: iso(-40), targetDate: iso(30), sort: 1, keyResults: [],
  } as unknown as Initiative,
];

const PROJECTS: Project[] = [
  { id: "p1", domainId: "d1", initiativeId: null, name: "Launch site", outcome: "Studio site live, with booking and three case studies.", description: "", status: "in_progress", startDate: iso(0), targetDate: iso(6), sort: 0 } as unknown as Project,
  { id: "p2", domainId: "d2", initiativeId: "i2", name: "Chapter 3", outcome: "A first draft of chapter 3.", description: "", status: "in_progress", startDate: iso(0), targetDate: iso(13), sort: 1 } as unknown as Project,
  { id: "p3", domainId: "d3", initiativeId: null, name: "Kitchen refit", outcome: "", description: "", status: "backlog", startDate: iso(7), targetDate: iso(20), sort: 2 } as unknown as Project,
  { id: "p4", domainId: "d1", initiativeId: null, name: "Portfolio prints", outcome: "", description: "", status: "backlog", startDate: iso(21), targetDate: iso(27), sort: 3 } as unknown as Project,
].map((p) => ({ ...p, keyResultId: null, storedStatus: p.status, shippedAt: null }));

const TASKS: VTask[] = [
  { id: "t1", title: "Write homepage copy", status: "ready", domainId: "d1", initiativeId: null, projectId: "p1", durationMins: 20 },
  { id: "t2", title: "Outline the chapter", status: "ready", domainId: "d2", initiativeId: "i2", projectId: "p2", durationMins: 60 },
  { id: "t3", title: "Write scene one", status: "ready", domainId: "d2", initiativeId: "i2", projectId: "p2", durationMins: 120 },
] as unknown as VTask[];

/** Launch site's sitting: tomorrow 1–4pm, holding one 20m step. */
const SLOTS: Slot[] = [
  { id: "s1", user_id: "u", created_at: "", updated_at: "", title: "Launch site", do_date: iso(1), start_time: at(1, 13), duration_minutes: 180, project_id: "p1", domain_id: "d1", color: null, google_event_id: null, recurrence_id: null, recurrence_date: null, recurrence_overridden: false },
  { id: "s2", user_id: "u", created_at: "", updated_at: "", title: "Chapter 3", do_date: iso(2), start_time: at(2, 9), duration_minutes: 150, project_id: "p2", domain_id: "d2", color: null, google_event_id: null, recurrence_id: null, recurrence_date: null, recurrence_overridden: false },
];

// ── the agent, stubbed: what a good answer looks like, after a beat ─────────
const PROPOSALS = [
  { name: "Portfolio site", outcome: "Site live with three case studies and booking", why: "Clients look before they book", start_week: 2, weeks: 4,
    alternatives: [
      { name: "One-page site", outcome: "One page with prices and a booking link", why: "The smallest thing a client books from", start_week: 2, weeks: 2 },
      { name: "Portfolio on Instagram", outcome: "Twelve pieces posted; the link in bio books a call", why: "Where your clients already look", start_week: 2, weeks: 3 },
    ] },
  { name: "Booking and deposits", outcome: "A client can book and pay a deposit without emailing", why: "Ten bookings by hand is ten threads", start_week: 4, weeks: 3,
    alternatives: [{ name: "Deposit by invoice", outcome: "Every booking gets a deposit invoice the same day", why: "Deposits without new software", start_week: 4, weeks: 2 }] },
  { name: "Ask past clients for referrals", outcome: "Twenty past clients asked, five introductions", why: "The fastest route to commissions", start_week: 5, weeks: 3, alternatives: [] },
  { name: "Studio open day", outcome: "One Saturday open studio, thirty people through", why: "Turns the site's traffic into visits", start_week: 9, weeks: 2,
    alternatives: [{ name: "Two maker markets", outcome: "A stall at two markets with a booking sheet", why: "Meets buyers who don't know you", start_week: 8, weeks: 3 }] },
  { name: "Follow up every lead", outcome: "Every enquiry answered within a day", why: "The last bookings come from follow-up", start_week: 10, weeks: 4, alternatives: [] },
];
const STEPS = [
  { title: "Pick the template and type", energy: "decide", duration_minutes: 30, rationale: "Everything after this waits on it", after: "START" },
  { title: "Photograph three finished pieces", energy: "deep", duration_minutes: 45, rationale: "The case studies need pictures", after: "Write homepage copy" },
  { title: "Write the three case studies", energy: "deep", duration_minutes: 60, rationale: "The outcome names three" },
  { title: "Connect the booking calendar", energy: "quick", duration_minutes: 30, rationale: "The outcome says booking" },
];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// `supabase.functions` is a fresh client on every read, so the stub goes on its
// prototype — every invoke in this page (and only this page) answers from here.
type Invoke = (this: unknown, name: string, opts?: { body?: Record<string, { guidance?: string } | undefined> }) => Promise<unknown>;
const proto = Object.getPrototypeOf(supabase.functions) as { invoke: Invoke };
const realInvoke = proto.invoke;
proto.invoke = async function (this: unknown, name, opts) {
  const b = opts?.body ?? {};
  if (b.draftProjects) {
    await wait(900);
    const g = (b.draftProjects.guidance ?? "").toLowerCase();
    let list = PROPOSALS;
    if (g.includes("fewer")) list = [PROPOSALS[0], PROPOSALS[1], PROPOSALS[3]];
    else if (g.includes("later")) list = PROPOSALS.map((p) => ({ ...p, start_week: p.start_week + 2 }));
    return { data: { projects: list }, error: null };
  }
  if (b.scaffold) {
    await wait(700);
    return { data: { tasks: STEPS }, error: null };
  }
  return realInvoke.call(this, name, opts);
};

// ── a live-enough store ─────────────────────────────────────────────────────
function useHarnessStore(): VerticalStore {
  const [initiatives, setInitiatives] = useState(INITIATIVES);
  const [projects, setProjects] = useState(PROJECTS);
  const [tasks] = useState(TASKS);
  const data: VerticalData = useMemo(
    () => ({ domains: DOMAINS, initiatives, projects, tasks, sprint: null, focusInitiativeIds: [], bigRocks: [], lastActivityByProject: {} }) as unknown as VerticalData,
    [initiatives, projects, tasks],
  );
  return {
    data,
    ready: true,
    addProject: async (domainId: string, initiativeId: string | null, init?: Partial<Project>) => {
      const p = { id: `p${Date.now()}${Math.random().toString(36).slice(2, 5)}`, domainId, initiativeId, keyResultId: null, name: init?.name ?? "New project", outcome: init?.outcome ?? "", description: "", status: init?.status ?? "backlog", storedStatus: init?.status ?? "backlog", startDate: init?.startDate ?? null, targetDate: init?.targetDate ?? null, shippedAt: null, sort: Date.now() } as unknown as Project;
      setProjects((s) => [...s, p]);
      return p;
    },
    updateProject: (id: string, patch: Partial<Project>) => setProjects((s) => s.map((p) => (p.id === id ? { ...p, ...patch } : p))),
    deleteProject: (id: string) => setProjects((s) => s.filter((p) => p.id !== id)),
    updateInitiative: (id: string, patch: Partial<Initiative>) => setInitiatives((s) => s.map((i) => (i.id === id ? { ...i, ...patch } : i))),
  } as unknown as VerticalStore;
}

const sink: TaskCaptureSink = { create: async () => undefined, createSeries: async () => undefined } as unknown as TaskCaptureSink;

const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
{
  const w = thinWindow();
  qc.setQueryData(slotsKey(w.start, w.end), SLOTS);
}

function toggleTheme() {
  const el = document.documentElement;
  el.dataset.theme = el.dataset.theme === "dark" ? "light" : "dark";
}

/** The record the thin mark opens — mounted the way AppShell mounts it. */
function Record() {
  const { nav, closeOverlay, openRecord } = useAppNavigation();
  if (nav.overlay !== "project-record" || !nav.overlayId) return null;
  return <RecordModal kind="project" id={nav.overlayId} onClose={closeOverlay} onOpenProject={(id) => openRecord("project", id)} onOpenInitiative={(id) => openRecord("initiative", id)} />;
}

function Desktop() {
  const [deck, setDeck] = useState<"initiatives" | "projects">("initiatives");
  return (
    <div className="app-ground flex min-h-screen flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Deck" size="sm" value={deck} onChange={setDeck} options={[{ value: "initiatives", label: "Initiatives" }, { value: "projects", label: "Projects" }]} />
        <Button size="xs" onClick={toggleTheme}>
          Theme
        </Button>
        <span className="text-caption text-muted">Phone: ?drafts=initiatives · ?drafts=projects</span>
      </div>
      <div className="app-panel relative flex min-h-0 flex-col overflow-hidden" style={{ height: 760 }}>
        {deck === "initiatives" ? <InitiativeDeck /> : <OnDeckPlanner />}
      </div>
      <Record />
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

function Phone({ face }: { face: "initiatives" | "projects" }) {
  return (
    <div className="atmosphere fixed inset-0 flex flex-col">
      <PhoneTopBar title={face === "projects" ? "Projects" : "Initiatives"} fact="" onSearch={() => {}} onToggleTheme={toggleTheme} onSettings={() => {}} />
      <main className="mobile-scroll relative min-h-0 flex-1 overflow-y-auto">
        {face === "projects" ? <MobileProjects onOpenItem={() => {}} /> : <MobileInitiatives onOpenItem={() => {}} />}
      </main>
      <PhoneNav places={PLACES} current={face} onPick={() => {}} onCapture={() => {}} onAskNuvo={() => {}} />
    </div>
  );
}

export default function DraftsHarness() {
  const store = useHarnessStore();
  const face = new URLSearchParams(window.location.search).get("drafts");
  return (
    <QueryClientProvider client={qc}>
      <AppNavigationProvider>
        <TaskCaptureSinkContext.Provider value={sink}>
          <VerticalStoreProvider value={store}>
            {face === "initiatives" || face === "projects" ? <Phone face={face} /> : <Desktop />}
          </VerticalStoreProvider>
        </TaskCaptureSinkContext.Provider>
      </AppNavigationProvider>
    </QueryClientProvider>
  );
}
