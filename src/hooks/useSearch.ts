/**
 * Search as both shells read it — the local ranking (`lib/search`), the date a
 * query names, the empty search's recents, and the calendar's async half
 * (`useEventSearch`). The phone's Search sheet and the desktop's `/` door are
 * layouts over this; neither decides what a result is (D-210).
 */

import { useMemo, useState } from "react";
import { todayISO } from "../lib/dates";
import {
  dateIntent,
  readRecent,
  recentHits,
  rememberRecent,
  searchSections,
  type DateIntent,
  type RecentRef,
  type SearchHit,
  type SearchSection,
} from "../lib/search";
import type { EventHit } from "../lib/eventSearch";
import type { Task } from "../lib/types";
import type { VerticalData } from "../lib/vertical";
import { useEventSearch } from "./useEventSearch";

export interface SearchModel {
  /** Non-empty query: the ranked local sections. */
  sections: SearchSection[];
  /** Empty query: the last few things opened from search, still alive. */
  recent: SearchHit[];
  /** The whole query is a day — "friday", "dec 3". */
  date: DateIntent | null;
  events: EventHit[];
  eventsLoading: boolean;
  eventsOffline: boolean;
  /** Call when a local hit is opened, so the next empty search offers it. */
  remember: (ref: RecentRef) => void;
}

export function useSearch(
  query: string,
  { vertical, tasks, withEvents = true }: { vertical: VerticalData; tasks: readonly Task[]; withEvents?: boolean },
): SearchModel {
  // Read once per opening — a door is short-lived, and re-reading storage on
  // every keystroke buys nothing.
  const [recentRefs] = useState(readRecent);
  const today = todayISO();
  const q = query.trim();

  const sections = useMemo(
    () => (q ? searchSections(q, { vertical, tasks, today, recent: recentRefs }) : []),
    [q, vertical, tasks, today, recentRefs],
  );
  const recent = useMemo(
    () => (q ? [] : recentHits({ vertical, tasks, today, recent: recentRefs })),
    [q, vertical, tasks, today, recentRefs],
  );
  const date = useMemo(() => dateIntent(q), [q]);
  const { hits, loading, offline } = useEventSearch(withEvents ? q : "");

  return {
    sections,
    recent,
    date,
    events: hits,
    eventsLoading: loading,
    eventsOffline: offline,
    remember: rememberRecent,
  };
}
