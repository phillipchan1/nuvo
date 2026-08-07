// A click that dismisses an open event/task/slot popover by landing on the
// calendar grid is ONE action (dismiss), not two (dismiss + create). But the
// popover's outside-click listener and FullCalendar's own click-to-create
// handling are independent systems reacting to the same physical click —
// stopping the mousedown event's propagation doesn't reliably stop
// FullCalendar's interaction plugin from also firing dateClick/select, since
// it may not depend on that propagation path at all.
//
// So instead of trying to win a timing/propagation race, the popover marks
// the click as "handled" when it dismisses; the calendar's create-on-click
// handlers consume that mark and bail before opening a new draft. Marking
// always happens on mousedown, strictly before the click/mouseup-driven
// dateClick/select completes for the same gesture, so ordering is safe
// regardless of FullCalendar's internal wiring.
let handled = false;

export function markCalendarClickHandled() {
  handled = true;
}

export function consumeCalendarClickHandled(): boolean {
  const was = handled;
  handled = false;
  return was;
}
