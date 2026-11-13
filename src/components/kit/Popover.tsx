import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type React from "react";
import { createPortal } from "react-dom";
import { useMenuFocus } from "../../hooks/useMenuFocus";
import { Icon } from "../Icon";
import { Kbd } from "./Button";
import { cx } from "./cx";

// Popover · Menu · MenuItem · MenuSeparator · MenuLabel · MenuSearch · Picker
// — the one floating shell (D-190). Every menu, picker and inspector in the
// app sits in this: an 8px corner, a 4px inset, one shadow, and a 110ms grow
// from the side it was opened on (`--pop-origin`).
//
// Desktop only: a phone overlay is a bottom Sheet (CLAUDE.md golden rule 3),
// never a cursor-anchored popover. Callers branch on useIsMobile().
//
// Contract with the rest of the app:
//   · `data-nested-surface` — a press inside never closes a surface beneath it.
//   · menus use `useMenuFocus` — ↑/↓/Home/End, type-ahead, focus returned.
//   · Escape and a press outside close it; the anchor itself is "inside", so
//     clicking the trigger again toggles rather than close-then-reopen.

export type Anchor = HTMLElement | DOMRect | { x: number; y: number };
export type Placement = "bottom-start" | "bottom-end" | "top-start" | "top-end" | "right-start" | "left-start";

const GAP = 6;
const EDGE = 8;

function anchorRect(a: Anchor): DOMRect {
  if (a instanceof HTMLElement) return a.getBoundingClientRect();
  if (a instanceof DOMRect) return a;
  return new DOMRect(a.x, a.y, 0, 0);
}

/** Pure: where a popover of size w×h goes against rect r in a vw×vh window.
 *  Flips to the other side when it would overflow, then clamps to the edges. */
export function placePopover(
  r: { left: number; top: number; right: number; bottom: number; width: number; height: number },
  w: number,
  h: number,
  vw: number,
  vh: number,
  placement: Placement,
): { left: number; top: number; origin: string } {
  const [side, align] = placement.split("-") as ["bottom" | "top" | "right" | "left", "start" | "end"];
  let left: number;
  let top: number;
  let originY: "top" | "bottom" = "top";
  let originX: "left" | "right" = align === "end" ? "right" : "left";
  if (side === "bottom" || side === "top") {
    left = align === "end" ? r.right - w : r.left;
    const below = r.bottom + GAP;
    const above = r.top - GAP - h;
    const wantBelow = side === "bottom";
    const fitsBelow = below + h <= vh - EDGE;
    const fitsAbove = above >= EDGE;
    const useBelow = wantBelow ? fitsBelow || !fitsAbove : !fitsAbove && fitsBelow;
    top = useBelow ? below : above;
    originY = useBelow ? "top" : "bottom";
  } else {
    top = r.top - 4;
    const right = r.right + GAP;
    const leftSide = r.left - GAP - w;
    const wantRight = side === "right";
    const fitsRight = right + w <= vw - EDGE;
    const useRight = wantRight ? fitsRight || leftSide < EDGE : leftSide < EDGE;
    left = useRight ? right : leftSide;
    originX = useRight ? "left" : "right";
  }
  left = Math.max(EDGE, Math.min(left, vw - EDGE - w));
  top = Math.max(EDGE, Math.min(top, vh - EDGE - h));
  return { left, top, origin: `${originY} ${originX}` };
}

type PopoverProps = {
  anchor: Anchor | null;
  open: boolean;
  onClose: () => void;
  placement?: Placement;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** no inner padding — an inspector draws its own sections */
  flush?: boolean;
  role?: string;
  label?: string;
  /** match the anchor's width (a Select's options) */
  matchWidth?: boolean;
};

export function Popover({ anchor, open, onClose, placement = "bottom-start", children, className, style, flush, role = "dialog", label, matchWidth }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string; minWidth?: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const r = anchorRect(anchor);
      const p = placePopover(r, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight, placement);
      setPos({ ...p, minWidth: matchWidth ? r.width : undefined });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, anchor, placement, matchWidth]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchor instanceof HTMLElement && anchor.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, anchor, onClose]);

  if (!open || !anchor) return null;
  // First frame: measured off-screen (-9999), never `visibility: hidden` — a
  // hidden element can't take focus, and a menu focuses itself on mount.
  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={label}
      data-nested-surface=""
      data-flush={flush || undefined}
      className={cx("k-pop", className)}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        minWidth: pos?.minWidth,
        ["--pop-origin" as string]: pos?.origin,
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

// ── Menu ───────────────────────────────────────────────────────────────────

const MenuClose = createContext<(() => void) | null>(null);

/** Keyboard-complete menu in the popover shell. */
export function Menu({ anchor, open, onClose, placement, label, children, className }: Omit<PopoverProps, "role" | "flush"> & { label: string }) {
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} placement={placement} role="menu" label={label} className={className}>
      <MenuBody onClose={onClose}>{children}</MenuBody>
    </Popover>
  );
}

function MenuBody({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useMenuFocus(ref);
  return (
    <MenuClose.Provider value={onClose}>
      <div ref={ref} className="outline-none">
        {children}
      </div>
    </MenuClose.Provider>
  );
}

/** The popover shell without the floating — for a static preview (the ?kit
 *  page) or a surface that hosts a menu inline. Closing is a no-op there.
 *  It is a menu by default; pass another role for other content (a date
 *  grid is not a menu). */
export function MenuPanel({ children, className, style, role = "menu" }: { children: ReactNode; className?: string; style?: CSSProperties; role?: string }) {
  return (
    <div className={cx("k-pop", className)} style={{ position: "relative", animation: "none", ...style }} role={role}>
      {children}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  shortcut,
  hint,
  checked,
  danger,
  disabled,
  submenu,
  onSelect,
  keepOpen,
}: {
  icon?: ReactNode;
  children: ReactNode;
  shortcut?: string | readonly string[];
  /** quiet trailing text — a count, a current value */
  hint?: ReactNode;
  /** a checkable item: shows a check when true */
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** draws a › — the item opens a submenu */
  submenu?: boolean;
  /** the click event rides along — a ⇧-click alternate act reads it */
  onSelect?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** don't close after selecting (a multi-select picker) */
  keepOpen?: boolean;
}) {
  const close = useContext(MenuClose);
  const label = typeof children === "string" ? children : undefined;
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      data-label={label}
      data-danger={danger || undefined}
      disabled={disabled}
      tabIndex={-1}
      className="k-mi"
      onClick={(e) => {
        onSelect?.(e);
        if (!keepOpen && !submenu) close?.();
      }}
    >
      {icon}
      <span className="k-mi-label">{children}</span>
      {hint != null && <span className="k-mi-hint">{hint}</span>}
      {shortcut != null && <Kbd keys={shortcut} />}
      {checked && <Icon name="check" size={14} className="k-mi-check" />}
      {submenu && <Icon name="chevron-right" size={12} style={{ color: "var(--faint)" }} />}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="k-msep" role="separator" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="k-mlabel">{children}</div>;
}

export function MenuSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="k-msearch">
      <Icon name="search" size={14} />
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
        onKeyDown={(e) => {
          // ↓ from the search hands focus to the first option.
          if (e.key === "ArrowDown") {
            e.preventDefault();
            const first = e.currentTarget.closest(".k-pop")?.querySelector<HTMLElement>('[role="menuitem"],[role="menuitemcheckbox"]');
            first?.focus();
          }
        }}
      />
    </div>
  );
}

// ── Picker ─────────────────────────────────────────────────────────────────

export type PickerOption<T extends string> = { value: T; label: string; icon?: ReactNode; hint?: ReactNode };

/** Choose one (or several) of many: a searchable menu with checks. The search
 *  appears once there are more than seven options. */
export function Picker<T extends string>({
  anchor,
  open,
  onClose,
  options,
  value,
  onChange,
  label,
  placement,
  multiple,
  footer,
}: {
  anchor: Anchor | null;
  open: boolean;
  onClose: () => void;
  options: readonly PickerOption<T>[];
  value: T | readonly T[] | null;
  onChange: (v: T) => void;
  label: string;
  placement?: Placement;
  multiple?: boolean;
  /** one trailing act under a separator — "New domain" */
  footer?: ReactNode;
}) {
  const [q, setQ] = useState("");
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  }, [options, q]);
  const isOn = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <Menu anchor={anchor} open={open} onClose={onClose} placement={placement} label={label}>
      {options.length > 7 && <MenuSearch value={q} onChange={setQ} placeholder={label} />}
      {shown.map((o) => (
        <MenuItem key={o.value} icon={o.icon} hint={o.hint} checked={isOn(o.value)} keepOpen={multiple} onSelect={() => onChange(o.value)}>
          {o.label}
        </MenuItem>
      ))}
      {shown.length === 0 && <div className="k-mlabel">No match</div>}
      {footer && (
        <>
          <MenuSeparator />
          {footer}
        </>
      )}
    </Menu>
  );
}

/** A value you change through a picker: looks like a field, opens the menu. */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
  className,
}: {
  value: T;
  options: readonly PickerOption<T>[];
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const [btn, setBtn] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <button
        ref={setBtn}
        type="button"
        className={cx("k-field k-select", className)}
        data-size={size === "md" ? undefined : size}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="k-select-val">
          {current?.icon}
          {current?.label ?? label}
        </span>
        <Icon name="chevron-down" size={12} />
      </button>
      <Picker
        anchor={btn}
        open={open}
        onClose={() => setOpen(false)}
        options={options}
        value={value}
        label={label}
        onChange={(v) => {
          onChange(v);
          setOpen(false);
        }}
      />
    </>
  );
}
