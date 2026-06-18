// The mobile "Plan" screen — the strategic vertical (Domains › Initiatives ›
// Projects) the desktop floors own, browsed top-down as a drill-down stack so a
// thumb can reach the why behind the work. Viewing is rich (progress, the
// faithfulness pulse, key results); editing is deliberately light — the fields
// you actually retouch from a phone: name, outcome, status, momentum, dates,
// and a domain's standing vow / weekly target. Heavier authoring (key results,
// reparenting, deletion) stays on the desktop floors.
//
// No new data layer: every read is a pure selector over the live VerticalData
// snapshot and every write goes through the same useVertical() mutations the
// desktop uses, so edits made here ripple everywhere at once.

import { useState, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import {
  faithfulness,
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
} from "../../lib/vertical";

type Store = ReturnType<typeof useVertical>;

// One status vocabulary, shared with the desktop floors (parts.tsx).
const STATUS: ProjectStatus[] = ["backlog", "in_progress", "waiting", "cancelled", "complete"];
const STATUS_LABEL: Record<ProjectStatus, string> = {
  backlog: "Backlog",
  in_progress: "Active",
  waiting: "Waiting",
  cancelled: "Cancelled",
  complete: "Complete",
};
const STATUS_COLOR: Record<ProjectStatus, string> = {
  backlog: "var(--muted)",
  in_progress: "var(--accent)",
  waiting: "#D97706",
  cancelled: "var(--signal)",
  complete: "#0D9488",
};

const MOMENTUM: { value: Momentum; glyph: string; label: string }[] = [
  { value: "up", glyph: "↗", label: "Rising" },
  { value: "flat", glyph: "→", label: "Steady" },
  { value: "down", glyph: "↘", label: "Slipping" },
];

// ── The drill-down stack ─────────────────────────────────────────────────────
type Frame =
  | { level: "domains" }
  | { level: "domain"; id: string }
  | { level: "initiative"; id: string }
  | { level: "project"; id: string };

export default function MobilePlan() {
  const store = useVertical();
  const d = store.data;
  const [stack, setStack] = useState<Frame[]>([{ level: "domains" }]);
  const frame = stack[stack.length - 1];
  const push = (f: Frame) => setStack((s) => [...s, f]);
  const pop = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  // Title for the sticky header, read live so edits to a name show immediately.
  const title =
    frame.level === "domains"
      ? "Plan"
      : frame.level === "domain"
        ? d.domains.find((x) => x.id === frame.id)?.name ?? "Domain"
        : frame.level === "initiative"
          ? d.initiatives.find((x) => x.id === frame.id)?.name ?? "Initiative"
          : d.projects.find((x) => x.id === frame.id)?.name ?? "Project";

  return (
    <div className="pb-10">
      <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-line bg-surface/90 px-3 py-2 backdrop-blur">
        {stack.length > 1 ? (
          <button
            onClick={pop}
            className="tap fast -ml-1 flex items-center gap-0.5 rounded-lg px-2 text-head font-medium text-muted active:bg-surface-2"
          >
            ‹ Back
          </button>
        ) : (
          <span className="section-label !p-0 px-2">The vertical</span>
        )}
        <span className="ml-1 min-w-0 flex-1 truncate text-head font-semibold">{title}</span>
      </div>

      {/* key on the frame so inline edit fields reset when you change item */}
      {frame.level === "domains" ? (
        <DomainsScreen d={d} onOpen={(id) => push({ level: "domain", id })} />
      ) : frame.level === "domain" ? (
        <DomainScreen
          key={frame.id}
          d={d}
          store={store}
          id={frame.id}
          onOpenInitiative={(id) => push({ level: "initiative", id })}
          onOpenProject={(id) => push({ level: "project", id })}
        />
      ) : frame.level === "initiative" ? (
        <InitiativeScreen
          key={frame.id}
          d={d}
          store={store}
          id={frame.id}
          onOpenProject={(id) => push({ level: "project", id })}
        />
      ) : (
        <ProjectScreen key={frame.id} d={d} store={store} id={frame.id} />
      )}
    </div>
  );
}

// ── Domains list ─────────────────────────────────────────────────────────────
function DomainsScreen({ d, onOpen }: { d: VerticalData; onOpen: (id: string) => void }) {
  if (d.domains.length === 0) return <Empty>No domains yet. Add them on the desktop.</Empty>;
  return (
    <div>
      {d.domains.map((dom) => {
        const f = faithfulness(dom);
        const open = initiativesOf(d, dom.id).filter((i) => i.status !== "complete" && i.status !== "cancelled").length;
        return (
          <Row
            key={dom.id}
            onClick={() => onOpen(dom.id)}
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
function DomainScreen({
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
  const target = dom.weeklyTargetHours;

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

      {/* Faithfulness pulse — the 13-week read, view-only. */}
      <Section label="Faithfulness">
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <Pulse weeks={dom.weeks} color={dom.color} />
          <div className="mono mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted">
            <span style={{ color: dom.color }}>{dom.investedThisWeek.toFixed(1)}h this week</span>
            <span>{dom.quarterHours}h this quarter</span>
            <span>{dom.lastTouchedDays >= 99 ? "untouched" : `tended ${dom.lastTouchedDays}d ago`}</span>
          </div>
        </div>
      </Section>

      <Section label="Weekly target">
        <div className="flex items-center gap-2">
          <NumberField value={target} onCommit={(v) => store.updateDomain(dom.id, { weeklyTargetHours: v })} />
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
function InitiativeScreen({
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
  const i = d.initiatives.find((x) => x.id === id);
  if (!i) return <Empty>This initiative is gone.</Empty>;
  const dom = d.domains.find((x) => x.id === i.domainId);
  const accent = dom?.color ?? "var(--accent)";
  const projects = projectsOf(d, i.id);
  const looseTasks = looseTasksOfInitiative(d, i.id);
  const pct = initiativeProgress(d, i);

  return (
    <div className="px-4 pt-4">
      {dom && <Breadcrumb>{dom.icon} {dom.name}</Breadcrumb>}
      <Card accent={accent}>
        <TextField className="text-head font-semibold" value={i.name} onCommit={(v) => store.updateInitiative(i.id, { name: v })} />
        <AreaField
          className="mt-1.5 text-body text-ink/90"
          value={i.outcome}
          placeholder="The goal — what 'done' looks like in one line…"
          onCommit={(v) => store.updateInitiative(i.id, { outcome: v })}
        />
        <ProgressBar pct={pct} color={accent} />
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

      <Section label="Timeline">
        <DateRow
          start={i.startDate}
          target={i.targetDate}
          onStart={(v) => store.updateInitiative(i.id, { startDate: v })}
          onTarget={(v) => store.updateInitiative(i.id, { targetDate: v })}
        />
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
function ProjectScreen({ d, store, id }: { d: VerticalData; store: Store; id: string }) {
  const p = d.projects.find((x) => x.id === id);
  if (!p) return <Empty>This project is gone.</Empty>;
  const dom = d.domains.find((x) => x.id === p.domainId);
  const init = p.initiativeId ? d.initiatives.find((x) => x.id === p.initiativeId) : null;
  const accent = dom?.color ?? "var(--accent)";
  const tasks = tasksOf(d, p.id);
  const pct = projectProgress(d, p);
  const doneCount = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="px-4 pt-4">
      <Breadcrumb>
        {dom ? `${dom.icon} ${dom.name}` : ""}
        {init ? ` › ${init.name}` : ""}
      </Breadcrumb>
      <Card accent={accent}>
        <TextField className="text-head font-semibold" value={p.name} onCommit={(v) => store.updateProject(p.id, { name: v })} />
        <AreaField
          className="mt-1.5 text-body text-ink/90"
          value={p.outcome}
          placeholder="The goal in one line…"
          onCommit={(v) => store.updateProject(p.id, { outcome: v })}
        />
        <ProgressBar pct={pct} color={accent} />
      </Card>

      <Section label="Status">
        <StatusChips value={p.status} onPick={(s) => store.updateProject(p.id, { status: s })} />
      </Section>

      <Section label="Timeline">
        <DateRow
          start={p.startDate}
          target={p.targetDate}
          onStart={(v) => store.updateProject(p.id, { startDate: v })}
          onTarget={(v) => store.updateProject(p.id, { targetDate: v })}
        />
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

// ── Rows ─────────────────────────────────────────────────────────────────────
function InitiativeRow({ d, i, onClick }: { d: VerticalData; i: Initiative; onClick: () => void }) {
  const pct = initiativeProgress(d, i);
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
          <span>{pct}%</span>
        </span>
      }
    />
  );
}

function ProjectRow({ d, p, onClick }: { d: VerticalData; p: Project; onClick: () => void }) {
  const pct = projectProgress(d, p);
  return (
    <Row
      onClick={onClick}
      chevron
      leading={<StatusDot status={p.status} />}
      title={p.name}
      subtitle={p.outcome || undefined}
      meta={<span className="mono shrink-0 text-caption text-muted">{pct}%</span>}
    />
  );
}

function TaskRow({ t, onToggle }: { t: VTask; onToggle: () => void }) {
  const done = t.status === "done";
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <button
        onClick={onToggle}
        aria-label={done ? "Reopen" : "Mark done"}
        className={`tap fast flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-caption ${
          done ? "border-accent bg-accent text-white" : "border-line-strong text-transparent active:border-accent"
        }`}
      >
        ✓
      </button>
      <span className={`min-w-0 flex-1 truncate text-body ${done ? "text-muted line-through" : ""}`}>{t.title}</span>
      {t.durationMins ? <span className="mono shrink-0 text-meta text-muted">{t.durationMins}m</span> : null}
    </div>
  );
}

function Row({
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
function StatusDot({ status }: { status: ProjectStatus }) {
  return <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[status] }} />;
}

function Lamp({ lit, color }: { lit: boolean; color: string }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={lit ? { background: color, boxShadow: `0 0 6px ${color}` } : { background: "var(--line-strong)", opacity: 0.5 }}
    />
  );
}

function Pulse({ weeks, color }: { weeks: number[]; color: string }) {
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

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="relative mt-2 h-1.5 rounded-full" style={{ background: "var(--line)" }}>
      <div
        className="fast absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
      />
    </div>
  );
}

function StatusChips({ value, onPick }: { value: ProjectStatus; onPick: (s: ProjectStatus) => void }) {
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

function DateRow({
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

function DateField({ label, value, onCommit }: { label: string; value: string | null; onCommit: (v: string | null) => void }) {
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

function TextField({ value, onCommit, className = "" }: { value: string; onCommit: (v: string) => void; className?: string }) {
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

function AreaField({
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

function NumberField({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
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

function Card({ children, accent }: { children: ReactNode; accent?: string }) {
  return (
    <div
      className="rounded-xl border border-line bg-surface-2 p-3"
      style={accent ? { boxShadow: `inset 3px 0 0 0 ${accent}` } : undefined}
    >
      {children}
    </div>
  );
}

function CardList({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-2">{children}</div>;
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-5">
      <div className="section-label mb-1.5 !p-0">{label}</div>
      {children}
    </div>
  );
}

function Chip({ children, on, onClick }: { children: ReactNode; on?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`tap fast rounded-full border px-3.5 py-2 text-body font-medium ${
        on ? "border-accent bg-accent text-white" : "border-line text-muted active:border-accent active:text-accent"
      }`}
    >
      {children}
    </button>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-caption text-muted">{children}</div>;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-16 text-center text-body text-muted">{children}</div>;
}

function Breadcrumb({ children }: { children: ReactNode }) {
  return <div className="mono mb-2 truncate text-caption text-muted">{children}</div>;
}
