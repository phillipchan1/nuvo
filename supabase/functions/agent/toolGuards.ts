// The guarantees that must not depend on the model reading a description.
//
// 22 of the 38 tools accepted a call with NO arguments at all — `complete_task`
// with no task, `cancel_event` with no event, `update_project` with no project.
// The schema can't express "id or title, at least one" portably, so it was left
// to the prompt, which means it held only as long as the model cooperated.
//
// These run before the handler touches the database. A rejection here is a
// normal tool error: the loop feeds it back and the model gets to correct
// itself in the same turn (loop.ts), so the cost of being strict is a round,
// not a failed request.
//
// Zero imports, zero Deno globals — the battery runs them directly.

/** For each tool, the argument names that can identify what it acts on. A call
 *  carrying none of them has no target and must not reach a handler. */
export const REQUIRES_TARGET: Record<string, string[]> = {
  add_to_slot: ["slot_id", "slot_title"],
  reschedule_slot: ["slot_id", "slot_title"],
  delete_slot: ["slot_id", "slot_title"],
  unschedule_task: ["task_id", "task_title"],
  complete_task: ["task_id", "task_title"],
  trash_task: ["task_id", "task_title"],
  move_to_inbox: ["task_id", "task_title"],
  update_task: ["task_id", "task_title"],
  cancel_event: ["event_id", "event_title"],
  decline_event: ["event_id", "event_title"],
  rsvp_event: ["event_id", "event_title"],
  duplicate_event: ["event_id", "event_title"],
  update_priority: ["priority_id", "priority_title", "project_id"],
  complete_priority: ["priority_id", "priority_title", "project_id"],
  delete_priority: ["priority_id", "priority_title", "project_id"],
  update_domain: ["domain_id", "domain_name"],
  delete_domain: ["domain_id", "domain_name"],
  update_initiative: ["initiative_id", "initiative_name"],
  delete_initiative: ["initiative_id", "initiative_ids", "initiative_name", "delete_all_matching"],
  update_project: ["project_id", "project_name"],
  delete_project: ["project_id", "project_ids", "project_name", "delete_all_matching"],
  update_key_result: ["key_result_id"],
  // Not a lookup, but the same failure: a task with neither a capture string nor
  // a title is an empty row the user never asked for.
  create_task: ["capture", "title"],
  create_recurring_task: ["capture", "title"],
  // schedule_task's schema requires only start_time — so "schedule something at
  // 2pm" with no subject passed validation and reached the handler.
  schedule_task: ["task_id", "task_title"],
  plan_task: ["task_id", "task_title"],
  reschedule_task: ["task_id", "task_title"],
  // A reminder with no subject would attach to nothing; `set_reminder` also
  // requires lead_minutes in its schema, so this is the other half of its pair.
  set_reminder: ["task_id", "task_title", "event_id", "event_title", "slot_id"],
  restore_task: ["task_id", "task_title"],
  // A checklist with no task to hang on is nothing at all.
  add_step: ["task_id", "task_title"],
  complete_step: ["task_id", "task_title"],
  list_steps: ["task_id", "task_title"],
  remove_step: ["task_id", "task_title"],
  // Permanent and unrecoverable — it must never fire on a guess.
  purge_task: ["task_id", "task_title"],
  clear_reminder: ["task_id", "task_title", "event_id", "event_title", "slot_id"],
};

function present(args: Record<string, unknown>, key: string): boolean {
  const v = args[key];
  if (v == null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "boolean") return v;
  return true;
}

/** Null when the call is fine; otherwise the error the model should read back. */
export function targetError(name: string, args: Record<string, unknown>): string | null {
  const keys = REQUIRES_TARGET[name];
  if (!keys) return null;
  if (keys.some((k) => present(args, k))) return null;
  return `${name} needs something to act on — pass one of: ${keys.join(", ")}. ` +
    `Nothing was changed. Look the item up in your context (or with list_vertical / list_tasks) and call again with an id.`;
}
