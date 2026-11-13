// The Table — the List layout (D-190). One set of records (projects or
// initiatives: a titled record with a status, a domain, a progress and a date
// range) as grouped, sortable, bulk-editable rows.
//
// No hero: the PageBar names the page. Under it, one filter row (Filter ·
// Display, the floor's standing, the create button), a 32px column header, and
// groups on --sunk holding 38px rows whose columns line up. The readiness pie
// leads every row; a selected row takes the accent wash; ⋯ comes up on hover
// and opens the same record menu as a right-click.

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { DomainPicker, InlineDate, InlineText, RipenessPip, StatusPill } from "./parts";
import type { Domain } from "../../lib/vertical";
import type { Ripeness } from "../../lib/tending";
import { useCollectionSelection, type CollectionSelection } from "../../hooks/useCollectionSelection";
import { MarqueeOverlay, SelectCheckbox, SelectionBulkBar, itemSelectVisual } from "./collectionSelection";
import { useRecordContextMenu } from "../RecordContextMenu";
import { pressable } from "../../lib/a11y";
import { SlidersHorizontal } from "lucide-react";
import { Icon } from "../Icon";
import { Button, Chip, Dot, EmptyState, IconButton, Menu, MenuItem, MenuLabel, MenuSeparator, PaceTrack } from "../kit";

export interface CollectionRecord {
  id: string;
  title: string;
  subtitle: string;
  domainId: string;
  domainName: string;
  domainIcon?: string;
  accent: string;
  status: string;
  /** computed grooming maturity — the readiness pie that leads the row. */
  ripeness?: Ripeness;
  /** Active but not Nuvo-verified sound — the pie reads ready-but-flagged. */
  unsound?: boolean;
  progress: number;
  /** The pieces behind `progress` — draws the Pace column as a track of them. */
  pieces?: { done: number; total: number };
  /** 0–1 through the record's span (lib/pace `spanElapsed`) — the pace tick. */
  elapsed?: number | null;
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
  /** The key that creates one from anywhere on the floor — shown as a keycap on
   *  the button, the one place it is discoverable (D-189 cut the hint sentence). */
  newKey?: string;
  /** persist the chosen grouping + order per collection */
  storageKey: string;
  /** Desktop-grade selection: click, ⌘/⇧-click, marquee, checkboxes, Delete */
  selectable?: boolean;
  onBulkDelete?: (ids: string[]) => void;
  domains?: Domain[];
  /** Enables the shared record menu on each row (open · ship · park · delete). */
  recordKind?: "project" | "initiative";
  /** The filter row's left slot, after Display — the domain filter. */
  filter?: ReactNode;
  /** The filter row's right slot, before the create button — the standing. */
  aside?: ReactNode;
}

type SortKey = "title" | "status" | "progress" | "targetDate";
type GroupKey = "domain" | "status" | "none";
type Sort = { key: SortKey; dir: 1 | -1 };

const SORT_LABEL: Record<SortKey, string> = { status: "Status", title: "Name", progress: "Pace", targetDate: "Target" };
const GROUP_LABEL: Record<GroupKey, string> = { domain: "Domain", status: "Status", none: "No grouping" };

function loadView(key: string): { group: GroupKey; sort: Sort } {
  const fallback = { group: "domain" as GroupKey, sort: { key: "status" as SortKey, dir: 1 as const } };
  try {
    const raw = JSON.parse(localStorage.getItem(`nuvo.collection.${key}`) ?? "null");
    if (!raw) return fallback;
    const group: GroupKey = raw.group === "status" || raw.group === "none" ? raw.group : "domain";
    const k: SortKey = ["title", "status", "progress", "targetDate"].includes(raw.sort?.key) ? raw.sort.key : "status";
    return { group, sort: { key: k, dir: raw.sort?.dir === -1 ? -1 : 1 } };
  } catch {
    return fallback;
  }
}

interface Group {
  key: string;
  label: string;
  color: string | null;
  rows: CollectionRecord[];
}

export default function Collection({ config }: { config: CollectionConfig }) {
  const { records, statusOptions, statusColors, statusLabels, domains, storageKey, recordKind } = config;
  const initial = useMemo(() => loadView(storageKey), [storageKey]);
  const [group, setGroup] = useState<GroupKey>(initial.group);
  const [sort, setSort] = useState<Sort>(initial.sort);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [displayOpen, setDisplayOpen] = useState(false);
  const displayRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(`nuvo.collection.${storageKey}`, JSON.stringify({ group, sort }));
    } catch {
      /* private mode — the view just doesn't persist */
    }
  }, [storageKey, group, sort]);

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

  const groups: Group[] = useMemo(() => {
    if (group === "none") return [{ key: "all", label: "", color: null, rows: sorted }];
    if (group === "status") {
      return statusOptions
        .map((s) => ({ key: s, label: statusLabels?.[s] ?? s, color: statusColors[s] ?? null, rows: sorted.filter((r) => r.status === s) }))
        .filter((g) => g.rows.length > 0);
    }
    const ordered = [...(domains ?? [])].sort((a, b) => a.sort - b.sort);
    const known = new Set(ordered.map((d) => d.id));
    const out: Group[] = ordered
      .map((d) => ({ key: d.id, label: d.name, color: d.color, rows: sorted.filter((r) => r.domainId === d.id) }))
      .filter((g) => g.rows.length > 0);
    const loose = sorted.filter((r) => !known.has(r.domainId));
    if (loose.length) out.push({ key: "none", label: "No domain", color: null, rows: loose });
    return out;
  }, [group, sorted, statusOptions, statusLabels, statusColors, domains]);

  // Selection walks the rows in the order you see them, so ⇧-click ranges what
  // is on screen — not the order the records happened to arrive in.
  const orderedIds = useMemo(
    () => groups.flatMap((g) => (collapsed.has(g.key) ? [] : g.rows.map((r) => r.id))),
    [groups, collapsed],
  );
  const selection = useCollectionSelection(orderedIds, !!config.selectable, config.onBulkDelete);
  const selectionActive =
    !!config.selectable && (selection.count > 0 || (selection.isMarqueeActive && selection.previewCount > 0));

  const extras = config.extraColumns ?? [];
  const check = config.selectable ? "20px " : "";
  const cols = `${check}minmax(200px,1fr) 136px 112px ${extras.map(() => "84px").join(" ")} 84px 112px 28px`;
  const narrow = `${check}minmax(200px,1fr) 136px 112px 84px 112px 28px`;
  const phone = `${check}minmax(0,1fr) 28px`;

  const toggleSort = (k: SortKey) => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : 1 }));
  const noun = recordKind === "initiative" ? "initiatives" : recordKind === "project" ? "projects" : "records";

  return (
    <div className="fl-list" style={{ ["--fl-cols" as string]: cols, ["--fl-cols-narrow" as string]: narrow, ["--fl-cols-phone" as string]: phone }}>
      <div className="fl-list-head">
        <div className="fl-filter">
          {config.filter}
          <Button
            ref={displayRef}
            kind="ghost"
            size="sm"
            icon={<SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden />}
            aria-haspopup="menu"
            aria-expanded={displayOpen}
            onClick={() => setDisplayOpen((o) => !o)}
          >
            Display
          </Button>
          <Menu anchor={displayRef.current} open={displayOpen} onClose={() => setDisplayOpen(false)} label="Display">
            <MenuLabel>Group by</MenuLabel>
            {(Object.keys(GROUP_LABEL) as GroupKey[]).map((g) => (
              <MenuItem key={g} checked={group === g} onSelect={() => setGroup(g)}>
                {GROUP_LABEL[g]}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuLabel>Order by</MenuLabel>
            {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
              <MenuItem key={k} checked={sort.key === k} hint={sort.key === k ? (sort.dir === 1 ? "↑" : "↓") : undefined} keepOpen onSelect={() => toggleSort(k)}>
                {SORT_LABEL[k]}
              </MenuItem>
            ))}
          </Menu>
          <span className="fl-filter-gap" />
          {selectionActive ? (
            <SelectionBulkBar inline selection={selection} onBulkDelete={config.onBulkDelete} />
          ) : (
            config.aside
          )}
          {config.onNew && (
            <Button
              kind="primary"
              size="sm"
              icon={<Icon name="plus" size={14} />}
              shortcut={config.newKey}
              onClick={config.onNew}
              title={config.newKey ? `Create (${config.newKey})` : undefined}
            >
              {config.newLabel ?? "New"}
            </Button>
          )}
        </div>
        <TableHead config={config} selection={selection} sort={sort} onSort={toggleSort} />
      </div>

      <MarqueeOverlay style={selection.marqueeStyle} />

      <TableBody
        config={config}
        selection={selection}
        groups={groups}
        grouped={group !== "none"}
        collapsed={collapsed}
        onToggleGroup={(k) =>
          setCollapsed((s) => {
            const n = new Set(s);
            n.has(k) ? n.delete(k) : n.add(k);
            return n;
          })
        }
        empty={<EmptyState>{`No ${noun}`}</EmptyState>}
      />
    </div>
  );
}

function TableHead({
  config,
  selection,
  sort,
  onSort,
}: {
  config: CollectionConfig;
  selection: CollectionSelection;
  sort: Sort;
  onSort: (k: SortKey) => void;
}) {
  const Th = ({ k, col, children }: { k?: SortKey; col: string; children?: ReactNode }) =>
    k ? (
      <button type="button" className="fl-th-cell" data-col={col} data-sorted={sort.key === k || undefined} onClick={() => onSort(k)}>
        {children}
        {sort.key === k && <Icon name="chevron-down" size={12} style={{ transform: sort.dir === 1 ? "rotate(180deg)" : undefined }} />}
      </button>
    ) : (
      <span className="fl-th-cell" data-col={col}>
        {children}
      </span>
    );
  return (
    <div className="fl-th" role="row">
      {config.selectable && (
        <span data-col="keep" className="flex">
          <SelectCheckbox checked={selection.allSelected} onToggle={selection.toggleAll} />
        </span>
      )}
      <Th k="title" col="keep">Name</Th>
      <Th col="std">Domain</Th>
      <Th k="status" col="std">Status</Th>
      {(config.extraColumns ?? []).map((c) => (
        <Th key={c.key} col="wide">{c.label}</Th>
      ))}
      <Th k="targetDate" col="std">Target</Th>
      <Th k="progress" col="std">Pace</Th>
      <span data-col="keep" />
    </div>
  );
}

function TableBody({
  config,
  selection,
  groups,
  grouped,
  collapsed,
  onToggleGroup,
  empty,
}: {
  config: CollectionConfig;
  selection: CollectionSelection;
  groups: Group[];
  grouped: boolean;
  collapsed: Set<string>;
  onToggleGroup: (key: string) => void;
  empty: ReactNode;
}) {
  const { onContextMenu, menu } = useRecordContextMenu();

  return (
    <div
      {...selection.surfaceProps}
      className={`relative flex flex-1 flex-col ${selection.surfaceProps.className}`}
    >
      {menu}
      {groups.map((g) => (
        <div key={g.key} role="rowgroup">
          {grouped && (
            <button type="button" className="fl-grp" aria-expanded={!collapsed.has(g.key)} onClick={() => onToggleGroup(g.key)}>
              <Icon name="chevron-down" size={12} className="fl-chev" />
              {g.color ? <Dot color={g.color} /> : <Dot color="var(--faint)" shape="round" />}
              <span>{g.label}</span>
              <span className="k-count">{g.rows.length}</span>
            </button>
          )}
          {!collapsed.has(g.key) &&
            g.rows.map((r) => (
              <TableRow key={r.id} r={r} config={config} selection={selection} onContextMenu={onContextMenu} />
            ))}
        </div>
      ))}
      {config.records.length === 0 && empty}
      <div className="fl-list-foot" aria-hidden />
    </div>
  );
}

function TableRow({
  r,
  config,
  selection,
  onContextMenu,
}: {
  r: CollectionRecord;
  config: CollectionConfig;
  selection: CollectionSelection;
  onContextMenu: ReturnType<typeof useRecordContextMenu>["onContextMenu"];
}) {
  const { statusOptions, statusColors, selectable, recordKind } = config;
  const visual = selectable ? itemSelectVisual(selection, r.id) : "none";
  const stop = (e: ReactMouseEvent) => e.stopPropagation();

  // ⋯ opens the same record menu a right-click does, hung under the button.
  const openMore = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (!recordKind) return r.open();
    const b = e.currentTarget.getBoundingClientRect();
    onContextMenu(recordKind, r.id)({
      preventDefault() {},
      stopPropagation() {},
      clientX: b.left,
      clientY: b.bottom + 4,
    } as unknown as ReactMouseEvent);
  };

  return (
    <div
      data-select-id={r.id}
      ref={(el) => selection.registerRef(r.id, el)}
      // The row opens the record on click — and on Enter/Space, which
      // `pressable` ignores when the keystroke came from a control *inside* the
      // row (the inline name, the status chip), the same carve-out the click
      // handler makes below.
      {...pressable(() => r.open(), { label: r.title })}
      data-selected={visual === "selected" || undefined}
      data-preview={visual === "preview" || undefined}
      onContextMenu={recordKind ? onContextMenu(recordKind, r.id) : undefined}
      onMouseDown={(e) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey) selection.itemPointerDown(r.id)(e);
      }}
      onClick={(e) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey) return;
        // the whole row opens the record — except the parts that edit inline
        // (name · status · domain · date · checkbox · ⋯).
        if ((e.target as HTMLElement).closest("[data-no-select], button, input, textarea, select, a")) return;
        r.open();
      }}
      className="fl-tr"
    >
      {selectable && (
        <span data-col="keep" className="flex">
          <SelectCheckbox
            checked={visual === "selected"}
            preview={visual === "preview"}
            onToggle={() => selection.pick(r.id, { extend: true, range: false })}
          />
        </span>
      )}
      <div className="fl-name" data-col="keep" data-no-select onMouseDown={stop}>
        {r.ripeness ? <RipenessPip stage={r.ripeness} unsound={r.unsound} /> : <RipenessPip stage="raw" />}
        <InlineText value={r.title} onChange={r.setTitle} placeholder="Untitled" />
      </div>
      <div data-col="std" className="min-w-0" data-no-select onMouseDown={stop}>
        {r.setDomain && config.domains ? (
          <DomainPicker domains={config.domains} value={r.domainId} onChange={r.setDomain} />
        ) : (
          <Chip dot={r.accent}>{r.subtitle}</Chip>
        )}
      </div>
      <div data-col="std" className="min-w-0" data-no-select onMouseDown={stop}>
        <StatusPill value={r.status} options={statusOptions} colors={statusColors} labels={config.statusLabels} onChange={r.setStatus} />
      </div>
      {(config.extraColumns ?? []).map((c) => (
        <div key={c.key} data-col="wide" className="fl-cell">
          {r.meta[c.key]?.value ?? "—"}
        </div>
      ))}
      <div data-col="std" className="fl-cell" data-no-select onMouseDown={stop}>
        <InlineDate value={r.targetDate} onChange={r.setTargetDate} placeholder="—" />
      </div>
      <div data-col="std" className="flex min-w-0 items-center">
        {r.pieces && r.pieces.total > 0 ? (
          <PaceTrack done={r.pieces.done} total={r.pieces.total} color={r.accent} elapsed={r.elapsed ?? null} width={96} />
        ) : r.progress > 0 ? (
          <PaceTrack done={r.progress} total={100} color={r.accent} elapsed={r.elapsed ?? null} width={96} />
        ) : (
          <span className="fl-cell">—</span>
        )}
      </div>
      <div data-col="keep" className="fl-cell-end">
        <IconButton
          className="fl-more"
          size="xs"
          label="More"
          icon={<Icon name="more" size={14} />}
          data-no-select
          onMouseDown={stop}
          onClick={openMore}
        />
      </div>
    </div>
  );
}
