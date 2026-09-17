/**
 * Reminder rules — pure, shared by the SPA and the agent.
 *
 * ── Why this file is deliberately small ────────────────────────────────────
 *
 * N-07 in docs/product/decisions.md refused notifications, and Principle 9
 * ("quiet by default") names notification theater as a violation by example.
 * N-07 wrote its own escape clause: *time-critical **now** signals only,
 * opt-in* — and Principle 9 reserves signal for exactly that (`--signal` is
 * now).
 *
 * So the escape clause is encoded here rather than promised in a comment: this
 * module takes an ANCHOR INSTANT and a LEAD, and nothing else. There is no
 * input that could express "you haven't planned your week", no count, no
 * streak, no re-engagement window. A reminder can only ever say *this specific
 * thing is about to happen*. If a future nudge wants to speak, it cannot come
 * through this door without changing its signature — which is the point.
 *
 * Phil ruled on 2026-08-13 (D-105) that push notifications are acceptable *with
 * explicit user consent*, which lifts the restriction on the TRANSPORT — a
 * reminder may reach a closed app. It does not lift the restriction below. A
 * user consenting to reminders has agreed to hear that a meeting starts in ten
 * minutes; they have not agreed to hear that they have four overdue tasks.
 *
 * D-138 (2026-09-04) widened the *horizon* of a lead — a day or a week before
 * is still about that one commitment, the way every calendar app works — not
 * the *subject*. The three facts that may speak are unchanged:
 *   event    — an external calendar commitment (timed, or all-day at the
 *              shared wall-clock)
 *   block    — a block YOU scheduled (task or slot) is about to start
 *   deadline — a deadline you set arrives, at that same wall-clock
 *
 * Zero imports, no side effects, no Date.now() — the caller passes the clock,
 * so both runtimes and every test get the same answers.
 */

export type ReminderTargetKind = "task" | "slot" | "event";

/** Which fact about the target the reminder hangs on. */
export type ReminderAnchorKind = "start" | "deadline";

/** Picker presets, in minutes before the anchor. Custom values are allowed
 *  (see `REMINDER_MAX_LEAD_MINUTES`); this list is only the menu. */
export const REMINDER_LEADS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080] as const;
export type ReminderLead = (typeof REMINDER_LEADS)[number];

/** Google's cap, and ours: more than this on one item is theater. */
export const MAX_REMINDER_LEADS = 5;

/** Longest custom lead — 14 days. The anchor window has to cover this. */
export const REMINDER_MAX_LEAD_MINUTES = 14 * 24 * 60;

/** `null` means silenced — an explicit "don't tell me about this one", which is
 *  a different thing from "no preference" (undefined). */
export type LeadMinutes = number | null;

export interface ReminderPrefs {
  /** Off until asked. A fresh account is silent. */
  enabled: boolean;
  /** Default leads for a timed external calendar event. Empty = never. */
  event_leads: number[];
  /** Default leads for a block you scheduled (timed task or slot). Empty = never. */
  block_leads: number[];
  /** Default leads for a deadline, measured from `deadline_time_minutes`. */
  deadline_leads: number[];
  /** Default leads for an all-day event, measured from `deadline_time_minutes`. */
  all_day_leads: number[];
  /** Minutes after local midnight that a date-only reminder speaks on its day.
   *  Shared by deadlines, all-day events, and an explicit untimed-task override
   *  — one wall-clock, so we don't grow a second "when on the day". */
  deadline_time_minutes: number;
}

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  enabled: false,
  event_leads: [10],
  block_leads: [5],
  deadline_leads: [0],
  all_day_leads: [0],
  deadline_time_minutes: 540, // 9:00 local
};

/** First of a list, or `null` when the list is empty (never). */
export function firstLead(leads: number[]): LeadMinutes {
  return leads.length ? leads[0]! : null;
}

/** Two lists name the same set, order-insensitive. */
export function leadsEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

/** Clamp, dedupe, cap. Empty is a valid answer ("never"). */
export function normalizeLeads(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of raw) {
    const n = parseLead(v);
    if (n == null) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= MAX_REMINDER_LEADS) break;
  }
  return out.sort((a, b) => b - a);
}

/** Fill a partial/legacy `reminder_prefs` jsonb without letting a missing key
 *  silently mean "off" for one field and "default" for another. Reads both the
 *  list keys and the old scalars (`event_lead`, …). */
export function normalizeReminderPrefs(raw: unknown): ReminderPrefs {
  const p = (raw ?? {}) as Record<string, unknown>;
  const timeRaw = p.deadline_time_minutes ?? p.date_time_minutes;
  const time =
    typeof timeRaw === "number" && timeRaw >= 0 && timeRaw < 1440
      ? Math.round(timeRaw)
      : DEFAULT_REMINDER_PREFS.deadline_time_minutes;
  return {
    enabled: p.enabled === true,
    event_leads: leadsFromPref(p.event_leads, p.event_lead, DEFAULT_REMINDER_PREFS.event_leads),
    block_leads: leadsFromPref(p.block_leads, p.block_lead, DEFAULT_REMINDER_PREFS.block_leads),
    deadline_leads: leadsFromPref(p.deadline_leads, p.deadline_lead, DEFAULT_REMINDER_PREFS.deadline_leads),
    all_day_leads: leadsFromPref(p.all_day_leads, p.all_day_lead, DEFAULT_REMINDER_PREFS.all_day_leads),
    deadline_time_minutes: time,
  };
}

function leadsFromPref(list: unknown, scalar: unknown, fallback: number[]): number[] {
  if (Array.isArray(list)) return normalizeLeads(list);
  if (scalar === null) return [];
  const n = parseLead(scalar);
  if (typeof n === "number") return [n];
  return [...fallback];
}

/**
 * One thing that could be reminded about — built by the surface from data it
 * already holds, never fetched for this purpose.
 *
 * `key` is the identity of the ANCHOR, not of a single fire: one task with both
 * a block and a deadline has two anchors and can be silenced independently.
 * Planned fires append `:${lead}` (see `plannedReminderKey`) so two leads on
 * the same meeting cannot mark each other fired.
 *
 * For an external event the stable id is the provider key, not the mirror row
 * id, which a resync can renumber (same reason `hidden_events` is keyed that way).
 */
export interface ReminderAnchor {
  key: string;
  targetKind: ReminderTargetKind;
  /** tasks.id / slots.id / external_events.id — what a click should open. */
  targetId: string;
  anchor: ReminderAnchorKind;
  /** Date-only: all-day event, or an untimed task hanging on `do_date`. */
  allDay?: boolean;
  /** The instant the thing itself happens (ms epoch). */
  atMs: number;
  title: string;
  /** Location, or the project a block serves — one short trailing clause. */
  detail?: string | null;
}

/** A per-item override: a different list, or `[]` to silence just this one. */
export interface ReminderOverride {
  key: string;
  leads: number[];
}

export interface PlannedReminder {
  key: string;
  targetKind: ReminderTargetKind;
  targetId: string;
  anchor: ReminderAnchorKind;
  /** When to speak (ms epoch). */
  fireAtMs: number;
  /** When the thing happens (ms epoch) — the copy reads the difference. */
  atMs: number;
  leadMinutes: number;
  title: string;
  body: string;
}

/** Build a stable anchor key. The one place the format is decided. */
export function reminderKey(
  targetKind: ReminderTargetKind,
  stableId: string,
  anchor: ReminderAnchorKind = "start",
): string {
  return `${targetKind}:${stableId}:${anchor}`;
}

/** Identity of one fire. Two leads on one meeting must not share a fired-set
 *  slot, or the earlier one would swallow the later. */
export function plannedReminderKey(anchorKey: string, leadMinutes: number): string {
  return `${anchorKey}:${leadMinutes}`;
}

/** The default leads for an anchor, before any per-item override. */
export function defaultLeadsFor(
  a: Pick<ReminderAnchor, "targetKind" | "anchor" | "allDay">,
  prefs: ReminderPrefs,
): number[] {
  if (a.anchor === "deadline") return prefs.deadline_leads;
  if (a.allDay) {
    // Untimed tasks (`do_date`, no clock) have no default — twelve things
    // parked on today must not produce twelve 9am banners. All-day events do.
    return a.targetKind === "event" ? prefs.all_day_leads : [];
  }
  return a.targetKind === "event" ? prefs.event_leads : prefs.block_leads;
}

/** First default lead, or `null` when that kind is "never". */
export function defaultLeadFor(
  a: Pick<ReminderAnchor, "targetKind" | "anchor" | "allDay">,
  prefs: ReminderPrefs,
): LeadMinutes {
  return firstLead(defaultLeadsFor(a, prefs));
}

/** Anchor instant minus the lead. */
export function resolveFireAt(atMs: number, leadMinutes: number): number {
  return atMs - leadMinutes * 60_000;
}

/**
 * The full set of reminders that *would* fire, given anchors, preferences and
 * overrides — sorted soonest-first. One PlannedReminder per lead.
 *
 * Note what is NOT here: any notion of how many, how recently the user was
 * spoken to, or what they did last. Every entry is a fact about one lead on
 * one anchor.
 */
export function planReminders(
  anchors: ReminderAnchor[],
  prefs: ReminderPrefs,
  overrides: ReminderOverride[] = [],
): PlannedReminder[] {
  if (!prefs.enabled) return [];
  const byKey = new Map(overrides.map((o) => [o.key, o]));
  const out: PlannedReminder[] = [];

  for (const a of anchors) {
    if (!Number.isFinite(a.atMs)) continue;
    const override = byKey.get(a.key);
    const leads = override ? normalizeLeads(override.leads) : defaultLeadsFor(a, prefs);
    for (const lead of leads) {
      const fireAtMs = resolveFireAt(a.atMs, lead);
      out.push({
        key: plannedReminderKey(a.key, lead),
        targetKind: a.targetKind,
        targetId: a.targetId,
        anchor: a.anchor,
        fireAtMs,
        atMs: a.atMs,
        leadMinutes: lead,
        title: a.title || "Untitled",
        body: reminderBody(a.anchor, lead, a.detail),
      });
    }
  }

  return out.sort((x, y) => x.fireAtMs - y.fireAtMs || x.leadMinutes - y.leadMinutes);
}

/**
 * How late a short reminder may still be delivered. The floor, not the rule —
 * a day-before alert uses a wider window (see `reminderGraceMs`).
 *
 * A laptop that wakes after four hours asleep must not empty the morning into
 * the notification center at once. Anything staler than its grace is dropped,
 * not queued.
 */
export const REMINDER_GRACE_MS = 5 * 60_000;

/** Grace scales with the lead: a 9:00 "day before" missed by six minutes is
 *  still that reminder; a 10-minute heads-up six minutes late is not. Capped
 *  so a week-scale lead cannot dump a backlog after a long sleep. */
export function reminderGraceMs(leadMinutes: number): number {
  const scaled = (Math.max(0, leadMinutes) / 12) * 60_000;
  const twoHours = 2 * 60 * 60_000;
  return Math.min(Math.max(REMINDER_GRACE_MS, scaled), twoHours);
}

/** What to fire on this tick: due, not already fired, not stale.
 *  Pass `graceMs` only to pin a single window in a test; production leaves it
 *  so each reminder uses `reminderGraceMs(lead)`. */
export function dueNow(
  plan: PlannedReminder[],
  nowMs: number,
  fired: ReadonlySet<string>,
  graceMs?: number,
): PlannedReminder[] {
  return plan.filter((r) => {
    if (fired.has(r.key)) return false;
    if (r.fireAtMs > nowMs) return false;
    const grace = graceMs ?? reminderGraceMs(r.leadMinutes);
    return nowMs - r.fireAtMs <= grace;
  });
}

/**
 * The next instant worth waking for — so the shell arms ONE timer rather than
 * one per reminder or a polling loop. `null` means nothing ahead.
 */
export function nextFireAt(
  plan: PlannedReminder[],
  nowMs: number,
  fired: ReadonlySet<string>,
): number | null {
  let best: number | null = null;
  for (const r of plan) {
    if (fired.has(r.key)) continue;
    if (r.fireAtMs <= nowMs) continue;
    if (best == null || r.fireAtMs < best) best = r.fireAtMs;
  }
  return best;
}

// ── Copy ────────────────────────────────────────────────────────────────────
// One line, always. No emoji, no counts, no exhortation.

/** "10 minutes before" — the picker's label and the agent's read-back. */
export function describeLead(lead: LeadMinutes): string {
  if (lead == null) return "No reminder";
  if (lead === 0) return "At the time";
  if (lead < 60) return `${lead} minute${lead === 1 ? "" : "s"} before`;
  if (lead === 60) return "1 hour before";
  if (lead < 1440 && lead % 60 === 0) {
    const hours = lead / 60;
    return hours === 1 ? "1 hour before" : `${hours} hours before`;
  }
  if (lead === 1440) return "1 day before";
  if (lead === 10080) return "1 week before";
  if (lead % 1440 === 0) {
    const days = lead / 1440;
    return days === 1 ? "1 day before" : `${days} days before`;
  }
  if (lead % 60 === 0) return `${lead / 60} hours before`;
  return `${lead} minutes before`;
}

/** The short form that rides a detail row ("10m before"). */
export function describeLeadShort(lead: LeadMinutes): string {
  if (lead == null) return "Off";
  if (lead === 0) return "On time";
  if (lead < 60) return `${lead}m before`;
  if (lead === 10080) return "1w before";
  if (lead % 1440 === 0) {
    const days = lead / 1440;
    return days === 1 ? "1d before" : `${days}d before`;
  }
  if (lead % 60 === 0) return `${lead / 60}h before`;
  return `${lead}m before`;
}

/** Several leads as a compact label ("1d · 10m before"). */
export function describeLeadsShort(leads: readonly number[]): string {
  if (leads.length === 0) return "Off";
  if (leads.length === 1) return describeLeadShort(leads[0]!);
  return `${leads.map((m) => describeLeadShort(m).replace(" before", "")).join(" · ")} before`;
}

function reminderBody(anchor: ReminderAnchorKind, lead: number, detail?: string | null): string {
  const when =
    anchor === "deadline"
      ? lead === 0
        ? "Due today"
        : `Due in ${describeLeadShort(lead).replace(" before", "")}`
      : lead === 0
        ? "Starting now"
        : `Starts in ${leadPhrase(lead)}`;
  return detail ? `${when} · ${detail}` : when;
}

function leadPhrase(lead: number): string {
  if (lead < 60) return `${lead} min`;
  if (lead === 60) return "an hour";
  if (lead < 1440 && lead % 60 === 0) {
    const hours = lead / 60;
    return hours === 1 ? "an hour" : `${hours} hours`;
  }
  if (lead === 1440) return "a day";
  if (lead === 10080) return "a week";
  if (lead % 1440 === 0) {
    const days = lead / 1440;
    return days === 1 ? "a day" : `${days} days`;
  }
  return `${lead} min`;
}

/** Parse a lead a human or the agent typed. Returns `undefined` when it isn't
 *  one we support, so a caller can refuse rather than silently rounding.
 *  Any integer minutes in `0…REMINDER_MAX_LEAD_MINUTES` is valid (custom). */
export function parseLead(input: unknown): LeadMinutes | undefined {
  if (input === null || input === "off" || input === "none") return null;
  const n = typeof input === "number" ? input : Number(typeof input === "string" ? input.trim() : input);
  if (!Number.isFinite(n) || n < 0) return undefined;
  const rounded = Math.round(n);
  if (rounded > REMINDER_MAX_LEAD_MINUTES) return undefined;
  return rounded;
}

/** Parse one lead, several, or "off". `undefined` = unparseable. Empty = silence. */
export function parseLeads(input: unknown): number[] | undefined {
  if (input === null || input === "off" || input === "none") return [];
  if (Array.isArray(input)) {
    const out: number[] = [];
    for (const x of input) {
      const n = parseLead(x);
      if (n === undefined) return undefined;
      if (n == null) continue;
      out.push(n);
    }
    return normalizeLeads(out);
  }
  if (typeof input === "string" && input.includes(",")) {
    return parseLeads(input.split(",").map((s) => s.trim()).filter(Boolean));
  }
  const one = parseLead(input);
  if (one === undefined) return undefined;
  if (one == null) return [];
  return [one];
}

/** Read a stored override row, whether it still has the old scalar column. */
export function leadsFromRow(r: { leads?: number[] | null; lead_minutes?: number | null }): number[] {
  if (Array.isArray(r.leads)) return normalizeLeads(r.leads);
  if (r.lead_minutes === null) return [];
  if (typeof r.lead_minutes === "number") return normalizeLeads([r.lead_minutes]);
  return [];
}
