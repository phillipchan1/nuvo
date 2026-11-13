// The kit at touch size — the few phone parts the desktop kit has no size for.
// Drawn by styles/phone.css (`ph-*`). Each one wraps or mirrors a kit part
// rather than inventing a new control: a TouchButton IS the kit Button at 44px,
// a TouchSegmented IS the kit Segmented with a 44px hit area per face.
//
// Phone-only: nothing here is mounted by the desktop shell.

import { forwardRef, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { Button, Segmented, type Choice } from "../kit";
import { cx } from "../kit/cx";
import { Icon, type IconName } from "../Icon";

/** The kit Button at thumb height (44px, 15px label, an 8px corner) — the
 *  sheet strip's two acts, a card's one act. Every kind the kit has. */
export const TouchButton = forwardRef<HTMLButtonElement, Omit<ComponentProps<typeof Button>, "size"> & { compact?: boolean }>(
  function TouchButton({ className, compact, ...rest }, ref) {
    return <Button ref={ref} {...rest} size={compact ? "md" : "sm"} className={cx("ph-btn", className)} />;
  },
);

/** The kit Segmented with a 36px trough and 44px hit areas; `full` spreads the
 *  faces across the row (the Tasks screen's Today · Week · Inbox). */
export function TouchSegmented<T extends string>({
  full,
  className,
  ...rest
}: {
  options: readonly Choice<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  full?: boolean;
  className?: string;
}) {
  return <Segmented<T> {...rest} className={cx("ph-seg", full && "ph-seg-wide", className)} />;
}
export type { Choice };

/** A count inside a segment face — quiet, tabular. */
export function SegCount({ n }: { n: number }) {
  return n > 0 ? <span className="ph-seg-count">{n}</span> : null;
}

/** A section's name and count — no eyebrow, no ceremony. */
export function PhSection({
  title,
  count,
  aside,
  className,
  style,
}: {
  title: ReactNode;
  count?: ReactNode;
  aside?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cx("ph-section", className)} style={style}>
      <span>{title}</span>
      {count != null && <span className="ph-section-count">{count}</span>}
      {aside != null && (
        <>
          <span className="ph-grow" />
          {aside}
        </>
      )}
    </div>
  );
}

/** Two or three words, an optional glyph, at most one act. */
export function PhEmpty({ icon, children, action }: { icon?: IconName; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="ph-empty">
      {icon && <Icon name={icon} size={20} />}
      <span>{children}</span>
      {action}
    </div>
  );
}
