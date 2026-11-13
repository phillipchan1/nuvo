import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

// Button · IconButton · Kbd — the kit's controls (D-190, styles/kit.css).
//
// One button for the whole app. Four kinds, three sizes, an optional leading
// icon and an optional keycap — that is the entire vocabulary. A control that
// needs something else is a different part, not a fifth kind.

export type ButtonKind = "primary" | "secondary" | "ghost" | "danger" | "danger-solid";
export type ButtonSize = "xs" | "sm" | "md";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  kind?: ButtonKind;
  /** xs 24 · sm 28 (default) · md 32 */
  size?: ButtonSize;
  /** a leading glyph, already sized (an <Icon size={14}/>) */
  icon?: ReactNode;
  /** a trailing glyph — a select's chevron */
  trailing?: ReactNode;
  /** the key(s) that do the same thing, drawn as keycaps: "P" or ["⌘", "K"] */
  shortcut?: string | readonly string[];
  /** a toggle that is on (a pressed toolbar button) */
  active?: boolean;
  full?: boolean;
  children?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { kind = "secondary", size = "sm", icon, trailing, shortcut, active, full, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("k-btn", className)}
      data-kind={kind === "secondary" ? undefined : kind}
      data-size={size === "sm" ? undefined : size}
      data-active={active || undefined}
      data-full={full || undefined}
      {...rest}
    >
      {icon}
      {children}
      {trailing}
      {shortcut != null && <Kbd keys={shortcut} />}
    </button>
  );
});

type IconButtonProps = Omit<ButtonProps, "children" | "trailing" | "icon" | "full"> & {
  icon: ReactNode;
  /** required: it is the accessible name AND the tooltip (lib/tooltips) */
  label: string;
};

/** A square button with only a glyph. The label is mandatory — it becomes the
 *  aria-label and the hover tooltip, with the shortcut appended. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, shortcut, kind = "ghost", ...rest },
  ref,
) {
  const keys = shortcut == null ? "" : ` (${Array.isArray(shortcut) ? shortcut.join("") : shortcut})`;
  return (
    <Button ref={ref} kind={kind} aria-label={label} title={`${label}${keys}`} data-icon="" {...rest}>
      {icon}
    </Button>
  );
});

/** An act's label when it names a destination (D-204): the verb, then the
 *  place. A long place truncates; the verb never does. Use it as a Button's
 *  children — the button then shrinks inside its row instead of overflowing. */
export function Dest({ verb, name, title }: { verb: string; name: string; title?: string }) {
  return (
    <span className="k-dest" title={title ?? `${verb} ${name}`}>
      <span className="k-dest-verb">{verb}</span>{" "}
      <span className="k-dest-name">{name}</span>
    </span>
  );
}

/** A keycap. Pass one key or a chord: <Kbd keys={["⌘", "K"]} />. */
export function Kbd({ keys, className }: { keys: string | readonly string[]; className?: string }) {
  const list = typeof keys === "string" ? [keys] : keys;
  return (
    <span className={cx("k-kbds", className)} aria-hidden="true">
      {list.map((k, i) => (
        <kbd key={`${k}-${i}`} className="k-kbd">
          {k}
        </kbd>
      ))}
    </span>
  );
}
