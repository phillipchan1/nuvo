import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { UserSettings } from "../lib/types";

const KEY = ["settings"];

const DEFAULTS: Omit<UserSettings, "user_id"> = {
  theme: "system",
  day_start_hour: 6,
  day_end_hour: 24,
  week_start: 1,
  work_start_minutes: 480,
  work_end_minutes: 990,
  hidden_calendar_ids: [],
  last_rollover_date: null,
};

export function useSettings() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<UserSettings> => {
      const { data, error } = await supabase.from("user_settings").select("*").maybeSingle();
      if (error) throw error;
      if (data) return { ...data, hidden_calendar_ids: data.hidden_calendar_ids ?? [] };
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
