import { useRef, useState } from "react";

type ActionBag = Record<string, (...args: never[]) => unknown>;

/**
 * One identity, for the component's life, for a bag of actions that is rebuilt
 * on every render.
 *
 * `useTaskMutations()` and its siblings close over the query client, the undo
 * stack and a setting or two, and handed back a fresh object every render. That
 * object is a prop of `LeftRail` and `CalendarPane` — both `memo`'d — so every
 * render of the Planner re-rendered both, whatever had changed. Each method here
 * forwards to the latest render's version, so a call always sees current values
 * and the bag itself never changes.
 *
 * Every member must be a function: a value copied in once would freeze. The keys
 * are fixed at the first render.
 */
export function useStableActions<T extends ActionBag>(actions: T): T {
  const latest = useRef(actions);
  latest.current = actions;
  const [stable] = useState(() => {
    const out = {} as Record<string, unknown>;
    for (const key of Object.keys(actions)) {
      out[key] = (...args: never[]) => latest.current[key](...args);
    }
    return out as T;
  });
  return stable;
}
