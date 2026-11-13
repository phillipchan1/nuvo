// The strategic-vertical detail stack — the rich, light-editing screens for a
// single Domain / Initiative / Project, plus the flat browse list and all the
// shared primitives they're built from. Extracted from the old MobilePlan so the
// Projects and Initiatives tabs (and global search) can open the SAME detail
// through one bottom Sheet.
//
// Viewing is rich (progress, the 13-week presence pulse, key results);
// editing stays light — name, outcome, status, momentum, dates, and a domain's
// mandate + weekly target. No new data layer: every read is a pure selector over the
// live VerticalData snapshot, every write goes through useVertical()'s mutations.

import { useMemo, useRef, useState, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { useVertical, type TaskParent } from "../../../hooks/useVertical";
import { useLongPressReorder } from "../../../hooks/useLongPressReorder";
import SharedComposer from "../../tasks/TaskComposer";
import { ProjectShipAssess } from "../../record/ShipAssess";
import { QuarterBand, WeekBand } from "../../record/PlacementBand";
import { RecordLog } from "../../record/RecordLog";
import {
  domainById,
  showingUp,
  initiativeById,
  initiativeAttainment,
  initiativeProgress,
  initiativesOf,
  isProjectComplete,
  looseTasksOfInitiative,
  projectProgress,
  projectsOf,
  redealSortOrder,
  tasksOf,
  type Initiative,
  type KeyResult,
  type Momentum,
  type Project,
  type ProjectStatus,
  type VTask,
  type VerticalData,
} from "../../../lib/vertical";
import { ripenessOfInitiative, ripenessOfProject, verdictOf } from "../../../lib/tending";
import { DomainPicker, InitiativePicker, ProjectAttachPicker, RipenessPip } from "../../floors/parts";
import { ShipStamp } from "../../ShipStamp";
import { useAllTasks } from "../../../hooks/useTasks";
import { byManualOrder } from "../../../lib/taskOrder";
import type { Task } from "../../../lib/types";
import TaskListView from "../../tasks/TaskListView";
import { useMobileOpenTask } from "../openTask";
import DomainSymbol from "../../domain/DomainSymbol";
import { Icon } from "../../Icon";
import { Dot, IconButton } from "../../kit";

export type Store = ReturnType<typeof useVertical>;

/** A detail to open — from a tab row or a global-search jump. `n` is a nonce so
 *  repeated jumps to the same id re-fire the effect. */
export type DetailTarget = { kind: "domain" | "initiative" | "project"; id: string; n: number };

// One status vocabulary, shared with the desktop floors (parts.tsx).
export const STATUS: ProjectStatus[] = ["backlog", "in_progress", "waiting", "cancelled", "complete"];
export const STATUS_LABEL: Record<ProjectStatus, string> = {
  backlog: "Backlog",
  in_progress: "Active",
  waiting: "Waiting",
  cancelled: "Cancelled",
  complete: "Complete",
};
// Mirrors PROJECT_STATUS_COLORS (floors/parts.tsx) — the phone must not disagree
// with the desktop about what "waiting" looks like. Tokens, never hexes, so the
// active material owns the colour.
export const STATUS_COLOR: Record<ProjectStatus, string> = {
  backlog: "var(--muted)",
  in_progress: "var(--accent)",
  waiting: "var(--warn)",
  cancelled: "var(--signal)",
  complete: "var(--ok)",
};
// Active work floats to the top of the flat lists; finished/abandoned sinks.
export const STATUS_RANK: Record<ProjectStatus, number> = {
  in_progress: 0,
  waiting: 1,
  backlog: 2,
  complete: 3,
  cancelled: 4,
};

export const MOMENTUM: { value: Momentum; glyph: string; label: string }[] = [
  { value: "up", glyph: "↗", label: "Rising" },
  { value: "flat", glyph: "→", label: "Steady" },
  { value: "down", glyph: "↘", label: "Slipping" },
];

export type Lens = "projects" | "initiatives" | "domains";

// ── The navigation stack: a flat list at the base, details pushed on top ──────
export type Frame =
  | { level: "list" }
  | { level: "domain"; id: string }
  | { level: "initiative"; id: string }
  | { level: "project"; id: string };

export const frameFor = (t: DetailTarget): Frame => ({ level: t.kind, id: t.id });

// ── The flat, segmented list — tap straight to any item ──────────────────────
export function VerticalList({
  d,
  lens,
  onOpenProject,
  onOpenInitiative,
  onOpenDomain,
  hold,
}: {
  d: VerticalData;
  lens: Lens;
  onOpenProject: (id: string) => void;
  onOpenInitiative: (id: string) => void;
  onOpenDomain: (id: string) => void;
  /** `useRecordActions().actionProps` — long-press a project/initiative row for
   *  its lifecycle acts, the way right-click works on the desktop table. */
  hold?: (kind: "project" | "initiative", id: string) => Record<string, unknown>;
}) {
  if (lens === "projects") {
    const projects = [...d.projects].sort(
      (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name),
    );
    if (projects.length === 0) return <Empty>No projects yet</Empty>;
    return (
      <div>
        {projects.map((p) => (
          <Row
            key={p.id}
            onClick={() => onOpenProject(p.id)}
            hold={hold?.("project", p.id)}
            chevron
            leading={<StatusDot status={p.status} />}
            title={p.name}
            subtitle={projectContext(d, p)}
            meta={
              <span className="ph-row-meta flex items-center gap-1.5">
                {(() => { const rp = ripenessOfProject(d, p); return <RipenessPip stage={rp.stage} unsound={rp.stage === "active" && verdictOf(d, "project", p.id)?.sound !== true} />; })()}
                {projectProgress(d, p)}%
              </span>
            }
          />
        ))}
      </div>
    );
  }

  if (lens === "initiatives") {
    const inits = [...d.initiatives].sort(
      (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name),
    );
    if (inits.length === 0) return <Empty>No initiatives yet</Empty>;
    return (
      <div>
        {inits.map((i) => {
          const mom = MOMENTUM.find((m) => m.value === i.momentum);
          return (
            <Row
              key={i.id}
              onClick={() => onOpenInitiative(i.id)}
              hold={hold?.("initiative", i.id)}
              chevron
              leading={<StatusDot status={i.status} />}
              title={i.name}
              subtitle={domainById(d, i.domainId)?.name ?? undefined}
              meta={
                <span className="ph-row-meta flex items-center gap-1.5">
                  {(() => { const ri = ripenessOfInitiative(d, i); return <RipenessPip stage={ri.stage} unsound={ri.stage === "active" && verdictOf(d, "initiative", i.id)?.sound !== true} />; })()}
                  <span>{mom?.glyph}</span>
                  <span>{initiativeProgress(d, i)}%</span>
                </span>
              }
            />
          );
        })}
      </div>
    );
  }

  if (d.domains.length === 0) return <Empty>No domains yet</Empty>;
  return (
    <div>
      {d.domains.map((dom) => {
        const f = showingUp(dom);
        const open = initiativesOf(d, dom.id).filter((i) => i.status !== "complete" && i.status !== "cancelled").length;
        return (
          <Row
            key={dom.id}
            onClick={() => onOpenDomain(dom.id)}
            chevron
            leading={
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-card)]"
                style={{ background: `color-mix(in srgb, ${dom.color} 14%, transparent)`, color: dom.color }}
              >
                <DomainSymbol value={dom.icon} size={18} />
              </span>
            }
            title={dom.name}
            subtitle={`${open} ${open === 1 ? "initiative" : "initiatives"} · ${f.note}`}
            meta={<Lamp lit={f.lit} color={dom.color} />}
          />
        );
      })}
    </div>
  );
}

// ── A single initiative ──────────────────────────────────────────────────────
export function InitiativeScreen({
  d,
  store,
  id,
  onOpenProject,
}: {
  d: VerticalData;
  store: Store;
  id: string;
  onOpenProject: (id: string) => void;
}) {
  const projectListRef = useRef<HTMLDivElement>(null);
  const projectReorder = useLongPressReorder({
    containerRef: projectListRef,
    itemSelector: "[data-project-id]",
    idAttr: "data-project-id",
    ids: () => projectsOf(d, id).map((p) => p.id),
    onCommit: (next) => {
      const entries = redealSortOrder(projectsOf(d, id), next);
      if (entries.length) store.reorderProjects(entries);
    },
  });
  const i = d.initiatives.find((x) => x.id === id);
  if (!i) return <Empty>Gone</Empty>;
  const dom = d.domains.find((x) => x.id === i.domainId);
  const accent = dom?.color ?? "var(--accent)";
  const projects = projectsOf(d, i.id);
  const looseTasks = looseTasksOfInitiative(d, i.id);
  const attainment = i.keyResults.length ? initiativeAttainment(d, i) : null;

  return (
    <div className="ph-body pt-1">
      <RecordHead
        accent={accent}
        name={i.name}
        onName={(v) => store.updateInitiative(i.id, { name: v })}
        outcome={i.outcome}
        onOutcome={(v) => store.updateInitiative(i.id, { outcome: v })}
        outcomePlaceholder="Outcome"
        shipped={isProjectComplete(i.status)}
        sealSize={26}
      />

      {/* A bet's "when" is a QUARTER — and its runway is counted in weeks, the
          unit you actually spend. */}
      <Section label="Quarter">
        <QuarterField i={i} store={store} />
      </Section>

      {/* A bet with no key results can never read as measured, so the section
          is always here with a way in — the phone's twin of the desktop
          record's KR list, which has had a composer all along. */}
      <Section
        label="Key results"
        meter={attainment != null ? `${attainment}%` : null}
        fill={attainment}
        accent={accent}
      >
        {i.keyResults.length > 0 && (
          <CardList>
            {i.keyResults.map((kr) => (
              <KeyResultRow
                key={kr.id}
                kr={kr}
                accent={accent}
                onPatch={(patch) => store.updateKeyResult(i.id, kr.id, patch)}
                onDelete={() => store.deleteKeyResult(i.id, kr.id)}
              />
            ))}
          </CardList>
        )}
        <button type="button" onClick={() => store.addKeyResult(i.id)} className="ph-row row-hover !px-0 !border-b-0">
          <span className="ph-row-lead" style={{ color: accent }}>
            <Icon name="plus" size={18} />
          </span>
          <span className="ph-row-label" data-grow="" style={{ color: "var(--muted)" }}>
            Add a key result
          </span>
        </button>
      </Section>

      <Section
        label="Projects"
        meter={projects.length ? String(projects.length) : null}
        fill={projects.length ? initiativeProgress(d, i) : null}
        accent={accent}
      >
        {projects.length === 0 ? (
          <Hint>No projects yet</Hint>
        ) : (
          <div ref={projectListRef} className="relative">
            {projectReorder.lineTop != null && (
              <div className="reorder-insert-line" style={{ top: projectReorder.lineTop }} aria-hidden />
            )}
            <CardList>
              {projects.map((p) => (
                <ProjectRow
                  key={p.id}
                  d={d}
                  p={p}
                  onClick={() => onOpenProject(p.id)}
                  reorder={
                    projects.length > 1
                      ? {
                          press: (e) => projectReorder.press(e, p.id),
                          arming: projectReorder.armingId === p.id,
                          dragging: projectReorder.draggingId === p.id,
                        }
                      : undefined
                  }
                />
              ))}
            </CardList>
          </div>
        )}
        <div className="mt-2">
          <ProjectAttachPicker
            accent={accent}
            candidates={d.projects
              .filter((p) => p.domainId === i.domainId && p.initiativeId !== i.id)
              .sort((a, b) => a.name.localeCompare(b.name))}
            onAttach={(projectId) => store.updateProject(projectId, { initiativeId: i.id })}
          />
        </div>
      </Section>

      <Section label="Loose tasks" meter={looseTasks.length ? String(looseTasks.length) : null}>
        <DetailTaskList
          tasks={looseTasks}
          parent={{ initiativeId: i.id, domainId: i.domainId }}
          placeholder="Add a task"
          reorderable
        />
      </Section>

      <Section label="Comments">
        <RecordLog kind="initiative" id={i.id} accent={accent} />
      </Section>

      {/* Bookkeeping at the foot — momentum and status are how the bet is
          filed, not what it is. */}
      <Section label="Momentum">
        <div className="flex flex-wrap gap-1.5">
          {MOMENTUM.map((m) => (
            <Chip key={m.value} on={i.momentum === m.value} onClick={() => store.updateInitiative(i.id, { momentum: m.value })}>
              <span aria-hidden>{m.glyph}</span>
              {m.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section label="Status">
        <StatusSelect value={i.status} onPick={(s) => store.updateInitiative(i.id, { status: s })} />
      </Section>
    </div>
  );
}

// ── A single project ─────────────────────────────────────────────────────────
export function ProjectScreen({ d, store, id }: { d: VerticalData; store: Store; id: string }) {
  const [shipping, setShipping] = useState(false);
  const p = d.projects.find((x) => x.id === id);
  if (!p) return <Empty>Gone</Empty>;
  const dom = d.domains.find((x) => x.id === p.domainId);
  const accent = dom?.color ?? "var(--accent)";
  const tasks = tasksOf(d, p.id);
  const doneCount = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="ph-body pt-1">
      <RecordHead
        accent={accent}
        name={p.name}
        onName={(v) => store.updateProject(p.id, { name: v })}
        outcome={p.outcome}
        onOutcome={(v) => store.updateProject(p.id, { outcome: v })}
        outcomePlaceholder="Outcome"
        shipped={isProjectComplete(p.status)}
      />

      {/* A project's "when" is a WEEK, not two dates — the same commitment the
          deck makes when you drop it on a column. Exact dates stay one tap away. */}
      <Section label="Week">
        <WeekField p={p} store={store} />
      </Section>

      {/* Tasks are the work, so they come before the admin — and they're
          editable here, not "scaffold it on the desktop". */}
      <Section
        label="Tasks"
        meter={tasks.length ? `${doneCount}/${tasks.length}` : null}
        fill={tasks.length ? projectProgress(d, p) : null}
        accent={accent}
      >
        <DetailTaskList
          tasks={tasks}
          parent={{ projectId: p.id, initiativeId: p.initiativeId, domainId: p.domainId }}
          placeholder={tasks.length ? "Add a task" : "First step"}
          reorderable
        />
      </Section>

      {/* The same thread the desktop record carries — one component, both
          shells, so a note written on the phone is the note you read at a desk. */}
      <Section label="Comments">
        <RecordLog kind="project" id={p.id} accent={accent} />
      </Section>

      {/* Status is bookkeeping, not the point of the record — it sits at the
          foot as one line, the way the desktop keeps it behind the ⋯ menu.
          Shipping still asks first: it closes the open tasks, and you say
          whether they were done or dropped. */}
      <Section label="Status">
        <StatusSelect value={p.status} onPick={(s) => (s === "complete" ? setShipping(true) : store.updateProject(p.id, { status: s }))} />
      </Section>
      {shipping && <ProjectShipAssess id={p.id} onClose={() => setShipping(false)} />}
    </div>
  );
}

// ── Context line for the flat project list (where it lives) ───────────────────
export function projectContext(d: VerticalData, p: Project): ReactNode {
  const dom = domainById(d, p.domainId);
  const init = p.initiativeId ? initiativeById(d, p.initiativeId) : null;
  const head = dom ? <><DomainSymbol value={dom.icon} size={12} /> {dom.name}</> : "—";
  return <span className="inline-flex items-center gap-1">{head}{init && <> · {init.name}</>}</span>;
}

// ── Rows ─────────────────────────────────────────────────────────────────────
export function InitiativeRow({ d, i, onClick }: { d: VerticalData; i: Initiative; onClick: () => void }) {
  const mom = MOMENTUM.find((m) => m.value === i.momentum);
  return (
    <Row
      onClick={onClick}
      chevron
      leading={<StatusDot status={i.status} />}
      title={i.name}
      subtitle={i.outcome || undefined}
      meta={
        <span className="ph-row-meta flex items-center gap-1.5">
          <span>{mom?.glyph}</span>
          <span>{initiativeProgress(d, i)}%</span>
        </span>
      }
    />
  );
}

export function ProjectRow({
  d,
  p,
  onClick,
  reorder,
}: {
  d: VerticalData;
  p: Project;
  onClick: () => void;
  reorder?: { press: (e: React.PointerEvent) => void; arming: boolean; dragging: boolean };
}) {
  return (
    <Row
      id={p.id}
      onClick={onClick}
      chevron
      leading={<StatusDot status={p.status} />}
      title={p.name}
      subtitle={p.outcome || undefined}
      meta={<span className="ph-row-meta">{projectProgress(d, p)}%</span>}
      reorder={reorder}
    />
  );
}

/** A record's tasks on the phone — the app's one task list (TaskListView):
 *  the real row (swipe right done, left tomorrow), hold the grip to reorder,
 *  tap for the task sheet, and the one add box underneath. */
export function DetailTaskList({
  tasks,
  parent,
  placeholder,
  reorderable = false,
}: {
  tasks: VTask[];
  parent: TaskParent;
  placeholder: string;
  reorderable?: boolean;
}) {
  const { data } = useVertical();
  const { data: allTasks } = useAllTasks();
  const openTask = useMobileOpenTask();
  const rows = useMemo(() => {
    const byId = new Map((allTasks ?? []).map((t) => [t.id, t]));
    // A VTask the cache hasn't seen (a fixture harness) is drawn from its own
    // fields rather than dropped.
    return byManualOrder(tasks.map((v) => byId.get(v.id) ?? taskFromVTask(v)));
  }, [tasks, allTasks]);
  const p = parent.projectId ? data.projects.find((x) => x.id === parent.projectId) : null;
  const i = !p && parent.initiativeId ? data.initiatives.find((x) => x.id === parent.initiativeId) : null;
  const dom = data.domains.find((x) => x.id === (p?.domainId ?? i?.domainId ?? parent.domainId));
  const name = p?.name ?? i?.name ?? dom?.name;
  return (
    <TaskListView
      tasks={rows}
      context={parent}
      contextLabel={name ? { name, color: dom?.color ?? null } : null}
      keyboard={false}
      reorderable={reorderable}
      onOpen={(t) => openTask?.(t.id)}
      composerPlaceholder={placeholder}
    />
  );
}

// ── Naming a task on the phone — the composer the record was missing ──────────
// Free text in, structure out (`parseCapture` strips a trailing "30m"), a plain
// `<input>` so iOS dictation works, and ⏎ keeps the caret for the next one —
// the same low-data-entry act as the desktop TaskList composer, at thumb scale.
/** The phone's add box on a detail screen — the app's one composer
 *  (`tasks/TaskComposer`), filed into this record. `store` stays in the
 *  signature for the callers; the composer creates through the shared path. */
export function TaskComposer({
  parent,
  placeholder = "Add a task…",
}: {
  parent: TaskParent;
  store?: Store;
  accent?: string;
  placeholder?: string;
}) {
  const { data } = useVertical();
  const p = parent.projectId ? data.projects.find((x) => x.id === parent.projectId) : null;
  const i = !p && parent.initiativeId ? data.initiatives.find((x) => x.id === parent.initiativeId) : null;
  const d = data.domains.find((x) => x.id === (p?.domainId ?? i?.domainId ?? parent.domainId));
  const name = p?.name ?? i?.name ?? d?.name;
  return (
    <SharedComposer
      className="mt-2"
      context={parent}
      contextLabel={name ? { name, color: d?.color ?? null } : null}
      placeholder={placeholder}
      submitOnBlur
    />
  );
}

/** One key result, editable on a phone: the name, the number that moved, the
 *  number you're chasing, and the unit. `current` is the field you actually come
 *  back to, so it carries the accent and sits first. */
export function KeyResultRow({
  kr,
  accent,
  onPatch,
  onDelete,
}: {
  kr: KeyResult;
  accent: string;
  onPatch: (patch: Partial<KeyResult>) => void;
  onDelete: () => void;
}) {
  const span = kr.target - kr.baseline;
  const pct = span === 0 ? 0 : Math.round(((kr.current - kr.baseline) / span) * 100);
  return (
    <div className="py-2.5">
      <div className="flex items-center gap-2">
        <TextField
          className="min-w-0 flex-1 text-head font-medium"
          value={kr.name}
          onCommit={(v) => onPatch({ name: v })}
        />
        <IconButton
          label={`Delete ${kr.name || "key result"}`}
          size="sm"
          icon={<Icon name="close" size={16} />}
          onClick={onDelete}
          className="tap-icon -mr-1.5 shrink-0"
        />
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-caption tabular-nums text-muted">
        <KrNumber value={kr.current} accent={accent} onCommit={(v) => onPatch({ current: v })} />
        <span className="text-[var(--faint)]">/</span>
        <KrNumber value={kr.target} onCommit={(v) => onPatch({ target: v })} />
        <input
          defaultValue={kr.unit}
          key={kr.unit}
          placeholder="unit"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== kr.unit) onPatch({ unit: v });
          }}
          // takes the slack rather than a fixed width — "sessions" was clipped
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--faint)]"
        />
        <span className="ml-auto shrink-0 tabular-nums" style={{ color: accent }}>{pct}%</span>
      </div>
      <ProgressBar pct={pct} color={accent} />
    </div>
  );
}

/** A number you can actually hit with a thumb — `inputMode` opens the numeric
 *  keypad instead of the full keyboard. */
function KrNumber({ value, accent, onCommit }: { value: number; accent?: string; onCommit: (v: number) => void }) {
  return (
    <input
      key={value}
      type="number"
      inputMode="decimal"
      defaultValue={value}
      onBlur={(e) => {
        const next = Number(e.target.value);
        if (!Number.isNaN(next) && next !== value) onCommit(next);
      }}
      className="w-12 shrink-0 bg-transparent tabular-nums outline-none"
      style={accent ? { color: accent } : undefined}
    />
  );
}

export function Row({
  id,
  leading,
  title,
  subtitle,
  meta,
  onClick,
  chevron,
  hold,
  reorder,
}: {
  id?: string;
  leading?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  meta?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  /** Long-press handlers (`useRecordActions().actionProps`) — the phone's
   *  right-click. Spread rather than baked in, because only rows that stand
   *  for a record have lifecycle acts. */
  hold?: Record<string, unknown>;
  /** Press-and-hold the grip to reorder — opt-in per list, via
   *  `useLongPressReorder`. Pairs with `id`, which the row is tagged with so
   *  the gesture's own geometry query can find it. */
  reorder?: { press: (e: React.PointerEvent) => void; arming: boolean; dragging: boolean };
}) {
  return (
    <button
      type="button"
      data-project-id={reorder ? id : undefined}
      onClick={onClick}
      {...hold}
      className="ph-row row-hover py-1.5"
      style={reorder?.dragging ? { opacity: 0.6 } : undefined}
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="ph-row-title block">{title}</span>
        {subtitle && <span className="block truncate text-caption text-muted">{subtitle}</span>}
      </span>
      {meta}
      {chevron && <Icon name="chevron-right" size={16} className="ph-row-chev" />}
      {/* Always visible (no hover to reveal it behind) — the hold, not the
          tap, starts the drag, so a plain tap still opens the record. */}
      {reorder && (
        <span
          onPointerDown={(e) => { e.stopPropagation(); reorder.press(e); }}
          onClick={(e) => e.stopPropagation()}
          aria-label="Press and hold to reorder"
          className="tap-icon fast flex h-8 w-6 shrink-0 touch-none items-center justify-center text-caption text-[var(--faint)]"
          style={reorder.arming ? { color: "var(--ink)" } : undefined}
        >
          ⠿
        </span>
      )}
    </button>
  );
}

// ── Primitives ───────────────────────────────────────────────────────────────
export function StatusDot({ status }: { status: ProjectStatus }) {
  return <Dot color={STATUS_COLOR[status]} shape="round" />;
}

/** Showing up this week: lit in the domain's hue, or a faint ring of absence. */
export function Lamp({ lit, color }: { lit: boolean; color: string }) {
  return <Dot color={lit ? color : "var(--line-2)"} shape="round" />;
}

/** A key result's track — the domain's hue on a hairline rail, `--track-h` thick. */
export function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="relative mt-2 overflow-hidden rounded-full" style={{ height: "var(--track-h, 3px)", background: "var(--line-1)" }}>
      <div
        className="fast absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
      />
    </div>
  );
}

/** Status as ONE line instead of five chips. Five always-on chips gave a filing
 *  field the visual weight of the work itself; a native `<select>` is one 44px
 *  row, opens iOS's own wheel, and reads its current value at a glance. */
export function StatusSelect({ value, onPick }: { value: ProjectStatus; onPick: (s: ProjectStatus) => void }) {
  return (
    <div className="ph-field flex items-center gap-2.5 !py-0">
      <Dot color={STATUS_COLOR[value]} shape="round" />
      <select
        value={value}
        onChange={(e) => onPick(e.target.value as ProjectStatus)}
        aria-label="Status"
        className="h-11 min-w-0 flex-1 appearance-none bg-transparent text-ink outline-none"
      >
        {STATUS.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={16} className="shrink-0 text-[var(--faint)]" />
    </div>
  );
}

// ── Sprint-centric placement — the deck's move, without the gesture ───────────
// The scales themselves now live in `record/PlacementBand.tsx` so the desktop
// record wears the SAME control (D-030 finally kept on both shells, one
// `sprintSpanFor` write). These two wrappers only pin the phone's register:
// `primary` weight for 44px targets, and the big native date fields behind
// "Exact dates" — on desktop the band is annotation beside the work, so it wears
// the quiet tone instead.

/** The phone plans six weeks out on the deck (MobileProjects), so the record's
 *  tap path reaches the same six — otherwise weeks 5 and 6 were drag-only. */
export const PHONE_WEEK_HORIZON = 6;

export function WeekField({ p, store }: { p: Project; store: Store }) {
  return (
    <WeekBand
      p={p}
      store={store}
      horizon={PHONE_WEEK_HORIZON}
      tone="primary"
      renderDates={(d) => <DateRow start={d.start} target={d.target} onStart={d.onStart} onTarget={d.onTarget} />}
    />
  );
}

export function QuarterField({ i, store }: { i: Initiative; store: Store }) {
  return (
    <QuarterBand
      i={i}
      store={store}
      tone="primary"
      renderDates={(d) => <DateRow start={d.start} target={d.target} onStart={d.onStart} onTarget={d.onTarget} />}
    />
  );
}

export function DateRow({
  start,
  target,
  onStart,
  onTarget,
}: {
  start: string | null;
  target: string | null;
  onStart: (v: string | null) => void;
  onTarget: (v: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <DateField label="Start" value={start} onCommit={onStart} />
      <DateField label="Target" value={target} onCommit={onTarget} />
    </div>
  );
}

export function DateField({ label, value, onCommit }: { label: string; value: string | null; onCommit: (v: string | null) => void }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="text-caption font-semibold text-muted">{label}</span>
      <input
        type="date"
        defaultValue={value ?? ""}
        onChange={(e) => onCommit(e.target.value || null)}
        className="ph-field"
      />
      {value && <span className="text-caption tabular-nums text-muted">{format(parseISO(value), "EEE, MMM d")}</span>}
    </label>
  );
}

export function TextField({
  value,
  onCommit,
  className = "",
  style,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <input
      // keyed on the value so a rename made elsewhere (the agent, another
      // surface) reaches an uncontrolled field that is not being typed in
      key={value}
      defaultValue={value}
      onBlur={(e) => {
        const next = e.target.value.trim();
        if (next && next !== value) onCommit(next);
      }}
      className={`w-full bg-transparent outline-none ${className}`}
      style={style}
    />
  );
}

export function AreaField({
  value,
  onCommit,
  placeholder,
  className = "",
  style,
  clampUntilFocus = false,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Sits as a single ellipsis-truncated line until focused, then grows to
   *  the full editable text on tap. Domain mandate only — a caption, not a
   *  second headline. */
  clampUntilFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const expanded = !clampUntilFocus || focused;

  return (
    <textarea
      key={value}
      defaultValue={value}
      placeholder={placeholder}
      rows={1}
      // grow with the text — a one-line box that hides the second line of an
      // outcome is why the outcome went unread
      ref={(el) => {
        if (!el) return;
        if (expanded) {
          el.style.height = "auto";
          el.style.height = `${el.scrollHeight}px`;
        } else {
          el.style.height = "";
        }
      }}
      onFocus={() => setFocused(true)}
      onInput={(e) => {
        const el = e.currentTarget;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      }}
      onBlur={(e) => {
        setFocused(false);
        const next = e.target.value.trim();
        if (next !== value) onCommit(next);
      }}
      className={`w-full resize-none bg-transparent leading-relaxed outline-none placeholder:text-[var(--faint)] ${expanded ? "" : "truncate"} ${className}`}
      style={style}
    />
  );
}

/** An editable number that sits INSIDE a sentence ("23.5h / 20h this week") —
 *  so it stays a 44px target and keeps a hairline to say it's editable, but it
 *  doesn't grow a filled box that outweighs the figure it qualifies. */
export function NumberField({ value, onCommit, accent }: { value: number; onCommit: (v: number) => void; accent?: string }) {
  return (
    <input
      key={value}
      type="number"
      inputMode="decimal"
      min={0}
      step={0.5}
      defaultValue={value}
      aria-label="Weekly target hours"
      onBlur={(e) => {
        const next = Number(e.target.value);
        if (!Number.isNaN(next) && next !== value) onCommit(next);
      }}
      className="ph-field tabular-nums"
      style={{ width: 64, paddingLeft: 8, paddingRight: 8, ...(accent ? { color: accent } : {}) }}
    />
  );
}

// ── The record's head — the desktop `Head`, at phone width ───────────────────
// One hero, named once (D-041). It used to be a bordered card holding the name
// AGAIN under the sheet's title row, which spent the top third of the screen
// saying the same words twice and left no room for the acts. Now: a crumb row
// that ROUTES (the domain picker is a control, not a label — desktop's call),
// the name in Fraunces, and the outcome as the lead line under it. No frame —
// the sheet is already the card.
export function RecordHead({
  name,
  onName,
  outcome,
  onOutcome,
  outcomePlaceholder,
  accent,
  center = false,
  flourish,
  shipped = false,
  sealSize = 22,
  stateTag,
  captionOutcome = false,
}: {
  name: string;
  onName: (v: string) => void;
  outcome: string;
  onOutcome: (v: string) => void;
  outcomePlaceholder: string;
  accent: string;
  /** A domain is ceremony, not a work item — its hero is centred, and its mandate
   *  reads as an inscription rather than a one-line outcome. */
  center?: boolean;
  /** An optional rule between the name and the mandate (the domain's Flourish). */
  flourish?: ReactNode;
  /** Finished — the same seal the desktop record's checkbox marks. Read-only here:
   *  the actual ship/reopen toggle lives in the screen's Status section below, so
   *  this isn't a second control, just parity with what desktop shows at rest. */
  shipped?: boolean;
  /** A bet outweighs a project (D-048's "scope reads as mass") — initiatives pass
   *  a bigger seal than the default project size. */
  sealSize?: number;
  /** A short presence tag (`stateOf().short`) shown as a quiet mark under the
   *  name. Domain hero only — the full sentence stays in the last-quarter
   *  panel below (say it once, D-087). */
  stateTag?: string;
  /** Demote the outcome from an inscription to a caption: single line until
   *  focused, small and muted. Domain mandate only — projects/initiatives
   *  keep today's one-line outcome unchanged. */
  captionOutcome?: boolean;
}) {
  return (
    <div className={`pb-1 ${center ? "text-center" : ""}`}>
      <div className={`flex items-start gap-2 ${center ? "justify-center" : ""}`}>
        {shipped && (
          <span className="mt-[5px]">
            <ShipStamp shipped size={sealSize} />
          </span>
        )}
        <TextField
          className={`ph-mast-title min-w-0 flex-1 ${center ? "text-center" : ""}`}
          value={name}
          onCommit={onName}
          style={{ caretColor: accent }}
        />
      </div>
      {stateTag && <div className="mt-1 text-caption font-medium text-muted">{stateTag}</div>}
      {flourish && <div className="my-2 flex justify-center">{flourish}</div>}
      <AreaField
        className={`mt-1 leading-snug ${captionOutcome ? "text-caption text-muted" : "text-head"}`}
        style={{
          color: captionOutcome ? undefined : "var(--ink-2)",
          caretColor: accent,
          ...(center ? { textAlign: "center" as const } : {}),
        }}
        value={outcome}
        placeholder={outcomePlaceholder}
        onCommit={onOutcome}
        clampUntilFocus={captionOutcome}
      />
    </div>
  );
}

/** The record's crumb row, hoisted OUT of the screen so the sheet's title row
 *  can wear it. That row already had to exist (Back, ✕, the drag handle) and was
 *  otherwise blank until you scrolled — one bar of pure chrome above a screen
 *  the user said was mostly chrome. Now it carries the routing at rest and the
 *  name once the hero scrolls past, and the record body starts at the name. */
export function RecordCrumbs({
  d,
  store,
  frame,
  onOpenInitiative,
}: {
  d: VerticalData;
  store: Store;
  frame: Frame;
  onOpenInitiative: (id: string) => void;
}) {
  const domains = [...d.domains].sort((a, b) => a.sort - b.sort);

  if (frame.level === "project") {
    const p = d.projects.find((x) => x.id === frame.id);
    if (!p) return null;
    const init = p.initiativeId ? d.initiatives.find((x) => x.id === p.initiativeId) : null;
    // An initiative lives in one domain (D-073's cascade rule) — same scoping
    // as the desktop record.
    const domainInitiatives = d.initiatives
      .filter((i) => i.domainId === p.domainId)
      .sort((a, b) => a.name.localeCompare(b.name));
    return (
      <>
        {/* Routing this to the right area is a primary act, not a crumb — the
            desktop record's call (RecordModal), kept here. */}
        <DomainPicker
          domains={domains}
          value={p.domainId}
          size="lg"
          onChange={(domainId) => {
            // An initiative lives in one domain — crossing domains detaches the
            // project rather than leaving it nested under the old bet.
            const crossDomain = Boolean(init && init.domainId !== domainId);
            store.updateProject(p.id, { domainId, ...(crossDomain ? { initiativeId: null, keyResultId: null } : {}) });
          }}
        />
        {(init || domainInitiatives.length > 0) && (
          <>
            <Icon name="chevron-right" size={12} className="shrink-0 text-[var(--faint)]" />
            <InitiativePicker
              initiatives={domainInitiatives}
              value={p.initiativeId}
              size="lg"
              onOpen={onOpenInitiative}
              onChange={(initiativeId) => store.updateProject(p.id, { initiativeId })}
            />
          </>
        )}
      </>
    );
  }

  if (frame.level === "initiative") {
    const i = d.initiatives.find((x) => x.id === frame.id);
    if (!i) return null;
    return (
      <DomainPicker
        domains={domains}
        value={i.domainId}
        size="lg"
        // Re-homing a bet takes its projects with it — the desktop cascade.
        onChange={(domainId) => {
          store.updateInitiative(i.id, { domainId });
          projectsOf(d, i.id).forEach((pr) => store.updateProject(pr.id, { domainId }));
        }}
      />
    );
  }

  if (frame.level === "domain") {
    const dom = d.domains.find((x) => x.id === frame.id);
    if (!dom) return null;
    return (
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-card)]"
        style={{ background: `color-mix(in srgb, ${dom.color} 14%, transparent)`, color: dom.color }}
      >
        <DomainSymbol value={dom.icon} size={16} />
      </span>
    );
  }
  return null;
}

/** The crumb that only navigates — a parent you can climb to, beside the picker
 *  that actually re-routes the record. */
export function ParentCrumb({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <>
      {/* font-normal: this can render inside the sheet's title row, which is
          semibold — a crumb is not a heading. */}
      <Icon name="chevron-right" size={12} className="shrink-0 text-[var(--faint)]" />
      <button type="button" onClick={onClick} className="tap min-w-0 truncate text-caption font-normal text-muted">
        {children}
      </button>
    </>
  );
}

/** A record's own rows (its key results, its projects) — hairlines edge to
 *  edge of the sheet, never a card holding a list. */
export function CardList({ children }: { children: ReactNode }) {
  return <div className="ph-rows">{children}</div>;
}

/** The desktop `Sec`, at phone width: a label, an optional right-hand meter,
 *  and the hairline rule that doubles as the section's progress. Same grammar
 *  on both shells, so "how far along" is read in the same place. */
export function Section({
  label,
  meter,
  fill,
  accent,
  children,
}: {
  label: string;
  meter?: string | null;
  /** 0–100, or omitted for a section with nothing to measure. */
  fill?: number | null;
  accent?: string;
  children: ReactNode;
}) {
  return (
    <div className="ph-sec">
      <div className="ph-sec-head !mb-0">
        <span className="flex-1">{label}</span>
        {meter && <span className="ph-sec-aside">{meter}</span>}
      </div>
      <div className="relative mb-2 mt-1.5 h-0.5 overflow-hidden rounded-full" style={{ background: "var(--line-1)" }}>
        {fill != null && (
          <div
            className="fast absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${Math.max(0, Math.min(100, fill))}%`, background: accent ?? "var(--accent)" }}
          />
        )}
      </div>
      {children}
    </div>
  );
}

export function Chip({ children, on, onClick }: { children: ReactNode; on?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={Boolean(on)} className="ph-chip">
      {children}
    </button>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <div className="py-2 text-body text-[var(--faint)]">{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="ph-empty">{children}</div>;
}

/** The row a VTask describes, for a list whose task isn't in the cache. */
function taskFromVTask(v: VTask): Task {
  const at = v.createdAt ?? new Date(0).toISOString();
  return {
    id: v.id,
    user_id: "",
    created_at: at,
    updated_at: at,
    title: v.title,
    notes: "",
    status: v.status === "done" ? "done" : v.inbox ? "inbox" : v.doDate ? "planned" : "backlog",
    do_date: v.doDate,
    start_time: v.startTime,
    duration_minutes: v.durationMins,
    deadline: null,
    priority: "none",
    roll_count: v.rollCount,
    completed_at: v.completedAt,
    trashed_at: null,
    project_id: v.projectId,
    initiative_id: v.initiativeId,
    domain_id: v.domainId,
    key_result_id: v.keyResultId,
    sprint_id: null,
    big_rock_id: v.bigRockId,
    energy: v.energy,
    assignee: v.assignee,
    prework: "",
    prework_at: null,
    suggestion: null,
    suggested_at: null,
    google_event_id: null,
    sort_order: 0,
    slot_id: v.slotId,
    parent_task_id: null,
    recurrence_id: null,
    recurrence_date: null,
    recurrence_overridden: false,
    task_labels: [],
  };
}
