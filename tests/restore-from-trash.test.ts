import { describe, expect, it } from "vitest";
import { restoreFromTrashPatch, restingStatus, type Task } from "../src/lib/types";

function row(
  patch: Partial<Pick<Task, "do_date" | "project_id" | "initiative_id" | "domain_id" | "sprint_id" | "start_time" | "slot_id" | "status" | "trashed_at">>,
): Parameters<typeof restoreFromTrashPatch>[0] {
  return {
    do_date: null,
    project_id: null,
    initiative_id: null,
    domain_id: null,
    sprint_id: null,
    start_time: null,
    slot_id: null,
    status: "trashed",
    trashed_at: "2026-08-28T12:00:00.000Z",
    ...patch,
  };
}

describe("restoreFromTrashPatch", () => {
  it("returns a loose dated task to the Inbox, clearing the schedule (D-104)", () => {
    const t = row({
      do_date: "2026-08-01",
      start_time: "2026-08-01T16:00:00.000Z",
    });
    // The bug: restingStatus(t) alone would keep status "planned" on the old day.
    expect(restingStatus(t)).toBe("planned");
    const { patch, face } = restoreFromTrashPatch(t);
    expect(patch).toEqual({
      status: "inbox",
      trashed_at: null,
      do_date: null,
      start_time: null,
      slot_id: null,
    });
    expect(face).toBe("inbox");
  });

  it("returns a parented task to backlog and points the rail at Today", () => {
    const { patch, face } = restoreFromTrashPatch(
      row({ do_date: "2026-08-28", project_id: "proj-1", slot_id: "slot-1" }),
    );
    expect(patch.status).toBe("backlog");
    expect(patch.do_date).toBeNull();
    expect(patch.slot_id).toBeNull();
    expect(face).toBe("today");
  });

  it("treats a domain tag as a home the same way restingStatus does", () => {
    const { patch, face } = restoreFromTrashPatch(row({ domain_id: "dom-1" }));
    expect(patch.status).toBe("backlog");
    expect(face).toBe("today");
  });
});
