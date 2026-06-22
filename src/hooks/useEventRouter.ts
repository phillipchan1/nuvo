// Drives the AI router (Layer 3). Finds attended events on calendars that aren't
// deterministically mapped (Settings → Connections) and aren't hidden, and that
// haven't been routed yet, then sends a batch to the `route-events` edge function
// which caches a domain verdict per event. Invalidating the routing cache lets
// buildVertical re-attribute and shrinks the candidate set, so it converges over
// a few loads. Mount once, high in the tree (it self-throttles to one in-flight
// batch). Mirrors the lazy passive-grooming trigger.

import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useCalendarAccounts, useExternalEvents } from "./useCalendar";
import { useSettings } from "./useSettings";
import { calendarKey, eventCountsAsActual, eventKey } from "../lib/eventActuals";
import { planningWeekStartISO } from "../lib/dates";

const BATCH = 40;

export function useEventRouter() {
  const qc = useQueryClient();
  const weekStart = planningWeekStartISO();
  const range = useMemo(() => {
    const ws = new Date(`${weekStart}T00:00:00`).getTime();
    return {
      start: new Date(ws - 13 * 7 * 86_400_000).toISOString(),
      end: new Date(ws + 7 * 86_400_000).toISOString(),
    };
  }, [weekStart]);

  const eventsQ = useExternalEvents(range.start, range.end);
  const accountsQ = useCalendarAccounts();
  const { settings } = useSettings();

  // The set of event keys already judged (domain or null) — so we never re-route.
  const routedQ = useQuery({
    queryKey: ["event_domain_routing", "keys"],
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase.from("event_domain_routing").select("event_key");
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.event_key as string));
    },
    staleTime: 60_000,
  });

  const inFlight = useRef(false);
  const map = settings?.calendar_domain_map;
  const hiddenIds = settings?.hidden_calendar_ids;

  useEffect(() => {
    const events = eventsQ.data;
    const routed = routedQ.data;
    if (!events || !map || !routed || inFlight.current) return;

    const hidden = new Set(hiddenIds ?? []);
    const candidates = events
      .filter(
        (e) =>
          eventCountsAsActual(e) && // past, busy, attended
          !map[calendarKey(e)] && // not deterministically mapped
          !hidden.has(e.calendar_id) && // user didn't hide this calendar
          !routed.has(eventKey(e)), // not already judged
      )
      .slice(0, BATCH);
    if (!candidates.length) return;

    const calName = new Map<string, string>();
    for (const a of accountsQ.data ?? []) for (const c of a.calendars ?? []) calName.set(c.id, c.summary);

    inFlight.current = true;
    supabase.functions
      .invoke("route-events", {
        body: {
          events: candidates.map((e) => ({
            key: eventKey(e),
            title: e.title,
            calendarName: calName.get(e.calendar_id),
          })),
        },
      })
      .then(({ error }) => {
        inFlight.current = false;
        if (!error) qc.invalidateQueries({ queryKey: ["event_domain_routing"] });
      })
      .catch(() => {
        inFlight.current = false;
      });
  }, [eventsQ.data, routedQ.data, map, hiddenIds, accountsQ.data, qc]);
}
