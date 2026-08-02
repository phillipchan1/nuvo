import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

// A bottom sheet — the mobile equivalent of the desktop's anchored popovers and
// modals. Rises from the bottom edge, dims the world behind it, and respects the
// home-indicator safe area. `tall` sheets (chat, task detail) take most of the
// screen; the default hugs its content.
//
// Swipe the handle or title row downward to dismiss. Releasing past 30% of the
// sheet height snaps it away with the scrim fading; less than that snaps it back.
export default function Sheet({
  onClose,
  children,
  title,
  tall = false,
  contentClassName = "",
  onContentScroll,
}: {
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  tall?: boolean;
  contentClassName?: string;
  /** so a sheet can react to its own scroll — the record uses it to fade its
   *  name into the title row only once the hero has left the screen. */
  onContentScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
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

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { startY: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !sheetRef.current) return;
    const delta = Math.max(0, e.clientY - drag.current.startY);
    sheetRef.current.style.animation = "none";
    sheetRef.current.style.transition = "none";
    sheetRef.current.style.transform = `translateY(${delta}px)`;
    // Dim the scrim proportionally as the sheet moves away.
    if (scrimRef.current) {
      const height = sheetRef.current.offsetHeight || 400;
      const opacity = Math.max(0, 0.4 * (1 - delta / height));
      scrimRef.current.style.opacity = String(opacity);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const delta = Math.max(0, e.clientY - drag.current.startY);
    drag.current = null;

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
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    style: { touchAction: "none" as const, cursor: "grab" as const },
  };

  return createPortal(
    <div
      ref={scrimRef}
      className="scrim fixed inset-0 z-[60] flex flex-col justify-end bg-black/40 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && dismiss()}
      onTouchStart={(e) => e.target === e.currentTarget && dismiss()}
    >
      <div
        ref={sheetRef}
        className={`sheet-up glass flex ${
          tall ? "h-[92vh] pt-safe" : "max-h-[88vh]"
        } flex-col rounded-t-2xl border-t border-line pb-safe`}
      >
        {/* Grab pill — primary swipe target */}
        <div {...handleProps} className="flex shrink-0 flex-col items-center py-2.5">
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
            <div className="min-w-0 flex-1 text-head font-semibold tracking-tight select-none">{title}</div>
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

        <div className={`min-h-0 flex-1 ${contentClassName}`} onScroll={onContentScroll}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
