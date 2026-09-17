/**
 * The two row menus every task list shares: `t` (when) and `v` (where).
 * Both act on the list's targets — the selection, else the cursor row — and
 * take one undo for the whole set.
 */

import { useMemo, useState } from "react";
import { addDays, format, nextSaturday } from "date-fns";
import type { Task } from "../../lib/types";
import { parseCapture, routeKey } from "../../lib/nlp";
import { fmtDayLabel, fmtDayTime, nextWeekISO, toDateISO, todayISO, tomorrowISO } from "../../lib/dates";
import type { useTaskMutations } from "../../hooks/useTasks";
import { useOptionalUndoStack } from "../../hooks/useUndoStack";
import { useCaptureEnv } from "../../hooks/useTaskCapture";
import RowMenu, { type RowMenuItem } from "./RowMenu";

type Mutations = ReturnType<typeof useTaskMutations>;

/** Patch each target with its own post-image, as one undoable act. */
function usePatchEach(mutations: Mutations) {
  const { recordUndo } = useOptionalUndoStack();
  return (targets: Task[], patchOf: (t: Task) => Partial<Task>, label: string) => {
    const before = targets.map((t) => {
      const patch = patchOf(t);
      const snap: Partial<Task> = {};
      for (const k of Object.keys(patch) as (keyof Task)[]) (snap as Record<string, unknown>)[k] = t[k];
      return { t, patch, snap };
    });
    for (const b of before) mutations.patchTask(b.t.id, b.patch, { undo: false });
    recordUndo({
      label,
      shortLabel: label,
      tier: "toast",
      undo: () => before.forEach((b) => mutations.patchTask(b.t.id, b.snap, { undo: false })),
      redo: () => before.forEach((b) => mutations.patchTask(b.t.id, b.patch, { undo: false })),
    });
  };
}

const noun = (targets: Task[]) => (targets.length === 1 ? targets[0].title : `${targets.length} tasks`);

export function TaskDateMenu({
  anchor,
  targets,
  mutations,
  onClose,
}: {
  anchor: DOMRect;
  targets: Task[];
  mutations: Mutations;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const patchEach = usePatchEach(mutations);

  const planFor = (date: string) =>
    patchEach(
      targets,
      () => ({ status: "planned", do_date: date, start_time: null, slot_id: null }),
      `${noun(targets)} — ${fmtDayLabel(date)}`,
    );

  const items = useMemo<RowMenuItem[]>(() => {
    const today = todayISO();
    const presets: { label: string; date: string | null }[] = [
      { label: "Today", date: today },
      { label: "Tomorrow", date: tomorrowISO() },
      { label: "This weekend", date: toDateISO(nextSaturday(addDays(new Date(), -1))) },
      { label: "Next week", date: nextWeekISO() },
      { label: "No date", date: null },
    ];
    const out: RowMenuItem[] = [];
    const q = query.trim();
    if (q) {
      // Typed words mean what they mean in any add box: "fri 2pm", "next week".
      const p = parseCapture(q);
      if (p.doDate) {
        const single = targets.length === 1 ? targets[0] : null;
        if (p.startTime && single) {
          const start = p.startTime;
          out.push({
            id: "typed",
            label: fmtDayTime(start.toISOString()),
            hint: "↵",
            run: () => mutations.block(single, start, p.durationMinutes ?? undefined, { undo: "toast" }),
          });
        } else {
          const date = p.doDate;
          out.push({ id: "typed", label: fmtDayLabel(date), hint: "↵", run: () => planFor(date) });
        }
      }
    }
    for (const pre of presets) {
      if (q && !pre.label.toLowerCase().includes(q.toLowerCase()) && out.length) continue;
      const date = pre.date;
      out.push({
        id: pre.label,
        label: pre.label,
        hint: date ? format(new Date(`${date}T12:00:00`), "EEE") : undefined,
        run: date
          ? () => planFor(date)
          : () => targets.forEach((t) => mutations.backToInbox(t, { undo: "toast" })),
      });
    }
    return out;
  }, [query, targets, mutations]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <RowMenu
      anchor={anchor}
      title={targets.length > 1 ? `When — ${targets.length} tasks` : "When"}
      placeholder="Type a day — tom, fri 2pm, next week"
      query={query}
      onQuery={setQuery}
      items={items}
      empty="Type a day, or pick one"
      onClose={onClose}
    />
  );
}

export function TaskMoveMenu({
  anchor,
  targets,
  mutations,
  onClose,
}: {
  anchor: DOMRect;
  targets: Task[];
  mutations: Mutations;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const env = useCaptureEnv();
  const patchEach = usePatchEach(mutations);

  const items = useMemo<RowMenuItem[]>(() => {
    const q = routeKey(query);
    const out: RowMenuItem[] = [];
    const matches = (s: string) => !q || routeKey(s).includes(q);
    if (matches("inbox")) {
      out.push({ id: "inbox", label: "Inbox", hint: "triage", run: () => targets.forEach((t) => mutations.backToInbox(t, { undo: "toast" })) });
    }
    const slotted = targets.filter((t) => t.slot_id);
    if (slotted.length && matches("out of slot")) {
      out.push({
        id: "unslot",
        label: "Out of this slot",
        hint: "keeps its day",
        run: () => slotted.forEach((t) => mutations.removeFromSlot(t, { undo: "toast" })),
      });
    }
    const rank = { project: 0, initiative: 1, domain: 2 } as const;
    const homes = env.routeTargets
      .filter((h) => matches(h.name))
      .sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name))
      .slice(0, 40);
    for (const h of homes) {
      out.push({
        id: `${h.kind}:${h.id}`,
        label: h.name,
        hint: h.kind,
        swatch: env.colorOf(h),
        run: () =>
          patchEach(
            targets,
            (t) => {
              // A task carries its home's whole thread (D-088), and filed work
              // leaves triage for the home's backlog.
              const resting = t.status === "inbox" ? { status: "backlog" as const } : {};
              if (h.kind === "project") {
                const home = env.homeOfProject(h.id);
                return { project_id: h.id, initiative_id: home?.initiativeId ?? null, domain_id: home?.domainId ?? null, ...resting };
              }
              if (h.kind === "initiative") {
                return { project_id: null, initiative_id: h.id, domain_id: env.homeOfInitiative(h.id)?.domainId ?? null, ...resting };
              }
              return { project_id: null, initiative_id: null, domain_id: h.id, ...resting };
            },
            `${noun(targets)} → ${h.name}`,
          ),
      });
    }
    return out;
  }, [query, targets, env, mutations]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <RowMenu
      anchor={anchor}
      title={targets.length > 1 ? `Move ${targets.length} tasks` : "Move to"}
      placeholder="Project, initiative or domain…"
      query={query}
      onQuery={setQuery}
      items={items}
      onClose={onClose}
    />
  );
}

/** Set priority (keys 1–4) as one undoable act. */
export function usePriorityAct(mutations: Mutations) {
  const patchEach = usePatchEach(mutations);
  return (targets: Task[], priority: Task["priority"]) =>
    patchEach(targets, () => ({ priority }), `${noun(targets)} — ${priority === "none" ? "no" : priority} priority`);
}

/** Rename as a one-step undo. */
export function useRenameAct(mutations: Mutations) {
  const patchEach = usePatchEach(mutations);
  return (t: Task, title: string) => patchEach([t], () => ({ title }), `Renamed — ${title}`);
}

