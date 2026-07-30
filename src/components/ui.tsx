import type { ReactNode } from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

export function Keycap({ children }: { children: ReactNode }) {
  return <kbd className="keycap">{children}</kbd>;
}

/** Section eyebrow. Pass `open` + `onToggle` to make it a collapse control
 *  (same ▾/▸ affordance as Loose ends) — plain labels stay a static div. */
export function SectionLabel({
  children,
  open,
  onToggle,
  count,
}: {
  children: ReactNode;
  /** When set with onToggle, the label toggles its section. */
  open?: boolean;
  onToggle?: () => void;
  /** Optional count — useful when collapsed so you still see what's hidden. */
  count?: number;
}) {
  if (onToggle != null && open != null) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="section-label fast tap flex w-full items-center gap-2 px-3 pt-3 pb-1.5 text-left hover:text-ink"
      >
        <span>{children}</span>
        {count != null && count > 0 && (
          <span className="mono font-normal normal-case tracking-normal text-muted">{count}</span>
        )}
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="ml-auto h-3.5 w-3.5 shrink-0 text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {open ? <path d="M4 6l4 4 4-4" /> : <path d="M6 4l4 4-4 4" />}
        </svg>
      </button>
    );
  }
  // A static label still takes a count — it's how the label says how far it
  // reaches. Without one, a label above an unlabeled sibling list reads as
  // covering everything below it.
  return (
    <div className="section-label flex items-center gap-2 px-3 pt-3 pb-1.5">
      <span>{children}</span>
      {count != null && count > 0 && (
        <span className="mono font-normal normal-case tracking-normal text-muted">{count}</span>
      )}
    </div>
  );
}

export function Modal({
  onClose,
  children,
  width = "max-w-lg",
  align = "top",
}: {
  onClose: () => void;
  children: ReactNode;
  width?: string;
  // "top" (default): the small-dialog look — pinned 12vh down. "center": for a
  // tall modal — vertically centered and bounded to the viewport, so a near-
  // full-height sheet keeps even margins and never spills off the bottom.
  align?: "top" | "center";
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const scrimPos =
    align === "center" ? "sm:items-center sm:p-4" : "sm:items-start sm:p-0 sm:pt-[12vh]";
  // A centered modal must stay inside the viewport; a top-anchored one lets its
  // children own the height (unchanged).
  const heightCap = align === "center" ? "sm:max-h-[92vh]" : "sm:max-h-none";

  // Portal to <body> + sit above full-screen flows. Settings / Shortcuts mount
  // inside Planner or under MobileShell; Plan the week (z-50/60) and Sunday
  // ritual (z-50) are later siblings, so an in-tree z-50 Modal painted *under*
  // them — ⌘, looked like a no-op. z-[70] clears Orientation / PlanWeek (60).
  return createPortal(
    <div
      // Mobile-first: centered with a margin and scrollable so it can't overflow
      // a phone. sm+ restores the desktop look (top-anchored, or centered for a
      // tall sheet — children own their scroll).
      className={`scrim fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-3 backdrop-blur-[2px] ${scrimPos}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`moment glass elev-3 w-full ${width} max-h-[90vh] overflow-y-auto rounded-lg border border-line ${heightCap} sm:overflow-hidden`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Btn({
  children,
  onClick,
  kind = "ghost",
  className = "",
  title,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "ghost" | "primary" | "signal";
  className?: string;
  title?: string;
  disabled?: boolean;
}) {
  const styles =
    kind === "primary"
      ? "bg-accent text-white border-accent shadow-sm hover:brightness-110 hover:shadow-[0_6px_16px_-6px_var(--accent-glow)]"
      : kind === "signal"
        ? "text-signal border-line hover:border-signal hover:bg-signal-soft"
        : "text-ink border-line hover:border-line-strong hover:bg-surface-2";
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`fast whitespace-nowrap rounded-md border px-4 py-2.5 text-body font-medium active:translate-y-px disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function PriorityDot({ priority }: { priority: string }) {
  if (priority === "none") return null;
  const color =
    priority === "high" ? "var(--signal)" : priority === "medium" ? "var(--accent)" : "var(--muted)";
  return (
    <span
      title={`Priority: ${priority}`}
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

// How many times this rolled over. History, not urgency — so it's a bare number,
// never a bordered signal chip. (It used to be the loudest thing in the rail: a
// square `--signal` border on work whose only crime was being old.)
export function RollBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="mono shrink-0 text-meta leading-none text-muted" title={`Rolled over ${count}×`}>
      ↻{count}
    </span>
  );
}
