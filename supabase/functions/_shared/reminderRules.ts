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
 * Three anchors exist and no more:
 *   event    — an external calendar commitment is about to start
 *   block    — a block YOU scheduled (task or slot) is about to start
 *   deadline — a deadline you set arrives today
 *
 * Zero imports, no side effects, no Date.now() — the caller passes the clock,
 * so both runtimes and every test get the same answers.
 */

export type ReminderTargetKind = "task" | "slot" | "event";

/** Which fact about the target the reminder hangs on. */
export type ReminderAnchorKind = "start" | "deadline";

/** The lead vocabulary, in minutes before the anchor. One list, so the picker,
 *  the agent's enum and the parser can't drift into three. */
export const REMINDER_LEADS = [0, 5, 10, 15, 30, 60, 120, 1440] as const;
export type ReminderLead = (typeof REMINDER_LEADS)[number];

/** `null` means silenced — an explicit "don't tell me about this one", which is
 *  a different thing from "no preference" (undefined). */
export type LeadMinutes = number | null;

export interface ReminderPrefs {
  /** Off until asked. A fresh account is silent. */
  enabled: boolean;
  /** Default lead for an external calendar event. */
  event_lead: LeadMinutes;
  /** Default lead for one of your own blocks (scheduled task or slot). */
  block_lead: LeadMinutes;
  /** Default lead for a deadline, measured from `deadline_time_minutes`. */
  deadline_lead: LeadMinutes;
  /** Minutes after local midnight that a deadline reminder speaks on its day. */
  deadline_time_minutes: number;
}

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  enabled: false,
  event_lead: 10,
  block_lead: 5,
  deadline_lead: 0,
  deadline_time_minutes: 540, // 9:00 local
};

/** Fill a partial/legacy `reminder_prefs` jsonb without letting a missing key
 *  silently mean "off" for one field and "default" for another. */
export function normalizeReminderPrefs(raw: unknown): ReminderPrefs {
  const p = (raw ?? {}) as Partial<ReminderPrefs>;
  const lead = (v: unknown, fallback: LeadMinutes): LeadMinutes => {
    if (v === null) return null;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return fallback;
    return Math.round(v);
  };
  const time = typeof p.deadline_time_minutes === "number" && p.deadline_time_minutes >= 0 && p.deadline_time_minutes < 1440
    ? Math.round(p.deadline_time_minutes)
    : DEFAULT_REMINDER_PREFS.deadline_time_minutes;
  return {
    enabled: p.enabled === true,
    event_lead: lead(p.event_lead, DEFAULT_REMINDER_PREFS.event_lead),
    block_lead: lead(p.block_lead, DEFAULT_REMINDER_PREFS.block_lead),
    deadline_lead: lead(p.deadline_lead, DEFAULT_REMINDER_PREFS.deadline_lead),
    deadline_time_minutes: time,
  };
}

/**
 * One thing that could be reminded about — built by the surface from data it
 * already holds, never fetched for this purpose.
 *
 * `key` is the identity of the reminder, not of the target: one task with both
 * a block and a deadline has two anchors and can be silenced independently.
 * It is also the fired-set key, so it must be stable across a page reload — and
 * for an external event that means the provider key, not the mirror row id,
 * which a resync can renumber (same reason `hidden_events` is keyed that way).
 */
export interface ReminderAnchor {
  key: string;
  targetKind: ReminderTargetKind;
  /** tasks.id / slots.id / external_events.id — what a click should open. */
  targetId: string;
  anchor: ReminderAnchorKind;
  /** The instant the thing itself happens (ms epoch). */
  atMs: number;
  title: string;
  /** Location, or the project a block serves — one short trailing clause. */
  detail?: string | null;
}

/** A per-item override: a different lead, or `null` to silence just this one. */
export interface ReminderOverride {
  key: string;
  lead_minutes: LeadMinutes;
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

/** The default lead for an anchor, before any per-item override. */
export function defaultLeadFor(a: Pick<ReminderAnchor, "targetKind" | "anchor">, prefs: ReminderPrefs): LeadMinutes {
  if (a.anchor === "deadline") return prefs.deadline_lead;
  return a.targetKind === "event" ? prefs.event_lead : prefs.block_lead;
}

/** Anchor instant minus the lead. */
export function resolveFireAt(atMs: number, leadMinutes: number): number {
  return atMs - leadMinutes * 60_000;
}

/**
 * The full set of reminders that *would* fire, given anchors, preferences and
 * overrides — sorted soonest-first.
 *
 * Note what is NOT here: any notion of how many, how recently the user was
 * spoken to, or what they did last. Every entry is a fact about one anchor.
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
    const lead = override ? override.lead_minutes : defaultLeadFor(a, prefs);
    if (lead == null) continue; // silenced, by preference or by hand
    const fireAtMs = resolveFireAt(a.atMs, lead);
    out.push({
      key: a.key,
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

  return out.sort((x, y) => x.fireAtMs - y.fireAtMs);
}

/**
 * How late a reminder may still be delivered.
 *
 * A laptop that wakes after four hours asleep must not empty the morning into
 * the notification center at once. Anything staler than this is dropped, not
 * queued: a reminder that no longer describes the next few minutes is not a
 * *now* signal, and firing it anyway is precisely the theater N-07 refused.
 */
export const REMINDER_GRACE_MS = 5 * 60_000;

/** What to fire on this tick: due, not already fired, not stale. */
export function dueNow(
  plan: PlannedReminder[],
  nowMs: number,
  fired: ReadonlySet<string>,
  graceMs: number = REMINDER_GRACE_MS,
): PlannedReminder[] {
  return plan.filter(
    (r) => !fired.has(r.key) && r.fireAtMs <= nowMs && nowMs - r.fireAtMs <= graceMs,
  );
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
  if (lead < 60) return `${lead} minutes before`;
  if (lead === 60) return "1 hour before";
  if (lead < 1440) return `${lead / 60} hours before`;
  if (lead === 1440) return "1 day before";
  return `${Math.round(lead / 1440)} days before`;
}

/** The short form that rides a detail row ("10m before"). */
export function describeLeadShort(lead: LeadMinutes): string {
  if (lead == null) return "Off";
  if (lead === 0) return "On time";
  if (lead < 60) return `${lead}m before`;
  if (lead < 1440) return `${lead / 60}h before`;
  return lead === 1440 ? "1d before" : `${Math.round(lead / 1440)}d before`;
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
  if (lead < 1440) return `${lead / 60} hours`;
  return lead === 1440 ? "a day" : `${Math.round(lead / 1440)} days`;
}

/** Parse a lead a human or the agent typed. Returns `undefined` when it isn't
 *  one we support, so a caller can refuse rather than silently rounding. */
export function parseLead(input: unknown): LeadMinutes | undefined {
  if (input === null || input === "off" || input === "none") return null;
  const n = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(n) || n < 0) return undefined;
  const rounded = Math.round(n);
  return (REMINDER_LEADS as readonly number[]).includes(rounded) ? rounded : undefined;
}
