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

  useLayoutEffect(() => {
    if (!open) {
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
  }, [open, align, anchorRef, minWidth]);

  if (!open) return null;
  // Above RecordModal (z-60) and its scrim so pickers still work inside a record.
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[70]"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        ref={menuRef}
        className="rise elev-2 fixed z-[71] rounded-md border border-line bg-surface py-1"
        style={{
          top: pos?.top ?? -9999,
          left: pos?.left ?? -9999,
          minWidth,
          visibility: pos ? "visible" : "hidden",
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

// ── Ripeness pip — ambient readiness, gray (raw) → green (active) ────────────
// The one source for the dot is the computed Ripeness; the ramp leans on the
// "complete" teal already in the status vocab, so no new green is introduced.
const RIPE_GREEN = PROJECT_STATUS_COLORS.complete;
const RIPE_AMBER = PROJECT_STATUS_COLORS.waiting; // the "looks ready, not verified" caution
const RIPE_FILL: Record<Ripeness, string> = {
  raw: "var(--muted)",
  shaped: `color-mix(in srgb, ${RIPE_GREEN} 40%, var(--muted))`,
  scaffolded: `color-mix(in srgb, ${RIPE_GREEN} 72%, var(--muted))`,
  active: RIPE_GREEN,
  resting: "var(--line-strong)",
};

/** `unsound` marks a structurally-Active item Nuvo hasn't verified sound — it
 *  reads green-but-flagged (amber ring) so the portfolio shows TRUE readiness,
 *  not just filled boxes. Only meaningful on the Active stage. */
export function RipenessPip({ stage, unsound = false, size = 7 }: { stage: Ripeness; unsound?: boolean; size?: number }) {
  const fill = RIPE_FILL[stage];
  const resting = stage === "resting";
  const flag = unsound && stage === "active";
  return (
    <span
      title={flag ? "Active — but Nuvo hasn't verified it sound yet" : `${RIPENESS_LABEL[stage]} — ${RIPENESS_HINT[stage]}`}
      aria-label={`Ripeness: ${RIPENESS_LABEL[stage]}${flag ? " (unverified)" : ""}`}
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: resting ? "transparent" : fill,
        border: resting ? `1.5px solid ${fill}` : flag ? `1.5px solid ${RIPE_AMBER}` : "none",
        opacity: resting ? 0.7 : stage === "raw" ? 0.5 : 1,
        boxShadow: flag
          ? `0 0 4px color-mix(in srgb, ${RIPE_AMBER} 55%, transparent)`
          : stage === "active" ? `0 0 5px color-mix(in srgb, ${RIPE_GREEN} 55%, transparent)` : "none",
      }}
    />
  );
}

// ── Progress bar with optional baseline marker (the Gain frame) ──────────────
export function Bar({ pct, color, baseline, h = 1.5 }: { pct: number; color: string; baseline?: number; h?: number }) {
  return (
    <div className="relative my-1.5 rounded-full" style={{ height: h * 4, background: "var(--line)" }}>
      <div className="fast absolute left-0 top-0 bottom-0 rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
      {baseline != null && (
        <div className="absolute top-[-2px] bottom-[-2px] w-px bg-muted" style={{ left: `${baseline}%` }} />
      )}
    </div>
  );
}

// ── Up/down traversal hook ───────────────────────────────────────────────────
export function Hook({ dir, label, onClick }: { dir: "up" | "down"; label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} className="fast mono text-meta text-muted hover:text-ink disabled:cursor-default">
      {dir === "up" ? "↑" : "↓"} {label}
    </button>
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
        className={`w-full resize-none rounded-sm border border-accent bg-surface px-2 py-1.5 leading-relaxed outline-none ${className}`}
      />
    );
  }
  return (
    <p
      onClick={() => setEditing(true)}
      className={`fast cursor-text whitespace-pre-wrap rounded-sm leading-relaxed hover:bg-accent-soft ${className} ${draft ? "" : "text-muted italic"}`}
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
        className={`w-16 rounded-sm border border-accent bg-surface px-1 py-0.5 text-right outline-none mono ${className}`}
      />
    );
  }
  return (
    // The editor it opens already handles Enter/Escape — but until now there was
    // no keyboard way to *reach* it, so the whole field was mouse-only.
    <span
      {...pressable(() => setEditing(true), { label: `Edit — currently ${value}${suffix ?? ""}` })}
      className={`fast mono cursor-text rounded-sm hover:bg-accent-soft ${className}`}
      title="Click to edit"
    >
      {value}{suffix}
    </span>
  );
}

// ── Inline date editor (native picker behind a chip) ─────────────────────────
export function InlineDate({ value, onChange, placeholder = "set date" }: { value: string | null; onChange: (v: string | null) => void; placeholder?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="relative inline-flex items-center">
      <button
        onClick={() => { const el = ref.current; if (el) { try { el.showPicker(); } catch { el.focus(); } } }}
        className={`fast mono rounded-sm px-1 text-label hover:bg-accent-soft ${value ? "text-ink" : "text-muted italic"}`}
      >
        {value ? fmtDate(value) : placeholder}
      </button>
      <input
        ref={ref}
        type="date"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="pointer-events-none absolute left-0 h-0 w-0 opacity-0"
      />
      {value && (
        <button onClick={() => onChange(null)} className="fast ml-0.5 text-meta text-muted hover:text-signal" title="Clear">×</button>
      )}
    </span>
  );
}

// ── Status / momentum chips ──────────────────────────────────────────────────
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
    <span className="relative inline-block">
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className="fast mono rounded-full border px-2 py-0.5 text-meta"
        style={{
          borderColor: color,
          color: isFilled ? "#fff" : color,
          background: isFilled ? color : "transparent",
        }}
      >
        {label}
      </button>
      <FloatingMenu open={open} anchorRef={btnRef} minWidth={110} onClose={() => setOpen(false)}>
        {options.map((o) => (
          <button
            key={o}
            onClick={() => { onChange(o); setOpen(false); }}
            className="fast mono block w-full px-2.5 py-1 text-left text-label hover:bg-accent-soft"
            style={{ color: colors[o] ?? "var(--muted)" }}
          >
            {labels?.[o] ?? o}
          </button>
        ))}
      </FloatingMenu>
    </span>
  );
}

export function MomentumChip({ value, onChange }: { value: Momentum; onChange: (v: Momentum) => void }) {
  const next: Record<Momentum, Momentum> = { up: "flat", flat: "down", down: "up" };
  const glyph = value === "up" ? "↑ rising" : value === "down" ? "↓ stalled" : "→ steady";
  const color = value === "up" ? "var(--accent)" : value === "down" ? "var(--signal)" : "var(--muted)";
  return (
    <button onClick={() => onChange(next[value])} className="fast mono text-meta" style={{ color }} title="Cycle momentum">
      {glyph}
    </button>
  );
}

// ── Domain picker — reassign which domain a record lives under ────────────────
export function DomainPicker({
  domains,
  value,
  onChange,
  align = "left",
  size = "sm",
}: {
  domains: Domain[];
  value: string;
  onChange: (domainId: string) => void;
  /** Which edge the menu hangs from — "left" opens under the trigger, "right"
   *  right-aligns it (for triggers near the right edge of the viewport). */
  align?: "left" | "right";
  /** `lg` on the record, where routing this thing to the right area is a primary
   *  act and not a breadcrumb — it was set at meta size, the same weight as the
   *  crumb text beside it, so it read as a label rather than a control. The
   *  border goes with the size: one tinted fill carries it. */
  size?: "sm" | "lg";
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const cur = domains.find((d) => d.id === value);
  const color = cur?.color ?? "var(--muted)";
  const lg = size === "lg";
  return (
    <span className="relative inline-block">
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={`fast tap flex items-center rounded-full ${
          lg ? "gap-2 px-3.5 py-1.5 text-caption hover:brightness-95" : "gap-1.5 border px-2 py-0.5 text-meta"
        }`}
        style={{ color, background: lg ? `${color}1f` : `${color}12`, ...(lg ? {} : { borderColor: `${color}66` }) }}
        title="Change domain"
      >
        <span className={lg ? "text-body leading-none" : undefined}>{cur?.icon ?? "◇"}</span>
        <span className="font-medium">{cur?.name ?? "Domain"}</span>
        <span className="opacity-40">▾</span>
      </button>
      <FloatingMenu open={open} anchorRef={btnRef} align={align} minWidth={lg ? 200 : 170} onClose={() => setOpen(false)}>
        {domains.map((d) => (
          <button
            key={d.id}
            onClick={() => { onChange(d.id); setOpen(false); }}
            className={`fast tap flex w-full items-center gap-2.5 text-left hover:bg-accent-soft ${
              lg ? "px-3 py-2.5 text-body" : "px-2.5 py-1.5 text-label"
            }`}
            style={{ color: d.id === value ? d.color : "var(--text)" }}
          >
            <span className={lg ? "text-body leading-none" : undefined} style={{ color: d.color }}>{d.icon}</span>
            <span className="truncate">{d.name}</span>
            {d.id === value && <span className="ml-auto text-micro opacity-60">✓</span>}
          </button>
        ))}
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
    <span className="relative inline-block">
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={`fast tap flex items-center rounded-full ${
          lg ? "gap-1.5 px-2.5 py-1 text-caption hover:bg-accent-soft/40" : "gap-1 border border-line px-2 py-0.5 text-meta"
        }`}
        style={cur ? undefined : { color: "var(--muted)" }}
        title="Change which initiative this belongs to"
      >
        <span className={cur ? "truncate font-medium" : "truncate"} style={{ maxWidth: lg ? 160 : 120 }}>
          {cur?.name ?? "No initiative"}
        </span>
        <span className="opacity-40">▾</span>
      </button>
      <FloatingMenu open={open} anchorRef={btnRef} align={align} minWidth={lg ? 200 : 170} onClose={() => setOpen(false)}>
        {cur && onOpen && (
          <>
            <button
              onClick={() => { onOpen(cur.id); setOpen(false); }}
              className="fast block w-full px-2.5 py-1.5 text-left text-label text-muted hover:bg-accent-soft"
            >
              Open “{cur.name}” →
            </button>
            <div className="my-1 h-px bg-line" />
          </>
        )}
        {initiatives.map((i) => (
          <button
            key={i.id}
            onClick={() => { onChange(i.id); setOpen(false); }}
            className="fast flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-label hover:bg-accent-soft"
            style={{ color: i.id === value ? "var(--accent)" : "var(--text)" }}
          >
            <span className="truncate">{i.name}</span>
            {i.id === value && <span className="ml-auto text-micro opacity-60">✓</span>}
          </button>
        ))}
        {value && (
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className="fast mono mt-0.5 block w-full border-t border-line px-2.5 py-1 text-left text-micro text-muted hover:bg-accent-soft"
          >
            no initiative
          </button>
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
    <span className="relative inline-block">
      <button
        ref={btnRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
          setQ("");
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="fast tap text-meta text-muted hover:text-ink"
      >
        + Attach an existing project…
      </button>
      <FloatingMenu open={open} anchorRef={btnRef} minWidth={220} onClose={() => setOpen(false)}>
        <div className="px-2 pb-1">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Find a project…"
            className="w-full rounded-[var(--radius-sm)] border border-line bg-transparent px-2 py-1 text-label outline-none placeholder:text-muted"
            style={{ caretColor: accent }}
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-2.5 py-1.5 text-label text-muted opacity-70">No match</div>
          )}
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => { onAttach(p.id); setOpen(false); }}
              className="fast block w-full truncate px-2.5 py-1.5 text-left text-label hover:bg-accent-soft"
            >
              {p.name || "Untitled"}
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
    <span className="relative inline-block">
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="fast flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-micro"
        style={
          cur
            ? { color, borderColor: `${color}66`, background: softTint(color, 8) }
            : { color: "var(--muted)", borderColor: "var(--line)" }
        }
        title={cur ? `Moves: ${cur.name}` : "Link the key result this moves"}
      >
        <span>◎</span>
        <span className="max-w-[120px] truncate font-medium">{cur ? cur.name : "link KR"}</span>
      </button>
      <FloatingMenu open={open} anchorRef={btnRef} align={align} minWidth={170} onClose={() => setOpen(false)}>
        {keyResults.map((k) => (
          <button
            key={k.id}
            onClick={() => { onChange(k.id === value ? null : k.id); setOpen(false); }}
            className="fast flex w-full items-center gap-2 px-2.5 py-1 text-left text-label hover:bg-accent-soft"
            style={{ color: k.id === value ? color : "var(--text)" }}
          >
            <span style={{ color }}>◎</span>
            <span className="truncate">{k.name}</span>
            {k.id === value && <span className="ml-auto text-micro opacity-60">✓</span>}
          </button>
        ))}
        {value && (
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className="fast mono mt-0.5 block w-full border-t border-line px-2.5 py-1 text-left text-micro text-muted hover:bg-accent-soft"
          >
            unlink
          </button>
        )}
      </FloatingMenu>
    </span>
  );
}

// ── Energy picker ────────────────────────────────────────────────────────────
export function EnergyPicker({ value, onChange, color }: { value: Energy | null; onChange: (v: Energy) => void; color: string }) {
  return (
    <span className="inline-flex gap-1">
      {ENERGY_ORDER.map((e) => (
        <button
          key={e}
          onClick={() => onChange(e)}
          title={`${ENERGY_META[e].label} — ${ENERGY_META[e].blurb}`}
          className="fast h-5 w-5 rounded-sm text-label"
          style={{
            color: value === e ? "#fff" : "var(--muted)",
            background: value === e ? color : "transparent",
            border: `1px solid ${value === e ? color : "var(--line)"}`,
          }}
        >
          {ENERGY_META[e].icon}
        </button>
      ))}
    </span>
  );
}

// ── Small round icon button (edit/delete affordances on hover) ───────────────
export function IconBtn({ children, onClick, title, danger }: { children: ReactNode; onClick: () => void; title?: string; danger?: boolean }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      className={`fast flex h-6 w-6 items-center justify-center rounded-full border border-line text-caption hover:border-muted ${danger ? "hover:border-signal hover:text-signal" : "hover:text-ink"} text-muted`}
    >
      {children}
    </button>
  );
}

// ── Confirm-delete inline ────────────────────────────────────────────────────
/** Destructive, so it says what it does. A bare ✕ next to a "Done" button reads
 *  as "close" — the one thing it isn't. The word is the affordance; the arm step
 *  is the safety. */
export function DeleteBtn({ onDelete, what, phone = false }: { onDelete: () => void; what: string; phone?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 2600);
    return () => clearTimeout(t);
  }, [armed]);
  // `phone` only sizes it to a thumb (44px, body type) — the arm-then-confirm
  // safety and the wording are the same on both shells.
  const size = phone ? "tap px-4 py-2.5 text-body" : "px-2.5 py-1 text-meta";
  if (armed)
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className={`fast rounded-md border font-medium ${size}`}
        style={{ borderColor: "var(--signal)", color: "var(--signal)" }}
      >
        Delete {what}?
      </button>
    );
  return (
    <button
      onClick={() => setArmed(true)}
      title={`Delete this ${what}`}
      className={`fast rounded-md border border-line font-medium text-muted hover:border-signal hover:text-signal ${size}`}
    >
      Delete
    </button>
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
    setDrag({ id: it.id, start: origStart, end: origEnd });

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
      setDrag({ id: it.id, start, end: endMs });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
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

    const onMove = (ev: PointerEvent) => {
      const t = trayRef.current;
      if (!t) return;
      if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) t.moved = true;
      edgeScroll(ev.clientX);
      setTray({ id: it.id, x: ev.clientX, y: ev.clientY, ms: overMsFromPointer(ev.clientX, ev.clientY) });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
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
      {/* toolbar — zoom · navigation · counts. Floats on the paper, no frame. */}
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <div className="inline-flex rounded-lg border border-line p-1">
          {ZOOMS.map((z) => (
            <button
              key={z.id}
              onClick={() => choose(z.id)}
              className="fast rounded-md px-3 py-1.5 text-label font-medium"
              style={{ background: zoom === z.id ? "var(--accent)" : "transparent", color: zoom === z.id ? "var(--on-accent)" : "var(--muted)" }}
            >
              {z.label}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center gap-1">
          <button onClick={() => nudge(-1)} title="Earlier" className="fast flex h-9 w-9 items-center justify-center rounded-lg border border-line text-body text-muted hover:border-line-strong hover:text-ink">‹</button>
          <button onClick={centerToday} title="Jump to today" className="fast rounded-lg border border-line px-3.5 py-1.5 text-label font-medium text-muted hover:border-line-strong hover:text-ink">Today</button>
          <button onClick={() => nudge(1)} title="Later" className="fast flex h-9 w-9 items-center justify-center rounded-lg border border-line text-body text-muted hover:border-line-strong hover:text-ink">›</button>
        </div>
        <div className="flex-1" />
        <span className="mono text-label text-muted">
          {dated.length} scheduled{undated.length ? ` · ${undated.length} unscheduled` : ""}
        </span>
      </div>

      {/* chart — fixed name column + horizontally-scrolling grid */}
      <div className="flex min-h-0 flex-1">
        <div className="relative flex shrink-0 flex-col border-r border-line" style={{ width: labelW }}>
          <div className="shrink-0 border-b border-line" style={{ height: AXIS_H }}>
            <div className="section-label flex h-full items-end px-3 pb-2">Name</div>
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
                        className="fast flex h-4 w-4 shrink-0 items-center justify-center text-micro text-muted hover:text-ink"
                        title={isExp ? "Collapse" : "Expand projects"}
                      >
                        {isExp ? "▾" : "▸"}
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
                    className="shrink-0 rounded-full"
                    style={{ width: isChild ? 7 : 10, height: isChild ? 7 : 10, background: it.color, opacity: it.dim ? 0.5 : isChild ? 0.7 : 1 }}
                  />
                  <button
                    onClick={it.onClick}
                    className={`fast truncate text-left hover:text-accent ${isChild ? "text-caption text-muted" : "text-body text-ink"}`}
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
                  <span className="mono whitespace-nowrap text-micro font-semibold uppercase tracking-wide text-muted">{g.label}</span>
                </div>
              ))}
              {minors.map((t) => (
                <div
                  key={t.key}
                  className="absolute flex items-end pb-1"
                  style={{ left: t.left, top: 19, bottom: 0, width: t.width ?? 26, paddingLeft: t.width ? 0 : 3, justifyContent: t.width ? "center" : "flex-start" }}
                >
                  <span className={`mono whitespace-nowrap text-micro ${t.weekend ? "text-muted/55" : "text-muted"}`}>{t.label}</span>
                </div>
              ))}
              <div className="absolute -top-px flex flex-col items-center" style={{ left: todayX, transform: "translateX(-50%)" }}>
                <span className="mono rounded-sm px-1 text-micro font-semibold uppercase tracking-wide text-white" style={{ background: "var(--signal)" }}>Today</span>
              </div>
            </div>

            {/* body */}
            <div ref={bodyRef} className="relative flex-1" style={{ minHeight: contentHeight }}>
              {/* background: weekend bands · gridlines · today */}
              <div className="pointer-events-none absolute inset-0">
                {weekends.map((w) => (
                  <div key={w.key} className="absolute top-0 bottom-0" style={{ left: w.left, width: w.width, background: "color-mix(in srgb, var(--muted) 7%, transparent)" }} />
                ))}
                {minors.map((t) => (
                  <div key={t.key} className="absolute top-0 bottom-0 w-px" style={{ left: t.left, background: t.strong ? "var(--line-strong)" : "color-mix(in srgb, var(--line) 55%, transparent)" }} />
                ))}
                <div className="absolute top-0 bottom-0 w-px" style={{ left: todayX, background: "var(--signal)", opacity: 0.7, boxShadow: "0 0 10px var(--signal)" }} />
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
                      className={`fast relative flex h-full items-center overflow-hidden rounded px-2 ${editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                      style={{ background: it.dim ? softTint("var(--muted)", 10) : softTint(it.color, 20), border: `1px solid ${it.color}`, opacity: it.dim ? 0.6 : 1 }}
                      title={`${it.label}${it.start ? ` · ${fmtDate(it.start)}` : ""}${it.end ? ` → ${fmtDate(it.end)}` : ""} · ${it.progress}%${editable ? " · drag to move, edges to resize" : ""}`}
                    >
                      <div className="absolute left-0 top-0 bottom-0" style={{ width: `${Math.max(0, Math.min(100, it.progress))}%`, background: softTint(it.color, 28) }} />
                      {wide ? (
                        <>
                          <span className="relative truncate text-meta text-ink">{it.label}</span>
                          <span className="relative mono ml-auto pl-2 text-micro text-muted">{it.progress}%</span>
                        </>
                      ) : (
                        <span className="relative mono text-micro text-muted">{it.progress > 0 ? `${it.progress}%` : ""}</span>
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
                    <div className="pointer-events-none absolute mono text-micro font-semibold text-accent" style={{ left: gl + 3, top: Math.max(0, bodyRows * ROW - 8) }}>{fmtDate(toISO(start))}</div>
                  </>
                );
              })()}

              {/* empty hint — the grid still renders so the surface never reads blank */}
              {dated.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center">
                  <span className="mono max-w-[420px] text-label text-muted">
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
            className="glass-grab pointer-events-none fixed z-[300] flex items-center gap-2 rounded-lg px-3 py-2 text-label"
            style={{ left: tray.x + 12, top: tray.y + 12 }}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: it.color }} />
            <span className="max-w-[160px] truncate text-ink">{it.label || "Untitled"}</span>
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
      <button onClick={() => setOpen((o) => !o)} className="fast mb-2 flex items-center gap-2 text-muted hover:text-ink">
        <span className="text-micro">{open ? "▾" : "▸"}</span>
        <span className="section-label">Unscheduled · {items.length}</span>
        <span className="text-meta text-muted/70">drag a card up onto the grid to give it dates</span>
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
                className={`rise fast group flex shrink-0 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 ${editable ? "cursor-grab active:cursor-grabbing hover:-translate-y-px hover:border-line-strong" : "cursor-pointer"} ${draggingId === it.id ? "opacity-40" : ""}`}
                style={{ animationDelay: `${i * 40}ms` }}
                title={editable ? `${it.label} — drag onto the grid to schedule` : it.label}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: it.color }} />
                <span className="max-w-[220px] truncate text-caption text-ink">{it.label || "Untitled"}</span>
                {editable && <span className="text-meta text-muted/40 group-hover:text-muted">⠿</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── The "refined" vocabulary — pip → tick → seal, one calm green ─────────────
// A refined item is one Nuvo understands (shaped + sound, or a domain with
// routing context). The reward for keeping it that way is quiet: no bar to
// finish, just a settled check in the same RIPE_GREEN the ripeness pip uses, so
// "refined" reads identically from a record up to a whole floor.
const REFINED_INK = `color-mix(in srgb, ${RIPE_GREEN} 55%, var(--muted))`;

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
export function RefinedTick({ size = 9 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center gap-1 text-micro"
      style={{ color: REFINED_INK, letterSpacing: "0.04em" }}
      title="Groomed — shaped and sound; Nuvo can plan and route it"
    >
      <Check size={size} /> groomed
    </span>
  );
}

/** Floor-level seal: the quiet reward a fully-refined Build floor wears in its
 *  header. Not a banner — a small chip, with the "why it pays off" tucked behind
 *  a hover so the at-rest state stays calm but stays teaching. */
export function RefinedSeal({ noun, celebrate = false }: { noun: string; celebrate?: boolean }) {
  return (
    <div className="group/seal relative flex">
      <span
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-label ${celebrate ? "seal-draw" : ""}`}
        style={{
          color: `color-mix(in srgb, ${RIPE_GREEN} 78%, var(--text))`,
          background: `color-mix(in srgb, ${RIPE_GREEN} 11%, transparent)`,
          border: `0.5px solid color-mix(in srgb, ${RIPE_GREEN} 32%, var(--line))`,
        }}
      >
        <Check pathClassName="seal-check" /> all groomed
        <span aria-hidden className="text-meta" style={{ opacity: 0.55 }}>ⓘ</span>
      </span>
      <div
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-50 mt-1.5 w-[252px] rounded-lg border border-line bg-surface p-3 text-left text-meta leading-relaxed text-muted opacity-0 transition-opacity duration-150 group-hover/seal:opacity-100"
        style={{ boxShadow: "var(--shadow-2)" }}
      >
        <span className="mb-1 block font-medium text-ink">Why keep it groomed</span>
        Groomed {noun} are {noun} Nuvo understands — clear charter, sound structure.
        The more of your map is groomed, the better Nuvo plans your week, routes new
        captures, and surfaces what actually matters.
      </div>
    </div>
  );
}

// ── Page-level header for a floor ────────────────────────────────────────────
export function FloorHeader({
  eyebrow,
  children,
  actions,
}: {
  eyebrow?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start gap-4">
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="section-label mb-1">{eyebrow}</div>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
