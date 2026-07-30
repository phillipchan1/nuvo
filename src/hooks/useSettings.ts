import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { UserSettings } from "../lib/types";
import { DEFAULT_MEET_PREFERENCE, normalizeMeetPreference } from "../../supabase/functions/_shared/conferencing.ts";

const KEY = ["settings"];

const DEFAULTS: Omit<UserSettings, "user_id"> = {
  theme: "system",
  day_start_hour: 6,
  day_end_hour: 24,
  calendar_fit_hours: 13,
  week_start: 0, // Sunday — display only; the planning week is Monday-based
  work_start_minutes: 480,
  work_end_minutes: 990,
  hidden_calendar_ids: [],
  hidden_events: [],
  calendar_domain_map: {},
  last_rollover_date: null,
  show_weather: false,
  default_calendar_account_id: null,
  auto_add_meet: DEFAULT_MEET_PREFERENCE,
  onboarding_completed_version: null,
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
        };
      }
      const { data: u } = await supabase.auth.getUser();
      return { user_id: u.user?.id ?? "", ...DEFAULTS };
    },
  });

  const update = useMutation({
    mutationFn: async (patch: Partial<UserSettings>) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("user_settings")
        .upsert({ user_id: u.user!.id, ...patch });
      if (error) throw error;
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<UserSettings>(KEY);
      if (prev) qc.setQueryData(KEY, { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _p, ctx) => ctx?.prev && qc.setQueryData(KEY, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  return { settings: query.data, isLoading: query.isLoading, update: update.mutate };
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
