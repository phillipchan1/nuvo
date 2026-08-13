import React from "react";
import { Icon } from "./Icon";

/**
 * ── One grammar for every detail popover ──────────────────────────────────
 *
 * The task, event and slot popovers answer the same three questions in the
 * same order, so they wear the same parts rather than three hand-rolled
 * stacks of `border-t` sections (which is how the event popover ended up with
 * a full-width All-day switch louder than "Join the meeting"):
 *
 *   masthead   what is this, and when — title + ONE muted meta line
 *   strip      the act you opened it for (Join · RSVP · Done) — at most two
 *   columns    left = the record's facts (when, where, filing)
 *              right = its words and people (guests, notes, pre-work)
 *   footer     quiet navigation left, the destructive act right — and the
 *              destructive one only turns `--signal` once it asks to confirm
 *
 * Two columns are for surfaces that carry prose or people; a bare event with
 * neither collapses to one (`POP_W_NARROW`). Consistency lives in these parts,
 * not in forcing every popover to the same width — see D-101 in decisions.md.
 *
 * Everything here is token-only (`--ink`, `--muted`, `--ok`, `--warn`,
 * `--signal`, domain colours), so all skins × palettes × light/dark follow
 * without a per-theme branch.
 */

/** Two-column detail card (guests / notes / a task list to the right). */
export const POP_W_WIDE = 560;
/** One-column card — a plain block with nothing to say on the right. */
export const POP_W_NARROW = 380;

/** Uppercase field caps. Quiet enough to skip when you know the layout. */
export function PopLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-micro font-semibold uppercase tracking-[0.075em] text-muted/85 ${className}`}>
      {children}
    </div>
  );
}

/**
 * Masthead — the identity block. `meta` is ONE line and carries what the read
 * needs before any control does: when it is, and whether it repeats.
 */
export function PopMast({
  dot,
  eyebrow,
  meta,
  onClose,
  children,
}: {
  /** Identity colour — the calendar's, or the domain's. */
  dot?: string | null;
  eyebrow?: React.ReactNode;
  meta?: React.ReactNode;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-start gap-2.5 px-4 pt-3.5 pb-3">
      {dot && (
        <span
          className="mt-[7px] h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: dot }}
          aria-hidden
        />
      )}
      <div className="min-w-0 flex-1">
        {eyebrow}
        {children}
        {meta && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-meta text-muted">
            {meta}
          </div>
        )}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="fast mt-0.5 shrink-0 rounded p-0.5 text-muted hover:bg-bg hover:text-ink"
          aria-label="Close"
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

/** A dot separator for the masthead's meta line. */
export function PopMetaDot() {
  return <span className="opacity-40" aria-hidden>·</span>;
}

/**
 * Action strip — the reason the popover was opened, on its own ground so it
 * never competes with the fields. At most two things live here.
 */
export function PopStrip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-y border-line bg-surface-2 px-4 py-2.5">
      {children}
    </div>
  );
}

/** The columns region. Each column scrolls on its own so a 20-guest meeting
 *  never pushes the notes out of reach. */
export function PopBody({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 items-stretch">{children}</div>;
}

export function PopCol({
  side = "left",
  width,
  children,
}: {
  side?: "left" | "right" | "only";
  /** CSS width — omit for the default 56/44 split. */
  width?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-col overflow-y-auto ${
        side === "left" ? "border-r border-line" : ""
      }`}
      style={{ width: width ?? (side === "only" ? "100%" : side === "left" ? "56%" : "44%") }}
    >
      {children}
    </div>
  );
}

/** A labelled field in the left column. */
export function PopField({
  label,
  children,
  className = "",
}: {
  label?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && <PopLabel>{label}</PopLabel>}
      {children}
    </div>
  );
}

/** Vertical rhythm inside a column — one padded stack, no inner hairlines. */
export function PopStack({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex flex-col gap-3 px-4 py-3 ${className}`}>{children}</div>;
}

/**
 * A block in the right column (Guests, Notes, ✦ Nuvo). `aside` rides the
 * label's right edge — a count or a summary — so it never needs its own row.
 */
export function PopSection({
  label,
  aside,
  divider = false,
  className = "",
  children,
}: {
  label?: React.ReactNode;
  aside?: React.ReactNode;
  /** Hairline above — used between stacked sections in the same column. */
  divider?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5 px-4 py-3 ${divider ? "border-t border-line" : ""} ${className}`}>
      {(label || aside) && (
        <div className="flex items-baseline gap-2">
          {label && <PopLabel>{label}</PopLabel>}
          {aside && <div className="mono ml-auto text-micro text-muted/75">{aside}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

/** Footer — quiet acts left, the destructive one right. */
export function PopFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2 border-t border-line px-3.5 py-2.5">
      {children}
    </div>
  );
}

/**
 * A quiet footer act. Text, not a button-looking Btn — the footer holds
 * navigation and rare transforms, and none of them is the primary.
 */
export function PopFootAct({
  onClick,
  href,
  title,
  danger,
  children,
}: {
  onClick?: () => void;
  href?: string;
  title?: string;
  /** Destructive — stays muted until hover, and only shouts once confirming. */
  danger?: boolean;
  children: React.ReactNode;
}) {
  const cls = `fast tap shrink-0 rounded-[var(--radius-sm)] px-1.5 py-1 text-label text-muted ${
    danger ? "hover:text-signal" : "hover:text-ink"
  }`;
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" title={title} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} title={title} className={cls}>
      {children}
    </button>
  );
}

/**
 * The response segmented control (RSVP). Compact by design: three 44px boxes
 * gave a one-tap decision a third of the card.
 *
 * The chosen answer carries its verdict token — `--ok` / `--warn` /
 * `--signal`, never a raw green — as the TINT, BORDER and GLYPH, while the
 * label itself stays `--ink`. `--ok` and `--warn` are ~3.3:1 on the light
 * paper grounds: fine for a mark (WCAG 1.4.11 wants 3:1), under AA for 11px
 * text. Putting the label in ink is what makes this read in every palette and
 * skin without a per-theme exception — see tests/token-contrast.test.ts.
 */
export type PopSegment<T extends string> = { value: T; label: string; glyph?: string; tone?: "ok" | "warn" | "signal" };

export function PopSegmented<T extends string>({
  segments,
  value,
  onPick,
  ariaLabel,
}: {
  segments: PopSegment<T>[];
  value: T | null;
  onPick: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex overflow-hidden rounded-[var(--radius-sm)] border border-line-strong bg-surface"
    >
      {segments.map((s, i) => {
        const on = value === s.value;
        const tone = s.tone ?? "ok";
        return (
          <button
            key={s.value}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(s.value)}
            className={`fast px-2.5 py-1.5 text-label ${i > 0 ? "border-l border-line" : ""} ${
              on ? "font-semibold text-ink" : "font-medium text-muted hover:bg-bg hover:text-ink"
            }`}
            style={
              on
                ? {
                    background: `color-mix(in srgb, var(--${tone}) 14%, transparent)`,
                    boxShadow: `inset 0 0 0 1px color-mix(in srgb, var(--${tone}) 45%, transparent)`,
                  }
                : undefined
            }
          >
            {s.glyph && (
              <span className="mr-1" style={on ? { color: `var(--${tone})` } : undefined} aria-hidden>
                {s.glyph}
              </span>
            )}
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

/** The one filled act in a strip (Join the meeting, Done). */
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
  const cls =
    "fast tap inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-sm)] bg-accent px-3 py-1.5 text-label font-semibold text-on-accent shadow-[var(--shadow-1)] hover:opacity-90 disabled:opacity-50";
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {icon}
      {children}
    </button>
  );
}

/**
 * Placeholder lines for a section whose content is still in flight. They hold
 * the shape rather than announcing it: an empty column that fills a beat later
 * reads as a broken card, and a spinner reads as a wait. `--line` only — a
 * skeleton is furniture, never content.
 */
export function PopSkeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  const widths = ["78%", "62%", "70%", "54%", "66%", "58%"];
  return (
    <div className={`flex flex-col gap-2 py-0.5 ${className}`} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className="pop-skeleton block h-[9px] rounded-full"
          style={{ width: widths[i % widths.length] }}
        />
      ))}
    </div>
  );
}

/** An inline, borderless editable value — the popover's default input voice. */
export const POP_INPUT_CLS =
  "fast -mx-1 min-w-0 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-body text-ink outline-none placeholder:text-muted/55 hover:border-line hover:bg-bg focus:border-line-strong focus:bg-bg";
