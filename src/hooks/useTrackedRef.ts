import { useMemo, useState, type MutableRefObject } from "react";

/**
 * A ref object that also reports WHICH element it holds, as state.
 *
 * The Schedule's rail is one `railRef` shared by two components — `LeftRail`
 * and, while Plan the week is open, `PlanRail` — so the element behind it is
 * replaced every time the flow opens or closes. An effect that binds to
 * `ref.current` once (FullCalendar's rail `Draggable`) keeps holding the
 * detached element afterwards: Today and Inbox rows stop dragging onto the
 * calendar until a reload. Pass the returned `el` to that effect's deps and it
 * re-binds to whichever rail is mounted.
 */
export function useTrackedRef<T extends HTMLElement>(): [MutableRefObject<T | null>, T | null] {
  const [el, setEl] = useState<T | null>(null);
  const ref = useMemo(() => {
    let node: T | null = null;
    return {
      get current() {
        return node;
      },
      set current(next: T | null) {
        if (next === node) return;
        node = next;
        setEl(next);
      },
    } as MutableRefObject<T | null>;
  }, []);
  return [ref, el];
}
