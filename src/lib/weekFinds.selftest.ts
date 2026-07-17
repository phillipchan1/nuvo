// Lightweight self-test for week evidence + Find gating.
// Run: npx --yes tsx src/lib/weekFinds.selftest.ts

import assert from "node:assert/strict";
import { buildWeekEvidence, findId, resolveTaskDomainId } from "./weekEvidence";
import { composeWeekFinds, fallbackFindNarration } from "./weekFinds";
import type { WeekReport } from "./composeWeek";
import type { VerticalData, VTask, Domain, Project } from "./vertical";
import type { ExternalEvent } from "./types";

function emptyVertical(partial: Partial<VerticalData> & { domains: Domain[] }): VerticalData {
  return {
    initiatives: [],
    projects: [],
    tasks: [],
    sprint: null,
    focusInitiativeIds: [],
    bigRocks: [],
    lastActivityByProject: {},
    ...partial,
  };
}

const trading: Domain = {
  id: "d-trade",
  name: "Trading",
  color: "#f59e0b",
  icon: "◈",
  intention: "",
  charter: "",
  context: null,
  weeklyTargetHours: 10,
  investedThisWeek: 2,
  meetingHoursThisWeek: 0,
  quarterHours: 20,
  lastTouchedDays: 0,
  weeks: [0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 2],
  sort: 0,
};

const family: Domain = {
  ...trading,
  id: "d-fam",
  name: "Family",
  color: "#ec4899",
  weeklyTargetHours: 5,
  investedThisWeek: 6,
  weeks: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 5, 6],
};

const proj: Project = {
  id: "p1",
  name: "Playbook",
  domainId: "d-trade",
  initiativeId: null,
  keyResultId: null,
  outcome: "",
  description: "",
  status: "in_progress",
  storedStatus: "in_progress",
  shippedAt: null,
  startDate: null,
  targetDate: null,
  progress: 0,
  createdAt: null,
  tendedAt: null,
  verification: null,
  verifiedAt: null,
  brief: null,
};

function task(partial: Partial<VTask> & Pick<VTask, "id" | "title">): VTask {
  return {
    projectId: null,
    initiativeId: null,
    domainId: null,
    keyResultId: null,
    bigRockId: null,
    energy: null,
    durationMins: 60,
    deadlineDaysAway: null,
    status: "done",
    doDate: null,
    slotId: null,
    createdAt: null,
    completedAt: "2026-07-08T10:00:00.000Z",
    assignee: "me",
    rollCount: 0,
    ...partial,
  };
}

// ── resolveTaskDomainId ─────────────────────────────────────────────────────
{
  const v = emptyVertical({
    domains: [trading, family],
    projects: [proj],
    tasks: [],
  });
  assert.equal(resolveTaskDomainId(v, { domainId: "d-fam", projectId: null, initiativeId: null }), "d-fam");
  assert.equal(resolveTaskDomainId(v, { domainId: null, projectId: "p1", initiativeId: null }), "d-trade");
  assert.equal(resolveTaskDomainId(v, { domainId: null, projectId: null, initiativeId: null }), null);
}

// ── evidence attribution ────────────────────────────────────────────────────
{
  const weekStart = "2026-07-06"; // Monday
  const now = new Date("2026-07-10T18:00:00");
  const v = emptyVertical({
    domains: [trading, family],
    projects: [proj],
    tasks: [
      task({ id: "t1", title: "NQ review", projectId: "p1", durationMins: 120, completedAt: "2026-07-07T09:00:00.000Z" }),
      task({ id: "t2", title: "School pickup", domainId: "d-fam", durationMins: 30, completedAt: "2026-07-08T15:00:00.000Z" }),
    ],
  });
  const events: ExternalEvent[] = [
    {
      id: "e1",
      account_id: "a",
      provider_event_id: "ev1",
      calendar_id: "primary",
      title: "Family dinner",
      start_at: "2026-07-08T18:00:00.000Z",
      end_at: "2026-07-08T19:00:00.000Z",
      all_day: false,
      location: null,
      busy: true,
      self_rsvp: "accepted",
    },
  ];
  const evidence = buildWeekEvidence({
    weekStartISO: weekStart,
    now,
    vertical: v,
    events,
    calendarDomainMap: { "a:primary": "d-fam" },
    weeksBack: 0,
  });
  const fam = evidence.domains.find((d) => d.domainId === "d-fam")!;
  const trade = evidence.domains.find((d) => d.domainId === "d-trade")!;
  assert.ok(trade.taskMins === 120);
  assert.ok(fam.taskMins === 30);
  assert.ok(fam.meetingMins === 60);
  assert.ok(fam.receipts.some((r) => r.kind === "event"));
}

// ── Find gating: no find when empty ─────────────────────────────────────────
{
  const emptyReport = {
    weekStartISO: "2026-07-06",
    emblem: { sun: { color: "#000", intensity: 0 }, rings: [], satellites: [], ambient: 0, seed: 1 },
    priorities: [],
    domains: [
      { id: "d-trade", name: "Trading", color: "#f59e0b", hours: 0, target: 10, quiet: true },
      { id: "d-fam", name: "Family", color: "#ec4899", hours: 0, target: 5, quiet: true },
    ],
    capacity: { busyMins: 0, openMins: 2400, workMins: 2400 },
    highlights: [],
    carryForward: [],
    landedCount: 0,
    priorityTotal: 0,
    brief: "",
    evidence: { weekStartISO: "2026-07-06", domains: [], receipts: [], priorDomainHours: {} },
    find: null,
  } satisfies WeekReport;

  const v = emptyVertical({ domains: [trading, family] });
  const out = composeWeekFinds({
    report: emptyReport,
    evidence: emptyReport.evidence,
    vertical: v,
    sealed: true,
  });
  assert.equal(out.featured, null);
}

// ── Find: repeated carry clears gate ────────────────────────────────────────
{
  const report = {
    weekStartISO: "2026-07-06",
    emblem: { sun: { color: "#000", intensity: 0 }, rings: [], satellites: [], ambient: 0, seed: 1 },
    priorities: [
      {
        rock: { id: "r1", title: "Ship playbook", win: "", initiative_id: null, project_id: "p1", done_at: null, roll_count: 3 },
        verdict: "carried" as const,
        done: 2,
        total: 3,
        label: "Playbook",
        nextBlock: null,
      },
    ],
    domains: [{ id: "d-trade", name: "Trading", color: "#f59e0b", hours: 2, target: 10, quiet: false }],
    capacity: { busyMins: 1000, openMins: 1400, workMins: 2400 },
    highlights: [],
    carryForward: [],
    landedCount: 0,
    priorityTotal: 1,
    brief: "",
    evidence: { weekStartISO: "2026-07-06", domains: [], receipts: [], priorDomainHours: {} },
    find: null,
  } satisfies WeekReport;

  const v = emptyVertical({ domains: [trading], projects: [proj] });
  const out = composeWeekFinds({ report, evidence: report.evidence, vertical: v, sealed: true });
  assert.ok(out.featured);
  assert.equal(out.featured!.kind, "repeated_carry");
  const narr = fallbackFindNarration(out.featured!);
  assert.equal(narr.headline, out.featured!.headline);
}

assert.equal(findId("a", "b", "c"), "a:b:c");
console.log("weekFinds.selftest: ok");
