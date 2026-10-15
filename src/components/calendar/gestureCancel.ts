/**
 * Esc during a drag or resize calls it off (D-156, audit #32).
 *
 * FullCalendar has no cancel: once a block is in hand, letting go drops it. Esc
 * used to clear our drop feedback — the slot glow, the rail chip — while the
 * release still committed, and it nulled the rail's group as it went, so a
 * four-row drag that the user had *cancelled* landed as one task.
 *
 * So Esc doesn't end the gesture (we can't); it marks it, the cursor says
 * *Release to cancel*, and every drop handler asks `take()` before it writes —
 * reverting or removing FullCalendar's copy and writing nothing. The mark
 * outlives pointerup on purpose: FullCalendar's drop handlers run on the
 * mouseup that follows it. The next gesture's `begin()` clears a mark nothing
 * consumed (a release outside the grid fires no drop).
 *
 * While a gesture is live a hidden `[data-nested-surface]` sits in the body: the
 * drag owns the keyboard the way an open menu does, so the list keys and the
 * Schedule's letters stand down and Esc means only "cancel the drag".
 */

export interface GestureCancel {
  /** A drag or resize has started. A fresh gesture clears any unconsumed cancel;
   *  a repeat while live (a second layer noticing the same drag) changes nothing. */
  begin(): void;
  /** The pointer is up (or the gesture was abandoned). Keeps the cancel mark. */
  end(): void;
  /** Esc: true when this press is what cancelled a live gesture. */
  escape(): boolean;
  readonly live: boolean;
  readonly cancelled: boolean;
  /** A drop handler's question — was this gesture called off? Answers once. */
  take(): boolean;
  dispose(): void;
}

export function createGestureCancel(doc: Document = document): GestureCancel {
  let live = false;
  let cancelled = false;
  const mark = doc.createElement("div");
  mark.hidden = true;
  mark.setAttribute("data-nested-surface", "gesture");
  mark.setAttribute("aria-hidden", "true");
  return {
    begin() {
      // Two layers announce the same drag — the pointer watch at 5px, then
      // FullCalendar's eventDragStart — and an Esc can land between them. A
      // second start of a LIVE gesture is the same gesture: it keeps its cancel.
      if (!live) cancelled = false;
      live = true;
      if (!mark.isConnected) doc.body.appendChild(mark);
    },
    end() {
      live = false;
      mark.remove();
    },
    escape() {
      if (!live || cancelled) return false;
      cancelled = true;
      return true;
    },
    get live() {
      return live;
    },
    get cancelled() {
      return cancelled;
    },
    take() {
      const was = cancelled;
      cancelled = false;
      return was;
    },
    dispose() {
      live = false;
      cancelled = false;
      mark.remove();
    },
  };
}
