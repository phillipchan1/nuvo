/**
 * Turning the day you already have on screen into reminder anchors.
 *
 * The rules — what a lead means, what fires, what it says — live in the shared
 * kernel (`_shared/reminderRules.ts`), because the agent has to agree with the
 * app about them. What lives HERE is the one thing the kernel deliberately
 * can't do: read the SPA's own row shapes, and resolve a `deadline` date into a
 * local instant. That needs the device's zone, which is exactly the
 * device-zone-not-home-zone doctrine the agent already follows.
 *
 * Nothing here fetches. Every anchor is built from rows a surface already had.
 */

import {
  reminderKey,
  type ReminderAnchor,
} from "../../supabase/functions/_shared/reminderRules.ts";
import { eventKey, isEventHidden } from "./eventActuals";
import type { ExternalEvent, Reminder, Slot, Task } from "./types";

/** How far ahead anchors are built. The longest lead is a day, so two days of
 *  runway covers every reminder that could still fire — and bounds the work. */
export const REMINDER_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface AnchorInputs {
  tasks: Task[];
  slots: Slot[];
  events: ExternalEvent[];
  /** user_settings.hidden_events keys — a hidden event is out of the busy math,
   *  so it is out of the reminder set too. Same doctrine as the ledger. */
  hiddenKeys: ReadonlySet<string>;
  /** Minutes after local midnight a deadline speaks on its day. */
  deadlineTimeMinutes: number;
  /** Optional trailing clause — a project name, a location. */
  detailForTask?: (t: Task) => string | null;
  nowMs: number;
  windowMs?: number;
}

/** Local instant for `YYYY-MM-DD` + minutes-after-midnight, on this device. */
export function localInstant(dateISO: string, minutesAfterMidnight: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) return NaN;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  return d.getTime() + minutesAfterMidnight * 60_000;
}

export function buildReminderAnchors(input: AnchorInputs): ReminderAnchor[] {
  const { tasks, slots, events, hiddenKeys, deadlineTimeMinutes, nowMs } = input;
  const windowMs = input.windowMs ?? REMINDER_WINDOW_MS;
  const horizon = nowMs + windowMs;
  // A reminder is only ever about the near future. Anything already past its
  // grace window is the delivery loop's problem, not the anchor list's.
  const inWindow = (ms: number) => Number.isFinite(ms) && ms <= horizon && ms > nowMs - 60 * 60_000;

  const out: ReminderAnchor[] = [];

  for (const t of tasks) {
    if (t.status === "done" || t.status === "trashed") continue;

    if (t.start_time) {
      const atMs = Date.parse(t.start_time);
      if (inWindow(atMs)) {
        out.push({
          key: reminderKey("task", t.id, "start"),
          targetKind: "task",
          targetId: t.id,
          anchor: "start",
          atMs,
          title: t.title,
          detail: input.detailForTask?.(t) ?? null,
        });
      }
    }

    if (t.deadline) {
      const atMs = localInstant(t.deadline, deadlineTimeMinutes);
      if (inWindow(atMs)) {
        out.push({
          key: reminderKey("task", t.id, "deadline"),
          targetKind: "task",
          targetId: t.id,
          anchor: "deadline",
          atMs,
          title: t.title,
          detail: input.detailForTask?.(t) ?? null,
        });
      }
    }
  }

  for (const s of slots) {
    const atMs = Date.parse(s.start_time);
    if (!inWindow(atMs)) continue;
    out.push({
      key: reminderKey("slot", s.id, "start"),
      targetKind: "slot",
      targetId: s.id,
      anchor: "start",
      atMs,
      title: s.title || "Block",
      detail: null,
    });
  }

  for (const e of events) {
    // An all-day event has no moment to be early for, a declined one isn't
    // yours, and a hidden one is already out of the busy math.
    if (e.all_day) continue;
    if (e.self_rsvp === "declined") continue;
    if (isEventHidden(e, hiddenKeys as Set<string>)) continue;
    const atMs = Date.parse(e.start_at);
    if (!inWindow(atMs)) continue;
    out.push({
      // Keyed by the PROVIDER key, not the mirror row id: a resync renumbers
      // `external_events.id`, and a reminder pinned to it would silently
      // detach — the same reason `hidden_events` is keyed this way.
      key: reminderKey("event", eventKey(e), "start"),
      targetKind: "event",
      targetId: e.id,
      anchor: "start",
      atMs,
      title: e.title || "Untitled event",
      detail: e.location || null,
    });
  }

  return out;
}

/** The override row's anchor key — the join between a stored row and a live
 *  anchor. One place, so a row written on the phone matches a key built on the
 *  desktop. */
export function keyOfOverride(r: Pick<Reminder, "target_kind" | "target_id" | "event_key" | "anchor">): string {
  const stable = r.target_kind === "event" ? (r.event_key ?? "") : (r.target_id ?? "");
  return reminderKey(r.target_kind, stable, r.anchor);
}
