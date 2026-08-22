import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { patchCaches } from "../../src/hooks/useTasks";
import {
  catchUpAfterOwingKnown,
  installOwingGuards,
  markOwing,
  refreshOwing,
  resetOwingForTests,
} from "../../src/lib/sync/coordinator";
import type { Task } from "../../src/lib/types";

afterEach(() => {
  resetOwingForTests();
});

function task(over: Partial<Task> & Pick<Task, "id">): Task {
  return {
    user_id: "u",
    created_at: "2026-08-10T20:00:00.000Z",
    updated_at: "2026-08-21T21:00:00.000Z",
    title: "Call David",
    notes: "",
    status: "planned",
    do_date: "2026-08-21",
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

describe("owing preserve vs local trash", () => {
  it("drops a trashed task from the day list even while the outbox owes a write", () => {
    // The production QueryClient installs preserveOwingRows as structuralSharing
    // on every tasks query. A membership drop (trash leaving Today) used to get
    // glued back on as a "local-only extra" whenever the table was already
    // owing — toast fired, the row stayed.
    const qc = new QueryClient();
    installOwingGuards(qc);
    const row = task({ id: "t1" });
    qc.setQueryData(["tasks", "day", "2026-08-21"], [row]);
    qc.setQueryData(["tasks", "all"], [row]);
    markOwing("tasks");

    patchCaches(qc, "t1", { status: "trashed", trashed_at: "2026-08-21T21:05:00.000Z" });

    const day = qc.getQueryData<Task[]>(["tasks", "day", "2026-08-21"]) ?? [];
    expect(day.find((t) => t.id === "t1")).toBeUndefined();
    const all = qc.getQueryData<Task[]>(["tasks", "all"]) ?? [];
    expect(all.find((t) => t.id === "t1")?.status).toBe("trashed");
  });

  it("drops a time-block from the calendar when it returns to the inbox, even while owing", () => {
    // Desktop: drag a calendar block onto the rail. The write lands (the phone
    // paints it), but preserveOwingRows used to glue the scheduled row back
    // onto this device until the outbox drained — minutes of a ghost block.
    const qc = new QueryClient();
    installOwingGuards(qc);
    const row = task({
      id: "t1",
      status: "planned",
      do_date: "2026-08-21",
      start_time: "2026-08-21T18:00:00.000Z",
    });
    const range = ["tasks", "scheduled", "2026-08-17T07:00:00.000Z", "2026-08-24T07:00:00.000Z"] as const;
    qc.setQueryData(range, [row]);
    qc.setQueryData(["tasks", "inbox"], [] as Task[]);
    qc.setQueryData(["tasks", "all"], [row]);
    markOwing("tasks");

    patchCaches(qc, "t1", {
      status: "inbox",
      do_date: null,
      start_time: null,
      slot_id: null,
    });

    const scheduled = qc.getQueryData<Task[]>(range) ?? [];
    expect(scheduled.find((t) => t.id === "t1")).toBeUndefined();
    const inbox = qc.getQueryData<Task[]>(["tasks", "inbox"]) ?? [];
    expect(inbox.find((t) => t.id === "t1")?.status).toBe("inbox");
    expect(inbox.find((t) => t.id === "t1")?.start_time).toBeNull();
  });

  it("marks a task done in every fragment even while owing", () => {
    // Completing is not a membership drop — the row stays on Today and on the
    // calendar. preserveOwingRows used to keep the previous body for same-id
    // rows, so the toast fired and the checkbox snapped back.
    const qc = new QueryClient();
    installOwingGuards(qc);
    const row = task({
      id: "t1",
      status: "planned",
      do_date: "2026-08-21",
      start_time: "2026-08-21T18:00:00.000Z",
    });
    const range = ["tasks", "scheduled", "2026-08-17T07:00:00.000Z", "2026-08-24T07:00:00.000Z"] as const;
    qc.setQueryData(["tasks", "day", "2026-08-21"], [row]);
    qc.setQueryData(range, [row]);
    qc.setQueryData(["tasks", "all"], [row]);
    markOwing("tasks");

    patchCaches(qc, "t1", { status: "done", completed_at: "2026-08-21T21:05:00.000Z" });

    expect(qc.getQueryData<Task[]>(["tasks", "day", "2026-08-21"])?.[0]?.status).toBe("done");
    expect(qc.getQueryData<Task[]>(range)?.[0]?.status).toBe("done");
    expect(qc.getQueryData<Task[]>(["tasks", "all"])?.[0]?.status).toBe("done");
  });
});

describe("catchUpAfterOwingKnown", () => {
  it("does nothing until the outbox has been read", () => {
    resetOwingForTests();
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    catchUpAfterOwingKnown(qc);
    expect(spy).not.toHaveBeenCalled();
  });

  it("refetches stale queries that are not owed, and skips ones that are", async () => {
    await refreshOwing();
    markOwing("tasks");
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue(undefined);
    catchUpAfterOwingKnown(qc);
    expect(spy).toHaveBeenCalledTimes(1);
    const pred = spy.mock.calls[0]?.[0]?.predicate as
      | ((q: { queryKey: readonly unknown[]; isStale: () => boolean }) => boolean)
      | undefined;
    expect(pred).toBeTypeOf("function");
    const stale = (queryKey: readonly unknown[]) => ({ queryKey, isStale: () => true });
    const fresh = (queryKey: readonly unknown[]) => ({ queryKey, isStale: () => false });
    expect(pred!(stale(["tasks", "inbox"]))).toBe(false);
    expect(pred!(stale(["settings"]))).toBe(true);
    expect(pred!(fresh(["settings"]))).toBe(false);
  });
});
