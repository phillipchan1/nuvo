import { useRef, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Reliable tap binding for iPad / iOS WKWebView.
 *
 * iPadOS synthesizes mouseenter → mousedown → mouseleave around a tap. If those
 * handlers setState, React replaces the node and the subsequent `click` is
 * dropped — the control looks dead (ASC 2.1(a) on Dayspring). Firing on
 * pointerdown for touch/pen (before the mouse dance) and on click for
 * mouse/keyboard avoids that. The ref survives the re-render that the action
 * itself may trigger, so click does not double-fire.
 */
export function useTapAction(action: () => void, enabled = true) {
  const handledByPointer = useRef(false);
  const actionRef = useRef(action);
  actionRef.current = action;

  return {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0) return;
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      handledByPointer.current = true;
      actionRef.current();
    },
    onClick: () => {
      if (!enabled) return;
      if (handledByPointer.current) {
        handledByPointer.current = false;
        return;
      }
      actionRef.current();
    },
  };
}

/** True when the operator dismissed an OAuth / Apple sheet. */
export function isOAuthCanceled(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /cancel|canceled|cancelled|error 1\.|error 1\)|ASWebAuthenticationSessionError/i.test(
    msg,
  );
}
