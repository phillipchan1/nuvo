// Hand-off (D-250) — the app side of the rule: a task an agent has is not the
// operator's hour. The Worker's SQL is pinned by worker/src/handoff.check.ts.

import { describe, expect, it } from "vitest";
import { dayReadiness, isHandedOff } from "../supabase/functions/_shared/planningRules";
import { buildHandoffBrief, cleanNote, doorbellBody, parseReportOutcome } from "../supabase/functions/_shared/handoff";
import { sprintLoadMins, toVTask, type VerticalData } from "../src/lib/vertical";
import { readDay } from "../src/lib/marks";
import type { Task } from "../src/lib/types";

const task = (o: Partial<Task>): Task =>
  ({
    id: "t1", user_id: "u", created_at: "", updated_at: "", title: "T", notes: "", status: "planned",
    do_date: "2026-11-18", start_time: null, duration_minutes: 60, deadline: null, priority: "none", roll_count: 0,
    completed_at: null, trashed_at: null, project_id: null, initiative_id: null, domain_id: null, key_result_id: null,
    sprint_id: "s1", big_rock_id: null, energy: null, assignee: "me", prework: "", prework_at: null, suggestion: null,
    suggested_at: null, google_event_id: null, sort_order: 0, slot_id: null, parent_task_id: null, recurrence_id: null,
    recurrence_date: null, recurrence_overridden: false, ...o,
  }) as Task;

describe("hand-off — the kernel rule", () => {
  it("a task is with an agent while it's open and handed", () => {
    expect(isHandedOff({ handed_to: "a", status: "planned" })).toBe(true);
    expect(isHandedOff({ handed_to: "a", status: "done" })).toBe(false);
    expect(isHandedOff({ handed_to: null, status: "planned" })).toBe(false);
    expect(isHandedOff({ status: "planned" })).toBe(false);
  });

  it("a handed task leaves the week's load; the same task done by the agent is not 'with' it", () => {
    const mine = toVTask(task({ id: "a" }), "s1", "2026-11-17");
    const handed = toVTask(task({ id: "b", handed_to: "grok" }), "s1", "2026-11-17");
    expect(mine.assignee).toBe("me");
    expect(handed.assignee).toBe("agent");
    const d = { tasks: [mine, handed] } as unknown as VerticalData;
    expect(sprintLoadMins(d)).toBe(60);
  });
});

describe("hand-off — the day", () => {
  it("an agent's task isn't the operator's day, open or done by it", () => {
    const dt = (id: string, status: string, handedTo: string | null) =>
      ({ id, status, completedAt: status === "done" ? "2026-11-18T10:00:00Z" : null, rollCount: 0, recurrenceId: null, handedTo });
    expect(dayReadiness([dt("a", "planned", null), dt("b", "planned", "grok")])).toMatchObject({ total: 1, done: 0 });
    expect(dayReadiness([dt("a", "done", null), dt("b", "done", "grok")])).toMatchObject({ total: 1, closed: true });
    const day = readDay([task({ id: "a" }), task({ id: "b", handed_to: "grok" })], 990);
    expect(day.tasks.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("hand-off — what the agent is told", () => {
  it("the doorbell never carries a task", () => {
    expect(doorbellBody(1).message).toMatch(/1 task handed/);
    expect(Object.keys(doorbellBody(3))).toEqual(["source", "message"]);
  });

  it("notes are trimmed and capped; outcomes are done or back", () => {
    expect(cleanNote("  hi \r\n there ", 100)).toBe("hi \n there");
    expect(cleanNote("x".repeat(20), 10)).toHaveLength(10);
    expect(cleanNote(42, 10)).toBe("");
    expect(parseReportOutcome("done")).toBe("done");
    expect(parseReportOutcome("open")).toBeNull();
  });

  it("the brief orders steps, lists the project's other open work, and the history", () => {
    const b = buildHandoffBrief({
      task: { id: "t1", title: "Draft", notes: "", roll_count: 2, priority: "high" },
      handoff: { note: "use Q3", created_at: new Date("2026-11-17T00:00:00Z") },
      agentName: "Grok Bot",
      steps: [{ title: "second", sort_order: 2, status: "planned" }, { title: "first", sort_order: 1, status: "done" }],
      project: { name: "Report", outcome: "Board has it", status: "active" },
      projectTasks: [
        { id: "t1", title: "Draft", status: "planned" },
        { id: "t2", title: "Book room", status: "planned" },
        { id: "t3", title: "Old", status: "done", completed_at: "2026-11-01" },
        { id: "t4", title: "Gone", status: "trashed" },
      ],
      domain: { name: "Work" },
      history: [{ outcome: "back", note: "", agent_note: "needed a login", closed_at: "2026-11-16" }],
      link: "https://app/?task=t1",
    });
    expect(b.task.steps.map((s) => s.title)).toEqual(["first", "second"]);
    expect(b.task.steps[0].done).toBe(true);
    expect(b.task.notes).toBeNull();
    expect(b.task.times_rolled).toBe(2);
    expect(b.project?.other_open_work).toEqual(["Book room"]);
    expect(b.project?.recently_done).toEqual(["Old"]);
    expect(b.earlier_handoffs[0].agent_note).toBe("needed a login");
    expect(b.note_from_operator).toBe("use Q3");
    expect(b.handed_at).toBe("2026-11-17T00:00:00.000Z");
  });
});
