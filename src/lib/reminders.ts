/**
 * Reminder anchors, as the SPA sees them.
 *
 * The builder itself moved into the shared kernel
 * (`_shared/reminderAnchors.ts`) when background delivery landed: the server
 * dispatcher and the open app race for the same claim, and a claim key is built
 * from the fire instant — so two implementations disagreeing by a second would
 * both win and the user would be told twice. Read that file's header for the
 * whole argument.
 *
 * What stays here is the thin app-side adaptation: our row types, and the
 * device's own zone as the default for resolving a deadline date.
 */

import {
  buildReminderAnchors as buildShared,
  instantForLocalTime,
  REMINDER_WINDOW_MS,
  type AnchorInputs as SharedInputs,
} from "../../supabase/functions/_shared/reminderAnchors.ts";
import type { ReminderAnchor } from "../../supabase/functions/_shared/reminderRules.ts";
import { detectDeviceTz } from "./timezone";
import type { ExternalEvent, Reminder, Slot, Task } from "./types";
import { reminderKey } from "../../supabase/functions/_shared/reminderRules.ts";

export { REMINDER_WINDOW_MS };

export interface AnchorInputs {
  tasks: Task[];
  slots: Slot[];
  events: ExternalEvent[];
  hiddenKeys: ReadonlySet<string>;
  deadlineTimeMinutes: number;
  detailForTask?: (t: Task) => string | null;
  nowMs: number;
  windowMs?: number;
}

export function buildReminderAnchors(input: AnchorInputs): ReminderAnchor[] {
  return buildShared({
    tasks: input.tasks as unknown as SharedInputs["tasks"],
    slots: input.slots as unknown as SharedInputs["slots"],
    events: input.events as unknown as SharedInputs["events"],
    hiddenKeys: input.hiddenKeys,
    deadlineTimeMinutes: input.deadlineTimeMinutes,
    // The device's zone, live from the OS — the same doctrine the agent follows
    // (D-082). The server uses `user_settings.time_zone`, which the client keeps
    // in step, so both resolve a deadline to the same instant.
    timeZone: detectDeviceTz(),
    nowMs: input.nowMs,
    windowMs: input.windowMs,
    detailForTask: input.detailForTask as SharedInputs["detailForTask"],
  });
}

/** Local instant for `YYYY-MM-DD` + minutes-after-midnight, on this device. */
export function localInstant(dateISO: string, minutesAfterMidnight: number): number {
  return instantForLocalTime(dateISO, minutesAfterMidnight, detectDeviceTz());
}

/** The override row's anchor key — the join between a stored row and a live
 *  anchor. One place, so a row written on the phone matches a key built on the
 *  desktop (and a claim made by either matches the dispatcher's). */
export function keyOfOverride(r: Pick<Reminder, "target_kind" | "target_id" | "event_key" | "anchor">): string {
  const stable = r.target_kind === "event" ? (r.event_key ?? "") : (r.target_id ?? "");
  return reminderKey(r.target_kind, stable, r.anchor);
}
