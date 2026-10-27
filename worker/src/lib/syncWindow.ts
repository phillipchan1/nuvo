/** The window every calendar sync materializes events over (Google and iCloud
 *  alike). The write-back functions expand a series they just wrote over the
 *  SAME window, so the two agree on which occurrence rows exist and the next
 *  poll has nothing to add or sweep. Pure — no imports. */
export const SYNC_WINDOW_PAST_DAYS = 30;
export const SYNC_WINDOW_FUTURE_DAYS = 120;

export function syncWindow(nowMs = Date.now()): { start: Date; end: Date } {
  return {
    start: new Date(nowMs - SYNC_WINDOW_PAST_DAYS * 86_400_000),
    end: new Date(nowMs + SYNC_WINDOW_FUTURE_DAYS * 86_400_000),
  };
}
