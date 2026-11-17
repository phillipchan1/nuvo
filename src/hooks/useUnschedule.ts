// Unschedule — take work off the calendar as ONE act (D-248).
//
// The write is `backToInbox` (D-063a's routing: loose work to the Inbox,
// project work to its project's backlog). What this adds is the shape of the
// act: any number of tasks and slots, one undo entry, and one toast that names
// where the work went and what was kept (`lib/unschedule.ts`).
//
// A slot unschedules too: its tasks go back, and a one-off slot comes off the
// calendar. A standing slot keeps its place — it is a rhythm, not today's plan.
//
// The block menus, the calendar's selection and the bulk bar on both shells all
// go through here, so "clear my afternoon" can't mean three things.

import { useCallback } from "react";
import type { useTaskMutations } from "./useTasks";
import type { useSlotMutations } from "./useSlots";
import { useOptionalUndoStack } from "./useUndoStack";
import { useOptionalVertical } from "./useVertical";
import { projectById } from "../lib/vertical";
import { isUnschedulable, unscheduleDestination, unscheduleSummary, type LeftAlone } from "../lib/unschedule";
import { toast } from "sonner";
import type { Slot, Task } from "../lib/types";

type Mutations = ReturnType<typeof useTaskMutations>;
type SlotMutations = Pick<ReturnType<typeof useSlotMutations>, "removeSlot" | "createSlot">;

/** A slot to unschedule, with the tasks sitting in it. */
export interface SlotToClear {
  slot: Slot;
  children: readonly Task[];
}

export function useUnschedule(mutations: Mutations, slotMutations?: SlotMutations) {
  const { recordUndo } = useOptionalUndoStack();
  const vertical = useOptionalVertical()?.data;

  return useCallback(
    (tasks: readonly Task[], left: LeftAlone = {}, slots: readonly SlotToClear[] = []) => {
      // A one-off slot comes off; a standing one keeps its place (its tasks still go).
      const clearing = slotMutations ? slots.filter((s) => !s.slot.recurrence_id).map((s) => s.slot) : [];
      const kept = slots.length - clearing.length;
      const seen = new Set<string>();
      const moving = [...tasks, ...slots.flatMap((s) => s.children)].filter((t) => {
        if (seen.has(t.id) || !isUnschedulable(t)) return false;
        seen.add(t.id);
        return true;
      });
      const label = unscheduleSummary(
        moving.map((t) => unscheduleDestination(t, (id) => (vertical ? projectById(vertical, id)?.name : undefined))),
        { ...left, slots: (left.slots ?? 0) + kept },
        clearing.length,
      );
      if (!moving.length && !clearing.length) {
        toast(label);
        return;
      }
      const before = moving.map((t) => ({
        id: t.id,
        snap: { status: t.status, do_date: t.do_date, start_time: t.start_time, slot_id: t.slot_id },
      }));
      const n = moving.length + clearing.length;
      // `undo: false` on each write — the whole set takes ONE entry, below.
      const run = () => {
        for (const t of moving) mutations.backToInbox(t, { undo: false });
        for (const s of clearing) slotMutations?.removeSlot(s);
      };
      run();
      recordUndo({
        label,
        shortLabel: n === 1 ? "Unscheduled" : `Unscheduled ${n}`,
        tier: "toast",
        undo: () => {
          // The slots first, as themselves (same id), so their tasks have somewhere to return to.
          for (const s of clearing)
            slotMutations?.createSlot({
              id: s.id,
              title: s.title,
              do_date: s.do_date,
              start_time: s.start_time,
              duration_minutes: s.duration_minutes,
              project_id: s.project_id,
              domain_id: s.domain_id,
              color: s.color,
            });
          for (const b of before) mutations.patchTask(b.id, b.snap, { undo: false });
        },
        redo: run,
      });
    },
    [mutations, slotMutations, recordUndo, vertical],
  );
}
