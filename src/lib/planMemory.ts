// What the planner remembers about you (docs/plan-the-week-v2.md §6).
//
// Every correction you make to a draft is evidence: a block moved out of an hour,
// time painted clear, a run split, a block taken off. Pure derivation turns
// repeated evidence into at most three PROPOSALS — "8–9am stayed clear 3 of the
// last 4 weeks. Keep it clear?" — and a Keep becomes a RULE the composer obeys
// next time. Nothing is applied that you didn't keep (P3); nothing is proposed
// from one week's data (§6: three of the last four weeks, and it says so).
//
// TRIAL STORAGE: signals and rules live in this device's localStorage, not the
// database. The spec's `plan_signals` table (with RLS) waits until the trial says
// the proposals are worth keeping — a migration is not the place to find out.
// The functions below are pure over plain data so the storage can move without
// touching them.

export type PlanSignal =
  | { kind: "moved"; week: string; dayISO: string; fromMin: number; toDayISO: string; toMin: number; durationMin: number; isRun: boolean }
  | { kind: "cleared"; week: string; weekdays: number[]; startMin: number; endMin: number }
  | { kind: "split"; week: string; durationMin: number; isRun: boolean }
  | { kind: "removed"; week: string; isRun: boolean }
  | { kind: "held"; week: string };

export interface ClearRule {
  id: string;
  /** 0=Sun…6=Sat */
  weekdays: number[];
  startMin: number;
  endMin: number;
  label: string;
}

export interface PlanRules {
  clears: ClearRule[];
  /** weekday → the minute that day's planning ends */
  dayEnds: Record<number, number>;
  /** loose runs never longer than this; null = the default cap */
  runCap: number | null;
}

export interface PlanMemory {
  signals: (PlanSignal & { at: string })[];
  rules: PlanRules;
  /** proposal id → ISO date until which it isn't asked again */
  forgotten: Record<string, string>;
}

export interface Proposal {
  id: string;
  label: string;
  chip: string;
  /** the last four weeks, oldest first: did the evidence show up that week? */
  pips: boolean[];
  why: string;
  apply: (r: PlanRules) => PlanRules;
}

export const EMPTY_RULES: PlanRules = { clears: [], dayEnds: {}, runCap: null };
const KEY = "nuvo.planMemory.v1";
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const WEEKDAYS = [1, 2, 3, 4, 5];

export function loadMemory(): PlanMemory {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const m = JSON.parse(raw) as Partial<PlanMemory>;
      return {
        signals: Array.isArray(m.signals) ? m.signals : [],
        rules: { ...EMPTY_RULES, ...(m.rules ?? {}) },
        forgotten: m.forgotten ?? {},
      };
    }
  } catch {
    /* unreadable storage reads as an empty memory */
  }
  return { signals: [], rules: { ...EMPTY_RULES }, forgotten: {} };
}

export function saveMemory(m: PlanMemory) {
  try {
    // keep ~6 months of evidence; the derivation only reads four weeks
    localStorage.setItem(KEY, JSON.stringify({ ...m, signals: m.signals.slice(-2000) }));
  } catch {
    /* storage refused — the plan still works, it just forgets */
  }
}

const hm = (m: number) => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}${mm ? ":" + String(mm).padStart(2, "0") : ""}${h >= 12 ? "pm" : "am"}`;
};
const hspan = (a: number, b: number) => {
  const pa = Math.floor(a / 60) >= 12;
  const pb = Math.floor(b / 60) >= 12;
  return pa === pb ? `${hm(a).replace(/am|pm/, "")}–${hm(b)}` : `${hm(a)}–${hm(b)}`;
};
const weekday = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
};
const addWeeks = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n * 7);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

/** The four weeks the evidence is read over, oldest first, ending with `weekISO`. */
export function lastFourWeeks(weekISO: string): string[] {
  return [-3, -2, -1, 0].map((n) => addWeeks(weekISO, n));
}

/**
 * Proposals from evidence: at most three, each seen in at least three of the
 * last four weeks, none already a rule, none forgotten recently.
 */
export function proposals(m: PlanMemory, weekISO: string, todayISO: string): Proposal[] {
  const weeks = lastFourWeeks(weekISO);
  const inWindow = m.signals.filter((s) => weeks.includes(s.week));
  const pipsFor = (hit: (w: string) => boolean) => weeks.map(hit);
  const enough = (p: boolean[]) => p.filter(Boolean).length >= 3;
  const out: Proposal[] = [];

  // 1 · an hour you keep clear: painted clear, or moved out of, three weeks running
  for (let h = 6 * 60; h <= 19 * 60; h += 60) {
    const id = `clear-${h}`;
    if (m.rules.clears.some((c) => c.startMin <= h && c.endMin >= h + 60)) continue;
    const pips = pipsFor((w) =>
      inWindow.some(
        (s) =>
          s.week === w &&
          ((s.kind === "cleared" && s.startMin <= h && s.endMin >= h + 60) ||
            (s.kind === "moved" && s.fromMin < h + 60 && s.fromMin + s.durationMin > h && (s.toDayISO !== s.dayISO || s.toMin >= h + 60 || s.toMin + s.durationMin <= h))),
      ),
    );
    if (!enough(pips)) continue;
    out.push({
      id,
      label: `Keep ${hspan(h, h + 60)} clear`,
      chip: "weekdays",
      pips,
      why: `You cleared or moved work out of ${hspan(h, h + 60)} in ${pips.filter(Boolean).length} of the last 4 weeks.`,
      apply: (r) => ({
        ...r,
        clears: [...r.clears, { id, weekdays: WEEKDAYS, startMin: h, endMin: h + 60, label: "Kept clear" }],
      }),
    });
  }

  // 2 · a day that ends early: blocks late in that day moved off it, three weeks running
  for (const wd of WEEKDAYS) {
    const id = `dayend-${wd}`;
    if (m.rules.dayEnds[wd] != null) continue;
    const late = inWindow.filter(
      (s): s is Extract<PlanSignal, { kind: "moved" }> & { at: string } =>
        s.kind === "moved" && weekday(s.dayISO) === wd && s.fromMin >= 13 * 60 && (s.toDayISO !== s.dayISO || s.toMin < s.fromMin),
    );
    const pips = pipsFor((w) => late.some((s) => s.week === w));
    if (!enough(pips)) continue;
    const endAt = Math.floor(Math.min(...late.map((s) => s.fromMin)) / 60) * 60;
    out.push({
      id,
      label: `End ${DAYS[wd]} at ${hm(endAt)}`,
      chip: DAY[wd],
      pips,
      why: `Work after ${hm(endAt)} on ${DAY[wd]} was moved off it in ${pips.filter(Boolean).length} of the last 4 weeks.`,
      apply: (r) => ({ ...r, dayEnds: { ...r.dayEnds, [wd]: endAt } }),
    });
  }

  // 3 · runs you keep splitting
  if (m.rules.runCap == null) {
    const splits = inWindow.filter((s): s is Extract<PlanSignal, { kind: "split" }> & { at: string } => s.kind === "split" && s.isRun);
    const pips = pipsFor((w) => splits.some((s) => s.week === w));
    if (enough(pips)) {
      const halves = splits.map((s) => s.durationMin / 2).sort((a, b) => a - b);
      const cap = Math.max(30, Math.round(halves[Math.floor(halves.length / 2)] / 15) * 15);
      out.push({
        id: "runcap",
        label: `Runs ≤ ${cap}m`,
        chip: "cap",
        pips,
        why: `You split runs in ${pips.filter(Boolean).length} of the last 4 weeks, usually into ${cap}-minute halves.`,
        apply: (r) => ({ ...r, runCap: cap }),
      });
    }
  }

  return out.filter((p) => !(m.forgotten[p.id] && m.forgotten[p.id] > todayISO)).slice(0, 3);
}

/** Forget a proposal for eight weeks. */
export function forget(m: PlanMemory, id: string, todayISO: string): PlanMemory {
  const [y, mo, d] = todayISO.split("-").map(Number);
  const until = new Date(y, mo - 1, d + 56);
  const iso = `${until.getFullYear()}-${String(until.getMonth() + 1).padStart(2, "0")}-${String(until.getDate()).padStart(2, "0")}`;
  return { ...m, forgotten: { ...m.forgotten, [id]: iso } };
}

/** The rules, spoken — the list of what Nuvo keeps, each removable. */
export function describeRules(r: PlanRules): { id: string; text: string; remove: (r: PlanRules) => PlanRules }[] {
  const out: { id: string; text: string; remove: (r: PlanRules) => PlanRules }[] = [];
  for (const c of r.clears) {
    const days = c.weekdays.length === 5 && WEEKDAYS.every((d) => c.weekdays.includes(d)) ? "weekdays" : c.weekdays.map((d) => DAY[d]).join(", ");
    out.push({ id: c.id, text: `${hspan(c.startMin, c.endMin)} clear · ${days}`, remove: (x) => ({ ...x, clears: x.clears.filter((y) => y.id !== c.id) }) });
  }
  for (const [wd, end] of Object.entries(r.dayEnds)) {
    out.push({
      id: `dayend-${wd}`,
      text: `${DAYS[Number(wd)]} end at ${hm(end)}`,
      remove: (x) => {
        const dayEnds = { ...x.dayEnds };
        delete dayEnds[Number(wd)];
        return { ...x, dayEnds };
      },
    });
  }
  if (r.runCap != null) out.push({ id: "runcap", text: `Runs ≤ ${r.runCap}m`, remove: (x) => ({ ...x, runCap: null }) });
  return out;
}

/**
 * The rules as time the composer can't use on the given days — keep-clear hours
 * and early day ends both read as immovable time. `workEnd` bounds a day end.
 */
export function rulesAsBusy(r: PlanRules, dayISOs: string[], workEnd: number): { dayISO: string; startMin: number; endMin: number; label: string }[] {
  const out: { dayISO: string; startMin: number; endMin: number; label: string }[] = [];
  for (const iso of dayISOs) {
    const wd = weekday(iso);
    for (const c of r.clears) if (c.weekdays.includes(wd)) out.push({ dayISO: iso, startMin: c.startMin, endMin: c.endMin, label: c.label });
    const end = r.dayEnds[wd];
    if (end != null && end < workEnd) out.push({ dayISO: iso, startMin: end, endMin: workEnd, label: `${DAYS[wd]} end at ${hm(end)}` });
  }
  return out;
}
