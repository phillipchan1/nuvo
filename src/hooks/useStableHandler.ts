import { useCallback, useRef } from "react";

/**
 * A callback whose *identity* never changes but whose *body* is always the
 * latest render's.
 *
 * This exists for one reason: `@fullcalendar/react` does no prop diffing. Its
 * `componentDidUpdate` calls `calendar.resetOptions(this.props)` unconditionally,
 * which dispatches an internal action and re-runs the whole sizing pass —
 * `SimpleScrollGrid.handleSizing` → `computeShrinkWidth`, `TimeColsSlats.updateSizing`,
 * `TableRow.querySegHeights`. Measured on the week grid that is ~11,000
 * `getBoundingClientRect()` calls per re-render. So *any* React re-render of
 * `<FullCalendar>` costs a full grid re-measure, whether or not a prop changed.
 *
 * The defence is to render the element as rarely as possible (see the
 * `calendarElement` memo in CalendarPane), which is only safe if every handler
 * handed to it is identity-stable. Inline arrows and `useCallback`s with live
 * deps would re-create the element on every keystroke.
 *
 * Same contract as the React `useEffectEvent` proposal: safe in effects and event
 * handlers, never call it during render.
 */
export function useStableHandler<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}
