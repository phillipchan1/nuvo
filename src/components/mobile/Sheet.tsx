import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { useKeyboardInset } from "../../hooks/useKeyboardInset";

// A bottom sheet — the mobile equivalent of the desktop's anchored popovers and
// modals. Rises from the bottom edge, dims the world behind it, and respects the
// home-indicator safe area. `tall` sheets (chat, task detail) take most of the
// screen; the default hugs its content.
//
// Dismissal: swipe down anywhere on the panel (engages only when the inner
// scroller is at its top and the gesture is downward), or a deliberate tap on
// the scrim (< 10px travel, < 400ms — a drag that merely starts on the scrim
// must not dismiss), or the ✕ / Escape.

// While any sheet is open the page behind must not scroll. body{overflow:hidden}
// is a no-op here (the app's scroller is <main>, not body), so a body class
// freezes the real scrollers via CSS, with a counter so nested sheets restore
// correctly when the top one closes.
let openSheets = 0;
function lockBackground() {
  openSheets += 1;
  document.body.classList.add("sheet-open");
}
function unlockBackground() {
  openSheets = Math.max(0, openSheets - 1);
  if (openSheets === 0) document.body.classList.remove("sheet-open");
}

export default function Sheet({
  onClose,
  children,
  title,
  action,
  tall = false,
  contentClassName = "",
  onContentScroll,
}: {
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  /** A trailing control in the title row, left of ✕ — the record's ⋯ overflow.
   *  Rendered only when there IS a title row. */
  action?: ReactNode;
  tall?: boolean;
  contentClassName?: string;
  /** so a sheet can react to its own scroll — the record uses it to fade its
   *  name into the title row only once the hero has left the screen. */
  onContentScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; engaged: boolean } | null>(null);
  // iOS never resizes the layout viewport for the keyboard, so a fixed sheet's
  // lower content (composer, submit button) would sit under the keys without
  // this pad.
  const kbInset = useKeyboardInset();
  const titleId = useId();
  // Dialog semantics: focus moves in on open, Tab stays inside, and the
  // trigger gets focus back on close.
  useDialogFocus(sheetRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    lockBackground();
    return () => {
      window.removeEventListener("keydown", onKey, true);
      unlockBackground();
    };
  }, [onClose]);

  const dismiss = () => {
    const sheet = sheetRef.current;
    const scrim = scrimRef.current;
    if (!sheet) { onClose(); return; }

    // Clear the sheet-up CSS animation so it doesn't block the transition —
    // animated props have higher precedence than transitioned props in the cascade.
    sheet.style.animation = "none";
    // Force a reflow so the browser records the current position as the
    // transition start state before we update transform.
    sheet.getBoundingClientRect();

    sheet.style.transition = "transform 0.28s ease-in";
    sheet.style.transform = "translateY(110%)";

    if (scrim) {
      scrim.style.transition = "opacity 0.28s ease-in";
      scrim.style.opacity = "0";
    }

    setTimeout(onClose, 280);
  };

  // ── swipe-down anywhere on the panel ─────────────────────────────────────
  // The handle and title row always drag. The body drags too, but only engages
  // once the inner scroller is at its very top AND the gesture moves downward —
  // otherwise the touch belongs to the content (scrolling up, or scrolling back
  // down a scrolled list).
  const scrollerAtTop = () => {
    const panel = contentRef.current;
    if (!panel) return true;
    const scroller = panel.querySelector<HTMLElement>("[class*='overflow-y-auto']") ?? panel;
    return scroller.scrollTop <= 0;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, fromBody: boolean) => {
    if (fromBody && !scrollerAtTop()) return;
    drag.current = { startY: e.clientY, engaged: !fromBody };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !sheetRef.current) return;
    const delta = e.clientY - drag.current.startY;
    if (!drag.current.engaged) {
      // A body drag engages only once it is clearly downward; an upward or
      // horizontal move hands the touch back to the content.
      if (delta > 8 && scrollerAtTop()) {
        drag.current.engaged = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      } else if (delta < -4) {
        drag.current = null;
        return;
      } else {
        return;
      }
    }
    const down = Math.max(0, delta);
    sheetRef.current.style.animation = "none";
    sheetRef.current.style.transition = "none";
    sheetRef.current.style.transform = `translateY(${down}px)`;
    // Dim the scrim proportionally as the sheet moves away.
    if (scrimRef.current) {
      const height = sheetRef.current.offsetHeight || 400;
      const opacity = Math.max(0, 0.4 * (1 - down / height));
      scrimRef.current.style.opacity = String(opacity);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const engaged = drag.current.engaged;
    const delta = Math.max(0, e.clientY - drag.current.startY);
    drag.current = null;
    if (!engaged) return;

    const threshold = sheetRef.current ? sheetRef.current.offsetHeight * 0.3 : 120;
    if (delta > threshold) {
      dismiss();
    } else {
      // Snap back.
      if (sheetRef.current) {
        sheetRef.current.style.transition = "transform 0.22s ease-out";
        sheetRef.current.style.transform = "translateY(0)";
      }
      if (scrimRef.current) {
        scrimRef.current.style.transition = "opacity 0.22s ease-out";
        scrimRef.current.style.opacity = "0.4";
      }
    }
  };

  const handleProps = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      onPointerDown(e, false);
    },
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    style: { touchAction: "none" as const, cursor: "grab" as const },
  };

  // Scrim dismissal is a deliberate TAP: short travel, short duration. A drag
  // that merely starts on the scrim (or a finger resting there) must not close
  // the sheet. Mouse clicks keep the desktop-style instant dismiss.
  const scrimTouch = useRef<{ y: number; t: number } | null>(null);

  return createPortal(
    <div
      ref={scrimRef}
      className="scrim fixed inset-0 z-[60] flex flex-col justify-end bg-black/40 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        // Suppress the synthetic mousedown that follows a touch (touchend
        // handles those); real mouse clicks dismiss immediately.
        if (scrimTouch.current) return;
        if (e.target === e.currentTarget) dismiss();
      }}
      onTouchStart={(e) => {
        if (e.target === e.currentTarget) {
          const t = e.touches[0];
          scrimTouch.current = t ? { y: t.clientY, t: Date.now() } : null;
        }
      }}
      onTouchEnd={(e) => {
        const start = scrimTouch.current;
        scrimTouch.current = null;
        if (!start || e.target !== e.currentTarget) return;
        const t = e.changedTouches[0];
        const moved = Math.abs((t?.clientY ?? start.y) - start.y);
        if (moved < 10 && Date.now() - start.t < 400) dismiss();
      }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title != null ? titleId : undefined}
        tabIndex={-1}
        // dvh, not vh: with iOS Safari's toolbars shown, 100vh is taller than
        // the visible viewport, so a vh-sized sheet ran off the bottom. The vh
        // pair stays first as the fallback for engines without dvh.
        className={`sheet-up glass flex ${
          tall ? "sheet-h-tall" : "sheet-h-max"
        } flex-col rounded-t-2xl border-t border-line pb-safe outline-none`}
        style={kbInset ? { paddingBottom: kbInset } : undefined}
      >
        {/* Grab pill — primary swipe target. A `tall` sheet's safe-area inset
            (the notch/Dynamic-Island clearance) lives HERE, as this div's own
            padding, not as dead space on the outer container above it — that
            padding is still part of this element's hit area, so the whole
            gap stays swipe-to-dismiss-able instead of a dead zone a thumb
            naturally lands in first. `max()` keeps a floor on devices with
            no safe-area-inset (Android, older iPhones). */}
        <div
          {...handleProps}
          className="flex shrink-0 flex-col items-center pb-2.5"
          style={{
            ...handleProps.style,
            paddingTop: tall ? "max(env(safe-area-inset-top, 0px), 0.625rem)" : "0.625rem",
          }}
        >
          <span className="h-1 w-9 rounded-full bg-line-strong" />
        </div>

        {title != null && (
          <div
            {...handleProps}
            className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2"
          >
            {/* min-w-0 flex-1: the title owns the row's spare width, so a long
                one truncates instead of shoving ✕ off, and a title that lays
                its own content out absolutely (the record's crumb/name
                cross-fade) has a width to lay it out in. */}
            <div id={titleId} className="min-w-0 flex-1 text-head font-semibold tracking-tight select-none">{title}</div>
            {action != null && (
              // Opts out of drag-to-dismiss like every other control in this
              // row — the grab pill above still owns the gesture.
              <div onPointerDown={(e) => e.stopPropagation()} className="shrink-0">
                {action}
              </div>
            )}
            <button
              onClick={onClose}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Close"
              className="tap-icon fast -mr-1 flex h-8 w-8 items-center justify-center rounded-full text-lead text-muted hover:bg-bg hover:text-ink"
              style={{ cursor: "default" }}
            >
              ✕
            </button>
          </div>
        )}

        {/* The body: swipe-down dismiss engages only from the scroller's top. */}
        <div
          ref={contentRef}
          className={`min-h-0 flex-1 ${contentClassName}`}
          onScroll={onContentScroll}
          onPointerDown={(e) => onPointerDown(e, true)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >

          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
