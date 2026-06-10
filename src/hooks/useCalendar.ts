import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeQuiet, supabase } from "../lib/supabase";
import type { CalendarAccount, ExternalEvent, Label } from "../lib/types";

export function useCalendarAccounts() {
  return useQuery({
    queryKey: ["calendar_accounts"],
    queryFn: async (): Promise<CalendarAccount[]> => {
      const { data, error } = await supabase
        .from("calendar_accounts")
        .select(
          "id, provider, email, sync_direction, calendars, mirror_calendar_id, needs_reconnect",
        );
      if (error) throw error;
      return data as CalendarAccount[];
    },
  });
}

export function useExternalEvents(rangeStartISO: string, rangeEndISO: string) {
  return useQuery({
    queryKey: ["external_events", rangeStartISO, rangeEndISO],
    queryFn: async (): Promise<ExternalEvent[]> => {
      const { data, error } = await supabase
        .from("external_events")
        .select("id, account_id, provider_event_id, calendar_id, title, start_at, end_at, all_day, location, busy")
        .lt("start_at", rangeEndISO)
        .gt("end_at", rangeStartISO);
      if (error) throw error;
      return data as ExternalEvent[];
    },
  });
}

/** Move/resize/retitle a Google event: optimistic local write + API write-back. */
export function useExternalEventMutations() {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Pick<ExternalEvent, "title" | "start_at" | "end_at">>;
    }) => {
      const { error } = await supabase.from("external_events").update(patch).eq("id", id);
      if (error) throw error;
      invokeQuiet("google-events", { eventId: id, patch });
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ["external_events"] });
      qc.setQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] }, (old) =>
        old?.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["external_events"] }),
  });
  return { updateEvent: update.mutate };
}

export function useLabels() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["labels"],
    queryFn: async (): Promise<Label[]> => {
      const { data, error } = await supabase.from("labels").select("id, name, color").order("name");
      if (error) throw error;
      return data as Label[];
    },
  });

  const createLabel = useMutation({
    mutationFn: async ({ name, color }: { name: string; color?: string }) => {
      const { data: u } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("labels")
        .insert({ name, color: color ?? "#2563EB", user_id: u.user!.id })
        .select()
        .single();
      if (error) throw error;
      return data as Label;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["labels"] }),
  });

  const updateLabel = useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; name?: string; color?: string }) => {
      const { error } = await supabase.from("labels").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["labels"] }),
  });

  const deleteLabel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("labels").delete().eq("id", id);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["labels"] }),
  });

  return {
    labels: query.data ?? [],
    createLabel: createLabel.mutateAsync,
    updateLabel: updateLabel.mutate,
    deleteLabel: deleteLabel.mutate,
  };
}
