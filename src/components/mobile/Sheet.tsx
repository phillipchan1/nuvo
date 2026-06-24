import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

// A bottom sheet — the mobile equivalent of the desktop's anchored popovers and
// modals. Rises from the bottom edge, dims the world behind it, and respects the
// home-indicator safe area. `tall` sheets (chat, task detail) take most of the
// screen; the default hugs its content.
//
// Swipe the handle or title row downward to dismiss. Releasing past 30% of the
// sheet height snaps it away; less than that snaps it back.
export default function Sheet({
  onClose,
  children,
  title,
  tall = false,
  contentClassName = "",
}: {
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  tall?: boolean;
  contentClassName?: string;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  // Track active drag without triggering re-renders.
  const drag = useRef<{ startY: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    // Lock the body scroll while a sheet owns the screen.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Slide the sheet down and call onClose after the animation.
  const dismiss = () => {
    const el = sheetRef.current;
    if (!el) { onClose(); return; }
    el.style.transition = "transform 0.22s ease-in";
    el.style.transform = "translateY(110%)";
    setTimeout(onClose, 220);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { startY: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !sheetRef.current) return;
    const delta = Math.max(0, e.clientY - drag.current.startY);
    sheetRef.current.style.transition = "none";
    sheetRef.current.style.transform = `translateY(${delta}px)`;
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
    }
  };

  // Shared drag-handle props — applied to the pill area and the title row.
  const handleProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    style: { touchAction: "none" as const, cursor: "grab" as const },
  };

  return createPortal(
    <div
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
        {/* Grab pill — also the primary swipe target */}
        <div {...handleProps} className="flex shrink-0 flex-col items-center py-2.5">
          <span className="h-1 w-9 rounded-full bg-line-strong" />
        </div>

        {title != null && (
          <div
            {...handleProps}
            className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2"
          >
            <div className="text-head font-semibold tracking-tight select-none">{title}</div>
            <button
              onClick={onClose}
              onPointerDown={(e) => e.stopPropagation()} // don't start a drag from the ✕
              aria-label="Close"
              className="fast -mr-1 flex h-8 w-8 items-center justify-center rounded-full text-lead text-muted hover:bg-bg hover:text-ink"
              style={{ cursor: "default" }}
            >
              ✕
            </button>
          </div>
        )}

        <div className={`min-h-0 flex-1 ${contentClassName}`}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
