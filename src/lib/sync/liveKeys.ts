/**
 * Which query caches a server table feeds — one map, read by every path that
 * learns a row changed somewhere else: the Supabase Realtime socket
 * (`useRealtime`), the Worker's change feed (`feed.ts`) and a capture handed
 * over from the ⌥Space panel. When a change can't be painted into the cache
 * directly, these are the keys that refetch instead.
 */
export const TABLE_TO_KEYS: Record<string, string[][]> = {
  tasks: [["tasks"]],
  task_labels: [["tasks"]],
  slots: [["slots"]],
  recurrences: [["recurrences"], ["tasks"], ["slots"]],
  labels: [["labels"]],
  external_events: [["external_events"]],
  calendar_accounts: [["calendar_accounts"]],
  user_settings: [["settings"]],
  domains: [["vertical"]],
  initiatives: [["vertical"]],
  projects: [["vertical"]],
  record_comments: [["record_comments"]],
  key_results: [["vertical"]],
  sprints: [["sprint"]],
  week_reviews: [["week_reviews"]],
  event_domain_routing: [["event_domain_routing"], ["vertical"]],
};

/**
 * The tables the Worker's change feed reports (`worker/src/syncFeed.ts`
 * `FEED_TABLES` — keep the two lists the same).
 */
export const FEED_TABLES = [
  "tasks",
  "task_labels",
  "projects",
  "initiatives",
  "domains",
  "key_results",
  "slots",
  "labels",
  "user_settings",
  "record_comments",
  "week_reviews",
  "sprints",
  "recurrences",
  "reminders",
  "external_events",
  "event_domain_routing",
] as const;

/**
 * The feed's map: everything above, plus the tables Supabase Realtime never
 * broadcast (so `useRealtime`, which subscribes to every key above, must not
 * see them).
 */
export const FEED_KEYS: Record<string, string[][]> = {
  ...TABLE_TO_KEYS,
  reminders: [["reminders"]],
};

/** The feed's own bookkeeping (its cursor), kept in the query cache so it is
 *  persisted in the same snapshot as the rows it describes. */
export const FEED_STATE_ROOT = "sync_feed";

/**
 * Query roots whose freshness the feed owns: every cache `FEED_KEYS` maps a
 * feed table onto. A query under one of these is kept current by the feed, so
 * it never refetches just because time passed or the window got focus.
 */
export const FEED_ROOTS: ReadonlySet<string> = new Set([
  ...FEED_TABLES.flatMap((t) => (FEED_KEYS[t] ?? []).map((k) => k[0])),
  FEED_STATE_ROOT,
]);

export function feedCoversKey(queryKey: readonly unknown[]): boolean {
  return FEED_ROOTS.has(String(queryKey[0] ?? ""));
}
