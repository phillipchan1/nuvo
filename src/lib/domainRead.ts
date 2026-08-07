// How a domain READS — the derived sentences and marks the Domain surfaces are
// built from, in one place so the desktop floor and the phone can never disagree
// about whether a domain is quiet, whether it routes clean, or what Nuvo would
// say about it.
//
// Pure selectors over the live VerticalData snapshot: no hooks, no AI call, no
// fetching. Everything here answers one of the three questions the domain asks —
// *am I still showing up?* (faithfulness), *can Nuvo file things here?*
// (clarity), and *what should I do about it?* (the read).

import { differenceInCalendarDays, startOfWeek } from "date-fns";
import { parseDateISO, todayISO } from "./dates";
import { readShipped, type ShippedItem } from "./shipped";
import {
  domainStreak,
  faithfulness,
  initiativeAtRisk,
  initiativeEffortGap,
  initiativesOf,
  isOpenStatus,
  type Domain,
  type VerticalData,
} from "./vertical";

// ── Small voices ─────────────────────────────────────────────────────────────
export function ago(d: number) {
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

export function fmtH(h: number) {
  return `${h.toFixed(h % 1 === 0 ? 0 : 1)}h`;
}

export function shipWhen(iso: string | null) {
  if (!iso) return "";
  return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The momentum glyph an initiative wears in a domain's portfolio. */
export const mom = (m: string) => (m === "up" ? "↑" : m === "down" ? "↓" : "→");

// ── Faithfulness, voiced ─────────────────────────────────────────────────────
export type DomainState = { tone: "lit" | "quiet"; line: string; short: string };

export function stateOf(d: Domain): DomainState {
  const f = faithfulness(d);
  if (f.lit) {
    if (d.weeklyTargetHours > 0 && d.investedThisWeek > d.weeklyTargetHours)
      return {
        tone: "lit",
        line: `Groomed ${ago(d.lastTouchedDays)} — over your ${fmtH(d.weeklyTargetHours)} this week`,
        short: `over ${fmtH(d.investedThisWeek)}`,
      };
    return {
      tone: "lit",
      line: `Groomed ${ago(d.lastTouchedDays)} — ${fmtH(d.investedThisWeek)} kept this week`,
      short: "groomed",
    };
  }
  if (d.lastTouchedDays >= 99)
    return { tone: "quiet", line: "Ungroomed — no time has been kept here yet", short: "ungroomed" };
  return {
    tone: "quiet",
    line: `Quiet for ${d.lastTouchedDays} days — when did you last show up here?`,
    short: `quiet · ${d.lastTouchedDays}d`,
  };
}

// ── Clarity, voiced ──────────────────────────────────────────────────────────
// A second axis from faithfulness: how well Nuvo can ROUTE captures here. Read
// purely from persisted state (no AI call).
export type Clarity = { level: "clear" | "partial" | "unrefined"; label: string; why: string; pct: number };

export function clarityOf(d: Domain): Clarity {
  const ctx = d.context;
  if (ctx) {
    const signals = ctx.entities.length + ctx.keywords.length;
    if (signals === 0)
      return {
        level: "partial",
        label: "needs detail",
        why: "Groomed, but Nuvo couldn't pull anything specific to route on — re-groom with a richer line.",
        pct: 0.6,
      };
    const lead = ctx.entities.slice(0, 3).join(", ") || ctx.keywords.slice(0, 3).join(", ");
    return { level: "clear", label: "groomed", why: `Nuvo files captures here by ${lead}.`, pct: 1 };
  }
  if (d.charter.trim())
    return {
      level: "partial",
      label: "groom to finish",
      why: "You've described it — one tap on Groom teaches Nuvo what belongs here.",
      pct: 0.35,
    };
  return {
    level: "unrefined",
    label: "needs grooming",
    why: "Nuvo files here by name alone. Describe what belongs so captures land here.",
    pct: 0,
  };
}

// ── Nuvo's read — derived, no AI call ────────────────────────────────────────
// Turns the existing risk/effort/rhythm selectors into a few honest sentences
// with a suggested next move.
export type Read = { tone: "warn" | "good" | "info"; text: string };

export function domainRead(data: VerticalData, domain: Domain, now: Date): Read[] {
  const out: Read[] = [];
  const st = stateOf(domain);
  const streak = domainStreak(domain.weeks);
  const inits = initiativesOf(data, domain.id).filter((i) => isOpenStatus(i.status));

  // rhythm — the domain going quiet is the first thing worth saying
  if (domain.lastTouchedDays >= 99) {
    out.push({ tone: "info", text: "Nothing's been kept here yet — put the first hour on the calendar and the sigil lights." });
  } else if (st.tone === "quiet") {
    out.push({ tone: "warn", text: `Quiet for ${domain.lastTouchedDays} days — the sigil's cooling. Worth putting an hour back on the calendar this week?` });
  }

  // drifting bets — at-risk initiatives, named with their reasons
  const risky = inits
    .map((i) => ({ i, r: initiativeAtRisk(data, i, now) }))
    .filter((x) => x.r.atRisk)
    .slice(0, 2);
  for (const { i, r } of risky) {
    out.push({ tone: "warn", text: `${i.name} is drifting — ${r.reasons.join(", ")}. Re-groom it, or pull it into this week's plan?` });
  }

  // busywork — real effort that isn't moving the needle (skip if already flagged)
  const flagged = new Set(risky.map((x) => x.i.id));
  for (const i of inits) {
    if (flagged.has(i.id)) continue;
    const gap = initiativeEffortGap(data, i);
    if (gap.busywork) {
      out.push({ tone: "warn", text: `${i.name}: ${fmtH(gap.investedHours)} of finished work, but the outcome's barely moved — the effort isn't landing on the needle.` });
      break;
    }
  }

  // meeting creep — where deep work is getting crowded out
  if (domain.investedThisWeek > 0 && domain.meetingHoursThisWeek / domain.investedThisWeek > 0.5) {
    const pct = Math.round((domain.meetingHoursThisWeek / domain.investedThisWeek) * 100);
    out.push({ tone: "info", text: `Meetings are ${pct}% of your time here this week — worth protecting the deep-work half.` });
  }

  // the affirmation — you're keeping faith
  if (st.tone === "lit" && streak >= 5) {
    const over = domain.weeklyTargetHours > 0 && domain.investedThisWeek > domain.weeklyTargetHours;
    out.push({ tone: "good", text: `You're keeping faith — a ${streak}-week streak${over ? ", over your intent" : ""}. This one's tended.` });
  }

  if (out.length === 0) out.push({ tone: "good", text: "All calm here — nothing's asking for your attention." });
  return out.slice(0, 4);
}

/** Milestones crossed in this domain — shipped initiatives and projects, newest
 *  first. `limit` caps what a surface shows without either shell inventing its
 *  own ordering. */
export function domainShipped(d: VerticalData, domainId: string, now: Date, limit = 5): ShippedItem[] {
  return [
    ...readShipped(d, "initiative", now).groups.flatMap((g) => g.items),
    ...readShipped(d, "project", now).groups.flatMap((g) => g.items),
  ]
    .filter((it) => it.domain?.id === domainId)
    .sort((a, b) => (b.targetDate ?? "").localeCompare(a.targetDate ?? ""))
    .slice(0, limit);
}

/** This week's deep-work vs meeting split — the Gain's two segments. */
export function weekSplit(domain: Domain): { deep: number; meet: number } {
  const meet = Math.max(0, Math.min(domain.investedThisWeek, domain.meetingHoursThisWeek));
  return { deep: Math.max(0, domain.investedThisWeek - meet), meet };
}

// ── This week's SHAPE — seven days, each a stack of the domains that got hours ─
export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** The reference day — keeps a 2h Tuesday from filling the frame. */
export const DAY_FLOOR_HOURS = 8;

export interface WeekShapeRead {
  /** domains with hours this week, heaviest first — one stable column order. */
  active: Domain[];
  /** total hours per weekday, index 0 = Monday. */
  dayTotals: number[];
  /** the column scale: never below one reference day, so a light week reads light. */
  scale: number;
  /** index of today in the week, or -1 when today isn't in it. */
  todayIdx: number;
  /** hours across every active domain this week. */
  total: number;
}

export function readWeekShape(domains: Domain[], now: Date = new Date()): WeekShapeRead {
  // Same week boundary the ledger buckets into (Monday, app timezone), so the
  // columns and the cards can never disagree about which days are "this week".
  const weekStart = startOfWeek(parseDateISO(todayISO(now)), { weekStartsOn: 1 });
  const todayIdx = differenceInCalendarDays(parseDateISO(todayISO(now)), weekStart);
  const active = domains
    .filter((d) => d.investedThisWeek > 0)
    .sort((a, b) => b.investedThisWeek - a.investedThisWeek);
  const dayTotals = DAY_LABELS.map((_, i) => active.reduce((s, d) => s + (d.days[i] ?? 0), 0));
  return {
    active,
    dayTotals,
    scale: Math.max(DAY_FLOOR_HOURS, ...dayTotals),
    todayIdx,
    total: active.reduce((s, d) => s + d.investedThisWeek, 0),
  };
}
