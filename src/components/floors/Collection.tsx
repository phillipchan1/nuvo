// A Notion-style collection: one set of records shown as a filterable, sortable,
// bulk-editable Table. Projects and initiatives are the same shape of thing (a
// titled record with a status, a parent, a progress, and a date range), so they
// share this component. (Board · Calendar · Timeline were retired — On Deck is
// the canonical visual/time surface now.)

import { useMemo, useState, type ReactNode } from "react";
import { Bar, DomainPicker, InlineDate, InlineText, RefinedTick, RipenessPip, StatusPill } from "./parts";
import type { Domain } from "../../lib/vertical";
import type { Ripeness } from "../../lib/tending";
import { Btn } from "../ui";
import { useCollectionSelection, type CollectionSelection } from "../../hooks/useCollectionSelection";
import {
  MarqueeOverlay,
  SelectCheckbox,
  SelectionBulkBar,
  SelectionHint,
  itemSelectRowClass,
  itemSelectVisual,
} from "./collectionSelection";
import { useRecordContextMenu } from "../RecordContextMenu";
import { pressable } from "../../lib/a11y";

export interface CollectionRecord {
  id: string;
  title: string;
  subtitle: string;
  domainId: string;
  domainName: string;
  domainIcon?: string;
  accent: string;
  status: string;
  /** computed grooming maturity — renders the ambient ripeness pip. */
  ripeness?: Ripeness;
  /** Active but not Nuvo-verified sound — the pip reads green-but-flagged. */
  unsound?: boolean;
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
  domains?: Domain[];
  /** Enables the shared right-click menu on each row (open · complete · park · delete). */
  recordKind?: "project" | "initiative";
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
  const orderedIds = useMemo(() => config.records.map((r) => r.id), [config.records]);
  const selection = useCollectionSelection(orderedIds, !!config.selectable, config.onBulkDelete);

  const selectionActive =
    !!config.selectable &&
    (selection.count > 0 || (selection.isMarqueeActive && selection.previewCount > 0));

  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/* toolbar — record count / bulk actions on the right, create at the end */}
      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2">
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
        <TableView config={config} selection={selection} />
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
  const { records, statusOptions, statusColors, extraColumns = [], selectable, recordKind } = config;
  const { onContextMenu, menu } = useRecordContextMenu();
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
      className=""
    >
      {menu}
      <div className="grid shrink-0 items-center gap-3 border-b border-line py-2.5 pl-4 pr-2" style={{ gridTemplateColumns: cols }}>
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
            // The table row opens the record on click; without this it did so
            // for the mouse only. Enter/Space now does the same, and `pressable`
            // ignores the keystroke when it came from a control *inside* the row
            // (the inline name field, the status select) — the same carve-out the
            // click handler makes below, for the same reason.
            {...pressable(() => r.open(), { label: r.title })}
            onContextMenu={recordKind ? onContextMenu(recordKind, r.id) : undefined}
            onMouseDown={(e) => { if (e.shiftKey || e.metaKey || e.ctrlKey) selection.itemPointerDown(r.id)(e); }}
            onClick={(e) => {
              if (e.shiftKey || e.metaKey || e.ctrlKey) return;
              // the whole row opens the record — except the parts that edit inline
              // (name · status · domain · date · checkbox · the open arrow).
              if ((e.target as HTMLElement).closest("[data-no-select], button, input, textarea, select, a")) return;
              r.open();
            }}
            className={`lift-anim group relative grid cursor-pointer items-center gap-3 border-b border-line py-2.5 pl-4 pr-2 last:border-0 ${
              selectable ? itemSelectRowClass(selection, r.id) : "hover:bg-accent-soft/60"
            }`}
            style={{ gridTemplateColumns: cols }}
          >
            {/* domain rail — the same identity cue as the On Deck / Groom cards */}
            <span className="pointer-events-none absolute inset-y-1.5 left-0 w-[3px] rounded-full" style={{ background: r.accent }} aria-hidden />
            {selectable && (
              <SelectCheckbox
                checked={visual === "selected"}
                preview={visual === "preview"}
                onToggle={() => selection.pick(r.id, { extend: true, range: false })}
              />
            )}
            <div className="flex min-w-0 items-center gap-2" data-no-select onMouseDown={(e) => e.stopPropagation()}>
              {r.ripeness && <RipenessPip stage={r.ripeness} unsound={r.unsound} />}
              <InlineText value={r.title} onChange={r.setTitle} placeholder="Untitled" className="text-body font-semibold" />
              {r.ripeness === "active" && !r.unsound && <RefinedTick />}
            </div>
            <div data-no-select onMouseDown={(e) => e.stopPropagation()}>
              <StatusPill value={r.status} options={statusOptions} colors={statusColors} labels={config.statusLabels} onChange={r.setStatus} />
            </div>
            <div className="flex min-w-0 items-center gap-1.5" data-no-select onMouseDown={(e) => e.stopPropagation()}>
              {r.setDomain && config.domains ? (
                <DomainPicker domains={config.domains} value={r.domainId} onChange={r.setDomain} />
              ) : (
                <div className="mono flex items-center gap-1.5 truncate text-label text-muted">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.accent }} />
                  <span className="truncate">{r.subtitle}</span>
                </div>
              )}
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
