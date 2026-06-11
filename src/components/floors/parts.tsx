// Shared building blocks for the vertical floors: inline editors, progress
// bars, status/momentum chips, an energy picker, and a month-scale timeline.
// Everything is keyboard-friendly and uses the Daylight tokens.

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ENERGY_META, ENERGY_ORDER, type Energy } from "../../lib/energy";
import type { Momentum, ProjectStatus } from "../../lib/vertical";

// ── Shared status vocab (kept here so board/detail/initiative agree) ─────────
export const PROJECT_STATUS: ProjectStatus[] = ["planned", "active", "blocked", "done"];
export const PROJECT_STATUS_COLORS: Record<ProjectStatus, string> = {
  planned: "var(--muted)", active: "var(--accent)", blocked: "var(--signal)", done: "#0D9488",
};
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planned: "Backlog", active: "In progress", blocked: "Blocked", done: "Done",
};
export const INITIATIVE_STATUS = ["active", "paused", "shipped", "dropped"] as const;
export const INITIATIVE_STATUS_COLORS: Record<string, string> = {
  active: "var(--accent)", paused: "var(--muted)", shipped: "#059669", dropped: "var(--signal)",
};

// ── Progress bar with optional baseline marker (the Gain frame) ──────────────
export function Bar({ pct, color, baseline, h = 1.5 }: { pct: number; color: string; baseline?: number; h?: number }) {
  return (
    <div className="relative my-1.5 rounded-full bg-bg" style={{ height: h * 4 }}>
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
    <button onClick={onClick} disabled={!onClick} className="fast mono text-[10px] text-muted hover:text-ink disabled:cursor-default">
      {dir === "up" ? "↑" : "↓"} {label}
    </button>
  );
}

// ── Inline single-line editor: click text → input, commit on blur/Enter ──────
export function InlineText({
  value,
  onChange,
  placeholder = "—",
  className = "",
  inputClassName = "",
  autoFocusEmpty = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  autoFocusEmpty?: boolean;
}) {
  const [editing, setEditing] = useState(autoFocusEmpty && value === "");
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(value), [value]);
  useLayoutEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onChange(draft.trim());
  };

  if (editing) {
    return (
      <input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        className={`w-full rounded-sm border border-accent bg-surface px-1 py-0.5 outline-none ${inputClassName || className}`}
      />
    );
  }
  return (
    <span
      onClick={() => setEditing(true)}
      className={`fast cursor-text rounded-sm hover:bg-accent-soft ${className} ${value ? "" : "text-muted italic"}`}
      title="Click to edit"
    >
      {value || placeholder}
    </span>
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
      className={`fast cursor-text whitespace-pre-wrap rounded-sm leading-relaxed hover:bg-accent-soft ${className} ${value ? "" : "text-muted italic"}`}
      title="Click to edit"
    >
      {value || placeholder}
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
    <span onClick={() => setEditing(true)} className={`fast mono cursor-text rounded-sm hover:bg-accent-soft ${className}`} title="Click to edit">
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
        className={`fast mono rounded-sm px-1 text-[11px] hover:bg-accent-soft ${value ? "text-ink" : "text-muted italic"}`}
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
        <button onClick={() => onChange(null)} className="fast ml-0.5 text-[10px] text-muted hover:text-signal" title="Clear">×</button>
      )}
    </span>
  );
}

// ── Status / momentum chips ──────────────────────────────────────────────────
export function StatusPill<T extends string>({
  value,
  options,
  colors,
  onChange,
}: {
  value: T;
  options: T[];
  colors: Record<string, string>;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        className="fast mono rounded-full border px-2 py-0.5 text-[10px]"
        style={{ borderColor: colors[value] ?? "var(--line)", color: colors[value] ?? "var(--muted)" }}
      >
        {value}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 min-w-[110px] border border-line bg-surface py-1 shadow-lg">
            {options.map((o) => (
              <button
                key={o}
                onClick={() => { onChange(o); setOpen(false); }}
                className="fast mono block w-full px-2.5 py-1 text-left text-[11px] hover:bg-accent-soft"
                style={{ color: colors[o] ?? "var(--muted)" }}
              >
                {o}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

export function MomentumChip({ value, onChange }: { value: Momentum; onChange: (v: Momentum) => void }) {
  const next: Record<Momentum, Momentum> = { up: "flat", flat: "down", down: "up" };
  const glyph = value === "up" ? "↑ rising" : value === "down" ? "↓ stalled" : "→ steady";
  const color = value === "up" ? "var(--accent)" : value === "down" ? "var(--signal)" : "var(--muted)";
  return (
    <button onClick={() => onChange(next[value])} className="fast mono text-[10px]" style={{ color }} title="Cycle momentum">
      {glyph}
    </button>
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
          className="fast h-5 w-5 rounded-sm text-[11px]"
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
      className={`fast flex h-6 w-6 items-center justify-center rounded-full border border-line text-[12px] hover:border-muted ${danger ? "hover:border-signal hover:text-signal" : "hover:text-ink"} text-muted`}
    >
      {children}
    </button>
  );
}

// ── Confirm-delete inline ────────────────────────────────────────────────────
export function DeleteBtn({ onDelete, what }: { onDelete: () => void; what: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 2600);
    return () => clearTimeout(t);
  }, [armed]);
  if (armed)
    return (
      <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="fast mono rounded-sm border border-signal px-1.5 py-0.5 text-[10px] text-signal">
        delete {what}?
      </button>
    );
  return <IconBtn onClick={() => setArmed(true)} title={`Delete ${what}`} danger>✕</IconBtn>;
}

// ── Month-scale timeline ─────────────────────────────────────────────────────
export interface TimelineItem {
  id: string;
  label: string;
  color: string;
  start: string | null;
  end: string | null;
  progress: number;
  dim?: boolean;
  onClick?: () => void;
  // when present, the bar can be dragged to move and its edges resized
  onChangeDates?: (start: string | null, end: string | null) => void;
}

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

type DragMode = "move" | "start" | "end";

export function Timeline({ items, today = new Date() }: { items: TimelineItem[]; today?: Date }) {
  const barsRef = useRef<HTMLDivElement>(null);
  // live preview while dragging a bar (commit on release)
  const [drag, setDrag] = useState<{ id: string; start: number; end: number } | null>(null);
  const session = useRef<{ mode: DragMode; startX: number; origStart: number; origEnd: number; msPerPx: number; moved: boolean } | null>(null);

  const dated = items.filter((i) => i.start || i.end);
  const stamps = dated.flatMap((i) => [parse(i.start), parse(i.end)].filter((x): x is number => x != null));
  const todayMs = today.getTime();
  if (stamps.length === 0) {
    return <div className="mono py-6 text-center text-[11px] text-muted">No dated work yet — set start/target dates to see the timeline.</div>;
  }

  let min = Math.min(...stamps, todayMs);
  let max = Math.max(...stamps, todayMs);
  // pad the range by ~8% on each side, min 10 days
  const pad = Math.max(10 * DAY, (max - min) * 0.08);
  min -= pad;
  max += pad;
  const span = max - min || DAY;
  const pos = (ms: number) => ((ms - min) / span) * 100;

  // month gridlines
  const gridlines: { left: number; label: string }[] = [];
  const cur = new Date(min);
  cur.setDate(1);
  cur.setHours(0, 0, 0, 0);
  while (cur.getTime() <= max) {
    gridlines.push({ left: pos(cur.getTime()), label: `${MONTHS[cur.getMonth()]}` });
    cur.setMonth(cur.getMonth() + 1);
  }

  const startDrag = (it: TimelineItem, mode: DragMode, e: ReactPointerEvent) => {
    if (!it.onChangeDates || !barsRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const width = barsRef.current.getBoundingClientRect().width;
    const origStart = parse(it.start) ?? parse(it.end)!;
    const origEnd = parse(it.end) ?? parse(it.start)!;
    session.current = { mode, startX: e.clientX, origStart, origEnd, msPerPx: span / width, moved: false };
    setDrag({ id: it.id, start: origStart, end: origEnd });

    const onMove = (ev: PointerEvent) => {
      const s = session.current;
      if (!s) return;
      const dms = (ev.clientX - s.startX) * s.msPerPx;
      if (Math.abs(ev.clientX - s.startX) > 3) s.moved = true;
      let start = s.origStart;
      let end = s.origEnd;
      if (s.mode === "move") { start = snapDay(s.origStart + dms); end = start + (s.origEnd - s.origStart); }
      else if (s.mode === "start") { start = Math.min(snapDay(s.origStart + dms), s.origEnd); }
      else { end = Math.max(snapDay(s.origEnd + dms), s.origStart); }
      setDrag({ id: it.id, start, end });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const s = session.current;
      session.current = null;
      setDrag((cur2) => {
        if (s && cur2) {
          if (s.moved) it.onChangeDates!(it.start ? toISO(cur2.start) : null, it.end ? toISO(cur2.end) : null);
          else it.onClick?.();
        }
        return null;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const ROW = 30;
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface" style={{ userSelect: drag ? "none" : "auto" }}>
      {/* month header */}
      <div className="relative h-6 border-b border-line bg-bg">
        {gridlines.map((g, i) => (
          <div key={i} className="absolute top-0 bottom-0 flex items-center pl-1" style={{ left: `${g.left}%` }}>
            <div className="mono text-[9px] uppercase text-muted">{g.label}</div>
          </div>
        ))}
      </div>
      <div ref={barsRef} className="relative" style={{ height: dated.length * ROW + 8 }}>
        {/* gridlines */}
        {gridlines.map((g, i) => (
          <div key={i} className="absolute top-0 bottom-0 w-px bg-line" style={{ left: `${g.left}%` }} />
        ))}
        {/* today marker */}
        <div className="absolute top-0 bottom-0 w-px" style={{ left: `${pos(todayMs)}%`, background: "var(--signal)" }}>
          <div className="mono absolute -top-0 left-1 text-[8px] text-signal">today</div>
        </div>
        {/* bars */}
        {dated.map((it, row) => {
          const live = drag && drag.id === it.id ? drag : null;
          const s = live ? live.start : parse(it.start) ?? parse(it.end)!;
          const e = live ? live.end : parse(it.end) ?? parse(it.start)!;
          const left = pos(Math.min(s, e));
          const width = Math.max(2, pos(Math.max(s, e)) - pos(Math.min(s, e)));
          const editable = !!it.onChangeDates;
          return (
            <div
              key={it.id}
              className="group absolute"
              style={{ top: row * ROW + 6, left: `${left}%`, width: `${width}%`, height: ROW - 10, minWidth: 80 }}
            >
              <div
                onPointerDown={editable ? (ev) => startDrag(it, "move", ev) : undefined}
                onClick={!editable ? it.onClick : undefined}
                className={`fast relative flex h-full items-center overflow-hidden rounded-sm px-2 text-left ${editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                style={{ background: it.dim ? "var(--bg)" : `${it.color}22`, border: `1px solid ${it.color}`, opacity: it.dim ? 0.6 : 1 }}
                title={editable ? `${it.label} — drag to move, edges to resize` : it.label}
              >
                <div className="absolute left-0 top-0 bottom-0 rounded-sm" style={{ width: `${it.progress}%`, background: `${it.color}33` }} />
                <span className="relative truncate text-[11px] text-ink">{it.label}</span>
                <span className="relative mono ml-auto pl-2 text-[9px] text-muted">{it.progress}%</span>
              </div>
              {editable && (
                <>
                  <span onPointerDown={(ev) => startDrag(it, "start", ev)} className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize rounded-l-sm opacity-0 group-hover:opacity-100" style={{ background: it.color }} title="Drag the start" />
                  <span onPointerDown={(ev) => startDrag(it, "end", ev)} className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize rounded-r-sm opacity-0 group-hover:opacity-100" style={{ background: it.color }} title="Drag the target" />
                </>
              )}
            </div>
          );
        })}
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
