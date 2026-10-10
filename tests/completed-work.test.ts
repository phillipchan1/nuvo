// Finished-work kernel: the stamp a complete writes, and the grouping a
// "what did I finish" read returns. Pins the rules a second implementation
// would get wrong — D-088 domain attribution, the 30-minute planned default,
// and never inventing a finish time from updated_at.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  completionStamp,
  FALLBACK_PLANNED_MINUTES,
  groupCompletedWork,
  plannedMinutes,
  plannedMinutesDefaulted,
} from "../supabase/functions/_shared/completedWork.ts";

const task = (over: Partial<Parameters<typeof groupCompletedWork>[0][number]> & { id: string; title: string }) => ({
  completed_at: "2026-10-09T18:00:00.000Z",
  duration_minutes: 45,
  project_id: null,
  domain_id: null,
  ...over,
});

const PROJECTS = [
  { id: "p-atc", name: "ATC review", domain_id: "d-work" },
  { id: "p-sermon", name: "Sunday sermon", domain_id: "d-church" },
];
const DOMAINS = [
  { id: "d-work", name: "Work" },
  { id: "d-church", name: "Church" },
];

describe("completionStamp", () => {
  it("stamps done and clears every other status", () => {
    expect(completionStamp("done", "2026-10-09T18:00:00.000Z")).toEqual({
      completed_at: "2026-10-09T18:00:00.000Z",
    });
    for (const status of ["inbox", "planned", "backlog", "trashed"]) {
      expect(completionStamp(status, "2026-10-09T18:00:00.000Z")).toEqual({ completed_at: null });
    }
  });
});

describe("groupCompletedWork", () => {
  it("groups by project and the domain hours COUNT toward, not the task's copy", () => {
    // D-088: the task's domain_id is a stale copy (Church) after the project
    // was re-homed to Work. The group must follow the project.
    const grouped = groupCompletedWork(
      [
        task({
          id: "t1",
          title: "Freeze the region-4 config",
          project_id: "p-atc",
          domain_id: "d-church",
          duration_minutes: 60,
        }),
        task({
          id: "t2",
          title: "Outline the lectionary",
          project_id: "p-sermon",
          duration_minutes: 30,
          completed_at: "2026-10-08T17:00:00.000Z",
        }),
        task({ id: "t3", title: "Call the plumber", domain_id: "d-church", duration_minutes: 15 }),
      ],
      PROJECTS,
      DOMAINS,
    );
    expect(grouped.count).toBe(3);
    expect(grouped.total_minutes).toBe(105);
    expect(grouped.groups).toHaveLength(3);
    expect(grouped.groups[0]).toMatchObject({
      project: { id: "p-atc", name: "ATC review" },
      domain: { id: "d-work", name: "Work" },
      total_minutes: 60,
    });
    expect(grouped.groups[0].domain?.id).not.toBe("d-church");
    expect(grouped.groups[2]).toMatchObject({
      project: null,
      domain: { id: "d-church", name: "Church" },
      total_minutes: 15,
    });
  });

  it("uses the planned default when duration is missing, and omits unstamped rows", () => {
    expect(plannedMinutes(null)).toBe(FALLBACK_PLANNED_MINUTES);
    expect(plannedMinutes(0)).toBe(FALLBACK_PLANNED_MINUTES);
    expect(plannedMinutesDefaulted(null)).toBe(true);
    expect(plannedMinutesDefaulted(0)).toBe(true);
    expect(plannedMinutesDefaulted(15)).toBe(false);
    const grouped = groupCompletedWork(
      [
        task({ id: "t1", title: "No duration", duration_minutes: null }),
        { id: "t2", title: "No stamp", completed_at: "", duration_minutes: 90, project_id: null, domain_id: null },
      ],
      [],
      [],
    );
    expect(grouped.count).toBe(1);
    expect(grouped.total_minutes).toBe(30);
    expect(grouped.planned_minutes_defaulted_count).toBe(1);
    expect(grouped.groups[0].tasks[0].duration_minutes).toBe(30);
    expect(grouped.groups[0].tasks[0].planned_minutes_defaulted).toBe(true);
    expect(grouped.groups[0].planned_minutes_defaulted_count).toBe(1);
  });

  it("marks only the tasks whose planned minutes were defaulted, and counts them", () => {
    const grouped = groupCompletedWork(
      [
        task({ id: "t1", title: "Stored 45", duration_minutes: 45 }),
        task({ id: "t2", title: "Null duration", duration_minutes: null }),
        task({ id: "t3", title: "Zero duration", duration_minutes: 0 }),
      ],
      [],
      [],
    );
    expect(grouped.count).toBe(3);
    expect(grouped.total_minutes).toBe(45 + 30 + 30);
    expect(grouped.planned_minutes_defaulted_count).toBe(2);
    expect(grouped.groups[0].planned_minutes_defaulted_count).toBe(2);
    const byId = Object.fromEntries(grouped.groups[0].tasks.map((t) => [t.id, t]));
    expect(byId.t1.planned_minutes_defaulted).toBe(false);
    expect(byId.t2.planned_minutes_defaulted).toBe(true);
    expect(byId.t3.planned_minutes_defaulted).toBe(true);
  });

  it("does not invent an Unfiled noun for loose untitled work", () => {
    const grouped = groupCompletedWork(
      [task({ id: "t1", title: "Loose thought", duration_minutes: 20 })],
      PROJECTS,
      DOMAINS,
    );
    expect(grouped.groups).toEqual([
      {
        project: null,
        domain: null,
        total_minutes: 20,
        planned_minutes_defaulted_count: 0,
        tasks: [
          {
            id: "t1",
            title: "Loose thought",
            completed_at: "2026-10-09T18:00:00.000Z",
            duration_minutes: 20,
            planned_minutes_defaulted: false,
          },
        ],
      },
    ]);
    expect(grouped.planned_minutes_defaulted_count).toBe(0);
  });
});

describe("agent writes go through the stamp", () => {
  const src = readFileSync("supabase/functions/agent/tools.ts", "utf8");

  it("complete_task / complete_step / bulk done use completionStamp", () => {
    expect(src).toContain('completionStamp("done"');
    expect(src).toContain("completionStamp(done ? \"done\" : \"backlog\"");
    expect(src).not.toMatch(/completed_at:\s*new Date\(\)\.toISOString\(\)/);
  });

  it("reopen paths clear the stamp instead of leaving a done time on an open row", () => {
    expect(src).toContain('completionStamp("inbox"');
    expect(src).toContain('completionStamp("planned"');
    expect(src).toContain('completionStamp(done ? "done" : "backlog"');
  });

  it("adopting an undated task into a series clears completed_at", () => {
    const adopt = src.match(/if \(!adoptHasDate\) \{[\s\S]*?\n    \}/);
    expect(adopt?.[0]).toMatch(/completionStamp\("planned"/);
  });
});
