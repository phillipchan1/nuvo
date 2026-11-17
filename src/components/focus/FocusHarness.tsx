// Standalone verify harness for Focus (D-242) — the REAL `LeftRail` over
// fixture tasks, so ⌘., the picker, ticking and the finish can be driven with a
// real pointer and nothing is written anywhere. Reached at ?focus.
//
//   ?focus        a block is on the clock now ("Morning Focus", three tasks),
//                 a meeting right after it, more work later
//   ?focus=idle   nothing on the clock — ⌘. opens the picker
//
// Writes are local state. Precedent: GatherHarness (?gather=rail).

import { useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LeftRail, { type RailTab } from "../LeftRail";
import { AppNavigationProvider } from "../../hooks/useAppNavigation";
import { useTrackedRef } from "../../hooks/useTrackedRef";
import { VerticalStoreProvider, type VerticalStore } from "../../hooks/useVertical";
import { toDateISO } from "../../lib/dates";
import type { ExternalEvent, Slot, Task } from "../../lib/types";
import type { VerticalData } from "../../lib/vertical";
import type { useTaskMutations } from "../../hooks/useTasks";
import { useFocus } from "../../hooks/useFocus";
import { toBusyBlocks } from "../../lib/now";
import FocusPill from "./FocusPill";

const IDLE = new URLSearchParams(window.location.search).get("focus") === "idle";
const NOW = new Date();
const ISO = toDateISO(NOW);
// the block started 20 minutes ago (idle: it starts in three hours)
const BLOCK_START = new Date(Math.floor(NOW.getTime() / 300_000) * 300_000 + (IDLE ? 180 : -20) * 60_000);
const plus = (mins: number) => new Date(BLOCK_START.getTime() + mins * 60_000);

let seq = 0;
const task = (title: string, o: Partial<Task> = {}): Task =>
  ({
    id: `t${++seq}`,
    title,
    status: "planned",
    duration_minutes: 30,
    start_time: null,
    do_date: ISO,
    slot_id: null,
    project_id: null,
    domain_id: null,
    recurrence_id: null,
    recurrence_overridden: false,
    completed_at: null,
    sort_order: seq,
    ...o,
  }) as Task;

const SLOT: Slot = {
  id: "s-focus",
  user_id: "u1",
  created_at: "",
  updated_at: "",
  title: "Morning Focus",
  do_date: ISO,
  start_time: BLOCK_START.toISOString(),
  duration_minutes: 60,
  project_id: null,
  domain_id: "d1",
  color: "#7c6f9f",
  google_event_id: null,
  recurrence_id: null,
  recurrence_date: null,
  recurrence_overridden: false,
};

// A slot's children carry the slot's start, as the rail is handed them.
const inSlot = { slot_id: "s-focus", start_time: BLOCK_START.toISOString() };
const TASKS: Task[] = [
  task("Finalize scope for R1", { ...inSlot, project_id: "p1", duration_minutes: 20 }),
  task("Write 1-sentence brand meaning", { ...inSlot, project_id: "p2", duration_minutes: 15 }),
  task("Create a candidate-name list", { ...inSlot, project_id: "p2", duration_minutes: 25 }),
  task("Frontier admin follow-ups", { start_time: plus(240).toISOString(), duration_minutes: 45 }),
  task("Gym + lunch", { start_time: plus(330).toISOString(), duration_minutes: 90 }),
  task("Find time to meet with Garrett"),
  task("Talk with Enrique about TDCA"),
  task("Decide go / no go", { do_date: ISO }),
  task("Call the bank", { do_date: null }),
];

const EVENTS: ExternalEvent[] = [
  {
    id: "e1",
    account_id: "a1",
    provider_event_id: "pe1",
    calendar_id: "c1",
    title: "OE PermitHub stand-up",
    start_at: plus(60).toISOString(),
    end_at: plus(75).toISOString(),
    all_day: false,
    location: null,
    busy: true,
    self_rsvp: null,
  } as ExternalEvent,
];

const VERTICAL = {
  domains: [{ id: "d1", name: "Frontier", color: "#7c6f9f" }],
  initiatives: [],
  projects: [
    { id: "p1", name: "Build Staff Rigor Plan", domainId: "d1" },
    { id: "p2", name: "Find a New Name for Mathy", domainId: "d1" },
  ],
  tasks: [],
  sprint: null,
  focusInitiativeIds: [],
  bigRocks: [],
  lastActivityByProject: {},
} as unknown as VerticalData;

const qc = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });

export default function FocusHarness() {
  return (
    <AppNavigationProvider>
      <QueryClientProvider client={qc}>
        <FocusInner />
      </QueryClientProvider>
    </AppNavigationProvider>
  );
}

function FocusInner() {
  const [tab, setTab] = useState<RailTab>("today");
  const [railRef] = useTrackedRef<HTMLDivElement>();
  const [tasks, setTasks] = useState<Task[]>(TASKS);
  const [log, setLog] = useState<string[]>([]);
  const say = (line: string) => setLog((l) => [line, ...l].slice(0, 8));
  const store = useMemo(() => ({ data: VERTICAL }) as unknown as VerticalStore, []);
  const patch = (id: string, p: Partial<Task>) => setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)));

  const base = {
    complete: (t: Task) => patch(t.id, { status: "done", completed_at: new Date().toISOString() }),
    uncomplete: (t: Task) => patch(t.id, { status: "planned", completed_at: null }),
    patchTask: (id: string, p: Partial<Task>) => patch(id, p),
  } as Record<string, unknown>;
  const mutations = new Proxy(base, {
    get: (target, key: string) => target[key] ?? ((...a: unknown[]) => say(`${key}(${a.length})`)),
  }) as unknown as ReturnType<typeof useTaskMutations>;

  const today = tasks.filter((t) => t.do_date === ISO && t.status !== "trashed");
  const inbox = tasks.filter((t) => !t.do_date && t.status !== "done");
  // The pill rides beside the rail here, so the two can be seen agreeing.
  const focus = useFocus();
  const pool = [...today, ...inbox];
  const busy = toBusyBlocks(EVENTS, today, []);

  return (
    <VerticalStoreProvider value={store}>
      <div className="app-panel flex h-screen w-screen">
        <LeftRail
          tab={tab}
          setTab={setTab}
          inbox={inbox}
          today={today}
          labels={[]}
          mutations={mutations}
          onOpenTask={(t) => say(`open · ${t.title}`)}
          hotkeysEnabled
          now={NOW}
          railRef={railRef}
          slots={[SLOT]}
          slotTitle={(s) => s.title}
          onOpenSlot={(s) => say(`open slot · ${s.title}`)}
          events={EVENTS}
        />
        {focus?.mode === "on" && (
          <FocusPill
            target={focus.target}
            pool={pool}
            slots={[SLOT]}
            slotTitle={(s) => s.title}
            busy={busy}
            now={NOW}
            onComplete={(t) => base.complete && (base.complete as (t: Task) => void)(t)}
            onShow={() => say("show the block")}
            onNext={() => say("focus on the next")}
          />
        )}
        <div className="mono flex flex-1 flex-col gap-1 p-4 text-micro text-muted" data-log>
          <button type="button" className="self-start underline" onClick={() => setTasks(TASKS)}>
            Reset the fixture
          </button>
          {log.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
      </div>
    </VerticalStoreProvider>
  );
}
