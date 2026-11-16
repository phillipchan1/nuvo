// The Worker's agent snapshot reads the week through the kernel.
//
// Confirmed bug (hardening audit, 2026-11): `buildSnapshot` in
// worker/src/agentExec.ts hard-coded `weekStart: today` and an empty slate,
// candidates, next-week queue, goal and pool — so production chat (which runs on
// the Worker) told the user their week was unplanned over a full deck. This
// drives the real `buildSnapshot` over a fake `sql` and holds it to the same
// derivation the edge agent runs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSnapshot } from "../worker/src/agentExec.ts";
import type { Store } from "../worker/src/store.ts";

const USER = "u1";
const WEEK = "2026-11-16"; // Wed 2026-11-18 → this week

function fakeStore(tables: Record<string, Record<string, unknown>[]>): Store {
  const sql = ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    const m = /FROM\s+(\w+)/i.exec(text);
    return Promise.resolve(m ? tables[m[1]] ?? [] : []);
  }) as unknown as Store["sql"];
  return { sql, userId: USER };
}

const task = (o: Record<string, unknown>) => ({
  user_id: USER, title: String(o.id), status: "backlog", project_id: null, sprint_id: null, slot_id: null,
  do_date: null, start_time: null, duration_minutes: 30, roll_count: 0, sort_order: 0, ...o,
});
const project = (o: Record<string, unknown>) => ({
  user_id: USER, name: String(o.id), outcome: "", status: "in_progress", domain_id: "d", start_date: null, target_date: null, shipped_at: null, ...o,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T18:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("the Worker's snapshot carries the week", () => {
  it("derives weekStart, the slate, the candidates, next week, the goal and the pool", async () => {
    const store = fakeStore({
      projects: [
        project({ id: "slate", start_date: WEEK, target_date: "2026-11-20" }),
        project({ id: "carried", start_date: "2026-11-02", target_date: "2026-11-06" }),
        // stored in_progress, every task done → complete, shipped outside this week: off the slate
        project({ id: "finished", start_date: "2026-11-09", target_date: "2026-11-13" }),
        project({ id: "candidate" }),
        project({ id: "next", start_date: "2026-11-23", target_date: "2026-11-27" }),
      ],
      tasks: [
        task({ id: "a", project_id: "slate", sprint_id: "S", sort_order: 2 }),
        task({ id: "b", project_id: "slate", status: "planned", start_time: "2026-11-19T17:00:00Z", sort_order: 1 }),
        task({ id: "c", project_id: "carried" }),
        task({ id: "d", project_id: "finished", status: "done" }),
        task({ id: "e", project_id: "candidate" }),
        task({ id: "f", sprint_id: "S" }),
      ],
      sprints: [
        { id: "S", user_id: USER, week_start: WEEK, goal: "Ship the site", big_rocks: [{ id: "r1", project_id: "slate", done_at: null, title: "Site" }, { id: "r2", project_id: null, done_at: null, title: "Loose" }] },
        { id: "S-old", user_id: USER, week_start: "2026-11-09", goal: "old", big_rocks: [] },
      ],
    });
    const ctx = await buildSnapshot(store, undefined, undefined, "America/Los_Angeles");

    expect(ctx.weekStart).toBe(WEEK);
    expect(ctx.weekSlate.map((p) => [p.id, p.carriedWeeks])).toEqual([["slate", 0], ["carried", 2]]);
    const slate = ctx.weekSlate[0];
    expect(slate.priorityId).toBe("r1");
    expect(slate.openTasks.map((t) => t.id)).toEqual(["b", "a"]);
    expect(slate.scheduledTaskCount).toBe(1);
    expect(ctx.needsASprint.map((p) => p.id)).toEqual(["candidate"]);
    expect(ctx.nextWeekSlate.map((p) => p.id)).toEqual(["next"]);
    expect(ctx.sprintGoal).toBe("Ship the site");
    expect(ctx.unattachedPriorities.map((r) => r.id)).toEqual(["r2"]);
    expect((ctx.weekPool as { id: string }[]).map((t) => t.id).sort()).toEqual(["a", "f"]);
  });

  it("an empty account reads an empty week — at the planning week, not today", async () => {
    const ctx = await buildSnapshot(fakeStore({}), undefined, undefined, "America/Los_Angeles");
    expect(ctx.weekStart).toBe(WEEK);
    expect(ctx.weekSlate).toEqual([]);
    expect(ctx.sprintGoal).toBeNull();
  });
});
