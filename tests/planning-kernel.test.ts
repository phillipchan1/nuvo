// The conformance suite for the planning kernel.
//
// The thing being protected: **the chat and the UI must always answer "what is
// my week" identically.** They run in different runtimes (browser vs Deno) over
// differently-shaped data (camelCase view models vs snake_case rows), so the
// only way to guarantee it is (1) one implementation, imported by both, and
// (2) tests that fail the moment a surface grows its own copy.
//
// Every case below is a drift that actually happened, or the exact shape of one
// that could:
//   · the weekend rule disagreed (Saturday planned different weeks)
//   · the agent's slate filter forgot the shipped-inside-this-week clause
//   · "bring it into the week" wrote a different span in chat than on a tap
//
// Run: npm test

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  bringIntoWeekPatch,
  carriedWeeks,
  deriveSlateIds,
  fromProjectRow,
  isCarrying,
  isOnSlate,
  needsASprint,
  planningWeekStart,
  spanAnotherWeekPatch,
  spansWeek,
  takeOffWeekPatch,
  toRowPatch,
  weekSpanFor,
  mondayOf,
  type ProjectRow,
} from "../supabase/functions/_shared/planningRules.ts";

import { planningWeekStartISO } from "../src/lib/dates";
import { priorityVerdict, projectsOnDeck, pushAsRock, weekPushes } from "../src/lib/priorities";
import { sprintSpanFor } from "../src/lib/onDeck";
import type { Project, VerticalData } from "../src/lib/vertical";

// ── fixtures ─────────────────────────────────────────────────────────────────
// One dataset, expressed BOTH ways: as the client's `Project` objects and as the
// Supabase rows the agent reads. Same facts, two shapes — which is exactly the
// seam where the two implementations used to drift apart.

const WEEK = "2026-07-20"; // a Monday

interface Fact {
  id: string;
  start: string | null;
  target: string | null;
  status: string;
  shipped: string | null;
}

const FACTS: Fact[] = [
  { id: "in-week", start: "2026-07-20", target: "2026-07-24", status: "in_progress", shipped: null },
  { id: "starts-midweek", start: "2026-07-22", target: "2026-07-23", status: "in_progress", shipped: null },
  { id: "spans-into-week", start: "2026-07-13", target: "2026-07-22", status: "in_progress", shipped: null },
  { id: "spans-past-week", start: "2026-07-20", target: "2026-08-07", status: "in_progress", shipped: null },
  { id: "overdue-before", start: "2026-07-06", target: "2026-07-10", status: "in_progress", shipped: null },
  { id: "overdue-long", start: "2026-06-15", target: "2026-06-19", status: "in_progress", shipped: null },
  { id: "overdue-parked", start: "2026-07-06", target: "2026-07-10", status: "waiting", shipped: null },
  { id: "overdue-shipped", start: "2026-07-06", target: "2026-07-10", status: "complete", shipped: "2026-07-09T18:00:00.000Z" },
  { id: "overdue-dropped", start: "2026-07-06", target: "2026-07-10", status: "dropped", shipped: null },
  { id: "next-week", start: "2026-07-27", target: "2026-07-31", status: "in_progress", shipped: null },
  // the Sunday-boundary leak: a span anchored to a Sunday-start week must NOT
  // count as the prior Monday-based week's
  { id: "sunday-anchored-next", start: "2026-07-26", target: "2026-07-30", status: "in_progress", shipped: null },
  { id: "no-target", start: null, target: null, status: "in_progress", shipped: null },
  { id: "target-only", start: null, target: "2026-07-22", status: "in_progress", shipped: null },
  { id: "backlog-in-week", start: "2026-07-20", target: "2026-07-24", status: "backlog", shipped: null },
  { id: "waiting-in-week", start: "2026-07-20", target: "2026-07-24", status: "waiting", shipped: null },
  { id: "shipped-this-week", start: "2026-07-20", target: "2026-07-24", status: "complete", shipped: "2026-07-22T18:00:00.000Z" },
  { id: "shipped-earlier", start: "2026-07-20", target: "2026-07-24", status: "complete", shipped: "2026-07-02T18:00:00.000Z" },
  { id: "complete-never-shipped", start: "2026-07-20", target: "2026-07-24", status: "complete", shipped: null },
  { id: "cancelled-in-week", start: "2026-07-20", target: "2026-07-24", status: "cancelled", shipped: null },
  { id: "dropped-in-week", start: "2026-07-20", target: "2026-07-24", status: "dropped", shipped: null },
  { id: "done-synonym", start: "2026-07-20", target: "2026-07-24", status: "done", shipped: "2026-07-21T10:00:00.000Z" },
];

/** The client's view model — what the UI renders from. */
const asProject = (f: Fact): Project => ({
  id: f.id,
  initiativeId: null,
  keyResultId: null,
  domainId: "d1",
  name: f.id,
  outcome: "",
  description: "",
  startDate: f.start,
  targetDate: f.target,
  status: f.status as Project["status"],
  storedStatus: f.status as Project["status"],
  progress: 0,
  shippedAt: f.shipped,
  createdAt: null,
  tendedAt: null,
  verification: null,
  verifiedAt: null,
  brief: null,
});

/** The Supabase row — what the agent reads. */
const asRow = (f: Fact): ProjectRow & { id: string } => ({
  id: f.id,
  start_date: f.start,
  target_date: f.target,
  status: f.status,
  shipped_at: f.shipped,
});

const DATA: VerticalData = {
  domains: [],
  initiatives: [],
  projects: FACTS.map(asProject),
  tasks: [],
  sprint: null,
  focusInitiativeIds: [],
  bigRocks: [],
  lastActivityByProject: {},
};

const ROWS = FACTS.map(asRow);
const rowsAsSpans = () => ROWS.map((r) => ({ ...fromProjectRow(r), id: r.id }));

// ── 1 · the two runtimes derive the same week ────────────────────────────────

describe("the slate is one derivation, whichever runtime asks", () => {
  it("client weekPushes === agent-side deriveSlateIds, over identical facts", () => {
    const fromUI = weekPushes(DATA, WEEK).map((p) => p.project.id);
    const fromAgent = deriveSlateIds(rowsAsSpans(), WEEK);
    expect(fromAgent).toEqual(fromUI);
  });

  it("client projectsOnDeck === the agent's workable-this-week set", () => {
    const fromUI = projectsOnDeck(DATA, WEEK).map((p) => p.id);
    const fromAgent = rowsAsSpans()
      .filter((p) => isOnSlate(p, WEEK) && p.status !== "complete" && p.status !== "done")
      .map((p) => p.id);
    expect(fromAgent).toEqual(fromUI);
  });

  it("keeps what shipped inside the week and drops what shipped before it", () => {
    const slate = deriveSlateIds(rowsAsSpans(), WEEK);
    expect(slate).toContain("shipped-this-week");
    expect(slate).toContain("done-synonym");
    expect(slate).not.toContain("shipped-earlier");
    expect(slate).not.toContain("cancelled-in-week");
    expect(slate).not.toContain("dropped-in-week");
  });

  it("does not leak a Sunday-anchored next-week span into this week", () => {
    expect(deriveSlateIds(rowsAsSpans(), WEEK)).not.toContain("sunday-anchored-next");
    expect(deriveSlateIds(rowsAsSpans(), "2026-07-27")).toContain("sunday-anchored-next");
  });

  it("a project with no finish line is never on a week — it needs a sprint", () => {
    expect(deriveSlateIds(rowsAsSpans(), WEEK)).not.toContain("no-target");
    expect(needsASprint(fromProjectRow(asRow(FACTS.find((f) => f.id === "no-target")!)))).toBe(true);
  });
});

// ── 1b · unfinished work carries; it does not vanish ─────────────────────────
// The drift this closes: the On Deck deck clamps a past due-date into its "This
// week" column, so an unfinished project still read as this week's there — while
// every span-derived surface (the rail crown, the Week's Plan, the pull, the
// chat's slate) had already dropped it. The board said "this week", the Schedule
// said nothing at all.

describe("an unfinished project carries into the week", () => {
  const span = (id: string) => fromProjectRow(asRow(FACTS.find((f) => f.id === id)!));

  it("puts a lapsed open project on the slate, marked as carrying", () => {
    expect(deriveSlateIds(rowsAsSpans(), WEEK)).toContain("overdue-before");
    expect(isCarrying(span("overdue-before"), WEEK)).toBe(true);
    expect(carriedWeeks(span("overdue-before"), WEEK)).toBe(2); // its week was Jul 6
    expect(carriedWeeks(span("overdue-long"), WEEK)).toBe(5); // Jun 15 → Jul 20
  });

  it("the client and the agent carry the same set", () => {
    expect(weekPushes(DATA, WEEK).map((p) => p.project.id)).toEqual(deriveSlateIds(rowsAsSpans(), WEEK));
    expect(weekPushes(DATA, WEEK).find((p) => p.project.id === "overdue-before")?.carried).toBe(2);
  });

  it("the wk N mark reads the derived carry, not the dead stored one", () => {
    // `roll_count` only ever moved through `carryBigRocksForward`, which no
    // surface calls — so every "wk N" in the app read 0 forever. Membership is
    // derived from the span, so the carry is too: this is the one line the rail
    // crown, the Week's Plan row, Sunday, the phone's slate and the Review's
    // repeated-carry Find all render from.
    const pushes = weekPushes(DATA, WEEK);
    expect(pushAsRock(pushes.find((p) => p.project.id === "overdue-before")!).roll_count).toBe(2);
    expect(pushAsRock(pushes.find((p) => p.project.id === "in-week")!).roll_count).toBe(0);
    expect(priorityVerdict(pushAsRock(pushes.find((p) => p.project.id === "overdue-before")!))).toBe("carried");
  });

  it("this week's own choices come first; carried work follows", () => {
    const ids = deriveSlateIds(rowsAsSpans(), WEEK);
    const firstCarried = ids.findIndex((id) => isCarrying(span(id), WEEK));
    const lastCommitted = ids.reduce((last, id, i) => (isCarrying(span(id), WEEK) ? last : i), -1);
    expect(firstCarried).toBeGreaterThan(lastCommitted);
    // longest-carrying last, so the freshest debt reads first
    expect(ids.indexOf("overdue-long")).toBeGreaterThan(ids.indexOf("overdue-before"));
  });

  it("carrying is only for work you still owe — never parked, shipped or dropped", () => {
    for (const id of ["overdue-parked", "overdue-shipped", "overdue-dropped"]) {
      expect(isCarrying(span(id), WEEK), `${id} must not carry`).toBe(false);
      expect(deriveSlateIds(rowsAsSpans(), WEEK), `${id} must not be on the slate`).not.toContain(id);
    }
  });

  it("a project committed to THIS week is not carrying — nor is one queued ahead", () => {
    for (const id of ["in-week", "spans-into-week", "next-week", "no-target"]) {
      expect(isCarrying(span(id), WEEK), `${id}`).toBe(false);
      expect(carriedWeeks(span(id), WEEK)).toBe(0);
    }
  });

  it("every off-ramp actually stops the carry", () => {
    const p = span("overdue-before");
    // ship it / drop it / park it — the status answers
    expect(isCarrying({ ...p, status: "complete", shippedAt: "2026-07-09T00:00:00Z" }, WEEK)).toBe(false);
    expect(isCarrying({ ...p, status: "dropped" }, WEEK)).toBe(false);
    expect(isCarrying({ ...p, status: "waiting" }, WEEK)).toBe(false);
    // take it off the week — back to needing a sprint
    const off = { ...p, ...takeOffWeekPatch() };
    expect(isCarrying(off, WEEK)).toBe(false);
    expect(needsASprint(off)).toBe(true);
    // give it another week — it lands ON this week, so it stops carrying
    const again = { ...p, ...spanAnotherWeekPatch(p, WEEK) };
    expect(spansWeek(again, WEEK)).toBe(true);
    expect(isCarrying(again, WEEK)).toBe(false);
  });

  it("mondayOf is plain containment — no weekend shift", () => {
    expect(mondayOf("2026-07-20")).toBe("2026-07-20"); // Monday
    expect(mondayOf("2026-07-24")).toBe("2026-07-20"); // Friday
    expect(mondayOf("2026-07-26")).toBe("2026-07-20"); // Sunday stays in its week
    expect(planningWeekStart("2026-07-26")).toBe("2026-07-27"); // …but plans the next
  });
});

// ── 2 · the week you are planning ────────────────────────────────────────────

describe("planningWeekStart — one rule for both runtimes", () => {
  const cases: [string, string, string][] = [
    ["Mon", "2026-07-20", "2026-07-20"],
    ["Tue", "2026-07-21", "2026-07-20"],
    ["Fri", "2026-07-24", "2026-07-20"],
    // the drift that shipped: the app planned the week ahead from Saturday, the
    // agent planned the week that was ending
    ["Sat", "2026-07-25", "2026-07-27"],
    ["Sun", "2026-07-26", "2026-07-27"],
  ];
  for (const [label, today, expected] of cases) {
    it(`${label} ${today} plans the week of ${expected}`, () => {
      expect(planningWeekStart(today)).toBe(expected);
    });
  }

  it("the client's planningWeekStartISO is the same rule (it delegates)", () => {
    // 400 consecutive days, evaluated at midday so the app-timezone conversion
    // is unambiguous — every answer must be a Monday, and must match the kernel.
    for (let i = 0; i < 400; i++) {
      const at = new Date(Date.UTC(2026, 0, 1, 20, 0, 0) + i * 86_400_000);
      const iso = planningWeekStartISO(at);
      expect(new Date(iso + "T00:00:00Z").getUTCDay(), `${iso} is a Monday`).toBe(1);
      expect(iso).toBe(planningWeekStart(new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(at)));
    }
  });
});

// ── 3 · the write acts mean one thing ────────────────────────────────────────

describe("bring in / take off — the same act in chat and on a tap", () => {
  it("the UI patch and the agent's row patch are the same span", () => {
    for (const f of FACTS) {
      const ui = bringIntoWeekPatch(asProject(f), WEEK);
      const agent = bringIntoWeekPatch(fromProjectRow(asRow(f)), WEEK);
      expect(agent).toEqual(ui);
      if (ui) {
        expect(toRowPatch(ui)).toMatchObject({ start_date: ui.startDate, target_date: ui.targetDate });
      }
    }
  });

  it("bringing a project in puts it on the slate; taking it off needs a sprint", () => {
    for (const f of FACTS) {
      if (f.status === "cancelled" || f.status === "dropped") continue;
      const before = fromProjectRow(asRow(f));
      const patch = bringIntoWeekPatch(before, WEEK);
      const after = { ...before, ...(patch ?? {}) };
      expect(isOnSlate({ ...after, status: patch?.status ?? after.status }, WEEK), `${f.id} lands on the week`).toBe(
        // a project completed in an earlier week stays off the slate: bringing it
        // in re-dates it, but the scoreboard rule still asks when it shipped
        f.status === "complete" || f.status === "done" ? isOnSlate({ ...after }, WEEK) : true,
      );
      const off = { ...after, ...takeOffWeekPatch() };
      expect(spansWeek(off, WEEK)).toBe(false);
      if (off.status !== "complete" && off.status !== "done") expect(needsASprint(off)).toBe(true);
    }
  });

  it("a backlog project pulled into a week is started", () => {
    const patch = bringIntoWeekPatch(fromProjectRow(asRow(FACTS.find((f) => f.id === "no-target")!)), WEEK);
    expect(patch).toMatchObject({ startDate: WEEK, targetDate: "2026-07-24" });
    const backlog = bringIntoWeekPatch({ startDate: null, targetDate: null, status: "backlog", shippedAt: null }, WEEK);
    expect(backlog?.status).toBe("in_progress");
  });

  it("a multi-week project keeps its width when it moves", () => {
    const wide = { startDate: "2026-07-06", targetDate: "2026-07-17", status: "in_progress", shippedAt: null };
    expect(bringIntoWeekPatch(wide, WEEK)).toEqual(weekSpanFor(WEEK, 2));
  });

  it("the deck's sprintSpanFor is the kernel's formula", () => {
    for (let w = 1; w <= 4; w++) {
      const viaDeck = sprintSpanFor({ startDate: null, targetDate: null }, new Date(2026, 6, 20), w);
      expect(viaDeck).toEqual(weekSpanFor(WEEK, w));
    }
  });
});

// ── 4 · nobody grows a second copy ───────────────────────────────────────────
// The tests above only prove the two runtimes agree *while they both call the
// kernel*. This one proves they still do: it fails the moment any surface
// defines its own version of a rule the kernel owns.

const KERNEL = "supabase/functions/_shared/planningRules.ts";
const OWNED_RULES = [
  "planningWeekStart",
  "mondayOf",
  "spansWeek",
  "shippedInWeek",
  "weekSpanFor",
  "bringIntoWeekPatch",
  "takeOffWeekPatch",
  "isOnSlate",
  "isOnDeckThisWeek",
  "isCarrying",
  "carriedWeeks",
  "worksThisWeek",
  "slateOrder",
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("the kernel is the only implementation", () => {
  const files = [...sourceFiles("src"), ...sourceFiles("supabase/functions")].filter(
    (f) => !f.endsWith("planningRules.ts") && !f.includes("PlanWeekHarness"),
  );

  for (const rule of OWNED_RULES) {
    it(`no surface defines its own ${rule}`, () => {
      const offenders = files.filter((f) => {
        const src = readFileSync(f, "utf8");
        return new RegExp(`(function|const|let)\\s+${rule}\\b\\s*[=(]`).test(src);
      });
      expect(offenders, `these files re-implement ${rule}; import it from ${KERNEL} instead`).toEqual([]);
    });
  }

  it("the agent derives the week from the kernel, not from its own arithmetic", () => {
    for (const f of ["supabase/functions/agent/context.ts", "supabase/functions/agent/tools.ts"]) {
      expect(readFileSync(f, "utf8"), `${f} must import the planning kernel`).toContain(
        'from "../_shared/planningRules.ts"',
      );
    }
  });

  // The task-query kernel is held to the same rule for the same reason: the
  // rail, the collection table and the chat all answer "does this task match
  // this filter", and three copies is three ideas of what "this week" means.
  const QUERY_KERNEL = "supabase/functions/_shared/taskQuery.ts";
  const QUERY_RULES = ["matchesQuery", "matchesWindow", "isEmptyQuery", "describeQuery"];
  const queryFiles = files.filter((f) => !f.endsWith("taskQuery.ts"));

  for (const rule of QUERY_RULES) {
    it(`no surface defines its own ${rule}`, () => {
      const offenders = queryFiles.filter((f) =>
        new RegExp(`(function|const|let)\\s+${rule}\\b\\s*[=(]`).test(readFileSync(f, "utf8")),
      );
      expect(offenders, `these files re-implement ${rule}; import it from ${QUERY_KERNEL} instead`).toEqual([]);
    });
  }

  // The day-shape kernel, same rule again. "How heavy is this day" is now read
  // by the desktop Year, the phone's Year and the chat — and a shade that means
  // one thing on the desk and another in your hand is worse than no shade at
  // all, because both look right in isolation.
  const DAY_KERNEL = "supabase/functions/_shared/dayShape.ts";
  const DAY_RULES = ["dayLoad", "spanLoad", "longestClearRun", "loadLabel", "dayReadout"];
  const dayFiles = files.filter((f) => !f.endsWith("dayShape.ts"));

  for (const rule of DAY_RULES) {
    it(`no surface defines its own ${rule}`, () => {
      const offenders = dayFiles.filter((f) => {
        const src = readFileSync(f, "utf8");
        if (!new RegExp(`(function|const|let)\\s+${rule}\\b\\s*[=(]`).test(src)) return false;
        // An *adapter* over the kernel is the intended shape and must stay
        // legal: `dayPlan.ts` exports `dayReadout(day: DayPlan)` that does
        // nothing but re-shape its argument and call the kernel's. What this
        // catches is a surface that grows the rule from scratch — so defining
        // the name is only an offence when the file never reads the kernel.
        return !src.includes("_shared/dayShape.ts");
      });
      expect(offenders, `these files re-implement ${rule}; import it from ${DAY_KERNEL} instead`).toEqual([]);
    });
  }

  it("both Year views shade from the kernel, not from their own arithmetic", () => {
    for (const f of ["src/components/calendar/YearParts.tsx", "src/components/CalendarYear.tsx", "src/components/mobile/MobileYearView.tsx"]) {
      expect(readFileSync(f, "utf8"), `${f} must read the day-shape kernel`).toMatch(
        /_shared\/dayShape\.ts|calendar\/YearParts/,
      );
    }
  });
});
