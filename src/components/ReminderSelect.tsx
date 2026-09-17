// Remind — the one control, worn by every surface that can hold a reminder.
//
// A short list, not a single select: calendar apps put several alerts on one
// meeting (10 minutes and 1 day before). Each row is still a native <select>
// (iOS wheel, keyboard, no cursor popover). Cap is MAX_REMINDER_LEADS.
//
// Three kinds of value, and the distinction is the point:
//   Default        no row at all — follows Settings → Reminders
//   <leads>        an override row for this item
//   No reminder    an override with leads = [] (silence THIS one)

import { useState } from "react";
import { Icon } from "./Icon";
import {
  describeLead,
  describeLeadsShort,
  leadsEqual,
  MAX_REMINDER_LEADS,
  REMINDER_LEADS,
  REMINDER_MAX_LEAD_MINUTES,
} from "../../supabase/functions/_shared/reminderRules.ts";
import {
  useReminderFor,
  useReminderMutations,
  useNotifyPermission,
  type ReminderTargetRef,
} from "../hooks/useReminders";

const DEFAULT_VALUE = "default";
const OFF_VALUE = "off";
const CUSTOM_VALUE = "custom";

export function reminderLabel(leads: number[], source: "override" | "default"): string {
  if (leads.length === 0) return source === "override" ? "No reminder" : "Off";
  const short = describeLeadsShort(leads);
  return source === "default" ? `${short} · default` : short;
}

export type ReminderDraft = { mode: "default" } | { mode: "override"; leads: number[] };

export function resolveDraftLeads(draft: ReminderDraft, _defaultLeads?: number[]): number[] | null {
  // `null` means "follow defaults — don't write a row".
  if (draft.mode === "default") return null;
  return draft.leads;
}

function presetsPlus(current: number, others: number[]): number[] {
  const set = new Set<number>(REMINDER_LEADS);
  set.add(current);
  for (const n of others) set.add(n);
  return [...set].sort((a, b) => a - b);
}

function nextUnusedPreset(existing: number[]): number | null {
  for (const m of REMINDER_LEADS) {
    if (!existing.includes(m) && m !== 0) return m;
  }
  for (const m of REMINDER_LEADS) {
    if (!existing.includes(m)) return m;
  }
  return existing.length < MAX_REMINDER_LEADS ? 15 : null;
}

function CustomLead({
  onSet,
  onCancel,
}: {
  onSet: (minutes: number) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState("20");
  const [unit, setUnit] = useState<"minutes" | "hours" | "days">("minutes");
  const commit = () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) return;
    const minutes = unit === "minutes" ? Math.round(n) : unit === "hours" ? Math.round(n * 60) : Math.round(n * 1440);
    if (minutes > REMINDER_MAX_LEAD_MINUTES) return;
    onSet(minutes);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1">
      <input
        type="number"
        min={0}
        inputMode="numeric"
        aria-label="Custom lead amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="mono tap field w-16 px-2 py-1 text-caption"
      />
      <select
        aria-label="Custom lead unit"
        value={unit}
        onChange={(e) => setUnit(e.target.value as typeof unit)}
        className="tap field w-auto px-2 py-1 text-caption"
      >
        <option value="minutes">minutes</option>
        <option value="hours">hours</option>
        <option value="days">days</option>
      </select>
      <button type="button" className="tap px-2 text-caption font-medium text-accent" onClick={commit}>
        Set
      </button>
      <button type="button" className="tap px-1 text-caption text-muted" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

/** Presentational list. Bound (`ReminderSelect`) and draft (composers) share it. */
export function ReminderList({
  leads,
  defaultLeads,
  source,
  enabled,
  block = false,
  prefsMode = false,
  onChange,
}: {
  leads: number[];
  defaultLeads: number[];
  source: "override" | "default";
  enabled: boolean;
  block?: boolean;
  /** Settings defaults: no "Default" option, empty = never. */
  prefsMode?: boolean;
  /** `default` deletes the override; a list writes it (`[]` = silence). */
  onChange: (next: "default" | number[]) => void;
}) {
  const [customAt, setCustomAt] = useState<number | "add" | null>(null);

  const write = (next: number[]) => {
    // Matching the defaults (and not silence) drops the override.
    if (next.length > 0 && leadsEqual(next, defaultLeads)) {
      onChange("default");
      return;
    }
    onChange(next);
  };

  const replaceAt = (i: number, value: string) => {
    if (value === DEFAULT_VALUE) {
      if (prefsMode) {
        onChange([]);
        return;
      }
      onChange("default");
      return;
    }
    if (value === OFF_VALUE) {
      onChange([]);
      return;
    }
    if (value === CUSTOM_VALUE) {
      setCustomAt(i);
      return;
    }
    const n = Number(value);
    const next = [...leads];
    next[i] = n;
    write([...new Set(next)]);
  };

  const add = (minutes: number) => {
    if (leads.includes(minutes) || leads.length >= MAX_REMINDER_LEADS) return;
    write([...leads, minutes]);
  };

  const removeAt = (i: number) => {
    const next = leads.filter((_, idx) => idx !== i);
    // Removing the last remaining lead silences, it does not restore defaults.
    onChange(next);
  };

  const text = enabled
    ? reminderLabel(leads, source)
    : leads.length === 0
      ? "Reminders off"
      : `${describeLeadsShort(leads)} · reminders off`;

  const showRows = leads.length > 0 ? leads : source === "override" ? [] : defaultLeads;
  const silenced = source === "override" && leads.length === 0;
  const defaultOff = source === "default" && defaultLeads.length === 0;

  return (
    <div
      className={`flex flex-col ${block ? "w-full" : ""}`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {!block && (
        <span className={`mono text-micro text-muted ${enabled ? "" : "opacity-60"}`}>{text}</span>
      )}
      {(silenced || defaultOff) ? (
        <label className={`relative inline-flex cursor-pointer items-center ${block ? "w-full" : ""}`}>
          {block && (
            <span className={`text-body text-ink ${enabled ? "" : "opacity-60"}`}>
              {prefsMode ? "Never" : silenced ? "No reminder" : "Default (off)"}
            </span>
          )}
          <select
            value={silenced || prefsMode ? OFF_VALUE : DEFAULT_VALUE}
            aria-label="Reminder"
            onChange={(e) => replaceAt(0, e.target.value)}
            className="tap absolute inset-0 w-full cursor-pointer opacity-0"
          >
            {!prefsMode && (
              <option value={DEFAULT_VALUE}>
                {defaultLeads.length === 0 ? "Default (off)" : `Default (${describeLeadsShort(defaultLeads)})`}
              </option>
            )}
            {REMINDER_LEADS.map((m) => (
              <option key={m} value={m}>
                {describeLead(m)}
              </option>
            ))}
            <option value={CUSTOM_VALUE}>Custom…</option>
            <option value={OFF_VALUE}>{prefsMode ? "Never" : "No reminder"}</option>
          </select>
        </label>
      ) : (
        showRows.map((lead, i) => (
          <div key={`${lead}-${i}`} className="flex items-center gap-1">
            <label className={`relative inline-flex min-h-[44px] flex-1 cursor-pointer items-center ${block ? "" : ""}`}>
              <span className={`${block ? "text-body text-ink" : "mono text-micro text-muted"} ${enabled ? "" : "opacity-60"}`}>
                {i === 0 && source === "default" ? `${describeLead(lead)} · default` : describeLead(lead)}
              </span>
              <select
                value={String(lead)}
                aria-label={i === 0 ? "Reminder" : `Reminder ${i + 1}`}
                onChange={(e) => replaceAt(i, e.target.value)}
                className="tap absolute inset-0 w-full cursor-pointer opacity-0"
              >
                {i === 0 && !prefsMode && (
                  <option value={DEFAULT_VALUE}>
                    {defaultLeads.length === 0 ? "Default (off)" : `Default (${describeLeadsShort(defaultLeads)})`}
                  </option>
                )}
                {presetsPlus(lead, showRows).map((m) => (
                  <option key={m} value={m}>
                    {describeLead(m)}
                  </option>
                ))}
                <option value={CUSTOM_VALUE}>Custom…</option>
                {i === 0 && <option value={OFF_VALUE}>{prefsMode ? "Never" : "No reminder"}</option>}
              </select>
            </label>
            {source === "override" && (
              <button
                type="button"
                aria-label="Remove reminder"
                onClick={() => removeAt(i)}
                className="tap flex h-11 w-11 shrink-0 items-center justify-center text-muted hover:text-ink"
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
        ))
      )}
      {customAt != null && (
        <CustomLead
          onSet={(minutes) => {
            if (customAt === "add") add(minutes);
            else replaceAt(customAt, String(minutes));
            setCustomAt(null);
          }}
          onCancel={() => setCustomAt(null)}
        />
      )}
      {showRows.length > 0 && showRows.length < MAX_REMINDER_LEADS && customAt == null && (
        <button
          type="button"
          onClick={() => {
            const next = nextUnusedPreset(showRows);
            if (next == null) {
              setCustomAt("add");
              return;
            }
            // Editing a default copies it into an override, then adds.
            const base = source === "default" ? [...defaultLeads] : [...leads];
            if (base.includes(next)) {
              setCustomAt("add");
              return;
            }
            onChange([...base, next]);
          }}
          className="tap mt-0.5 inline-flex h-11 items-center gap-1 self-start text-caption font-medium text-muted hover:text-ink"
        >
          <Icon name="plus" size={12} />
          Add reminder
        </button>
      )}
    </div>
  );
}

export default function ReminderSelect({
  target,
  className = "",
  block = false,
}: {
  target: ReminderTargetRef;
  className?: string;
  block?: boolean;
}) {
  const { leads, defaultLeads, source, enabled } = useReminderFor(target);
  const { setReminder, clearReminder } = useReminderMutations();
  const { permission, request } = useNotifyPermission();

  const onChange = async (next: "default" | number[]) => {
    if (next === "default") {
      await clearReminder(target);
      return;
    }
    await setReminder(target, next);
    if (next.length > 0 && permission === "default") void request();
  };

  return (
    <div className={className} title={enabled ? describeLeadsShort(leads) : "Turn reminders on in Settings → Reminders"}>
      <ReminderList
        leads={leads}
        defaultLeads={defaultLeads}
        source={source}
        enabled={enabled}
        block={block}
        onChange={(next) => void onChange(next)}
      />
    </div>
  );
}

/** Create-path editor: local draft, written as an override after the row exists. */
export function DraftReminderSelect({
  defaultLeads,
  allDay: _allDay,
  enabled,
  value,
  onChange,
  block = false,
}: {
  defaultLeads: number[];
  allDay?: boolean;
  enabled: boolean;
  value: ReminderDraft;
  onChange: (next: ReminderDraft) => void;
  block?: boolean;
}) {
  const leads = value.mode === "default" ? defaultLeads : value.leads;
  const source = value.mode;
  return (
    <ReminderList
      leads={leads}
      defaultLeads={defaultLeads}
      source={source}
      enabled={enabled}
      block={block}
      onChange={(next) => {
        if (next === "default") onChange({ mode: "default" });
        else onChange({ mode: "override", leads: next });
      }}
    />
  );
}
