// The parts every phone detail sheet is built from — the event, the task and
// the standing block (D-162), drawn by styles/phone.css at touch size.
//
// They answer the same questions in the same order (docs/design-language.md,
// "Detail popovers — one grammar", D-101), so they are shared code, not a
// convention — a layout convention that lives in three files has already
// drifted.
//
//   mast       what is this, and when — the name IS the hero (22/700), ONE
//              muted line under it
//   strip      the act you opened it for (Join · Going? · Done) — at most two
//              thumb-sized kit Buttons
//   sections   a 12px name → content, one rhythm
//   rows       48px, hairline-separated, glyph · label · value · chevron
//   foot       the destructive act on its own, as --danger text
//
// Mobile-only on purpose: none of this is mounted on the desktop shell.

import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type Ref, type UIEvent } from "react";
import { Icon, type IconName } from "../Icon";
import { Dot } from "../kit";
import { toDateISO, todayISO, tomorrowISO } from "../../lib/dates";
import Sheet from "./Sheet";
import { TouchButton } from "./touch";

/** Pass as `contentClassName` so the Sheet's own body IS the scroller. It fills
 *  whatever height the Sheet grants (`min-h-0 flex-1`), so the keyboard inset and
 *  the home-indicator pad shrink it instead of pushing the last row under them —
 *  the old `max-h-[78vh]` was a number unrelated to the Sheet's `88dvh` cap. */
export const SHEET_SCROLL = "mobile-scroll overflow-y-auto";

/** The padding wrapper every sheet body sits in: a 20px inset (rows inside it
 *  bleed to the sheet's edges), and a bottom pad that clears the home bar. */
export const SHEET_BODY = "ph-body pb-8";

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
        className="fast absolute inset-0 flex items-center text-body font-medium text-muted"
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
 *  edge (domain hue — identity); `crumb` is a quiet line above the name; `lead`
 *  stands left of the name (the task's 20px TaskCheck). The name itself should
 *  wear `ph-mast-title` (22/700). */
export function SheetMast({
  color,
  crumb,
  lead,
  children,
  meta,
}: {
  color?: string | null;
  crumb?: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="ph-mast" data-spine={color ? "" : undefined}>
      {color && <span className="ph-mast-spine" style={{ background: color }} aria-hidden />}
      {crumb && <div className="ph-mast-crumb">{crumb}</div>}
      {lead ? (
        <div className="flex items-start gap-3">
          <span className="mt-[5px] flex shrink-0">{lead}</span>
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      ) : (
        children
      )}
      {meta && (
        <div className="ph-mast-meta" style={lead ? { paddingLeft: 32 } : undefined}>
          {meta}
        </div>
      )}
    </div>
  );
}

export function MetaDot() {
  return (
    <span className="text-faint" aria-hidden>
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
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  /** The textarea itself, for a parent that has to focus it (the notes field
   *  swaps this in under your finger and must raise the keyboard in the same tap). */
  inputRef?: Ref<HTMLTextAreaElement>;
  placeholder?: string;
  /** Inline, for the padding `.field`'s unlayered CSS would otherwise win (see the
   *  three CSS traps in CLAUDE.md) — e.g. clearing an icon in the gutter. */
  style?: CSSProperties;
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
      // A one-line title is bare text — 25px of target. Padding buys the 44px
      // thumb area and the matching negative margin hands the layout back.
      className={`block w-full resize-none overflow-hidden outline-none placeholder:text-faint ${
        single ? "-my-2.5 py-2.5" : ""
      } ${className}`}
      style={style}
    />
  );
}

// ── Sections & chips ────────────────────────────────────────────────────────

/** One rhythm for every sheet: 24px between sections, 6px from name to content.
 *  The name is a plain 12px label in sentence case — no eyebrow caps. */
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
    <section className={`ph-sec ${className}`}>
      {(label || aside) && (
        <div className="ph-sec-head">
          {label && <div>{label}</div>}
          {aside && <div className="ph-sec-aside">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** The strip under the mast: the act you opened the sheet for — at most two,
 *  each a thumb-sized kit Button, sharing the row equally. */
export function SheetStrip({ children }: { children: ReactNode }) {
  return <div className="ph-strip">{children}</div>;
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
      className="ph-chip"
    >
      {children}
    </button>
  );
}

// ── Rows ────────────────────────────────────────────────────────────────────

/** Hairline-separated 48px rows, edge to edge of the sheet — no card around
 *  them. Inside `SHEET_BODY` they bleed to the sheet's edges and keep their
 *  text on the body's inset; anywhere else they sit flush. */
export function RowList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`ph-rows ${className}`}>{children}</div>;
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
    <button type="button" onClick={onClick} className="ph-row row-hover">
      <span className="ph-row-lead">{lead ?? (icon && <Icon name={icon} size={18} />)}</span>
      <span className="ph-row-label">{label}</span>
      <span className="ph-row-value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
      <Icon name="chevron-right" size={16} className="ph-row-chev" />
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
  const lead = (
    <span className="ph-row-lead" style={glyph ? { color: "var(--accent-ink)" } : undefined}>
      {glyph ? <span className="text-lead leading-none">{glyph}</span> : icon && <Icon name={icon} size={18} />}
    </span>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="ph-row row-hover" data-quiet={quiet || undefined}>
        {lead}
        <span className="ph-row-label" data-grow="">
          {label}
        </span>
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className="ph-row row-hover" data-quiet={quiet || undefined}>
      {lead}
      <span className="ph-row-label" data-grow="">
        {label}
      </span>
    </button>
  );
}

/** The destructive act, alone at the foot of the sheet: `--danger` text at
 *  rest, and the confirm it arms is the SAME height as the row it replaces, so
 *  nothing under it jumps (D-101). `confirm={false}` hands straight to the
 *  caller — a repeating event asks "which occurrences?" itself, and two
 *  questions in a row is one too many. */
export function DestructiveRow({
  label,
  confirmLabel = "Delete",
  confirm = true,
  icon = "trash",
  onConfirm,
  prompt,
  alt,
}: {
  label: string;
  confirmLabel?: string;
  confirm?: boolean;
  icon?: IconName;
  onConfirm: () => void;
  /** What the act will do, said before you commit — "Cancel for 6 guests?" */
  prompt?: string;
  /** A second, gentler way to do it (Cancel quietly). With one, the armed state
   *  stacks full-width — three verbs side by side don't fit a 320px phone. */
  alt?: { label: string; onConfirm: () => void };
}) {
  const [armed, setArmed] = useState(false);
  // The row sits at the very foot of a long sheet, so the choices it arms open
  // below the fold — bring them up rather than leave "Keep it" off-screen.
  const armedRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (armed) armedRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [armed]);
  if (armed && (alt || prompt)) {
    return (
      <div ref={armedRef} className="mt-6 grid gap-2">
        {prompt && <p className="text-body text-ink">{prompt}</p>}
        <TouchButton kind="danger-solid" full onClick={onConfirm}>
          {confirmLabel}
        </TouchButton>
        {alt && (
          <TouchButton full onClick={alt.onConfirm}>
            {alt.label}
          </TouchButton>
        )}
        <TouchButton kind="ghost" full onClick={() => setArmed(false)}>
          Keep it
        </TouchButton>
      </div>
    );
  }
  if (armed) {
    return (
      <div className="mt-6 grid min-h-12 grid-cols-2 items-center gap-2">
        <TouchButton full onClick={() => setArmed(false)}>
          Cancel
        </TouchButton>
        <TouchButton kind="danger-solid" full onClick={onConfirm}>
          {confirmLabel}
        </TouchButton>
      </div>
    );
  }
  return (
    <div className="mt-6">
      <button type="button" className="ph-danger" onClick={() => (confirm ? setArmed(true) : onConfirm())}>
        <Icon name={icon} size={18} />
        {label}
      </button>
    </div>
  );
}

// ── The answer to a question: Going? ────────────────────────────────────────

export type ResponseOption<T extends string> = { value: T; label: string; glyph: string; tone: "ok" | "warn" | "signal" };

/** The RSVP control at thumb size — a segmented trough. The chosen answer is
 *  lifted onto --raised and carries its verdict token (`--ok` / `--warn` /
 *  `--signal`) as the GLYPH's ink while the label stays ink, because a verdict
 *  token is a legible *mark* at ~3.3:1 and an illegible *label*. */
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
      className="ph-verdict"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" aria-pressed={on} disabled={disabled} onClick={() => onPick(o.value)}>
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
  /** A consequence worth knowing before you pick — never an explanation of
   *  the list itself (the title says what it is). */
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
      aria-pressed={on}
      className="ph-row row-hover"
    >
      <span className="ph-row-lead" style={r.color ? { color: r.color } : undefined}>
        {r.lead ?? <Dot color={r.color ?? "var(--faint)"} shape="round" />}
      </span>
      <span className="min-w-0 flex-1 py-2">
        <span className={`ph-row-label block truncate ${r.id ? "" : "!text-muted"}`}>{r.name}</span>
        {r.sub && <span className="block truncate text-caption text-muted">{r.sub}</span>}
      </span>
      {on && <Icon name="check" size={18} className="shrink-0 text-accent" />}
    </button>
  );
  return (
    <Sheet title={title} onClose={onClose} contentClassName={SHEET_SCROLL}>
      <div className={SHEET_BODY}>
        {note && <p className="pb-3 text-caption text-muted">{note}</p>}
        <RowList>
          {noneLabel && row({ id: "", name: noneLabel }, !value)}
          {rows.map((r) => row(r, r.id === value))}
        </RowList>
      </div>
    </Sheet>
  );
}
