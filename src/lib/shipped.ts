// Shipped — the retrospective read-model. Where On Deck answers "what's ahead,"
// this answers "what did I finish." Completed projects/initiatives don't just fade
// off the deck; they collect here, grouped by the period their finish line landed
// in, so the wall reads as a growing record of delivered work. Pure over a
// VerticalData snapshot — no scoring, just an arrangement of the completed set.
//
// We group by the day it ACTUALLY crossed the line (`shippedAt`), not by the day
// it was due (`targetDate`) — a project shipped today against a June deadline
// belongs to this month's record, not June's. `targetDate` survives as the
// fallback for initiatives, which carry no completion stamp yet. Projects group
// by MONTH (a project is a week-scale arc), initiatives by QUARTER (a bet is a
// multi-month arc), mirroring how each is time-boxed on its deck.

import {
  endOfQuarter,
  endOfYear,
  getQuarter,
  getYear,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subQuarters,
  subYears,
} from "date-fns";
import { todayISO } from "./dates";
import {
  domainById,
  isProjectComplete,
  type Domain,
  type VerticalData,
} from "./vertical";
import { seedFromWeek, type EmblemSpec } from "./weekEmblem";

export type ShippedGranularity = "month" | "quarter";

export interface ShippedItem {
  id: string;
  name: string;
  domain: Domain | null;
  /** the day it crossed the line — `shippedAt`, or the finish line as fallback. */
  at: string | null;
}

/** The day it actually crossed the line. `shippedAt` is stamped at the one write
 *  choke point every ship path goes through (useVertical.updateProject) and was
 *  backfilled to `target_date` for everything older (migration 35), so it is at
 *  worst as reconstructable as the finish line and usually truer — which is the
 *  same call the kernel already made (`planningRules.shippedInWeek`: "shippedAt
 *  is the only honest answer — targetDate is when it was DUE"). `targetDate`
 *  survives as the fallback for INITIATIVES, which carry no stamp yet.
 *
 *  `todayISO` (not `.slice(0,10)`) so an evening ship files under the local day
 *  it happened, matching how completed blocks are dated. */
function shipDate(x: { shippedAt?: string | null; targetDate: string | null }): string | null {
  return x.shippedAt ? todayISO(new Date(x.shippedAt)) : x.targetDate;
}

export interface ShippedGroup {
  key: string; // sort key, e.g. "2026-07" | "2026-Q3"
  label: string; // "July 2026" | "Q3 2026"
  items: ShippedItem[];
}

export interface ShippedBoard {
  total: number;
  /** completed items grouped by finish-line period, most recent first. */
  groups: ShippedGroup[];
  /** how many landed in the current month/quarter — the celebratory strip figure. */
  thisPeriodCount: number;
  /** "this month" | "this quarter" — for the strip copy. */
  periodNoun: string;
  /** per-domain tallies, most shipped first. */
  byDomain: { domain: Domain | null; count: number }[];
}

const parse = (iso: string) => new Date(iso + "T12:00:00");

/** The period key + human label a finish line falls in, at the given grain. */
function period(iso: string | null, grain: ShippedGranularity): { key: string; label: string } {
  if (!iso) return { key: "0000-undated", label: "No finish line" };
  const d = parse(iso);
  if (grain === "quarter") {
    return {
      key: `${getYear(d)}-Q${getQuarter(d)}`,
      label: `Q${getQuarter(d)} ${getYear(d)}`,
    };
  }
  return {
    key: `${getYear(d)}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
  };
}

/** The period key for `now`, so we can tally "shipped this month/quarter". */
function currentPeriodKey(now: Date, grain: ShippedGranularity): string {
  const start = grain === "quarter" ? startOfQuarter(now) : startOfMonth(now);
  return period(
    `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`,
    grain,
  ).key;
}

export function readShipped(
  d: VerticalData,
  rung: "project" | "initiative",
  now: Date,
): ShippedBoard {
  const grain: ShippedGranularity = rung === "initiative" ? "quarter" : "month";
  const source = rung === "initiative" ? d.initiatives : d.projects;
  const done = source.filter((x) => isProjectComplete(x.status));

  const items: ShippedItem[] = done.map((x) => ({
    id: x.id,
    name: x.name,
    domain: domainById(d, x.domainId),
    at: shipDate(x),
  }));

  // group by the period it shipped in, newest first WITHIN each group too —
  // otherwise a group lands in `sort_order`, which has nothing to do with when
  const map = new Map<string, ShippedGroup>();
  for (const it of items) {
    const p = period(it.at, grain);
    const g = map.get(p.key) ?? { key: p.key, label: p.label, items: [] };
    g.items.push(it);
    map.set(p.key, g);
  }
  for (const g of map.values()) g.items.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  // undated bucket sinks to the bottom; everything else newest-first
  const groups = [...map.values()].sort((a, b) =>
    a.key === "0000-undated" ? 1 : b.key === "0000-undated" ? -1 : b.key.localeCompare(a.key),
  );

  const curKey = currentPeriodKey(now, grain);
  const thisPeriodCount = items.filter((it) => period(it.at, grain).key === curKey).length;

  // per-domain tally
  const domCount = new Map<string, { domain: Domain | null; count: number }>();
  for (const it of items) {
    const k = it.domain?.id ?? "—";
    const cur = domCount.get(k) ?? { domain: it.domain, count: 0 };
    cur.count += 1;
    domCount.set(k, cur);
  }
  const byDomain = [...domCount.values()].sort((a, b) => b.count - a.count);

  return {
    total: items.length,
    groups,
    thisPeriodCount,
    periodNoun: grain === "quarter" ? "this quarter" : "this month",
    byDomain,
  };
}

// ── The period Gain — the celebratory rail's read-model ──────────────────────
//
// Altitude ladder: the wall groups projects by month and initiatives by quarter;
// the rail zooms ONE level out — projects celebrate by the QUARTER, initiatives
// by the calendar YEAR. It measures backward from that period's start line: what
// you closed and which domains you moved.
//
// The constellation encodes WINS PER DOMAIN (contribution), not hours — because
// that's the durable, reconstructable signal (it's just a stored date on the row),
// so it steps cleanly through any past period at any altitude with no stored
// snapshot. Domains with zero wins in the period never appear. Hours (time
// invested) only exist for the last ~90 days in the data, so they ride along as an
// honest, current-period-only companion (see `hours`), never pinned to a stepped
// period.
//
// That durability argument is why this counts wins — but it does NOT argue for
// `targetDate`, which is only when a thing was DUE. `shippedAt` is equally stored
// and was backfilled to `target_date` for every older row (migration 35), so it is
// never thinner and usually truer. See `shipDate`.

export type ShippedRung = "project" | "initiative";

export interface PeriodContribution {
  domain: Domain;
  ships: number; // finish lines attributed to this domain in the period
}

export interface PeriodHours {
  domain: Domain;
  hours: number; // Domain.quarterHours — the last-90-days arc
  note: string; // a warm, derived showing-up line
}

export interface PeriodGain {
  /** 0 = current period; 1 = one step back; … (the stepper's position). */
  offset: number;
  /** "Q3 2026" (projects) | "2026" (initiatives). */
  label: string;
  /** true when viewing the live period (offset 0). */
  isCurrent: boolean;
  /** is there any finished work before this window? (stepper bound). */
  canGoBack: boolean;
  /** offset > 0 (stepper bound). */
  canGoForward: boolean;

  /** finish lines crossed in this period (the hero count). */
  count: number;
  /** wins per domain in the period, most first — the contribution constellation. */
  contribution: PeriodContribution[];
  /** how many domains you moved this period. */
  domainsInMotion: number;
  /** shipped in the period with no domain — the attribution queue. */
  loose: ShippedItem[];
  /** the constellation, as a reused emblem spec (rings ∝ wins per domain). */
  emblem: EmblemSpec;
  /** Nuvo's one-line read — deterministic for now, upgradeable to the nano voice. */
  nuvoRead: string;

  /** the ~90-day hours companion — ONLY on the current period; null when stepped back. */
  hours: PeriodHours[] | null;
}

interface PeriodWindow {
  start: Date;
  end: Date;
  label: string;
  seedKey: string;
}

/** The period bounds + label for a rung at a given step-back offset. */
function periodWindow(rung: ShippedRung, now: Date, offset: number): PeriodWindow {
  if (rung === "initiative") {
    const base = subYears(now, offset);
    return { start: startOfYear(base), end: endOfYear(base), label: `${getYear(base)}`, seedKey: `${getYear(base)}` };
  }
  const base = subQuarters(now, offset);
  return {
    start: startOfQuarter(base),
    end: endOfQuarter(base),
    label: `Q${getQuarter(base)} ${getYear(base)}`,
    seedKey: `${getYear(base)}-Q${getQuarter(base)}`,
  };
}

/** Trailing run of weeks with any invested hours — the presence streak. */
function trailingStreak(weeks: number[]): number {
  let n = 0;
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (weeks[i] > 0) n++;
    else break;
  }
  return n;
}

/** A warm, honest one-liner for a domain's recent hours — derived, never invented. */
function hoursNote(dom: Domain): string {
  const streak = trailingStreak(dom.weeks);
  const target = dom.weeklyTargetHours * 13;
  if (streak >= 11) return "In motion nearly every week.";
  if (target > 0 && dom.quarterHours >= target) return "Cleared the quarter's mark.";
  if (streak >= 5) return `${streak} weeks running.`;
  return "Hours kept flowing in.";
}

export function readPeriodGain(
  d: VerticalData,
  rung: ShippedRung,
  now: Date,
  offset = 0,
): PeriodGain {
  const win = periodWindow(rung, now, offset);
  const source = rung === "initiative" ? d.initiatives : d.projects;
  // `shipDate` rather than `targetDate` — which also stops a completed project
  // with no finish line set from being invisible on this rail forever
  const done = source.filter((x) => isProjectComplete(x.status) && shipDate(x));

  const items: ShippedItem[] = done
    .filter((x) => {
      const when = parse(shipDate(x) as string);
      return when >= win.start && when <= win.end;
    })
    .map((x) => ({ id: x.id, name: x.name, domain: domainById(d, x.domainId), at: shipDate(x) }));

  // wins per domain — the contribution signal, reconstructable at any period
  const shipsByDomain = new Map<string, number>();
  for (const it of items) {
    if (!it.domain) continue;
    shipsByDomain.set(it.domain.id, (shipsByDomain.get(it.domain.id) ?? 0) + 1);
  }
  const contribution: PeriodContribution[] = d.domains
    .map((dom) => ({ domain: dom, ships: shipsByDomain.get(dom.id) ?? 0 }))
    .filter((c) => c.ships > 0)
    .sort((a, b) => b.ships - a.ships);

  const loose = items.filter((it) => !it.domain);

  // ── the constellation: rings ∝ wins per domain ────────────────────────────
  const maxShips = Math.max(1, ...contribution.map((c) => c.ships));
  const totalShips = contribution.reduce((s, c) => s + c.ships, 0);
  const dominant = contribution[0] ?? null;
  const emblem: EmblemSpec = {
    sun: {
      color: dominant?.domain.color ?? "var(--accent)",
      intensity: totalShips > 0 && dominant ? dominant.ships / totalShips : 0,
    },
    rings: contribution.map((c) => ({
      color: c.domain.color,
      sweep: Math.min(1, c.ships / maxShips),
      targetSweep: 0, // no "target" for wins — the ring is pure contribution
      ember: false,
    })),
    satellites: [],
    ambient: items.length, // shipped volume → faint scattered light
    seed: seedFromWeek(win.seedKey),
  };

  // ── the hours companion — current period only (data is ~90 days deep) ──────
  const hours: PeriodHours[] | null =
    offset === 0
      ? d.domains
          .map((dom) => ({ domain: dom, hours: Math.round(dom.quarterHours), note: "" }))
          .filter((h) => h.hours > 0)
          .sort((a, b) => b.hours - a.hours)
          .map((h) => ({ ...h, note: hoursNote(h.domain) }))
      : null;

  const canGoBack = done.some((x) => parse(shipDate(x) as string) < win.start);

  return {
    offset,
    label: win.label,
    isCurrent: offset === 0,
    canGoBack,
    canGoForward: offset > 0,
    count: items.length,
    contribution,
    domainsInMotion: contribution.length,
    loose,
    emblem,
    nuvoRead: composePeriodRead(items.length, win.label, offset === 0, contribution),
    hours,
  };
}

/** A single warm sentence over the period — every number real. */
function composePeriodRead(
  count: number,
  label: string,
  isCurrent: boolean,
  contribution: PeriodContribution[],
): string {
  if (count === 0) {
    return isCurrent
      ? `Nothing's crossed the line in ${label} yet — the work's still in flight, and that's alright.`
      : `Nothing landed in ${label}.`;
  }
  const top = contribution[0] ?? null;
  const lead = `You closed ${count} thing${count === 1 ? "" : "s"} in ${label}`;
  if (top) {
    return top.ships === count
      ? `${lead} — all of it in ${top.domain.name}.`
      : `${lead} — ${top.domain.name} carried ${top.ships} of them.`;
  }
  return `${lead}. Something to show for it.`;
}
