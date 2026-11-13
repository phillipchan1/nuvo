import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { useKeyboardInset } from "../../hooks/useKeyboardInset";
import { rubberBand, releaseVelocity, type VelocitySample } from "../../lib/gesture";
import { IconButton } from "../kit";
import { Icon } from "../Icon";

// A bottom sheet — the mobile equivalent of the desktop's anchored popovers and
// modals, and the one overlay shell on the phone (kit `Dialog` renders it too).
// A --raised panel with a 16px top corner and a 36×5 grab handle, over the
// --scrim (styles/phone.css, `ph-sheet`). Rises from the bottom edge and
// respects the home-indicator safe area. `tall` sheets (chat, task detail) take
// most of the screen; the default hugs its content.
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
  const drag = useRef<{ startY: number; engaged: boolean; samples: VelocitySample[] } | null>(null);
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

    // Accelerate away — the UIKit dismiss curve, not a symmetric ease.
    sheet.style.transition = "transform 0.28s cubic-bezier(0.4, 0, 1, 1)";
    sheet.style.transform = "translateY(110%)";

    if (scrim) {
      // The fade-in holds opacity with `fill: both`; an animated value beats an
      // inline one, so it has to let go before the fade-out can show.
      scrim.style.animation = "none";
      scrim.style.transition = "opacity 0.28s cubic-bezier(0.4, 0, 1, 1)";
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
    drag.current = { startY: e.clientY, engaged: !fromBody, samples: [{ y: e.clientY, t: e.timeStamp }] };
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
    const samples = drag.current.samples;
    samples.push({ y: e.clientY, t: e.timeStamp });
    if (samples.length > 6) samples.shift();
    // Down follows the finger 1:1; up resists (the sheet is already as tall as
    // it gets), the way a UISheetPresentationController rubber-bands.
    const down = delta >= 0 ? delta : -rubberBand(-delta, 60);
    sheetRef.current.style.animation = "none";
    sheetRef.current.style.transition = "none";
    sheetRef.current.style.transform = `translateY(${down}px)`;
    // Dim the scrim proportionally as the sheet moves away.
    if (scrimRef.current) {
      const height = sheetRef.current.offsetHeight || 400;
      const opacity = Math.max(0, 1 - Math.max(0, down) / height);
      scrimRef.current.style.animation = "none";
      scrimRef.current.style.transition = "none";
      scrimRef.current.style.opacity = String(opacity);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const engaged = drag.current.engaged;
    const delta = Math.max(0, e.clientY - drag.current.startY);
    const velocity = releaseVelocity(drag.current.samples); // px/ms, + = down
    drag.current = null;
    if (!engaged) return;

    // Distance OR a flick: past 30% of the sheet, or released moving down fast
    // enough (a short, quick swipe is a dismiss on iOS, not a snap-back).
    const threshold = sheetRef.current ? sheetRef.current.offsetHeight * 0.3 : 120;
    if (delta > threshold || (velocity > 0.5 && delta > 16)) {
      dismiss();
    } else {
      // Snap back on the spring.
      if (sheetRef.current) {
        sheetRef.current.style.transition = "transform var(--d-native) var(--ease-native)";
        sheetRef.current.style.transform = "translateY(0)";
      }
      if (scrimRef.current) {
        scrimRef.current.style.transition = "opacity var(--d-native) var(--ease-native)";
        scrimRef.current.style.opacity = "1";
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
    style: { touchAction: "none" as const },
  };

  // Scrim dismissal is a deliberate TAP: short travel, short duration. A drag
  // that merely starts on the scrim (or a finger resting there) must not close
  // the sheet. Mouse clicks keep the desktop-style instant dismiss.
  const scrimTouch = useRef<{ y: number; t: number } | null>(null);

  return createPortal(
    <div
      ref={scrimRef}
      className="ph-scrim"
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
        className={`ph-sheet sheet-up ${tall ? "sheet-h-tall" : "sheet-h-max"} pb-safe`}
        style={kbInset ? { paddingBottom: kbInset } : undefined}
      >
        {/* The grab handle — the primary swipe target, and the dialog's first
            child (the e2e flick test holds it there). Even a `tall` sheet sits
            below the notch already: the scrim above the 92dvh sheet leaves an
            8dvh gap that is always ≥ the real safe-area inset, so this needs
            only its own fixed pad. */}
        <div {...handleProps} className="ph-grab-zone">
          <span className="ph-grab" />
        </div>

        {title != null && (
          <div {...handleProps} className="ph-sheet-head">
            {/* The title owns the row's spare width, so a long one truncates
                instead of shoving ✕ off, and a title that lays its own content
                out absolutely (the record's crumb/name cross-fade) has a width
                to lay it out in. */}
            <div id={titleId} className="ph-sheet-title">
              {title}
            </div>
            {action != null && (
              // Opts out of drag-to-dismiss like every other control in this
              // row — the grab handle above still owns the gesture.
              <div onPointerDown={(e) => e.stopPropagation()} className="shrink-0">
                {action}
              </div>
            )}
            {/* Animated like a swipe away — the ✕ used to make the sheet
                vanish in one frame while every other way out slid it down. */}
            <IconButton
              label="Close"
              size="md"
              icon={<Icon name="close" size={18} />}
              onClick={dismiss}
              onPointerDown={(e) => e.stopPropagation()}
              className="tap-icon"
            />
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
