import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invokeQuiet, supabase } from "../lib/supabase";
import { invalidateWhenSafe, makeOp, queueWrite } from "../lib/sync";
import {
  normalizeRawEvent,
  type AttendeeStatus,
  type CalendarAccount,
  type CalendarProvider,
  type ExternalEvent,
  type GoogleRawEvent,
  type HiddenEvent,
  type Label,
  type ProviderRawEvent,
  type RecurrenceScope,
} from "../lib/types";
import { eventKey, eventSeriesKey, isEventHidden } from "../lib/now";
import { eventsFunctionFor } from "../lib/calendarWrite";
import { fromGoogleRRULE, type RecurrenceRule } from "../lib/recurrence";
import { useSettings } from "./useSettings";

function throwIfInvokeFailed(data: unknown, error: Error | null) {
  if (error) throw error;
  if (data && typeof data === "object" && "error" in data && (data as { error?: unknown }).error) {
    throw new Error(String((data as { error: unknown }).error));
  }
}

export function useCalendarRefresh() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({ fullSync = false }: { fullSync?: boolean } = {}) => {
      const { error } = await supabase.functions.invoke("calendar-refresh", { body: { fullSync } });
      if (error) throw error;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["external_events"] });
      qc.invalidateQueries({ queryKey: ["calendar_accounts"] });
    },
  });
  return {
    refresh: () => mutation.mutate({}),
    fullRefresh: () => mutation.mutate({ fullSync: true }),
    refreshing: mutation.isPending,
    error: mutation.error,
  };
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

/** Every event overlapping the range — PAGED.
 *
 *  PostgREST caps an unbounded select at 1000 rows and returns them in physical
 *  (insert) order, so a wide window silently comes back as the OLDEST 1000: the
 *  13-week window the domain ledger asks for lost this week entirely, and every
 *  meeting read as zero hours. Page with a stable order so the set is complete. */
export function useExternalEvents(rangeStartISO: string, rangeEndISO: string) {
  return useQuery({
    queryKey: ["external_events", rangeStartISO, rangeEndISO],
    // See useSlots: an empty bound means "not yet", not "everything". Sending
    // it produced `start_at=lt.` with no value, which PostgREST 400s.
    enabled: Boolean(rangeStartISO && rangeEndISO),
    queryFn: async (): Promise<ExternalEvent[]> => {
      const PAGE = 1000;
      const all: ExternalEvent[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("external_events")
          .select("id, account_id, provider_event_id, calendar_id, title, start_at, end_at, all_day, location, busy, self_rsvp, recurring_event_id")
          .lt("start_at", rangeEndISO)
          .gt("end_at", rangeStartISO)
          .order("start_at")
          .order("id")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as ExternalEvent[];
        all.push(...rows);
        if (rows.length < PAGE) break;
      }
      return all;
    },
  });
}

/** The event most callers can hide. A single occurrence carries an instance key;
 *  a recurring one can be hidden as just-this or the whole series. */
type HidableEvent = Pick<ExternalEvent, "account_id" | "provider_event_id" | "title" | "recurring_event_id">;

/** Hide events Fantastical-style — keep them on the server, just out of the way
 *  (and out of the busy math). Backed by user_settings.hidden_events, so the hidden
 *  set follows the single user across desktop + the PWA. */
export function useHiddenEvents() {
  const { settings, update } = useSettings();
  const hidden = useMemo<HiddenEvent[]>(() => settings?.hidden_events ?? [], [settings]);
  const keys = useMemo(() => new Set(hidden.map((h) => h.key)), [hidden]);

  const isHidden = (e: { account_id: string; provider_event_id: string; recurring_event_id?: string | null }) =>
    isEventHidden(e, keys);

  /** The hidden key responsible for an event being hidden (series wins), for unhide. */
  const hiddenKeyFor = (e: HidableEvent): string | null => {
    const instance = eventKey(e);
    if (keys.has(instance)) return instance;
    const series = eventSeriesKey(e);
    return series && keys.has(series) ? series : null;
  };

  const hide = (e: HidableEvent, scope: RecurrenceScope = "THIS") => {
    // "All events" needs the synced master id; without it, fall back to just this one.
    const seriesKey = eventSeriesKey(e);
    const key = scope === "ALL" && seriesKey ? seriesKey : eventKey(e);
    if (keys.has(key)) return;
    update({ hidden_events: [...hidden, { key, title: e.title }] });
  };

  const unhide = (key: string) => {
    update({ hidden_events: hidden.filter((h) => h.key !== key) });
  };

  return { hidden, keys, isHidden, hiddenKeyFor, hide, unhide };
}

/** Move/resize/retitle a Google event: optimistic local write + API write-back.
 *  scope="ALL" patches the master recurring event in Google instead of just this instance. */
export function useExternalEventMutations() {
  const qc = useQueryClient();

  // Route write-back to the provider that owns the event. Google → google-events,
  // iCloud → icloud-events (CalDAV). Resolved from the query cache so callers keep
  // passing just the event/account id.
  const providerForAccount = (accountId?: string | null): CalendarProvider | null => {
    if (!accountId) return null;
    const accounts = qc.getQueryData<CalendarAccount[]>(["calendar_accounts"]);
    return accounts?.find((a) => a.id === accountId)?.provider ?? null;
  };
  const providerForEvent = (id: string): CalendarProvider => {
    for (const [, data] of qc.getQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] })) {
      const ev = data?.find((e) => e.id === id);
      if (ev) return providerForAccount(ev.account_id) ?? "google";
    }
    return "google";
  };

  const resolveProviderForEvent = async (id: string): Promise<CalendarProvider> => {
    let accountId: string | undefined;
    for (const [, data] of qc.getQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] })) {
      const ev = data?.find((e) => e.id === id);
      if (ev) {
        accountId = ev.account_id;
        break;
      }
    }
    if (!accountId) {
      const { data: ev } = await supabase.from("external_events").select("account_id").eq("id", id).single();
      accountId = ev?.account_id;
    }
    if (!accountId) throw new Error("Event not found");

    const cached = providerForAccount(accountId);
    if (cached) return cached;

    const { data: acct, error } = await supabase
      .from("calendar_accounts")
      .select("provider")
      .eq("id", accountId)
      .single();
    if (error || !acct?.provider) throw new Error("Calendar account not found");
    return acct.provider as CalendarProvider;
  };

  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
      scope = "THIS",
    }: {
      id: string;
      // `description` isn't a column on external_events (it lives in `raw`), so
      // it rides along to the edge fn / provider but is stripped before the row
      // write. Everything else maps to a real column.
      patch: Partial<Pick<ExternalEvent, "title" | "start_at" | "end_at" | "location" | "all_day">> & {
        description?: string;
        /** Google / iCalendar RRULE lines; null or [] removes recurrence. */
        recurrence?: string[] | null;
      };
      scope?: RecurrenceScope;
    }) => {
      // For THIS-only edits, write the instance row immediately so optimistic
      // update is consistent. For ALL, the master PATCH in Google will push a
      // sync back that rewrites all instances — skip the local row update.
      if (scope === "THIS") {
        const { description: _description, recurrence: _recurrence, ...columns } = patch;
        if (Object.keys(columns).length) {
          const { error } = await supabase.from("external_events").update(columns).eq("id", id);
          if (error) throw error;
        }
      }
      invokeQuiet(eventsFunctionFor(providerForEvent(id)), { eventId: id, patch, scope });
    },
    onMutate: async ({ id, patch, scope = "THIS" }) => {
      if (scope !== "THIS") return;
      await qc.cancelQueries({ queryKey: ["external_events"] });
      const snapshot = qc.getQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] });
      const { description, recurrence: _recurrence, ...columns } = patch;
      if (Object.keys(columns).length) {
        qc.setQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] }, (old) =>
          old?.map((e) => (e.id === id ? { ...e, ...columns } : e)),
        );
      }
      // Reflect a notes edit in the open inspector immediately (raw cache).
      const hadDescription = description !== undefined;
      const detailSnapshot = hadDescription
        ? qc.getQueryData<GoogleRawEvent | null>(["event_details", id])
        : undefined;
      if (hadDescription) {
        qc.setQueryData<GoogleRawEvent | null>(["event_details", id], (old) =>
          old ? { ...old, description } : old,
        );
      }
      return { snapshot, detailSnapshot, hadDescription, id };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) {
        for (const [key, data] of ctx.snapshot) qc.setQueryData(key, data);
      }
      if (ctx?.hadDescription) {
        qc.setQueryData(["event_details", ctx.id], ctx.detailSnapshot);
      }
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: ["external_events"] });
      if (vars?.patch.recurrence !== undefined) {
        qc.invalidateQueries({ queryKey: ["event_series_rule", vars.id] });
      }
    },
  });

  // Move an event to a different calendar within the same account. Google uses
  // its native move endpoint; iCloud re-homes the CalDAV resource (PUT to the
  // new collection + DELETE the old). Optimistically retag the mirror row's
  // calendar_id so the event recolors to the destination immediately.
  const move = useMutation({
    mutationFn: async ({ id, calendarId }: { id: string; calendarId: string }) => {
      const { error } = await supabase.functions.invoke(eventsFunctionFor(providerForEvent(id)), {
        body: { action: "move", eventId: id, calendarId },
      });
      if (error) throw error;
    },
    onMutate: async ({ id, calendarId }) => {
      await qc.cancelQueries({ queryKey: ["external_events"] });
      const snapshot = qc.getQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] });
      qc.setQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] }, (old) =>
        old?.map((e) => (e.id === id ? { ...e, calendar_id: calendarId } : e)),
      );
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.snapshot) {
        for (const [key, data] of ctx.snapshot) qc.setQueryData(key, data);
      }
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
      const { error } = await supabase.functions.invoke("google-events", {
        body: { action: "rsvp", eventId: id, responseStatus, sendNotifications },
      });
      if (error) throw error;
    },
    // Optimistically flip self_rsvp in the grid cache so the event de-dims
    // immediately without waiting for the edge function round-trip.
    onMutate: async ({ id, responseStatus }) => {
      await qc.cancelQueries({ queryKey: ["external_events"] });
      const previous = qc.getQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] });
      qc.setQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] }, (old) =>
        old?.map((e) => (e.id === id ? { ...e, self_rsvp: responseStatus } : e)),
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) {
        ctx.previous.forEach(([key, data]) => qc.setQueryData(key, data));
      }
    },
    onSuccess: (_d, vars) => {
      // Confirm the optimistic value directly — don't invalidate external_events,
      // which would trigger a re-fetch that could race with the DB write and
      // flash the event back to its old opacity.
      qc.setQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] }, (old) =>
        old?.map((e) => (e.id === vars.id ? { ...e, self_rsvp: vars.responseStatus } : e)),
      );
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
    mutationFn: async ({
      id,
      scope = "THIS",
      notifyGuests,
    }: {
      id: string;
      scope?: RecurrenceScope;
      /** Send cancellation notices. Omit to let the edge function decide from
       *  the event: a meeting you organize with guests notifies, a solo event
       *  stays quiet. Pass false to cancel without telling anyone. */
      notifyGuests?: boolean;
    }) => {
      const provider = await resolveProviderForEvent(id);
      const { data, error } = await supabase.functions.invoke(eventsFunctionFor(provider), {
        body: { action: "delete", eventId: id, scope, notifyGuests },
      });
      throwIfInvokeFailed(data, error);
    },
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ["external_events"] });
      const snapshot = qc.getQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] });
      qc.setQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] }, (old) =>
        old?.filter((e) => e.id !== id),
      );
      return { snapshot };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.snapshot) {
        for (const [key, data] of ctx.snapshot) qc.setQueryData(key, data);
      }
      toast.error(err instanceof Error ? err.message : "Couldn't delete event");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["external_events"] }),
  });

  // Create a real Google event on the primary calendar. Optimistically show the
  // event immediately; the edge function POSTs to Google and writes the DB row,
  // then onSettled refetches to swap in the real record.
  const create = useMutation({
    mutationFn: async ({
      title,
      start_at,
      end_at,
      recurrence,
      attendees,
      accountId,
      calendarId,
      location,
      description,
      notifyGuests,
      addMeet,
      all_day,
    }: {
      title: string;
      start_at: string;
      end_at: string;
      /** Google RRULE lines, e.g. ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"]. */
      recurrence?: string[];
      /** Email addresses to invite. */
      attendees?: string[];
      /** calendar_accounts.id to create on; omit for the first connected account. */
      accountId?: string;
      /** Target calendar within the account; omit for the account's default. */
      calendarId?: string;
      location?: string;
      description?: string;
      /** Email the guests. Defaults to true (an invite nobody is told about is
       *  not an invite) — the composer confirms who gets mailed and can pass
       *  false to add guests without sending. */
      notifyGuests?: boolean;
      /** Attach a Google Meet link. Omit to let the account's `auto_add_meet`
       *  preference decide (shared rule in _shared/conferencing.ts) — Google
       *  never applies its own auto-conferencing setting to API-created events,
       *  so nobody asking means no link at all. Google only. */
      addMeet?: boolean;
      all_day?: boolean;
    }) => {
      const provider = providerForAccount(accountId) ?? "google";
      const { data, error } = await supabase.functions.invoke(eventsFunctionFor(provider), {
        body: { action: "create", title, start_at, end_at, all_day, recurrence, attendees, accountId, calendarId, location, description, notifyGuests, ...(provider === "google" ? { addMeet } : {}) },
      });
      if (error) throw error;
      return data;
    },
    onMutate: async ({ title, start_at, end_at, all_day }) => {
      await qc.cancelQueries({ queryKey: ["external_events"] });
      const tempId = crypto.randomUUID();
      const optimistic: ExternalEvent = {
        id: tempId,
        account_id: "",
        provider_event_id: tempId,
        calendar_id: "",
        title,
        start_at,
        end_at,
        all_day: Boolean(all_day),
        location: null,
        busy: true,
        self_rsvp: null,
      };
      qc.setQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] }, (old) =>
        old ? [...old, optimistic] : [optimistic],
      );
      return { tempId };
    },
    onError: (_, __, ctx) => {
      if (!ctx) return;
      qc.setQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] }, (old) =>
        old?.filter((e) => e.id !== ctx.tempId),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["external_events"] }),
  });

  const invite = useMutation({
    mutationFn: async ({
      id,
      attendees,
      notifyGuests,
    }: {
      id: string;
      attendees: string[];
      /** Email the new guests. Defaults to true. */
      notifyGuests?: boolean;
    }) => {
      const { error } = await supabase.functions.invoke("google-events", {
        body: { action: "invite", eventId: id, attendees, notifyGuests },
      });
      if (error) throw error;
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: ["event_details", vars.id] });
    },
  });

  // Add a Google Meet link to an event that doesn't have one — the meeting
  // booked before the preference existed, or one that grew guests later.
  const addMeet = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { data, error } = await supabase.functions.invoke("google-events", {
        body: { action: "add_meet", eventId: id },
      });
      if (error) throw error;
      return data as { meetUrl: string | null; pending?: boolean };
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: ["event_details", vars.id] });
    },
  });

  const findEvent = (id: string): ExternalEvent | undefined => {
    for (const [, data] of qc.getQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] })) {
      const found = data?.find((e) => e.id === id);
      if (found) return found;
    }
    return undefined;
  };

  // Move an event to any writable calendar in any account. Within the same
  // account it's a clean native move; across accounts (or providers) there is
  // no native move — copy this event onto the target, then remove it from the
  // source. Recurrence and guests don't carry: it's a single-instance copy, so
  // for a series we detach just this occurrence (delete THIS) and leave the rest.
  const moveEventToCalendar = async ({
    id,
    targetAccountId,
    targetCalendarId,
  }: {
    id: string;
    targetAccountId: string;
    targetCalendarId: string;
  }) => {
    const ev = findEvent(id);
    if (!ev) return;
    if (targetAccountId === ev.account_id) {
      move.mutate({ id, calendarId: targetCalendarId });
      return;
    }
    // Notes live in `raw` — pull them so they carry across the copy.
    let description = qc.getQueryData<GoogleRawEvent | null>(["event_details", id])?.description;
    if (description === undefined) {
      const { data } = await supabase.from("external_events").select("raw").eq("id", id).single();
      description = (data?.raw as GoogleRawEvent | null)?.description ?? undefined;
    }
    await create.mutateAsync({
      accountId: targetAccountId,
      calendarId: targetCalendarId,
      title: ev.title,
      start_at: ev.start_at,
      end_at: ev.end_at,
      location: ev.location ?? undefined,
      description,
    });
    // Only remove the source after the copy lands (mutateAsync throws on failure).
    del.mutate({ id, scope: "THIS" });
  };

  return {
    updateEvent: update.mutate,
    moveEvent: move.mutate,
    moveEventToCalendar,
    rsvpEvent: rsvp.mutateAsync,
    createEvent: create.mutateAsync,
    deleteEvent: del.mutate,
    inviteToEvent: invite.mutateAsync,
    addMeetToEvent: addMeet.mutateAsync,
  };
}

/** Fetch the raw event payload for a single event — attendees, organizer,
 *  conference link, etc. Only called when a slide-over is open.
 *  `accountEmail` (the connected account's own address) is required to
 *  normalize a Microsoft Graph payload into Google's shape — pass the
 *  email of the account that owns this event (`accounts.find(a => a.id ===
 *  event.account_id)?.email`); omit it for a Google/ICS/iCloud event. */
/** The detail payload (guests, description, conferencing) for one event. It is
 *  a separate read on purpose: `raw` is the biggest column in the table and the
 *  grid query deliberately never selects it. */
async function fetchEventDetails(id: string, accountEmail?: string | null): Promise<GoogleRawEvent | null> {
  const { data, error } = await supabase
    .from("external_events")
    .select("raw")
    .eq("id", id)
    .single();
  if (error) throw error;
  return normalizeRawEvent(data?.raw as ProviderRawEvent | null, accountEmail);
}

const EVENT_DETAILS_STALE_MS = 30_000;

export function useEventDetails(id: string | null, accountEmail?: string | null) {
  return useQuery({
    queryKey: ["event_details", id],
    enabled: Boolean(id),
    staleTime: EVENT_DETAILS_STALE_MS,
    queryFn: async (): Promise<GoogleRawEvent | null> =>
      id ? fetchEventDetails(id, accountEmail) : null,
  });
}

/**
 * Warm an event's details while the pointer rests on its block, so the popover
 * opens with its guests and notes already in hand.
 *
 * Without it the card renders once empty and once full — and the second render
 * is what made it visibly grow a beat after opening. The account email has to
 * match what the popover passes, or the cached payload would carry the wrong
 * `self` flags (whose RSVP is yours) — so it is resolved from the same accounts
 * cache the popover reads.
 */
export function usePrefetchEventDetails() {
  const qc = useQueryClient();
  return useCallback(
    (event: ExternalEvent | null | undefined) => {
      if (!event) return;
      const accounts = qc.getQueryData<CalendarAccount[]>(["calendar_accounts"]);
      const email = accounts?.find((a) => a.id === event.account_id)?.email ?? null;
      void qc.prefetchQuery({
        queryKey: ["event_details", event.id],
        staleTime: EVENT_DETAILS_STALE_MS,
        queryFn: () => fetchEventDetails(event.id, email),
      });
    },
    [qc],
  );
}

/** Read the recurrence rule for a calendar event. Instances don't carry the
 *  RRULE locally — this fetches it from the series master on Google/iCloud. */
export function useEventSeriesRule(eventId: string | null, isRecurring: boolean) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["event_series_rule", eventId],
    enabled: Boolean(eventId && isRecurring),
    staleTime: 30_000,
    queryFn: async (): Promise<RecurrenceRule | null> => {
      if (!eventId) return null;
      let provider: CalendarProvider = "google";
      for (const [, data] of qc.getQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] })) {
        const ev = data?.find((e) => e.id === eventId);
        if (ev) {
          provider = providerForAccountFromCache(qc, ev.account_id) ?? "google";
          break;
        }
      }
      const { data, error } = await supabase.functions.invoke(eventsFunctionFor(provider), {
        body: { action: "series_rule", eventId },
      });
      throwIfInvokeFailed(data, error);
      const recurrence = (data as { recurrence?: string[] | null })?.recurrence;
      return fromGoogleRRULE(recurrence ?? null);
    },
  });
}

function providerForAccountFromCache(qc: ReturnType<typeof useQueryClient>, accountId: string): CalendarProvider | null {
  const accounts = qc.getQueryData<CalendarAccount[]>(["calendar_accounts"]);
  return accounts?.find((a) => a.id === accountId)?.provider ?? null;
}

/** Mirrors the `labels.color` schema default — client-minted rows must name it
 *  so the optimistic label matches the persisted one. */
const DEFAULT_LABEL_COLOR = "#2563EB";

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

  /** Labels are user data, so they queue like everything else. The colour
   *  default is named here rather than left to the column default — the row is
   *  built on the client now, and an omitted colour would render one shade
   *  optimistically and another once the insert lands. */
  const createLabel = async ({ name, color }: { name: string; color?: string }): Promise<Label> => {
    const id = crypto.randomUUID();
    const row = { name, color: color ?? DEFAULT_LABEL_COLOR };
    qc.setQueryData<Label[]>(["labels"], (old) => [...(old ?? []), { id, ...row }]);
    await queueWrite(makeOp("labels", "insert", id, row));
    invalidateWhenSafe(qc, "labels", ["labels"]);
    return { id, ...row };
  };

  const updateLabel = ({ id, ...patch }: { id: string; name?: string; color?: string }) => {
    qc.setQueryData<Label[]>(["labels"], (old) =>
      old?.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    );
    void queueWrite(makeOp("labels", "update", id, patch));
    invalidateWhenSafe(qc, "labels", ["labels"]);
  };

  const deleteLabel = (id: string) => {
    qc.setQueryData<Label[]>(["labels"], (old) => old?.filter((l) => l.id !== id));
    void queueWrite(makeOp("labels", "delete", id));
    invalidateWhenSafe(qc, "labels", ["labels"]);
  };

  return { labels: query.data ?? [], createLabel, updateLabel, deleteLabel };
}
