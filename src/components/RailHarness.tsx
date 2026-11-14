// Standalone verify harness for **the task list's selection and its slots** —
// the real desktop `LeftRail` (?rail) and the phone's real `MobileTaskList` +
// `BulkBar` (?rail=phone) over one set of fixtures. No auth, no shell.
//
// What a typecheck can't prove and this can, with a real pointer:
//
//  - click a row (its popover opens), then ⌘-click another → the popover CLOSES,
//    BOTH rows are held, the bar says "2 selected" (D-178 — the popover used to
//    stay up over the pick, and the first row was never in it);
//  - ⇧-click a range; ⌘A; ⇧↓ / ⇧↑; Esc; click empty paper; "Select all N";
//  - a slot's tasks sit under ONE header (name · span · what it holds), the
//    ring on it picks the whole group, a finished one reads "all done", and an
//    EMPTY slot ("Held", 3pm) is simply absent — time, not work (D-188);
//  - on the phone: hold a row, tap more, tap a header's ring, the bar's ✕, and
//    that a header tap opens the slot (here: a status line, the real sheet is
//    MobileEventSheet — see ?sheets).
//
// Writes are stubbed (every mutation logs) — this proves the gesture and the
// render, not Supabase. Precedent: GatherHarness (?gather), SheetsHarness.

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { startOfDay } from "date-fns";
import LeftRail, { type RailTab } from "./LeftRail";
import ReadyHarness from "./plan/ReadyHarness";
import Spine from "./Spine";
import { AgentProvider } from "../hooks/useAgentContext";
import { Icon } from "./Icon";
import { Button, IconButton, PageBar, Segmented } from "./kit";
import MobileTaskList from "./mobile/MobileTaskList";
import BulkBar from "./BulkBar";
import { useBulkOps } from "../hooks/useBulkOps";
import { AppNavigationProvider, useAppNavigation } from "../hooks/useAppNavigation";
import { VerticalStoreProvider, type VerticalStore } from "../hooks/useVertical";
import { toDateISO } from "../lib/dates";
import { deriveSlotTitle } from "../lib/slots";
import { toggleGroup } from "../lib/selection";
import type { Slot, Task } from "../lib/types";
import type { VerticalData } from "../lib/vertical";
import type { useTaskMutations } from "../hooks/useTasks";
import { OFFERS_NOW, OFFERS_SLOTS, OFFERS_VERTICAL, offersClient, offersInbox, offersToday } from "./nuvo/OffersFixture";

/** `?rail=offers` / `?rail=offers-phone`: the busy rail (D-205) — every offer
 *  budget overflowing, to see what the rail says when Nuvo has more to say
 *  than it may. `?rail=ready` / `?rail=ready-phone`: Get ready (D-206) over a
 *  busy fixture — the card stack, its refill, "Ready." (plan/ReadyHarness). */
interface Fixture {
  seed: () => Task[];
  inbox: () => Task[];
  slots: Slot[];
  vertical: VerticalData;
  now: Date;
}

const DAY = startOfDay(new Date());
const at = (h: number, m = 0) => new Date(DAY.getTime() + (h * 60 + m) * 60_000);
const ISO = toDateISO(DAY);

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
    roll_count: 0,
    priority: "none",
    sort_order: seq,
    ...o,
  }) as Task;

const slot = (o: Partial<Slot>): Slot =>
  ({
    user_id: "u1",
    title: "",
    do_date: ISO,
    duration_minutes: 60,
    project_id: null,
    domain_id: null,
    color: null,
    google_event_id: null,
    recurrence_id: null,
    recurrence_date: null,
    recurrence_overridden: false,
    ...o,
  }) as Slot;

const SLOTS: Slot[] = [
  slot({ id: "s-admin", title: "Admin", start_time: at(9).toISOString(), duration_minutes: 120 }),
  slot({ id: "s-deep", title: "Deep work", start_time: at(11).toISOString(), duration_minutes: 90, domain_id: "d1", color: "#7c6f9f" }),
  slot({ id: "s-held", title: "Held", start_time: at(15).toISOString(), duration_minutes: 60 }),
  slot({ id: "s-done", title: "Morning pages", start_time: at(7).toISOString(), duration_minutes: 30 }),
];

const seed = (): Task[] => [
  task("Write the brief"),
  task("Review notes"),
  task("Send invoice"),
  task("Plan the trip"),
  // Slot children: the DB leaves their own start null — the rail stamps the slot's.
  task("Pay the electric bill", { slot_id: "s-admin", duration_minutes: 15 }),
  task("Renew the domain", { slot_id: "s-admin", duration_minutes: 15 }),
  task("Book flights", { slot_id: "s-admin", duration_minutes: 30 }),
  task("Outline the talk", { slot_id: "s-deep", duration_minutes: 60, project_id: "p1" }),
  task("Draft slides", { slot_id: "s-deep", duration_minutes: 30, project_id: "p1" }),
  // A lone timed task standing between two slots.
  task("Call the dentist", { start_time: at(13).toISOString(), duration_minutes: 15 }),
  task("Journal", { slot_id: "s-done", status: "done" }),
];

const VERTICAL: VerticalData = {
  domains: [
    { id: "d1", name: "Clearstream", color: "#7c6f9f" },
    { id: "d2", name: "Home", color: "#5f8f7a" },
  ],
  initiatives: [],
  // `outcome` and `status` are required by the readiness reads the sidebar runs
  // (readSpine → readTending); without them ?rail=frame threw on mount.
  projects: [{ id: "p1", name: "Site relaunch", domainId: "d1", outcome: "", status: "in_progress", startDate: null, targetDate: null }],
  tasks: [],
  sprint: null,
} as unknown as VerticalData;

type Mutations = ReturnType<typeof useTaskMutations>;

const BASE: Fixture = { seed, inbox: () => [], slots: SLOTS, vertical: VERTICAL, now: at(10, 15) };
const BUSY: Fixture = { seed: offersToday, inbox: offersInbox, slots: OFFERS_SLOTS, vertical: OFFERS_VERTICAL, now: OFFERS_NOW };

function useStubMutations(setTasks: React.Dispatch<React.SetStateAction<Task[]>>, log: (s: string) => void) {
  return useMemo(() => {
    const patch = (id: string, p: Partial<Task>) => setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));
    const base: Record<string, (...a: unknown[]) => unknown> = {
      complete: (t) => (patch((t as Task).id, { status: "done" }), log(`done · ${(t as Task).title}`)),
      uncomplete: (t) => (patch((t as Task).id, { status: "planned" }), log(`undone · ${(t as Task).title}`)),
      trash: (t) => (patch((t as Task).id, { status: "trashed" }), log(`trashed · ${(t as Task).title}`)),
      patchTask: (id, p) => (patch(id as string, p as Partial<Task>), log(`patch ${String(id)}`)),
    };
    return new Proxy(base, {
      get: (target, key: string) => target[key] ?? ((...a: unknown[]) => log(`${key}(${a.length})`)),
    }) as unknown as Mutations;
  }, [setTasks, log]);
}

// A stand-in for the Schedule's task popover: it reads the SAME navigation state
// the real one mounts from (`nav.overlay === "task"`), so whether the rail closes
// it is visible without Planner around it.
function PopoverStandIn({ tasks }: { tasks: Task[] }) {
  const { nav, closeOverlay } = useAppNavigation();
  if (nav.overlay !== "task" && nav.overlay !== "slot") return null;
  const t = tasks.find((x) => x.id === nav.overlayId);
  return (
    <div data-testid="popover" className="glass-card rounded-xl p-4" style={{ width: 280 }}>
      <div className="section-label !p-0">{nav.overlay} popover is OPEN</div>
      <div className="text-head mt-1">{t?.title ?? nav.overlayId}</div>
      <button className="mt-2 text-caption text-muted underline" onClick={closeOverlay}>
        close
      </button>
    </div>
  );
}

function Desktop({ embedded = false, bar, fx = BASE }: { embedded?: boolean; bar?: ReactNode; fx?: Fixture }) {
  const [tasks, setTasks] = useState(() => [...fx.seed(), ...fx.inbox()]);
  const [tab, setTab] = useState<RailTab>("today");
  const [lines, setLines] = useState<string[]>([]);
  const log = useCallback((s: string) => setLines((l) => [s, ...l].slice(0, 6)), []);
  const mutations = useStubMutations(setTasks, log);
  const railRef = useRef<HTMLDivElement | null>(null);
  const { openOverlay, nav } = useAppNavigation();
  const now = fx.now;

  const inbox = useMemo(() => tasks.filter((t) => t.status === "inbox"), [tasks]);
  const today = useMemo(() => {
    const byId = new Map(fx.slots.map((s) => [s.id, s]));
    return tasks
      .filter((t) => t.status !== "trashed" && t.status !== "inbox" && t.do_date)
      .map((t) => (t.slot_id && byId.get(t.slot_id) ? { ...t, start_time: byId.get(t.slot_id)!.start_time } : t));
  }, [tasks, fx.slots]);
  const slotTitle = useCallback((s: Slot, kids: Task[]) => deriveSlotTitle(s, kids, fx.vertical), [fx.vertical]);

  return (
    <div className={embedded ? "flex min-h-0 flex-1" : "flex h-screen gap-6 p-0"}>
      <LeftRail
        tab={tab}
        setTab={setTab}
        inbox={inbox}
        today={today}
        labels={[]}
        mutations={mutations}
        onOpenTask={(t, anchor) => openOverlay("task", t.id, anchor)}
        hotkeysEnabled
        now={now}
        railRef={railRef}
        slots={fx.slots}
        slotTitle={slotTitle}
        onOpenSlot={(s, anchor) => openOverlay("slot", s.id, anchor)}
      />
      {/* As in Planner: the calendar's column carries the bar, beside the rail. */}
      <div className="flex min-w-0 flex-1 flex-col">
      {bar}
      <div className="flex flex-col gap-4 p-6">
        <PopoverStandIn tasks={tasks} />
        {nav.overlay === "none" && <div className="text-caption text-muted">no popover open</div>}
        <div className="text-meta text-muted">
          <div className="section-label !p-0">last writes</div>
          {lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </div>
      </div>
    </div>
  );
}

// `?rail=frame` — the whole desktop frame (D-190) around the real rail: the
// sidebar on the ground, the inset panel, the one bar — over the calendar's
// column, beside the rail, as Planner lays it out. The grid is a stand-in.
function Frame() {
  const [rung, setRung] = useState<"day" | "project" | "initiative" | "domain">("day");
  const [view, setView] = useState<"board" | "timeGridDay" | "timeGridWeek" | "dayGridMonth" | "year">("timeGridWeek");
  return (
    <div className="app-ground h-screen">
      <div className="app-shell flex h-full">
        <div className="app-canvas flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <Spine rung={rung} setRung={setRung} openSettings={() => {}} openShortcuts={() => {}} />
            <div className="app-panel flex min-w-0 flex-1 flex-col">
              <Desktop
                embedded
                bar={
                  <PageBar
                    icon={<Icon name="calendar" size={16} />}
                    trail={["Schedule", "November 2026"]}
                    actions={
                      <>
                        {/* the real bar's two optional acts, so the frame sheds what the app sheds */}
                        <Button>Rhythm</Button>
                        <Button collapsible icon={<Icon name="calendar" size={14} />}>
                          Plan the week
                        </Button>
                        <IconButton label="Previous" shortcut="⌘←" icon={<Icon name="chevron-left" size={14} />} />
                        <Button shed>Today</Button>
                        <IconButton label="Next" shortcut="⌘→" icon={<Icon name="chevron-right" size={14} />} />
                        <Segmented
                          label="Calendar view"
                          value={view}
                          onChange={setView}
                          options={[
                            { value: "board", label: "Spread", short: "S" },
                            { value: "timeGridDay", label: "Day", short: "D" },
                            { value: "timeGridWeek", label: "Week", short: "W" },
                            { value: "dayGridMonth", label: "Month", short: "M" },
                            { value: "year", label: "Year", short: "Y" },
                          ]}
                        />
                        <IconButton label="More calendar tools" icon={<Icon name="more" size={14} />} />
                      </>
                    }
                  />
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Phone({ fx = BASE }: { fx?: Fixture }) {
  const [tasks, setTasks] = useState(() => [...fx.seed(), ...fx.inbox()]);
  const [tab, setTab] = useState<"today" | "inbox">("today");
  const [lines, setLines] = useState<string[]>([]);
  const log = useCallback((s: string) => setLines((l) => [s, ...l].slice(0, 4)), []);
  const mutations = useStubMutations(setTasks, log);
  const now = fx.now;
  const inbox = useMemo(() => tasks.filter((t) => t.status === "inbox"), [tasks]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const clear = useCallback(() => setPicked(new Set()), []);
  const today = useMemo(() => {
    const byId = new Map(fx.slots.map((s) => [s.id, s]));
    return tasks
      .filter((t) => t.status !== "trashed" && t.status !== "inbox" && t.do_date)
      .map((t) => (t.slot_id && byId.get(t.slot_id) ? { ...t, start_time: byId.get(t.slot_id)!.start_time } : t));
  }, [tasks, fx.slots]);
  const bulkOps = useBulkOps({
    selected: [...picked].map((id) => tasks.find((t) => t.id === id)).filter((t): t is Task => !!t),
    mutations,
    clear,
  });
  const slotTitle = useCallback((s: Slot, kids: Task[]) => deriveSlotTitle(s, kids, fx.vertical), [fx.vertical]);

  return (
    <div className="flex h-screen flex-col bg-bg">
      <div className="flex items-center gap-2 px-4 py-2 text-meta text-muted" data-testid="status">
        {fx !== BASE && (
          <Segmented
            label="Face"
            value={tab}
            onChange={setTab}
            options={[
              { value: "today", label: "Today" },
              { value: "inbox", label: "Inbox" },
            ]}
          />
        )}
        <span className="min-w-0 truncate">{lines[0] ?? "—"}</span>
      </div>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <MobileTaskList
          tab={tab}
          inbox={inbox}
          today={today}
          week={[]}
          trashed={[]}
          labels={[]}
          vertical={fx.vertical as never}
          mutations={mutations}
          now={now}
          onTapTask={(t) => log(`opened · ${t.title}`)}
          slots={fx.slots}
          slotTitle={slotTitle}
          onOpenSlot={(_run, title) => log(`opened slot · ${title}`)}
          selection={{
            ids: picked,
            begin: (id) => setPicked((s) => new Set(s).add(id)),
            toggle: (id) =>
              setPicked((s) => {
                const n = new Set(s);
                n.has(id) ? n.delete(id) : n.add(id);
                return n;
              }),
            toggleMany: (ids) => setPicked((s) => toggleGroup(s, ids)),
          }}
        />
      </main>
      {picked.size > 0 && (
        <BulkBar
          count={picked.size}
          ops={bulkOps}
          labels={[]}
          vertical={fx.vertical}
          total={today.filter((t) => t.status !== "done").length}
          onSelectAll={() => setPicked(new Set(today.filter((t) => t.status !== "done").map((t) => t.id)))}
        />
      )}
      <nav className="pb-safe h-14 shrink-0 border-t border-line bg-surface" />
    </div>
  );
}

export default function RailHarness() {
  const mode = new URLSearchParams(window.location.search).get("rail");
  const busy = mode === "offers" || mode === "offers-phone";
  const fx = busy ? BUSY : BASE;
  const qc = useMemo(
    () => (busy ? offersClient(offersToday()) : new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })),
    [busy],
  );
  const store = useMemo(() => ({ data: fx.vertical, ready: true, togglePushLanded: () => {} }) as unknown as VerticalStore, [fx]);
  const phone = mode === "phone" || mode === "offers-phone";
  return (
    <QueryClientProvider client={qc}>
      <VerticalStoreProvider value={store}>
        <AppNavigationProvider>
          {mode === "ready" || mode === "ready-phone" ? (
            <ReadyHarness phone={mode === "ready-phone"} />
          ) : phone ? (
            <Phone fx={fx} />
          ) : mode === "frame" ? (
            <AgentProvider>
              <Frame />
            </AgentProvider>
          ) : (
            <Desktop fx={fx} />
          )}
        </AppNavigationProvider>
      </VerticalStoreProvider>
    </QueryClientProvider>
  );
}
