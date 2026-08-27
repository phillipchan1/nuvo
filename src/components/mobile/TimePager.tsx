// Horizontal time travel for the mobile Calendar.
//
// Swipe left is later; swipe right is earlier. The leaving page exits the way
// you pushed it; the arriving page comes in from the other side. While the
// finger is down the current page follows it — a flick that just swapped pages
// was the jarring "show and hide" this exists to retire. The ‹ › buttons and
// the Today chip play the same settle, so tap and swipe agree about direction.
//
// Optional `peekPrev` / `peekNext` are the adjacent pages, parked off-screen
// so a drag reveals real content rather than empty paper. Month uses them
// (three grids are cheap). Day / Week / Year settle from a snapshot instead —
// their bodies are heavier, and the in+out is the thing that was missing.
//
// Reduced motion: the page just changes. No travel, no fade.
//
// The classifier lives in swipe.ts (edge guard, axis lock, scroll rejection).
// This file is only the motion.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { scrollParent } from "./dayPlan";
import {
  EDGE_GUARD_PX,
  endSwipe,
  lockAxis,
  shouldCommitPage,
  startSwipe,
  swipeOffset,
  trackSwipe,
  type SwipeTracker,
} from "./swipe";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Later is forward (swipe left). Keys must be ISO-sortable: `2026-08`, `2026-08-27`. */
export function timeDir(fromKey: string, toKey: string): "fwd" | "back" | null {
  if (fromKey === toKey) return null;
  return toKey > fromKey ? "fwd" : "back";
}

type Mode =
  | { t: "idle" }
  | { t: "swipe"; tx: number; settling?: boolean; commit?: "prev" | "next" }
  | { t: "swap"; leaving: ReactNode; leavingX: number; incomingX: number };

export default function TimePager({
  pageKey,
  onPrev,
  onNext,
  onFlickUp,
  peekPrev,
  peekNext,
  children,
  className,
}: {
  pageKey: string;
  onPrev: () => void;
  onNext: () => void;
  /** Month's "expand" — a deliberate upward flick opens the last drill-in lens. */
  onFlickUp?: () => void;
  peekPrev?: ReactNode;
  peekNext?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(0);
  const [width, setWidth] = useState(0);
  const [mode, setMode] = useState<Mode>({ t: "idle" });

  const pageKeyRef = useRef(pageKey);
  const childrenRef = useRef(children);
  const prevChildrenRef = useRef(children);
  childrenRef.current = children;

  const skipKeyAnim = useRef(false);
  const axisRef = useRef<"h" | "v" | null>(null);
  const touch = useRef<SwipeTracker | null>(null);
  const pointerId = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const paging = useRef(false);
  const reduce = prefersReducedMotion();

  const page = (dir: "prev" | "next") => {
    if (paging.current) return;
    paging.current = true;
    window.setTimeout(() => {
      paging.current = false;
    }, 400);
    if (dir === "next") onNext();
    else onPrev();
  };

  // A swipe that ends over the ‹ › buttons would otherwise also click them
  // and skip a page (August → October). Eat the trailing click.
  const swallowNextClick = () => {
    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("click", block, true);
    window.setTimeout(() => document.removeEventListener("click", block, true), 400);
  };

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      widthRef.current = w;
      setWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep a snapshot of the last settled children so an external page change
  // (‹ ›, Today, the date strip) has something to slide out.
  useEffect(() => {
    if (mode.t === "idle") prevChildrenRef.current = children;
  }, [children, mode.t]);

  // External pageKey change — play the same in+out the swipe does.
  useLayoutEffect(() => {
    const prev = pageKeyRef.current;
    if (prev === pageKey) return;
    const dir = timeDir(prev, pageKey);
    pageKeyRef.current = pageKey;
    if (skipKeyAnim.current) {
      skipKeyAnim.current = false;
      return;
    }
    if (!dir || reduce) {
      setMode({ t: "idle" });
      return;
    }
    const w = widthRef.current || rootRef.current?.clientWidth || 0;
    if (w <= 0) {
      setMode({ t: "idle" });
      return;
    }
    const incomingFrom = dir === "fwd" ? w : -w;
    setMode({
      t: "swap",
      leaving: prevChildrenRef.current,
      leavingX: 0,
      incomingX: incomingFrom,
    });
    const start = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setMode((m) =>
          m.t === "swap"
            ? { ...m, leavingX: dir === "fwd" ? -w : w, incomingX: 0 }
            : m,
        );
      });
    });
    return () => cancelAnimationFrame(start);
  }, [pageKey, reduce]);

  // Once we lock horizontal, native vertical scroll has to stop — `touch-action:
  // pan-y` does not cancel an in-flight gesture. The listener is non-passive
  // so preventDefault actually sticks (React's onTouchMove is passive).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (axisRef.current === "h") e.preventDefault();
    };
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, []);

  const finishSwipe = (tx: number, elapsed: number) => {
    const w = widthRef.current;
    const commit =
      !reduce && shouldCommitPage(tx, w, elapsed) ? (tx < 0 ? "next" : "prev") : null;

    if (!commit) {
      if (Math.abs(tx) < 2 || reduce) {
        setMode({ t: "idle" });
        return;
      }
      setMode({ t: "swipe", tx, settling: true });
      requestAnimationFrame(() => setMode({ t: "swipe", tx: 0, settling: true }));
      return;
    }

    const hasPeek = commit === "next" ? peekNext : peekPrev;
    if (hasPeek && w > 0) {
      const target = commit === "next" ? -w : w;
      swallowNextClick();
      setMode({ t: "swipe", tx, settling: true, commit });
      requestAnimationFrame(() => setMode({ t: "swipe", tx: target, settling: true, commit }));
      return;
    }

    // No adjacent page to reveal — snapshot the outgoing page from the finger's
    // offset and slide the incoming one into the gap. Same settle the ‹ ›
    // buttons play, just starting from wherever the drag ended.
    const dir = commit === "next" ? 1 : -1;
    const outgoing = childrenRef.current;
    skipKeyAnim.current = true;
    swallowNextClick();
    page(commit);
    setMode({
      t: "swap",
      leaving: outgoing,
      leavingX: tx,
      incomingX: tx + dir * (w || 0),
    });
    requestAnimationFrame(() => {
      setMode((m) =>
        m.t === "swap" ? { ...m, leavingX: -dir * (widthRef.current || w), incomingX: 0 } : m,
      );
    });
  };

  const settleNow = () => {
    setMode((m) => {
      if (m.t === "swipe" && m.settling) {
        if (m.commit) {
          skipKeyAnim.current = true;
          page(m.commit);
        }
        return { t: "idle" };
      }
      if (m.t === "swap") return { t: "idle" };
      return m;
    });
  };

  const onSettled = (e: React.TransitionEvent) => {
    if (e.target !== e.currentTarget) return;
    settleNow();
  };

  // transitionend is easy to miss (tab backgrounded, reduced-motion flip).
  // Don't leave the pager stuck mid-slide.
  useEffect(() => {
    if (!((mode.t === "swipe" && mode.settling) || mode.t === "swap")) return;
    const t = window.setTimeout(settleNow, 420);
    return () => window.clearTimeout(t);
  }, [mode]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (mode.t !== "idle" && !(mode.t === "swipe" && !mode.settling)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.clientX < EDGE_GUARD_PX) return;
    axisRef.current = null;
    touch.current = startSwipe(
      { touches: [{ clientX: e.clientX, clientY: e.clientY }] } as unknown as React.TouchEvent,
      scrollParent(rootRef.current),
    );
    pointerId.current = e.pointerId;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const tr = touch.current;
    if (!tr || pointerId.current !== e.pointerId) return;
    trackSwipe(tr);
    const { dx, dy } = swipeOffset(tr, e.clientX, e.clientY);
    if (!axisRef.current) axisRef.current = lockAxis(dx, dy);
    if (axisRef.current !== "h") return;
    if (tr.scrolled || tr.edge) return;
    // Capture only once the gesture is a page, so a vertical scroll is
    // still the scroller's — grabbing on pointerdown ate the Day lens.
    try {
      rootRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort — iOS is fine without it */
    }
    suppressClick.current = true;
    setMode({ t: "swipe", tx: dx });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId) return;
    pointerId.current = null;
    const tr = touch.current;
    touch.current = null;
    const axis = axisRef.current;
    axisRef.current = null;
    if (!tr) return;

    if (axis === "h") {
      const { dx } = swipeOffset(tr, e.clientX, e.clientY);
      finishSwipe(dx, Date.now() - tr.t);
      return;
    }

    // Vertical flick-up is Month's expand. Classified by the shared endSwipe
    // so it stays fast, axis-dominant, and never a page scroll.
    if (onFlickUp) {
      const dir = endSwipe(tr, {
        changedTouches: [{ clientX: e.clientX, clientY: e.clientY }],
      } as unknown as React.TouchEvent);
      if (dir === "up") onFlickUp();
    }

    if (mode.t === "swipe" && !mode.settling) setMode({ t: "idle" });
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const settling = (mode.t === "swipe" && mode.settling) || mode.t === "swap";
  const layer = (extra?: string) =>
    `time-pager-layer ${settling ? "is-settling" : ""} ${extra ?? ""}`;

  const tx = mode.t === "swipe" ? mode.tx : 0;
  const peek = (mode.t === "swipe" || mode.t === "idle") && width > 0;

  return (
    <div
      ref={rootRef}
      className={`time-pager touch-pan-y ${className ?? ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={onClickCapture}
    >
      {mode.t === "swap" && (
        <div
          className={layer("is-aside")}
          style={{ transform: `translateX(${mode.leavingX}px)` }}
          onTransitionEnd={onSettled}
          aria-hidden
        >
          {mode.leaving}
        </div>
      )}

      {peek && peekPrev && mode.t === "swipe" && (
        <div
          className={layer("is-aside")}
          style={{ transform: `translateX(${tx - width}px)` }}
          aria-hidden
        >
          {peekPrev}
        </div>
      )}

      <div
        className={layer()}
        style={{
          transform:
            mode.t === "swap"
              ? `translateX(${mode.incomingX}px)`
              : mode.t === "swipe"
                ? `translateX(${tx}px)`
                : undefined,
        }}
        onTransitionEnd={mode.t === "swap" || (mode.t === "swipe" && mode.settling) ? onSettled : undefined}
      >
        {children}
      </div>

      {peek && peekNext && mode.t === "swipe" && (
        <div
          className={layer("is-aside")}
          style={{ transform: `translateX(${tx + width}px)` }}
          aria-hidden
        >
          {peekNext}
        </div>
      )}
    </div>
  );
}
