import { useEffect, useRef } from "react";

// History-backed mobile overlays. Every sheet/overlay in MobileShell is plain
// useState, so Android hardware-back and the iOS standalone back-swipe used to
// exit the app instead of closing the sheet. These hooks give each open overlay
// a browser-history entry: back closes exactly that overlay, and only the root
// tab leaves the app. History is an *observer* of the open state, never the
// source of truth — closes still run through the overlay's own onClose.
//
// Entry payloads are `{ nuvoOverlay: key }` (plus a frame depth for stacked
// sheets). They deliberately carry none of AppNavigationProvider's keys, so the
// desktop nav's popstate handler treats them as unknown entries and no-ops (its
// stack index never moves on mobile).

/** True when a history entry belongs to a mobile overlay. */
function isOverlayState(s: unknown): s is { nuvoOverlay: string; d?: number } {
  return typeof (s as { nuvoOverlay?: unknown } | null)?.nuvoOverlay === "string";
}

// ── Consume coordination ────────────────────────────────────────────────────
// Closing an overlay programmatically must consume its history entry — but a
// bare history.back() in an effect cleanup races with a pushState from an
// overlay opening in the same commit (close A → open B chains, and StrictMode's
// dev double-mount): the queued back() would pop B's fresh entry instead of
// A's. This is the same pop-race documented in useAppNavigation's closeFlow.
// So cleanup only *schedules* the consume; if another overlay pushes within the
// same tick it claims the slot and replaces A's entry instead, and no back()
// fires at all. React runs all effect cleanups before any effect creates, so
// the ordering is deterministic.
let pendingConsume = 0;
let consumeTimer: number | undefined;

function scheduleConsume(n: number) {
  pendingConsume += n;
  if (consumeTimer !== undefined) window.clearTimeout(consumeTimer);
  consumeTimer = window.setTimeout(() => {
    consumeTimer = undefined;
    const steps = pendingConsume;
    pendingConsume = 0;
    if (steps > 0) history.go(-steps);
  }, 0);
}

/** An opening overlay claims one scheduled consume: its push becomes a replace. */
function claimReplace(): boolean {
  if (pendingConsume <= 0) return false;
  pendingConsume -= 1;
  return true;
}

/**
 * Back a single boolean overlay with a history entry.
 *
 * On open, pushes `{ nuvoOverlay: key }`. A popstate that lands on any entry
 * that isn't ours (the tab entry beneath, or a lower overlay's) closes the
 * overlay — this also does the right thing under a multi-step back. Closing
 * through the UI consumes the entry via the scheduler above.
 */
export function useMobileOverlayHistory(isOpen: boolean, onClose: () => void, key: string) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    let closedByPop = false;
    if (claimReplace()) history.replaceState({ nuvoOverlay: key }, "");
    else history.pushState({ nuvoOverlay: key }, "");

    const onPop = (e: PopStateEvent) => {
      // Landing back ON our own entry means something above us popped — not a
      // request to close us.
      if (isOverlayState(e.state) && e.state.nuvoOverlay === key) return;
      closedByPop = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Programmatic close with our entry still on top → consume it. If another
      // overlay is above us (out-of-order close) we leave the entry be rather
      // than pop the wrong one.
      if (!closedByPop && isOverlayState(history.state) && history.state.nuvoOverlay === key) {
        scheduleConsume(1);
      }
    };
  }, [isOpen, key]);
}

/**
 * Back a sheet with an internal breadcrumb stack (MobileDetailSheet): one base
 * entry for the sheet plus one entry per pushed frame, so hardware back pops
 * one frame at a time before the sheet itself closes.
 *
 * `depth` = frames above the root (stack.length - 1). Frame pushes flow
 * state → history; frame pops flow history → state (the breadcrumb ‹ button
 * should call history.back(), not mutate the stack). `onPopTo(d)` must slice
 * the stack to d + 1 entries.
 */
export function useMobileSheetStackHistory(
  depth: number,
  onPopTo: (depth: number) => void,
  onClose: () => void,
  key: string,
) {
  const cbs = useRef({ onPopTo, onClose });
  cbs.current = { onPopTo, onClose };
  // The depth history currently holds; -1 until the base entry exists.
  const histDepth = useRef(-1);
  const closedByPop = useRef(false);

  useEffect(() => {
    closedByPop.current = false;
    if (claimReplace()) history.replaceState({ nuvoOverlay: key, d: 0 }, "");
    else history.pushState({ nuvoOverlay: key, d: 0 }, "");
    histDepth.current = 0;

    const onPop = (e: PopStateEvent) => {
      const s = e.state;
      if (isOverlayState(s) && s.nuvoOverlay === key) {
        // Landed on one of our own entries — pop breadcrumb frames down to it.
        const d = typeof s.d === "number" ? s.d : 0;
        histDepth.current = d;
        cbs.current.onPopTo(d);
      } else {
        // Landed beneath the base entry — the sheet itself closes.
        histDepth.current = -1;
        closedByPop.current = true;
        cbs.current.onClose();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (
        !closedByPop.current &&
        histDepth.current >= 0 &&
        isOverlayState(history.state) &&
        history.state.nuvoOverlay === key
      ) {
        // Swipe-down / ✕ with frames still stacked: consume base + all frames.
        scheduleConsume(histDepth.current + 1);
        histDepth.current = -1;
      }
    };
  }, [key]);

  // State → history sync for frame pushes (and programmatic stack resets, e.g.
  // a fresh search jump re-rooting the stack while the sheet stays open).
  useEffect(() => {
    if (histDepth.current < 0) return;
    if (depth > histDepth.current) {
      for (let d = histDepth.current + 1; d <= depth; d++) {
        history.pushState({ nuvoOverlay: key, d }, "");
      }
      histDepth.current = depth;
    } else if (depth < histDepth.current) {
      history.go(depth - histDepth.current); // popstate re-syncs histDepth
    }
  }, [depth, key]);
}
