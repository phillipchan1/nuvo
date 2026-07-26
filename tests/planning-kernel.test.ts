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
  deriveSlateIds,
  fromProjectRow,
  isOnSlate,
  needsASprint,
  planningWeekStart,
  spansWeek,
  takeOffWeekPatch,
  toRowPatch,
  weekSpanFor,
  type ProjectRow,
} from "../supabase/functions/_shared/planningRules.ts";

import { planningWeekStartISO } from "../src/lib/dates";
import { projectsOnDeck, weekPushes } from "../src/lib/priorities";
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
  "spansWeek",
  "shippedInWeek",
  "weekSpanFor",
  "bringIntoWeekPatch",
  "takeOffWeekPatch",
  "isOnSlate",
  "isOnDeckThisWeek",
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
});
