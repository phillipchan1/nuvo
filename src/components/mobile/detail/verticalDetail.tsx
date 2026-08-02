// The strategic-vertical detail stack — the rich, light-editing screens for a
// single Domain / Initiative / Project, plus the flat browse list and all the
// shared primitives they're built from. Extracted from the old MobilePlan so the
// Projects and Initiatives tabs (and global search) can open the SAME detail
// through one bottom Sheet.
//
// Viewing is rich (progress, the 13-week faithfulness pulse, key results);
// editing stays light — name, outcome, status, momentum, dates, and a domain's
// vow + weekly target. No new data layer: every read is a pure selector over the
// live VerticalData snapshot, every write goes through useVertical()'s mutations.

import { useState, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { useVertical } from "../../../hooks/useVertical";
import { ProjectShipAssess } from "../../record/ShipAssess";
import { QuarterBand, WeekBand } from "../../record/PlacementBand";
import {
  domainById,
  faithfulness,
  initiativeById,
  initiativeProgress,
  initiativesOf,
  looseProjectsOf,
  looseTasksOfDomain,
  looseTasksOfInitiative,
  projectProgress,
  projectsOf,
  tasksOf,
  type Initiative,
  type Momentum,
  type Project,
  type ProjectStatus,
  type VTask,
  type VerticalData,
} from "../../../lib/vertical";
import { ripenessOfInitiative, ripenessOfProject, verdictOf } from "../../../lib/tending";
import { RipenessPip } from "../../floors/parts";

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
}: {
  d: VerticalData;
  lens: Lens;
  onOpenProject: (id: string) => void;
  onOpenInitiative: (id: string) => void;
  onOpenDomain: (id: string) => void;
}) {
  if (lens === "projects") {
    const projects = [...d.projects].sort(
      (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name),
    );
    if (projects.length === 0) return <Empty>No projects yet.</Empty>;
    return (
      <div>
        {projects.map((p) => (
          <Row
            key={p.id}
            onClick={() => onOpenProject(p.id)}
            chevron
            leading={<StatusDot status={p.status} />}
            title={p.name}
            subtitle={projectContext(d, p)}
            meta={
              <span className="mono flex shrink-0 items-center gap-1.5 text-caption text-muted">
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
    if (inits.length === 0) return <Empty>No initiatives yet.</Empty>;
    return (
      <div>
        {inits.map((i) => {
          const mom = MOMENTUM.find((m) => m.value === i.momentum);
          return (
            <Row
              key={i.id}
              onClick={() => onOpenInitiative(i.id)}
              chevron
              leading={<StatusDot status={i.status} />}
              title={i.name}
              subtitle={domainById(d, i.domainId)?.name ?? undefined}
              meta={
                <span className="mono flex shrink-0 items-center gap-1.5 text-caption text-muted">
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

  if (d.domains.length === 0) return <Empty>No domains yet.</Empty>;
  return (
    <div>
      {d.domains.map((dom) => {
        const f = faithfulness(dom);
        const open = initiativesOf(d, dom.id).filter((i) => i.status !== "complete" && i.status !== "cancelled").length;
        return (
          <Row
            key={dom.id}
            onClick={() => onOpenDomain(dom.id)}
            chevron
            leading={
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-head"
                style={{ background: `color-mix(in srgb, ${dom.color} 16%, var(--surface))`, color: dom.color }}
              >
                {dom.icon}
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

// ── A single domain ──────────────────────────────────────────────────────────
export function DomainScreen({
  d,
  store,
  id,
  onOpenInitiative,
  onOpenProject,
}: {
  d: VerticalData;
  store: Store;
  id: string;
  onOpenInitiative: (id: string) => void;
  onOpenProject: (id: string) => void;
}) {
  const dom = d.domains.find((x) => x.id === id);
  if (!dom) return <Empty>This domain is gone.</Empty>;
  const inits = initiativesOf(d, dom.id);
  const loose = looseProjectsOf(d, dom.id);
  const looseTasks = looseTasksOfDomain(d, dom.id);

  return (
    <div className="px-4 pt-4" style={{ ["--accent" as string]: dom.color }}>
      <Card accent={dom.color}>
        <div className="flex items-center gap-2">
          <span className="text-lead" style={{ color: dom.color }}>{dom.icon}</span>
          <TextField className="text-head font-semibold" value={dom.name} onCommit={(v) => store.updateDomain(dom.id, { name: v })} />
        </div>
        <AreaField
          className="mt-2 text-body text-ink/90"
          value={dom.intention}
          placeholder="The standing vow — what faithfulness here means…"
          onCommit={(v) => store.updateDomain(dom.id, { intention: v })}
        />
      </Card>

      <Section label="Faithfulness">
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <Pulse weeks={dom.weeks} color={dom.color} />
          <div className="mono mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted">
            <span style={{ color: dom.color }}>{dom.investedThisWeek.toFixed(1)}h this week</span>
            <span>{dom.quarterHours}h this quarter</span>
            <span>{dom.lastTouchedDays >= 99 ? "untouched" : `groomed ${dom.lastTouchedDays}d ago`}</span>
          </div>
        </div>
      </Section>

      <Section label="Weekly target">
        <div className="flex items-center gap-2">
          <NumberField value={dom.weeklyTargetHours} onCommit={(v) => store.updateDomain(dom.id, { weeklyTargetHours: v })} />
          <span className="text-body text-muted">hours / week</span>
        </div>
      </Section>

      <Section label={`Initiatives · ${inits.length}`}>
        {inits.length === 0 ? (
          <Hint>No initiatives in this domain.</Hint>
        ) : (
          <CardList>
            {inits.map((i) => (
              <InitiativeRow key={i.id} d={d} i={i} onClick={() => onOpenInitiative(i.id)} />
            ))}
          </CardList>
        )}
      </Section>

      {loose.length > 0 && (
        <Section label={`Projects (no initiative) · ${loose.length}`}>
          <CardList>
            {loose.map((p) => (
              <ProjectRow key={p.id} d={d} p={p} onClick={() => onOpenProject(p.id)} />
            ))}
          </CardList>
        </Section>
      )}

      {looseTasks.length > 0 && (
        <Section label={`Parked here · ${looseTasks.length}`}>
          <CardList>
            {looseTasks.map((t) => (
              <TaskRow key={t.id} t={t} onToggle={() => store.toggleTask(t.id)} />
            ))}
          </CardList>
        </Section>
      )}
    </div>
  );
}

// ── A single initiative ──────────────────────────────────────────────────────
export function InitiativeScreen({
  d,
  store,
  id,
  onOpenProject,
  onOpenDomain,
}: {
  d: VerticalData;
  store: Store;
  id: string;
  onOpenProject: (id: string) => void;
  onOpenDomain: (id: string) => void;
}) {
  const i = d.initiatives.find((x) => x.id === id);
  if (!i) return <Empty>This initiative is gone.</Empty>;
  const dom = d.domains.find((x) => x.id === i.domainId);
  const accent = dom?.color ?? "var(--accent)";
  const projects = projectsOf(d, i.id);
  const looseTasks = looseTasksOfInitiative(d, i.id);

  return (
    <div className="px-4 pt-4">
      {dom && (
        <Breadcrumb>
          <Crumb onClick={() => onOpenDomain(dom.id)}>{dom.icon} {dom.name}</Crumb>
        </Breadcrumb>
      )}
      <Card accent={accent}>
        <TextField className="text-head font-semibold" value={i.name} onCommit={(v) => store.updateInitiative(i.id, { name: v })} />
        <AreaField
          className="mt-1.5 text-body text-ink/90"
          value={i.outcome}
          placeholder="The goal — what 'done' looks like in one line…"
          onCommit={(v) => store.updateInitiative(i.id, { outcome: v })}
        />
        <ProgressBar pct={initiativeProgress(d, i)} color={accent} />
      </Card>

      <Section label="Status">
        <StatusChips value={i.status} onPick={(s) => store.updateInitiative(i.id, { status: s })} />
      </Section>

      <Section label="Momentum">
        <div className="flex flex-wrap gap-1.5">
          {MOMENTUM.map((m) => (
            <Chip key={m.value} on={i.momentum === m.value} onClick={() => store.updateInitiative(i.id, { momentum: m.value })}>
              <span className="mono mr-1">{m.glyph}</span>
              {m.label}
            </Chip>
          ))}
        </div>
      </Section>

      {/* A bet's "when" is a QUARTER — and its runway is counted in weeks, the
          unit you actually spend. */}
      <Section label="Quarter">
        <QuarterField i={i} store={store} />
      </Section>

      {i.keyResults.length > 0 && (
        <Section label="Key results">
          <CardList>
            {i.keyResults.map((kr) => {
              const span = kr.target - kr.baseline;
              const krPct = span === 0 ? 0 : Math.round(((kr.current - kr.baseline) / span) * 100);
              return (
                <div key={kr.id} className="px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-body font-medium">{kr.name}</span>
                    <span className="mono shrink-0 text-caption text-muted">
                      {kr.current}/{kr.target} {kr.unit}
                    </span>
                  </div>
                  <ProgressBar pct={krPct} color={accent} />
                </div>
              );
            })}
          </CardList>
        </Section>
      )}

      <Section label={`Projects · ${projects.length}`}>
        {projects.length === 0 ? (
          <Hint>No projects under this initiative.</Hint>
        ) : (
          <CardList>
            {projects.map((p) => (
              <ProjectRow key={p.id} d={d} p={p} onClick={() => onOpenProject(p.id)} />
            ))}
          </CardList>
        )}
      </Section>

      {looseTasks.length > 0 && (
        <Section label={`Loose tasks · ${looseTasks.length}`}>
          <CardList>
            {looseTasks.map((t) => (
              <TaskRow key={t.id} t={t} onToggle={() => store.toggleTask(t.id)} />
            ))}
          </CardList>
        </Section>
      )}
    </div>
  );
}

// ── A single project ─────────────────────────────────────────────────────────
export function ProjectScreen({
  d,
  store,
  id,
  onOpenInitiative,
  onOpenDomain,
}: {
  d: VerticalData;
  store: Store;
  id: string;
  onOpenInitiative: (id: string) => void;
  onOpenDomain: (id: string) => void;
}) {
  const [shipping, setShipping] = useState(false);
  const p = d.projects.find((x) => x.id === id);
  if (!p) return <Empty>This project is gone.</Empty>;
  const dom = d.domains.find((x) => x.id === p.domainId);
  const init = p.initiativeId ? d.initiatives.find((x) => x.id === p.initiativeId) : null;
  const accent = dom?.color ?? "var(--accent)";
  const tasks = tasksOf(d, p.id);
  const doneCount = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="px-4 pt-4">
      {(dom || init) && (
        <Breadcrumb>
          {dom && <Crumb onClick={() => onOpenDomain(dom.id)}>{dom.icon} {dom.name}</Crumb>}
          {init && (
            <>
              <span className="text-muted/60">›</span>
              <Crumb onClick={() => onOpenInitiative(init.id)}>{init.name}</Crumb>
            </>
          )}
        </Breadcrumb>
      )}
      <Card accent={accent}>
        <TextField className="text-head font-semibold" value={p.name} onCommit={(v) => store.updateProject(p.id, { name: v })} />
        <AreaField
          className="mt-1.5 text-body text-ink/90"
          value={p.outcome}
          placeholder="The goal in one line…"
          onCommit={(v) => store.updateProject(p.id, { outcome: v })}
        />
        <ProgressBar pct={projectProgress(d, p)} color={accent} />
      </Card>

      {/* Shipping asks first on the phone too — same moment, same rule: it closes
          the open tasks, and you say whether they were done or dropped. */}
      <Section label="Status">
        <StatusChips value={p.status} onPick={(s) => (s === "complete" ? setShipping(true) : store.updateProject(p.id, { status: s }))} />
      </Section>
      {shipping && <ProjectShipAssess id={p.id} onClose={() => setShipping(false)} />}

      {/* A project's "when" is a WEEK, not two dates — the same commitment the
          deck makes when you drop it on a column. Exact dates stay one tap away. */}
      <Section label="Week">
        <WeekField p={p} store={store} />
      </Section>

      <Section label={tasks.length ? `Tasks · ${doneCount}/${tasks.length} done` : "Tasks"}>
        {tasks.length === 0 ? (
          <Hint>No tasks yet. Capture them with ＋ or scaffold on the desktop.</Hint>
        ) : (
          <CardList>
            {tasks.map((t) => (
              <TaskRow key={t.id} t={t} onToggle={() => store.toggleTask(t.id)} />
            ))}
          </CardList>
        )}
      </Section>
    </div>
  );
}

// ── Context line for the flat project list (where it lives) ───────────────────
export function projectContext(d: VerticalData, p: Project): string {
  const dom = domainById(d, p.domainId);
  const init = p.initiativeId ? initiativeById(d, p.initiativeId) : null;
  const head = dom ? `${dom.icon} ${dom.name}` : "—";
  return init ? `${head} · ${init.name}` : head;
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
        <span className="mono flex shrink-0 items-center gap-1.5 text-caption text-muted">
          <span>{mom?.glyph}</span>
          <span>{initiativeProgress(d, i)}%</span>
        </span>
      }
    />
  );
}

export function ProjectRow({ d, p, onClick }: { d: VerticalData; p: Project; onClick: () => void }) {
  return (
    <Row
      onClick={onClick}
      chevron
      leading={<StatusDot status={p.status} />}
      title={p.name}
      subtitle={p.outcome || undefined}
      meta={<span className="mono shrink-0 text-caption text-muted">{projectProgress(d, p)}%</span>}
    />
  );
}

export function TaskRow({ t, onToggle }: { t: VTask; onToggle: () => void }) {
  const done = t.status === "done";
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <button
        onClick={onToggle}
        aria-label={done ? "Reopen" : "Mark done"}
        className={`tap fast flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-caption ${
          // border-muted, not border-line-strong: 3.7:1 vs 1.37:1 on the paper,
          // and a control the finger aims at has to be visible. See D-054a.
          done ? "border-accent bg-accent text-on-accent" : "border-muted text-transparent active:border-accent"
        }`}
      >
        ✓
      </button>
      <span className={`min-w-0 flex-1 truncate text-body ${done ? "text-muted line-through" : ""}`}>{t.title}</span>
      {t.durationMins ? <span className="mono shrink-0 text-meta text-muted">{t.durationMins}m</span> : null}
    </div>
  );
}

export function Row({
  leading,
  title,
  subtitle,
  meta,
  onClick,
  chevron,
}: {
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="tap fast flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 active:bg-surface-2"
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-head font-medium">{title}</div>
        {subtitle && <div className="truncate text-caption text-muted">{subtitle}</div>}
      </div>
      {meta}
      {chevron && <span className="shrink-0 text-muted">›</span>}
    </button>
  );
}

// ── Primitives ───────────────────────────────────────────────────────────────
export function StatusDot({ status }: { status: ProjectStatus }) {
  return <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[status] }} />;
}

export function Lamp({ lit, color }: { lit: boolean; color: string }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={lit ? { background: color, boxShadow: `0 0 6px ${color}` } : { background: "var(--line-strong)", opacity: 0.5 }}
    />
  );
}

export function Pulse({ weeks, color }: { weeks: number[]; color: string }) {
  const max = Math.max(0.5, ...weeks);
  return (
    <div className="flex h-7 items-end gap-0.5">
      {weeks.map((w, idx) => (
        <div
          key={idx}
          className="flex-1 rounded-sm"
          style={{
            height: Math.max(2, (w / max) * 28),
            background: idx === weeks.length - 1 ? color : `color-mix(in srgb, ${color} 40%, transparent)`,
          }}
        />
      ))}
    </div>
  );
}

export function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="relative mt-2 h-1.5 rounded-full" style={{ background: "var(--line)" }}>
      <div
        className="fast absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
      />
    </div>
  );
}

export function StatusChips({ value, onPick }: { value: ProjectStatus; onPick: (s: ProjectStatus) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {STATUS.map((s) => (
        <Chip key={s} on={value === s} onClick={() => onPick(s)}>
          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: STATUS_COLOR[s] }} />
          {STATUS_LABEL[s]}
        </Chip>
      ))}
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

export function WeekField({ p, store }: { p: Project; store: Store }) {
  return (
    <WeekBand
      p={p}
      store={store}
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
    <label className="flex flex-1 flex-col gap-1">
      <span className="section-label !p-0">{label}</span>
      <input
        type="date"
        defaultValue={value ?? ""}
        onChange={(e) => onCommit(e.target.value || null)}
        className="mono tap rounded-lg border border-line bg-surface px-2.5 py-2 text-head outline-none focus:border-accent"
      />
      {value && <span className="mono text-meta text-muted">{format(parseISO(value), "EEE, MMM d")}</span>}
    </label>
  );
}

export function TextField({ value, onCommit, className = "" }: { value: string; onCommit: (v: string) => void; className?: string }) {
  return (
    <input
      defaultValue={value}
      onBlur={(e) => {
        const next = e.target.value.trim();
        if (next && next !== value) onCommit(next);
      }}
      className={`w-full bg-transparent outline-none ${className}`}
    />
  );
}

export function AreaField({
  value,
  onCommit,
  placeholder,
  className = "",
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <textarea
      defaultValue={value}
      placeholder={placeholder}
      rows={1}
      onBlur={(e) => {
        const next = e.target.value.trim();
        if (next !== value) onCommit(next);
      }}
      className={`w-full resize-none bg-transparent leading-relaxed outline-none placeholder:text-muted/60 ${className}`}
    />
  );
}

export function NumberField({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  return (
    <input
      type="number"
      min={0}
      step={0.5}
      defaultValue={value}
      onBlur={(e) => {
        const next = Number(e.target.value);
        if (!Number.isNaN(next) && next !== value) onCommit(next);
      }}
      className="mono tap w-20 rounded-lg border border-line bg-surface px-2.5 py-2 text-head outline-none focus:border-accent"
    />
  );
}

export function Card({ children, accent }: { children: ReactNode; accent?: string }) {
  return (
    <div
      className="rounded-xl border border-line bg-surface-2 p-3"
      style={accent ? { boxShadow: `inset 3px 0 0 0 ${accent}` } : undefined}
    >
      {children}
    </div>
  );
}

export function CardList({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-2">{children}</div>;
}

export function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-5">
      <div className="section-label mb-1.5 !p-0">{label}</div>
      {children}
    </div>
  );
}

export function Chip({ children, on, onClick }: { children: ReactNode; on?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`tap fast rounded-full border px-3.5 py-2 text-body font-medium ${
        on ? "border-accent bg-accent text-on-accent" : "border-line text-muted active:border-accent active:text-accent"
      }`}
    >
      {children}
    </button>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-caption text-muted">{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-16 text-center text-body text-muted">{children}</div>;
}

export function Breadcrumb({ children }: { children: ReactNode }) {
  return <div className="mono mb-2 flex flex-wrap items-center gap-1.5 text-caption text-muted">{children}</div>;
}

// A tappable breadcrumb segment — climb up the hierarchy on demand.
export function Crumb({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="tap fast -my-1 truncate py-1 active:text-accent">
      {children}
    </button>
  );
}
