// Shared building blocks for the create "moments" — New initiative, New
// project. A labelled field, a selectable pill (domains, initiatives, date
// presets), and the tinted header. Everything takes the active accent so the
// chosen domain's color carries the whole moment.

import type { ReactNode } from "react";

export function MomentHeader({
  accent,
  icon,
  eyebrow,
  title,
  onClose,
}: {
  accent: string;
  icon: ReactNode;
  eyebrow: string;
  title: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fast relative border-b border-line px-6 pb-4 pt-5"
      style={{ background: `linear-gradient(180deg, ${accent}12, transparent)` }}
    >
      <div className="flex items-start gap-3">
        <span
          className="fast mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[16px]"
          style={{ background: `${accent}1f`, color: accent, boxShadow: `inset 0 0 0 1px ${accent}40` }}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="section-label" style={{ color: accent }}>{eyebrow}</div>
          <h2 className="mt-0.5 text-[17px] font-semibold leading-tight tracking-tight">{title}</h2>
        </div>
        <button onClick={onClose} className="keycap shrink-0">esc</button>
      </div>
    </div>
  );
}

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="section-label mb-1.5">{label}</div>
      {children}
    </div>
  );
}

/** A selectable pill — its active state tints to `accent`. */
export function Pill({
  active,
  accent,
  onClick,
  children,
  title,
}: {
  active: boolean;
  accent: string;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="fast flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]"
      style={{
        borderColor: active ? accent : "var(--line)",
        color: active ? "var(--text)" : "var(--muted)",
        background: active ? `${accent}14` : "transparent",
        boxShadow: active ? `inset 0 0 0 1px ${accent}55` : "none",
      }}
    >
      {children}
    </button>
  );
}
