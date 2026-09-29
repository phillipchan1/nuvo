import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { insertTaskCache, putTaskInCaches } from "../../src/hooks/useTasks";
import type { Task } from "../../src/lib/types";

/**
 * The cache reconciler has to agree with the queryFns it stands in for. Two
 * disagreements put a recurring task's checklist on the Week board as loose
 * work: steps were placed in lists whose queries exclude them, and the
 * disabled `["tasks","sprint",null]` list (a week with no sprint row) matched
 * every sprintless task — and since it never refetches and the cache is
 * persisted, nothing ever took them out again.
 */

function task(over: Partial<Task> & Pick<Task, "id">): Task {
  return {
    user_id: "u",
    created_at: "2026-09-28T18:31:00+00:00",
    updated_at: "2026-09-28T18:31:00+00:00",
    title: "A task",
    notes: "",
    status: "backlog",
    do_date: null,
    start_time: null,
    duration_minutes: null,
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
    task_labels: [],
    ...over,
  } as Task;
}

const ids = (qc: QueryClient, key: unknown[]) =>
  (qc.getQueryData<Task[]>(key) ?? []).map((t) => t.id);

describe("task cache membership", () => {
  it("keeps a step out of every list but its parent's steps", () => {
    const qc = new QueryClient();
    qc.setQueryData(["tasks", "all"], []);
    qc.setQueryData(["tasks", "inbox"], []);
    qc.setQueryData(["tasks", "sprint", "s1"], []);
    qc.setQueryData(["tasks", "steps", "p1"], []);

    putTaskInCaches(qc, "step", task({ id: "step", parent_task_id: "p1", sprint_id: "s1" }));

    expect(ids(qc, ["tasks", "steps", "p1"])).toEqual(["step"]);
    expect(ids(qc, ["tasks", "all"])).toEqual([]);
    expect(ids(qc, ["tasks", "inbox"])).toEqual([]);
    expect(ids(qc, ["tasks", "sprint", "s1"])).toEqual([]);
  });

  it("evicts a step already sitting in a list it never belonged to", () => {
    const qc = new QueryClient();
    const stale = task({ id: "step", parent_task_id: "p1", title: "old" });
    qc.setQueryData(["tasks", "all"], [stale]);

    putTaskInCaches(qc, "step", { ...stale, title: "new" });

    expect(ids(qc, ["tasks", "all"])).toEqual([]);
  });

  it("never fills a null-keyed (disabled) sprint or steps list", () => {
    const qc = new QueryClient();
    qc.setQueryData(["tasks", "sprint", null], []);
    qc.setQueryData(["tasks", "steps", null], []);

    putTaskInCaches(qc, "loose", task({ id: "loose" }));

    expect(ids(qc, ["tasks", "sprint", null])).toEqual([]);
    expect(ids(qc, ["tasks", "steps", null])).toEqual([]);
  });

  it("still places a task in the sprint it is committed to", () => {
    const qc = new QueryClient();
    qc.setQueryData(["tasks", "sprint", "s1"], []);

    putTaskInCaches(qc, "t", task({ id: "t", sprint_id: "s1", status: "planned" }));

    expect(ids(qc, ["tasks", "sprint", "s1"])).toEqual(["t"]);
  });

  it("insertTaskCache respects membership and never seeds an unfetched list", () => {
    const qc = new QueryClient();
    qc.setQueryData(["tasks", "all"], []);
    qc.setQueryData(["tasks", "inbox"], []);
    // Registered but never fetched — a disabled query.
    qc.getQueryCache().build(qc, { queryKey: ["tasks", "sprint", null] });

    const occurrence = task({ id: "occ", status: "planned", do_date: "2026-11-02", recurrence_id: "r1" });
    insertTaskCache(qc, occurrence);

    expect(ids(qc, ["tasks", "all"])).toEqual(["occ"]);
    expect(ids(qc, ["tasks", "inbox"])).toEqual([]);
    expect(qc.getQueryData(["tasks", "sprint", null])).toBeUndefined();
  });
});
