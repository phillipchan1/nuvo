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
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`fast w-full ${width} border border-line bg-surface`}>{children}</div>
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
      ? "bg-accent text-white border-accent hover:opacity-90"
      : kind === "signal"
        ? "text-signal border-line hover:border-signal"
        : "text-ink border-line hover:border-muted";
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`fast border px-2.5 py-1 text-[12px] font-medium disabled:opacity-40 ${styles} ${className}`}
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
    <span className="mono shrink-0 border border-signal px-1 py-px text-[10px] leading-none text-signal">
      ↻ {count}d
    </span>
  );
}
