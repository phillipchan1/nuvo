import type { ReactNode } from "react";
import { useEffect } from "react";

export function Keycap({ children }: { children: ReactNode }) {
  return <kbd className="keycap">{children}</kbd>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="section-label px-3 pt-3 pb-1.5">{children}</div>;
}

export function Modal({
  onClose,
  children,
  width = "max-w-lg",
}: {
  onClose: () => void;
  children: ReactNode;
  width?: string;
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

  return (
    <div
      // Mobile-first: centered with a margin and scrollable so it can't overflow
      // a phone. sm+ restores the desktop look exactly (top-anchored, no inner
      // scroll — children own their scroll).
      className="scrim fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-3 backdrop-blur-[2px] sm:items-start sm:p-0 sm:pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`moment elev-3 w-full ${width} max-h-[90vh] overflow-y-auto rounded-lg border border-line bg-surface sm:max-h-none sm:overflow-hidden`}
      >
        {children}
      </div>
    </div>
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
      className={`fast rounded-md border px-2.5 py-1 text-caption font-medium active:translate-y-px disabled:opacity-40 ${styles} ${className}`}
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

export function RollBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="mono shrink-0 border border-signal px-1 py-px text-meta leading-none text-signal">
      ↻ {count}d
    </span>
  );
}
