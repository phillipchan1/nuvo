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
  domainKeptCount,
  domainStreak,
  faithfulness,
  initiativeAtRisk,
  initiativeEffortGap,
  initiativesOf,
  isOpenStatus,
  QUARTER_DAYS,
  QUIET_SPEAKS_DAYS,
  SHIP_GLOW_DAYS,
  weeksLabel,
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

/** How long a domain has gone without hours, in its own altitude's units. */
export const quietFor = (days: number) =>
  days < QUIET_SPEAKS_DAYS ? "this week" : `for ${Math.floor(days / 7)} weeks`;

// ── Faithfulness, voiced ─────────────────────────────────────────────────────
export type DomainState = {
  tone: "lit" | "quiet";
  /** WHY it's lit or quiet — lets a surface style or test the delivery case
   *  without a third tone, and without re-deriving it (D-086). */
  because: "kept" | "shipped" | "resting" | "drifting" | "unstarted";
  line: string;
  short: string;
};

export function stateOf(d: Domain): DomainState {
  const ship = d.lastShip;

  // a finish line crossed inside the week — the loudest thing a domain can do
  if (ship && ship.daysAgo <= SHIP_GLOW_DAYS) {
    return {
      tone: "lit",
      because: "shipped",
      line: d.investedThisWeek > 0
        ? `Shipped ${ship.name} ${ago(ship.daysAgo)} · ${fmtH(d.investedThisWeek)} kept this week`
        : `Shipped ${ship.name} ${ago(ship.daysAgo)}`,
      short: "shipped",
    };
  }

  const f = faithfulness(d);
  if (f.lit) {
    const when = ago(d.lastTouchedDays ?? 0);
    if (d.weeklyTargetHours > 0 && d.investedThisWeek > d.weeklyTargetHours)
      return {
        tone: "lit",
        because: "kept",
        line: `Kept ${when} — over your ${fmtH(d.weeklyTargetHours)} this week`,
        short: `over ${fmtH(d.investedThisWeek)}`,
      };
    return {
      tone: "lit",
      because: "kept",
      line: `Kept ${when} — ${fmtH(d.investedThisWeek)} this week`,
      short: "kept",
    };
  }

  // nothing has ever landed — say that, don't invent a failure (P7/P16, D-061)
  if (d.lastTouchedDays == null)
    return { tone: "quiet", because: "unstarted", line: "Nothing kept here yet", short: "unstarted" };

  // quiet, and the last thing that happened here was a FINISH. Quiet before
  // finishing and quiet after finishing are the same day count and opposite
  // meanings; this is the branch that tells them apart.
  if (ship && ship.daysAgo === d.lastTouchedDays && ship.daysAgo <= QUARTER_DAYS)
    return {
      tone: "quiet",
      because: "resting",
      line: `Quiet since ${ship.name} shipped`,
      short: `shipped · ${weeksLabel(ship.daysAgo)}`,
    };

  // the kept-count is CONTEXT — it makes a gap read as a trough in a rhythm rather
  // than a failure. When it's zero there is no rhythm to point at, and saying "0 of
  // 13" after "quiet for 17 weeks" is the same fact twice, which reads as insistence
  const kept = domainKeptCount(d.weeks);
  return {
    tone: "quiet",
    because: "drifting",
    line: kept > 0
      ? `Quiet ${quietFor(d.lastTouchedDays)} — ${kept} of the last 13 weeks kept`
      : `Quiet ${quietFor(d.lastTouchedDays)}`,
    short: d.lastTouchedDays < QUIET_SPEAKS_DAYS ? "quiet" : `quiet · ${weeksLabel(d.lastTouchedDays)}`,
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

  // rhythm — a domain is measured over a QUARTER, so it stays silent about a gap a
  // week long: the 13-week pulse right above already draws it, and repeating it as
  // a sentence turns a normal trough into an accusation (P4 · P9 · D-061 — never
  // shame a quiet domain, sometimes weighting elsewhere was right). Nothing here
  // is `warn`: --signal is reserved for NOW, and a quiet domain is the least "now"
  // thing on the screen. A freshly shipped domain says nothing at all — the hero
  // already names the ship, and saying it twice makes it a trophy.
  if (st.because === "unstarted") {
    out.push({ tone: "info", text: "Nothing's landed here yet — the first hour on the calendar starts the arc." });
  } else if (st.because === "resting" && domain.lastShip) {
    out.push({ tone: "good", text: `You shipped ${domain.lastShip.name} here ${ago(domain.lastShip.daysAgo)}. It's been quiet since — that's what finishing looks like.` });
  } else if (st.because === "drifting" && domain.lastTouchedDays != null && domain.lastTouchedDays >= QUIET_SPEAKS_DAYS) {
    const kept = domainKeptCount(domain.weeks);
    const rhythm = kept > 0 ? ` — you've kept ${kept} of the last 13 weeks here` : "";
    out.push({ tone: "info", text: `Quiet ${quietFor(domain.lastTouchedDays)}${rhythm}. It's there when you're ready, no rush.` });
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
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
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
