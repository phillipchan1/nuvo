// Long-press → the object's own menu, for the desktop shell under a finger.
//
// The desktop reaches a row's verbs by right-click (RecordContextMenu, the task
// row, the calendar, the decks — ~40 `onContextMenu` handlers). iPadOS WebKit
// never fires `contextmenu` for a finger, so on an iPad wearing the desktop
// shell (D-218) every one of those menus was unreachable. Rather than teach 40
// call sites a second gesture, this re-asks the SAME question: hold still for
// LONG_PRESS_MS and the element under the finger receives a `contextmenu`, so
// each surface's existing handler answers exactly as it does for a mouse.
//
// Touch and pen only — a mouse or trackpad already right-clicks. The press is
// dropped the moment the finger travels (a scroll or a drag) or the browser
// takes the gesture (pointercancel). After it fires, the click that the lift
// would otherwise produce is swallowed, so the menu isn't followed by "open".
//
// Installed by the desktop shell only. MobileShell has its own long-press
// (MobileRecordActions, useLongPressReorder) and must never get a second one.

export const LONG_PRESS_MS = 500;
const SLOP_PX = 8;

export function installTouchContextMenu(doc: Document = document): () => void {
  let timer: number | undefined;
  let startX = 0;
  let startY = 0;
  let pointerId: number | null = null;
  let swallowClick = false;

  const clear = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    pointerId = null;
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" || !e.isPrimary) return;
    clear();
    swallowClick = false;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    const target = e.target;
    timer = window.setTimeout(() => {
      timer = undefined;
      if (!(target instanceof Element) || !target.isConnected) return;
      const menu = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: startX,
        clientY: startY,
        screenX: startX,
        screenY: startY,
        button: 2,
        buttons: 0,
      });
      // Only a menu that something actually opened earns the swallowed click.
      // nativeFeel's document-level listener prevents default on bare chrome
      // too, so read the verdict one level earlier — at <html>, after React's
      // root listener has run and before the document's has.
      let opened = false;
      const html = doc.documentElement;
      const read = (ev: Event) => {
        if (ev === menu) opened = ev.defaultPrevented;
      };
      html.addEventListener("contextmenu", read);
      target.dispatchEvent(menu);
      html.removeEventListener("contextmenu", read);
      if (opened) {
        swallowClick = true;
        navigator.vibrate?.(10);
      }
    }, LONG_PRESS_MS);
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId || timer === undefined) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > SLOP_PX) clear();
  };

  const onEnd = (e: PointerEvent) => {
    if (e.pointerId === pointerId) clear();
  };

  const onClick = (e: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  };

  doc.addEventListener("pointerdown", onDown, { passive: true });
  doc.addEventListener("pointermove", onMove, { passive: true });
  doc.addEventListener("pointerup", onEnd, { passive: true });
  doc.addEventListener("pointercancel", onEnd, { passive: true });
  doc.addEventListener("click", onClick, true);
  return () => {
    clear();
    doc.removeEventListener("pointerdown", onDown);
    doc.removeEventListener("pointermove", onMove);
    doc.removeEventListener("pointerup", onEnd);
    doc.removeEventListener("pointercancel", onEnd);
    doc.removeEventListener("click", onClick, true);
  };
}
