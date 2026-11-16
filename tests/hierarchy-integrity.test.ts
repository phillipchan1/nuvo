// Record hierarchy integrity — the parent chain decides, never a stale copy.
//
// Each case below is a confirmed bug (hardening audit, 2026-11):
//   · a project moved to another initiative kept crediting the one it LEFT
//     (tasksOfInitiative / priorityWork read the denormalized `initiative_id`)
//   · deleting a domain left its loose tasks `backlog` with no parent — in no list
//   · deleting a project left its tasks pointing at stale initiative/domain copies
//   · re-homing from the groom workbench skipped the record's cascade
//   · the app derived a project's status from its tasks while the agent read the
//     raw row, so the chat and the crown disagreed about what shipped
//
// Run: npm test

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backlogTasks,
  buildVertical,
  domainDeleteTaskPatches,
  inboxTasks,
  initiativeInvestedHours,
  projectDeleteTaskPatches,
  rehomePatches,
  tasksOfInitiative,
  type DomainRow,
  type InitiativeRow,
  type ProjectRow,
} from "../src/lib/vertical";
import { priorityWork } from "../src/lib/priorities";
import { effectiveProjectStatus } from "../supabase/functions/_shared/planningRules.ts";
import { applyEffectiveStatus, projectTaskRollup } from "../supabase/functions/agent/projectStatusCore.ts";
import { executeTool } from "../supabase/functions/agent/tools.ts";
import { db, resetDb } from "./agent/fakeSupabase.ts";
import type { BigRock, Task } from "../src/lib/types";

const NOW = new Date("2026-11-12T20:00:00.000Z");
const dom = (id: string): DomainRow =>
  ({ id, name: id, color: "#000", icon: "diamond", intention: "", charter: "", context: null, weekly_target_hours: 0, sort_order: 0 }) as DomainRow;
const proj = (o: Partial<ProjectRow> & { id: string }): ProjectRow =>
  ({ initiative_id: null, key_result_id: null, domain_id: "A", name: o.id, outcome: "", description: "", start_date: null, target_date: null, status: "in_progress", progress: 0, shipped_at: null, sort_order: 0, ...o }) as ProjectRow;
const init = (o: Partial<InitiativeRow> & { id: string }): InitiativeRow =>
  ({ domain_id: "A", name: o.id, outcome: "", description: "", start_date: null, target_date: null, status: "in_progress", momentum: "flat", progress: 0, sort_order: 0, key_results: [], ...o }) as InitiativeRow;
const task = (o: Partial<Task> & { id: string }): Task =>
  ({ title: o.id, status: "done", completed_at: "2026-11-10T18:00:00Z", duration_minutes: 600, project_id: null, initiative_id: null, domain_id: "A", do_date: null, start_time: null, sprint_id: null, ...o }) as Task;

describe("a parented task belongs to its project's initiative", () => {
  // project P moved I1 → I2; its task still carries the stale initiative_id I1
  const d = buildVertical([dom("A")], [init({ id: "I1" }), init({ id: "I2" })], [proj({ id: "P", initiative_id: "I2" })], [task({ id: "t1", project_id: "P", initiative_id: "I1" })], null, NOW);
  const i1 = d.initiatives.find((i) => i.id === "I1")!;
  const i2 = d.initiatives.find((i) => i.id === "I2")!;

  it("credits the initiative the project is under, not the one it left", () => {
    expect(tasksOfInitiative(d, i1).map((t) => t.id)).toEqual([]);
    expect(tasksOfInitiative(d, i2).map((t) => t.id)).toEqual(["t1"]);
    expect(initiativeInvestedHours(d, i1)).toBe(0);
    expect(initiativeInvestedHours(d, i2)).toBe(10);
  });

  it("the snapshot resolves the task's initiative through the parent chain", () => {
    expect(d.tasks.find((t) => t.id === "t1")!.initiativeId).toBe("I2");
  });

  it("a priority on the old bet no longer owns the moved project's work", () => {
    const rock = (initiative_id: string): BigRock => ({ id: "r", title: "r", win: "", initiative_id, project_id: null, done_at: null, roll_count: 0 }) as BigRock;
    expect(priorityWork(d, rock("I1")).total).toBe(0);
    expect(priorityWork(d, rock("I2")).total).toBe(1);
  });

  it("a task loose directly on an initiative still counts for it", () => {
    const d2 = buildVertical([dom("A")], [init({ id: "I1" })], [], [task({ id: "t2", initiative_id: "I1" })], null, NOW);
    expect(tasksOfInitiative(d2, d2.initiatives[0]).map((t) => t.id)).toEqual(["t2"]);
  });
});

describe("deleting a domain re-files its loose work", () => {
  const loose = task({ id: "loose", status: "backlog", domain_id: "D", completed_at: null });
  const dated = task({ id: "dated", status: "planned", domain_id: "D", do_date: "2026-11-20", completed_at: null });
  const parented = task({ id: "parented", status: "backlog", domain_id: "D", project_id: "P", completed_at: null });
  const other = task({ id: "other", status: "backlog", domain_id: "E", completed_at: null });

  it("a loose backlog task lands in the inbox instead of in no list", () => {
    const patches = new Map(domainDeleteTaskPatches([loose, dated, parented, other], "D").map((p) => [p.id, p.patch]));
    expect(patches.get("loose")).toEqual({ domain_id: null, status: "inbox" });
    expect(patches.get("dated")).toEqual({ domain_id: null });
    expect(patches.get("parented")).toEqual({ domain_id: null });
    expect(patches.has("other")).toBe(false);

    // and the result is visible: applied, the task is in the inbox list
    const after = { ...loose, ...patches.get("loose") } as Task;
    const d = buildVertical([], [], [], [after], null, NOW);
    expect(inboxTasks(d).map((t) => t.id)).toEqual(["loose"]);
  });

  it("without the patch it was in no list (the bug)", () => {
    const d = buildVertical([], [], [], [{ ...loose, domain_id: null }], null, NOW);
    expect(inboxTasks(d)).toEqual([]);
    expect(backlogTasks(d)).toEqual([]);
  });
});

describe("deleting a project re-files its work under what it hung from", () => {
  const inits = [{ id: "I", domain_id: "A" }];
  const projects = [proj({ id: "P", initiative_id: "I", domain_id: null }), proj({ id: "Q", domain_id: null })];

  it("its tasks take the project's initiative and resolved domain", () => {
    const t = task({ id: "t", status: "backlog", project_id: "P", initiative_id: "stale-I", domain_id: "stale-D", completed_at: null });
    expect(projectDeleteTaskPatches([t], projects, inits, ["P"])).toEqual([
      { id: "t", patch: { project_id: null, initiative_id: "I", domain_id: "A" } },
    ]);
  });

  it("with nothing above it, a backlog task goes to the inbox; a done one keeps its status", () => {
    const open = task({ id: "open", status: "backlog", project_id: "Q", domain_id: "stale", completed_at: null });
    const done = task({ id: "done", status: "done", project_id: "Q", domain_id: "stale" });
    const committed = task({ id: "wk", status: "backlog", project_id: "Q", sprint_id: "S", completed_at: null });
    const byId = new Map(projectDeleteTaskPatches([open, done, committed], projects, inits, ["Q"]).map((p) => [p.id, p.patch]));
    expect(byId.get("open")).toEqual({ project_id: null, initiative_id: null, domain_id: null, status: "inbox" });
    expect(byId.get("done")).toEqual({ project_id: null, initiative_id: null, domain_id: null });
    // committed to a week: it rests on the week, not the inbox
    expect(byId.get("wk")).toEqual({ project_id: null, initiative_id: null, domain_id: null });
  });
});

describe("re-homing a record to another domain cascades", () => {
  const d = buildVertical(
    [dom("A"), dom("B")],
    [init({ id: "I", domain_id: "A", key_results: [] })],
    [proj({ id: "P", initiative_id: "I", key_result_id: "K", domain_id: "A" }), proj({ id: "L", domain_id: "A" })],
    [],
    null,
    NOW,
  );

  it("an initiative takes its projects with it", () => {
    expect(rehomePatches(d, "initiative", "I", "B")).toEqual([
      { kind: "initiative", id: "I", patch: { domainId: "B" } },
      { kind: "project", id: "P", patch: { domainId: "B" } },
    ]);
  });

  it("a project leaving its initiative's domain is detached from it", () => {
    expect(rehomePatches(d, "project", "P", "B")).toEqual([
      { kind: "project", id: "P", patch: { domainId: "B", initiativeId: null, keyResultId: null } },
    ]);
    expect(rehomePatches(d, "project", "L", "B")).toEqual([{ kind: "project", id: "L", patch: { domainId: "B" } }]);
  });

  it("the groom workbench applies the cascade (not a bare domain patch)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/domain/DomainParts.tsx", "utf8");
    expect(src).toContain("rehomePatches(data, m.kind, m.id, target)");
  });
});

describe("the app and the agent read one project status", () => {
  const cases: { stored: string; tasks: string[]; want: string }[] = [
    { stored: "in_progress", tasks: ["done", "done"], want: "complete" },
    { stored: "complete", tasks: ["done", "backlog"], want: "in_progress" },
    { stored: "complete", tasks: [], want: "complete" },
    { stored: "backlog", tasks: ["backlog"], want: "backlog" },
    { stored: "waiting", tasks: ["done"], want: "waiting" },
    { stored: "cancelled", tasks: ["done"], want: "cancelled" },
    { stored: "in_progress", tasks: ["done", "trashed"], want: "complete" },
  ];
  for (const c of cases) {
    it(`${c.stored} with [${c.tasks.join(", ")}] → ${c.want} on both sides`, () => {
      const rows = c.tasks.map((status, i) => task({ id: `t${i}`, project_id: "P", status: status as Task["status"] }));
      const app = buildVertical([dom("A")], [], [proj({ id: "P", status: c.stored as ProjectRow["status"] })], rows, null, NOW).projects[0].status;
      const [agent] = applyEffectiveStatus([{ id: "P", status: c.stored }], projectTaskRollup(rows));
      expect(app).toBe(c.want);
      expect(agent.status).toBe(c.want);
      const open = rows.filter((t) => t.status !== "done" && t.status !== "trashed").length;
      const total = rows.filter((t) => t.status !== "trashed").length;
      expect(effectiveProjectStatus(c.stored, open, total)).toBe(c.want);
    });
  }
});

describe("the agent's priority tools read the effective status", () => {
  const USER = "user-1";
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T18:00:00Z")); // Wed — week of 2026-11-16
  });
  afterEach(() => vi.useRealTimers());

  it("a project whose last task is done stops carrying, so the name resolves to the live one", async () => {
    resetDb({
      sprints: [],
      projects: [
        // committed to this week, work open
        { id: "P1", user_id: USER, name: "Launch site", status: "in_progress", start_date: "2026-11-16", target_date: "2026-11-20", shipped_at: null },
        // last week's span, row still says in_progress — but every task is done
        { id: "P2", user_id: USER, name: "Launch deck", status: "in_progress", start_date: "2026-11-09", target_date: "2026-11-13", shipped_at: null },
      ],
      tasks: [
        { id: "a", user_id: USER, project_id: "P1", status: "backlog" },
        { id: "b", user_id: USER, project_id: "P2", status: "done" },
      ],
    });
    await executeTool(USER, "create_priority", { title: "Launch" }, undefined, "America/Los_Angeles");
    const rocks = (db.sprints[0]?.big_rocks ?? []) as BigRock[];
    // raw status: both "work this week" → ambiguous → a rock with no project
    expect(rocks.map((r) => r.project_id)).toEqual(["P1"]);
  });
});
