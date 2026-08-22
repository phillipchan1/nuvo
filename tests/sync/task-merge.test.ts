import { describe, expect, it } from "vitest";

import { mergeTaskLists } from "../../src/lib/taskMerge";
import type { Task } from "../../src/lib/types";

function task(over: Partial<Task> & Pick<Task, "id" | "status" | "updated_at">): Task {
  return {
    user_id: "u",
    created_at: "2026-08-10T20:00:00.000Z",
    title: "Call David",
    notes: "",
    do_date: "2026-08-21",
    start_time: "2026-08-21T18:00:00.000Z",
    duration_minutes: 30,
    deadline: null,
    priority: "none",
    roll_count: 0,
    completed_at: null,
    trashed_at: null,
    project_id: null,
    initiative_id: null,
    domain_id: null,
    key_result_id: null,
    sprint_id: null,
    big_rock_id: null,
    energy: null,
    assignee: "me",
    prework: "",
    prework_at: null,
    suggestion: null,
    suggested_at: null,
    google_event_id: null,
    sort_order: 0,
    slot_id: null,
    parent_task_id: null,
    recurrence_id: null,
    recurrence_date: null,
    recurrence_overridden: false,
    ...over,
  };
}

describe("mergeTaskLists", () => {
  it("prefers a newer complete over an older scheduled copy", () => {
    const done = task({
      id: "t1",
      status: "done",
      updated_at: "2026-08-21T21:05:00.000Z",
      completed_at: "2026-08-21T21:05:00.000Z",
    });
    const stale = task({ id: "t1", status: "planned", updated_at: "2026-08-21T21:00:00.000Z" });
    const map = mergeTaskLists([[done], [stale]]);
    expect(map.get("t1")?.status).toBe("done");
  });

  it("drops a row when the newest copy is trashed, even if an older fragment still has it", () => {
    const live = task({ id: "t1", status: "planned", updated_at: "2026-08-21T21:00:00.000Z" });
    const trashed = task({
      id: "t1",
      status: "trashed",
      updated_at: "2026-08-21T21:05:00.000Z",
      trashed_at: "2026-08-21T21:05:00.000Z",
    });
    const map = mergeTaskLists([[trashed], [live]]);
    expect(map.has("t1")).toBe(false);
  });

  it("keeps an inboxed row over an older calendar copy", () => {
    const inbox = task({
      id: "t1",
      status: "inbox",
      do_date: null,
      start_time: null,
      updated_at: "2026-08-21T21:05:00.000Z",
    });
    const cal = task({ id: "t1", status: "planned", updated_at: "2026-08-21T21:00:00.000Z" });
    const map = mergeTaskLists([[inbox], [cal]]);
    expect(map.get("t1")?.status).toBe("inbox");
    expect(map.get("t1")?.start_time).toBeNull();
  });
});
