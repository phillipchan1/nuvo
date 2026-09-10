import { describe, expect, it } from "vitest";
import { resolveCompleteTarget } from "../src/lib/completeTarget";
import type { Task } from "../src/lib/types";

function task(over: Partial<Task> & Pick<Task, "id">): Task {
  return {
    user_id: "u",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-10T00:00:00.000Z",
    title: "Fill in Timesheet",
    notes: "",
    status: "planned",
    do_date: "2026-09-10",
    start_time: null,
    duration_minutes: 15,
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
    recurrence_id: "series-1",
    recurrence_date: over.do_date ?? "2026-09-10",
    recurrence_overridden: false,
    ...over,
  };
}

const TODAY = "2026-09-10";
const THIS = task({ id: "this-thu", do_date: "2026-09-10", recurrence_date: "2026-09-10" });
const NEXT = task({ id: "next-thu", do_date: "2026-09-17", recurrence_date: "2026-09-17" });

describe("resolveCompleteTarget", () => {
  it("completes today's occurrence when the chip was next week's sibling", () => {
    expect(resolveCompleteTarget(NEXT, [THIS, NEXT], TODAY).id).toBe("this-thu");
  });

  it("leaves a same-day check on the row that was clicked", () => {
    expect(resolveCompleteTarget(THIS, [THIS, NEXT], TODAY).id).toBe("this-thu");
  });

  it("does not steal a past occurrence — overdue stays the click target", () => {
    const last = task({ id: "last-thu", do_date: "2026-09-03", recurrence_date: "2026-09-03" });
    expect(resolveCompleteTarget(last, [last, THIS], TODAY).id).toBe("last-thu");
  });

  it("does not redirect when today's sibling is already done", () => {
    const doneToday = task({
      id: "this-thu",
      do_date: "2026-09-10",
      status: "done",
      completed_at: "2026-09-10T16:00:00.000Z",
    });
    expect(resolveCompleteTarget(NEXT, [doneToday, NEXT], TODAY).id).toBe("next-thu");
  });

  it("leaves a one-off task alone", () => {
    const one = task({ id: "once", recurrence_id: null, recurrence_date: null });
    expect(resolveCompleteTarget(one, [one], TODAY).id).toBe("once");
  });
});
