/**
 * The keys a lit row answers, said faintly beside it — on every task list.
 *
 * The keymap was already one grammar everywhere (useTaskListKeys: a add, ⌘E
 * rename, e done, ⌫ delete…); only the Table *said* so, so the same keys sat
 * undiscovered in a record's list and the Schedule's rail. This is the one
 * place the hint and its learning live (D-220):
 *
 *   · `KeyHint`     — keycaps + a word each, on the lit row only, never under a
 *                     finger (`(hover: none)` hides it). Not a hint ROW: it rides
 *                     the row it describes, and goes once learned.
 *   · `useKeyHints` — one count for the whole app. Each act done by key counts;
 *                     at HINT_UNTIL the hints go everywhere at once (learning ⌘E
 *                     in a record teaches it in the rail). Display → Keyboard
 *                     hints, on the Table, turns them back on.
 */

import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Kbd } from "../kit";

const KEY = "nuvo.keyhints";
/** The Table kept its own count before the hints were shared. */
const OLD_KEY = "nuvo.table.hints";
export const HINT_UNTIL = 40;

/** What a lit task row says, wherever it is: how to add and how to edit. */
export const TASK_ROW_KEYS: (string | string[])[] = ["a", "add", "⌘E", "rename", "e", "done", "⌫", "delete"];

function read(): number {
  try {
    const n = Number(localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY) ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return HINT_UNTIL; // no storage (a private window): don't nag forever
  }
}
const listeners = new Set<() => void>();
let count = read();
function write(n: number) {
  count = n;
  try {
    localStorage.setItem(KEY, String(n));
  } catch {
    /* the session still learns */
  }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useKeyHints(): { on: boolean; learn: () => void; setOn: (on: boolean) => void } {
  const n = useSyncExternalStore(subscribe, () => count, () => HINT_UNTIL);
  const learn = useCallback(() => {
    if (count < HINT_UNTIL) write(count + 1);
  }, []);
  const setOn = useCallback((on: boolean) => write(on ? 0 : HINT_UNTIL), []);
  return { on: n < HINT_UNTIL, learn, setOn };
}

/** A row narrower than this can't carry the hint on its own line — the
 *  Schedule's rail, a slot's list: there it floats beside the row instead. */
const INLINE_MIN_WIDTH = 440;
const ROW = "[data-list-row], [data-task-drag], [data-head]";

/** Pairs of [keys, word]: `["a", "add", "⌘E", "rename"]`.
 *
 *  Inline on a wide row (the Table, a record's list). On a narrow one it would
 *  wrap and make the lit row taller — every row below jumping as the cursor
 *  walks — so there it floats just outside the row, a tooltip that never
 *  touches the layout. */
export function KeyHint({ keys }: { keys: (string | string[])[] }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [float, setFloat] = useState<{ left: number; top: number } | null>(null);

  // Measured once as the row lights (one read), then on scroll / resize only
  // while floating — the float must follow its row.
  useLayoutEffect(() => {
    const row = anchor.current?.closest<HTMLElement>(ROW);
    if (!row || row.getBoundingClientRect().width >= INLINE_MIN_WIDTH) return;
    const place = () => {
      const r = row.getBoundingClientRect();
      // beside the row, or tucked under it when the screen has no room right
      const room = window.innerWidth - r.right > 300;
      setFloat(room ? { left: r.right + 8, top: r.top + r.height / 2 } : { left: Math.max(8, r.right - 300), top: r.bottom + 14 });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, []);

  const pairs: [string | string[], string][] = [];
  for (let i = 0; i < keys.length; i += 2) pairs.push([keys[i], keys[i + 1] as string]);
  const body = pairs.map(([k, w], i) => (
    <span key={i}>
      <Kbd keys={k} />
      {w}
    </span>
  ));
  return (
    <>
      <span ref={anchor} className="key-hint-anchor" aria-hidden />
      {float ? (
        createPortal(
          <span className="key-hint key-hint-float" style={{ left: float.left, top: float.top }} aria-hidden>
            {body}
          </span>,
          document.body,
        )
      ) : (
        <span className="key-hint" aria-hidden>
          {body}
        </span>
      )}
    </>
  );
}
