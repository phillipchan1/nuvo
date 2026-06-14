import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeQuiet, supabase } from "../lib/supabase";
import type { AttendeeStatus, CalendarAccount, ExternalEvent, GoogleRawEvent, Label, RecurrenceScope } from "../lib/types";

export function useCalendarRefresh() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("calendar-refresh", { body: {} });
      if (error) throw error;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["external_events"] });
      qc.invalidateQueries({ queryKey: ["calendar_accounts"] });
    },
  });
  return { refresh: mutation.mutate, refreshing: mutation.isPending, error: mutation.error };
}

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

/** Move/resize/retitle a Google event: optimistic local write + API write-back.
 *  scope="ALL" patches the master recurring event in Google instead of just this instance. */
export function useExternalEventMutations() {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
      scope = "THIS",
    }: {
      id: string;
      patch: Partial<Pick<ExternalEvent, "title" | "start_at" | "end_at">>;
      scope?: RecurrenceScope;
    }) => {
      // For THIS-only edits, write the instance row immediately so optimistic
      // update is consistent. For ALL, the master PATCH in Google will push a
      // sync back that rewrites all instances — skip the local row update.
      if (scope === "THIS") {
        const { error } = await supabase.from("external_events").update(patch).eq("id", id);
        if (error) throw error;
      }
      invokeQuiet("google-events", { eventId: id, patch, scope });
    },
    onMutate: async ({ id, patch, scope = "THIS" }) => {
      if (scope !== "THIS") return;
      await qc.cancelQueries({ queryKey: ["external_events"] });
      qc.setQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] }, (old) =>
        old?.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["external_events"] }),
  });

  const rsvp = useMutation({
    mutationFn: async ({
      id,
      responseStatus,
      sendNotifications = true,
    }: {
      id: string;
      responseStatus: AttendeeStatus;
      sendNotifications?: boolean;
    }) => {
      invokeQuiet("google-events", { action: "rsvp", eventId: id, responseStatus, sendNotifications });
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: ["event_details", vars.id] });
    },
  });

  // Delete a Google event. Optimistically drop it locally; the edge function
  // removes it from Google and the mirror row(s). scope="ALL" deletes the
  // whole recurring series.
  const del = useMutation({
    // Await the function: it needs the mirror row to find the Google event, and
    // it deletes the row itself. If we returned early (fire-and-forget) the
    // onSettled refetch would race the deletion and the event would pop back.
    mutationFn: async ({ id, scope = "THIS" }: { id: string; scope?: RecurrenceScope }) => {
      const { error } = await supabase.functions.invoke("google-events", {
        body: { action: "delete", eventId: id, scope },
      });
      if (error) throw error;
    },
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ["external_events"] });
      qc.setQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] }, (old) =>
        old?.filter((e) => e.id !== id),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["external_events"] }),
  });

  // Create a real Google event on the primary calendar. The edge function does
  // the POST and writes the external_events row, so we just refetch on settle.
  const create = useMutation({
    mutationFn: async ({
      title,
      start_at,
      end_at,
      recurrence,
    }: {
      title: string;
      start_at: string;
      end_at: string;
      /** Google RRULE lines, e.g. ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"]. */
      recurrence?: string[];
    }) => {
      const { data, error } = await supabase.functions.invoke("google-events", {
        body: { action: "create", title, start_at, end_at, recurrence },
      });
      if (error) throw error;
      return data;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["external_events"] }),
  });

  return {
    updateEvent: update.mutate,
    rsvpEvent: rsvp.mutate,
    createEvent: create.mutateAsync,
    deleteEvent: del.mutate,
  };
}

/** Fetch the raw Google event payload for a single event — attendees,
 *  organizer, conference link, etc. Only called when a slide-over is open. */
export function useEventDetails(id: string | null) {
  return useQuery({
    queryKey: ["event_details", id],
    enabled: Boolean(id),
    staleTime: 30_000,
    queryFn: async (): Promise<GoogleRawEvent | null> => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("external_events")
        .select("raw")
        .eq("id", id)
        .single();
      if (error) throw error;
      return (data?.raw as GoogleRawEvent) ?? null;
    },
  });
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
