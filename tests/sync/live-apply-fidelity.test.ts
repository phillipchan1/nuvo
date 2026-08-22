import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { applyLiveChange } from "../../src/lib/sync/liveApply";
import type { Op } from "../../src/lib/sync/ops";
import type { Task } from "../../src/lib/types";

/**
 * Two ways a Realtime payload can be *worse* than no payload at all.
 *
 * Realtime delivers the raw table row. It has no joins, so anything the query
 * assembles — `task_labels` above all — is simply absent, and painting the
 * payload over the cached row erases it. And a remote DELETE that this device
 * has a queued op for is currently swallowed *and reported as handled*, so the
 * fallback invalidate never runs and the row lives on this device forever.
 */

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

/** What Postgres actually puts on the wire: the row, no joined children. */
function wireRow(t: Task): Record<string, unknown> {
  const row = { ...t } as Record<string, unknown>;
  delete row.task_labels;
  return row;
}

function caches(labelled: Task) {
  const qc = new QueryClient();
  qc.setQueryData(["tasks", "day", "2026-08-17"], [labelled]);
  qc.setQueryData(["tasks", "all"], [labelled]);
  return qc;
}

describe("a Realtime row must not destroy what it does not carry", () => {
  it("keeps task_labels through a remote field update", () => {
    const labelled = task({ id: "obi", task_labels: [{ label_id: "deep-work" }] });
    const qc = caches(labelled);

    applyLiveChange(qc, {
      table: "tasks",
      eventType: "UPDATE",
      old: { id: "obi" },
      new: {
        ...wireRow(task({ id: "obi", title: "Redo Obi Video, take 2" })),
        field_ts: { title: "2026-08-18T19:40:00.000Z" },
      },
    });

    const row = qc.getQueryData<Task[]>(["tasks", "all"])?.[0];
    expect(row?.title).toBe("Redo Obi Video, take 2");
    expect(
      row?.task_labels,
      "the label was wiped by a payload that never mentioned labels",
    ).toEqual([{ label_id: "deep-work" }]);
  });
});

describe("a remote DELETE this device has queued work for", () => {
  const pendingEdit: Op = {
    seq: 1,
    opId: "op",
    table: "tasks",
    kind: "update",
    rowId: "obi",
    payload: { title: "Obi, retake" },
    fieldTs: { title: "2026-08-18T19:45:00.000Z" },
    ts: "2026-08-18T19:45:00.000Z",
    attempts: 0,
  };

  it("asks the caller to reconcile instead of reporting itself handled", () => {
    const qc = caches(task({ id: "obi" }));

    const handled = applyLiveChange(
      qc,
      { table: "tasks", eventType: "DELETE", old: { id: "obi" }, new: null },
      [pendingEdit],
    );

    expect(
      handled,
      "returning true means no invalidate is ever queued, so the row this device kept never gets reconciled with the server that deleted it",
    ).toBe(false);
  });

  it("still applies a delete outright when nothing local is owed", () => {
    const qc = caches(task({ id: "obi" }));

    const handled = applyLiveChange(
      qc,
      { table: "tasks", eventType: "DELETE", old: { id: "obi" }, new: null },
      [],
    );

    expect(handled).toBe(true);
    expect(qc.getQueryData<Task[]>(["tasks", "all"])).toEqual([]);
  });
});
