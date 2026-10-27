// Standalone verify harness for **dropping work onto a block** — the Schedule's
// grid with fixture tasks, slots and an event, a fake rail beside it, and the
// real slot popover. Reached at ?gather.
//
// The gesture is the whole feature and a typecheck proves none of it: which
// zone the pointer is in, whether a task's middle waited out its pause, what the
// preview drew, and what the drop wrote. So every pair the drop rules name can
// be driven here with a real pointer:
//
//  - a rail row (or the two-row group) onto a task's EDGE → beside it;
//  - … onto a task's MIDDLE, held a beat → one new slot, the popover opening on
//    its name with Nuvo's draft waiting under the field (Tab or a click);
//  - a task block onto another task block → the same, its old hour freed;
//  - a slot onto a task → the slot moves there and takes it in;
//  - a slot onto a slot → merged (and the guarded ones — the repeating slot,
//    the other project's sitting, an empty slot — land beside instead);
//  - an event onto anything → it only moves;
//  - ⌘-click two blocks, ⌘G → one slot.
//
// Writes are local state and the name draft is a stub — this proves the gesture
// and the render, not Supabase. Precedent: SittingHarness (?sitting).

import { useEffect, useMemo, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { startOfDay } from "date-fns";
import CalendarPane from "./CalendarPane";
import { SlotPopover } from "./SlideOver";
import { deriveSlotTitle, slotMinutesFor } from "../lib/slots";
import { toDateISO } from "../lib/dates";
import { DEFAULT_DURATION_MINUTES, type ExternalEvent, type Slot, type Task } from "../lib/types";
import type { VerticalData } from "../lib/vertical";
import { VerticalStoreProvider, type VerticalStore } from "../hooks/useVertical";
import { supabase } from "../lib/supabase";
import type { useTaskMutations } from "../hooks/useTasks";
import type { useSlotMutations } from "../hooks/useSlots";
import type { useExternalEventMutations } from "../hooks/useCalendar";
import type { useRecurrenceMutations } from "../hooks/useRecurrence";

const DAY = startOfDay(new Date());
const at = (h: number, m = 0) => new Date(DAY.getTime() + (h * 60 + m) * 60_000);
const ISO = toDateISO(DAY);

// The draft Nuvo would write — stubbed, so the popover's waiting line can be
// driven without a session. A second's delay, like the real round trip.
// `supabase.functions` is a getter that builds a fresh client each time, so the
// stub goes on the class the getter builds from.
(Object.getPrototypeOf(supabase.functions) as { invoke: unknown }).invoke = async (_fn: string, opts?: { body?: { nameSlot?: unknown } }) => {
  await new Promise((r) => setTimeout(r, 900));
  return opts?.body?.nameSlot ? { data: { name: "Launch prep" }, error: null } : { data: null, error: null };
};

let seq = 0;
const task = (title: string, o: Partial<Task> = {}): Task =>
  ({
    id: `t${++seq}`,
    title,
    status: "planned",
    duration_minutes: 30,
    start_time: null,
    do_date: null,
    slot_id: null,
    project_id: null,
    domain_id: null,
    recurrence_id: null,
    recurrence_overridden: false,
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

const timed = (h: number, m = 0) => ({ start_time: at(h, m).toISOString(), do_date: ISO, status: "planned" as const });

const TASKS: Task[] = [
  task("Stretch", { ...timed(8), status: "done" }),
  task("Write intro", { ...timed(9), duration_minutes: 60, project_id: "p1" }),
  task("Email Sam", { ...timed(10, 30) }),
  task("Pay invoice", { do_date: ISO, slot_id: "s-admin", duration_minutes: 15 }),
  task("Renew domain", { do_date: ISO, slot_id: "s-admin", duration_minutes: 15 }),
  task("Book flights", { do_date: ISO, slot_id: "s-plain" }),
  task("Outline the talk", { do_date: ISO, slot_id: "s-repeat", duration_minutes: 60 }),
  task("Other project's piece", { do_date: ISO, slot_id: "s-other", project_id: "p2" }),
  // The all-day row — planned for today, no time yet.
  task("Water the plants", { do_date: ISO, duration_minutes: 15 }),
  task("Pick up dry cleaning", { do_date: ISO, duration_minutes: 30 }),
  // The rail's inbox — no day yet.
  task("Call the bank"),
  task("Order toner", { duration_minutes: 15 }),
  task("Draft the agenda", { duration_minutes: 45 }),
];

const SLOTS: Slot[] = [
  slot({ id: "s-admin", title: "Admin", start_time: at(13).toISOString() }),
  slot({ id: "s-plain", start_time: at(14, 30).toISOString(), duration_minutes: 30 }),
  slot({ id: "s-empty", title: "Held", start_time: at(15, 15).toISOString(), duration_minutes: 30 }),
  slot({ id: "s-repeat", title: "Deep work", start_time: at(16).toISOString(), duration_minutes: 90, recurrence_id: "r1" }),
  slot({ id: "s-other", start_time: at(18).toISOString(), project_id: "p2" }),
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

const VERTICAL: VerticalData = {
  domains: [
    { id: "d1", name: "Clearstream", color: "#7c6f9f" },
    { id: "d2", name: "Home", color: "#5f8f7a" },
  ],
  initiatives: [],
  projects: [
    { id: "p1", name: "Site relaunch", domainId: "d1" },
    { id: "p2", name: "Other project", domainId: "d2" },
  ],
  tasks: [],
  sprint: null,
  focusInitiativeIds: [],
  bigRocks: [],
  lastActivityByProject: {},
} as unknown as VerticalData;

const qc = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });

export default function GatherHarness() {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [slots, setSlots] = useState<Slot[]>(SLOTS);
  const [tasks, setTasks] = useState<Task[]>(TASKS);
  const [log, setLog] = useState<string[]>([]);
  const [open, setOpen] = useState<{ slot: Slot; anchor: DOMRect; focusTitle: boolean } | null>(null);
  const say = (line: string) => setLog((l) => [line, ...l].slice(0, 10));
  const store = useMemo(() => ({ data: VERTICAL }) as unknown as VerticalStore, []);
  useEffect(() => {
    qc.setQueryData(["tasks", "all"], tasks);
  }, [tasks]);

  const slotTasks = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const s of slots) m[s.id] = tasks.filter((t) => t.slot_id === s.id && t.status !== "trashed");
    return m;
  }, [slots, tasks]);

  const patch = (id: string, p: Partial<Task>) =>
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const into = (t: Task, s: Slot) => patch(t.id, { slot_id: s.id, start_time: null, do_date: s.do_date, status: "planned" });
  const patchSlot = (id: string, p: Partial<Slot>) => setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));

  const mutations = {
    block: (t: Task, start: Date) => {
      say(`block · ${t.title} @ ${start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
      patch(t.id, { start_time: start.toISOString(), do_date: toDateISO(start), slot_id: null, status: "planned" });
    },
    planFor: (t: Task, date: string) => patch(t.id, { do_date: date, start_time: null, slot_id: null }),
    assignToSlot: (t: Task, s: Slot) => {
      say(`join · ${t.title} → ${s.title || s.id}`);
      into(t, s);
    },
    backToInbox: (t: Task) => patch(t.id, { do_date: null, start_time: null, slot_id: null }),
    patchTask: (id: string, p: Partial<Task>) => patch(id, p),
    complete: (t: Task) => patch(t.id, { status: "done" }),
    uncomplete: (t: Task) => patch(t.id, { status: "planned" }),
    removeFromSlot: (t: Task) => patch(t.id, { slot_id: null }),
  } as unknown as ReturnType<typeof useTaskMutations>;

  const slotMutations = {
    createSlot: (input: Partial<Slot>) => {
      const made = slot({ id: `s${++seq}`, ...input });
      setSlots((prev) => [...prev, made]);
      return made;
    },
    createSlotWith: async (picked: Task[], start: Date) => {
      const projects = new Set(picked.map((t) => t.project_id ?? null));
      const made = slot({
        id: `s${++seq}`,
        start_time: start.toISOString(),
        do_date: toDateISO(start),
        duration_minutes: slotMinutesFor(
          picked.length ? picked.map((t) => t.duration_minutes) : [DEFAULT_DURATION_MINUTES],
          start,
        ),
        project_id: projects.size === 1 ? [...projects][0] : null,
      });
      setSlots((prev) => [...prev, made]);
      picked.forEach((t) => into(t, made));
      say(`make a slot · ${picked.map((t) => t.title).join(" + ")} · ${made.duration_minutes}m`);
      return made;
    },
    gatherIntoSlot: (s: Slot, moving: Task[], held: Task[] = []) => {
      const grown = slotMinutesFor([...held, ...moving].map((t) => t.duration_minutes), new Date(s.start_time), s.duration_minutes);
      moving.forEach((t) => into(t, s));
      patchSlot(s.id, { duration_minutes: grown });
      say(`gather · ${moving.length} into ${s.title || s.id} · ${s.duration_minutes}→${grown}m`);
    },
    absorbIntoSlot: (s: Slot, moving: Task[], held: Task[], to: Date) => {
      const grown = slotMinutesFor([...held, ...moving].map((t) => t.duration_minutes), to, s.duration_minutes);
      const moved = { ...s, start_time: to.toISOString(), do_date: toDateISO(to), duration_minutes: grown };
      patchSlot(s.id, moved);
      moving.forEach((t) => into(t, moved));
      say(`absorb · ${s.title || s.id} → ${to.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}, took ${moving.map((t) => t.title).join(", ")} · ${grown}m`);
    },
    mergeSlots: (target: Slot, held: Task[], from: Slot, fromChildren: Task[]) => {
      const grown = slotMinutesFor([...held, ...fromChildren].map((t) => t.duration_minutes), new Date(target.start_time), target.duration_minutes);
      fromChildren.forEach((t) => into(t, target));
      patchSlot(target.id, { duration_minutes: grown });
      setSlots((prev) => prev.filter((x) => x.id !== from.id));
      say(`merge · ${from.title || from.id} into ${target.title || target.id} · ${grown}m`);
    },
    updateSlot: ({ id, patch: p }: { id: string; patch: Partial<Slot> }) => {
      if ("title" in p) say(`named · ${p.title}`);
      else if ("start_time" in p) say(`move slot · ${id}`);
      patchSlot(id, p);
    },
    removeSlot: (s: Slot) => setSlots((prev) => prev.filter((x) => x.id !== s.id)),
  } as unknown as ReturnType<typeof useSlotMutations>;

  const noop = {} as unknown as ReturnType<typeof useExternalEventMutations>;
  const noopRec = {} as unknown as ReturnType<typeof useRecurrenceMutations>;
  const inbox = tasks.filter((t) => !t.slot_id && !t.start_time && !t.do_date);
  const [a, b] = inbox;
  const openSlot = open ? slots.find((s) => s.id === open.slot.id) ?? null : null;

  return (
    <QueryClientProvider client={qc}>
      <VerticalStoreProvider value={store}>
        <div className="atmosphere flex h-screen w-screen">
          <div ref={railRef} className="flex w-[280px] shrink-0 flex-col gap-2 border-r border-line p-3">
            <div className="section-label">inbox (fixture)</div>
            {inbox.map((t) => (
              <div
                key={t.id}
                data-task-drag={t.id}
                data-task-title={t.title}
                data-task-duration={t.duration_minutes ?? ""}
                className="cursor-grab rounded border border-line px-2 py-1 text-label active:cursor-grabbing"
              >
                {t.title} <span className="mono text-micro text-muted">{t.duration_minutes}m</span>
              </div>
            ))}
            {a && b && (
              <>
                <div className="section-label pt-2">a two-row selection</div>
                <div
                  data-task-drag={a.id}
                  data-task-drag-group={`${a.id},${b.id}`}
                  data-task-title={a.title}
                  className="cursor-grab rounded border border-accent px-2 py-1 text-label active:cursor-grabbing"
                >
                  {a.title} + {b.title}
                </div>
              </>
            )}
            <div className="section-label pt-2">what happened</div>
            <div className="mono flex flex-col gap-0.5 text-micro text-muted" data-log>
              {log.length === 0 ? <span>—</span> : log.map((l, i) => <span key={i}>{l}</span>)}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <CalendarPane
              view="timeGridDay"
              tasks={tasks.filter((t) => t.start_time || t.slot_id || t.do_date)}
              events={EVENTS}
              slots={slots}
              slotTasks={slotTasks}
              accounts={[]}
              settings={undefined}
              now={at(7)}
              taskAccent={() => null}
              taskDomain={(t) => (t.project_id === "p1" ? "d1" : t.project_id === "p2" ? "d2" : null)}
              slotTitle={(s) => deriveSlotTitle(s, slotTasks[s.id] ?? [], VERTICAL)}
              slotProject={(s) => (s.project_id === "p2" ? { name: "Other project", color: "#5f8f7a" } : null)}
              taskProject={(t) => (t.project_id === "p1" ? "Site relaunch" : null)}
              mutations={mutations}
              eventMutations={noop}
              slotMutations={slotMutations}
              recurrenceMutations={noopRec}
              onOpenTask={() => {}}
              onOpenEvent={() => {}}
              onOpenSlot={(s, anchor, _el, opts) => {
                say(`popover · ${opts?.focusTitle ? "on the name" : "opened"}`);
                setOpen({ slot: s, anchor, focusTitle: Boolean(opts?.focusTitle) });
              }}
              onRangeChange={() => {}}
              railRef={railRef}
              resolveDropTask={(id) => tasks.find((t) => t.id === id)}
            />
          </div>
        </div>
        {open && openSlot && (
          <SlotPopover
            key={openSlot.id}
            slot={openSlot}
            anchor={open.anchor}
            childTasks={slotTasks[openSlot.id] ?? []}
            taskMutations={mutations}
            slotMutations={slotMutations}
            recurrence={null}
            recurrenceMutations={noopRec}
            labels={[]}
            onOpenTask={() => {}}
            onCloseTask={() => {}}
            focusTitle={open.focusTitle}
            onClose={() => setOpen(null)}
          />
        )}
      </VerticalStoreProvider>
    </QueryClientProvider>
  );
}
