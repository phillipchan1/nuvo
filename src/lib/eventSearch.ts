/**
 * Searching the calendar.
 *
 * Until now `buildSearchHits` indexed four kinds — task, project, initiative,
 * domain — and events were absent from every surface. "When did I last meet
 * Sam?" was unanswerable inside Nuvo.
 *
 * The reason events are handled HERE rather than folded into `buildSearchHits`
 * is a deliberate trade (see docs/calendar-task-remediation §2.3):
 * `external_events` is a mirror the sync job rewrites wholesale, it is outside
 * the offline outbox, and pre-caching every month of it into IndexedDB is
 * exactly the unbounded local growth that caused the splash-hang outage. So:
 *
 *   · the vertical half of search stays INSTANT and local — a keystroke never
 *     waits on a network round-trip;
 *   · events arrive asynchronously from a bounded server query and render into
 *     their own group as they land;
 *   · offline, the group says so rather than lying by omission.
 *
 * Two queries, not one. A calendar question is almost always "when is the next
 * one" or "when was the last one", and a single `order(start_at)` answers only
 * one of them — a `desc` limit buries next week's standup under two years of
 * past ones.
 */

import { supabase } from "./supabase";
import type { ExternalEvent } from "./types";

export interface EventHit {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  account_id: string;
  provider_event_id: string;
  /** Ahead of now, or behind it — the two halves the UI groups by. */
  when: "upcoming" | "past";
}

const UPCOMING_LIMIT = 8;
const PAST_LIMIT = 12;

/** PostgREST's `or()` takes a comma-separated filter list, so a query
 *  containing a comma or a paren would be parsed as syntax rather than text.
 *  Strip those and `%`/`*` (wildcards) instead of failing the search. */
export function sanitizeEventQuery(q: string): string {
  return q.replace(/[,()%*\\]/g, " ").replace(/\s+/g, " ").trim();
}

const COLS = "id, title, start_at, end_at, all_day, location, account_id, provider_event_id";

/**
 * Title/location matches, nearest-in-time first within each half.
 * Returns `[]` for a query too short to be meaningful — a one-character
 * search over a whole calendar is noise, not an answer.
 */
export async function searchEvents(rawQuery: string, nowISO = new Date().toISOString()): Promise<EventHit[]> {
  const q = sanitizeEventQuery(rawQuery);
  if (q.length < 2) return [];
  const filter = `title.ilike.%${q}%,location.ilike.%${q}%`;

  const [upcoming, past] = await Promise.all([
    supabase
      .from("external_events")
      .select(COLS)
      .or(filter)
      .gte("start_at", nowISO)
      .order("start_at", { ascending: true })
      .limit(UPCOMING_LIMIT),
    supabase
      .from("external_events")
      .select(COLS)
      .or(filter)
      .lt("start_at", nowISO)
      .order("start_at", { ascending: false })
      .limit(PAST_LIMIT),
  ]);

  if (upcoming.error) throw upcoming.error;
  if (past.error) throw past.error;

  const mark = (rows: unknown[], when: EventHit["when"]): EventHit[] =>
    (rows as ExternalEvent[]).map((e) => ({
      id: e.id,
      title: e.title,
      start_at: e.start_at,
      end_at: e.end_at,
      all_day: e.all_day,
      location: e.location,
      account_id: e.account_id,
      provider_event_id: e.provider_event_id,
      when,
    }));

  return [...mark(upcoming.data ?? [], "upcoming"), ...mark(past.data ?? [], "past")];
}

/** The one line under an event hit: when it was, and where if we know. */
export function eventHitSubtitle(hit: EventHit): string {
  const d = new Date(hit.start_at);
  const day = d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
  const time = hit.all_day ? "all day" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return hit.location ? `${day} · ${time} · ${hit.location}` : `${day} · ${time}`;
}

/** Local calendar date of a hit — where the calendar should land. */
export function eventHitDateISO(hit: Pick<EventHit, "start_at">): string {
  const d = new Date(hit.start_at);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
