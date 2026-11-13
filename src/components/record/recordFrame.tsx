// The record's frame — the DOCUMENT layout (D-190). Extracted from RecordModal
// so that BIRTH AND LIFE WEAR ONE SKELETON: `CreateRecord` (new project / new
// initiative) is this same frame with a draft inside it, not a second design
// language.
//
// A record is a document with a property panel:
//
//   ┌ bar ─ Domain / Initiative / Name ───────────────── acts · ⋯ · ✕ ┐
//   │ main column                              │ properties (288px)   │
//   │   Name (30px, the one hero)              │   Status   ◔ Ready   │
//   │   the outcome, as its lead               │   Domain   ■ Work    │
//   │   Steps ─────────────────────── 7/9  ＋  │   Week     Next week │
//   │   Comments ──────────────────────────    │   Pace     ▬▬▬▬╎▭▭   │
//   └──────────────────────────────────────────┴──────────────────────┘
//
// The rules live here, once:
//   · ONE HERO — the name, 30px 700. Everything else on the page is quiet.
//   · EVERY PROPERTY IS A ROW whose value opens its picker. No property is a
//     sentence and no property lives in the main column.
//   · THE PANEL IS ANNOTATION — a faint well beside the work, never a frame
//     around it.
//   · Geometry from the kit only (styles/documents.css): the bar is the kit's
//     PageBar shape, sections are kit SectionHeaders, values are kit Property.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon";
import { InlineText } from "../floors/parts";
import { isTypingIn } from "../floors/TaskList";
import { IconButton, Popover, SectionHeader, type Placement } from "../kit";
import { cx } from "../kit/cx";

// ── The scrim + the keyboard contract ────────────────────────────────────────
/** Escape · Tab-trap · focus restore. A FIELD OWNS ESCAPE FIRST — leaving a
 *  field and leaving the sheet are two presses, the same as everywhere else. */
export function useRecordKeys(sheetRef: RefObject<HTMLDivElement>, onClose: () => void) {
  // Give focus back to whatever the sheet was opened from. Without this, closing
  // dropped focus on <body> and every keyboard path died until you clicked.
  useEffect(() => {
    const from = document.activeElement as HTMLElement | null;
    return () => from?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isTypingIn(e.target)) return;
      // A task list spent it (clearing its cursor), or something nested in the
      // sheet — a row menu, a task's popover, a property's picker — closes
      // first, on its own press.
      if (e.defaultPrevented || document.querySelector("[data-nested-surface]")) return;
      // A nested dialog (ShipAssess) is a later [role=dialog] sibling. This
      // listener is registered first, so it would otherwise close the sheet
      // on the same press that is meant to dismiss only the nested one.
      const dialogs = document.querySelectorAll("[role='dialog'][aria-modal='true']");
      if (dialogs.length > 0 && dialogs[dialogs.length - 1] !== sheetRef.current) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, sheetRef]);

  // Tab cycles inside the sheet instead of walking out into the floor behind it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !sheetRef.current) return;
      const f = Array.from(
        sheetRef.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input,select,textarea,[contenteditable],[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetRef]);
}

export function RecordScrim({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return createPortal(
    <div
      // Above the live walkthrough (teach dim 78 · orb 79 · panel 80). Create used
      // to sit at z-60 — under that stack — so Projects → On Deck empty "Add your
      // first project" (the walk's own target) opened a sheet nobody could see.
      // Same class of bug as Modal's z-70 climb over Plan the week. Settings stays
      // at 70 on purpose so the calendars step can still cut a hole into it.
      // The dim is the kit's flat scrim (`.doc-scrim::before`) — nothing blurs.
      className="doc-scrim fixed inset-0 z-[81] flex items-center justify-center p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {children}
    </div>,
    document.body,
  );
}

// ── The sheet ────────────────────────────────────────────────────────────────
export function Sheet({
  sheetRef,
  wide = false,
  fit = false,
  label,
  className,
  style,
  children,
}: {
  sheetRef: RefObject<HTMLDivElement>;
  /** Assess lays its margin notes beside the work, so the page widens. */
  wide?: boolean;
  /** Hug the content (the create sheet) instead of standing at full height. */
  fit?: boolean;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      ref={sheetRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      className={cx("doc", className)}
      data-wide={wide || undefined}
      data-fit={fit || undefined}
      style={style}
    >
      {children}
    </div>
  );
}

// ── The bar: Domain / Initiative / Name · acts ───────────────────────────────
/** The kit PageBar's shape without its window-drag region — this bar sits on
 *  a dialog, and dragging it must not move the app window. */
export function Bar({ trail, actions }: { trail: readonly ReactNode[]; actions?: ReactNode }) {
  const items = trail.filter((t) => t != null && t !== false && t !== "");
  return (
    <header className="k-bar">
      <nav className="k-crumb" aria-label="Breadcrumb">
        {items.map((t, i) => (
          <span key={i} className="contents">
            {i > 0 && (
              <span className="k-crumb-sep" aria-hidden="true">
                /
              </span>
            )}
            <span className={i === items.length - 1 ? "k-crumb-here" : "k-crumb-up"} aria-current={i === items.length - 1 ? "page" : undefined}>
              {t}
            </span>
          </span>
        ))}
      </nav>
      <div className="k-bar-fill" />
      {actions && <div className="k-bar-actions">{actions}</div>}
    </header>
  );
}

// ── Identity: the name, the outcome ──────────────────────────────────────────
export function Head({
  name,
  onName,
  namePlaceholder = "Untitled",
  autoFocusName = false,
  outcome,
  onOutcome,
  outcomePlaceholder,
}: {
  name: string;
  onName: (v: string) => void;
  namePlaceholder?: string;
  /** create only: the name is the first thing you'd type, so take the caret. */
  autoFocusName?: boolean;
  outcome: string;
  onOutcome: (v: string) => void;
  outcomePlaceholder: string;
}) {
  return (
    <div>
      {/* the ONE hero. */}
      <h1 className="doc-title">
        <InlineText
          value={name}
          onChange={onName}
          placeholder={namePlaceholder}
          autoFocusEmpty={autoFocusName}
          live={autoFocusName}
          quiet
        />
      </h1>
      {/* No "GOAL" eyebrow: a lead line directly under a name is self-evidently
          the outcome, and the placeholder teaches it when empty (D-041 — a thing
          is named once). */}
      <p className="doc-lead">
        <InlineText value={outcome} onChange={onOutcome} placeholder={outcomePlaceholder} live={autoFocusName} quiet />
      </p>
    </div>
  );
}

// ── Acts ─────────────────────────────────────────────────────────────────────
const GLYPH_ICONS: Record<string, ReactNode> = {
  "···": <Icon name="more" size={16} />,
  "✕": <Icon name="close" size={16} />,
  "✦": <Icon name="sparkles" size={15} />,
  "＋": <Icon name="plus" size={14} />,
};

/** A kit IconButton named by the glyph it used to print. The label is its name
 *  and its tooltip. */
export function IconBtn({
  glyph,
  label,
  onClick,
  badge,
  btnRef,
  size,
}: {
  glyph: string;
  label: string;
  onClick: () => void;
  badge?: number;
  btnRef?: RefObject<HTMLButtonElement>;
  size?: "xs" | "sm";
}) {
  return (
    <span className="relative inline-flex">
      <IconButton
        ref={btnRef}
        label={label}
        size={size}
        icon={GLYPH_ICONS[glyph] ?? <span aria-hidden>{glyph}</span>}
        onClick={onClick}
        className="tap-icon"
      />
      {badge != null && badge > 0 && (
        <span className="pointer-events-none absolute -right-0.5 -top-0.5 text-micro font-semibold tabular-nums text-muted">{badge}</span>
      )}
    </span>
  );
}

/** A menu row inside the shared FloatingMenu — the kit menu item's look. */
export function MenuItem({
  children,
  onClick,
  icon,
  danger,
  checked,
}: {
  children: ReactNode;
  onClick: () => void;
  icon?: ReactNode;
  danger?: boolean;
  checked?: boolean;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      onClick={onClick}
      className="k-mi tap-h"
      data-danger={danger || undefined}
    >
      {icon}
      <span className="k-mi-label">{children}</span>
      {checked && <Icon name="check" size={14} className="k-mi-check" />}
    </button>
  );
}

// ── Body: the work, and the property panel beside it ─────────────────────────
export function Body({
  main,
  props,
  overlay,
  scrollRef,
  assessing = false,
}: {
  main: ReactNode;
  props: ReactNode;
  overlay?: ReactNode;
  scrollRef?: RefObject<HTMLDivElement>;
  assessing?: boolean;
}) {
  return (
    <div ref={scrollRef} className="doc-body" data-assess={assessing || undefined}>
      <div className="doc-main">{main}</div>
      {/* The panel keeps its track while assessing — that empty column is where
          AssessLayer lays its margin notes. */}
      <aside className="doc-props" aria-label="Properties">
        <div className="doc-props-inner">{props}</div>
      </aside>
      {overlay}
    </div>
  );
}

/** A section of the work: a kit SectionHeader with its count and its ＋. */
export function Sec({
  label,
  count,
  onAdd,
  addLabel,
  actions,
  children,
}: {
  label: string;
  count?: ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="doc-sec">
      <SectionHeader
        title={label}
        count={count}
        className="doc-sec-head"
        actions={
          <>
            {actions}
            {onAdd && <IconBtn glyph="＋" size="xs" label={addLabel ?? `Add to ${label.toLowerCase()}`} onClick={onAdd} />}
          </>
        }
      />
      <div className="doc-sec-body">{children}</div>
    </section>
  );
}

// ── Properties ───────────────────────────────────────────────────────────────
/** A property whose picker is a shared part (DomainPicker, InitiativePicker):
 *  the kit Property row, with the part dressed as its value. */
export function PropSlot({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="k-prop">
      <span className="k-prop-label">{label}</span>
      <span className="doc-prop-slot">{children}</span>
    </div>
  );
}

/** A property whose value opens a kit Popover — placement, a date. The render
 *  prop gets `close` so a pick can dismiss it. */
export function PopProp({
  label,
  value,
  empty,
  title,
  placement = "left-start",
  className,
  open: controlledOpen,
  onOpenChange,
  children,
}: {
  label: ReactNode;
  value: ReactNode;
  empty?: boolean;
  title?: string;
  placement?: Placement;
  className?: string;
  /** controlled, so a shortcut (`s`, `q`) can open it */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: (close: () => void) => ReactNode;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [own, setOwn] = useState(false);
  const open = controlledOpen ?? own;
  const setOpen = (v: boolean) => (onOpenChange ? onOpenChange(v) : setOwn(v));
  return (
    <div className="k-prop">
      <span className="k-prop-label">{label}</span>
      <button
        ref={btn}
        type="button"
        className="k-prop-value"
        data-empty={empty || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen(!open)}
      >
        {value}
      </button>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} placement={placement} label={typeof label === "string" ? label : undefined} className={className} flush>
        {children(() => setOpen(false))}
      </Popover>
    </div>
  );
}

/** Readiness as checks you watch fill in. Met axes wear a filled box; unmet
 *  ones stay hollow and faint. */
export function ReadyTicks({ axes }: { axes: { label: string; met: boolean }[] }) {
  const met = axes.filter((a) => a.met).length;
  return (
    <>
      <SectionHeader title="Ready" count={`${met}/${axes.length}`} />
      <div className="doc-checks">
        {axes.map((a) => (
          <div key={a.label} className="doc-check" data-missing={a.met ? undefined : ""} title={a.met ? `${a.label} — set` : `${a.label} — not set yet`}>
            <span className="doc-check-box" data-on={a.met ? "" : undefined} aria-hidden />
            {a.label}
          </div>
        ))}
      </div>
    </>
  );
}

/** The readiness pie's step from a record's axes: met of all → ready (3). */
export function readinessStep(axes: readonly boolean[]): 0 | 1 | 2 | 3 {
  const met = axes.filter(Boolean).length;
  if (met >= axes.length) return 3;
  return Math.min(2, met) as 0 | 1 | 2;
}
