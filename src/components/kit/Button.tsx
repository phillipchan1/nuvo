import { forwardRef, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
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
  /** in a tight PageBar, drop the words and keep the icon (the words become
   *  the tooltip). Only meaningful with `icon`. */
  collapsible?: boolean;
  /** the first act a very tight PageBar lets go of. Only for an act that has
   *  a shortcut and a neighbour that covers it (Today: ⌘T, beside ‹ ›). */
  shed?: boolean;
  children?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { kind = "secondary", size = "sm", icon, trailing, shortcut, active, full, collapsible, shed, className, children, type = "button", ...rest },
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
      data-collapsible={(collapsible && icon) || undefined}
      data-shed={shed || undefined}
      {...rest}
    >
      {icon}
      {collapsible && icon ? <span className="k-btn-label">{children}</span> : children}
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

/** Nuvo's offer on a row (D-205): a destination, said quietly — accent ink,
 *  no fill, no border, no icon. It sits in the row's trailing slot and never
 *  grows the row; under a finger its hit area is 44px tall without the mark
 *  getting any bigger (styles/kit.css `.k-offer::before`).
 *
 *  "Not now" is never a second visible button: right-click, ⌫ / Delete while
 *  it has focus, or a long press under a finger. */
export function OfferChip({
  verb,
  name,
  title,
  whole = false,
  dest = false,
  said: saidAs,
  onPress,
  onDismiss,
}: {
  verb: string;
  /** the place — truncates; the verb never does. Omit for a whole-verb act. */
  name?: string;
  title?: string;
  /** The name must be read whole — a time. The row's other text yields instead. */
  whole?: boolean;
  /** The name is a place that should keep most of the row's trailing width
   *  before it truncates — "→ Garage studio" (D-206). */
  dest?: boolean;
  /** What a screen reader hears, when the visible verb is a glyph ("→"). */
  said?: string;
  onPress: (el: HTMLButtonElement) => void;
  onDismiss?: () => void;
}) {
  const hold = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const cancel = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
  };
  const said = saidAs ?? (name ? `${verb} ${name}` : verb);
  return (
    <button
      type="button"
      className="k-offer"
      data-whole={whole || undefined}
      data-dest={dest || undefined}
      data-card-control=""
      title={title ?? said}
      aria-label={title ? `${said}. ${title}` : said}
      aria-keyshortcuts={onDismiss ? "Delete" : undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (hold.current?.fired) {
          hold.current = null;
          return;
        }
        onPress(e.currentTarget);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (!onDismiss || e.pointerType !== "touch") return;
        cancel();
        const h = { timer: 0, x: e.clientX, y: e.clientY, fired: false };
        h.timer = window.setTimeout(() => {
          h.fired = true;
          onDismiss();
        }, 500);
        hold.current = h;
      }}
      onPointerMove={(e) => {
        const h = hold.current;
        if (h && !h.fired && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 8) cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => {
        if (!onDismiss) return;
        e.preventDefault();
        e.stopPropagation();
        if (hold.current?.fired) return; // the long press already said it
        onDismiss();
      }}
      onKeyDown={(e) => {
        if (onDismiss && (e.key === "Backspace" || e.key === "Delete")) {
          e.preventDefault();
          e.stopPropagation();
          onDismiss();
        }
      }}
    >
      {name ? <Dest verb={verb} name={name} title={title ?? said} /> : <span>{verb}</span>}
    </button>
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
