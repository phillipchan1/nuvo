// Shared building blocks for the vertical floors: inline editors, progress
// bars, status/momentum chips, an energy picker, and a zoomable Gantt timeline.
// Everything is keyboard-friendly and uses the Twilight tokens.

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
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
import type { Momentum, ProjectStatus } from "../../lib/vertical";
import type { CollectionSelection } from "../../hooks/useCollectionSelection";
import { SelectCheckbox, itemSelectRowClass } from "./collectionSelection";

// ── Shared status vocab (kept here so board/detail/initiative agree) ─────────
export const PROJECT_STATUS: ProjectStatus[] = ["backlog", "in_progress", "waiting", "cancelled", "complete"];
export const PROJECT_STATUS_COLORS: Record<ProjectStatus, string> = {
  backlog: "var(--muted)",
  in_progress: "var(--accent)",
  waiting: "#D97706",
  cancelled: "var(--signal)",
  complete: "#0D9488",
};
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  backlog: "Backlog",
  in_progress: "In progress",
  waiting: "Waiting",
  cancelled: "Cancelled",
  complete: "Complete",
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
  const label = labels?.[value] ?? value;
  const color = colors[value] ?? "var(--muted)";
  const isFilled = filled?.has(value);
  return (
    <span className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        className="fast mono rounded-full border px-2 py-0.5 text-[10px]"
        style={{
          borderColor: color,
          color: isFilled ? "#fff" : color,
          background: isFilled ? color : "transparent",
        }}
      >
        {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="rise elev-2 absolute left-0 top-full z-50 mt-1 min-w-[110px] rounded-md border border-line bg-surface py-1">
            {options.map((o) => (
              <button
                key={o}
                onClick={() => { onChange(o); setOpen(false); }}
                className="fast mono block w-full px-2.5 py-1 text-left text-[11px] hover:bg-accent-soft"
                style={{ color: colors[o] ?? "var(--muted)" }}
              >
                {labels?.[o] ?? o}
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

const ROW = 34;
const AXIS_H = 42;
const LABEL_W = 172;
const MIN_BAR = 10;
const EMPTY_H = 132;

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

  // live preview while dragging an existing bar (commit on release)
  const [drag, setDrag] = useState<{ id: string; start: number; end: number } | null>(null);
  const session = useRef<{ mode: DragMode; startX: number; origStart: number; origEnd: number; moved: boolean } | null>(null);

  // live preview while dragging an undated item in from the tray
  const [tray, setTray] = useState<{ id: string; x: number; y: number; ms: number | null } | null>(null);
  const trayRef = useRef<{ moved: boolean } | null>(null);

  const choose = (z: TimelineZoom) => {
    setZoom(z);
    if (persistKey) {
      try { localStorage.setItem(`nuvo.timeline.zoom.${persistKey}`, z); } catch { /* ignore */ }
    }
  };

  const dated = items.filter((i) => i.start || i.end);
  const undated = items.filter((i) => !i.start && !i.end);

  const stamps = dated.flatMap((i) => [parse(i.start), parse(i.end)].filter((x): x is number => x != null));
  const todayMs = today.getTime();
  const lo = new Date(stamps.length ? Math.min(...stamps, todayMs) : todayMs);
  const hi = new Date(stamps.length ? Math.max(...stamps, todayMs) : todayMs);
  const { origin, end } = rangeFor(zoom, lo, hi);
  const originMs = origin.getTime();
  const x = (ms: number) => ((ms - originMs) / DAY) * pxPerDay;
  const totalWidth = Math.max(1, Math.ceil(x(end.getTime())));
  const { majors, minors, weekends } = buildTicks(zoom, origin, end, x);
  const todayX = x(snapDay(todayMs) + DAY / 2);

  const bodyRows = dated.length;
  const bodyHeight = Math.max(bodyRows * ROW + (tray ? ROW : 0), EMPTY_H);

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
    const origStart = parse(it.start) ?? parse(it.end)!;
    const origEnd = parse(it.end) ?? parse(it.start)!;
    const msPerPx = DAY / pxPerDay;
    session.current = { mode, startX: e.clientX, origStart, origEnd, moved: false };
    setDrag({ id: it.id, start: origStart, end: origEnd });

    const onMove = (ev: PointerEvent) => {
      const s = session.current;
      if (!s) return;
      const dms = (ev.clientX - s.startX) * msPerPx;
      if (Math.abs(ev.clientX - s.startX) > 3) s.moved = true;
      let start = s.origStart;
      let endMs = s.origEnd;
      if (s.mode === "move") { start = snapDay(s.origStart + dms); endMs = start + (s.origEnd - s.origStart); }
      else if (s.mode === "start") { start = Math.min(snapDay(s.origStart + dms), s.origEnd); }
      else { endMs = Math.max(snapDay(s.origEnd + dms), s.origStart); }
      setDrag({ id: it.id, start, end: endMs });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const s = session.current;
      session.current = null;
      setDrag((cur) => {
        if (s && cur) {
          if (s.moved) it.onChangeDates!(it.start ? toISO(cur.start) : null, it.end ? toISO(cur.end) : null);
          else it.onClick?.();
        }
        return null;
      });
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

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface" style={{ userSelect: drag || tray ? "none" : "auto" }}>
      {/* toolbar — zoom · navigation · counts */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-bg px-2.5 py-1.5">
        <div className="inline-flex rounded-md border border-line p-0.5">
          {ZOOMS.map((z) => (
            <button
              key={z.id}
              onClick={() => choose(z.id)}
              className="fast mono rounded-[5px] px-2 py-0.5 text-[10px]"
              style={{ background: zoom === z.id ? "var(--accent)" : "transparent", color: zoom === z.id ? "#fff" : "var(--muted)" }}
            >
              {z.label}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center gap-0.5">
          <button onClick={() => nudge(-1)} title="Earlier" className="fast mono flex h-6 w-6 items-center justify-center rounded border border-line text-[12px] text-muted hover:text-ink">‹</button>
          <button onClick={centerToday} title="Jump to today" className="fast mono rounded border border-line px-2 py-0.5 text-[10px] text-muted hover:text-ink">Today</button>
          <button onClick={() => nudge(1)} title="Later" className="fast mono flex h-6 w-6 items-center justify-center rounded border border-line text-[12px] text-muted hover:text-ink">›</button>
        </div>
        <div className="flex-1" />
        <span className="mono text-[10px] text-muted">
          {dated.length} scheduled{undated.length ? ` · ${undated.length} unscheduled` : ""}
        </span>
      </div>

      {/* chart — fixed name column + horizontally-scrolling grid */}
      <div className="flex">
        <div className="shrink-0 border-r border-line" style={{ width: LABEL_W }}>
          <div className="border-b border-line bg-bg" style={{ height: AXIS_H }}>
            <div className="mono flex h-full items-end px-2.5 pb-1 text-[9px] uppercase text-muted">Name</div>
          </div>
          {dated.map((it) => {
            const picked = selection?.isSelected(it.id);
            const preview = selection?.isPreviewSelected(it.id);
            const visual = picked ? "selected" : preview ? "preview" : "none";
            return (
              <div
                key={it.id}
                data-select-id={selection ? it.id : undefined}
                ref={selection ? (el) => selection.registerRef(it.id, el) : undefined}
                onMouseDown={selection ? selection.itemPointerDown(it.id) : undefined}
                className={`flex items-center gap-1.5 px-2.5 ${selection ? itemSelectRowClass(selection, it.id) : "hover:bg-accent-soft/50"}`}
                style={{ height: ROW }}
              >
                {selection && (
                  <span data-no-select>
                    <SelectCheckbox
                      checked={visual === "selected"}
                      preview={visual === "preview"}
                      onToggle={() => selection.pick(it.id, { extend: true, range: false })}
                    />
                  </span>
                )}
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: it.color, opacity: it.dim ? 0.5 : 1 }} />
                <button onClick={it.onClick} className="fast truncate text-left text-[11px] text-ink hover:text-accent" title={it.label}>{it.label || "Untitled"}</button>
              </div>
            );
          })}
          {dated.length === 0 && <div className="px-2.5" style={{ height: EMPTY_H }} aria-hidden />}
        </div>

        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
          <div style={{ width: totalWidth }}>
            {/* axis */}
            <div className="relative border-b border-line bg-bg" style={{ height: AXIS_H }}>
              {majors.map((g) => (
                <div key={g.key} className="absolute top-0 flex items-center overflow-hidden border-r border-line px-1.5" style={{ left: g.left, width: g.width, height: 19 }}>
                  <span className="mono whitespace-nowrap text-[9px] font-semibold uppercase tracking-wide text-muted">{g.label}</span>
                </div>
              ))}
              {minors.map((t) => (
                <div
                  key={t.key}
                  className="absolute flex items-end pb-1"
                  style={{ left: t.left, top: 19, bottom: 0, width: t.width ?? 26, paddingLeft: t.width ? 0 : 3, justifyContent: t.width ? "center" : "flex-start" }}
                >
                  <span className={`mono whitespace-nowrap text-[9px] ${t.weekend ? "text-muted/55" : "text-muted"}`}>{t.label}</span>
                </div>
              ))}
              <div className="absolute -top-px flex flex-col items-center" style={{ left: todayX, transform: "translateX(-50%)" }}>
                <span className="mono rounded-sm px-1 text-[8px] font-semibold uppercase tracking-wide text-white" style={{ background: "var(--signal)" }}>Today</span>
              </div>
            </div>

            {/* body */}
            <div ref={bodyRef} className="relative" style={{ height: bodyHeight }}>
              {/* background: weekend bands · gridlines · today */}
              <div className="pointer-events-none absolute inset-0">
                {weekends.map((w) => (
                  <div key={w.key} className="absolute top-0 bottom-0" style={{ left: w.left, width: w.width, background: "color-mix(in srgb, var(--muted) 7%, transparent)" }} />
                ))}
                {minors.map((t) => (
                  <div key={t.key} className="absolute top-0 bottom-0 w-px" style={{ left: t.left, background: t.strong ? "var(--line-strong)" : "color-mix(in srgb, var(--line) 55%, transparent)" }} />
                ))}
                <div className="absolute top-0 bottom-0 w-px" style={{ left: todayX, background: "var(--signal)", opacity: 0.7 }} />
              </div>

              {/* bars */}
              {dated.map((it, row) => {
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
                  <div key={it.id} className="group absolute" style={{ top: row * ROW + 6, left, width, height: ROW - 12 }}>
                    <div
                      onPointerDown={editable ? (ev) => startBarDrag(it, "move", ev) : undefined}
                      onClick={!editable ? it.onClick : undefined}
                      className={`fast relative flex h-full items-center overflow-hidden rounded px-2 ${editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                      style={{ background: it.dim ? "var(--bg)" : `${it.color}26`, border: `1px solid ${it.color}`, opacity: it.dim ? 0.6 : 1 }}
                      title={`${it.label}${it.start ? ` · ${fmtDate(it.start)}` : ""}${it.end ? ` → ${fmtDate(it.end)}` : ""} · ${it.progress}%`}
                    >
                      <div className="absolute left-0 top-0 bottom-0" style={{ width: `${Math.max(0, Math.min(100, it.progress))}%`, background: `${it.color}33` }} />
                      {wide ? (
                        <>
                          <span className="relative truncate text-[10px] text-ink">{it.label}</span>
                          <span className="relative mono ml-auto pl-2 text-[9px] text-muted">{it.progress}%</span>
                        </>
                      ) : (
                        <span className="relative mono text-[9px] text-muted">{it.progress > 0 ? `${it.progress}%` : ""}</span>
                      )}
                    </div>
                    {editable && (
                      <>
                        <span onPointerDown={(ev) => startBarDrag(it, "start", ev)} className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize rounded-l opacity-0 group-hover:opacity-100" style={{ background: it.color }} title="Drag the start" />
                        <span onPointerDown={(ev) => startBarDrag(it, "end", ev)} className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize rounded-r opacity-0 group-hover:opacity-100" style={{ background: it.color }} title="Drag the target" />
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
                    <div className="pointer-events-none absolute rounded border-2 border-dashed" style={{ left: gl, top: bodyRows * ROW + 6, width: gw, height: ROW - 12, borderColor: c, background: `${c}1f` }} />
                    <div className="pointer-events-none absolute mono text-[9px] font-semibold text-accent" style={{ left: gl + 3, top: Math.max(0, bodyRows * ROW - 8) }}>{fmtDate(toISO(start))}</div>
                  </>
                );
              })()}

              {/* empty hint — the grid still renders so the surface never reads blank */}
              {dated.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center">
                  <span className="mono max-w-[420px] text-[11px] text-muted">
                    {undated.length
                      ? "Nothing scheduled yet — drag a card up from Unassigned onto the grid to give it dates."
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
            className="pointer-events-none fixed z-[300] flex items-center gap-1.5 rounded border bg-surface px-2 py-1 text-[10px] shadow-lg"
            style={{ left: tray.x + 12, top: tray.y + 12, borderColor: it.color }}
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
    <div className="border-t border-line bg-bg/60 px-2.5 py-2">
      <button onClick={() => setOpen((o) => !o)} className="fast mono mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted hover:text-ink">
        <span className="text-[8px]">{open ? "▾" : "▸"}</span>
        Unassigned · {items.length}
        <span className="ml-1 normal-case tracking-normal text-muted/70">drag onto the grid to schedule</span>
      </button>
      {open && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((it) => {
            const editable = !!it.onChangeDates;
            return (
              <div
                key={it.id}
                data-no-select
                onPointerDown={editable ? (e) => onStart(it, e) : undefined}
                onClick={!editable ? it.onClick : undefined}
                className={`fast flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[11px] ${editable ? "cursor-grab active:cursor-grabbing hover:border-muted" : "cursor-pointer"} ${draggingId === it.id ? "opacity-40" : ""}`}
                title={editable ? `${it.label} — drag onto the grid to schedule` : it.label}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: it.color }} />
                <span className="max-w-[200px] truncate text-ink">{it.label || "Untitled"}</span>
              </div>
            );
          })}
        </div>
      )}
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
