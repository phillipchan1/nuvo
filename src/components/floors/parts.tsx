// Shared building blocks for the vertical floors: inline editors, progress
// bars, status/momentum chips, an energy picker, and a zoomable Gantt timeline.
// Everything is keyboard-friendly and uses the Twilight tokens.

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { Icon } from "../Icon";
import { pressable } from "../../lib/a11y";
import { createPortal } from "react-dom";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  eachMonthOfInterval,
  eachWeekOfInterval,
  endOfMonth,
  endOfWeek,
  isWeekend,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import { ENERGY_META, ENERGY_ORDER, type Energy } from "../../lib/energy";
import type { Domain, Initiative, KeyResult, Momentum, Project, ProjectStatus } from "../../lib/vertical";
import { RIPENESS_HINT, RIPENESS_LABEL, type Ripeness } from "../../lib/tending";
import type { CollectionSelection } from "../../hooks/useCollectionSelection";
import { SelectCheckbox, itemSelectRowClass } from "./collectionSelection";
import DomainSymbol from "../domain/DomainSymbol";
import Sheet from "../mobile/Sheet";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useMenuFocus } from "../../hooks/useMenuFocus";
import { Target } from "lucide-react";
import { Button, Dot, IconButton, Segmented } from "../kit";

/** Menu portaled to <body> so it isn't clipped or covered by later table rows /
 *  overflow parents / the Record modal's `.moment` transform (which traps
 *  `position: fixed`). Without this, DomainPicker clicks land on the row
 *  underneath and the domain never changes. */
export function FloatingMenu({
  open,
  anchorRef,
  align = "left",
  minWidth = 150,
  onClose,
  children,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  align?: "left" | "right";
  minWidth?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // On a phone a choice of one-of-many is a bottom sheet, never an anchored
  // dropdown (CLAUDE.md, sheetKit's PickSheet rule) — the same children, framed
  // as an action sheet with thumb-sized rows.
  const mobile = useIsMobile();
  // Desktop: arrows / type-ahead, focus back to the trigger on close.
  useMenuFocus(menuRef, open && !mobile);

  useLayoutEffect(() => {
    if (!open || mobile) {
      setPos(null);
      return;
    }
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const mw = menuRef.current?.offsetWidth ?? minWidth;
      const mh = menuRef.current?.offsetHeight ?? 0;
      let left = align === "right" ? r.right - mw : r.left;
      let top = r.bottom + 4;
      if (left + mw > window.innerWidth - 8) left = window.innerWidth - 8 - mw;
      left = Math.max(8, left);
      if (mh > 0 && top + mh > window.innerHeight - 8) top = Math.max(8, r.top - 4 - mh);
      setPos({ top, left });
    };
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    // capture: table bodies / modal scrollers scroll without bubbling
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, mobile, align, anchorRef, minWidth]);

  if (!open) return null;
  if (mobile) {
    return (
      <Sheet onClose={onClose}>
        <div className="native-sheet-menu px-2 pb-3 pt-1" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      </Sheet>
    );
  }
  // Above RecordScrim (z-81). The sheet climbed over the walkthrough (teach
  // dim 78 · orb 79 · panel 80); this menu used to sit at 70/71 — under that
  // sheet — so the record kebab (and every picker inside a record) opened a
  // portal nobody could see. Vera 2026-08-23.
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[82]"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        ref={menuRef}
        data-nested-surface=""
        className="pop-in [--pop-origin:top_left] elev-2 fixed z-[83] rounded-md border border-line bg-surface py-1"
        style={{
          top: pos?.top ?? -9999,
          left: pos?.left ?? -9999,
          minWidth,
          opacity: pos ? undefined : 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

/** Translucent tint of an item's identity (domain) color — the one way every
 *  collection view fills a chip / bar. Uses color-mix so it is robust for hex,
 *  rgb() AND CSS tokens like var(--accent): string-concatenating a hex alpha
 *  (`${color}1f`) silently produces invalid CSS for a domainless record (whose
 *  accent is "var(--accent)"), which is why those chips rendered with no fill. */
export const softTint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

// ── Shared status vocab (kept here so board/detail/initiative agree) ─────────
export const PROJECT_STATUS: ProjectStatus[] = ["backlog", "in_progress", "waiting", "cancelled", "complete"];
// `--ok` / `--warn` are tokens, not hexes, for the same reason every other colour
// here is: a skin has to be able to answer for every colour on screen. These two
// were raw amber/teal, so they leaked full saturation into e-ink (which is meant
// to have none) and into the editor schemes (which publish their own ramp).
// READY — the readiness meter's ripe fill — is `complete`, so this is also the
// one place that decides what "done" looks like across the whole app.
import { PROJECT_STATUS_COLORS } from "./statusColors";
export { PROJECT_STATUS_COLORS };
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  backlog: "Backlog",
  in_progress: "In progress",
  waiting: "Waiting",
  cancelled: "Cancelled",
  // A project/initiative SHIPS; only a task is "done". This label read
  // "Complete" while the record said "Done" and the wall said "Shipped" — three
  // words for one act.
  complete: "Shipped",
};
// Initiatives speak the same status vocabulary as projects now — reuse
// PROJECT_STATUS / PROJECT_STATUS_COLORS / PROJECT_STATUS_LABEL above.
// The mark a finished project/initiative wears is `ShipStamp`
// (`src/components/ShipStamp.tsx`) — promoted out of this file once it grew
// real animation state and callers outside floors/.

// ── Ripeness — how shaped a record is, drawn as the kit's readiness pie ──────
// One source for the mark is the computed Ripeness. Raw is the dashed ring, the
// two middle stages fill a third and two thirds, Active is the full pie. A
// structurally-Active record Nuvo hasn't verified sound keeps the full pie but
// wears an amber ring, so the portfolio shows TRUE readiness, not filled boxes.
const RIPE_GREEN = PROJECT_STATUS_COLORS.complete;
const RIPE_STEP: Record<Ripeness, "0" | "1" | "2" | "3"> = {
  raw: "0",
  shaped: "1",
  scaffolded: "2",
  active: "3",
  resting: "0",
};

/** `unsound` marks a structurally-Active item Nuvo hasn't verified sound. Only
 *  meaningful on the Active stage. `size` is the old dot's radius: the pie is
 *  drawn at twice it (7 → the kit's 14px). */
export function RipenessPip({ stage, unsound = false, size = 7 }: { stage: Ripeness; unsound?: boolean; size?: number }) {
  const resting = stage === "resting";
  const flag = unsound && stage === "active";
  const px = Math.max(10, size * 2);
  return (
    <span
      className="k-rdy"
      data-step={RIPE_STEP[stage]}
      role="img"
      title={flag ? "Active — but Nuvo hasn't verified it sound yet" : `${RIPENESS_LABEL[stage]} — ${RIPENESS_HINT[stage]}`}
      aria-label={`Ripeness: ${RIPENESS_LABEL[stage]}${flag ? " (unverified)" : ""}`}
      style={{
        width: px,
        height: px,
        ...(flag ? { borderColor: "var(--warn)" } : {}),
        ...(resting ? { borderStyle: "solid", opacity: 0.55 } : {}),
      }}
    />
  );
}

// ── Progress bar with optional baseline marker (the Gain frame) ──────────────
// At the kit's track weight: `h` 1 is the 3px track, each step adds 2px.
export function Bar({ pct, color, baseline, h = 1.5 }: { pct: number; color: string; baseline?: number; h?: number }) {
  return (
    <div className="fl-bar my-1.5" style={{ height: Math.round(h * 2 + 1) }}>
      <i style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
      {baseline != null && <b style={{ left: `${baseline}%` }} />}
    </div>
  );
}

// ── Up/down traversal hook ───────────────────────────────────────────────────
export function Hook({ dir, label, onClick }: { dir: "up" | "down"; label: string; onClick?: () => void }) {
  return (
    <Button kind="ghost" size="xs" onClick={onClick} disabled={!onClick}>
      {dir === "up" ? "↑" : "↓"} {label}
    </Button>
  );
}

// ── Inline text: ALWAYS editable in place (contenteditable), no mode switch ───
// Reads as plain text, inherits the surrounding typography, wraps naturally, and
// commits on blur / Enter (Esc reverts). Uncontrolled by design — we write the
// DOM's text only when the incoming value differs and the field isn't focused,
// so React re-renders never yank the caret mid-edit.
export function InlineText({
  value,
  onChange,
  placeholder = "",
  className = "",
  inputClassName = "",
  autoFocusEmpty = false,
  live = false,
  quiet = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  /** @deprecated no separate edit state anymore — kept for call-site compat. */
  inputClassName?: string;
  autoFocusEmpty?: boolean;
  /** Report every keystroke, not just the blur. A record commits on blur — one
   *  write per edit — but a CREATE sheet has to know the name as you type: the
   *  commit button and the readiness ticks read it live, and clicking the button
   *  blurs this field in the same tick, which is too late. */
  live?: boolean;
  /** Skip the hover/focus tint — use when the parent row already carries it. */
  quiet?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  // Keep the DOM text in sync with value, but never while the user is editing it.
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.textContent !== value) {
      el.textContent = value;
    }
  }, [value]);

  useEffect(() => {
    const el = ref.current;
    if (el && el.textContent !== value) el.textContent = value;
    if (autoFocusEmpty && value === "") el?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const next = (el.textContent ?? "").trim();
    if (next !== value) onChange(next);
  };

  return (
    <span
      ref={ref}
      role="textbox"
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onBlur={commit}
      // untrimmed on purpose — trimming mid-word eats the space you just typed.
      onInput={live ? (e) => onChange(e.currentTarget.textContent ?? "") : undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === "Escape") { e.currentTarget.textContent = value; e.currentTarget.blur(); }
      }}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, text);
      }}
      className={`inline-edit${quiet ? " inline-edit-quiet" : ""} ${className} ${inputClassName}`}
      style={{ caretColor: "var(--accent)" }}
    />
  );
}

// ── Inline multi-line editor ─────────────────────────────────────────────────
// Reads as the text it holds; a click (or Enter on its tab stop) turns it into
// the kit's multiline field, which commits on blur or ⌘↵ and reverts on Esc.
export function InlineTextarea({
  value,
  onChange,
  placeholder = "Add a description…",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setDraft(value), [value]);
  useLayoutEffect(() => {
    if (editing) {
      const el = ref.current;
      if (el) { el.focus(); el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onChange(draft.trim());
  };

  if (editing) {
    return (
      <div className="k-field" data-multiline="">
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            e.currentTarget.style.height = "auto";
            e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
            if (e.key === "Escape") { setDraft(value); setEditing(false); }
          }}
          className={className}
          style={{ minHeight: 0 }}
        />
      </div>
    );
  }
  return (
    <p
      {...pressable(() => setEditing(true), { label: draft ? `Edit — ${draft}` : placeholder })}
      onClick={() => setEditing(true)}
      className={`inline-edit whitespace-pre-wrap leading-relaxed ${className}`}
      style={draft ? undefined : { color: "var(--faint)" }}
      title="Click to edit"
    >
      {draft || placeholder}
    </p>
  );
}

// ── Inline number editor ─────────────────────────────────────────────────────
export function InlineNumber({
  value,
  onChange,
  suffix = "",
  className = "",
}: {
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(String(value)), [value]);
  useLayoutEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select(); } }, [editing]);

  const commit = () => {
    setEditing(false);
    const n = parseFloat(draft);
    if (!Number.isNaN(n) && n !== value) onChange(n);
  };

  if (editing) {
    return (
      <input
        ref={ref}
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(String(value)); setEditing(false); } }}
        className={`w-16 rounded-[var(--r-chip)] border border-[var(--accent)] bg-[var(--raised)] px-1 py-0.5 text-right tabular-nums outline-none ${className}`}
        style={{ boxShadow: "0 0 0 3px var(--accent-wash)" }}
      />
    );
  }
  return (
    // The editor it opens already handles Enter/Escape — but until now there was
    // no keyboard way to *reach* it, so the whole field was mouse-only.
    <span
      {...pressable(() => setEditing(true), { label: `Edit — currently ${value}${suffix ?? ""}` })}
      onClick={() => setEditing(true)}
      className={`inline-edit px-0.5 tabular-nums ${className}`}
      title="Click to edit"
    >
      {value}{suffix}
    </span>
  );
}

// ── Inline date editor (the native picker behind a quiet value) ──────────────
export function InlineDate({ value, onChange, placeholder = "Set date" }: { value: string | null; onChange: (v: string | null) => void; placeholder?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="group/date relative inline-flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => { const el = ref.current; if (el) { try { el.showPicker(); } catch { el.focus(); } } }}
        className="inline-edit px-1 py-0.5 text-caption tabular-nums"
        style={{ color: value ? "var(--ink-2)" : "var(--faint)" }}
        aria-label={value ? `Target ${fmtDate(value)} — change` : "Set a target date"}
      >
        {value ? fmtDate(value) : placeholder}
      </button>
      <input
        ref={ref}
        type="date"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="pointer-events-none absolute left-0 h-0 w-0 opacity-0"
        tabIndex={-1}
        aria-hidden
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="k-btn fl-date-clear"
          data-kind="ghost"
          data-size="xs"
          data-icon=""
          style={{ width: 18, height: 18 }}
          title="Clear the date"
          aria-label="Clear the date"
        >
          <Icon name="close" size={11} />
        </button>
      )}
    </span>
  );
}

// ── Status / momentum ────────────────────────────────────────────────────────
// A status is a chip: its colour as a dot, its word in ink. Pressing it opens
// the statuses as a menu (a bottom sheet on the phone, via FloatingMenu).
export function StatusPill<T extends string>({
  value,
  options,
  colors,
  labels,
  filled,
  onChange,
}: {
  value: T;
  options: T[];
  colors: Record<string, string>;
  labels?: Record<string, string>;
  filled?: Set<string>;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const label = labels?.[value] ?? value;
  const color = colors[value] ?? "var(--muted)";
  const isFilled = filled?.has(value);
  return (
    <span className="relative inline-flex max-w-full">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="k-chip"
        data-tone={isFilled ? "accent" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change status"
      >
        <Dot color={color} shape="round" />
        <span>{label}</span>
      </button>
      <FloatingMenu open={open} anchorRef={btnRef} minWidth={150} onClose={() => setOpen(false)}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="menuitem"
            onClick={() => { onChange(o); setOpen(false); }}
            className="k-mi"
            aria-checked={o === value}
          >
            <Dot color={colors[o] ?? "var(--muted)"} shape="round" />
            <span className="k-mi-label">{labels?.[o] ?? o}</span>
            {o === value && <Icon name="check" size={14} className="k-mi-check" />}
          </button>
        ))}
      </FloatingMenu>
    </span>
  );
}

export function MomentumChip({ value, onChange }: { value: Momentum; onChange: (v: Momentum) => void }) {
  const next: Record<Momentum, Momentum> = { up: "flat", flat: "down", down: "up" };
  const glyph = value === "up" ? "↑ Rising" : value === "down" ? "↓ Stalled" : "→ Steady";
  return (
    <button type="button" onClick={() => onChange(next[value])} className="k-chip" title="Cycle momentum">
      <span>{glyph}</span>
    </button>
  );
}

// ── Domain picker — reassign which domain a record lives under ────────────────
// The trigger is the kit chip: the domain's symbol in its hue, its name in ink.
export function DomainPicker({
  domains,
  value,
  onChange,
  align = "left",
  size = "sm",
  allowClear = false,
}: {
  domains: Domain[];
  value: string;
  onChange: (domainId: string) => void;
  /** Which edge the menu hangs from — "left" opens under the trigger, "right"
   *  right-aligns it (for triggers near the right edge of the viewport). */
  align?: "left" | "right";
  /** `lg` on the record, where routing this thing to the right area is a primary
   *  act and not a breadcrumb: a control-height button, not a chip. */
  size?: "sm" | "lg";
  /** Offers a trailing "no domain" row. Project/Initiative always belong to one
   *  domain, so they never pass this — a task can be genuinely domainless. */
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const cur = domains.find((d) => d.id === value);
  const color = cur?.color ?? "var(--faint)";
  const lg = size === "lg";
  return (
    <span className="relative inline-flex max-w-full">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={lg ? "k-btn tap" : "k-chip tap-bloom"}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change domain"
      >
        <span className="inline-flex shrink-0" style={{ color }}><DomainSymbol value={cur?.icon} size={lg ? 15 : 13} /></span>
        <span className="truncate" style={cur ? undefined : { color: "var(--faint)" }}>{cur?.name ?? "Domain"}</span>
        <Icon name="chevron-down" size={12} style={{ color: "var(--faint)", flex: "none" }} />
      </button>
      <FloatingMenu open={open} anchorRef={btnRef} align={align} minWidth={lg ? 220 : 180} onClose={() => setOpen(false)}>
        {domains.map((d) => (
          <button
            key={d.id}
            type="button"
            role="menuitem"
            onClick={() => { onChange(d.id); setOpen(false); }}
            className="k-mi"
            aria-checked={d.id === value}
          >
            <span className="inline-flex shrink-0" style={{ color: d.color }}><DomainSymbol value={d.icon} size={15} /></span>
            <span className="k-mi-label">{d.name}</span>
            {d.id === value && <Icon name="check" size={14} className="k-mi-check" />}
          </button>
        ))}
        {allowClear && value && (
          <>
            <div className="k-msep" role="separator" />
            <button
              type="button"
              role="menuitem"
              onClick={() => { onChange(""); setOpen(false); }}
              className="k-mi"
              style={{ color: "var(--muted)" }}
            >
              <span className="k-mi-label">no domain</span>
            </button>
          </>
        )}
      </FloatingMenu>
    </span>
  );
}

// ── Initiative picker — reparent a project to a different bet, or none ───────
// The upward half of linking a project ↔ initiative. Mirrors DomainPicker;
// stays silent (returns null) when there's nothing to route to, same as
// KrPicker below — an empty picker is noise, not an affordance.
export function InitiativePicker({
  initiatives,
  value,
  onChange,
  onOpen,
  align = "left",
  size = "sm",
}: {
  /** Already scoped to the project's own domain — an initiative lives in one. */
  initiatives: Initiative[];
  value: string | null;
  onChange: (initiativeId: string | null) => void;
  /** Opens the initiative's own record — offered as the menu's first row. */
  onOpen?: (initiativeId: string) => void;
  align?: "left" | "right";
  size?: "sm" | "lg";
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const cur = initiatives.find((i) => i.id === value) ?? null;
  const lg = size === "lg";
  if (!cur && initiatives.length === 0) return null;
  return (
    <span className="relative inline-flex max-w-full">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={lg ? "k-btn tap" : "k-chip tap-bloom"}
        data-kind={lg ? "ghost" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change which initiative this belongs to"
      >
        <span className="truncate" style={{ maxWidth: lg ? 180 : 140, ...(cur ? {} : { color: "var(--faint)" }) }}>
          {cur?.name ?? "No initiative"}
        </span>
        <Icon name="chevron-down" size={12} style={{ color: "var(--faint)", flex: "none" }} />
      </button>
      <FloatingMenu open={open} anchorRef={btnRef} align={align} minWidth={lg ? 220 : 180} onClose={() => setOpen(false)}>
        {cur && onOpen && (
          <>
            <button
              type="button"
              role="menuitem"
              onClick={() => { onOpen(cur.id); setOpen(false); }}
              className="k-mi"
            >
              <Icon name="arrow-right" size={14} />
              <span className="k-mi-label">Open “{cur.name}”</span>
            </button>
            <div className="k-msep" role="separator" />
          </>
        )}
        {initiatives.map((i) => (
          <button
            key={i.id}
            type="button"
            role="menuitem"
            onClick={() => { onChange(i.id); setOpen(false); }}
            className="k-mi"
            aria-checked={i.id === value}
          >
            <span className="k-mi-label">{i.name}</span>
            {i.id === value && <Icon name="check" size={14} className="k-mi-check" />}
          </button>
        ))}
        {value && (
          <>
            <div className="k-msep" role="separator" />
            <button
              type="button"
              role="menuitem"
              onClick={() => { onChange(null); setOpen(false); }}
              className="k-mi"
              style={{ color: "var(--muted)" }}
            >
              <span className="k-mi-label">no initiative</span>
            </button>
          </>
        )}
      </FloatingMenu>
    </span>
  );
}

// ── Project attach picker — the downward half, from an initiative's record ───
// "Belongs here" (`RecordModal.tsx`) already surfaces loose TASKS that want a
// home; this is the project-level sibling — a filtered search over projects
// in the initiative's own domain (its own, or unattached, or another bet's:
// reparenting reads the same either direction) that aren't here yet.
export function ProjectAttachPicker({
  candidates,
  onAttach,
  accent = "var(--accent)",
}: {
  candidates: Project[];
  onAttach: (projectId: string) => void;
  accent?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = q.trim()
    ? candidates.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()))
    : candidates;

  if (candidates.length === 0) return null;

  return (
    <span className="relative inline-flex">
      <Button
        ref={btnRef}
        kind="ghost"
        size="xs"
        className="tap"
        icon={<Icon name="plus" size={13} />}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
          setQ("");
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        Attach a project
      </Button>
      <FloatingMenu open={open} anchorRef={btnRef} minWidth={240} onClose={() => setOpen(false)}>
        <div className="k-msearch">
          <Icon name="search" size={14} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Find a project…"
            aria-label="Find a project"
            style={{ caretColor: accent }}
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0 && <div className="k-mlabel">No match</div>}
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitem"
              onClick={() => { onAttach(p.id); setOpen(false); }}
              className="k-mi"
            >
              <span className="k-mi-label">{p.name || "Untitled"}</span>
            </button>
          ))}
        </div>
      </FloatingMenu>
    </span>
  );
}

// ── Key-result picker — point a project / task at the outcome it moves ───────
export function KrPicker({
  keyResults,
  value,
  onChange,
  color = "var(--accent)",
  align = "left",
}: {
  keyResults: KeyResult[];
  value: string | null;
  onChange: (krId: string | null) => void;
  color?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  if (keyResults.length === 0) return null;
  const cur = keyResults.find((k) => k.id === value) ?? null;
  return (
    <span className="relative inline-flex max-w-full">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="k-chip tap-bloom"
        aria-haspopup="menu"
        aria-expanded={open}
        title={cur ? `Moves: ${cur.name}` : "Link the key result this moves"}
      >
        <span className="inline-flex shrink-0" style={{ color: cur ? color : "var(--faint)" }}><TargetGlyph /></span>
        <span className="max-w-[140px] truncate" style={cur ? undefined : { color: "var(--faint)" }}>{cur ? cur.name : "Link KR"}</span>
      </button>
      <FloatingMenu open={open} anchorRef={btnRef} align={align} minWidth={180} onClose={() => setOpen(false)}>
        {keyResults.map((k) => (
          <button
            key={k.id}
            type="button"
            role="menuitem"
            onClick={() => { onChange(k.id === value ? null : k.id); setOpen(false); }}
            className="k-mi"
            aria-checked={k.id === value}
          >
            <span className="inline-flex shrink-0" style={{ color }}><TargetGlyph /></span>
            <span className="k-mi-label">{k.name}</span>
            {k.id === value && <Icon name="check" size={14} className="k-mi-check" />}
          </button>
        ))}
        {value && (
          <>
            <div className="k-msep" role="separator" />
            <button
              type="button"
              role="menuitem"
              onClick={() => { onChange(null); setOpen(false); }}
              className="k-mi"
              style={{ color: "var(--muted)" }}
            >
              <span className="k-mi-label">Unlink</span>
            </button>
          </>
        )}
      </FloatingMenu>
    </span>
  );
}

function TargetGlyph() {
  return <Target size={13} strokeWidth={1.75} aria-hidden />;
}

// ── Energy picker ────────────────────────────────────────────────────────────
// Three exclusive choices, so the kit's segmented control — the domain's hue
// only marks the one that's on.
export function EnergyPicker({ value, onChange, color }: { value: Energy | null; onChange: (v: Energy) => void; color: string }) {
  return (
    <span className="k-seg" data-size="sm" role="radiogroup" aria-label="Energy">
      {ENERGY_ORDER.map((e) => (
        <button
          key={e}
          type="button"
          role="radio"
          aria-checked={value === e}
          onClick={() => onChange(e)}
          title={`${ENERGY_META[e].label} — ${ENERGY_META[e].blurb}`}
          style={value === e ? { color } : undefined}
        >
          {ENERGY_META[e].icon}
        </button>
      ))}
    </span>
  );
}

// ── Small square icon button (edit/delete affordances) ───────────────────────
export function IconBtn({ children, onClick, title, danger }: { children: ReactNode; onClick: () => void; title?: string; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      aria-label={title}
      className="k-btn"
      data-kind={danger ? "danger" : "ghost"}
      data-size="xs"
      data-icon=""
    >
      {children}
    </button>
  );
}

// ── Confirm-delete inline ────────────────────────────────────────────────────
/** Destructive, so it says what it does. A bare ✕ next to a "Done" button reads
 *  as "close" — the one thing it isn't. The word is the affordance; the arm step
 *  is the safety: the first press turns it into the question, solid. */
export function DeleteBtn({ onDelete, what, phone = false }: { onDelete: () => void; what: string; phone?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 2600);
    return () => clearTimeout(t);
  }, [armed]);
  // `phone` only sizes it to a thumb (44px) — the arm-then-confirm safety and
  // the wording are the same on both shells.
  const sizing = phone ? "tap" : "";
  if (armed)
    return (
      <Button
        kind="danger-solid"
        size={phone ? "md" : "xs"}
        className={sizing}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
      >
        Delete {what}?
      </Button>
    );
  return (
    <Button
      kind="danger"
      size={phone ? "md" : "xs"}
      className={sizing}
      onClick={() => setArmed(true)}
      title={`Delete this ${what}`}
    >
      Delete
    </Button>
  );
}

// ── Timeline / Gantt ─────────────────────────────────────────────────────────
export interface TimelineItem {
  id: string;
  label: string;
  color: string;
  start: string | null;
  end: string | null;
  progress: number;
  dim?: boolean;
  onClick?: () => void;
  // when present, the bar can be dragged to move/resize and an undated item can
  // be dragged in from the tray to get a date range
  onChangeDates?: (start: string | null, end: string | null) => void;
  /** nested rows shown when the item is expanded (e.g. projects under an initiative) */
  children?: TimelineItem[];
}

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

export function fmtDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

function parse(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso + "T00:00:00").getTime();
  return Number.isNaN(t) ? null : t;
}

function toISO(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Snap a millisecond instant to the nearest local midnight. */
function snapDay(ms: number): number {
  const d = new Date(ms + 12 * 3_600_000);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ── Zoom levels — Week · Month · Quarter · Year (borrowing Asana / Notion) ───
export type TimelineZoom = "week" | "month" | "quarter" | "year";

interface ZoomSpec {
  id: TimelineZoom;
  label: string;
  pxPerDay: number; // horizontal scale
  dropSpanDays: number; // default length when an undated item is dropped in
}

const ZOOMS: ZoomSpec[] = [
  { id: "week", label: "Week", pxPerDay: 30, dropSpanDays: 2 },
  { id: "month", label: "Month", pxPerDay: 12, dropSpanDays: 6 },
  { id: "quarter", label: "Quarter", pxPerDay: 4.4, dropSpanDays: 13 },
  { id: "year", label: "Year", pxPerDay: 1.7, dropSpanDays: 29 },
];

type DragMode = "move" | "start" | "end";

interface Tick { key: string; left: number; label: string; strong?: boolean; weekend?: boolean; width?: number }

const startOfQuarterLocal = (d: Date) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);

/** The padded date window the grid should cover, snapped to period edges so the
 *  axis always reads cleanly — and wide enough to be useful when nothing is
 *  scheduled yet (lo/hi collapse to today). */
function rangeFor(zoom: TimelineZoom, lo: Date, hi: Date): { origin: Date; end: Date } {
  switch (zoom) {
    case "week":
      return { origin: startOfWeek(addDays(lo, -10), { weekStartsOn: 1 }), end: endOfWeek(addDays(hi, 18), { weekStartsOn: 1 }) };
    case "month":
      return { origin: startOfMonth(addMonths(lo, -1)), end: endOfMonth(addMonths(hi, 2)) };
    case "quarter":
      return { origin: startOfMonth(addMonths(lo, -2)), end: endOfMonth(addMonths(hi, 4)) };
    case "year":
      return { origin: startOfMonth(addMonths(lo, -3)), end: endOfMonth(addMonths(hi, 11)) };
  }
}

/** Two header tiers + gridlines + weekend bands for the active zoom. */
function buildTicks(zoom: TimelineZoom, origin: Date, end: Date, x: (ms: number) => number) {
  const majors: Tick[] = [];
  const minors: Tick[] = [];
  const weekends: Tick[] = [];
  const months = eachMonthOfInterval({ start: origin, end });
  const endMs = end.getTime();

  // weekend shading reads only at the tighter zooms
  if (zoom === "week" || zoom === "month") {
    for (const d of eachDayOfInterval({ start: origin, end })) {
      if (isWeekend(d)) weekends.push({ key: `we-${d.getTime()}`, left: x(d.getTime()), label: "", width: x(d.getTime() + DAY) - x(d.getTime()) });
    }
  }

  if (zoom === "week" || zoom === "month") {
    for (const m of months) {
      const right = Math.min(addMonths(m, 1).getTime(), endMs);
      majors.push({ key: `mo-${m.getTime()}`, left: x(m.getTime()), width: x(right) - x(m.getTime()), label: `${MONTHS[m.getMonth()]} ${String(m.getFullYear()).slice(2)}` });
    }
  } else if (zoom === "quarter") {
    let q = startOfQuarterLocal(origin);
    while (q.getTime() <= endMs) {
      const nq = addMonths(q, 3);
      majors.push({ key: `q-${q.getTime()}`, left: x(q.getTime()), width: x(Math.min(nq.getTime(), endMs)) - x(q.getTime()), label: `Q${Math.floor(q.getMonth() / 3) + 1} ${q.getFullYear()}` });
      q = nq;
    }
  } else {
    let y = startOfYear(origin);
    while (y.getTime() <= endMs) {
      const ny = new Date(y.getFullYear() + 1, 0, 1);
      majors.push({ key: `y-${y.getTime()}`, left: x(y.getTime()), width: x(Math.min(ny.getTime(), endMs)) - x(y.getTime()), label: `${y.getFullYear()}` });
      y = ny;
    }
  }

  if (zoom === "week") {
    for (const d of eachDayOfInterval({ start: origin, end })) {
      minors.push({ key: `d-${d.getTime()}`, left: x(d.getTime()), label: `${WEEKDAY[d.getDay()]} ${d.getDate()}`, strong: d.getDay() === 1, weekend: isWeekend(d), width: x(d.getTime() + DAY) - x(d.getTime()) });
    }
  } else if (zoom === "month") {
    for (const w of eachWeekOfInterval({ start: origin, end }, { weekStartsOn: 1 })) {
      minors.push({ key: `w-${w.getTime()}`, left: x(w.getTime()), label: `${w.getDate()}`, strong: true });
    }
  } else {
    for (const m of months) {
      minors.push({ key: `m-${m.getTime()}`, left: x(m.getTime()), label: MONTHS[m.getMonth()], strong: m.getMonth() % 3 === 0 });
    }
  }

  return { majors, minors, weekends };
}

function loadZoom(key: string | undefined, fallback: TimelineZoom): TimelineZoom {
  if (!key) return fallback;
  try {
    const raw = localStorage.getItem(`nuvo.timeline.zoom.${key}`);
    return raw === "week" || raw === "month" || raw === "quarter" || raw === "year" ? raw : fallback;
  } catch {
    return fallback;
  }
}

const LABEL_W_DEFAULT = 208;
const LABEL_W_MIN = 120;
const LABEL_W_MAX = 520;

function loadLabelW(key: string | undefined): number {
  if (!key) return LABEL_W_DEFAULT;
  try {
    const n = parseInt(localStorage.getItem(`nuvo.timeline.labelW.${key}`) ?? "", 10);
    return Number.isNaN(n) ? LABEL_W_DEFAULT : Math.max(LABEL_W_MIN, Math.min(LABEL_W_MAX, n));
  } catch {
    return LABEL_W_DEFAULT;
  }
}

const ROW = 44;
const AXIS_H = 50;
const MIN_BAR = 14;

type FlatRow = TimelineItem & { _isChild?: true };

export function Timeline({
  items,
  today = new Date(),
  selection,
  persistKey,
  defaultZoom = "month",
}: {
  items: TimelineItem[];
  today?: Date;
  selection?: CollectionSelection;
  /** persist the chosen zoom level per surface */
  persistKey?: string;
  defaultZoom?: TimelineZoom;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<TimelineZoom>(() => loadZoom(persistKey, defaultZoom));
  const spec = ZOOMS.find((z) => z.id === zoom) ?? ZOOMS[1];
  const pxPerDay = spec.pxPerDay;
  const [labelW, setLabelW] = useState<number>(() => loadLabelW(persistKey));

  // live preview while dragging an existing bar (commit on release)
  const [drag, setDrag] = useState<{ id: string; start: number; end: number } | null>(null);

  // live preview while dragging an undated item in from the tray
  const [tray, setTray] = useState<{ id: string; x: number; y: number; ms: number | null } | null>(null);
  const trayRef = useRef<{ moved: boolean } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const choose = (z: TimelineZoom) => {
    setZoom(z);
    if (persistKey) {
      try { localStorage.setItem(`nuvo.timeline.zoom.${persistKey}`, z); } catch { /* ignore */ }
    }
  };

  const dated = items.filter((i) => i.start || i.end);
  const undated = items.filter((i) => !i.start && !i.end);

  // Accordion-flattened rows: dated top-level items, with expanded children interleaved
  const flatRows: FlatRow[] = [];
  for (const it of dated) {
    flatRows.push(it);
    if (it.children?.length && expanded.has(it.id)) {
      for (const ch of it.children) flatRows.push({ ...ch, _isChild: true });
    }
  }

  // Include children dates in range so the grid fits expanded rows
  const stamps = [...dated, ...items.flatMap((i) => i.children ?? [])].flatMap((i) => [parse(i.start), parse(i.end)].filter((x): x is number => x != null));
  const todayMs = today.getTime();
  const lo = new Date(stamps.length ? Math.min(...stamps, todayMs) : todayMs);
  const hi = new Date(stamps.length ? Math.max(...stamps, todayMs) : todayMs);
  const { origin, end } = rangeFor(zoom, lo, hi);
  const originMs = origin.getTime();
  const x = (ms: number) => ((ms - originMs) / DAY) * pxPerDay;
  const totalWidth = Math.max(1, Math.ceil(x(end.getTime())));
  const { majors, minors, weekends } = buildTicks(zoom, origin, end, x);
  const todayX = x(snapDay(todayMs) + DAY / 2);

  const bodyRows = flatRows.length;
  // The grid fills the floor (the body is flex-1 below); this is just the minimum
  // height the placed bars need so they never collapse.
  const contentHeight = bodyRows * ROW + (tray ? ROW : 0) + 16;

  // re-centre on today when the zoom changes (and on first paint)
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, x(snapDay(todayMs)) - el.clientWidth * 0.32);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  const edgeScroll = (clientX: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (clientX < r.left + 36) el.scrollLeft -= 14;
    else if (clientX > r.right - 36) el.scrollLeft += 14;
  };

  const centerToday = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: Math.max(0, x(snapDay(todayMs)) - el.clientWidth * 0.32), behavior: "smooth" });
  };
  const nudge = (dir: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  // ── drag an existing bar: move the whole span, or pull an edge ─────────────
  const startBarDrag = (it: TimelineItem, mode: DragMode, e: ReactPointerEvent) => {
    if (!it.onChangeDates) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const origStart = parse(it.start) ?? parse(it.end)!;
    const origEnd = parse(it.end) ?? parse(it.start)!;
    const msPerPx = DAY / pxPerDay;
    let moved = false;
    let liveStart = origStart;
    let liveEnd = origEnd;
    let raf = 0;
    let pending: { start: number; end: number } | null = null;
    setDrag({ id: it.id, start: origStart, end: origEnd });

    const flush = () => {
      raf = 0;
      if (pending) setDrag({ id: it.id, start: pending.start, end: pending.end });
    };

    const onMove = (ev: PointerEvent) => {
      const dms = (ev.clientX - startX) * msPerPx;
      if (Math.abs(ev.clientX - startX) > 3) moved = true;
      let start = origStart;
      let endMs = origEnd;
      if (mode === "move") { start = snapDay(origStart + dms); endMs = start + (origEnd - origStart); }
      else if (mode === "start") { start = Math.min(snapDay(origStart + dms), origEnd); }
      else { endMs = Math.max(snapDay(origEnd + dms), origStart); }
      liveStart = start;
      liveEnd = endMs;
      if (pending?.start === start && pending.end === endMs) return;
      pending = { start, end: endMs };
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (raf) cancelAnimationFrame(raf);
      setDrag(null);
      // commit OUTSIDE the state updater — a side-effect in a reducer is
      // double-invoked under StrictMode and writes twice
      if (moved) it.onChangeDates!(
        (it.start || mode === "start") ? toISO(liveStart) : null,
        (it.end || mode === "end") ? toISO(liveEnd) : null,
      );
      else it.onClick?.();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ── drag an undated item from the tray onto the grid ───────────────────────
  const overMsFromPointer = (clientX: number, clientY: number): number | null => {
    const body = bodyRef.current;
    if (!body) return null;
    const r = body.getBoundingClientRect();
    if (clientY < r.top - 8 || clientY > r.bottom + 8) return null;
    const local = clientX - r.left;
    if (local < -4 || local > r.width + 4) return null;
    return originMs + (Math.max(0, local) / pxPerDay) * DAY;
  };

  const startTrayDrag = (it: TimelineItem, e: ReactPointerEvent) => {
    if (!it.onChangeDates) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    trayRef.current = { moved: false };
    setTray({ id: it.id, x: startX, y: startY, ms: overMsFromPointer(startX, startY) });
    let raf = 0;
    let pending: { x: number; y: number; ms: number | null } | null = null;

    const flush = () => {
      raf = 0;
      if (pending) setTray({ id: it.id, x: pending.x, y: pending.y, ms: pending.ms });
    };

    const onMove = (ev: PointerEvent) => {
      const t = trayRef.current;
      if (!t) return;
      if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) t.moved = true;
      edgeScroll(ev.clientX);
      pending = { x: ev.clientX, y: ev.clientY, ms: overMsFromPointer(ev.clientX, ev.clientY) };
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (raf) cancelAnimationFrame(raf);
      const t = trayRef.current;
      trayRef.current = null;
      const ms = overMsFromPointer(ev.clientX, ev.clientY);
      setTray(null);
      if (!t) return;
      if (t.moved && ms != null) {
        const start = snapDay(ms);
        it.onChangeDates!(toISO(start), toISO(start + spec.dropSpanDays * DAY));
      } else if (!t.moved) {
        it.onClick?.();
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startLabelResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = labelW;
    const onMove = (ev: PointerEvent) => {
      setLabelW(Math.max(LABEL_W_MIN, Math.min(LABEL_W_MAX, startW + ev.clientX - startX)));
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const w = Math.max(LABEL_W_MIN, Math.min(LABEL_W_MAX, startW + ev.clientX - startX));
      if (persistKey) {
        try { localStorage.setItem(`nuvo.timeline.labelW.${persistKey}`, String(w)); } catch { /* ignore */ }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ userSelect: drag || tray ? "none" : "auto" }}>
      {/* toolbar — zoom · travel · counts, in the kit's controls. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          label="Timeline zoom"
          value={zoom}
          onChange={choose}
          options={ZOOMS.map((z) => ({ value: z.id, label: z.label }))}
        />
        <div className="inline-flex items-center gap-1">
          <IconButton label="Earlier" icon={<Icon name="chevron-left" size={14} />} onClick={() => nudge(-1)} />
          <Button size="sm" onClick={centerToday} title="Jump to today">Today</Button>
          <IconButton label="Later" icon={<Icon name="chevron-right" size={14} />} onClick={() => nudge(1)} />
        </div>
        <div className="flex-1" />
        <span className="fl-meta-fact">
          {dated.length} scheduled{undated.length ? ` · ${undated.length} unscheduled` : ""}
        </span>
      </div>

      {/* chart — fixed name column + horizontally-scrolling grid */}
      <div className="flex min-h-0 flex-1">
        <div className="relative flex shrink-0 flex-col border-r border-line" style={{ width: labelW }}>
          <div className="shrink-0 border-b border-line" style={{ height: AXIS_H }}>
            <div className="flex h-full items-end px-3 pb-2 text-caption font-medium" style={{ color: "var(--faint)" }}>Name</div>
          </div>
          <div className="relative flex-1">
            {flatRows.map((it, row) => {
              const isChild = !!it._isChild;
              const hasKids = !isChild && (it.children?.length ?? 0) > 0;
              const isExp = hasKids && expanded.has(it.id);
              const picked = !isChild ? selection?.isSelected(it.id) : undefined;
              const preview = !isChild ? selection?.isPreviewSelected(it.id) : undefined;
              const visual = picked ? "selected" : preview ? "preview" : "none";
              return (
                <div
                  key={it.id}
                  data-select-id={!isChild && selection ? it.id : undefined}
                  ref={!isChild && selection ? (el) => selection.registerRef(it.id, el) : undefined}
                  onMouseDown={!isChild && selection ? selection.itemPointerDown(it.id) : undefined}
                  className={`rise lift-anim flex items-center gap-2 ${!isChild && selection ? itemSelectRowClass(selection, it.id) : "hover:bg-accent-soft/50"}`}
                  style={{ height: ROW, animationDelay: `${row * 35}ms`, paddingLeft: isChild ? 36 : 8 }}
                >
                  {/* toggle in a fixed-width slot so all labels align regardless of children */}
                  {!isChild && (
                    hasKids ? (
                      <button
                        data-no-select
                        onClick={(e) => { e.stopPropagation(); toggle(it.id); }}
                        className="fast flex h-4 w-4 shrink-0 items-center justify-center text-muted hover:text-ink"
                        title={isExp ? "Collapse" : "Expand projects"}
                        aria-expanded={isExp}
                      >
                        <Icon name="chevron-down" size={12} style={{ transform: isExp ? undefined : "rotate(-90deg)" }} />
                      </button>
                    ) : (
                      <span className="h-4 w-4 shrink-0" />
                    )
                  )}
                  {!isChild && selection && (
                    <span data-no-select>
                      <SelectCheckbox
                        checked={visual === "selected"}
                        preview={visual === "preview"}
                        onToggle={() => selection.pick(it.id, { extend: true, range: false })}
                      />
                    </span>
                  )}
                  <span
                    className="shrink-0"
                    style={{ width: isChild ? 6 : 8, height: isChild ? 6 : 8, borderRadius: 2.5, background: it.color, opacity: it.dim ? 0.5 : isChild ? 0.7 : 1 }}
                  />
                  <button
                    onClick={it.onClick}
                    className={`fast truncate text-left ${isChild ? "text-caption text-muted" : "text-body font-medium text-ink"}`}
                    title={it.label}
                  >
                    {it.label || "Untitled"}
                  </button>
                </div>
              );
            })}
          </div>
          {/* column resize handle — sits on the right border, full height */}
          <div
            onPointerDown={startLabelResize}
            className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize hover:bg-accent/20"
            title="Drag to resize"
          />
        </div>

        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
          <div className="flex min-h-full flex-col" style={{ width: totalWidth }}>
            {/* axis */}
            <div className="relative shrink-0 border-b border-line" style={{ height: AXIS_H }}>
              {majors.map((g) => (
                <div key={g.key} className="absolute top-0 flex items-center overflow-hidden border-r border-line px-1.5" style={{ left: g.left, width: g.width, height: 19 }}>
                  <span className="whitespace-nowrap text-label font-semibold text-ink-2" style={{ color: "var(--ink-2)" }}>{g.label}</span>
                </div>
              ))}
              {minors.map((t) => (
                <div
                  key={t.key}
                  className="absolute flex items-end pb-1"
                  style={{ left: t.left, top: 19, bottom: 0, width: t.width ?? 26, paddingLeft: t.width ? 0 : 3, justifyContent: t.width ? "center" : "flex-start" }}
                >
                  <span className="whitespace-nowrap text-label tabular-nums" style={{ color: t.weekend ? "var(--faint)" : "var(--muted)" }}>{t.label}</span>
                </div>
              ))}
              <div className="absolute -top-px flex flex-col items-center" style={{ left: todayX, transform: "translateX(-50%)" }}>
                <span className="px-1 text-label font-semibold" style={{ background: "var(--signal)", color: "var(--on-signal)", borderRadius: "var(--r-chip)" }}>Today</span>
              </div>
            </div>

            {/* body */}
            <div ref={bodyRef} className="relative flex-1" style={{ minHeight: contentHeight }}>
              {/* background: weekend bands · gridlines · today */}
              <div className="pointer-events-none absolute inset-0">
                {weekends.map((w) => (
                  <div key={w.key} className="absolute top-0 bottom-0" style={{ left: w.left, width: w.width, background: "var(--sunk)" }} />
                ))}
                {minors.map((t) => (
                  <div key={t.key} className="absolute top-0 bottom-0 w-px" style={{ left: t.left, background: t.strong ? "var(--line-2)" : "var(--line-1)" }} />
                ))}
                <div className="absolute top-0 bottom-0 w-px" style={{ left: todayX, background: "var(--signal)" }} />
              </div>

              {/* bars */}
              {flatRows.map((it, row) => {
                if (!it.start && !it.end) return null;
                const live = drag && drag.id === it.id ? drag : null;
                const sMs = live ? live.start : parse(it.start) ?? parse(it.end)!;
                const eMs = live ? live.end : parse(it.end) ?? parse(it.start)!;
                const a = Math.min(sMs, eMs);
                const b = Math.max(sMs, eMs) + DAY; // end-inclusive
                const left = x(a);
                const width = Math.max(MIN_BAR, x(b) - left);
                const editable = !!it.onChangeDates;
                const wide = width > 64;
                return (
                  <div key={it.id} data-no-select className="rise group absolute" style={{ top: row * ROW + 8, left, width, height: ROW - 16, animationDelay: `${row * 45}ms` }}>
                    <div
                      onPointerDown={editable ? (ev) => startBarDrag(it, "move", ev) : undefined}
                      onClick={!editable ? it.onClick : undefined}
                      // A read-only bar opens its record, so it gets the tab stop
                      // and Enter. An *editable* bar is a drag handle for dates —
                      // that gesture has no keyboard equivalent here, and the
                      // record's own date fields are the keyboard path to it, so
                      // this deliberately stays a pointer affordance rather than
                      // becoming a tab stop that does nothing.
                      {...(!editable && it.onClick
                        ? pressable(() => it.onClick!(), { label: it.label })
                        : {})}
                      className={`fast relative flex h-full items-center overflow-hidden rounded px-2 ${editable ? "cursor-grab active:cursor-grabbing" : ""}`}
                      style={{ background: it.dim ? softTint("var(--muted)", 10) : softTint(it.color, 20), border: `1px solid ${it.color}`, opacity: it.dim ? 0.6 : 1 }}
                      title={`${it.label}${it.start ? ` · ${fmtDate(it.start)}` : ""}${it.end ? ` → ${fmtDate(it.end)}` : ""} · ${it.progress}%${editable ? " · drag to move, edges to resize" : ""}`}
                    >
                      <div className="absolute left-0 top-0 bottom-0" style={{ width: `${Math.max(0, Math.min(100, it.progress))}%`, background: softTint(it.color, 28) }} />
                      {wide ? (
                        <>
                          <span className="relative truncate text-caption font-medium text-ink">{it.label}</span>
                          <span className="relative ml-auto pl-2 text-label tabular-nums text-muted">{it.progress}%</span>
                        </>
                      ) : (
                        <span className="relative text-label tabular-nums text-muted">{it.progress > 0 ? `${it.progress}%` : ""}</span>
                      )}
                    </div>
                    {editable && (
                      <>
                        <span
                          onPointerDown={(ev) => startBarDrag(it, "start", ev)}
                          className="fast absolute -left-0.5 top-0 bottom-0 flex w-3 cursor-ew-resize items-center justify-center rounded-l opacity-0 group-hover:opacity-100"
                          style={{ background: it.color }}
                          title="Drag to change the start date"
                        >
                          <span className="h-2.5 w-px rounded bg-white/80" />
                        </span>
                        <span
                          onPointerDown={(ev) => startBarDrag(it, "end", ev)}
                          className="fast absolute -right-0.5 top-0 bottom-0 flex w-3 cursor-ew-resize items-center justify-center rounded-r opacity-0 group-hover:opacity-100"
                          style={{ background: it.color }}
                          title="Drag to change the target date"
                        >
                          <span className="h-2.5 w-px rounded bg-white/80" />
                        </span>
                      </>
                    )}
                  </div>
                );
              })}

              {/* tray-drop indicator */}
              {tray && tray.ms != null && (() => {
                const start = snapDay(tray.ms);
                const gl = x(start);
                const gw = Math.max(MIN_BAR, x(start + spec.dropSpanDays * DAY) - gl);
                const it = undated.find((u) => u.id === tray.id);
                const c = it?.color ?? "var(--accent)";
                return (
                  <>
                    <div className="pointer-events-none absolute top-0 bottom-0 w-px" style={{ left: gl, background: "var(--accent)" }} />
                    <div className="pointer-events-none absolute rounded border-2 border-dashed" style={{ left: gl, top: bodyRows * ROW + 6, width: gw, height: ROW - 12, borderColor: c, background: softTint(c, 16) }} />
                    <div className="pointer-events-none absolute text-label font-semibold tabular-nums text-accent" style={{ left: gl + 3, top: Math.max(0, bodyRows * ROW - 8) }}>{fmtDate(toISO(start))}</div>
                  </>
                );
              })()}

              {/* empty hint — the grid still renders so the surface never reads blank */}
              {dated.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center">
                  <span className="max-w-[420px] text-caption text-muted">
                    {undated.length
                      ? "Nothing scheduled yet — drag a card up from the tray below onto the grid to give it dates."
                      : "No dated work yet. Set a start/target date to place it on the timeline."}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* unassigned tray — find loose work and drag it in, Notion-style */}
      {undated.length > 0 && <UnassignedTray items={undated} draggingId={tray?.id ?? null} onStart={startTrayDrag} />}

      {/* floating ghost following the cursor during a tray drag */}
      {tray && (() => {
        const it = undated.find((u) => u.id === tray.id);
        if (!it) return null;
        return (
          <div
            className="glass-grab pointer-events-none fixed z-[300] flex items-center gap-2 px-3 py-2 text-caption"
            // the drag ghost is a picked-up card: the card's 8px corner
            style={{ left: tray.x + 12, top: tray.y + 12, borderRadius: "var(--r-card)" }}
          >
            <span className="h-2 w-2" style={{ background: it.color, borderRadius: 2.5 }} />
            <span className="max-w-[160px] truncate font-medium text-ink">{it.label || "Untitled"}</span>
          </div>
        );
      })()}
    </div>
  );
}

function UnassignedTray({
  items,
  draggingId,
  onStart,
}: {
  items: TimelineItem[];
  draggingId: string | null;
  onStart: (it: TimelineItem, e: ReactPointerEvent) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-3 shrink-0 border-t border-line pt-3">
      <button onClick={() => setOpen((o) => !o)} className="fast mb-2 flex items-center gap-2 text-caption font-semibold text-muted hover:text-ink" aria-expanded={open}>
        <Icon name="chevron-down" size={12} style={{ transform: open ? undefined : "rotate(-90deg)" }} />
        <span>Unscheduled</span>
        <span className="font-medium tabular-nums" style={{ color: "var(--faint)" }}>{items.length}</span>
      </button>
      {open && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {items.map((it, i) => {
            const editable = !!it.onChangeDates;
            return (
              <div
                key={it.id}
                data-no-select
                onPointerDown={editable ? (e) => onStart(it, e) : undefined}
                onClick={!editable ? it.onClick : undefined}
                // Same split as the bars above: a chip that opens gets a tab
                // stop, a chip that is only a drag source doesn't.
                {...(!editable && it.onClick
                  ? pressable(() => it.onClick!(), { label: it.label || "Untitled" })
                  : {})}
                className={`k-card rise fast group flex shrink-0 items-center gap-2 px-3 py-2 ${editable ? "cursor-grab active:cursor-grabbing" : ""} ${draggingId === it.id ? "opacity-40" : ""}`}
                style={{ animationDelay: `${i * 40}ms` }}
                title={editable ? `${it.label} — drag onto the grid to schedule` : it.label}
              >
                <span className="h-2 w-2 shrink-0" style={{ background: it.color, borderRadius: 2.5 }} />
                <span className="max-w-[220px] truncate text-caption font-medium text-ink">{it.label || "Untitled"}</span>
                {editable && <span className="text-caption" style={{ color: "var(--faint)" }}>⠿</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── The "refined" vocabulary — pie → tick → seal, one calm green ─────────────
// A refined item is one Nuvo understands (shaped + sound, or a domain with
// routing context). The reward for keeping it that way is quiet: no bar to
// finish, just a settled check in the same --ok the readiness pie fills with,
// so "refined" reads identically from a record up to a whole floor.
const REFINED_INK = RIPE_GREEN;

function Check({ size = 11, pathClassName }: { size?: number; pathClassName?: string }) {
  return (
    <Icon name="check" size={size} className={pathClassName} />
  );
}

/** One-time celebration gate: returns true for ~1s the first time a floor
 *  crosses into rest, then stays false on every revisit (the dopamine belongs to
 *  the transition, not the destination). A per-floor localStorage flag persists
 *  the "already seen" state and resets if the floor later drifts back out. */
export function useRefinedCelebration(floorKey: string, atRest: boolean): boolean {
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    const key = `nuvo:refined-seen:${floorKey}`;
    let seen = false;
    try { seen = localStorage.getItem(key) === "1"; } catch { /* private mode */ }
    if (atRest && !seen) {
      try { localStorage.setItem(key, "1"); } catch { /* ignore */ }
      setCelebrate(true);
      const t = setTimeout(() => setCelebrate(false), 1100);
      return () => clearTimeout(t);
    }
    if (!atRest && seen) {
      try { localStorage.setItem(key, "0"); } catch { /* ignore */ }
    }
  }, [floorKey, atRest]);
  return celebrate;
}

/** Record-level mark: a fully-refined project/initiative/domain wears this in
 *  place of a progress bar — done isn't a track to fill, it's a state at rest. */
export function RefinedTick({ size = 11 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 text-label font-medium"
      style={{ color: REFINED_INK }}
      title="Groomed — shaped and sound; Nuvo can plan and route it"
    >
      <Check size={size} /> Groomed
    </span>
  );
}

/** Floor-level seal: the quiet reward a fully-refined Build floor wears in its
 *  head — a kit chip in the ok tone. Why it pays off rides its tooltip. */
export function RefinedSeal({ noun, celebrate = false }: { noun: string; celebrate?: boolean }) {
  return (
    <span
      className={`k-chip ${celebrate ? "seal-draw" : ""}`}
      data-tone="ok"
      title={`Groomed ${noun} are ${noun} Nuvo understands — clear charter, sound structure. The more of your map is groomed, the better Nuvo plans your week and routes new captures.`}
    >
      <Check pathClassName="seal-check" size={12} />
      <span>All groomed</span>
    </span>
  );
}

// ── The head of a board / wall page ──────────────────────────────────────────
// One hero (the children — a `text-display masthead` that states a fact), an
// optional quiet line under it, and the page's acts on the right. A list page
// has no hero and doesn't use this (the PageBar names it).
export function FloorHeader({
  eyebrow,
  sub,
  children,
  actions,
}: {
  /** @deprecated an eyebrow over a hero restates it (D-189) — prefer `sub`. */
  eyebrow?: ReactNode;
  /** the one quiet line under the hero */
  sub?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="fl-head">
      <div className="fl-head-main">
        {eyebrow && <div className="fl-head-sub" style={{ margin: "0 0 6px" }}>{eyebrow}</div>}
        {children}
        {sub && <p className="fl-head-sub">{sub}</p>}
      </div>
      {actions && <div className="fl-head-acts">{actions}</div>}
    </div>
  );
}
