// The acts behind the bulk bar, built once so the rail and the phone can't
// drift into two ideas of what "move these to a project" does.
//
// The load-bearing decision: **one undo entry for the whole set.** Each task's
// write is its own queued op (idempotent, offline-safe), but they are recorded
// as a single reversible act — a bulk edit that needed eight ⌘Z presses to walk
// back would be a worse trap than having no bulk action at all.

import { useMemo } from "react";
import type { useTaskMutations } from "./useTasks";
import { useOptionalUndoStack } from "./useUndoStack";
import type { BulkOps } from "../components/BulkBar";
import type { Task } from "../lib/types";

type Mutations = ReturnType<typeof useTaskMutations>;

/** Fields a bulk patch restores when it is undone — recorded per task BEFORE
 *  the write, so undo puts each row back where it individually was rather than
 *  where the majority was. */
const SNAP_KEYS = [
  "priority",
  "project_id",
  "initiative_id",
  "domain_id",
  "do_date",
  "start_time",
  "slot_id",
  "status",
] as const;

export function useBulkOps({
  selected,
  mutations,
  clear,
}: {
  /** The tasks the bar is acting on, resolved by the surface. */
  selected: Task[];
  mutations: Mutations;
  clear: () => void;
}): BulkOps {
  const { recordUndo } = useOptionalUndoStack();

  return useMemo<BulkOps>(() => {
    const n = selected.length;
    const noun = `${n} task${n === 1 ? "" : "s"}`;

    const patchAll = (patch: Partial<Task>, verb: string) => {
      if (!n) return;
      const before = selected.map((t) => {
        const snap: Partial<Task> = {};
        for (const k of SNAP_KEYS) {
          if (k in patch) (snap as Record<string, unknown>)[k] = t[k];
        }
        return { id: t.id, snap };
      });
      // `undo: false` on each write — the whole set takes ONE entry, below.
      for (const t of selected) mutations.patchTask(t.id, patch, { undo: false });
      recordUndo({
        label: `${noun} ${verb}`,
        shortLabel: verb,
        tier: "toast",
        undo: () => {
          for (const b of before) mutations.patchTask(b.id, b.snap, { undo: false });
        },
        redo: () => {
          for (const t of selected) mutations.patchTask(t.id, patch, { undo: false });
        },
      });
    };

    return {
      patchAll,
      planFor: (dateISO) => patchAll({ status: "planned", do_date: dateISO, start_time: null, slot_id: null }, "planned"),
      addLabels: (labelIds) => {
        // Additive only. A control that could also strip labels in bulk is how
        // you lose ones you never looked at, and `setLabels` has no undo hook
        // of its own — so this stays the one bulk act that only ever adds.
        for (const t of selected) {
          const current = (t.task_labels ?? []).map((l) => l.label_id);
          const next = Array.from(new Set([...current, ...labelIds]));
          if (next.length !== current.length) void mutations.setLabels(t.id, next);
        }
      },
      complete: () => {
        for (const t of selected) mutations.complete(t, { undo: false });
        recordUndo({
          label: `Marked ${noun} done`,
          shortLabel: "marked done",
          tier: "toast",
          undo: () => {
            for (const t of selected) mutations.uncomplete(t, { undo: false });
          },
          redo: () => {
            for (const t of selected) mutations.complete(t, { undo: false });
          },
        });
        clear();
      },
      backToInbox: () => {
        for (const t of selected) mutations.backToInbox(t, { undo: "toast" });
        clear();
      },
      trash: () => {
        for (const t of selected) mutations.trash(t, { undo: "toast" });
        clear();
      },
      clear,
    };
  }, [selected, mutations, recordUndo, clear]);
}
