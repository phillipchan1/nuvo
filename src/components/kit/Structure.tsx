import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { Icon } from "../Icon";
import { cx } from "./cx";

// SectionHeader · Row · EmptyState · Property · Card — the shapes a page is
// assembled from. None of them carries copy of its own: a section is a name
// and a count, an empty state is a few words, a property is a label and a value.

export function SectionHeader({
  title,
  count,
  collapsed,
  onToggle,
  actions,
  className,
}: {
  title: ReactNode;
  count?: ReactNode;
  /** pass with onToggle to make the header a disclosure */
  collapsed?: boolean;
  onToggle?: () => void;
  actions?: ReactNode;
  className?: string;
}) {
  const inner = (
    <>
      <span>{title}</span>
      {count != null && <span className="k-count">{count}</span>}
      {onToggle && <Icon name="chevron-down" size={12} className="k-chev" />}
    </>
  );
  return (
    <div className={cx("k-section", className)} data-collapsed={collapsed || undefined}>
      {onToggle ? (
        <button type="button" className="k-section-toggle" aria-expanded={!collapsed} onClick={onToggle}>
          {inner}
        </button>
      ) : (
        inner
      )}
      <span className="k-grow" />
      {actions}
    </div>
  );
}

type RowProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  done?: boolean;
  /** 32px (default) or 38px — the list layout's row */
  density?: "compact" | "comfy";
  onActivate?: () => void;
};

/** The list row. A row that does something takes `onActivate` — it becomes
 *  focusable and answers Enter, the way a desktop list does. */
export function Row({ leading, title, meta, trailing, selected, done, density = "compact", onActivate, className, ...rest }: RowProps) {
  const interactive = !!onActivate;
  return (
    <div
      className={cx("k-row", className)}
      data-density={density === "compact" ? undefined : density}
      data-done={done || undefined}
      data-interactive={interactive || undefined}
      aria-selected={selected ?? undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onActivate}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onActivate?.();
              }
            }
          : undefined
      }
      {...rest}
    >
      {leading}
      <span className="k-row-title">{title}</span>
      {meta != null && <span className="k-row-meta">{meta}</span>}
      {trailing}
    </div>
  );
}

/** Two or three words, an optional glyph, at most one action. */
export function EmptyState({ icon, children, action }: { icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="k-empty">
      {icon}
      <p>{children}</p>
      {action}
    </div>
  );
}

/** A record's property: label left, value right. With onClick the value is a
 *  button that opens its picker. */
export function Property({
  label,
  children,
  onClick,
  empty,
  title,
}: {
  label: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  /** the value is a placeholder ("Set target") — drawn faint */
  empty?: boolean;
  title?: string;
}) {
  return (
    <div className="k-prop">
      <span className="k-prop-label">{label}</span>
      {onClick ? (
        <button type="button" className="k-prop-value" data-empty={empty || undefined} onClick={onClick} title={title}>
          {children}
        </button>
      ) : (
        <span className="k-prop-value" data-empty={empty || undefined} title={title}>
          {children}
        </span>
      )}
    </div>
  );
}

/** A floating card — the board's unit. Selection rings it in accent and lifts. */
export const Card = forwardRef<HTMLDivElement, { selected?: boolean; interactive?: boolean; children: ReactNode } & HTMLAttributes<HTMLDivElement>>(
  function Card({ selected, interactive, className, children, ...rest }, ref) {
    return (
      <div ref={ref} className={cx("k-card", className)} aria-selected={selected ?? undefined} data-interactive={interactive || undefined} {...rest}>
        {children}
      </div>
    );
  },
);
