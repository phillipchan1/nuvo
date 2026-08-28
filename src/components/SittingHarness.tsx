// Standalone verify harness for **placing a project by hand** — the Schedule's
// grid, a fake rail crown beside it, and fixture data, reached at ?sitting.
//
// It exists because of D-084's lesson: a drag affordance is FOUR things — the
// source attribute, the drop resolving what was dragged, the write, and the
// platform not stealing the gesture — and a typecheck proves none of them. The
// crown's first drag shipped looking built and landing nothing. So the two
// gestures this file exercises are the two that were added on top of it:
//
//  1. **drag the project row** → the in-grid preview is the SITTING you're about
//     to get (designation, hue, the pieces it will hold), and the drop makes it,
//     with its loose work inside and an offer for what already had a time;
//  2. **drag one loose piece** → it lands in a project sitting too, not a bare
//     block, so project time wears one shape however you place it.
//
// The writes are local state, not Supabase — this proves the gesture and the
// render, which is exactly the half that a test can't see. Not part of any real
// surface. Precedent: CalendarHarness (?horizon), PlanWeekHarness (?planweek).

import { useMemo, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { startOfDay } from "date-fns";
import CalendarPane from "./CalendarPane";
import { deriveSlotTitle } from "../lib/slots";
import { toDateISO } from "../lib/dates";
import { DEFAULT_DURATION_MINUTES, type ExternalEvent, type Slot, type Task } from "../lib/types";
import type { VerticalData } from "../lib/vertical";
import type { useTaskMutations } from "../hooks/useTasks";
import type { useSlotMutations } from "../hooks/useSlots";
import type { useExternalEventMutations } from "../hooks/useCalendar";
import type { useRecurrenceMutations } from "../hooks/useRecurrence";
import { sizeSlotToContents } from "../../supabase/functions/_shared/slotSizing.ts";

const DAY = startOfDay(new Date());
const at = (h: number, m = 0) => new Date(DAY.getTime() + (h * 60 + m) * 60_000);
const HUE = "#7c6f9f";

const PROJECT = { id: "p1", name: "Clearstream domains", domainId: "d1" };

let seq = 0;
const task = (title: string, o: Partial<Task> = {}): Task =>
  ({
    id: `t${++seq}`,
    title,
    status: "planned",
    duration_minutes: 45,
    start_time: null,
    do_date: null,
    slot_id: null,
    project_id: PROJECT.id,
    domain_id: null,
    ...o,
  }) as Task;

/** The project's work with no time this week — what the crown offers to drag. */
const LOOSE = [
  task("Cut over the DNS"),
  task("Update the runbook", { duration_minutes: 30 }),
  task("Tell the team", { duration_minutes: 20 }),
];
/** …and the two pieces that already have a block, which the drop must NOT move
 *  on its own — they're what the reconcile card offers. */
const PLACED = [
  task("Draft the migration note", { start_time: at(9).toISOString(), do_date: toDateISO(DAY) }),
  task("Ask legal about the TLD", {
    duration_minutes: 30,
    start_time: at(15, 30).toISOString(),
    do_date: toDateISO(DAY),
  }),
];

const EVENTS: ExternalEvent[] = [
  {
    id: "e1",
    account_id: "a1",
    provider_event_id: "pe1",
    calendar_id: "c1",
    title: "Design review",
    start_at: at(11).toISOString(),
    end_at: at(12).toISOString(),
    all_day: false,
    location: null,
    busy: true,
    self_rsvp: null,
  } as ExternalEvent,
];

/** A sitting that already exists — so the designation on the grid can be read
 *  without dragging anything, at a full height and at a squeezed one. */
const SEED_SLOTS: Slot[] = [
  {
    id: "s-seed",
    user_id: "u1",
    title: "",
    do_date: toDateISO(DAY),
    start_time: at(13).toISOString(),
    duration_minutes: 90,
    project_id: PROJECT.id,
    domain_id: PROJECT.domainId,
    color: null,
  } as Slot,
  {
    id: "s-short",
    user_id: "u1",
    title: "Ship review",
    do_date: toDateISO(DAY),
    start_time: at(16).toISOString(),
    duration_minutes: 30,
    project_id: PROJECT.id,
    domain_id: PROJECT.domainId,
    color: null,
  } as Slot,
];

const VERTICAL: VerticalData = {
  domains: [{ id: "d1", name: "Clearstream", color: HUE }],
  initiatives: [],
  projects: [PROJECT],
  tasks: [],
  sprint: null,
  focusInitiativeIds: [],
  bigRocks: [],
  lastActivityByProject: {},
} as unknown as VerticalData;

const qc = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });

export default function SittingHarness() {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [slots, setSlots] = useState<Slot[]>(SEED_SLOTS);
  const [tasks, setTasks] = useState<Task[]>([...LOOSE, ...PLACED]);
  const [log, setLog] = useState<string[]>([]);
  const say = (line: string) => setLog((l) => [line, ...l].slice(0, 8));

  const slotTasks = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const s of slots) m[s.id] = tasks.filter((t) => t.slot_id === s.id);
    // The seeded sitting holds nothing until something is dropped in it.
    return m;
  }, [slots, tasks]);

  const patch = (id: string, p: Partial<Task>) =>
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)));

  const mutations = {
    block: (t: Task, start: Date) => {
      say(`block · ${t.title} @ ${start.toLocaleTimeString()}`);
      patch(t.id, { start_time: start.toISOString(), do_date: toDateISO(start), slot_id: null });
    },
    planFor: (t: Task, date: string) => {
      say(`planFor · ${t.title} → ${date}`);
      patch(t.id, { do_date: date, start_time: null, slot_id: null });
    },
    assignToSlot: (t: Task, s: Slot) => {
      say(`assignToSlot · ${t.title} → ${s.id}`);
      patch(t.id, { slot_id: s.id, start_time: null, do_date: s.do_date });
    },
    backToInbox: (t: Task) => say(`backToInbox · ${t.title}`),
  } as unknown as ReturnType<typeof useTaskMutations>;

  const slotMutations = {
    createSlot: (input: Partial<Slot>) => {
      const made = {
        id: `s${++seq}`,
        user_id: "u1",
        title: "",
        color: null,
        ...input,
      } as Slot;
      setSlots((prev) => [...prev, made]);
      return made;
    },
    createSlotWith: async (
      picked: Task[],
      start: Date,
      _domainOf: (t: Task) => string | null,
      affinity?: { projectId?: string | null; domainId?: string | null; label?: string },
    ) => {
      const made = {
        id: `s${++seq}`,
        user_id: "u1",
        title: "",
        do_date: toDateISO(start),
        start_time: start.toISOString(),
        duration_minutes: sizeSlotToContents(
          picked.length ? picked.map((t) => t.duration_minutes) : [DEFAULT_DURATION_MINUTES],
        ),
        project_id: affinity?.projectId ?? picked[0]?.project_id ?? null,
        domain_id: affinity?.domainId ?? null,
        color: null,
      } as Slot;
      setSlots((prev) => [...prev, made]);
      setTasks((prev) =>
        prev.map((t) =>
          picked.some((p) => p.id === t.id)
            ? { ...t, slot_id: made.id, start_time: null, do_date: made.do_date }
            : t,
        ),
      );
      say(`createSlotWith · ${picked.length} piece(s) · project=${made.project_id ?? "—"}`);
      return made;
    },
    gatherIntoSlot: (slot: Slot, moving: Task[], held: Task[] = []) => {
      const grown = sizeSlotToContents([...held, ...moving].map((t) => t.duration_minutes));
      setTasks((prev) =>
        prev.map((t) =>
          moving.some((m) => m.id === t.id)
            ? { ...t, slot_id: slot.id, start_time: null, do_date: slot.do_date }
            : t,
        ),
      );
      if (grown > slot.duration_minutes) {
        setSlots((prev) =>
          prev.map((s) => (s.id === slot.id ? { ...s, duration_minutes: grown } : s)),
        );
      }
      say(`gatherIntoSlot · ${moving.length} moved in · ${slot.duration_minutes}→${Math.max(grown, slot.duration_minutes)}m`);
    },
    updateSlot: ({ id, patch: p }: { id: string; patch: Partial<Slot> }) =>
      setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s))),
    removeSlot: (s: Slot) => setSlots((prev) => prev.filter((x) => x.id !== s.id)),
  } as unknown as ReturnType<typeof useSlotMutations>;

  const noop = {} as unknown as ReturnType<typeof useExternalEventMutations>;
  const noopRec = {} as unknown as ReturnType<typeof useRecurrenceMutations>;

  const looseNow = tasks.filter((t) => !t.slot_id && !t.start_time);
  const placedNow = tasks.filter((t) => t.start_time || t.slot_id);

  return (
    <QueryClientProvider client={qc}>
      <div className="atmosphere flex h-screen w-screen">
        {/* the fake crown — the same payload WeekPanel stamps on a project row */}
        <div ref={railRef} className="flex w-[300px] shrink-0 flex-col gap-2 border-r border-line p-3">
          <div className="section-label">the crown (fixture)</div>
          <div
            data-project-drag={PROJECT.id}
            data-project-title={PROJECT.name}
            data-project-color={HUE}
            data-project-domain={PROJECT.domainId}
            data-project-tasks={looseNow.map((t) => t.id).join(",")}
            data-project-placed={placedNow.filter((t) => !t.slot_id).map((t) => t.id).join(",")}
            title="Drag me onto the grid"
            className="cursor-grab rounded border border-line px-2 py-1.5 text-body active:cursor-grabbing"
          >
            {PROJECT.name}
            <span className="mono ml-2 text-micro text-muted">
              {looseNow.length} loose · {placedNow.filter((t) => !t.slot_id).length} timed
            </span>
          </div>

          <div className="section-label pt-2">its loose pieces</div>
          {looseNow.map((t) => (
            <div
              key={t.id}
              data-task-drag={t.id}
              data-task-title={t.title}
              data-task-duration={t.duration_minutes ?? ""}
              data-task-week="1"
              data-task-project={t.project_id ?? ""}
              className="cursor-grab rounded border border-line px-2 py-1 text-label text-muted active:cursor-grabbing"
            >
              {t.title}
            </div>
          ))}

          <div className="section-label pt-2">what happened</div>
          <div className="mono flex flex-col gap-0.5 text-micro text-muted" data-log>
            {log.length === 0 ? <span>—</span> : log.map((l, i) => <span key={i}>{l}</span>)}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <CalendarPane
            view="timeGridDay"
            tasks={tasks.filter((t) => t.start_time || t.slot_id)}
            events={EVENTS}
            slots={slots}
            slotTasks={slotTasks}
            accounts={[]}
            settings={undefined}
            now={at(10)}
            taskAccent={() => HUE}
            taskDomain={() => PROJECT.domainId}
            slotTitle={(s) => deriveSlotTitle(s, slotTasks[s.id] ?? [], VERTICAL)}
            slotProject={(s) => (s.project_id === PROJECT.id ? { name: PROJECT.name, color: HUE } : null)}
            mutations={mutations}
            eventMutations={noop}
            slotMutations={slotMutations}
            recurrenceMutations={noopRec}
            onOpenTask={() => {}}
            onOpenEvent={() => {}}
            onOpenSlot={() => say("onOpenSlot (naming popover)")}
            onRangeChange={() => {}}
            railRef={railRef}
            onWeekWorkPlaced={(ids) => say(`committed to the week · ${ids.length}`)}
            resolveDropTask={(id) => tasks.find((t) => t.id === id)}
          />
        </div>
      </div>
    </QueryClientProvider>
  );
}
