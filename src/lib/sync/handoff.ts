/**
 * Outbox hand-off between the ⌥Space panel and the main window.
 *
 * The panel queues a capture into the shared outbox and is ordered out 900ms
 * later. It used to be the only thing that could deliver that write: one send
 * attempt from a webview about to be hidden (timers throttled, no focus or
 * visibility event coming to retry on), and a main window that learned of the
 * row only when Realtime echoed it. Any hitch in that one attempt and the
 * capture sat in the outbox until the main window next happened to drain — a
 * "saved" task that took ten seconds to reach the inbox it was looking at.
 *
 * So the panel says so. Main is awake, owns the token refresh and has the
 * drain's backoff; it delivers whatever is still queued (a duplicate send is an
 * ignored upsert) and then refreshes the lists the write lands in. Tauri events
 * are the channel for the same reason as `lib/authSync.ts`: BroadcastChannel
 * and `storage` events do not cross WKWebViews.
 */

import { isSpotlightWindow, isTauri } from "../platform";
import { SYNC_TABLES, type SyncTable } from "./ops";

/** Spotlight → main: a write for this table is in the shared outbox. */
export const OUTBOX_QUEUED_EVENT = "nuvo-outbox-queued";

// One capture is often several ops (label → task → task_labels) a few
// milliseconds apart; main should answer them with one drain.
const COALESCE_MS = 40;

export async function announceQueuedWrite(table: SyncTable): Promise<void> {
  if (!isTauri() || !isSpotlightWindow()) return;
  try {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("main", OUTBOX_QUEUED_EVENT, { table });
  } catch {
    /* main window missing */
  }
}

/** Main only. Calls back with the tables the panel queued writes for. */
export function listenForQueuedWrites(onTables: (tables: SyncTable[]) => void): () => void {
  if (!isTauri() || isSpotlightWindow()) return () => {};
  let stopped = false;
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tables = new Set<SyncTable>();

  const flush = () => {
    timer = null;
    const batch = [...tables];
    tables.clear();
    if (!stopped && batch.length) onTables(batch);
  };

  void import("@tauri-apps/api/event")
    .then(({ listen }) =>
      listen<{ table?: string }>(OUTBOX_QUEUED_EVENT, (e) => {
        const table = e.payload?.table;
        if (!table || !(SYNC_TABLES as readonly string[]).includes(table)) return;
        tables.add(table as SyncTable);
        if (timer === null) timer = setTimeout(flush, COALESCE_MS);
      }),
    )
    .then((u) => {
      if (stopped) u();
      else unlisten = u;
    })
    .catch(() => {
      /* web / tests */
    });

  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    unlisten?.();
  };
}
