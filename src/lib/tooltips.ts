// Native-style tooltips for every `title=` in the app, without touching the
// ~375 call sites.
//
// The browser's own title tooltip waits ~1s, can't be styled, and has no
// warm-up. A Mac app's tooltip waits ~500ms the FIRST time, then shows
// instantly as you slide along a toolbar, and goes cold again shortly after
// you leave. This layer gives every `title` exactly that:
//
//   • on hover, the element's `title` is lifted into `data-tip` (so the native
//     one never shows) and restored when the pointer leaves;
//   • the accessible name never regresses: an element whose only name WAS its
//     title gets it as `aria-label` for the duration (and back again after);
//   • it is installed only where the primary pointer can hover — a phone has
//     no hover and keeps nothing extra.

const DELAY_MS = 500;
const WARM_MS = 400;

let tipEl: HTMLDivElement | null = null;
let current: HTMLElement | null = null;
let showTimer: number | undefined;
let coldAt = 0;
let addedLabel = false;

function ensureTip(doc: Document): HTMLDivElement {
  if (tipEl && tipEl.isConnected) return tipEl;
  tipEl = doc.createElement("div");
  tipEl.className = "native-tooltip";
  tipEl.setAttribute("role", "tooltip");
  tipEl.setAttribute("aria-hidden", "true");
  doc.body.appendChild(tipEl);
  return tipEl;
}

/** Pure: where a tip of size (w,h) goes for an anchor rect inside a viewport. */
export function placeTip(
  anchor: { left: number; top: number; width: number; height: number },
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 6,
): { left: number; top: number } {
  let left = anchor.left + anchor.width / 2 - tip.width / 2;
  left = Math.max(6, Math.min(left, viewport.width - tip.width - 6));
  let top = anchor.top + anchor.height + gap;
  if (top + tip.height > viewport.height - 6) top = anchor.top - tip.height - gap;
  return { left, top: Math.max(6, top) };
}

function show(el: HTMLElement) {
  const text = el.dataset.tip;
  if (!text) return;
  const doc = el.ownerDocument;
  const tip = ensureTip(doc);
  tip.textContent = text;
  tip.style.left = "-9999px";
  tip.style.top = "-9999px";
  tip.classList.add("is-visible");
  const r = el.getBoundingClientRect();
  const pos = placeTip(r, { width: tip.offsetWidth, height: tip.offsetHeight }, { width: innerWidth, height: innerHeight });
  tip.style.left = `${pos.left}px`;
  tip.style.top = `${pos.top}px`;
}

function release(el: HTMLElement | null) {
  if (!el) return;
  const text = el.dataset.tip;
  if (text != null && !el.hasAttribute("title")) el.setAttribute("title", text);
  delete el.dataset.tip;
  if (addedLabel) el.removeAttribute("aria-label");
  addedLabel = false;
}

function hide() {
  window.clearTimeout(showTimer);
  if (tipEl?.classList.contains("is-visible")) {
    tipEl.classList.remove("is-visible");
    coldAt = Date.now() + WARM_MS;
  }
  release(current);
  current = null;
}

function adopt(el: HTMLElement) {
  const title = el.getAttribute("title");
  if (!title) return false;
  el.dataset.tip = title;
  el.removeAttribute("title");
  addedLabel = false;
  const hasName =
    el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") || (el.textContent ?? "").trim().length > 0;
  if (!hasName) {
    el.setAttribute("aria-label", title);
    addedLabel = true;
  }
  return true;
}

export function installTooltips(doc: Document = document): void {
  const win = doc.defaultView;
  if (!win || typeof win.matchMedia !== "function") return;
  if (!win.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

  doc.addEventListener(
    "pointerover",
    (e) => {
      if (e.pointerType && e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      const t = e.target as Element | null;
      const el = (t?.closest?.("[title], [data-tip]") as HTMLElement | null) ?? null;
      if (el === current) return;
      hide();
      if (!el || !(el instanceof HTMLElement)) return;
      if (!el.dataset.tip && !adopt(el)) return;
      current = el;
      const warm = Date.now() < coldAt;
      showTimer = win.setTimeout(() => current === el && show(el), warm ? 0 : DELAY_MS);
    },
    true,
  );
  doc.addEventListener(
    "pointerout",
    (e) => {
      if (!current) return;
      const to = e.relatedTarget as Node | null;
      if (to && current.contains(to)) return;
      hide();
    },
    true,
  );
  const cold = () => {
    hide();
    coldAt = 0;
  };
  doc.addEventListener("pointerdown", cold, true);
  doc.addEventListener("keydown", cold, true);
  doc.addEventListener("wheel", hide, { capture: true, passive: true });
  win.addEventListener("blur", cold);
}
