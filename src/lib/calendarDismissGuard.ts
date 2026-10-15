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
// (rail, another floor…), nothing consumes it — so it is dropped at the NEXT
// press, before anything that press could create. Not on a timer after
// pointerup: FullCalendar fires `dateClick` from a `setTimeout(0)` scheduled at
// mouseup (its mirror's `stop`), which runs AFTER a timeout scheduled at the
// earlier pointerup — so the mark had always expired one task before the
// dateClick it existed for, and a tap that closed a popover (or the draft
// composer, D-158) opened a new draft under it anyway.
let handled = false;
let stopExpireListen: (() => void) | null = null;

function cancelExpire() {
  stopExpireListen?.();
  stopExpireListen = null;
}

export function markCalendarClickHandled() {
  handled = true;
  cancelExpire();
  if (typeof document === "undefined") return;
  // Callers mark from a mousedown, after this gesture's pointerdown has gone by.
  const onNextDown = () => {
    handled = false;
    cancelExpire();
  };
  document.addEventListener("pointerdown", onNextDown, true);
  stopExpireListen = () => document.removeEventListener("pointerdown", onNextDown, true);
}

export function consumeCalendarClickHandled(): boolean {
  const was = handled;
  handled = false;
  cancelExpire();
  return was;
}
