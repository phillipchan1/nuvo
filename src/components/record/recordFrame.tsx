// The record's frame — the sheet, the identity head, the two-column body, the
// section rule, the rail. Extracted from RecordModal so that BIRTH AND LIFE WEAR
// ONE SKELETON: `CreateRecord` (new project / new initiative) is this same frame
// with a draft inside it, not a second design language.
//
// That was the bug worth fixing. Creating used to open a bordered form — eyebrow
// + instructional headline, a pill row per domain, a boxed name field with a flat
// focus ring, hardcoded px type — while the thing it created opened as a document
// with a Fraunces masthead on one 26px spine. The object changed typeface at
// birth, and "more options…" swapped in a THIRD layout mid-typing. A different
// layout for creating is right (create is one field and a commit; the record is
// accumulated state). A different grammar for the same object never is.
//
// So the rules live here, once:
//   · ONE SPINE — every control hangs in a 26px gutter, one left edge.
//   · ONE HERO — Fraunces carries the name, and only the name.
//   · THE RULE IS THE METER — the hairline under a heading fills to the domain hue.
//   · THE RAIL IS ANNOTATION — no enclosures, no chroma, resting at 78%.
//   · FOCUS LIFTS, IT DOESN'T OUTLINE.

import { useEffect, type ReactNode, type RefObject } from "react";
import { Icon } from "../Icon";
import { createPortal } from "react-dom";
import { InlineText } from "../floors/parts";
import { READY } from "../floors/ReadinessBanner";
import { isTypingIn } from "../floors/TaskList";

/** The gutter every control hangs in. One number, so the spine can't drift. */
export const GUT = "w-[26px]";
export const GUT_PAD = "pl-[26px]";

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
      className="fixed inset-0 z-[81] flex items-start justify-center px-4 py-[5vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Blur and dim split so only the (cheap) dim fades — animating opacity on
          the same element as backdrop-filter forces a re-blur every frame,
          which is what made the record open read as a slow-motion fade. */}
      <div className="scrim-blur fixed inset-0 backdrop-blur-[3px]" aria-hidden="true" />
      <div className="scrim pointer-events-none fixed inset-0 bg-black/35" aria-hidden="true" />
      {children}
    </div>,
    document.body,
  );
}

// ── The sheet ────────────────────────────────────────────────────────────────
// The altitude tell is the sheet's own left edge, exactly DeckCard's law: a
// project wears a 3px spine inset from the ends, a bet the same colour at 5px
// running full-height as the actual boundary. Scope reads as mass — never as a
// different species.
export function Sheet({
  variant,
  spine,
  wide,
  sheetRef,
  children,
}: {
  variant: "marked" | "bounded";
  spine: string;
  /** the coach's margin needs a wider sheet to lay its notes in. */
  wide: boolean;
  sheetRef: RefObject<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div
      ref={sheetRef}
      role="dialog"
      aria-modal="true"
      className={`moment elev-3 fast relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-bg ${
        wide ? "max-w-[1180px]" : "max-w-[1000px]"
      }`}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute z-10"
        style={
          variant === "bounded"
            ? { insetBlock: 0, left: 0, width: 5, background: spine, borderRadius: "var(--radius-lg) 0 0 var(--radius-lg)" }
            : { top: 18, bottom: 18, left: 7, width: 3, background: spine, borderRadius: 999 }
        }
      />
      {children}
    </div>
  );
}

// ── Identity: crumbs + acts, the name, the outcome ───────────────────────────
export function Head({
  crumbs,
  acts,
  name,
  onName,
  namePlaceholder = "Untitled",
  autoFocusName = false,
  titlePrefix,
  outcome,
  onOutcome,
  outcomePlaceholder,
}: {
  crumbs: ReactNode;
  acts: ReactNode;
  name: string;
  onName: (v: string) => void;
  namePlaceholder?: string;
  /** create only: the name is the first thing you'd type, so take the caret. */
  autoFocusName?: boolean;
  /** Ship / complete control beside the masthead (project records). */
  titlePrefix?: ReactNode;
  outcome: string;
  onOutcome: (v: string) => void;
  outcomePlaceholder: string;
}) {
  return (
    <div className="shrink-0 pb-4 pl-[30px] pr-4 pt-3">
      <div className="mb-2.5 flex items-center gap-2">
        {crumbs}
        <div className="flex-1" />
        {acts}
      </div>
      {/* the ONE hero. Fraunces carries a name, never a number. */}
      <div className="flex items-start gap-2.5">
        {titlePrefix}
        <h1 className="min-w-0 flex-1 text-display masthead leading-tight">
          <InlineText
            value={name}
            onChange={onName}
            placeholder={namePlaceholder}
            autoFocusEmpty={autoFocusName}
            live={autoFocusName}
          />
        </h1>
      </div>
      {/* No "GOAL" eyebrow: a lead line directly under a name is self-evidently
          the outcome, and the placeholder teaches it when empty (D-041 — a thing
          is named once). Set below the hero, not beside it. */}
      <div
        className="mt-1.5 max-w-[62ch] text-head leading-snug"
        style={{ color: "color-mix(in srgb, var(--text) 72%, var(--muted))" }}
      >
        <InlineText value={outcome} onChange={onOutcome} placeholder={outcomePlaceholder} />
      </div>
    </div>
  );
}

export function IconBtn({
  glyph,
  label,
  onClick,
  badge,
  btnRef,
}: {
  glyph: string;
  label: string;
  onClick: () => void;
  badge?: number;
  btnRef?: RefObject<HTMLButtonElement>;
}) {
  return (
    <button
      ref={btnRef}
      onClick={onClick}
      title={label}
      aria-label={label}
      className="fast relative flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-caption text-muted opacity-75 hover:bg-surface hover:text-ink hover:opacity-100"
    >
      {glyph}
      {badge != null && badge > 0 && (
        // muted, not filled: a bright dot in the top-right corner pulled the eye
        // away from the work as hard as the rail did.
        <span className="mono absolute right-0 top-0 text-micro font-semibold text-muted">{badge}</span>
      )}
    </button>
  );
}

export function MenuItem({ children, onClick, color }: { children: ReactNode; onClick: () => void; color?: string }) {
  return (
    <button
      onClick={onClick}
      className="fast block w-full px-2.5 py-1 text-left text-label hover:bg-accent-soft"
      style={color ? { color } : undefined}
    >
      {children}
    </button>
  );
}

// ── Body: the work, and the rail beside it ───────────────────────────────────
export function Body({
  main,
  rail,
  overlay,
  scrollRef,
  assessing = false,
}: {
  main: ReactNode;
  rail: ReactNode;
  overlay?: ReactNode;
  scrollRef?: RefObject<HTMLDivElement>;
  assessing?: boolean;
}) {
  return (
    <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
      {/* The rail column keeps its track while assessing — that empty gutter is
          where AssessLayer lays its margin notes. */}
      <div className={`grid grid-cols-1 ${assessing ? "lg:grid-cols-[1fr_320px]" : "lg:grid-cols-[1fr_236px]"}`}>
        <div className="min-w-0 pb-7 pl-[30px] pr-6 pt-4">{main}</div>
        <div className="fast flex flex-col gap-5 border-t border-line px-5 pb-7 pt-4 opacity-[0.78] hover:opacity-100 focus-within:opacity-100 lg:border-l lg:border-t-0">
          {rail}
        </div>
      </div>
      {overlay}
    </div>
  );
}

/** A section of the work. The hairline under the heading IS the meter. */
export function Sec({
  label,
  meter,
  fill,
  spine,
  children,
}: {
  label: string;
  meter?: string | null;
  /** 0–100, or null for a section with nothing to measure (the Log, a draft). */
  fill?: number | null;
  spine: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-6 first:mt-0">
      <div className={`flex items-baseline gap-3 ${GUT_PAD}`}>
        <span className="section-label flex-1" style={{ color: "color-mix(in srgb, var(--text) 55%, var(--muted))" }}>
          {label}
        </span>
        {meter && <span className="mono text-meta text-muted">{meter}</span>}
      </div>
      <div className="relative mt-1.5 h-0.5 rounded-full" style={{ background: "var(--line)" }}>
        {fill != null && (
          <div
            className="fast absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${Math.max(0, Math.min(100, fill))}%`, background: spine }}
          />
        )}
      </div>
      {children}
    </section>
  );
}

export function RailSec({ label, right, children }: { label: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="section-label mb-2 flex items-center gap-1.5">
        <span className="flex-1">{label}</span>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Readiness as a checklist you watch fill in, not a sentence and not a dial.
 *  The finish line is deliberately absent — the placement band right above says
 *  whether one is set, and a thing is named once (D-041). Met axes wear the same
 *  green check the spine uses at rest; unmet axes stay hollow. */
function ReadyMark({ met }: { met: boolean }) {
  const box = "flex h-[11px] w-[11px] shrink-0 items-center justify-center";
  if (met) {
    return (
      <span className={box} style={{ color: `color-mix(in srgb, ${READY} 66%, var(--muted))` }} aria-hidden>
        <Icon name="check" size={11} />
      </span>
    );
  }
  return (
    <span
      className={`${box} rounded-full`}
      style={{ boxShadow: "inset 0 0 0 1px var(--line-strong)" }}
      aria-hidden
    />
  );
}

export function ReadyTicks({ axes }: { axes: { label: string; met: boolean }[] }) {
  const all = axes.length > 0 && axes.every((a) => a.met);
  return (
    <RailSec
      label="Ready"
      right={all ? <ReadyMark met /> : undefined}
    >
      <div className="flex flex-col gap-1.5">
        {axes.map((a) => (
          <div
            key={a.label}
            className={`flex items-center gap-2 text-meta text-muted ${a.met ? "" : "opacity-60"}`}
            title={a.met ? `${a.label} — set` : `${a.label} — not set yet`}
          >
            <ReadyMark met={a.met} />
            {a.label}
          </div>
        ))}
      </div>
    </RailSec>
  );
}
