import React, { useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowUpRight, CalendarX2, Flag, Folder, Inbox, NotebookPen, SignalHigh, Star, type LucideIcon } from "lucide-react";
import { Icon, type IconName } from "./Icon";
import { Button, Dot, IconButton, Picker, type PickerOption } from "./kit";
import { shortcutLabel } from "../lib/shortcutLabel";

/**
 * ── The inspector — one grammar for every detail popover (D-190) ──────────
 *
 * The task, event and slot cards (SlideOver) and the create card
 * (DraftComposer) answer the same questions in the same order, so they wear
 * the same parts — drawn by `.insp*` in styles/popovers.css:
 *
 *   head     the identity dot, the name (15/650), ONE muted line of when
 *   strip    the act you opened it for (Join · Going? · Done) — at most two
 *   rows     hairline property rows, 36px, a leading glyph and the value you
 *            change in place (a date, a clock, a picker)
 *   sections words and people — notes, guests, steps — under a quiet label
 *   footer   ghost buttons: navigation left, the destructive act right, which
 *            only reddens once it asks
 *
 * One width, 352px, flush. Everything is a token, so Light and Dark follow.
 */

export const INSPECTOR_W = 352;

/** Glyphs the inspector needs that the shared registry (Icon.tsx) doesn't
 *  name yet. Same Lucide family, same thinned stroke. */
const GLYPHS = {
  back: ArrowLeft,
  deadline: CalendarX2,
  external: ArrowUpRight,
  flag: Flag,
  folder: Folder,
  inbox: Inbox,
  notes: NotebookPen,
  priority: SignalHigh,
  week: Star,
} satisfies Record<string, LucideIcon>;
export type PopGlyphName = keyof typeof GLYPHS;

export function PopGlyph({ name, size = 14, className, style }: { name: PopGlyphName; size?: number; className?: string; style?: CSSProperties }) {
  const G = GLYPHS[name];
  return <G size={size} strokeWidth={1.75} className={className} style={style} aria-hidden />;
}

/** An Icon or a PopGlyph, by name. */
export function PopIcon({ name, size = 14 }: { name: IconName | PopGlyphName; size?: number }) {
  return name in GLYPHS ? <PopGlyph name={name as PopGlyphName} size={size} /> : <Icon name={name as IconName} size={size} />;
}

/** An Icon or a PopGlyph by name, or a node as given. */
export type GlyphRef = IconName | PopGlyphName | React.ReactNode;
function glyph(g: GlyphRef, size = 14): React.ReactNode {
  if (typeof g !== "string") return g;
  if (g in GLYPHS) return <PopGlyph name={g as PopGlyphName} size={size} />;
  return <Icon name={g as IconName} size={size} />;
}

/**
 * The head — `eyebrow` (where it lives) above the name, `meta` the one line
 * under it. `onClose` draws a close button; only a card that floats with no
 * anchor (the centred variant) needs one — Escape and a press outside close
 * the rest.
 */
export function PopMast({
  dot,
  eyebrow,
  meta,
  under,
  onClose,
  children,
}: {
  /** Identity colour — the calendar's, or the domain's. */
  dot?: string | null;
  eyebrow?: React.ReactNode;
  meta?: React.ReactNode;
  /** One line under the meta that isn't the when (a waiting name). */
  under?: React.ReactNode;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="insp-head" data-nodot={dot ? undefined : ""}>
      {eyebrow && <div className="insp-eyebrow">{eyebrow}</div>}
      <div className="insp-title">
        {dot && <Dot color={dot} />}
        <div className="insp-title-main">{children}</div>
        {onClose && <IconButton size="xs" label="Close" shortcut="Esc" icon={<Icon name="close" size={14} />} onClick={onClose} />}
      </div>
      {meta && <div className="insp-meta">{meta}</div>}
      {under && <div className="insp-under">{under}</div>}
    </div>
  );
}

/** A dot separator for the meta line. */
export function PopMetaDot() {
  return (
    <span className="insp-meta-sep" aria-hidden>
      ·
    </span>
  );
}

/** The strip — the reason the card was opened. At most two acts. */
export function PopStrip({ children }: { children: React.ReactNode }) {
  return <div className="insp-strip">{children}</div>;
}

/** The scrolling middle: rows and sections. */
export function PopBody({ children }: { children: React.ReactNode }) {
  return <div className="insp-body">{children}</div>;
}

/**
 * A property row: a leading glyph (its name is the tooltip and the group's
 * label), then the value — a value you press, an inline field, a control.
 */
export function PopRow({
  icon,
  label,
  top,
  children,
}: {
  icon: GlyphRef;
  label: string;
  /** Multi-line content — the glyph sits on the first line. */
  top?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="insp-row" data-top={top || undefined} role="group" aria-label={label}>
      <span className="insp-ico" title={label}>
        {glyph(icon)}
      </span>
      <div className="insp-val">{children}</div>
    </div>
  );
}

/** A section — words, people, steps — under a quiet label. `aside` rides the
 *  label's right edge (a count, a summary). */
export function PopSection({
  label,
  icon,
  aside,
  children,
}: {
  label?: React.ReactNode;
  icon?: GlyphRef;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="insp-sec">
      {(label || aside) && (
        <div className="insp-sec-head">
          {icon && glyph(icon, 13)}
          {label && <span>{label}</span>}
          {aside && <span className="insp-aside">{aside}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

/** The footer — navigation left, the destructive act right. */
export function PopFooter({ children }: { children: React.ReactNode }) {
  return <div className="insp-foot">{children}</div>;
}

/** The footer's flexible gap. */
export function PopGrow() {
  return <span className="k-grow" />;
}

/**
 * A footer act: a ghost button, text or a glyph. With `icon` and no children
 * it is an icon button whose `title` is its name. `href` opens a link in a new
 * window (the native shells open links only through `_blank`).
 */
export function PopFootAct({
  onClick,
  href,
  title,
  icon,
  danger,
  expanded,
  children,
}: {
  onClick?: () => void;
  href?: string;
  title?: string;
  icon?: GlyphRef;
  /** Destructive — quiet at rest, red under the pointer and while it asks. */
  danger?: boolean;
  /** It opened a question beneath it (a scope menu). */
  expanded?: boolean;
  children?: React.ReactNode;
}) {
  const g = icon ? glyph(icon) : undefined;
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        aria-label={children ? undefined : title}
        className="k-btn"
        data-kind="ghost"
        data-size="xs"
        data-icon={children ? undefined : ""}
      >
        {g}
        {children}
      </a>
    );
  }
  if (g && !children) {
    return (
      <IconButton
        size="xs"
        label={title ?? ""}
        icon={g}
        onClick={onClick}
        aria-expanded={expanded}
        data-quiet-danger={danger ? "" : undefined}
      />
    );
  }
  return (
    <Button
      kind="ghost"
      size="xs"
      icon={g}
      onClick={onClick}
      title={title}
      aria-expanded={expanded}
      data-quiet-danger={danger ? "" : undefined}
    >
      {children}
    </Button>
  );
}

/**
 * A toggle group in the kit's trough — the RSVP, priority. Unlike the kit's
 * Segmented (a radio group that always holds a value) "nothing chosen yet" is
 * a state it can show, so each button is a toggle (`aria-pressed`).
 */
export type PopSegment<T extends string> = { value: T; label: string; dot?: string; disabled?: boolean; title?: string };

export function PopSegmented<T extends string>({
  segments,
  value,
  onPick,
  ariaLabel,
  disabled,
}: {
  segments: readonly PopSegment<T>[];
  value: T | null;
  onPick: (v: T) => void;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="k-seg">
      {segments.map((s) => (
        <button
          key={s.value}
          type="button"
          aria-pressed={value === s.value}
          disabled={disabled || s.disabled}
          title={s.title}
          onClick={() => onPick(s.value)}
        >
          {s.dot && <Dot color={s.dot} shape="round" size="sm" />}
          {s.label}
        </button>
      ))}
    </div>
  );
}

/** The one filled act in a strip (Join, Done). An `href` is a link styled as
 *  the button. */
export function PopPrimary({
  onClick,
  href,
  icon,
  children,
  disabled,
}: {
  onClick?: () => void;
  href?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="k-btn" data-kind="primary">
        {icon}
        {children}
      </a>
    );
  }
  return (
    <Button kind="primary" icon={icon} onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  );
}

/**
 * Placeholder lines for a section whose content is still in flight. They hold
 * the shape rather than announcing it. A hairline's contrast only — a
 * skeleton is furniture, never content.
 */
export function PopSkeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  const widths = ["78%", "62%", "70%", "54%", "66%", "58%"];
  return (
    <div className={`flex flex-col gap-2 py-1 ${className}`} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="pop-skeleton block h-[9px]" style={{ width: widths[i % widths.length] }} />
      ))}
    </div>
  );
}

/** The inline, borderless editable value — the inspector's input voice. */
export const POP_INPUT_CLS = "insp-input";

/**
 * A value that opens a kit Picker — the project, a length, a domain. Looks
 * like the other values in its row; the menu searches past seven options.
 */
export function PopPick<T extends string>({
  value,
  options,
  onChange,
  label,
  children,
  empty,
  lead,
}: {
  value: T | null;
  options: readonly PickerOption<T>[];
  onChange: (v: T) => void;
  /** The picker's name — its search placeholder, aria-label and tooltip. */
  label: string;
  /** What the value reads as. */
  children: React.ReactNode;
  /** Nothing chosen: the value reads quiet. */
  empty?: boolean;
  lead?: React.ReactNode;
}) {
  const [btn, setBtn] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={setBtn}
        type="button"
        className="insp-v"
        data-empty={empty || undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        {lead}
        <span>{children}</span>
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

/** A shortcut as keycaps, in the platform's spelling: "⌘E" → ⌘ · E on a
 *  Mac, Ctrl · E elsewhere (lib/shortcutLabel). */
export function keycaps(mac: string): string[] {
  const label = shortcutLabel(mac);
  if (label.includes("+") && label.length > 1) return label.split("+");
  const m = label.match(/^([⌃⌘⌥⇧]*)(.*)$/);
  if (!m || !m[1]) return [label];
  return [...m[1], m[2]].filter(Boolean);
}

/** A press that landed in a floating layer of its own (a picker, a menu) is
 *  not a press outside the card that opened it. */
export function inNestedSurface(e: Event): boolean {
  const t = e.target;
  return t instanceof Element && Boolean(t.closest("[data-nested-surface]"));
}
