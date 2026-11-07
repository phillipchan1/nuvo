// Esc cancels a drag — everywhere, the same way. A pointer drag in progress
// listens for Escape (capture, so no list or menu underneath also hears it),
// for the pointer being cancelled by the OS, and for the window losing focus
// (⌘Tab mid-drag). Any of those calls `onCancel`, which should end the drag
// WITHOUT writing: the item settles back where it started.
//
// Returns the disposer; call it from the drag's own `up`.

export function armDragCancel(onCancel: () => void, win: Window = window): () => void {
  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    dispose();
    onCancel();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    fire();
  };
  const dispose = () => {
    done = true;
    win.removeEventListener("keydown", onKey, true);
    win.removeEventListener("pointercancel", fire, true);
    win.removeEventListener("blur", fire);
  };
  win.addEventListener("keydown", onKey, true);
  win.addEventListener("pointercancel", fire, true);
  win.addEventListener("blur", fire);
  return dispose;
}
