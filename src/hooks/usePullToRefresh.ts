import { useEffect, useRef, useState, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";

// Pull-to-refresh for the mobile lists. The shell's `overscroll-behavior:
// contain` + fixed layout means the platform gesture doesn't exist at all, so
// this reintroduces it: pull down ≥ PULL_PX from a scroller's very top →
// spinner + queryClient.invalidateQueries().
//
// `scrollerSelector` supports surfaces whose real scroller is a descendant of
// the element the listeners sit on (the deck's per-page scrollers under one
// pager): the touch's nearest matching ancestor is the scroller consulted for
// "am I at the top".

const PULL_PX = 70;

export function usePullToRefresh(
  ref: RefObject<HTMLElement | null>,
  scrollerSelector?: string,
): { pulling: number; refreshing: boolean } {
  const queryClient = useQueryClient();
  const [pulling, setPulling] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;

    let startY = 0;
    let scroller: HTMLElement | null = null;

    const scrollerFor = (target: EventTarget | null): HTMLElement =>
      (scrollerSelector && target instanceof Element
        ? target.closest<HTMLElement>(scrollerSelector)
        : null) ?? host;

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      scroller = scrollerFor(e.target);
      if (scroller.scrollTop > 0) {
        scroller = null;
        return;
      }
      startY = e.touches[0]?.clientY ?? 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!scroller) return;
      if (scroller.scrollTop > 0) {
        scroller = null;
        setPulling(0);
        return;
      }
      const dy = (e.touches[0]?.clientY ?? 0) - startY;
      setPulling(Math.max(0, Math.min(1, dy / PULL_PX)));
    };
    const onEnd = () => {
      if (!scroller) return;
      scroller = null;
      setPulling((p) => {
        if (p >= 1 && !refreshingRef.current) {
          refreshingRef.current = true;
          setRefreshing(true);
          void queryClient.invalidateQueries().finally(() => {
            refreshingRef.current = false;
            setRefreshing(false);
          });
        }
        return 0;
      });
    };

    host.addEventListener("touchstart", onStart, { passive: true });
    host.addEventListener("touchmove", onMove, { passive: true });
    host.addEventListener("touchend", onEnd, { passive: true });
    host.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      host.removeEventListener("touchstart", onStart);
      host.removeEventListener("touchmove", onMove);
      host.removeEventListener("touchend", onEnd);
      host.removeEventListener("touchcancel", onEnd);
    };
  }, [ref, scrollerSelector, queryClient]);

  return { pulling, refreshing };
}
