// A Notion-style collection: one set of records, many views. Projects and
// initiatives are the same shape of thing (a titled record with a status,
// a parent, a progress, and a date range), so they share this component —
// switch between Table · Board · Calendar · Timeline over the same data.

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Bar, InlineDate, InlineText, StatusPill, Timeline, type TimelineItem } from "./parts";
import { Btn } from "../ui";
import { SELECT_INTERACTIVE, useCollectionSelection, type CollectionSelection } from "../../hooks/useCollectionSelection";
import {
  MarqueeOverlay,
  SelectCheckbox,
  SelectionBulkBar,
  SelectionHint,
  itemSelectClass,
  itemSelectRowClass,
  itemSelectVisual,
} from "./collectionSelection";

export interface CollectionRecord {
  id: string;
  title: string;
  subtitle: string;
  domainId: string;
  domainName: string;
  domainIcon?: string;
  accent: string;
  status: string;
  progress: number;
  startDate: string | null;
  targetDate: string | null;
  meta: Record<string, { value: string; color?: string }>;
  setTitle: (v: string) => void;
  setStatus: (s: string) => void;
  setDomain?: (domainId: string) => void;
  setStartDate: (v: string | null) => void;
  setTargetDate: (v: string | null) => void;
  /** Set both dates in one write — avoids a refetch race when dragging a
   *  timeline bar (which moves start + target together). */
  setDates?: (start: string | null, target: string | null) => void;
  open: () => void;
}

export interface CollectionConfig {
  records: CollectionRecord[];
  statusOptions: string[];
  statusColors: Record<string, string>;
  statusLabels?: Record<string, string>;
  extraColumns?: { key: string; label: string }[];
  onNew?: () => void;
  newLabel?: string;
  /** persist the chosen view per collection */
  storageKey: string;
  /** Desktop-grade selection in every view */
  selectable?: boolean;
  onBulkDelete?: (ids: string[]) => void;
}

type View = "table" | "board" | "calendar" | "timeline";
type GroupBy = "status" | "domain";
const VIEWS: { id: View; label: string }[] = [
  { id: "table", label: "Table" },
  { id: "board", label: "Board" },
  { id: "calendar", label: "Calendar" },
  { id: "timeline", label: "Timeline" },
];

function loadPref(key: string, fallback: { view: View; groupBy: GroupBy }) {
  try {
    const raw = localStorage.getItem(`nuvo.view.${key}`);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function savePref(key: string, pref: { view: View; groupBy: GroupBy }) {
  try {
    localStorage.setItem(`nuvo.view.${key}`, JSON.stringify(pref));
  } catch {
    /* ignore */
  }
}

/** Marquee-select surface — stretches to the floor pane so drag can start in open space. */
function SelectionSurface({
  selection,
  className = "",
  children,
}: {
  selection: CollectionSelection;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      {...selection.surfaceProps}
      className={`relative flex min-h-full flex-1 flex-col ${selection.surfaceProps.className} ${className}`}
    >
      {children}
    </div>
  );
}

export default function Collection({ config }: { config: CollectionConfig }) {
  const init = loadPref(config.storageKey, { view: "table", groupBy: "status" });
  const [view, setView] = useState<View>(init.view);
  const [groupBy, setGroupBy] = useState<GroupBy>(init.groupBy);
  const orderedIds = useMemo(() => config.records.map((r) => r.id), [config.records]);
  const selection = useCollectionSelection(orderedIds, !!config.selectable, config.onBulkDelete);

  const choose = (v: View) => { setView(v); savePref(config.storageKey, { view: v, groupBy }); };
  const chooseGroup = (g: GroupBy) => { setGroupBy(g); savePref(config.storageKey, { view, groupBy: g }); };

  const selectionActive =
    !!config.selectable &&
    (selection.count > 0 || (selection.isMarqueeActive && selection.previewCount > 0));

  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/* view toolbar */}
      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-line p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => choose(v.id)}
              className="fast mono rounded-[5px] px-3 py-1 text-label"
              style={{ background: view === v.id ? "var(--accent)" : "transparent", color: view === v.id ? "#fff" : "var(--muted)" }}
            >
              {v.label}
            </button>
          ))}
        </div>

        {view === "board" && (
          <div className="inline-flex items-center gap-1.5">
            <span className="mono text-meta text-muted">group</span>
            <div className="inline-flex rounded-md border border-line p-0.5">
              {(["status", "domain"] as GroupBy[]).map((g) => (
                <button
                  key={g}
                  onClick={() => chooseGroup(g)}
                  className="fast mono rounded-[5px] px-2 py-0.5 text-meta"
                  style={{ background: groupBy === g ? "var(--bg)" : "transparent", color: groupBy === g ? "var(--text)" : "var(--muted)" }}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1" />
        <div className="relative flex h-7 shrink-0 items-center justify-end">
          <span
            className={`mono text-meta leading-none text-muted ${selectionActive ? "invisible" : ""}`}
            aria-hidden={selectionActive}
          >
            {config.records.length} records
          </span>
          {selectionActive && (
            <div className="absolute inset-y-0 right-0 flex items-center">
              <SelectionBulkBar inline selection={selection} onBulkDelete={config.onBulkDelete} />
            </div>
          )}
        </div>
        {config.onNew && <Btn kind="primary" onClick={config.onNew}>{config.newLabel ?? "+ new"}</Btn>}
      </div>

      <MarqueeOverlay style={selection.marqueeStyle} />

      <div className="flex min-h-0 flex-1 flex-col">
        {view === "table" && <TableView config={config} selection={selection} />}
        {view === "board" && <BoardView config={config} groupBy={groupBy} selection={selection} />}
        {view === "calendar" && <CalendarView config={config} selection={selection} />}
        {view === "timeline" && <TimelineView config={config} selection={selection} />}
      </div>

      <div className="mt-2 min-h-[14px]">
        <SelectionHint enabled={!!config.selectable} count={selection.count} recordCount={config.records.length} previewCount={selection.previewCount} />
      </div>
    </div>
  );
}

// ── Table ────────────────────────────────────────────────────────────────────
type SortKey = "title" | "status" | "progress" | "targetDate";

function TableView({ config, selection }: { config: CollectionConfig; selection: CollectionSelection }) {
  const { records, statusOptions, statusColors, extraColumns = [], selectable } = config;
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "status", dir: 1 });

  const sorted = useMemo(() => {
    const rows = [...records];
    rows.sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      if (sort.key === "progress") { av = a.progress; bv = b.progress; }
      else if (sort.key === "status") { av = statusOptions.indexOf(a.status); bv = statusOptions.indexOf(b.status); }
      else if (sort.key === "targetDate") { av = a.targetDate ?? "9999"; bv = b.targetDate ?? "9999"; }
      else { av = a.title.toLowerCase(); bv = b.title.toLowerCase(); }
      return av < bv ? -sort.dir : av > bv ? sort.dir : 0;
    });
    return rows;
  }, [records, sort, statusOptions]);

  const checkCol = selectable ? "28px " : "";
  const cols = `${checkCol}minmax(200px,2.2fr) 124px minmax(120px,1.4fr) 150px ${extraColumns.map(() => "minmax(90px,1fr)").join(" ")} 110px 36px`;

  const Th = ({ k, children, className = "" }: { k?: SortKey; children: React.ReactNode; className?: string }) => (
    <button
      onClick={k ? () => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : 1 })) : undefined}
      disabled={!k}
      className={`section-label flex items-center gap-1 text-left ${k ? "hover:text-ink" : "cursor-default"} ${className}`}
    >
      {children}
      {k && sort.key === k && <span className="text-micro">{sort.dir === 1 ? "▲" : "▼"}</span>}
    </button>
  );

  return (
    <SelectionSurface
      selection={selection}
      className="overflow-hidden rounded-md border border-line bg-surface"
    >
      <div className="grid shrink-0 items-center gap-3 border-b border-line bg-bg px-3 py-2" style={{ gridTemplateColumns: cols }}>
        {selectable && (
          <SelectCheckbox checked={selection.allSelected} onToggle={selection.toggleAll} />
        )}
        <Th k="title">Name</Th>
        <Th k="status">Status</Th>
        <Th>Context</Th>
        <Th k="progress">Progress</Th>
        {extraColumns.map((c) => <Th key={c.key}>{c.label}</Th>)}
        <Th k="targetDate">Target</Th>
        <span />
      </div>

      {sorted.map((r) => {
        const visual = selectable ? itemSelectVisual(selection, r.id) : "none";
        return (
          <div
            key={r.id}
            data-select-id={r.id}
            ref={(el) => selection.registerRef(r.id, el)}
            onMouseDown={selection.itemPointerDown(r.id)}
            onDoubleClick={r.open}
            className={`group grid cursor-default items-center gap-3 border-b border-line px-3 py-2 last:border-0 ${
              selectable ? itemSelectRowClass(selection, r.id) : "hover:bg-accent-soft/60"
            }`}
            style={{ gridTemplateColumns: cols }}
          >
            {selectable && (
              <SelectCheckbox
                checked={visual === "selected"}
                preview={visual === "preview"}
                onToggle={() => selection.pick(r.id, { extend: true, range: false })}
              />
            )}
            <div className="min-w-0" data-no-select onMouseDown={(e) => e.stopPropagation()}>
              <InlineText value={r.title} onChange={r.setTitle} placeholder="Untitled" className="text-body font-medium" />
            </div>
            <div data-no-select onMouseDown={(e) => e.stopPropagation()}>
              <StatusPill value={r.status} options={statusOptions} colors={statusColors} labels={config.statusLabels} onChange={r.setStatus} />
            </div>
            <div className="mono flex items-center gap-1.5 truncate text-label text-muted">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.accent }} />
              <span className="truncate">{r.subtitle}</span>
            </div>
            <div>
              <Bar pct={r.progress} color={r.accent} h={1} />
              <span className="mono text-meta text-muted">{r.progress}%</span>
            </div>
            {extraColumns.map((c) => (
              <div key={c.key} className="mono truncate text-label" style={{ color: r.meta[c.key]?.color ?? "var(--muted)" }}>
                {r.meta[c.key]?.value ?? "—"}
              </div>
            ))}
            <div className="mono text-label text-muted" data-no-select onMouseDown={(e) => e.stopPropagation()}>
              <InlineDate value={r.targetDate} onChange={r.setTargetDate} />
            </div>
            <button
              data-no-select
              onMouseDown={(e) => e.stopPropagation()}
              onClick={r.open}
              title="Open"
              className="fast flex h-6 w-6 items-center justify-center rounded-full text-caption text-muted opacity-0 hover:bg-bg hover:text-ink group-hover:opacity-100"
            >
              ↗
            </button>
          </div>
        );
      })}
      {records.length === 0 && <div className="py-10 text-center text-caption text-muted italic">Nothing here yet.</div>}
      <div className="min-h-[12rem] flex-1" aria-hidden />
    </SelectionSurface>
  );
}

// ── Board (drag a card to a lane to set its status / domain) ─────────────────
function BoardView({
  config,
  groupBy,
  selection,
}: {
  config: CollectionConfig;
  groupBy: GroupBy;
  selection: CollectionSelection;
}) {
  const { records, statusOptions, statusColors, statusLabels, selectable } = config;
  // Pointer-based drag — HTML5 drag-and-drop is swallowed by the Tauri webview,
  // so we mirror the Timeline's pointer pattern (works in the desktop app AND
  // the browser). Live drag lives in a ref; mirrored to state for the ghost.
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const [overLane, setOverLane] = useState<string | null>(null);
  const laneRefs = useRef<Map<string, HTMLElement>>(new Map());

  const lanes = useMemo(() => {
    if (groupBy === "domain") {
      const seen = new Map<string, { key: string; label: string; color: string }>();
      records.forEach((r) => {
        if (!seen.has(r.domainId)) seen.set(r.domainId, { key: r.domainId, label: r.domainName, color: r.accent });
      });
      return [...seen.values()].map((g) => ({ ...g, items: records.filter((r) => r.domainId === g.key) }));
    }
    return statusOptions.map((s) => ({
      key: s,
      label: statusLabels?.[s] ?? s,
      color: statusColors[s] ?? "var(--muted)",
      items: records.filter((r) => r.status === s),
    }));
  }, [records, groupBy, statusOptions, statusColors, statusLabels]);

  const laneAtPoint = (x: number, y: number): string | null => {
    for (const [key, el] of laneRefs.current) {
      const b = el.getBoundingClientRect();
      if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return key;
    }
    return null;
  };

  // Start a drag from a card. Movement past a small threshold turns it into a
  // real drag; a stationary press falls through to click / double-click.
  const startCardDrag = (id: string, e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(SELECT_INTERACTIVE)) return;
    const startX = e.clientX;
    const startY = e.clientY;
    dragRef.current = { id, moved: false };

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved && (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4)) {
        d.moved = true;
        selection.cancelPointer();
      }
      if (!d.moved) return;
      ev.preventDefault();
      setDrag({ id: d.id, x: ev.clientX, y: ev.clientY });
      setOverLane(laneAtPoint(ev.clientX, ev.clientY));
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      setOverLane(null);
      if (!d || !d.moved) return; // a click, not a drag — let click/dblclick run
      const laneKey = laneAtPoint(ev.clientX, ev.clientY);
      if (!laneKey) return;
      const r = records.find((x) => x.id === d.id);
      if (!r) return;
      if (groupBy === "status" && r.status !== laneKey) r.setStatus(laneKey);
      if (groupBy === "domain" && r.domainId !== laneKey) r.setDomain?.(laneKey);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const dragging = drag?.id ?? null;

  return (
    <SelectionSurface selection={selection}>
      <div className="grid min-h-full flex-1 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {lanes.map((lane) => {
          const canDrop = groupBy === "status" || !!records.find((x) => x.id === dragging)?.setDomain;
          const over = overLane === lane.key && dragging && canDrop;
          const activeLane = groupBy === "status" && lane.key === "in_progress";
          return (
            <div
              key={lane.key}
              ref={(el) => { if (el) laneRefs.current.set(lane.key, el); else laneRefs.current.delete(lane.key); }}
              className="fast flex min-h-full flex-col rounded-md p-1"
              style={{
                background: over ? "var(--accent-soft)" : activeLane ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent",
                outline: over ? `1px dashed ${lane.color}` : activeLane ? "1px solid color-mix(in srgb, var(--accent) 25%, transparent)" : "none",
              }}
            >
              <div className="mb-2 flex items-center gap-2 px-1">
                <span className="h-2 w-2 rounded-full" style={{ background: lane.color, boxShadow: activeLane ? "0 0 6px var(--accent-glow)" : undefined }} />
                <span className="section-label" style={{ color: activeLane ? "var(--accent)" : "var(--text)" }}>{lane.label}</span>
                <span className="mono text-meta text-muted">{lane.items.length}</span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2.5">
                {lane.items.map((r) => (
                  <BoardCard
                    key={r.id}
                    r={r}
                    config={config}
                    selectable={!!selectable}
                    selection={selection}
                    dragging={dragging === r.id}
                    onStartDrag={(e) => startCardDrag(r.id, e)}
                  />
                ))}
                {lane.items.length === 0 ? (
                  <div className="flex flex-1 flex-col rounded-md border border-dashed border-line py-6 text-center text-label text-muted">
                    {over ? "drop here" : "empty"}
                  </div>
                ) : (
                  <div className="min-h-[4rem] flex-1" aria-hidden />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* floating ghost following the cursor during a drag */}
      {drag && (() => {
        const r = records.find((x) => x.id === drag.id);
        if (!r) return null;
        return (
          <div
            className="pointer-events-none fixed z-[300] flex max-w-[220px] items-center gap-1.5 rounded-md border bg-surface px-2.5 py-1.5 text-label shadow-lg"
            style={{ left: drag.x + 12, top: drag.y + 12, borderColor: r.accent }}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.accent }} />
            <span className="truncate text-ink">{r.title || "Untitled"}</span>
          </div>
        );
      })()}
    </SelectionSurface>
  );
}

function BoardCard({
  r,
  config,
  selectable,
  selection,
  dragging,
  onStartDrag,
}: {
  r: CollectionRecord;
  config: CollectionConfig;
  selectable: boolean;
  selection: CollectionSelection;
  dragging: boolean;
  onStartDrag: (e: ReactPointerEvent) => void;
}) {
  const metaEntries = (config.extraColumns ?? []).map((c) => r.meta[c.key]?.value).filter(Boolean);
  const visual = selectable ? itemSelectVisual(selection, r.id) : "none";
  const inProgress = r.status === "in_progress";
  return (
    <div
      data-select-id={r.id}
      ref={(el) => selection.registerRef(r.id, el)}
      onPointerDown={onStartDrag}
      onClick={(e) => {
        // Open card on click unless clicking an interactive element (checkbox, status pill, etc.)
        if (!(e.target as HTMLElement).closest(SELECT_INTERACTIVE)) {
          r.open();
        }
      }}
      onDoubleClick={r.open}
      className={`fast group relative cursor-pointer touch-none overflow-hidden rounded-md border bg-surface p-3 hover:border-muted active:cursor-grabbing ${itemSelectClass(selection, r.id)} ${
        inProgress ? "border-accent/50 shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_20%,transparent)]" : ""
      } ${visual === "selected" ? "border-accent/40" : visual === "preview" ? "border-accent/50 border-dashed" : inProgress ? "" : "border-line"}`}
      style={{
        opacity: dragging ? 0.4 : 1,
        background: inProgress ? "color-mix(in srgb, var(--accent) 6%, var(--surface))" : undefined,
      }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: inProgress ? "var(--accent)" : r.accent }} />
      <div className="flex items-start gap-2 pl-1.5">
        {selectable && (
          <SelectCheckbox
            checked={visual === "selected"}
            preview={visual === "preview"}
            onToggle={() => selection.pick(r.id, { extend: true, range: false })}
            className="mt-0.5"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-body font-medium">{r.title || "Untitled"}</div>
          <div className="mono mt-0.5 truncate text-meta" style={{ color: r.accent }}>{r.domainIcon} {r.subtitle}</div>
        </div>
        <div data-no-select onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <StatusPill
            value={r.status}
            options={config.statusOptions}
            colors={config.statusColors}
            labels={config.statusLabels}
            filled={inProgress ? new Set(["in_progress"]) : undefined}
            onChange={r.setStatus}
          />
        </div>
      </div>
      <div className="mt-2 pl-1.5">
        <Bar pct={r.progress} color={r.accent} h={1} />
        <div className="mono flex items-center gap-2 text-meta text-muted">
          <span style={{ color: r.accent }}>{r.progress}%</span>
          {metaEntries.map((m, i) => <span key={i}>· {m}</span>)}
          {r.targetDate && <span className="ml-auto">{r.targetDate.slice(5)}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Calendar (drag a record onto a day to set its target date) ───────────────
function CalendarChip({
  r,
  selectable,
  selection,
  dragging,
  onDragStart,
  onDragEnd,
  className,
  style,
}: {
  r: CollectionRecord;
  selectable: boolean;
  selection: CollectionSelection;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  className: string;
  style?: React.CSSProperties;
}) {
  const visual = selectable ? itemSelectVisual(selection, r.id) : "none";
  return (
    <div
      draggable
      data-drag-item
      data-select-id={r.id}
      ref={(el) => selection.registerRef(r.id, el)}
      onDragStart={(e) => {
        selection.cancelPointer();
        e.dataTransfer.effectAllowed = "move";
        e.stopPropagation();
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={selectable ? selection.itemClickSelect(r.id) : undefined}
      onDoubleClick={r.open}
      className={`${className} cursor-grab active:cursor-grabbing ${itemSelectClass(selection, r.id)} ${visual === "preview" ? "border-dashed" : ""}`}
      style={{ ...style, opacity: dragging ? 0.4 : 1 }}
      title={r.title ? `${r.title} — drag to reschedule` : "Drag to reschedule"}
    >
      {selectable && (
        <SelectCheckbox
          checked={visual === "selected"}
          preview={visual === "preview"}
          onToggle={() => selection.pick(r.id, { extend: true, range: false })}
          className="mr-1 inline-flex align-middle"
        />
      )}
      <span className="truncate">{r.title || "Untitled"}</span>
    </div>
  );
}

function CalendarView({ config, selection }: { config: CollectionConfig; selection: CollectionSelection }) {
  const { selectable } = config;
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const onDay = (day: Date) => config.records.filter((r) => r.targetDate && isSameDay(parseISO(r.targetDate), day));
  const unscheduled = config.records.filter((r) => !r.targetDate);

  const setTarget = (iso: string | null) => {
    const r = config.records.find((x) => x.id === dragId);
    setDragId(null);
    setOverKey(null);
    if (r) r.setTargetDate(iso);
  };

  return (
    <SelectionSurface selection={selection}>
      <div className="mb-3 flex shrink-0 items-center gap-3">
        <button onClick={() => setCursor((c) => addMonths(c, -1))} className="fast mono rounded border border-line px-2 py-0.5 text-caption text-muted hover:text-ink">‹</button>
        <span className="text-head font-medium">{format(cursor, "MMMM yyyy")}</span>
        <button onClick={() => setCursor((c) => addMonths(c, 1))} className="fast mono rounded border border-line px-2 py-0.5 text-caption text-muted hover:text-ink">›</button>
        <button onClick={() => setCursor(startOfMonth(new Date()))} className="fast mono text-label text-muted hover:text-ink">today</button>
        {dragId && <span className="mono text-meta text-muted">drag onto a day to reschedule</span>}
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <div className="grid grid-cols-7 border-b border-line bg-bg">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="mono px-2 py-1.5 text-micro uppercase text-muted">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            const items = onDay(day);
            const dim = !isSameMonth(day, cursor);
            const key = format(day, "yyyy-MM-dd");
            const over = overKey === key && dragId;
            return (
              <div
                key={i}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverKey(key); } }}
                onDragLeave={() => setOverKey((k) => (k === key ? null : k))}
                onDrop={(e) => { e.preventDefault(); setTarget(key); }}
                className="min-h-[96px] border-b border-r border-line p-1.5 last:border-r-0"
                style={{ opacity: dim ? 0.45 : 1, background: over ? "var(--accent-soft)" : "transparent", outline: over ? "1px dashed var(--accent)" : "none", outlineOffset: -1 }}
              >
                <div className="mono mb-1 flex items-center text-meta">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: isToday(day) ? "var(--signal)" : "transparent", color: isToday(day) ? "#fff" : "var(--muted)" }}>
                    {format(day, "d")}
                  </span>
                </div>
                <div className="space-y-1">
                  {items.slice(0, 3).map((r) => (
                    <CalendarChip
                      key={r.id}
                      r={r}
                      selectable={!!selectable}
                      selection={selection}
                      dragging={dragId === r.id}
                      onDragStart={() => setDragId(r.id)}
                      onDragEnd={() => { setDragId(null); setOverKey(null); }}
                      className="fast flex w-full items-center truncate rounded-sm px-1 py-0.5 text-left text-meta"
                      style={{ background: `${r.accent}1f`, color: "var(--text)", borderLeft: `2px solid ${r.accent}` }}
                    />
                  ))}
                  {items.length > 3 && <div className="mono px-1 text-micro text-muted">+{items.length - 3} more</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverKey("unscheduled"); } }}
        onDragLeave={() => setOverKey((k) => (k === "unscheduled" ? null : k))}
        onDrop={(e) => { e.preventDefault(); setTarget(null); }}
        className="fast mt-4 rounded-md p-2"
        style={{ outline: overKey === "unscheduled" && dragId ? "1px dashed var(--muted)" : "none", background: overKey === "unscheduled" && dragId ? "var(--bg)" : "transparent" }}
      >
        <div className="section-label mb-2">No target date ({unscheduled.length}){dragId ? " · drop here to clear" : ""}</div>
        <div className="flex flex-wrap gap-2">
          {unscheduled.map((r) => (
            <CalendarChip
              key={r.id}
              r={r}
              selectable={!!selectable}
              selection={selection}
              dragging={dragId === r.id}
              onDragStart={() => setDragId(r.id)}
              onDragEnd={() => { setDragId(null); setOverKey(null); }}
              className="fast flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-label hover:border-muted"
            />
          ))}
          {unscheduled.length === 0 && <span className="mono text-label text-muted italic">Everything has a date.</span>}
        </div>
      </div>
      <div className="min-h-[10rem] flex-1" aria-hidden />
    </SelectionSurface>
  );
}

// ── Timeline ─────────────────────────────────────────────────────────────────
function TimelineView({ config, selection }: { config: CollectionConfig; selection: CollectionSelection }) {
  const items: TimelineItem[] = config.records.map((r) => ({
    id: r.id,
    label: r.title || "Untitled",
    color: r.accent,
    start: r.startDate,
    end: r.targetDate,
    progress: r.progress,
    dim: r.status === "complete" || r.status === "done" || r.status === "cancelled",
    onClick: r.open,
    onChangeDates: (start, end) => {
      if (r.setDates) r.setDates(start, end);
      else { r.setStartDate(start); r.setTargetDate(end); }
    },
  }));
  return (
    <SelectionSurface selection={selection}>
      <Timeline
        items={items}
        selection={config.selectable ? selection : undefined}
        persistKey={config.storageKey}
      />
      <div className="min-h-[10rem] flex-1" aria-hidden />
    </SelectionSurface>
  );
}
