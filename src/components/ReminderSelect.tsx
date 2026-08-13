// Remind — the one control, worn by every surface that can hold a reminder.
//
// Same grammar as DurationSelect: an invisible native <select> over a label.
// That choice does four jobs at once — it is keyboard-operable for free (a
// native listbox: arrows, type-ahead, Esc), it renders as iOS's own wheel on a
// phone rather than a cursor-anchored popover we'd have to forbid, it costs one
// element on the render path, and it looks like the rest of the app.
//
// Three kinds of value, and the distinction is the point:
//   Default        no row at all — follows Settings → Reminders
//   <a lead>       an override row for this item
//   No reminder    an override row with lead_minutes = null (silence THIS one)

import {
  describeLead,
  describeLeadShort,
  REMINDER_LEADS,
  type LeadMinutes,
} from "../../supabase/functions/_shared/reminderRules.ts";
import {
  useReminderFor,
  useReminderMutations,
  useNotifyPermission,
  type ReminderTargetRef,
} from "../hooks/useReminders";

const DEFAULT_VALUE = "default";
const OFF_VALUE = "off";

export function reminderLabel(lead: LeadMinutes, source: "override" | "default"): string {
  if (lead == null) return source === "override" ? "No reminder" : "Off";
  return source === "default" ? `${describeLeadShort(lead)} · default` : describeLeadShort(lead);
}

export default function ReminderSelect({
  target,
  className = "",
  /** Render the label in the popover's field voice rather than the compact
   *  chip voice used inside a strip. */
  block = false,
}: {
  target: ReminderTargetRef;
  className?: string;
  block?: boolean;
}) {
  const { lead, defaultLead, source, enabled } = useReminderFor(target);
  const { setReminder, clearReminder } = useReminderMutations();
  const { permission, request } = useNotifyPermission();

  const value = source === "default" ? DEFAULT_VALUE : lead == null ? OFF_VALUE : String(lead);
  const defaultLabel = defaultLead == null ? "Default (off)" : `Default (${describeLeadShort(defaultLead)})`;

  const onPick = async (raw: string) => {
    if (raw === DEFAULT_VALUE) {
      await clearReminder(target);
    } else if (raw === OFF_VALUE) {
      await setReminder(target, null);
    } else {
      await setReminder(target, Number(raw));
      // Asking for a reminder IS the opt-in moment — but only ask the OS once
      // the user has actually requested one, never on a cold open.
      if (permission === "default") void request();
    }
  };

  const text = enabled
    ? reminderLabel(lead, source)
    : lead == null
      ? "Reminders off"
      : `${describeLeadShort(lead)} · reminders off`;

  return (
    <label
      title={enabled ? describeLead(lead) : "Turn reminders on in Settings → Reminders"}
      className={`relative inline-flex cursor-pointer items-center ${block ? "w-full" : ""} ${className}`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className={`${block ? "text-body text-ink" : "mono text-micro text-muted"} ${enabled ? "" : "opacity-60"}`}>
        {text}
      </span>
      <select
        value={value}
        aria-label="Reminder"
        onChange={(e) => void onPick(e.target.value)}
        className="tap absolute inset-0 w-full cursor-pointer opacity-0"
      >
        <option value={DEFAULT_VALUE}>{defaultLabel}</option>
        {REMINDER_LEADS.map((m) => (
          <option key={m} value={m}>
            {describeLead(m)}
          </option>
        ))}
        <option value={OFF_VALUE}>No reminder</option>
      </select>
    </label>
  );
}
