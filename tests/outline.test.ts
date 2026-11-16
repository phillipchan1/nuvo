// The Table's read model (src/lib/outline.ts): which rows, in which groups.
import { describe, expect, it } from "vitest";
import { readOutline, weekBucket, type OutlineQuery } from "../src/lib/outline";
import type { Task } from "../src/lib/types";
import type { Initiative, Project, VerticalData } from "../src/lib/vertical";

// Sunday Nov 15 2026 — a weekend, so "this week" is the one ahead (the kernel).
const TODAY = "2026-11-15";

const proj = (o: Partial<Project> & { id: string }): Project =>
  ({
    initiativeId: null, keyResultId: null, domainId: "d1", name: o.id, outcome: "", description: "",
    startDate: null, targetDate: null, status: "in_progress", storedStatus: "in_progress", progress: 0,
    shippedAt: null, createdAt: null, tendedAt: null, verification: null, verifiedAt: null, brief: null, sortOrder: 0,
    ...o,
  }) as Project;
const init = (o: Partial<Initiative> & { id: string }): Initiative =>
  ({
    domainId: "d1", name: o.id, outcome: "", description: "", startDate: null, targetDate: null, status: "in_progress",
    progress: 0, momentum: "flat", keyResults: [], createdAt: null, tendedAt: null, verification: null, verifiedAt: null, brief: null,
    ...o,
  }) as Initiative;
let n = 0;
const task = (o: Partial<Task>): Task =>
  ({
    id: `t${++n}`, title: `task ${n}`, status: "todo", do_date: null, duration_minutes: null, deadline: null, priority: "none",
    completed_at: null, trashed_at: null, project_id: null, initiative_id: null, parent_task_id: null, sort_order: n,
    ...o,
  }) as Task;

const data = (projects: Project[], initiatives: Initiative[] = []): VerticalData =>
  ({
    domains: [{ id: "d1", name: "Work" }, { id: "d2", name: "Family" }],
    initiatives, projects, tasks: [], sprint: null, focusInitiativeIds: [], bigRocks: [], lastActivityByProject: {},
  }) as unknown as VerticalData;

const Q = (o: Partial<OutlineQuery> = {}): OutlineQuery => ({
  altitude: "project", view: "upcoming", grouping: "when", filters: [], search: "", todayISO: TODAY, ...o,
});

describe("weekBucket", () => {
  it("reads the weekend as planning the week ahead", () => {
    expect(weekBucket("2026-11-14", TODAY)).toBe("overdue");
    expect(weekBucket("2026-11-15", TODAY)).toBe("thisWeek"); // today is never late
    expect(weekBucket("2026-11-22", TODAY)).toBe("thisWeek");
    expect(weekBucket("2026-11-23", TODAY)).toBe("nextWeek");
    expect(weekBucket("2026-11-30", TODAY)).toBe("later");
    expect(weekBucket(null, TODAY)).toBe("none");
  });
});

describe("readOutline — Upcoming", () => {
  const a = proj({ id: "a", targetDate: "2026-12-10" });
  const b = proj({ id: "b", targetDate: "2026-11-19" });
  const shipped = proj({ id: "s", status: "complete" });
  const tasks = [
    task({ project_id: "a", do_date: "2026-11-17", duration_minutes: 30 }), // a's next date pulls it into this week
    task({ project_id: "a", status: "done", completed_at: "2026-11-12T10:00:00Z" }),
    task({ project_id: "b", do_date: "2026-11-10" }), // late
    task({ project_id: "a", parent_task_id: "x" }), // a step never reaches the list
  ];

  it("groups by the next date on each project, not its target, and leaves the shipped out", () => {
    const g = readOutline(data([a, b, shipped]), tasks, Q());
    expect(g.map((x) => x.key)).toEqual(["overdue", "thisWeek"]);
    expect(g[1].items.map((i) => (i.kind === "project" ? i.project.id : ""))).toEqual(["a"]);
    expect(g[1].lead).toBe(true);
    expect(g[1].span).toBe("Nov 16 – 22");
  });

  it("shows only open tasks and counts the week's estimate", () => {
    const g = readOutline(data([a]), tasks, Q());
    const item = g[0].items[0];
    expect(item.kind === "project" && item.tasks.length).toBe(1);
    expect(g[0].minutes).toBe(30);
  });

  it("a task filter hides the other tasks — and a project left with none", () => {
    const g = readOutline(data([a, b]), tasks, Q({ filters: [{ field: "taskDate", values: ["overdue"] }] }));
    expect(g.flatMap((x) => x.items).map((i) => (i.kind === "project" ? i.project.id : ""))).toEqual(["b"]);
  });

  it("search reaches into tasks", () => {
    const t = task({ project_id: "b", title: "Book the sanctuary" });
    const g = readOutline(data([a, b]), [...tasks, t], Q({ search: "sanctuary" }));
    const items = g.flatMap((x) => x.items);
    expect(items).toHaveLength(1);
    expect(items[0].kind === "project" && items[0].tasks.map((x) => x.title)).toEqual(["Book the sanctuary"]);
  });
});

describe("readOutline — Completed", () => {
  it("is finished tasks by the week they were finished; a shipped project with none stays on Shipped", () => {
    const a = proj({ id: "a" });
    const s = proj({ id: "s", status: "complete" });
    const tasks = [
      task({ project_id: "a", status: "done", completed_at: "2026-11-11T09:00:00Z" }),
      task({ project_id: "a", status: "done", completed_at: "2026-11-03T09:00:00Z" }),
      task({ project_id: "a" }),
    ];
    const g = readOutline(data([a, s]), tasks, Q({ view: "completed" }));
    expect(g.map((x) => x.key)).toEqual(["thisWeek"]);
    expect(g[0].doneTasks).toBe(2);
  });
});

describe("readOutline — initiatives", () => {
  it("nests projects under their initiative and groups by target quarter", () => {
    const i1 = init({ id: "i1", targetDate: "2026-12-31" });
    const i2 = init({ id: "i2", targetDate: "2027-02-01" });
    const p = proj({ id: "p", initiativeId: "i1" });
    const g = readOutline(data([p], [i1, i2]), [], Q({ altitude: "initiative" }));
    expect(g.map((x) => x.key)).toEqual(["thisQuarter", "nextQuarter"]);
    const first = g[0].items[0];
    expect(first.kind === "initiative" && first.projects.map((x) => x.project.id)).toEqual(["p"]);
  });
});
