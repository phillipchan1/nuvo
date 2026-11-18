// Drives the AI router (Layer 3). Finds attended events on calendars that aren't
// deterministically mapped (Settings → Connections) and aren't hidden, and that
// haven't been routed yet, then sends a batch to the `route-events` edge function
// which caches a domain verdict per event. Invalidating the routing cache lets
// buildVertical re-attribute and shrinks the candidate set, so it converges over
// a few loads. Mount once, high in the tree (it self-throttles to one in-flight
// batch). Mirrors the lazy passive-grooming trigger.

import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useCalendarAccounts, useExternalEvents } from "./useCalendar";
import { useEventRouting, useEventRoutingFetched } from "./useEventRouting";
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
  const routing = useEventRouting();
  const routingFetched = useEventRoutingFetched();
  // Judged keys, including empty verdicts (AI said "none") so we never re-ask.
  // Derived from the session map — a second paged select of the same table was
  // 452 KB every staleness kick (D-249).
  const routed = useMemo(() => new Set(Object.keys(routing)), [routing]);

  const inFlight = useRef(false);
  // Every key we've already spent a completion on this session. The routing
  // table is the durable cache; this is the backstop that guarantees we spend
  // on a given event at most ONCE per load even if the cache read comes back
  // incomplete or the write silently fails. Without it, any hole in the cache
  // becomes an unbounded LLM billing loop.
  const attempted = useRef<Set<string>>(new Set());
  const map = settings?.calendar_domain_map;
  const hiddenIds = settings?.hidden_calendar_ids;
  const hiddenEvents = settings?.hidden_events;

  useEffect(() => {
    const events = eventsQ.data;
    if (!events || !map || !routingFetched || inFlight.current) return;

    // Same filter the ledger applies — never spend a completion on time that
    // wouldn't be counted anyway.
    const filter = {
      hiddenCalendarIds: new Set(hiddenIds ?? []),
      hiddenEventKeys: new Set((hiddenEvents ?? []).map((h) => h.key)),
    };
    const candidates = events
      .filter(
        (e) =>
          eventCountsAsActual(e, undefined, filter) && // past, busy, attended, not hidden
          !map[calendarKey(e)] && // not deterministically mapped
          !routed.has(eventKey(e)) && // not already judged
          !attempted.current.has(eventKey(e)), // never spend twice in one session
      )
      .slice(0, BATCH);
    if (!candidates.length) return;

    for (const e of candidates) attempted.current.add(eventKey(e));

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
  }, [eventsQ.data, routed, routingFetched, map, hiddenIds, hiddenEvents, accountsQ.data, qc]);
}
