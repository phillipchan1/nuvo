// @vitest-environment jsdom
/**
 * `useWeekCrown` — the week's slate as ONE read model, worn by two shells.
 *
 * The Schedule's rail crown (desktop) and the Calendar's crown (phone) are
 * layouts over this hook. Before it existed the read lived inside `WeekPanel`,
 * which is precisely why the phone couldn't answer "what am I carrying this
 * week, and does it have a time" at all — so what this file guards is that the
 * ONE answer stays right, and that neither shell has to re-derive it.
 *
 * The cases are the ones where an honest answer differs from a naive one:
 * a project that shipped *inside* the week (must stay on the scoreboard, not
 * vanish from it), a landed week-verdict over a project that continues, work
 * parked in a sitting (placed, though it carries no `start_time` of its own),
 * and work blocked into ANOTHER week (loose — it isn't happening here).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { addDays } from "date-fns";
import React from "react";
import { describe, expect, it } from "vitest";
import { useWeekCrown } from "../src/hooks/useWeekCrown";
import { VerticalStoreProvider, type VerticalStore } from "../src/hooks/useVertical";
import { parseDateISO, planningWeekStartISO, toDateISO } from "../src/lib/dates";
import type { Domain, Project, VTask, VerticalData } from "../src/lib/vertical";
import type { BigRock, Slot, Sprint, Task } from "../src/lib/types";

const WEEK_ISO = planningWeekStartISO();
const MONDAY = parseDateISO(WEEK_ISO);
const day = (n: number) => toDateISO(addDays(MONDAY, n));
const at = (n: number, hour: number) => {
  const d = addDays(MONDAY, n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const DOMAINS = [
  { id: "d1", name: "SCE", color: "#2563EB", weeks: [], days: [] },
  { id: "d2", name: "Family", color: "#DB2777", weeks: [], days: [] },
] as unknown as Domain[];

const proj = (o: Record<string, unknown>): Project =>
  ({
    initiativeId: null,
    keyResultId: null,
    outcome: "",
    status: "in_progress",
    startDate: day(0),
    targetDate: day(4),
    shippedAt: null,
    ...o,
  }) as unknown as Project;

const PROJECTS: Project[] = [
  proj({ id: "p1", domainId: "d1", name: "Region 4 cutover" }),
  proj({ id: "p2", domainId: "d1", name: "Vendor consolidation" }), // landed verdict, continues
  proj({ id: "p3", domainId: "d2", name: "Sort the garage" }), // every task done
  proj({ id: "p4", domainId: "d1", name: "Obi handoff doc", status: "complete", shippedAt: at(1, 16) }),
  proj({ id: "p5", domainId: "d2", name: "Family photo album", startDate: day(14), targetDate: day(18) }), // not this week
  proj({ id: "p6", domainId: "d2", name: "Photo wall" }), // every open piece has a time
];

const vt = (o: Record<string, unknown>): VTask =>
  ({
    initiativeId: null,
    domainId: null,
    keyResultId: null,
    bigRockId: null,
    durationMins: 60,
    status: "ready",
    doDate: null,
    startTime: null,
    slotId: null,
    ...o,
  }) as unknown as VTask;

const VTASKS: VTask[] = [
  vt({ id: "t1", title: "Freeze the config", projectId: "p1", status: "done" }),
  vt({ id: "t2", title: "Dry-run the script", projectId: "p1", status: "scheduled" }),
  vt({ id: "t3", title: "Brief the rota", projectId: "p1" }),
  vt({ id: "t4", title: "Write the rollback note", projectId: "p1" }),
  vt({ id: "t5", title: "Collect the quotes", projectId: "p2" }),
  vt({ id: "t6", title: "Hire the skip", projectId: "p3", status: "done" }),
  vt({ id: "t7", title: "Hang the frames", projectId: "p6", status: "scheduled" }),
];

const task = (o: Record<string, unknown>): Task =>
  ({
    status: "backlog",
    do_date: null,
    start_time: null,
    duration_minutes: 60,
    slot_id: null,
    ...o,
  }) as unknown as Task;

const TASKS: Task[] = [
  task({ id: "t1", title: "Freeze the config", project_id: "p1", status: "done" }),
  // has its own block, inside the week
  task({ id: "t2", title: "Dry-run the script", project_id: "p1", status: "planned", start_time: at(2, 9) }),
  // rides a sitting — no start_time of its own, still placed
  task({ id: "t3", title: "Brief the rota", project_id: "p1", slot_id: "s1" }),
  // blocked into NEXT week — loose, because it isn't happening here
  task({ id: "t4", title: "Write the rollback note", project_id: "p1", status: "planned", start_time: at(9, 9) }),
  task({ id: "t5", title: "Collect the quotes", project_id: "p2" }),
  task({ id: "t6", title: "Hire the skip", project_id: "p3", status: "done" }),
  task({ id: "t7", title: "Hang the frames", project_id: "p6", status: "planned", start_time: at(4, 10) }),
];

const SLOTS = [{ id: "s1", title: "Rollout sitting", project_id: "p1", start_time: at(3, 14) }] as unknown as Slot[];

const BIG_ROCKS: BigRock[] = [
  { id: "r1", title: "Region 4 cutover", win: "", initiative_id: null, project_id: "p1", done_at: null, roll_count: 2 },
  { id: "r2", title: "Vendor consolidation", win: "", initiative_id: null, project_id: "p2", done_at: at(3, 11), roll_count: 0 },
];

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false } },
  });
  // The keys `useLooseWork` reads — seeded, so the test needs no network.
  const start = MONDAY.toISOString();
  const end = addDays(MONDAY, 7).toISOString();
  qc.setQueryData(["tasks", "all"], TASKS);
  // The blocks query is RANGE-scoped, so t4 (blocked into next week) is not in
  // it — which is exactly what makes it read loose here.
  qc.setQueryData(
    ["tasks", "scheduled", start, end],
    TASKS.filter((t) => t.start_time && t.start_time >= start && t.start_time < end),
  );
  qc.setQueryData(["slots", start, end], SLOTS);

  const data: VerticalData = {
    domains: DOMAINS,
    initiatives: [],
    projects: PROJECTS,
    tasks: VTASKS,
    sprint: { id: "sp1", week_start: WEEK_ISO, big_rocks: BIG_ROCKS } as unknown as Sprint,
    focusInitiativeIds: [],
    bigRocks: BIG_ROCKS,
    lastActivityByProject: {},
  } as unknown as VerticalData;

  return (
    <QueryClientProvider client={qc}>
      <VerticalStoreProvider value={{ data, ready: true } as unknown as VerticalStore}>
        {children}
      </VerticalStoreProvider>
    </QueryClientProvider>
  );
}

const read = async () => {
  const { result } = renderHook(() => useWeekCrown(), { wrapper });
  await waitFor(() => expect(result.current).not.toBeNull());
  return result.current!;
};

describe("useWeekCrown", () => {
  it("is the week's SLATE — spans decide membership, not a stored list", async () => {
    const crown = await read();
    expect(crown.rows.map((r) => r.projectId)).toEqual(["p1", "p2", "p3", "p4", "p6"]);
    expect(crown.weekISO).toBe(WEEK_ISO);
  });

  it("keeps a project shipped INSIDE the week on the scoreboard", async () => {
    const crown = await read();
    const shipped = crown.rows.find((r) => r.projectId === "p4")!;
    expect(shipped.state).toBe("shipped");
    // landed = the verdict rows: p2 (done_at) and p4 (shipped in-week)
    expect(crown.landed).toBe(2);
    expect(crown.total).toBe(5);
  });

  it("says a landed push CONTINUES when its project still has open work", async () => {
    const crown = await read();
    const landed = crown.rows.find((r) => r.projectId === "p2")!;
    expect(landed.state).toBe("landed");
    expect(landed.continues).toBe(true);
  });

  it("calls a project with every task done ready-to-ship, and offers no depth", async () => {
    const crown = await read();
    const ready = crown.rows.find((r) => r.projectId === "p3")!;
    expect(ready.state).toBe("ready-to-ship");
    expect(ready.canExpand).toBe(false); // nothing open — a time pill would be noise
  });

  it("splits open work by whether it has a time THIS week", async () => {
    const crown = await read();
    const row = crown.rows.find((r) => r.projectId === "p1")!;
    // t2 has its own block; t3 rides the sitting; t4 is blocked into next week.
    expect(row.placed.map((p) => p.task.id).sort()).toEqual(["t2", "t3"]);
    expect(row.loose.map((t) => t.id)).toEqual(["t4"]);
    // The piece riding a sitting reports the SITTING's clock and names it.
    expect(row.placed.find((p) => p.task.id === "t3")!.slotTitle).toBe("Rollout sitting");
  });

  it("states the split rather than the flattering half", async () => {
    const crown = await read();
    expect(crown.rows.find((r) => r.projectId === "p1")!.placedLabel).toBe("2 of 3 placed");
    // A project with nothing placed SAYS so — the read that stops work going
    // missing is "0 of 1", never a silent row.
    expect(crown.rows.find((r) => r.projectId === "p2")!.placedLabel).toBe("0 of 1 placed");
    // And nothing homeless is a plain fact, not a warning (P9).
    expect(crown.rows.find((r) => r.projectId === "p6")!.placedLabel).toBe("all placed");
    expect(crown.looseCount).toBe(2); // p1's t4 and p2's untimed t5
  });

  it("carries the row's identity — domain hue, carry count, progress", async () => {
    const crown = await read();
    const row = crown.rows.find((r) => r.projectId === "p1")!;
    expect(row.color).toBe("#2563EB");
    expect(row.rolls).toBe(2);
    expect(row.pct).toBe(25); // 1 of 4 tasks done
  });
});
