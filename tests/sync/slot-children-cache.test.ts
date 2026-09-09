import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { insertSlotCache } from "../../src/hooks/useSlots";
import { patchCaches, seedSlotChildrenQuery } from "../../src/hooks/useTasks";
import { installOwingGuards } from "../../src/lib/sync/coordinator";
import type { Slot, Task } from "../../src/lib/types";

function task(over: Partial<Task> & Pick<Task, "id">): Task {
  return {
    user_id: "u",
    created_at: "2026-09-08T20:00:00.000Z",
    updated_at: "2026-09-08T20:00:00.000Z",
    title: "Inbox capture",
    notes: "",
    status: "inbox",
    do_date: null,
    start_time: null,
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

function slot(over: Partial<Slot> & Pick<Slot, "id">): Slot {
  return {
    user_id: "u",
    created_at: "2026-09-08T20:00:00.000Z",
    updated_at: "2026-09-08T20:00:00.000Z",
    title: "",
    do_date: "2026-09-08",
    start_time: "2026-09-08T19:00:00.000Z",
    duration_minutes: 60,
    project_id: null,
    domain_id: null,
    color: null,
    google_event_id: null,
    recurrence_id: null,
    recurrence_date: null,
    recurrence_overridden: false,
    ...over,
  };
}

describe("slot children cache — multi-drop from inbox", () => {
  it("lands inbox tasks in the remounted slot query in the same tick", () => {
    // The Schedule keys slot children on the current id set. Dropping several
    // inbox rows onto open time creates a slot (new id → new query key) and
    // assigns the tasks. Without seeding that key first, they leave the inbox
    // and the block reads "empty" until the drain refetch.
    const qc = new QueryClient();
    installOwingGuards(qc);

    const existing = slot({ id: "s-old" });
    const a = task({ id: "t-a", title: "First" });
    const b = task({ id: "t-b", title: "Second" });
    qc.setQueryData(["slots", "range"], [existing]);
    qc.setQueryData(["tasks", "slot", ["s-old"]], [] as Task[]);
    qc.setQueryData(["tasks", "inbox"], [a, b]);
    qc.setQueryData(["tasks", "all"], [a, b]);

    const made = slot({ id: "s-new" });
    insertSlotCache(qc, made);
    patchCaches(qc, "t-a", {
      slot_id: made.id,
      start_time: null,
      do_date: made.do_date,
      status: "planned",
    });
    patchCaches(qc, "t-b", {
      slot_id: made.id,
      start_time: null,
      do_date: made.do_date,
      status: "planned",
    });

    const nextIds = ["s-new", "s-old"].sort();
    const children = qc.getQueryData<Task[]>(["tasks", "slot", nextIds]) ?? [];
    expect(children.map((t) => t.id).sort()).toEqual(["t-a", "t-b"]);
    expect(children.every((t) => t.slot_id === "s-new")).toBe(true);

    const inbox = qc.getQueryData<Task[]>(["tasks", "inbox"]) ?? [];
    expect(inbox.map((t) => t.id)).toEqual([]);
  });

  it("seeds a slot-children query when none is mounted yet", () => {
    const qc = new QueryClient();
    seedSlotChildrenQuery(qc, "s-new");
    expect(qc.getQueryData<Task[]>(["tasks", "slot", ["s-new"]])).toEqual([]);
  });

  it("does not wipe children already written to the remounted key", () => {
    const qc = new QueryClient();
    const a = task({ id: "t-a", title: "First", status: "planned", slot_id: "s-new", do_date: "2026-09-08" });
    qc.setQueryData(["tasks", "slot", ["s-old"]], [] as Task[]);
    qc.setQueryData(["tasks", "slot", ["s-new", "s-old"].sort()], [a]);

    seedSlotChildrenQuery(qc, "s-new");

    const children = qc.getQueryData<Task[]>(["tasks", "slot", ["s-new", "s-old"].sort()]) ?? [];
    expect(children.map((t) => t.id)).toEqual(["t-a"]);
  });
});
