// The JS half of the web-isms reset (the CSS half is src/styles/native.css).
//
// Three things CSS cannot do on its own, installed once from main.tsx before
// React mounts:
//
//  1. `:active` on touch. WebKit only matches `:active` during a touch when a
//     touchstart listener exists somewhere up the tree; without one, every press
//     state in native.css is dead on an iPhone. One passive no-op listener on the
//     document turns them all on and costs nothing (it never blocks scrolling).
//
//  2. The browser's context menu on app objects. Right-clicking a row in a Mac
//     app never offers "Reload" or "Inspect Element", and long-pressing a control
//     on iOS never offers "Copy". Any object that has a menu of its own already
//     calls preventDefault (RecordContextMenu, the task row, the calendar), so
//     this only catches what is LEFT: the browser's menu survives where it is
//     genuinely useful — editable fields, real links, selected text, anything
//     marked `data-selectable` — and ⇧-right-click always gets it (an escape
//     hatch for "Inspect" while developing).
//
//  3. Spellcheck only on long-form text. A one-line field (a title, a time, a
//     search) underlined in red is the browser grading you; the app's notes and
//     descriptions (textareas, contenteditable) keep it. Applied on focus, and
//     only when the element did not choose for itself.
//
// Nothing here changes what an action does — only that the browser stays out of
// the way of it.

import { installTooltips } from "./tooltips";

let installed = false;

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const h = el as HTMLElement;
  if (h.isContentEditable) return true;
  const tag = h.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (h as HTMLInputElement).type;
    return !["button", "submit", "reset", "checkbox", "radio", "range", "color"].includes(type);
  }
  return false;
}

/** True when the browser's own context menu is the useful one here. */
export function wantsBrowserMenu(target: EventTarget | null, opts: { shiftKey?: boolean } = {}): boolean {
  if (opts.shiftKey) return true;
  const el = target instanceof Element ? target : (target as Node | null)?.parentElement ?? null;
  if (!el) return false;
  if (isEditable(el)) return true;
  if (el.closest("a[href], [data-selectable], [contenteditable='true'], [contenteditable='plaintext-only']")) return true;
  // Right-clicking text you have selected should offer Copy / Look Up.
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    if (range.intersectsNode(el)) return true;
  }
  return false;
}

export function installNativeFeel(doc: Document = document): void {
  if (installed) return;
  installed = true;

  // 1. Enable :active under touch.
  doc.addEventListener("touchstart", () => {}, { passive: true });

  // 2. Swallow the browser's context menu on app chrome. Bubble phase, so any
  //    component's own onContextMenu has already run (and already prevented).
  doc.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented) return;
    if (wantsBrowserMenu(e.target, { shiftKey: e.shiftKey })) return;
    e.preventDefault();
  });

  // 3. Spellcheck: on for long-form, off for one-line fields — unless chosen.
  doc.addEventListener(
    "focusin",
    (e) => {
      const el = e.target as HTMLElement | null;
      if (!el || el.hasAttribute("spellcheck")) return;
      if (el.tagName === "INPUT") el.setAttribute("spellcheck", "false");
    },
    true,
  );

  // 4. Key window vs. background window. macOS greys a selection when its
  //    window isn't key (accent → gray); the CSS reads this class.
  const win = doc.defaultView;
  if (win) {
    const sync = () => doc.documentElement.classList.toggle("window-inactive", !doc.hasFocus());
    win.addEventListener("focus", sync);
    win.addEventListener("blur", sync);
    sync();
  }

  // 5. Tooltips: every `title` waits 500ms, then warms up (lib/tooltips).
  installTooltips(doc);

  // Images and SVGs never start an HTML5 drag (a ghost "file" of the icon).
  // CSS `-webkit-user-drag` covers WebKit; this covers Chromium/Firefox.
  doc.addEventListener("dragstart", (e) => {
    const t = e.target as Element | null;
    if (t && (t.tagName === "IMG" || t.tagName === "svg" || t.tagName === "SVG")) e.preventDefault();
  });
}
