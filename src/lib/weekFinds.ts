// The Find — one evidence-backed discovery per Review.
// Code owns candidates, scores, receipts, and gating. The LLM (optional) only
// narrates the selected candidate; it never invents numbers or evidence.
//
// Product rule: hide the Find when nothing clears the confidence/surprise gate.
// Balance celebration vs conscience so the Review never becomes a weekly scold.

import { findId, type WeekEvidence, type WeekReceipt } from "./weekEvidence";
import type { WeekReport } from "./composeWeek";
import type { VerticalData } from "./vertical";
import { projectById } from "./vertical";

export type WeekFindKind =
  | "hidden_bet"
  | "plan_reality"
  | "comeback"
  | "protected_time"
  | "domain_shift"
  | "repeated_carry"
  | "shipped_offbook";

export type FindTone = "celebration" | "tension" | "comeback" | "protected" | "mismatch";

export interface WeekFind {
  id: string;
  kind: WeekFindKind;
  tone: FindTone;
  /** Deterministic headline — AI may warm this, never replace the facts. */
  headline: string;
  detail: string;
  receipts: WeekReceipt[];
  confidence: number;
  unexpectedness: number;
  score: number;
  /** Domain / priority / project anchors for correction + navigation. */
  anchors: {
    domainId?: string;
    priorityId?: string;
    projectId?: string;
  };
}

export interface WeekFindReport {
  featured: WeekFind | null;
  /** All candidates that cleared the gate, ranked (featured is [0]). */
  candidates: WeekFind[];
  gatedCount: number;
}

export interface ComposeWeekFindsInput {
  report: WeekReport;
  evidence: WeekEvidence;
  vertical: VerticalData;
  sealed: boolean;
}

const CONFIDENCE_FLOOR = 0.45;
const SCORE_FLOOR = 0.38;

function scoreOf(confidence: number, unexpectedness: number, severity = 1): number {
  return confidence * (0.55 + 0.45 * unexpectedness) * severity;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Pick receipts for a domain, preferring tasks then events, capped. */
function domainReceipts(evidence: WeekEvidence, domainId: string, limit = 5): WeekReceipt[] {
  return (evidence.domains.find((d) => d.domainId === domainId)?.receipts ?? []).slice(0, limit);
}

function fmtH(mins: number): string {
  const h = mins / 60;
  if (h < 0.1) return "0h";
  return `${h < 10 ? h.toFixed(1).replace(/\.0$/, "") : Math.round(h)}h`;
}

// ── Candidate generators ────────────────────────────────────────────────────

function hiddenBet(report: WeekReport, evidence: WeekEvidence): WeekFind | null {
  // "Trading wasn't your largest investment, but it got your best morning hours."
  // Approximate morning hours: tasks/events with at timestamp before 13:00 local.
  const morningByDomain = new Map<string, number>();
  for (const r of evidence.receipts) {
    if (!r.at || (r.kind !== "task" && r.kind !== "event")) continue;
    const h = new Date(r.at).getHours();
    if (h >= 5 && h < 13) {
      morningByDomain.set(r.domainId, (morningByDomain.get(r.domainId) ?? 0) + r.mins);
    }
  }
  if (morningByDomain.size < 2) return null;
  const byMorning = [...morningByDomain.entries()].sort((a, b) => b[1] - a[1]);
  const [morningId, morningMins] = byMorning[0]!;
  const totalDom = report.domains.find((d) => d.id === morningId);
  const largest = report.domains.find((d) => d.hours > 0);
  if (!totalDom || !largest || largest.id === morningId) return null;
  if (morningMins < 90) return null; // need a real morning stake
  if (totalDom.hours >= largest.hours * 0.85) return null; // not "hidden"

  const confidence = 0.82;
  const unexpectedness = clamp01(1 - totalDom.hours / Math.max(largest.hours, 0.1));
  return {
    id: findId("hidden_bet", morningId),
    kind: "hidden_bet",
    tone: "celebration",
    headline: `${totalDom.name} wasn't your largest investment — but it held your best morning hours.`,
    detail: `${fmtH(morningMins)} before midday went to ${totalDom.name}, while ${largest.name} took more of the week overall (${fmtH(largest.hours * 60)}).`,
    receipts: domainReceipts(evidence, morningId),
    confidence,
    unexpectedness,
    score: scoreOf(confidence, unexpectedness, 1.05),
    anchors: { domainId: morningId },
  };
}

function planRealityWithVertical(
  report: WeekReport,
  evidence: WeekEvidence,
  vertical: VerticalData,
): WeekFind | null {
  const priorityDomainIds = new Set<string>();
  for (const p of report.priorities) {
    if (p.rock.project_id) {
      const proj = projectById(vertical, p.rock.project_id);
      if (proj?.domainId) priorityDomainIds.add(proj.domainId);
    }
    if (p.rock.initiative_id) {
      const init = vertical.initiatives.find((i) => i.id === p.rock.initiative_id);
      if (init?.domainId) priorityDomainIds.add(init.domainId);
    }
  }
  if (priorityDomainIds.size === 0) return null;
  const dominant = report.domains.find((d) => d.hours >= 0.75);
  if (!dominant) return null;
  if (priorityDomainIds.has(dominant.id)) return null;

  const named = report.priorities
    .map((p) => p.rock.title)
    .slice(0, 2)
    .join(", ");
  const confidence = 0.78;
  const unexpectedness = 0.72;
  return {
    id: findId("plan_reality", dominant.id),
    kind: "plan_reality",
    tone: "mismatch",
    headline: `You planned around ${named || "your priorities"} — but ${dominant.name} became the week's center.`,
    detail: `${fmtH(dominant.hours * 60)} went to ${dominant.name}, while your named bets pointed elsewhere.`,
    receipts: domainReceipts(evidence, dominant.id),
    confidence,
    unexpectedness,
    score: scoreOf(confidence, unexpectedness, 1.1),
    anchors: { domainId: dominant.id },
  };
}

function comeback(report: WeekReport, evidence: WeekEvidence, vertical: VerticalData): WeekFind | null {
  // First week in a while that a domain crossed its rhythm (had hours after quiet streak).
  for (const d of report.domains) {
    if (d.hours < 0.5 || d.quiet) continue;
    const pulse = vertical.domains.find((x) => x.id === d.id)?.weeks ?? [];
    // Look at weeks before current (exclude last entry = this week when weeksBack=0)
    const prior = pulse.slice(0, -1);
    let quietRun = 0;
    for (let i = prior.length - 1; i >= 0; i--) {
      if (prior[i]! <= 0.25) quietRun++;
      else break;
    }
    if (quietRun < 3) continue;
    const confidence = 0.88;
    const unexpectedness = clamp01(0.5 + quietRun * 0.1);
    return {
      id: findId("comeback", d.id),
      kind: "comeback",
      tone: "comeback",
      headline: `This was the first week in ${quietRun + 1} that ${d.name} crossed its intended rhythm.`,
      detail: `${fmtH(d.hours * 60)} kept — after ${quietRun} quiet weeks. Showing up again counts.`,
      receipts: domainReceipts(evidence, d.id),
      confidence,
      unexpectedness,
      score: scoreOf(confidence, unexpectedness, 1.15),
      anchors: { domainId: d.id },
    };
  }
  return null;
}

function protectedTime(report: WeekReport, evidence: WeekEvidence): WeekFind | null {
  // Busy week (high capacity fill) but a domain still got uninterrupted morning blocks.
  const { capacity } = report;
  if (capacity.workMins <= 0) return null;
  const fill = capacity.busyMins / capacity.workMins;
  if (fill < 0.65) return null;

  const morningBlocks = evidence.receipts.filter((r) => {
    if ((r.kind !== "task" && r.kind !== "event") || !r.at || r.mins < 45) return false;
    const h = new Date(r.at).getHours();
    return h >= 5 && h < 12;
  });
  if (morningBlocks.length < 2) return null;

  const byDomain = new Map<string, WeekReceipt[]>();
  for (const r of morningBlocks) {
    const list = byDomain.get(r.domainId) ?? [];
    list.push(r);
    byDomain.set(r.domainId, list);
  }
  const best = [...byDomain.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!best || best[1].length < 2) return null;
  const [domainId, blocks] = best;
  const dom = report.domains.find((d) => d.id === domainId);
  if (!dom) return null;

  const confidence = 0.8;
  const unexpectedness = clamp01(fill);
  return {
    id: findId("protected_time", domainId),
    kind: "protected_time",
    tone: "protected",
    headline: `Despite a meeting-heavy week, you protected ${blocks.length} uninterrupted mornings for ${dom.name}.`,
    detail: `${Math.round(fill * 100)}% of the work window was committed — and ${dom.name} still got real morning attention.`,
    receipts: blocks.slice(0, 5),
    confidence,
    unexpectedness,
    score: scoreOf(confidence, unexpectedness),
    anchors: { domainId },
  };
}

function domainShift(report: WeekReport, evidence: WeekEvidence): WeekFind | null {
  // Sharp drop vs prior week.
  for (const d of report.domains) {
    const prior = evidence.priorDomainHours[d.id] ?? 0;
    if (prior < 1.5) continue;
    if (d.hours > prior * 0.4) continue;
    const drop = 1 - d.hours / prior;
    const confidence = 0.85;
    const unexpectedness = clamp01(drop);
    return {
      id: findId("domain_shift", d.id),
      kind: "domain_shift",
      tone: "tension",
      headline: `${d.name} fell from ${fmtH(prior * 60)} last week to ${fmtH(d.hours * 60)} — a real shift.`,
      detail: d.hours < 0.25
        ? `Quiet this week after a fuller one. Sometimes the weight belongs elsewhere.`
        : `Still present, but much lighter than the week before.`,
      receipts: domainReceipts(evidence, d.id, 4),
      confidence,
      unexpectedness,
      score: scoreOf(confidence, unexpectedness, 0.95),
      anchors: { domainId: d.id },
    };
  }
  return null;
}

function repeatedCarry(report: WeekReport): WeekFind | null {
  const carried = report.priorities
    .filter((p) => p.verdict !== "landed" && p.rock.roll_count >= 2)
    .sort((a, b) => b.rock.roll_count - a.rock.roll_count);
  const p = carried[0];
  if (!p) return null;
  const confidence = 0.9;
  const unexpectedness = clamp01(0.4 + p.rock.roll_count * 0.15);
  const metric: WeekReceipt = {
    kind: "metric",
    id: `roll:${p.rock.id}`,
    label: `Carried ${p.rock.roll_count} weeks`,
    mins: 0,
    domainId: "",
    domainName: "",
    domainColor: "var(--muted)",
    projectId: p.rock.project_id ?? null,
    projectName: p.label,
  };
  return {
    id: findId("repeated_carry", p.rock.id),
    kind: "repeated_carry",
    tone: "tension",
    headline: `"${p.rock.title}" has rolled ${p.rock.roll_count} weeks — the supporting work may be done, but the decision isn't.`,
    detail: p.total > 0
      ? `${p.done} of ${p.total} linked tasks finished. The priority itself is still open.`
      : `No linked tasks yet — this may need clarifying before it can land.`,
    receipts: [metric],
    confidence,
    unexpectedness,
    score: scoreOf(confidence, unexpectedness, 1.05),
    anchors: { priorityId: p.rock.id, projectId: p.rock.project_id ?? undefined },
  };
}

function shippedOffbook(evidence: WeekEvidence, vertical: VerticalData): WeekFind | null {
  // Activity units on a project with zero completed tasks this week.
  const byProject = new Map<string, WeekReceipt[]>();
  for (const r of evidence.receipts) {
    if (r.kind !== "activity" || !r.projectId) continue;
    const list = byProject.get(r.projectId) ?? [];
    list.push(r);
    byProject.set(r.projectId, list);
  }
  for (const [projectId, units] of byProject) {
    const taskDone = evidence.receipts.some((r) => r.kind === "task" && r.projectId === projectId);
    if (taskDone) continue;
    const proj = projectById(vertical, projectId);
    if (!proj) continue;
    const confidence = 0.86;
    const unexpectedness = 0.7;
    return {
      id: findId("shipped_offbook", projectId),
      kind: "shipped_offbook",
      tone: "celebration",
      headline: `${proj.name} shipped ${units.length} ${units.length === 1 ? "thing" : "things"} you never logged as tasks.`,
      detail: `Merged work still counts — the week moved even when the task list didn't.`,
      receipts: units.slice(0, 5),
      confidence,
      unexpectedness,
      score: scoreOf(confidence, unexpectedness, 1.1),
      anchors: { projectId, domainId: proj.domainId },
    };
  }
  return null;
}

/** Prefer variety: don't always pick tension. Soft-boost celebration/comeback/protected. */
function toneBoost(tone: FindTone): number {
  switch (tone) {
    case "celebration":
    case "comeback":
    case "protected":
      return 1.08;
    case "mismatch":
      return 1.0;
    case "tension":
      return 0.92;
  }
}

/**
 * Compose The Find for a week. Pure and deterministic.
 * Returns null featured when nothing is genuinely notable.
 */
export function composeWeekFinds(input: ComposeWeekFindsInput): WeekFindReport {
  const { report, evidence, vertical } = input;

  const raw: (WeekFind | null)[] = [
    hiddenBet(report, evidence),
    planRealityWithVertical(report, evidence, vertical),
    comeback(report, evidence, vertical),
    protectedTime(report, evidence),
    domainShift(report, evidence),
    repeatedCarry(report),
    shippedOffbook(evidence, vertical),
  ];

  const all = raw.filter((f): f is WeekFind => f != null);
  const gated = all.filter((f) => f.confidence >= CONFIDENCE_FLOOR && f.score >= SCORE_FLOOR);
  const ranked = [...gated]
    .map((f) => ({ ...f, score: f.score * toneBoost(f.tone) }))
    .sort((a, b) => b.score - a.score || b.unexpectedness - a.unexpectedness);

  // Soft-prefer celebration over tension when scores are close.
  let featured = ranked[0] ?? null;
  if (featured?.tone === "tension") {
    const brighter = ranked.find((f) => f.tone !== "tension" && f.score >= featured!.score * 0.9);
    if (brighter) featured = brighter;
  }

  return {
    featured,
    candidates: ranked,
    gatedCount: all.length - gated.length,
  };
}

/** Deterministic narration fallback when the LLM is unavailable. */
export function fallbackFindNarration(find: WeekFind): { headline: string; detail: string } {
  return { headline: find.headline, detail: find.detail };
}
