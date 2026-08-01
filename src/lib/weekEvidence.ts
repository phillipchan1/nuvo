// Canonical week evidence — the receipts behind every Review claim.
// Hours weave, highlights, and The Find all read from this one ledger so
// attribution can never disagree with itself. Corrections update the source
// row (task.domain_id / event_domain_routing) and the ledger regenerates.

import { addDays, startOfWeek } from "date-fns";
import { APP_TZ, parseDateISO, toDateISO } from "./dates";
import { eventCountsAsActual, eventDomainId, eventKey, eventMins } from "./eventActuals";
import {
  domainById,
  initiativeById,
  projectById,
  type VerticalData,
  type VTask,
} from "./vertical";
import type { ActivityUnit, ExternalEvent } from "./types";

export type ReceiptKind = "task" | "event" | "activity" | "priority" | "metric";

/** One attributable unit of work that contributed to a domain this week. */
export interface WeekReceipt {
  kind: ReceiptKind;
  id: string;
  label: string;
  mins: number;
  domainId: string;
  domainName: string;
  domainColor: string;
  projectId: string | null;
  projectName: string | null;
  /** Stable event key for event receipts — used by correction upserts. */
  eventKey?: string;
  url?: string | null;
  at?: string | null;
}

export interface DomainEvidence {
  domainId: string;
  domainName: string;
  domainColor: string;
  /** Total attributed minutes (tasks + meetings). */
  mins: number;
  taskMins: number;
  meetingMins: number;
  receipts: WeekReceipt[];
}

export interface WeekEvidence {
  weekStartISO: string;
  /** Per-domain rollup, sorted by hours desc. */
  domains: DomainEvidence[];
  /** Flat receipt list (all domains). */
  receipts: WeekReceipt[];
  /** Prior-week hours by domain id (from Domain.weeks), when available. */
  priorDomainHours: Record<string, number>;
}

/** One day's worth of attributed work — derived from the flat receipt list. */
export interface DayEvidence {
  dayISO: string;
  /** Total attributed minutes (tasks + meetings; activity is 0). */
  mins: number;
  receipts: WeekReceipt[];
}

/** Calendar date of an instant in a given timezone ('YYYY-MM-DD'). */
export function instantToDayISO(instant: string | Date, tz: string = APP_TZ): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Group flat receipts into days for a week starting at `weekStartISO`.
 * By default omits quiet days (no receipts). Pass `includeEmpty: true` for a
 * full 7-lane spread (Review day board). Activity (0-min) receipts appear in
 * the day list without inflating mins.
 *
 * `weekStartISO` is the first column day — pass a Sunday for Schedule-style
 * Sun→Sat, or a Monday for planning-week Mon→Sun.
 */
export function groupEvidenceByDay(
  evidence: WeekEvidence,
  weekStartISO: string,
  tz: string = APP_TZ,
  opts?: { includeEmpty?: boolean },
): DayEvidence[] {
  const byDay = new Map<string, WeekReceipt[]>();
  for (let i = 0; i < 7; i++) {
    byDay.set(toDateISO(addDays(parseDateISO(weekStartISO), i)), []);
  }

  for (const r of evidence.receipts) {
    if (!r.at) continue;
    const dayISO = instantToDayISO(r.at, tz);
    const list = byDay.get(dayISO);
    if (!list) continue; // outside the week window
    list.push(r);
  }

  const days: DayEvidence[] = [];
  for (const [dayISO, receipts] of byDay) {
    if (!opts?.includeEmpty && receipts.length === 0) continue;
    const sorted = [...receipts].sort(
      (a, b) => b.mins - a.mins || (b.at ?? "").localeCompare(a.at ?? ""),
    );
    const mins = sorted.reduce((sum, r) => sum + (r.kind === "activity" ? 0 : r.mins), 0);
    days.push({ dayISO, mins, receipts: sorted });
  }
  return days;
}

/**
 * First column of the day board for a planning week (Monday `planningWeekStartISO`).
 * Honors the Schedule display preference (`weekStartsOn`: 0 = Sun→Sat, 1 = Mon→Sun)
 * — same rule as FullCalendar / MobileCalendar. Does not change which planning
 * week the Review is about; only the lane order / calendar-week snap.
 */
export function boardWeekStartISO(planningWeekStartISO: string, weekStartsOn: 0 | 1): string {
  if (weekStartsOn === 1) return planningWeekStartISO;
  return toDateISO(startOfWeek(parseDateISO(planningWeekStartISO), { weekStartsOn: 0 }));
}

export interface BuildWeekEvidenceInput {
  weekStartISO: string;
  now: Date;
  vertical: VerticalData;
  events: ExternalEvent[];
  calendarDomainMap?: Record<string, string>;
  eventRouting?: Record<string, string>;
  activityUnits?: ActivityUnit[];
  /** How many weeks back this week is (0 = current). Used to index Domain.weeks. */
  weeksBack?: number;
  /** Sealed override: use these hours instead of summing receipts (when live
   *  tasks have drifted). Receipts still list what we can find. */
  domainHoursOverride?: Record<string, number>;
}

/** Resolve a VTask's domain through the parent chain — one rule for weave + receipts. */
export function resolveTaskDomainId(vertical: VerticalData, t: Pick<VTask, "domainId" | "projectId" | "initiativeId">): string | null {
  return (
    t.domainId ??
    projectById(vertical, t.projectId)?.domainId ??
    initiativeById(vertical, t.initiativeId)?.domainId ??
    null
  );
}

/** Stable hash-ish id for a find candidate (kind + primary anchors). */
export function findId(kind: string, ...anchors: string[]): string {
  return `${kind}:${anchors.filter(Boolean).join(":")}`;
}

export function buildWeekEvidence(input: BuildWeekEvidenceInput): WeekEvidence {
  const {
    weekStartISO,
    now,
    vertical,
    events,
    calendarDomainMap = {},
    eventRouting = {},
    activityUnits = [],
    weeksBack = 0,
  } = input;
  const weekStart = parseDateISO(weekStartISO);
  const weekEnd = addDays(weekStart, 7);
  const receipts: WeekReceipt[] = [];

  // ── Completed tasks in the week window ────────────────────────────────────
  for (const t of vertical.tasks) {
    if (t.status !== "done" || !t.completedAt) continue;
    const at = new Date(t.completedAt);
    if (at < weekStart || at >= weekEnd) continue;
    const domainId = resolveTaskDomainId(vertical, t);
    const dom = domainById(vertical, domainId);
    if (!dom) continue;
    const proj = projectById(vertical, t.projectId);
    receipts.push({
      kind: "task",
      id: t.id,
      label: t.title,
      mins: t.durationMins,
      domainId: dom.id,
      domainName: dom.name,
      domainColor: dom.color,
      projectId: proj?.id ?? null,
      projectName: proj?.name ?? null,
      at: t.completedAt,
    });
  }

  // ── Attended calendar events attributed to a domain ───────────────────────
  for (const e of events) {
    if (!eventCountsAsActual(e, now)) continue;
    const end = new Date(e.end_at);
    if (end < weekStart || end >= weekEnd) continue;
    const domainId = eventDomainId(e, calendarDomainMap, eventRouting);
    const dom = domainById(vertical, domainId);
    if (!dom) continue;
    receipts.push({
      kind: "event",
      id: e.id,
      label: e.title,
      mins: eventMins(e),
      domainId: dom.id,
      domainName: dom.name,
      domainColor: dom.color,
      projectId: null,
      projectName: null,
      eventKey: eventKey(e),
      at: e.start_at,
    });
  }

  // ── Activity units (merged PRs) — zero minutes, but real shipped evidence ──
  for (const u of activityUnits) {
    const at = new Date(u.occurred_at);
    if (at < weekStart || at >= weekEnd) continue;
    const proj = u.project_id ? projectById(vertical, u.project_id) : null;
    const dom = proj ? domainById(vertical, proj.domainId) : null;
    if (!dom) continue;
    receipts.push({
      kind: "activity",
      id: u.id,
      label: u.title,
      mins: 0,
      domainId: dom.id,
      domainName: dom.name,
      domainColor: dom.color,
      projectId: proj?.id ?? null,
      projectName: proj?.name ?? null,
      url: u.url,
      at: u.occurred_at,
    });
  }

  // ── Roll up by domain ─────────────────────────────────────────────────────
  const byDomain = new Map<string, DomainEvidence>();
  for (const d of vertical.domains) {
    byDomain.set(d.id, {
      domainId: d.id,
      domainName: d.name,
      domainColor: d.color,
      mins: 0,
      taskMins: 0,
      meetingMins: 0,
      receipts: [],
    });
  }
  for (const r of receipts) {
    const entry = byDomain.get(r.domainId);
    if (!entry) continue;
    entry.receipts.push(r);
    if (r.kind === "task") {
      entry.taskMins += r.mins;
      entry.mins += r.mins;
    } else if (r.kind === "event") {
      entry.meetingMins += r.mins;
      entry.mins += r.mins;
    }
  }

  // Sealed override: prefer the snapshotted hours when provided (pulse history).
  if (input.domainHoursOverride) {
    for (const [id, hours] of Object.entries(input.domainHoursOverride)) {
      const entry = byDomain.get(id);
      if (entry) entry.mins = Math.round(hours * 60);
    }
  }

  const domains = [...byDomain.values()]
    .map((d) => ({
      ...d,
      receipts: [...d.receipts].sort((a, b) => b.mins - a.mins || (b.at ?? "").localeCompare(a.at ?? "")),
    }))
    .sort((a, b) => b.mins - a.mins);

  // Prior week hours from the 13-week pulse (index 12 = current, 11 = prior…).
  const priorDomainHours: Record<string, number> = {};
  const priorIdx = 12 - weeksBack - 1;
  if (priorIdx >= 0) {
    for (const d of vertical.domains) {
      priorDomainHours[d.id] = priorIdx < d.weeks.length ? d.weeks[priorIdx] : 0;
    }
  }

  return {
    weekStartISO,
    domains,
    receipts: receipts.sort((a, b) => b.mins - a.mins),
    priorDomainHours,
  };
}
