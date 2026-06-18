import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

// A bottom sheet — the mobile equivalent of the desktop's anchored popovers and
// modals. Rises from the bottom edge, dims the world behind it, and respects the
// home-indicator safe area. `tall` sheets (chat, task detail) take most of the
// screen; the default hugs its content.
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

  return createPortal(
    <div
      className="scrim fixed inset-0 z-[60] flex flex-col justify-end bg-black/40 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onTouchStart={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`sheet-up glass flex ${
          tall ? "h-[92vh]" : "max-h-[88vh]"
        } flex-col rounded-t-2xl border-t border-line pb-safe`}
      >
        <div className="flex shrink-0 flex-col items-center pt-2">
          <span className="h-1 w-9 rounded-full bg-line-strong" />
        </div>
        {title != null && (
          <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-3">
            <div className="text-head font-semibold tracking-tight">{title}</div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="fast -mr-1 flex h-8 w-8 items-center justify-center rounded-full text-lead text-muted hover:bg-bg hover:text-ink"
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
