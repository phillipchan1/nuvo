// The filter a surface is currently asking, and the views the user has saved.
//
// One hook so the rail and the collection table share a vocabulary without
// sharing state: each surface holds its own live `query` (filtering the rail
// should not silently filter a table you can't see), but they read and write
// ONE list of saved views, and both resolve their question through the one
// kernel predicate.
//
// The live query is deliberately NOT persisted. A filter you left on last
// Tuesday, silently hiding work when you open the app, is the failure mode
// every list tool has — and it is worse in a planner, where a short list reads
// as "you're on top of it". Saved views are the persistent thing, and applying
// one is a deliberate act.

import { useCallback, useMemo, useState } from "react";
import { useSettings } from "./useSettings";
import { useVertical } from "./useVertical";
import { filterTasks, MAX_SAVED_VIEWS, type SavedView, type TaskQuery } from "../lib/taskFilter";
import type { Task } from "../lib/types";

/** Client-generated so a view saved offline keeps its identity on arrival. */
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `view-${Date.now()}`;

export function useTaskFilter(now: Date) {
  const { settings, update } = useSettings();
  const { data: vertical } = useVertical();
  const [query, setQuery] = useState<TaskQuery>({});

  const savedViews = useMemo<SavedView[]>(() => settings?.saved_views ?? [], [settings]);

  const saveView = useCallback(
    (name: string) => {
      const next = [
        ...(settings?.saved_views ?? []),
        { id: newId(), name, query, createdAt: new Date().toISOString() },
      ].slice(-MAX_SAVED_VIEWS);
      update({ saved_views: next });
    },
    [settings, query, update],
  );

  const deleteView = useCallback(
    (id: string) => update({ saved_views: (settings?.saved_views ?? []).filter((v) => v.id !== id) }),
    [settings, update],
  );

  /** Apply a list. Memoized on the QUESTION, not on the array identity, so a
   *  re-render that rebuilds `query` doesn't refilter the world. */
  const apply = useCallback(
    (tasks: Task[]) => filterTasks(tasks, query, vertical, now),
    [query, vertical, now],
  );

  return {
    query,
    setQuery,
    apply,
    savedViews,
    saveView,
    deleteView,
    applyView: useCallback((v: SavedView) => setQuery(v.query), []),
  };
}
