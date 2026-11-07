// What a task / slot block act MEANS, said once for both shells (D-177). The
// desktop reaches these through its right-click menu and keyboard; the phone
// through its sheets. They were inline in `CalendarPane`, which is why the
// phone had no Duplicate at all.

import type { SeriesTemplate, useRecurrenceMutations } from "../hooks/useRecurrence";
import type { useSlotMutations } from "../hooks/useSlots";
import type { useTaskMutations } from "../hooks/useTasks";
import { rulesEqual, type RecurrenceRule } from "./recurrence";
import { ruleOf, type Recurrence, type Slot, type Task } from "./types";

/** Duplicate a task: same place, same clock, same filing. The copy lands
 *  exactly on the original, so callers say it (toast + undo). */
export function duplicateTaskInput(task: Task, clientId: string) {
  return {
    clientId,
    title: task.title,
    notes: task.notes || undefined,
    do_date: task.do_date,
    start_time: task.start_time,
    duration_minutes: task.duration_minutes,
    priority: task.priority !== "none" ? task.priority : undefined,
    domain_id: task.domain_id,
    project_id: task.project_id,
    labelIds: task.task_labels?.map((l) => l.label_id),
  };
}

/** Duplicate a slot: the container only — its tasks stay where they are (a
 *  task lives in one slot), and a copy of a series occurrence is a one-off. */
export function duplicateSlotInput(slot: Slot) {
  return {
    title: slot.title,
    do_date: slot.do_date,
    start_time: slot.start_time,
    duration_minutes: slot.duration_minutes,
    project_id: slot.project_id,
    domain_id: slot.domain_id,
    color: slot.color,
  };
}

// ── Slot acts that touch a series ──────────────────────────────────────────

type RecurrenceMutations = ReturnType<typeof useRecurrenceMutations>;

/** Set, change or stop a slot's repeat. Its template is the slot as it stands. */
export function applySlotRepeat(
  recurrenceMutations: RecurrenceMutations,
  slot: Slot,
  recurrence: Recurrence | null,
  rule: RecurrenceRule | null,
) {
  if (rulesEqual(recurrence ? ruleOf(recurrence) : null, rule)) return;
  const start = new Date(slot.start_time);
  const template: SeriesTemplate = {
    title: slot.title,
    duration_minutes: slot.duration_minutes,
    time_of_day_minutes: start.getHours() * 60 + start.getMinutes(),
    project_id: slot.project_id,
    domain_id: slot.domain_id,
    color: slot.color,
  };
  if (rule && !recurrence) void recurrenceMutations.convertToSeries("slot", slot, rule, template);
  else if (rule && recurrence) void recurrenceMutations.updateSeries(recurrence, rule, template);
  else if (!rule && recurrence) void recurrenceMutations.stopSeries(recurrence, slot.do_date);
}

export type SlotDeleteScopeAct = "simple" | "this" | "following" | "series";

/** Delete a slot — one block, or a series from here / whole. Its tasks are kept
 *  by default (the FK sets `slot_id` null and they fall back onto the day), or
 *  trashed with it when asked. */
export function deleteSlotScoped(
  m: {
    slotMutations: ReturnType<typeof useSlotMutations>;
    recurrenceMutations: RecurrenceMutations;
    taskMutations: ReturnType<typeof useTaskMutations>;
  },
  slot: Slot,
  recurrence: Recurrence | null,
  tasks: Task[],
  scope: SlotDeleteScopeAct,
  deleteTasks: boolean,
) {
  if (deleteTasks) tasks.forEach((t) => m.taskMutations.trash(t));
  if (scope === "series") {
    if (recurrence) m.recurrenceMutations.deleteSeries(recurrence);
  } else if (scope === "following") {
    if (recurrence) m.recurrenceMutations.deleteFollowing(recurrence, slot.do_date);
  } else {
    if (scope === "this" && recurrence && slot.recurrence_date)
      m.recurrenceMutations.skipOccurrence(recurrence, slot.recurrence_date);
    m.slotMutations.removeSlot(slot);
  }
}
