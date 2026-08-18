import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { applyLiveChange } from "../../src/lib/sync/liveApply";
import type { Op } from "../../src/lib/sync/ops";
import type { Task } from "../../src/lib/types";

const RANGE_START = "2026-08-17T07:00:00.000Z";
const RANGE_END = "2026-08-24T07:00:00.000Z";

function task(over: Partial<Task> & Pick<Task, "id">): Task {
  return {
    user_id: "u",
    created_at: "2026-08-10T20:00:00.000Z",
    updated_at: "2026-08-18T19:31:00.000Z",
    title: "Redo Obi Video",
    notes: "",
    status: "planned",
    do_date: "2026-08-17",
    start_time: null,
    duration_minutes: 120,
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

function caches() {
  const qc = new QueryClient();
  const obi = task({ id: "obi" });
  qc.setQueryData(["tasks", "scheduled", RANGE_START, RANGE_END], [] as Task[]);
  qc.setQueryData(["tasks", "day", "2026-08-17"], [obi]);
  qc.setQueryData(["tasks", "day", "2026-08-18"], [] as Task[]);
  qc.setQueryData(["tasks", "all"], [obi]);
  return qc;
}

function op(over: Partial<Op> & Pick<Op, "payload" | "fieldTs">): Op {
  return {
    seq: 1,
    opId: "op",
    table: "tasks",
    kind: "update",
    rowId: "obi",
    ts: "2026-08-18T19:00:00.000Z",
    attempts: 0,
    ...over,
  };
}

describe("applyLiveChange", () => {
  it("places a remote reschedule onto the Schedule immediately", () => {
    const qc = caches();

    const ok = applyLiveChange(qc, {
      table: "tasks",
      eventType: "UPDATE",
      old: { id: "obi" },
      new: {
        ...task({ id: "obi" }),
        do_date: "2026-08-18",
        start_time: "2026-08-18 20:00:00+00",
        duration_minutes: 15,
        field_ts: { start_time: "2026-08-18T19:40:00.000Z", do_date: "2026-08-18T19:40:00.000Z" },
      },
    });

    expect(ok).toBe(true);
    const scheduled = qc.getQueryData<Task[]>(["tasks", "scheduled", RANGE_START, RANGE_END]);
    expect(scheduled).toHaveLength(1);
    expect(scheduled?.[0].start_time).toBe("2026-08-18T20:00:00.000Z");
    expect(scheduled?.[0].duration_minutes).toBe(15);
    expect(qc.getQueryData<Task[]>(["tasks", "day", "2026-08-17"])).toEqual([]);
    expect(qc.getQueryData<Task[]>(["tasks", "day", "2026-08-18"])?.[0].id).toBe("obi");
  });

  it("keeps a queued title edit while taking Friday's newer start_time", () => {
    const qc = caches();

    applyLiveChange(
      qc,
      {
        table: "tasks",
        eventType: "UPDATE",
        old: { id: "obi" },
        new: {
          ...task({ id: "obi", title: "Redo Obi Video" }),
          do_date: "2026-08-18",
          start_time: "2026-08-18T20:00:00.000Z",
          field_ts: {
            title: "2026-08-10T20:00:00.000Z",
            start_time: "2026-08-18T19:40:00.000Z",
          },
        },
      },
      [
        op({
          payload: { title: "Obi, retake" },
          fieldTs: { title: "2026-08-18T19:50:00.000Z" },
        }),
      ],
    );

    const scheduled = qc.getQueryData<Task[]>(["tasks", "scheduled", RANGE_START, RANGE_END]);
    expect(scheduled?.[0].title).toBe("Obi, retake");
    expect(scheduled?.[0].start_time).toBe("2026-08-18T20:00:00.000Z");
  });

  it("does not let an older remote stamp clobber a newer local drag", () => {
    const qc = caches();
    qc.setQueryData(["tasks", "scheduled", RANGE_START, RANGE_END], [
      task({ id: "obi", start_time: "2026-08-18T22:00:00.000Z", do_date: "2026-08-18" }),
    ]);

    applyLiveChange(
      qc,
      {
        table: "tasks",
        eventType: "UPDATE",
        old: { id: "obi" },
        new: {
          ...task({ id: "obi" }),
          do_date: "2026-08-18",
          start_time: "2026-08-18T20:00:00.000Z",
          field_ts: { start_time: "2026-08-18T19:00:00.000Z" },
        },
      },
      [
        op({
          payload: { start_time: "2026-08-18T22:00:00.000Z" },
          fieldTs: { start_time: "2026-08-18T19:55:00.000Z" },
        }),
      ],
    );

    const scheduled = qc.getQueryData<Task[]>(["tasks", "scheduled", RANGE_START, RANGE_END]);
    expect(scheduled?.[0].start_time).toBe("2026-08-18T22:00:00.000Z");
  });
});
