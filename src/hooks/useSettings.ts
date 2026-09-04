import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { invalidateWhenSafe, makeOp, OWNER_ROW, queueWrite } from "../lib/sync";
import type { UserSettings } from "../lib/types";
import { DEFAULT_MEET_PREFERENCE, normalizeMeetPreference } from "../../supabase/functions/_shared/conferencing.ts";
import { DEFAULT_REMINDER_PREFS, normalizeReminderPrefs } from "../../supabase/functions/_shared/reminderRules.ts";

const KEY = ["settings"];

const DEFAULTS: Omit<UserSettings, "user_id"> = {
  theme: "system",
  day_start_hour: 6,
  day_end_hour: 24,
  calendar_fit_hours: 13,
  week_start: 0, // Sunday — display only; the planning week is Monday-based
  work_start_minutes: 480,
  work_end_minutes: 990,
  default_task_duration_minutes: 30,
  hidden_calendar_ids: [],
  hidden_events: [],
  calendar_domain_map: {},
  last_rollover_date: null,
  show_weather: false,
  default_calendar_account_id: null,
  auto_add_meet: DEFAULT_MEET_PREFERENCE,
  onboarding_completed_version: null,
  reminder_prefs: DEFAULT_REMINDER_PREFS,
  saved_views: [],
  time_zone: null,
  inbound_token: null,
};

/**
 * The first column of the week and month views — the "Week starts on" setting,
 * as a date-fns `weekStartsOn` (0 = Sunday, the default; 1 = Monday).
 *
 * Read it through here rather than off `settings.week_start` directly: every
 * caller then falls back to the same value while settings are still loading, so
 * a grid can't paint one order and then flip to the other on first paint.
 *
 * This is a DISPLAY preference only. The planning week is always Monday-based
 * (planningRules.ts), so choosing Sunday never moves which week something is in.
 */
export function firstDayOfWeek(settings: UserSettings | undefined): 0 | 1 {
  return settings?.week_start === 1 ? 1 : 0;
}

export function useSettings() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<UserSettings> => {
      const { data, error } = await supabase.from("user_settings").select("*").maybeSingle();
      if (error) throw error;
      if (data) {
        let calendar_fit_hours = data.calendar_fit_hours ?? DEFAULTS.calendar_fit_hours;
        try {
          const local = Number(localStorage.getItem("nuvo.cal.fitHours"));
          if (data.calendar_fit_hours == null && local >= 6 && local <= 24) {
            calendar_fit_hours = local;
          }
        } catch { /* ignore */ }
        return {
          ...data,
          calendar_fit_hours,
          hidden_calendar_ids: data.hidden_calendar_ids ?? [],
          hidden_events: data.hidden_events ?? [],
          calendar_domain_map: data.calendar_domain_map ?? {},
          // A row written before the column existed reads back null — fall to
          // the same default the edge function uses, so the composer's toggle
          // and what Google actually gets can't disagree.
          auto_add_meet: normalizeMeetPreference(data.auto_add_meet),
          // Same reason as auto_add_meet: a row written before the column
          // existed reads back `{}`, and a half-filled prefs object would mean
          // "off" for one anchor and "default" for another.
          reminder_prefs: normalizeReminderPrefs(data.reminder_prefs),
          // Same reason again: a row written before migration 62 reads back
          // null, and every caller maps over this.
          saved_views: Array.isArray(data.saved_views) ? data.saved_views : [],
          inbound_token: (data as { inbound_token?: string | null }).inbound_token ?? null,
        };
      }
      const { data: u } = await supabase.auth.getUser();
      return { user_id: u.user?.id ?? "", ...DEFAULTS };
    },
  });

  /**
   * Change a setting.
   *
   * Queued, and addressed by the *account* rather than by a row id — the
   * `user_settings` primary key IS `user_id`, and the transport fills it from
   * the session at send time (`ownerKeyed`). Filling it at enqueue time would
   * be wrong: the op can be replayed on a later launch, after the session has
   * been refreshed.
   *
   * The rollback branch is gone with the rest of them. A queued setting is not
   * a lost setting, so reverting the toggle under the user's finger — which is
   * what `onError` did on any blip — is now a lie rather than a safeguard.
   */
  const update = (patch: Partial<UserSettings>) => {
    const prev = qc.getQueryData<UserSettings>(KEY);
    if (prev) qc.setQueryData(KEY, { ...prev, ...patch });
    void queueWrite(makeOp("user_settings", "update", OWNER_ROW, patch as Record<string, unknown>));
    invalidateWhenSafe(qc, "user_settings", KEY);
  };

  return { settings: query.data, isLoading: query.isLoading, update };
}

/** Apply theme setting to <html data-theme> (system | light | dark). */
export function useApplyTheme(theme: UserSettings["theme"] | undefined) {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const effective = !theme || theme === "system" ? (mq.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = effective;
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}
