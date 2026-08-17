import { useCallback, useRef, useState } from "react";

/**
 * Press-and-hold reordering for a single vertical list on a phone — the touch
 * twin of `useListReorder` (desktop, pointer-drag from a grip). A phone has
 * no hover to gate a drag affordance behind, and a bare touchstart-then-move
 * would hijack the list's own scroll, so the gesture borrows MobileDeck's
 * timing exactly (`startPress`): hold still past `LONG_PRESS_MS` and it arms;
 * move more than `CANCEL_PX` before that and it was a scroll, not a hold.
 * Scroll stays untouched until the hold actually fires.
 */

const LONG_PRESS_MS = 450;
const CANCEL_PX = 14;
/** Matches `useListReorder`'s BAND_SLACK — how far past the list's ends still
 *  counts as aiming at it. */
const EDGE_SLACK = 22;

export interface LongPressReorderOptions {
  /** The list element rows are queried within. Must be a positioned ancestor
   *  for the insertion line. */
  containerRef: React.MutableRefObject<HTMLElement | null>;
  /** Selector matching one row, e.g. `[data-task-id]`. */
  itemSelector: string;
  /** Attribute on the row element holding its id. */
  idAttr: string;
  /** The list's ids in render order, read fresh at drop time. */
  ids: () => string[];
  /** Commit the new id order. */
  onCommit: (ids: string[]) => void;
  disabled?: boolean;
}

export function useLongPressReorder({
  containerRef,
  itemSelector,
  idAttr,
  ids,
  onCommit,
  disabled,
}: LongPressReorderOptions) {
  const [armingId, setArmingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [lineTop, setLineTop] = useState<number | null>(null);

  const opts = useRef({ ids, onCommit });
  opts.current = { ids, onCommit };

  const press = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (disabled) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const origin = { x: e.clientX, y: e.clientY };
      let held = false;
      let cancelled = false;
      let targetIndex = 0;
      let lastY = e.clientY;
      let raf = 0;

      const blockScroll = (ev: TouchEvent) => ev.preventDefault();

      const insertLineTop = (clientY: number) => {
        const list = containerRef.current;
        if (!list) return null;
        const rows = [...list.querySelectorAll<HTMLElement>(itemSelector)].filter(
          (r) => r.getAttribute(idAttr) !== id,
        );
        if (!rows.length) return 0;
        const first = rows[0].getBoundingClientRect();
        const last = rows[rows.length - 1].getBoundingClientRect();
        if (clientY < first.top - EDGE_SLACK || clientY > last.bottom + EDGE_SLACK) return null;
        let k = 0;
        for (const r of rows) {
          const b = r.getBoundingClientRect();
          if (clientY > b.top + b.height / 2) k++;
        }
        targetIndex = k;
        const listTop = list.getBoundingClientRect().top;
        const edge = k < rows.length ? rows[k].getBoundingClientRect().top : last.bottom;
        return edge - listTop + list.scrollTop;
      };

      const end = () => {
        window.clearTimeout(timer);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        window.removeEventListener("touchmove", blockScroll);
        document.body.classList.remove("wb-noselect");
        setArmingId(null);
      };

      const flush = () => {
        raf = 0;
        setLineTop(insertLineTop(lastY));
      };

      const move = (ev: PointerEvent) => {
        if (!held) {
          if (Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) > CANCEL_PX) {
            cancelled = true;
            end();
          }
          return;
        }
        lastY = ev.clientY;
        if (!raf) raf = requestAnimationFrame(flush);
      };

      const up = () => {
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        if (held) setLineTop(insertLineTop(lastY));
        end();
        if (held) {
          const current = opts.current.ids();
          const from = current.indexOf(id);
          if (from !== -1) {
            const next = current.filter((x) => x !== id);
            next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, id);
            if (next.some((x, i) => x !== current[i])) {
              navigator.vibrate?.(12);
              opts.current.onCommit(next);
            }
          }
        }
        setDraggingId(null);
        setLineTop(null);
      };

      const timer = window.setTimeout(() => {
        if (cancelled) return;
        held = true;
        document.body.classList.add("wb-noselect");
        window.addEventListener("touchmove", blockScroll, { passive: false });
        navigator.vibrate?.(8);
        setArmingId(null);
        setDraggingId(id);
      }, LONG_PRESS_MS);

      setArmingId(id);
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [containerRef, itemSelector, idAttr, disabled],
  );

  return { armingId, draggingId, lineTop, press };
}
