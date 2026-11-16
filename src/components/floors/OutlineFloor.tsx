// Projects / Initiatives → Table — the outline (D-220). One List layout at
// either Build altitude: a group (when it next needs you) ▸ an initiative ▸ a
// project ▸ its tasks, the grooming pass and the filing cabinet in one place.
//
// What is shown is decided in `lib/outline` (views, grouping, filters, search);
// this file only draws it and wires the keys. The tasks under a project are the
// app's one task list — `TaskListView`: the real row, the shared keys, the one
// add box (D-146). The headings above them speak the same keymap
// (`useTaskListKeys` is generic over rows), plus the outline's own three:
//
//   →  open a heading (or step into it)     ←  close it, or go up to its parent
//   ↓  from an open project, into its tasks; off its add box, on to the next
//
// so the keys walk one continuous outline while each list keeps its own rows.
// ⌫ deletes: a task at once, with undo (the list's own); a project or an
// initiative asks once, from the same menu a right-click opens.
//
// Both shells: the phone has no keys — a tap opens a heading, the record opens
// from its ⋯, and the task rows are the phone's own (swipe, tap for the sheet).

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ListFilter, SlidersHorizontal } from "lucide-react";
import { useVertical } from "../../hooks/useVertical";
import { useAllTasks } from "../../hooks/useTasks";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useRecordContextMenu } from "../RecordContextMenu";
import { ProjectShipAssess } from "../record/ShipAssess";
import TaskListView from "../tasks/TaskListView";
import { useTaskListKeys } from "../tasks/useTaskListKeys";
import { Icon } from "../Icon";
import { Button, Dot, EmptyState, IconButton, Kbd, Menu, MenuItem, MenuLabel, MenuSeparator, PaceTrack, SearchField, Segmented } from "../kit";
import { DomainPicker, InlineDate, InlineText, PROJECT_STATUS, PROJECT_STATUS_COLORS, PROJECT_STATUS_LABEL, RipenessPip, StatusPill } from "./parts";
import FloorStanding from "./FloorStanding";
import {
  OUTLINE_FIELDS,
  OUTLINE_PRESETS,
  readOutline,
  type InitiativeItem,
  type OutlineAltitude,
  type OutlineFieldKey,
  type OutlineFilter,
  type OutlineGroup,
  type OutlineGrouping,
  type OutlineView,
  type ProjectItem,
} from "../../lib/outline";
import { domainById, type Domain } from "../../lib/vertical";
import { ripenessOfInitiative, ripenessOfProject, verdictOf } from "../../lib/tending";
import { spanElapsed } from "../../lib/pace";
import { todayISO } from "../../lib/dates";
import { pressable } from "../../lib/a11y";

/** A heading row — what the outline's own keys walk. */
type Head = {
  id: string;
  kind: "group" | "initiative" | "project";
  parent: string | null;
  group?: OutlineGroup;
  initiative?: InitiativeItem;
  project?: ProjectItem;
  depth: number;
  open: boolean;
};

const VIEWS: { value: OutlineView; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "completed", label: "Completed" },
  { value: "everything", label: "Everything" },
];

const COLS = "minmax(0, 1fr) 150px 120px 84px 56px 112px 28px";
const COLS_NARROW = "minmax(0, 1fr) 150px 120px 84px 28px";
const COLS_PHONE = "minmax(0, 1fr) auto";

// A few uses and the hints go — they teach the keys, they are not furniture.
const HINT_KEY = "nuvo.table.hints";
const HINT_UNTIL = 12;
const readNum = (k: string) => {
  try {
    return Number(localStorage.getItem(k) ?? 0) || 0;
  } catch {
    return 0;
  }
};
function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* private window — the choice lasts the session */
      }
    },
    [key],
  );
  return [v, set];
}

const minsLabel = (m: number) => (!m ? "" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (iso: string | null) => {
  if (!iso) return "—";
  const [, m, d] = iso.split("-").map(Number);
  return `${MON[m - 1]} ${d}`;
};

export default function OutlineFloor({
  altitude,
  onOpenRecord,
  flush = false,
  recordActs,
}: {
  altitude: OutlineAltitude;
  /** The phone's record acts: a hold on a heading, and its ⋯ — the sheet with
   *  Open · Ship · Park · Delete (`MobileRecordActions`). */
  recordActs?: {
    hold: (kind: "project" | "initiative", id: string) => object;
    open: (kind: "project" | "initiative", id: string) => void;
  };
  /** The phone opens a record in its own sheet; the desktop in the Record modal. */
  onOpenRecord?: (kind: "project" | "initiative", id: string) => void;
  /** The phone's scroller has no floor padding to step back out of. */
  flush?: boolean;
}) {
  const { data, updateProject, updateInitiative } = useVertical();
  const { data: allTasks } = useAllTasks();
  const nav = useAppNavigation();
  const phone = useIsMobile();
  const { onContextMenu, askDelete, menu: recordMenu, open: recordMenuOpen } = useRecordContextMenu();
  const [shipId, setShipId] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);
  const today = todayISO(now);

  const k = `nuvo.table.${altitude}`;
  const [view, setView] = usePersisted<OutlineView>(`${k}.view`, "upcoming");
  const [grouping, setGrouping] = usePersisted<OutlineGrouping>(`${k}.group`, "when");
  const [filters, setFilters] = usePersisted<OutlineFilter[]>(`${k}.filters`, []);
  const [expandedList, setExpandedList] = usePersisted<string[]>(`${k}.open`, []);
  const expanded = useMemo(() => new Set(expandedList), [expandedList]);
  const [search, setSearch] = useState("");
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [hints, setHints] = useState(() => readNum(HINT_KEY) < HINT_UNTIL);
  const learn = useCallback(() => {
    const n = readNum(HINT_KEY) + 1;
    try {
      localStorage.setItem(HINT_KEY, String(n));
    } catch {
      /* ignore */
    }
    if (n >= HINT_UNTIL) setHints(false);
  }, []);

  const openRecord = (kind: "project" | "initiative", id: string) =>
    onOpenRecord ? onOpenRecord(kind, id) : nav.openRecord(kind, id);

  const groups = useMemo(
    () => readOutline(data, allTasks ?? [], { altitude, view, grouping, filters, search, todayISO: today }),
    [data, allTasks, altitude, view, grouping, filters, search, today],
  );

  // A search or a task filter opens what it found — reading it is the point.
  const reaching = search.trim() !== "" || filters.some((f) => OUTLINE_FIELDS[f.field].level === "task" && f.values.length);
  const isOpen = useCallback((id: string) => expanded.has(id) || reaching, [expanded, reaching]);
  const setOpen = useCallback(
    (id: string, open: boolean) => {
      const next = new Set(expanded);
      if (open) next.add(id);
      else next.delete(id);
      setExpandedList([...next]);
    },
    [expanded, setExpandedList],
  );

  // ── the headings, in the order they are drawn ──────────────────────────────
  const heads = useMemo(() => {
    const out: Head[] = [];
    const pushProject = (p: ProjectItem, parent: string, depth: number) =>
      out.push({ id: p.project.id, kind: "project", parent, project: p, depth, open: isOpen(p.project.id) });
    for (const g of groups) {
      const gid = `g:${g.key}`;
      const gOpen = !folded.has(g.key);
      out.push({ id: gid, kind: "group", parent: null, group: g, depth: 0, open: gOpen });
      if (!gOpen) continue;
      for (const it of g.items) {
        if (it.kind === "project") {
          pushProject(it, gid, 0);
          continue;
        }
        const iOpen = isOpen(it.initiative.id);
        out.push({ id: it.initiative.id, kind: "initiative", parent: gid, initiative: it, depth: 0, open: iOpen });
        if (iOpen) for (const p of it.projects) pushProject(p, it.initiative.id, 1);
      }
    }
    return out;
  }, [groups, folded, isOpen]);

  // ── the keys ───────────────────────────────────────────────────────────────
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** The project whose task list holds the keys, and where it was handed them. */
  const [active, setActive] = useState<{ id: string; entry: { at: "first" | "last" | "composer"; seq: number } | null } | null>(null);
  const seq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const rowEl = (id: string) => listRef.current?.querySelector<HTMLElement>(`[data-head="${CSS.escape(id)}"]`) ?? null;
  const rowAt = (id: string) => {
    const r = rowEl(id)?.getBoundingClientRect();
    return r ? { x: r.left + 40, y: r.bottom + 2 } : { x: 360, y: 200 };
  };

  const enter = (projectId: string, at: "first" | "last" | "composer") => {
    const p = heads.find((h) => h.id === projectId)?.project;
    const empty = !p || p.tasks.length === 0;
    // Completed has no add box: an empty list there has nothing to hold the keys.
    if (empty && view === "completed") return false;
    setCursorId(null);
    setActive({ id: projectId, entry: { at: empty ? "composer" : at, seq: ++seq.current } });
    return true;
  };
  const leave = (projectId: string, dir: "up" | "down") => {
    setActive(null);
    if (dir === "up") return setCursorId(projectId);
    const i = heads.findIndex((h) => h.id === projectId);
    setCursorId(heads[i + 1]?.id ?? projectId);
  };

  // Keep the lit heading in view as the keys walk.
  useEffect(() => {
    if (cursorId) rowEl(cursorId)?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorId]);

  const current = heads.find((h) => h.id === cursorId) ?? null;
  const recordOf = (h: Head) => (h.kind === "project" ? "project" : "initiative") as "project" | "initiative";

  useTaskListKeys<Head>({
    enabled: () => !phone && active === null && !recordMenuOpen && !shipId,
    rows: heads,
    cursor: { cursorId, setCursorId, selectedIds, setSelectedIds },
    acts: {
      open: (h) => {
        if (h.kind === "group") return setFolded(toggle(folded, h.group!.key));
        openRecord(recordOf(h), h.id);
      },
      complete: (targets) => {
        const p = targets.find((h) => h.kind === "project");
        if (p) setShipId(p.id);
      },
      trash: (targets) => {
        const h = targets.find((x) => x.kind !== "group");
        if (!h) return;
        learn();
        askDelete(recordOf(h), h.id, rowAt(h.id));
        // the cursor stays on the row until it is actually gone
        queueMicrotask(() => setCursorId(h.id));
      },
      date: () => {},
      move: () => {},
      priority: () => {},
      rename: (h) => {
        const el = rowEl(h.id)?.querySelector<HTMLElement>(".inline-edit");
        if (!el) return;
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      },
      menu: (h) => {
        if (h.kind === "group") return;
        const at = rowAt(h.id);
        onContextMenu(recordOf(h), h.id)({ preventDefault() {}, stopPropagation() {}, clientX: at.x, clientY: at.y } as unknown as ReactMouseEvent);
      },
      add: (h) => {
        if (h?.kind !== "project" || view === "completed") return;
        learn();
        setOpen(h.id, true);
        enter(h.id, "composer");
      },
      extra: (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
        const h = current;
        if (!h) return false;
        const i = heads.indexOf(h);
        switch (e.key) {
          case "ArrowRight":
          case "l":
            if (!h.open) {
              if (h.kind === "group") setFolded(toggle(folded, h.group!.key));
              else setOpen(h.id, true);
            } else if (h.kind === "project") enter(h.id, "first");
            else if (heads[i + 1]) setCursorId(heads[i + 1].id);
            learn();
            return true;
          case "ArrowLeft":
          case "h":
            if (h.open && !reaching) {
              if (h.kind === "group") setFolded(toggle(folded, h.group!.key));
              else setOpen(h.id, false);
            } else if (h.parent) setCursorId(h.parent);
            return true;
          case "ArrowDown":
          case "j":
            // Down from an open project walks into its tasks, not past them.
            if (h.kind === "project" && h.open) return enter(h.id, "first");
            return false;
          case "ArrowUp":
          case "k": {
            // Up onto an open project from below lands on its add box — the row
            // that is actually drawn above this one.
            const prev = heads[i - 1];
            if (prev?.kind === "project" && prev.open && prev.id !== h.parent)
              return enter(prev.id, view === "completed" ? "last" : "composer");
            return false;
          }
        }
        return false;
      },
    },
  });

  // ── filters ───────────────────────────────────────────────────────────────
  const fieldOptions = (field: OutlineFieldKey) =>
    field === "domain" ? data.domains.map((d) => ({ value: d.id, label: d.name, color: d.color })) : OUTLINE_FIELDS[field].options;
  const toggleValue = (field: OutlineFieldKey, value: string) => {
    const f = filters.find((x) => x.field === field);
    const values = f ? (f.values.includes(value) ? f.values.filter((v) => v !== value) : [...f.values, value]) : [value];
    const rest = filters.filter((x) => x.field !== field);
    setFilters(values.length ? [...rest, { field, values }] : rest);
  };
  const filterLabel = (f: OutlineFilter) => {
    const opts = fieldOptions(f.field);
    return f.values.map((v) => opts.find((o) => o.value === v)?.label ?? v).join(", ");
  };

  const filterRef = useRef<HTMLButtonElement>(null);
  const displayRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [filterOpen, setFilterOpen] = useState<OutlineFieldKey | "root" | null>(null);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [chipAnchor, setChipAnchor] = useState<HTMLElement | null>(null);

  // f — the filter menu, while the outline holds the keys. (`/` is the app's
  // search, bound once in AppShell; the field here filters this outline.)
  useEffect(() => {
    if (phone) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || active || recordMenuOpen) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (document.querySelector("[data-nested-surface]")) return;
      if (e.key === "f") {
        e.preventDefault();
        setChipAnchor(null);
        setFilterOpen("root");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phone, active, recordMenuOpen]);

  const noun = altitude === "project" ? "project" : "initiative";
  const total = groups.reduce((a, g) => a + g.items.length, 0);

  return (
    <div
      ref={listRef}
      className="fl-list ol-list"
      data-flush={flush || undefined}
      style={{ ["--fl-cols" as string]: COLS, ["--fl-cols-narrow" as string]: COLS_NARROW, ["--fl-cols-phone" as string]: COLS_PHONE }}
    >
      {recordMenu}
      <div className="fl-list-head">
        <div className="fl-filter">
          <Segmented<OutlineView> label="View" size="sm" options={VIEWS} value={view} onChange={setView} className="ol-views" />
          <Button
            ref={filterRef}
            kind="ghost"
            size="sm"
            icon={<ListFilter size={14} strokeWidth={1.75} aria-hidden />}
            shortcut={phone ? undefined : "F"}
            aria-haspopup="menu"
            aria-expanded={filterOpen !== null}
            onClick={() => {
              setChipAnchor(null);
              setFilterOpen(filterOpen ? null : "root");
            }}
          >
            Filter
          </Button>
          {filters.map((f) => (
            <span key={f.field} className="ol-chip">
              <button
                type="button"
                className="ol-chip-body"
                onClick={(e) => {
                  setChipAnchor(e.currentTarget);
                  setFilterOpen(f.field);
                }}
              >
                <span className="ol-chip-k">{OUTLINE_FIELDS[f.field].label}</span> {filterLabel(f)}
              </button>
              <IconButton
                size="xs"
                label={`Remove the ${OUTLINE_FIELDS[f.field].label} filter`}
                icon={<Icon name="close" size={12} />}
                onClick={() => setFilters(filters.filter((x) => x.field !== f.field))}
              />
            </span>
          ))}
          <Menu
            anchor={chipAnchor ?? filterRef.current}
            open={filterOpen !== null}
            onClose={() => setFilterOpen(null)}
            label="Filter"
          >
            {filterOpen === "root" ? (
              <>
                <MenuLabel>Presets</MenuLabel>
                {OUTLINE_PRESETS.map((p) => (
                  <MenuItem key={p.label} detail={p.hint} onSelect={() => setFilters(p.filters)}>
                    {p.label}
                  </MenuItem>
                ))}
                <MenuSeparator />
                <MenuLabel>Projects</MenuLabel>
                {(Object.keys(OUTLINE_FIELDS) as OutlineFieldKey[])
                  .filter((f) => OUTLINE_FIELDS[f].level === "project")
                  .map((f) => (
                    <MenuItem key={f} submenu onSelect={() => setFilterOpen(f)}>
                      {OUTLINE_FIELDS[f].label}
                    </MenuItem>
                  ))}
                <MenuLabel>Tasks</MenuLabel>
                {(Object.keys(OUTLINE_FIELDS) as OutlineFieldKey[])
                  .filter((f) => OUTLINE_FIELDS[f].level === "task")
                  .map((f) => (
                    <MenuItem key={f} submenu onSelect={() => setFilterOpen(f)}>
                      {OUTLINE_FIELDS[f].label}
                    </MenuItem>
                  ))}
                {filters.length > 0 && (
                  <>
                    <MenuSeparator />
                    <MenuItem onSelect={() => setFilters([])}>Clear filters</MenuItem>
                  </>
                )}
              </>
            ) : filterOpen ? (
              <>
                <MenuLabel>{OUTLINE_FIELDS[filterOpen].label}</MenuLabel>
                {fieldOptions(filterOpen).map((o) => (
                  <MenuItem
                    key={o.value}
                    keepOpen
                    icon={"color" in o && o.color ? <Dot color={o.color} /> : undefined}
                    detail={"hint" in o ? o.hint : undefined}
                    checked={filters.find((f) => f.field === filterOpen)?.values.includes(o.value) ?? false}
                    onSelect={() => toggleValue(filterOpen, o.value)}
                  >
                    {o.label}
                  </MenuItem>
                ))}
              </>
            ) : null}
          </Menu>
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
            {view !== "everything" && (
              <MenuItem checked={grouping === "when"} onSelect={() => setGrouping("when")}>
                {view === "completed" ? "Week finished" : altitude === "initiative" ? "Quarter" : "Week"}
              </MenuItem>
            )}
            <MenuItem checked={grouping === "domain"} onSelect={() => setGrouping("domain")}>Domain</MenuItem>
            <MenuItem checked={grouping === "status" || (view === "everything" && grouping === "when")} onSelect={() => setGrouping("status")}>Status</MenuItem>
            <MenuItem checked={grouping === "none"} onSelect={() => setGrouping("none")}>No grouping</MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => setExpandedList(heads.filter((h) => h.kind !== "group").map((h) => h.id).concat(allIds(groups)))}>
              Open everything
            </MenuItem>
            <MenuItem onSelect={() => setExpandedList([])}>Close everything</MenuItem>
            {!phone && (
              <MenuItem
                checked={hints}
                onSelect={() => {
                  try {
                    localStorage.setItem(HINT_KEY, hints ? String(HINT_UNTIL) : "0");
                  } catch {
                    /* ignore */
                  }
                  setHints(!hints);
                }}
              >
                Keyboard hints
              </MenuItem>
            )}
          </Menu>
          <span className="fl-filter-gap" />
          {view === "upcoming" && (
            <FloorStanding
              kind={altitude}
              onRefine={() => setFilters(OUTLINE_PRESETS[1].filters)}
              onAllocate={() => (altitude === "project" ? nav.setProjectView("ondeck") : nav.setInitiativeView("ondeck"))}
            />
          )}
          <SearchField
            ref={searchRef}
            className="ol-search"
            placeholder={`Search ${noun}s and tasks`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                if (search) setSearch("");
                else e.currentTarget.blur();
              } else if (e.key === "Enter" || e.key === "ArrowDown") {
                e.preventDefault();
                e.currentTarget.blur();
                setCursorId(heads.find((h) => h.kind !== "group")?.id ?? null);
              }
            }}
          />
          <Button
            kind="primary"
            size="sm"
            icon={<Icon name="plus" size={14} />}
            shortcut={phone ? undefined : altitude === "project" ? "P" : "I"}
            onClick={() => nav.openFloorModal(altitude === "project" ? "new-project" : "new-initiative")}
          >
            New {noun}
          </Button>
        </div>
        <div className="fl-th" role="row">
          <span className="fl-th-cell ol-th-name" data-col="keep">Name</span>
          <span className="fl-th-cell" data-col="std">Domain</span>
          <span className="fl-th-cell" data-col="std">Status</span>
          <span className="fl-th-cell" data-col="std">{view === "completed" ? "Finished" : "Target"}</span>
          <span className="fl-th-cell" data-col="wide">Left</span>
          <span className="fl-th-cell" data-col="wide">{altitude === "project" ? "Pace" : "Projects"}</span>
          <span data-col="keep" />
        </div>
      </div>

      <div className="relative flex flex-1 flex-col" role="treegrid" aria-label={`${noun}s`}>
        {groups.map((g) => {
          const gid = `g:${g.key}`;
          const gOpen = !folded.has(g.key);
          return (
            <div key={g.key} role="rowgroup">
              <button
                type="button"
                className="fl-grp ol-grp"
                data-head={gid}
                data-lit={cursorId === gid || undefined}
                aria-expanded={gOpen}
                onClick={() => {
                  setCursorId(gid);
                  setActive(null);
                  setFolded(toggle(folded, g.key));
                }}
              >
                <Icon name="chevron-down" size={12} className="fl-chev" />
                {g.domainId ? <Dot color={domainById(data, g.domainId)?.color ?? "var(--faint)"} /> : null}
                <span className={g.late ? "ol-late" : undefined}>{g.label}</span>
                {g.span && <span className="ol-span">{g.span}</span>}
                <span className="k-count">{g.items.length}</span>
                {hints && cursorId === gid && <HeadHint keys={[["←", "→"], gOpen ? "fold" : "open"]} />}
                <span className="ol-grp-meta">
                  {view === "completed"
                    ? g.doneTasks
                      ? `${g.doneTasks} finished`
                      : ""
                    : g.openTasks
                      ? `${g.openTasks} open${g.minutes ? ` · ${minsLabel(g.minutes)}` : ""}`
                      : ""}
                </span>
              </button>
              {gOpen &&
                g.items.map((it) =>
                  it.kind === "project" ? (
                    <Fragment key={it.project.id}>{projectBlock(it, 0)}</Fragment>
                  ) : (
                    <div key={it.initiative.id}>
                      {initiativeRow(it)}
                      {isOpen(it.initiative.id) && (
                        <>
                          {it.projects.map((p) => (
                            <Fragment key={p.project.id}>{projectBlock(p, 1)}</Fragment>
                          ))}
                          {it.projects.length === 0 && <div className="ol-empty" style={{ ["--depth" as string]: 1 }}>No projects yet</div>}
                        </>
                      )}
                    </div>
                  ),
                )}
            </div>
          );
        })}
        {total === 0 && (
          <EmptyState>
            {filters.length || search ? (
              <>
                Nothing matches.{" "}
                <Button kind="ghost" size="xs" onClick={() => (setFilters([]), setSearch(""))}>
                  Clear filters
                </Button>
              </>
            ) : view === "completed" ? (
              "Nothing finished yet"
            ) : (
              `No ${noun}s`
            )}
          </EmptyState>
        )}
        <div className="fl-list-foot" aria-hidden />
      </div>

      {shipId && <ProjectShipAssess id={shipId} onClose={() => setShipId(null)} />}
    </div>
  );

  // ── rows ─────────────────────────────────────────────────────────────────
  // Plain functions CALLED, never mounted as components: declared in here they
  // would be a new component type every render, and every keystroke would
  // remount the task lists under them (and lose their cursors).

  function initiativeRow(item: InitiativeItem) {
    const i = item.initiative;
    const open = isOpen(i.id);
    const domain = domainById(data, i.domainId);
    const shipped = item.projects.filter((p) => p.project.status === "complete").length;
    const all = data.projects.filter((p) => p.initiativeId === i.id);
    const ripe = ripenessOfInitiative(data, i);
    return (
      headRow({
        id: i.id,
        kind: "initiative",
        depth: 0,
        open: open,
        count: item.projects.length,
        onToggle: () => setOpen(i.id, !open),
        pip: <RipenessPip stage={ripe.stage} unsound={ripe.stage === "active" && verdictOf(data, "initiative", i.id)?.sound !== true} />,
        name: <InlineText value={i.name} onChange={(v) => updateInitiative(i.id, { name: v })} placeholder="Untitled" />,
        domain: domain,
        onDomain: (d) => {
          updateInitiative(i.id, { domainId: d });
          all.forEach((p) => updateProject(p.id, { domainId: d }));
        },
        status: <StatusPill value={i.status} options={[...PROJECT_STATUS]} colors={PROJECT_STATUS_COLORS} labels={PROJECT_STATUS_LABEL} onChange={(s) => updateInitiative(i.id, { status: s as typeof i.status })} />,
        date: 
          view === "completed" ? (
            <span className="fl-cell">{shortDay(item.when)}</span>
          ) : (
            <InlineDate value={i.targetDate} onChange={(v) => updateInitiative(i.id, { targetDate: v })} placeholder="—" />
          )
        ,
        left: minsLabel(item.projects.reduce((a, p) => a + p.minutes, 0)),
        progress: <span className="fl-cell">{`${shipped}/${all.length}`}</span>,
      })
    );
  }

  function projectBlock(item: ProjectItem, depth: number) {
    const p = item.project;
    const open = isOpen(p.id);
    const domain = domainById(data, p.domainId);
    const ripe = ripenessOfProject(data, p);
    const listActive = active?.id === p.id;
    return (
      <>
        {headRow({
          id: p.id,
          kind: "project",
          depth: depth,
          open: open,
          count: view === "completed" ? item.tasks.length : item.open,
          onToggle: () => setOpen(p.id, !open),
          pip: <RipenessPip stage={ripe.stage} unsound={ripe.stage === "active" && verdictOf(data, "project", p.id)?.sound !== true} />,
          name: <InlineText value={p.name} onChange={(v) => updateProject(p.id, { name: v })} placeholder="Untitled" />,
          domain: altitude === "project" ? domain : undefined,
          onDomain: (d) => updateProject(p.id, { domainId: d, initiativeId: null }),
          status: 
            <StatusPill
              value={p.status}
              options={PROJECT_STATUS}
              colors={PROJECT_STATUS_COLORS}
              labels={PROJECT_STATUS_LABEL}
              onChange={(s) => (s === "complete" ? setShipId(p.id) : updateProject(p.id, { status: s as typeof p.status }))}
            />
          ,
          date: 
            view === "completed" ? (
              <span className="fl-cell">{shortDay(item.when)}</span>
            ) : (
              <InlineDate value={p.targetDate} onChange={(v) => updateProject(p.id, { targetDate: v })} placeholder="—" />
            )
          ,
          left: view === "completed" ? "" : minsLabel(item.minutes),
          progress: 
            item.open + item.done > 0 ? (
              <PaceTrack
                done={item.done}
                total={item.open + item.done}
                color={domain?.color ?? "var(--accent)"}
                elapsed={p.status === "complete" ? null : spanElapsed(p, now)}
                width={96}
              />
            ) : (
              <span className="fl-cell">—</span>
            )
          ,
        })}
        {open && (
          <div
            className="ol-tasks"
            style={{ ["--depth" as string]: depth + 1 }}
            data-active={listActive || undefined}
            // A click among the tasks hands them the keys, as a press would.
            onPointerDownCapture={() => {
              if (!listActive) {
                setCursorId(null);
                setActive({ id: p.id, entry: null });
              }
            }}
          >
            <TaskListView
              tasks={item.tasks}
              context={{ projectId: p.id, initiativeId: p.initiativeId, domainId: p.domainId }}
              contextLabel={{ name: p.name, color: domain?.color }}
              keyboard={listActive}
              onOpen={(t) => nav.openOverlay("task-record", t.id)}
              flush
              reorderable={view !== "completed"}
              composer={view !== "completed"}
              composerPlaceholder={item.tasks.length || phone ? "Add a task…" : "Add the first task — “fri 30m” sets when and how long"}
              outline={{ onLeave: (dir) => leave(p.id, dir), entry: listActive ? active?.entry ?? null : null }}
            />
          </div>
        )}
      </>
    );
  }

  function headRow({
    id,
    kind,
    depth,
    open,
    count,
    onToggle,
    pip,
    name,
    domain,
    onDomain,
    status,
    date,
    left,
    progress,
  }: {
    id: string;
    kind: "initiative" | "project";
    depth: number;
    open: boolean;
    count: number;
    onToggle: () => void;
    pip: React.ReactNode;
    name: React.ReactNode;
    domain: Domain | null | undefined;
    onDomain: (id: string) => void;
    status: React.ReactNode;
    date: React.ReactNode;
    left: string;
    progress: React.ReactNode;
  }) {
    const lit = cursorId === id;
    const stop = (e: ReactMouseEvent) => e.stopPropagation();
    const more = (e: ReactMouseEvent<HTMLButtonElement>) => {
      if (phone) return recordActs ? recordActs.open(kind, id) : openRecord(kind, id);
      const b = e.currentTarget.getBoundingClientRect();
      onContextMenu(kind, id)({ preventDefault() {}, stopPropagation() {}, clientX: b.left, clientY: b.bottom + 4 } as unknown as ReactMouseEvent);
    };
    return (
      <div
        className="fl-tr ol-row"
        // Enter / Space on the row open it, as a click does; the outline's own
        // keys (useTaskListKeys) are the main road, so the row is no tab stop.
        {...pressable(() => {
          setActive(null);
          setCursorId(id);
          onToggle();
        }, { role: "row", noTabStop: true })}
        aria-level={depth + 1}
        aria-expanded={open}
        data-head={id}
        data-kind={kind}
        data-lit={lit || undefined}
        style={{ ["--depth" as string]: depth }}
        onContextMenu={phone ? undefined : onContextMenu(kind, id)}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("[data-no-select], button, input, textarea, a, [contenteditable]")) return;
          setActive(null);
          setCursorId(id);
          onToggle();
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest("[data-no-select], button, input, textarea, a, [contenteditable]")) return;
          openRecord(kind, id);
        }}
        {...(phone && recordActs ? recordActs.hold(kind, id) : {})}
      >
        <div className="fl-name ol-name" data-col="keep">
          <button
            type="button"
            className="ol-chev tap-icon"
            aria-label={open ? "Close" : "Open"}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              setActive(null);
              setCursorId(id);
              onToggle();
            }}
          >
            <Icon name="chevron-right" size={12} />
          </button>
          {pip}
          <span className="ol-name-text" data-no-select onMouseDown={stop}>
            {name}
          </span>
          {!open && count > 0 && <span className="k-count">{count}</span>}
          {hints && lit && !phone && (
            <HeadHint
              keys={
                kind === "project"
                  ? [open ? "↓" : "→", open ? "into it" : "open", "a", "add task", "⌫", "delete"]
                  : [open ? "↓" : "→", open ? "into it" : "open", "↵", "open record", "⌫", "delete"]
              }
            />
          )}
        </div>
        <div data-col="std" className="min-w-0" data-no-select onMouseDown={stop}>
          {domain ? <DomainPicker domains={data.domains} value={domain.id} onChange={onDomain} /> : null}
        </div>
        <div data-col="std" className="min-w-0" data-no-select onMouseDown={stop}>
          {status}
        </div>
        <div data-col="std" className="fl-cell" data-no-select onMouseDown={stop}>
          {date}
        </div>
        <div data-col="wide" className="fl-cell">
          {left || "—"}
        </div>
        <div data-col="wide" className="flex min-w-0 items-center">
          {progress}
        </div>
        <div data-col="keep" className="fl-cell-end">
          <IconButton className="fl-more" size="xs" label="More" icon={<Icon name="more" size={14} />} data-no-select onMouseDown={stop} onClick={more} />
        </div>
      </div>
    );
  }
}

/** The keys a lit heading answers, said once, faintly, beside it — and only
 *  until they have been used a few times. Pairs of [keys, words]. */
function HeadHint({ keys }: { keys: (string | string[])[] }) {
  const pairs: [string | string[], string][] = [];
  for (let i = 0; i < keys.length; i += 2) pairs.push([keys[i], keys[i + 1] as string]);
  return (
    <span className="ol-hint" aria-hidden>
      {pairs.map(([k, w], i) => (
        <span key={i}>
          <Kbd keys={k} />
          {w}
        </span>
      ))}
    </span>
  );
}

function toggle(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function allIds(groups: OutlineGroup[]): string[] {
  return groups.flatMap((g) => g.items.flatMap((it) => (it.kind === "project" ? [it.project.id] : [it.initiative.id, ...it.projects.map((p) => p.project.id)])));
}
