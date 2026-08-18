// A click that dismisses an open event/task/slot popover by landing on the
// calendar grid is ONE action (dismiss), not two (dismiss + create). But the
// popover's outside-click listener and FullCalendar's own click-to-create
// handling are independent systems reacting to the same physical click —
// stopping the mousedown event's propagation doesn't reliably stop
// FullCalendar's interaction plugin from also firing dateClick, since it may
// not depend on that propagation path at all.
//
// So instead of trying to win a timing/propagation race, the popover marks
// the click as "handled" when it dismisses; the calendar's dateClick handler
// consumes that mark and bails before opening a new draft. A click-drag
// (`select`) is different: drawing a time range is create intent, even if the
// same pointerdown closed a popover. Skipping `select` without `unselect()` is
// how the blue select-mirror got stuck (unselectAuto is false so the composer
// can own the ghost).
//
// The mark is same-gesture only. If the dismiss click never hits the grid
// (rail, another floor…), nothing consumes it — so we drop it on pointerup
// after dateClick has had a chance to run, and it can't eat the next create.
let handled = false;
let expireTimer: ReturnType<typeof setTimeout> | null = null;
let stopExpireListen: (() => void) | null = null;

function cancelExpire() {
  if (expireTimer != null) {
    clearTimeout(expireTimer);
    expireTimer = null;
  }
  stopExpireListen?.();
  stopExpireListen = null;
}

export function markCalendarClickHandled() {
  handled = true;
  cancelExpire();
  if (typeof document === "undefined") return;
  const onUp = () => {
    document.removeEventListener("pointerup", onUp, true);
    stopExpireListen = null;
    // pointerup → mouseup (select) → click (dateClick), then this timeout.
    expireTimer = setTimeout(() => {
      handled = false;
      expireTimer = null;
    }, 0);
  };
  document.addEventListener("pointerup", onUp, true);
  stopExpireListen = () => document.removeEventListener("pointerup", onUp, true);
}

export function consumeCalendarClickHandled(): boolean {
  const was = handled;
  handled = false;
  cancelExpire();
  return was;
}
