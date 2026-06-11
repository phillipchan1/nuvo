// A Notion-style collection: one set of records, many views. Projects and
// initiatives are the same shape of thing (a titled record with a status,
// a parent, a progress, and a date range), so they share this component —
// switch between Table · Board · Calendar · Timeline over the same data.

import { useMemo, useState, type DragEvent as ReactDragEvent } from "react";
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

export default function Collection({ config }: { config: CollectionConfig }) {
  const init = loadPref(config.storageKey, { view: "table", groupBy: "status" });
  const [view, setView] = useState<View>(init.view);
  const [groupBy, setGroupBy] = useState<GroupBy>(init.groupBy);

  const choose = (v: View) => { setView(v); savePref(config.storageKey, { view: v, groupBy }); };
  const chooseGroup = (g: GroupBy) => { setGroupBy(g); savePref(config.storageKey, { view, groupBy: g }); };

  return (
    <div>
      {/* view toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-line p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => choose(v.id)}
              className="fast mono rounded-[5px] px-3 py-1 text-[11px]"
              style={{ background: view === v.id ? "var(--accent)" : "transparent", color: view === v.id ? "#fff" : "var(--muted)" }}
            >
              {v.label}
            </button>
          ))}
        </div>

        {view === "board" && (
          <div className="inline-flex items-center gap-1.5">
            <span className="mono text-[10px] text-muted">group</span>
            <div className="inline-flex rounded-md border border-line p-0.5">
              {(["status", "domain"] as GroupBy[]).map((g) => (
                <button
                  key={g}
                  onClick={() => chooseGroup(g)}
                  className="fast mono rounded-[5px] px-2 py-0.5 text-[10px]"
                  style={{ background: groupBy === g ? "var(--bg)" : "transparent", color: groupBy === g ? "var(--text)" : "var(--muted)" }}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1" />
        <span className="mono text-[10px] text-muted">{config.records.length} records</span>
        {config.onNew && <Btn kind="primary" onClick={config.onNew}>{config.newLabel ?? "+ new"}</Btn>}
      </div>

      {view === "table" && <TableView config={config} />}
      {view === "board" && <BoardView config={config} groupBy={groupBy} />}
      {view === "calendar" && <CalendarView config={config} />}
      {view === "timeline" && <TimelineView config={config} />}
    </div>
  );
}

// ── Table ────────────────────────────────────────────────────────────────────
type SortKey = "title" | "status" | "progress" | "targetDate";

function TableView({ config }: { config: CollectionConfig }) {
  const { records, statusOptions, statusColors, extraColumns = [] } = config;
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

  const cols = `minmax(200px,2.2fr) 124px minmax(120px,1.4fr) 150px ${extraColumns.map(() => "minmax(90px,1fr)").join(" ")} 110px 36px`;
  const Th = ({ k, children, className = "" }: { k?: SortKey; children: React.ReactNode; className?: string }) => (
    <button
      onClick={k ? () => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : 1 })) : undefined}
      disabled={!k}
      className={`section-label flex items-center gap-1 text-left ${k ? "hover:text-ink" : "cursor-default"} ${className}`}
    >
      {children}
      {k && sort.key === k && <span className="text-[8px]">{sort.dir === 1 ? "▲" : "▼"}</span>}
    </button>
  );

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <div className="grid items-center gap-3 border-b border-line bg-bg px-3 py-2" style={{ gridTemplateColumns: cols }}>
        <Th k="title">Name</Th>
        <Th k="status">Status</Th>
        <Th>Context</Th>
        <Th k="progress">Progress</Th>
        {extraColumns.map((c) => <Th key={c.key}>{c.label}</Th>)}
        <Th k="targetDate">Target</Th>
        <span />
      </div>
      {sorted.map((r) => (
        <div key={r.id} className="group grid items-center gap-3 border-b border-line px-3 py-2 last:border-0 hover:bg-accent-soft" style={{ gridTemplateColumns: cols }}>
          <div className="min-w-0">
            <InlineText value={r.title} onChange={r.setTitle} placeholder="Untitled" className="text-[13px] font-medium" />
          </div>
          <div><StatusPill value={r.status} options={statusOptions} colors={statusColors} onChange={r.setStatus} /></div>
          <div className="mono flex items-center gap-1.5 truncate text-[11px] text-muted">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.accent }} />
            <span className="truncate">{r.subtitle}</span>
          </div>
          <div>
            <Bar pct={r.progress} color={r.accent} h={1} />
            <span className="mono text-[10px] text-muted">{r.progress}%</span>
          </div>
          {extraColumns.map((c) => (
            <div key={c.key} className="mono truncate text-[11px]" style={{ color: r.meta[c.key]?.color ?? "var(--muted)" }}>
              {r.meta[c.key]?.value ?? "—"}
            </div>
          ))}
          <div className="mono text-[11px] text-muted"><InlineDate value={r.targetDate} onChange={r.setTargetDate} /></div>
          <button onClick={r.open} title="Open" className="fast flex h-6 w-6 items-center justify-center rounded-full text-[12px] text-muted opacity-0 hover:bg-bg hover:text-ink group-hover:opacity-100">↗</button>
        </div>
      ))}
      {records.length === 0 && <div className="py-10 text-center text-[12px] text-muted italic">Nothing here yet.</div>}
    </div>
  );
}

// ── Board (drag a card to a lane to set its status / domain) ─────────────────
function BoardView({ config, groupBy }: { config: CollectionConfig; groupBy: GroupBy }) {
  const { records, statusOptions, statusColors, statusLabels } = config;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overLane, setOverLane] = useState<string | null>(null);

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

  const dropOn = (laneKey: string) => {
    const r = records.find((x) => x.id === dragId);
    setDragId(null);
    setOverLane(null);
    if (!r) return;
    if (groupBy === "status" && r.status !== laneKey) r.setStatus(laneKey);
    if (groupBy === "domain" && r.domainId !== laneKey) r.setDomain?.(laneKey);
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {lanes.map((lane) => {
        const canDrop = groupBy === "status" || !!records.find((x) => x.id === dragId)?.setDomain;
        const over = overLane === lane.key && dragId && canDrop;
        return (
          <div
            key={lane.key}
            onDragOver={(e) => { if (dragId && canDrop) { e.preventDefault(); setOverLane(lane.key); } }}
            onDragLeave={() => setOverLane((l) => (l === lane.key ? null : l))}
            onDrop={(e) => { e.preventDefault(); dropOn(lane.key); }}
            className="fast flex flex-col rounded-md p-1"
            style={{ background: over ? "var(--accent-soft)" : "transparent", outline: over ? `1px dashed ${lane.color}` : "none" }}
          >
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className="h-2 w-2 rounded-full" style={{ background: lane.color }} />
              <span className="section-label" style={{ color: "var(--text)" }}>{lane.label}</span>
              <span className="mono text-[10px] text-muted">{lane.items.length}</span>
            </div>
            <div className="flex flex-col gap-2.5">
              {lane.items.map((r) => (
                <BoardCard
                  key={r.id}
                  r={r}
                  config={config}
                  dragging={dragId === r.id}
                  onDragStart={() => setDragId(r.id)}
                  onDragEnd={() => { setDragId(null); setOverLane(null); }}
                />
              ))}
              {lane.items.length === 0 && <div className="rounded-md border border-dashed border-line py-6 text-center text-[11px] text-muted">{over ? "drop here" : "empty"}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BoardCard({
  r,
  config,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  r: CollectionRecord;
  config: CollectionConfig;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const metaEntries = (config.extraColumns ?? []).map((c) => r.meta[c.key]?.value).filter(Boolean);
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", r.id); onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={r.open}
      className="fast group relative cursor-grab overflow-hidden rounded-md border border-line bg-surface p-3 hover:border-muted active:cursor-grabbing"
      style={{ opacity: dragging ? 0.4 : 1 }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: r.accent }} />
      <div className="flex items-start gap-2 pl-1.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{r.title || "Untitled"}</div>
          <div className="mono mt-0.5 truncate text-[10px]" style={{ color: r.accent }}>{r.domainIcon} {r.subtitle}</div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <StatusPill value={r.status} options={config.statusOptions} colors={config.statusColors} onChange={r.setStatus} />
        </div>
      </div>
      <div className="mt-2 pl-1.5">
        <Bar pct={r.progress} color={r.accent} h={1} />
        <div className="mono flex items-center gap-2 text-[10px] text-muted">
          <span style={{ color: r.accent }}>{r.progress}%</span>
          {metaEntries.map((m, i) => <span key={i}>· {m}</span>)}
          {r.targetDate && <span className="ml-auto">{r.targetDate.slice(5)}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Calendar (drag a record onto a day to set its target date) ───────────────
function CalendarView({ config }: { config: CollectionConfig }) {
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

  const chipProps = (r: CollectionRecord) => ({
    draggable: true,
    onDragStart: (e: ReactDragEvent) => { e.dataTransfer.effectAllowed = "move"; setDragId(r.id); },
    onDragEnd: () => { setDragId(null); setOverKey(null); },
  });

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <button onClick={() => setCursor((c) => addMonths(c, -1))} className="fast mono rounded border border-line px-2 py-0.5 text-[12px] text-muted hover:text-ink">‹</button>
        <span className="text-[14px] font-medium">{format(cursor, "MMMM yyyy")}</span>
        <button onClick={() => setCursor((c) => addMonths(c, 1))} className="fast mono rounded border border-line px-2 py-0.5 text-[12px] text-muted hover:text-ink">›</button>
        <button onClick={() => setCursor(startOfMonth(new Date()))} className="fast mono text-[11px] text-muted hover:text-ink">today</button>
        {dragId && <span className="mono text-[10px] text-muted">drop on a day to reschedule</span>}
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <div className="grid grid-cols-7 border-b border-line bg-bg">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="mono px-2 py-1.5 text-[9px] uppercase text-muted">{d}</div>
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
                <div className="mono mb-1 flex items-center text-[10px]">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: isToday(day) ? "var(--signal)" : "transparent", color: isToday(day) ? "#fff" : "var(--muted)" }}>
                    {format(day, "d")}
                  </span>
                </div>
                <div className="space-y-1">
                  {items.slice(0, 3).map((r) => (
                    <div
                      key={r.id}
                      {...chipProps(r)}
                      onClick={r.open}
                      className="fast block w-full cursor-grab truncate rounded-sm px-1 py-0.5 text-left text-[10px] active:cursor-grabbing"
                      style={{ background: `${r.accent}1f`, color: "var(--text)", borderLeft: `2px solid ${r.accent}`, opacity: dragId === r.id ? 0.4 : 1 }}
                      title={r.title}
                    >
                      {r.title || "Untitled"}
                    </div>
                  ))}
                  {items.length > 3 && <div className="mono px-1 text-[9px] text-muted">+{items.length - 3} more</div>}
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
            <div
              key={r.id}
              {...chipProps(r)}
              onClick={r.open}
              className="fast flex cursor-grab items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] hover:border-muted active:cursor-grabbing"
              style={{ opacity: dragId === r.id ? 0.4 : 1 }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: r.accent }} />
              {r.title || "Untitled"}
            </div>
          ))}
          {unscheduled.length === 0 && <span className="mono text-[11px] text-muted italic">Everything has a date.</span>}
        </div>
      </div>
    </div>
  );
}

// ── Timeline ─────────────────────────────────────────────────────────────────
function TimelineView({ config }: { config: CollectionConfig }) {
  const items: TimelineItem[] = config.records.map((r) => ({
    id: r.id,
    label: r.title || "Untitled",
    color: r.accent,
    start: r.startDate,
    end: r.targetDate,
    progress: r.progress,
    dim: r.status === "done" || r.status === "shipped" || r.status === "dropped",
    onClick: r.open,
    onChangeDates: (start, end) => { r.setStartDate(start); r.setTargetDate(end); },
  }));
  const undated = config.records.filter((r) => !r.startDate && !r.targetDate).length;
  return (
    <div>
      <Timeline items={items} />
      {undated > 0 && <div className="mono mt-2 text-[10px] text-muted">{undated} record{undated === 1 ? "" : "s"} hidden — no dates set.</div>}
    </div>
  );
}
