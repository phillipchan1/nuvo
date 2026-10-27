// The parts every phone detail sheet is built from — the event, the task and
// the standing block.
//
// They answer the same questions in the same order (docs/design-language.md,
// "Detail popovers — one grammar", D-101) and used to do it with three hand-
// rolled stacks: two private copies of `Section` and `Chip`, a 39px input recipe
// the field primitives retired, a `max-h-[78vh]` scroller that disagreed with the
// Sheet's own `88dvh` cap, and a bottom row of three equal bordered buttons with
// an emoji bin under them. A layout convention that lives in three files has
// already drifted — so these are shared code, not a convention.
//
//   mast       what is this, and when — the title IS the hero, ONE muted line
//   strip      the act you opened it for (Join · Going? · Done) — at most two
//   sections   label → content, one rhythm
//   rows       hairline-separated, 44px, icon in a gutter — dissolve, don't frame
//   footer     quiet acts, then the destructive one on its own, as text
//
// Mobile-only on purpose: none of this is mounted on the desktop shell.

import { useCallback, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type Ref, type UIEvent } from "react";
import { Icon, type IconName } from "../Icon";
import { toDateISO, todayISO, tomorrowISO } from "../../lib/dates";
import Sheet from "./Sheet";

/** Pass as `contentClassName` so the Sheet's own body IS the scroller. It fills
 *  whatever height the Sheet grants (`min-h-0 flex-1`), so the keyboard inset and
 *  the home-indicator pad shrink it instead of pushing the last row under them —
 *  the old `max-h-[78vh]` was a number unrelated to the Sheet's `88dvh` cap. */
export const SHEET_SCROLL = "mobile-scroll overflow-y-auto";

/** The padding wrapper every sheet body sits in. Bottom pad clears the home bar. */
export const SHEET_BODY = "px-4 pb-6";

export const fmtDay = (d: Date) => d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

/** "Today" / "Tomorrow" when the day is one of those, else "Wed, Oct 14" — the
 *  mast says what the day IS rather than making you do the date arithmetic. */
export function dayWord(d: Date): string {
  const iso = toDateISO(d);
  if (iso === todayISO()) return "Today";
  if (iso === tomorrowISO()) return "Tomorrow";
  return fmtDay(d);
}

// ── Title row ───────────────────────────────────────────────────────────────

/** The Sheet's title row, in two states cross-faded in place: what KIND of thing
 *  this is at rest (quiet — the hero below is the name), the name itself once
 *  you've scrolled past the hero. Printing both at once was two near-equal
 *  peers, and a scrolled sheet lost track of whose Delete button it was holding.
 *  Same collapse the record sheet makes (MobileDetailSheet). */
export function useSheetTitle(kind: string, name: string) {
  const [scrolled, setScrolled] = useState(false);
  const onContentScroll = (e: UIEvent<HTMLDivElement>) => {
    const past = e.currentTarget.scrollTop > 56;
    setScrolled((v) => (v === past ? v : past));
  };
  const title = (
    <div className="relative h-8 min-w-0">
      <span
        className="fast absolute inset-0 flex items-center text-caption font-medium tracking-normal text-muted"
        style={{ opacity: scrolled ? 0 : 1 }}
        aria-hidden={scrolled}
      >
        {kind}
      </span>
      <span
        className="fast pointer-events-none absolute inset-0 flex items-center truncate"
        style={{ opacity: scrolled ? 1 : 0 }}
        aria-hidden={!scrolled}
      >
        {name || kind}
      </span>
    </div>
  );
  return { title, onContentScroll };
}

// ── Mast ────────────────────────────────────────────────────────────────────

/** The identity block. `color` draws the 3px spine the record wears at its left
 *  edge (domain hue — identity); `crumb` is a quiet line above the name. */
export function SheetMast({
  color,
  crumb,
  children,
  meta,
}: {
  color?: string | null;
  crumb?: ReactNode;
  children: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="relative pb-1 pt-1" style={color ? { paddingLeft: 14 } : undefined}>
      {color && (
        <span
          className="absolute bottom-1 left-0 top-1 w-[3px] rounded-full"
          style={{ background: color }}
          aria-hidden
        />
      )}
      {crumb && <div className="mb-1 flex min-w-0 items-center gap-1 text-meta text-muted">{crumb}</div>}
      {children}
      {meta && <div className="mono mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-caption text-muted">{meta}</div>}
    </div>
  );
}

export function MetaDot() {
  return (
    <span className="opacity-40" aria-hidden>
      ·
    </span>
  );
}

/** A textarea that grows with its text — a long title wraps instead of hiding
 *  behind one clipped line, and notes never open as a fixed empty box. Enter
 *  commits (blurs) when `single`, because a newline in a title is never wanted. */
export function AutoText({
  value,
  onChange,
  onBlur,
  onFocus,
  inputRef,
  placeholder,
  label,
  className = "",
  single = false,
  minRows = 1,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  /** The textarea itself, for a parent that has to focus it (the notes field
   *  swaps this in under your finger and must raise the keyboard in the same tap). */
  inputRef?: Ref<HTMLTextAreaElement>;
  placeholder?: string;
  label: string;
  className?: string;
  single?: boolean;
  minRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      ref.current = el;
      if (typeof inputRef === "function") inputRef(el);
      else if (inputRef) (inputRef as { current: HTMLTextAreaElement | null }).current = el;
    },
    [inputRef],
  );
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight stops at the padding edge; the box is border-box, so a bordered
    // field (the notes) was 2px short of its own text — and 2px off the read face
    // that stands in for it. Borderless titles add nothing.
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }, [value]);
  return (
    <textarea
      ref={setRef}
      value={value}
      rows={minRows}
      onChange={(e) => onChange(single ? e.target.value.replace(/\n/g, " ") : e.target.value)}
      onBlur={onBlur}
      onFocus={onFocus}
      onKeyDown={
        single
          ? (e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }
          : undefined
      }
      enterKeyHint={single ? "done" : undefined}
      placeholder={placeholder}
      aria-label={label}
      autoCapitalize="sentences"
      autoCorrect="on"
      spellCheck
      // A one-line title is bare text — 21px of target. Padding buys the 44px
      // thumb area and the matching negative margin hands the layout back.
      className={`block w-full resize-none overflow-hidden outline-none placeholder:text-muted/60 ${
        single ? "-my-3 py-3" : ""
      } ${className}`}
    />
  );
}

// ── Sections & chips ────────────────────────────────────────────────────────

/** One rhythm for every sheet: 24px between sections, 8px from label to content.
 *  (It was 16 / 6 — close enough that a label read as belonging to the section
 *  above it as much as the one below.) */
export function SheetSection({
  label,
  aside,
  children,
  className = "",
}: {
  label?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mt-6 ${className}`}>
      {(label || aside) && (
        <div className="mb-2 flex items-baseline gap-2">
          {label && <div className="section-label !p-0">{label}</div>}
          {aside && <div className="mono ml-auto text-micro text-muted">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Quick picks tile on a grid, never on a wrapping flow — a flow left "Pick
 *  time…" alone on a second line and put "2h 3h 4h" on a ragged third. */
export function ChipGrid({ cols, children }: { cols: 2 | 3 | 4; children: ReactNode }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {children}
    </div>
  );
}

export function Chip({
  children,
  on,
  onClick,
  span,
  disabled,
  ariaLabel,
}: {
  children: ReactNode;
  on?: boolean;
  onClick: () => void;
  /** Columns to take when inside a ChipGrid. */
  span?: number;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      aria-label={ariaLabel}
      style={span ? { gridColumn: `span ${span}` } : undefined}
      className={`tap fast inline-flex items-center justify-center rounded-full border px-3 text-body font-medium disabled:opacity-40 ${
        on ? "border-accent bg-accent text-on-accent" : "border-line text-muted active:bg-accent-soft"
      }`}
    >
      {children}
    </button>
  );
}

// ── Rows ────────────────────────────────────────────────────────────────────

/** Hairline-separated rows on the paper — no card around them. */
export function RowList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`divide-y divide-line border-y border-line ${className}`}>{children}</div>;
}

/** A settings-style row: glyph in the gutter, label, current value, chevron.
 *  Every row that OPENS something wears the chevron — Remind had none and read
 *  as static text next to a Repeat row that had one. */
export function FactRow({
  icon,
  lead,
  label,
  value,
  valueColor,
  onClick,
}: {
  icon?: IconName;
  /** a custom gutter mark (a domain symbol) instead of an icon */
  lead?: ReactNode;
  label: ReactNode;
  value?: ReactNode;
  valueColor?: string | null;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tap fast flex w-full items-center gap-3 text-left active:bg-accent-soft"
    >
      <span className="flex w-5 shrink-0 items-center justify-center text-muted">
        {lead ?? (icon && <Icon name={icon} size={16} />)}
      </span>
      <span className="shrink-0 text-body text-ink">{label}</span>
      <span
        className="ml-auto min-w-0 truncate text-body text-muted"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </span>
      <Icon name="chevron-right" size={14} className="shrink-0 text-muted/70" />
    </button>
  );
}

/** An act, as a row: glyph in the gutter + label. `glyph` is for the one mark
 *  that isn't an Icon — Nuvo's ✦. Emoji are never used: they ignore the palette
 *  and the 🗑 was the only full-colour thing on the sheet. */
export function ActionRow({
  icon,
  glyph,
  label,
  onClick,
  href,
  quiet,
}: {
  icon?: IconName;
  glyph?: string;
  label: ReactNode;
  onClick?: () => void;
  href?: string;
  quiet?: boolean;
}) {
  const cls = `tap fast flex w-full items-center gap-3 text-left active:bg-accent-soft ${
    quiet ? "text-muted" : "text-ink"
  }`;
  const lead = (
    <span className="flex w-5 shrink-0 items-center justify-center" style={glyph ? { color: "var(--accent)" } : undefined}>
      {glyph ? <span className="text-lead leading-none">{glyph}</span> : icon && <Icon name={icon} size={16} className={quiet ? "" : "text-muted"} />}
    </span>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {lead}
        <span className="text-body">{label}</span>
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {lead}
      <span className="text-body">{label}</span>
    </button>
  );
}

/** The destructive act, on its own below everything else: text at rest, and it
 *  only turns `--signal` once it asks you to confirm (D-101). The confirm state
 *  is the SAME height as the row it replaces, so nothing under it jumps.
 *  `confirm={false}` hands straight to the caller — a repeating event asks
 *  "which occurrences?" itself, and two questions in a row is one too many. */
export function DestructiveRow({
  label,
  confirmLabel = "Delete",
  confirm = true,
  icon = "trash",
  onConfirm,
}: {
  label: string;
  confirmLabel?: string;
  confirm?: boolean;
  icon?: IconName;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  if (armed) {
    return (
      <div className="grid grid-cols-2 items-center gap-2 py-px">
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="tap fast rounded-xl border border-line text-body text-muted active:bg-accent-soft"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="tap fast rounded-xl border border-signal bg-signal/10 text-body font-semibold text-signal"
        >
          {confirmLabel}
        </button>
      </div>
    );
  }
  return (
    <div className="border-y border-line">
      <ActionRow quiet icon={icon} label={label} onClick={() => (confirm ? setArmed(true) : onConfirm())} />
    </div>
  );
}

// ── The answer to a question: Going? ────────────────────────────────────────

export type ResponseOption<T extends string> = { value: T; label: string; glyph: string; tone: "ok" | "warn" | "signal" };

/** The RSVP control at thumb size. The chosen answer carries its verdict token
 *  (`--ok` / `--warn` / `--signal`) as TINT, BORDER and GLYPH while the label
 *  stays ink — the same rule the desktop's `PopSegmented` follows, because a
 *  verdict token is a legible *mark* at ~3.3:1 and an illegible *label*. It was
 *  three 60px blocks, one filled solid accent: the loudest thing on the sheet,
 *  louder than the name of the event it was asking about. */
export function ResponseSegmented<T extends string>({
  options,
  value,
  onPick,
  disabled,
  ariaLabel,
}: {
  options: ResponseOption<T>[];
  value: T | null;
  onPick: (v: T) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="grid overflow-hidden rounded-xl border border-line-strong bg-surface"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o, i) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onPick(o.value)}
            className={`tap fast flex items-center justify-center gap-1.5 text-body disabled:opacity-50 ${
              i > 0 ? "border-l border-line" : ""
            } ${on ? "font-semibold text-ink" : "font-medium text-muted active:bg-accent-soft"}`}
            style={
              on
                ? {
                    background: `color-mix(in srgb, var(--${o.tone}) 14%, transparent)`,
                    boxShadow: `inset 0 0 0 1px color-mix(in srgb, var(--${o.tone}) 45%, transparent)`,
                  }
                : undefined
            }
          >
            <span aria-hidden style={on ? { color: `var(--${o.tone})` } : undefined}>
              {o.glyph}
            </span>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── A list to choose from, in a Sheet ───────────────────────────────────────

export type PickRow = {
  id: string;
  name: string;
  /** a quieter second line — which domain a project is in */
  sub?: string;
  color?: string | null;
  lead?: ReactNode;
};

/** Choosing one of many belongs in a bottom Sheet, never in a chip wall and never
 *  in a cursor-anchored menu (rule 3). Project was a chip per project — fine at
 *  five, a screen of chips at thirty — and a loose task's domain was a floating
 *  `FloatingMenu`. Both are this. */
export function PickSheet({
  title,
  note,
  rows,
  value,
  noneLabel,
  onPick,
  onClose,
}: {
  title: string;
  note?: string;
  rows: PickRow[];
  value: string | null;
  /** Offers a leading "no X" row that picks `""`. */
  noneLabel?: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const pick = (id: string) => {
    onPick(id);
    onClose();
  };
  const row = (r: { id: string; name: string; sub?: string; color?: string | null; lead?: ReactNode }, on: boolean) => (
    <button
      key={r.id || "none"}
      type="button"
      onClick={() => pick(r.id)}
      className="tap fast flex w-full items-center gap-3 py-1.5 text-left active:bg-accent-soft"
    >
      <span className="flex w-5 shrink-0 items-center justify-center" style={r.color ? { color: r.color } : undefined}>
        {r.lead ?? <span className="h-2 w-2 rounded-full" style={{ background: r.color ?? "var(--line-strong)" }} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-ink">{r.name}</span>
        {r.sub && <span className="block truncate text-meta text-muted">{r.sub}</span>}
      </span>
      {on && <Icon name="check" size={16} className="shrink-0 text-accent" />}
    </button>
  );
  return (
    <Sheet title={title} onClose={onClose} contentClassName={SHEET_SCROLL}>
      <div className="px-4 pb-6">
        {note && <p className="pb-2 text-caption text-muted">{note}</p>}
        <div className="divide-y divide-line border-y border-line">
          {noneLabel && row({ id: "", name: noneLabel }, !value)}
          {rows.map((r) => row(r, r.id === value))}
        </div>
      </div>
    </Sheet>
  );
}
