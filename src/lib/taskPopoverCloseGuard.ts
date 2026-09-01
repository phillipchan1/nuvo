// TaskPopover's outside-click close and its Escape close both call the same
// onClose() — but only a genuine "clicked away" should release the rail's
// keyboard-cursor selection (LeftRail's selectedId, the glass-lift highlight).
// Escape (and the popover's own ✕) are meant to leave you where you were so
// arrow-key list navigation keeps working from the row you had open.
//
// This has to be a direct synchronous callback, not a flag consumed from a
// `nav`-keyed useEffect: nav only settles after the whole downstream tree
// (the popover unmounting, the calendar re-rendering) reconciles and paints,
// and a passive effect fires after THAT — a ~50-70ms hop that read as a
// stuck-then-snapping row. Calling straight into LeftRail's setState, in the
// same mousedown handler that starts the close, updates in the same render
// pass as everything else that gesture triggers.
type Listener = (taskId: string) => void;
let listener: Listener | null = null;

/** LeftRail subscribes once on mount. Returns the unsubscribe function. */
export function onPopoverBlurClose(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function notifyPopoverBlurClose(taskId: string) {
  listener?.(taskId);
}
