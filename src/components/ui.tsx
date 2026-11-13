import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { IconButton, SectionHeader } from "./kit";
import { cx } from "./kit/cx";

// The shared small parts — on the kit (D-190). Every export keeps the API it
// had, because half the app calls these: Keycap is the kit's keycap, Btn is a
// kit Button, Modal wears the kit Dialog's shell (12px, solid, on a scrim).

export function Keycap({ children }: { children: ReactNode }) {
  return <kbd className="k-kbd">{children}</kbd>;
}

/** A section's heading. Pass `open` + `onToggle` to make it a disclosure —
 *  plain labels stay a static heading. The kit SectionHeader underneath. */
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
  // A static label still takes a count — it's how the label says how far it
  // reaches. Without one, a label above an unlabeled sibling list reads as
  // covering everything below it.
  const shown = count != null && count > 0 ? count : undefined;
  if (onToggle != null && open != null) {
    return <SectionHeader title={children} count={shown} collapsed={!open} onToggle={onToggle} className="ui-section" />;
  }
  return <SectionHeader title={children} count={shown} className="ui-section" />;
}

export function Modal({
  onClose,
  children,
  width = "max-w-lg",
  align = "top",
  zClass = "z-[70]",
  closeOnEscape = true,
}: {
  onClose: () => void;
  children: ReactNode;
  width?: string;
  // "top" (default): the small-dialog look — pinned 12vh down. "center": for a
  // tall modal — vertically centered and bounded to the viewport, so a near-
  // full-height dialog keeps even margins and never spills off the bottom.
  align?: "top" | "center";
  // Default z-[70] clears Orientation / PlanWeek (60). Do NOT raise the default:
  // Settings stays at 70 so the calendars walkthrough can cut a hole into it.
  // Pass a higher token when this dialog opens over RecordScrim (z-81) —
  // ShipAssess uses z-[90].
  zClass?: string;
  /** false when the content owns Escape itself — a field inside that clears
   *  first and leaves second (D-051) can't do that if the scrim has already
   *  closed on the same keypress. */
  closeOnEscape?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Dialog semantics — focus in, Tab trapped, focus restored to the trigger.
  useDialogFocus(panelRef);
  useEffect(() => {
    if (!closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, closeOnEscape]);

  // Portal to <body> + sit above full-screen flows. Settings / Shortcuts mount
  // inside Planner or under MobileShell; Plan the week (z-50/60) and Sunday
  // ritual (z-50) are later siblings, so an in-tree z-50 Modal painted *under*
  // them — ⌘, looked like a no-op. z-[70] clears Orientation / PlanWeek (60).
  // The scrim is the kit's (styles/documents.css `.dlg-scrim`): a flat dim,
  // no blur. The layer stays a class so callers can name it.
  return createPortal(
    <div className={`dlg-scrim ${zClass}`} data-align={align} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panelRef} role="dialog" aria-modal="true" tabIndex={-1} className={`dlg ${width}`} data-align={align}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** A dialog's head: its title and the ✕. The kit Dialog's own head, for the
 *  callers of Modal that own their content. */
export function DialogHead({ title, onClose, children }: { title: ReactNode; onClose?: () => void; children?: ReactNode }) {
  return (
    <div className="k-dialog-head">
      <h2>{title}</h2>
      {children}
      {onClose && <IconButton label="Close" shortcut="Esc" icon={<Icon name="close" size={14} />} onClick={onClose} />}
    </div>
  );
}

/** A dialog's actions, primary last. `start` sits at the left edge. */
export function DialogFoot({ start, children }: { start?: ReactNode; children: ReactNode }) {
  return (
    <div className="k-dialog-foot">
      {start}
      {start && <span className="k-grow" />}
      {children}
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
  // The old three kinds, mapped onto the kit's: "ghost" was always a bordered
  // neutral button (the kit's secondary), "signal" was the destructive one.
  const k = kind === "primary" ? "primary" : kind === "signal" ? "danger" : undefined;
  return (
    // No `type`: a Btn inside a <form> (Settings → Labels' Add) submits it.
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx("k-btn ui-btn", className)}
      data-kind={k}
      data-size="md"
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

// How many days this has been carried (D-147). History, not urgency — so it's a bare number,
// never a bordered signal chip. (It used to be the loudest thing in the rail: a
// square `--signal` border on work whose only crime was being old.)
export function carriedTitle(days: number): string {
  return `Carried over ${days} ${days === 1 ? "day" : "days"}`;
}

export function RollBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="shrink-0 text-meta leading-none tabular-nums text-muted" title={carriedTitle(count)}>
      ↻{count}d
    </span>
  );
}

/** Two-arrow repeat glyph — same mark on calendar blocks and task rows. */
export function RecurMark({ className = "", title = "Repeats" }: { className?: string; title?: string }) {
  return (
    <Icon name="repeat" size={9} className={className} title={title} />
  );
}
