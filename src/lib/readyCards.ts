/**
 * Get ready (D-206) — the cards that take this screen to ready, worst first.
 *
 * "Health" is Readiness (docs/readiness-model.md) given an act. Each card is
 * ONE thing, ONE evidence line (P6), and ONE act written as where the thing
 * goes (D-204): a time, a named place, or a state. Nothing is written until the
 * act is pressed (P3). The surfaces show at most `READY_MAX` at once and refill
 * as one leaves; nothing here — and nothing on screen — counts what is left
 * (P4: a stack of fixes must not read as a debt list).
 *
 * The order, worst first:
 *
 *   repair     a block the week broke          → "Move to Wed 9–10am" · "Leave it where it is"
 *   repairAll  more breaks than cards          → "Repair"   (opens the Repair mode)
 *   hold       today's work with no time       → "Hold 2–2:30pm" (or the next opening this week)
 *   loose      the week's slate work, no time  → "Hold Tue 10–11am"
 *   plan       more loose work than cards      → "Plan the week" (opens the Plan mode)
 *   file       an inbox capture with a guess   → "→ Frontier Church"
 *   path       a thin project (D-196)          → "Draft the path"
 *   memory     one sure Memory observation     → "Keep: <consequence>"
 *
 * Pure: no React, no storage, no clock of its own. The live half
 * (`components/plan/useReadyCards`) reads the models — `useRepairs`,
 * `useTodayHolds`, `useWeekCrown`, the router's guess, `useThinPaths`,
 * `useMemory` — and hands this their output plus the acts.
 */

import { isSnoozed } from "./railOffers";
import { instantAt, whereSpan } from "../components/plan/destinations";
import { at, span } from "../components/mobile/dayPlan";
import { parseDateISO } from "./dates";
import { blocks, lineFrom, type CrownLineData, type LineCard } from "./crownLine";

export type ReadyKind = "repair" | "repairAll" | "hold" | "loose" | "plan" | "file" | "path" | "memory" | "risk" | "shape";

/** At most this many cards show at once (D-206). */
export const READY_MAX = 5;
/** Broken blocks carded one by one before the rest go to the Repair mode. */
export const REPAIR_CARDS_MAX = 2;
/** Loose slate pieces carded one by one before the rest go to Plan the week. */
export const LOOSE_CARDS_MAX = 2;

export interface Where {
  dayISO: string;
  startMin: number;
  durationMin: number;
}

export interface ReadyAct {
  /** the verb — never truncates */
  verb: string;
  /** the destination — truncates when long */
  name?: string;
  /** `from` is the pressed control: the Reach starts there */
  run: (from: HTMLElement | null) => void;
}

export interface ReadyCard {
  /** stable across renders */
  key: string;
  kind: ReadyKind;
  /** the thing */
  title: string;
  /** one evidence line (P6) */
  why: string;
  primary: ReadyAct;
  /** "Not now" (snoozes two weeks), or a repair's "Leave it where it is" */
  secondary?: { label: string; run: () => void };
  /** the crown row the act moves — the Reach's target */
  projectId: string | null;
  /** a card that opens a mode instead of writing */
  opensMode?: "plan" | "repair";
}

export interface ReadyActs {
  move: (repairKey: string, from: HTMLElement | null) => void;
  leave: (repairKey: string) => void;
  repairAll: () => void;
  hold: (taskId: string, from: HTMLElement | null) => void;
  holdLoose: (taskId: string, from: HTMLElement | null) => void;
  planWeek: () => void;
  file: (taskId: string, from: HTMLElement | null) => void;
  draftPath: (projectId: string) => void;
  keep: (memoryKey: string) => void;
  /** Not now — the same two-week snooze the row chips use (offerSnooze) */
  notNow: (snoozeKey: string) => void;
}

export interface ReadyInput {
  todayISO: string;
  repairs?: readonly {
    key: string;
    title: string;
    why: "missed" | "meeting";
    event?: string | null;
    from: Where;
    /** the composer's fit */
    to: Where;
    projectId: string | null;
  }[];
  /** today's tasks with no time, each with Find time's fit */
  holds?: readonly { taskId: string; title: string; projectId: string | null; at: Where }[];
  /** the slate's loose pieces, in crown order; `at` is the composer's fit, if any */
  loose?: readonly { taskId: string; title: string; projectId: string; projectName: string; at: Where | null }[];
  /** inbox captures the router is sure enough of */
  inbox?: readonly { taskId: string; title: string; place: string; projectId: string | null }[];
  /** thin paths (D-196); `evidence` is `thinChip` */
  thin?: readonly { projectId: string; name: string; evidence: string }[];
  /** one sure observation — the first is taken */
  memory?: { key: string; statement: string; evidence: string; consequence: string } | null;
  /** the week the plan card plans — its Not now lasts the week */
  weekISO?: string;
  snoozed?: Record<string, string>;
  now?: number;
  acts: ReadyActs;
}

/** Snooze keys. hold/file/path share the row chips' keys (D-205), so a Not now
 *  said on a chip holds here too, and the other way round. */
export const readyKey = {
  hold: (id: string) => `hold:${id}`,
  file: (id: string) => `file:${id}`,
  path: (id: string) => `path:${id}`,
  loose: (id: string) => `loose:${id}`,
  memory: (key: string) => `memory:${key}`,
  plan: (weekISO: string) => `plan:${weekISO}`,
} as const;

const NOT_NOW = "Not now";

/** "2–2:30pm" today, "Tue 10–11am" any other day — the clock vocabulary. */
export function whenLabel(p: Where, todayISO: string): string {
  if (p.dayISO !== todayISO) return whereSpan(p);
  return span(instantAt(p.dayISO, p.startMin), instantAt(p.dayISO, p.startMin + p.durationMin));
}

/** Every card, worst first. Surfaces show the first `READY_MAX`. */
export function composeReadyCards(input: ReadyInput): ReadyCard[] {
  const { acts, todayISO } = input;
  const now = input.now ?? Date.now();
  const off = (key: string) => isSnoozed(key, input.snoozed, now);
  const notNow = (key: string) => ({ label: NOT_NOW, run: () => acts.notNow(key) });
  const out: ReadyCard[] = [];

  // ── a broken block ─────────────────────────────────────────────────────
  const repairs = input.repairs ?? [];
  for (const r of repairs.slice(0, REPAIR_CARDS_MAX)) {
    out.push({
      key: `repair:${r.key}`,
      kind: "repair",
      title: r.title,
      why: `${r.why === "missed" ? "Missed" : `${r.event || "A meeting"} landed on it`} · was ${whereSpan(r.from)}`,
      primary: { verb: "Move to", name: whereSpan(r.to), run: (el) => acts.move(r.key, el) },
      secondary: { label: "Leave it where it is", run: () => acts.leave(r.key) },
      projectId: r.projectId,
    });
  }
  if (repairs.length > REPAIR_CARDS_MAX) {
    out.push({
      key: "repairAll",
      kind: "repairAll",
      title: "The rest of the broken blocks",
      why: "Put back one at a time, on the grid",
      primary: { verb: "Repair", run: () => acts.repairAll() },
      projectId: null,
      opensMode: "repair",
    });
  }

  // ── today's work with no time ─────────────────────────────────────────
  const held = new Set<string>();
  for (const h of input.holds ?? []) {
    if (off(readyKey.hold(h.taskId))) continue;
    held.add(h.taskId);
    out.push({
      key: readyKey.hold(h.taskId),
      kind: "hold",
      title: h.title,
      why: h.at.dayISO === todayISO ? "Today · no time yet" : "Today · no time left today",
      primary: { verb: "Hold", name: whenLabel(h.at, todayISO), run: (el) => acts.hold(h.taskId, el) },
      secondary: notNow(readyKey.hold(h.taskId)),
      projectId: h.projectId,
    });
  }

  // ── the week's loose slate work ───────────────────────────────────────
  const loose = (input.loose ?? []).filter((l) => !held.has(l.taskId));
  let carded = 0;
  for (const l of loose) {
    if (carded >= LOOSE_CARDS_MAX) break;
    if (!l.at || off(readyKey.loose(l.taskId))) continue;
    carded++;
    out.push({
      key: readyKey.loose(l.taskId),
      kind: "loose",
      title: l.title,
      why: `${l.projectName} · no time this week`,
      primary: { verb: "Hold", name: whenLabel(l.at, todayISO), run: (el) => acts.holdLoose(l.taskId, el) },
      secondary: notNow(readyKey.loose(l.taskId)),
      projectId: l.projectId,
    });
  }
  // Loose work the cards don't carry — no fit, past the cards, or set aside —
  // goes to the walk, as one card.
  const planKey = readyKey.plan(input.weekISO ?? todayISO);
  if (loose.length > carded && !off(planKey)) {
    out.push({
      key: planKey,
      kind: "plan",
      title: "Plan the whole week",
      why: "More of the week's work has no time than fits here",
      primary: { verb: "Plan the week", run: () => acts.planWeek() },
      secondary: notNow(planKey),
      projectId: null,
      opensMode: "plan",
    });
  }

  // ── inbox captures with a guess ───────────────────────────────────────
  for (const f of input.inbox ?? []) {
    if (off(readyKey.file(f.taskId))) continue;
    out.push({
      key: readyKey.file(f.taskId),
      kind: "file",
      title: f.title,
      why: "In the inbox",
      primary: { verb: "→", name: f.place, run: (el) => acts.file(f.taskId, el) },
      secondary: notNow(readyKey.file(f.taskId)),
      projectId: f.projectId,
    });
  }

  // ── thin projects ─────────────────────────────────────────────────────
  for (const t of input.thin ?? []) {
    if (off(readyKey.path(t.projectId))) continue;
    out.push({
      key: readyKey.path(t.projectId),
      kind: "path",
      title: t.name,
      why: t.evidence,
      primary: { verb: "Draft the path", run: () => acts.draftPath(t.projectId) },
      secondary: notNow(readyKey.path(t.projectId)),
      projectId: t.projectId,
    });
  }

  // ── one sure Memory observation ───────────────────────────────────────
  const m = input.memory;
  if (m && !off(readyKey.memory(m.key))) {
    out.push({
      key: readyKey.memory(m.key),
      kind: "memory",
      title: m.statement,
      why: m.evidence,
      primary: { verb: "Keep:", name: m.consequence, run: () => acts.keep(m.key) },
      secondary: notNow(readyKey.memory(m.key)),
      projectId: null,
    });
  }

  return out;
}

// ── the crown's line (D-207) ────────────────────────────────────────────────

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2pm" today, "Tue 2pm" any other day. */
function whenShort(p: Where, todayISO: string): string {
  const t = at(instantAt(p.dayISO, p.startMin));
  return p.dayISO === todayISO ? t : `${DAY[parseDateISO(p.dayISO).getDay()]} ${t}`;
}

/** The Schedule's line: the stack's first card, said as a fact (docs/rail-line.md
 *  §4.1). `afterHours` folds today's misses into one line once the working day
 *  is over, so nothing reads as an alarm overnight. */
export function scheduleLine(
  input: Pick<ReadyInput, "todayISO" | "repairs" | "holds" | "loose">,
  cards: readonly ReadyCard[],
  opts: { afterHours?: boolean } = {},
): CrownLineData | null {
  const { todayISO } = input;
  const repairs = input.repairs ?? [];
  const holdIds = new Set((input.holds ?? []).map((h) => h.taskId));
  const noTime = holdIds.size + (input.loose ?? []).filter((l) => !holdIds.has(l.taskId)).length;

  const allMissed = repairs.length > 0 && repairs.every((r) => r.why === "missed");
  const allMeeting = repairs.length > 0 && repairs.every((r) => r.why === "meeting");
  const repairFact = (): string => {
    if (repairs.length === 1) {
      const r = repairs[0];
      return r.why === "missed"
        ? `${r.title} didn't happen (${whenShort(r.from, todayISO)})`
        : `${r.event || "A meeting"} landed on ${r.title}`;
    }
    const n = repairs.length;
    if (allMissed && opts.afterHours && repairs.every((r) => r.from.dayISO === todayISO)) return `${n} from today didn't happen`;
    if (allMissed) return `${blocks(n)} didn't happen`;
    return `${blocks(n)} need a new time`;
  };

  const lineCards: LineCard[] = cards.map((c): LineCard => {
    switch (c.kind) {
      case "repair":
      case "repairAll":
        return {
          part: "repair",
          fact: repairFact(),
          then: `${blocks(repairs.length)} to put back`,
          tone: "warn",
          glyph: allMeeting ? "↯" : "◌",
        };
      case "hold":
      case "loose":
      case "plan":
        return { part: "time", fact: `${noTime} with no time`, then: `${noTime} with no time`, tone: "accent" };
      case "file":
        return { part: "file", fact: `${c.title} · in the inbox`, then: "the inbox", tone: "accent" };
      case "path":
        return { part: "shape", fact: `${c.title}: ${c.why}`, then: `${c.title}'s path`, tone: "accent" };
      case "memory":
        return { part: "memory", fact: `Nuvo noticed: ${c.title}`, then: "something Nuvo noticed", tone: "accent" };
      case "risk":
      case "shape":
        // the decks' kinds (lib/deckReady) — they never reach the Schedule's stack
        return { part: "shape", fact: `${c.title}: ${c.why}`, then: c.title, tone: "accent" };
    }
  });
  return lineFrom(lineCards);
}
