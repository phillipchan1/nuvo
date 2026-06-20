// The mobile "Plan" screen — the strategic vertical (Domains · Initiatives ·
// Projects) the desktop floors own. Reachable two ways, both fast:
//   • a flat, segmented list (Projects / Initiatives / Domains) so you tap
//     straight to any one item — no forced walk down the hierarchy, and
//   • a `target` jumped in from global search, which opens a detail directly.
// The hierarchy isn't gone — it lives in each detail as TAPPABLE breadcrumbs
// (Domain › Initiative) so you can climb up when you actually want to.
//
// Viewing is rich (progress, the 13-week faithfulness pulse, key results);
// editing stays light — name, outcome, status, momentum, dates, and a domain's
// vow + weekly target. No new data layer: every read is a pure selector over the
// live VerticalData snapshot, every write goes through useVertical()'s mutations.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { addDays, format, parseISO, startOfWeek } from "date-fns";
import { toDateISO } from "../../lib/dates";
import { useVertical } from "../../hooks/useVertical";
import { useWeekReport } from "../../hooks/useWeekReport";
import { WeekPlanBody } from "../floors/WeekPlanFloor";
import WeekEmblem from "../floors/WeekEmblem";
import Sheet from "./Sheet";
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
} from "../../lib/vertical";
import { RIPENESS_ADVANCE, readTending, ripenessOfInitiative, ripenessOfProject, verdictOf } from "../../lib/tending";
import { readinessOfInitiativeFloor, readinessOfProjectFloor, type FloorCue } from "../../lib/readiness";
import { RipenessPip } from "../floors/parts";
import { ReadinessBanner } from "../floors/ReadinessBanner";

type Store = ReturnType<typeof useVertical>;

/** A jump requested from global search — open this detail directly. `n` is a
 *  nonce so repeated jumps to the same id re-fire the effect. */
export type PlanTarget = { kind: "domain" | "initiative" | "project"; id: string; n: number };

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
// Active work floats to the top of the flat lists; finished/abandoned sinks.
const STATUS_RANK: Record<ProjectStatus, number> = {
  in_progress: 0,
  waiting: 1,
  backlog: 2,
  complete: 3,
  cancelled: 4,
};

const MOMENTUM: { value: Momentum; glyph: string; label: string }[] = [
  { value: "up", glyph: "↗", label: "Rising" },
  { value: "flat", glyph: "→", label: "Steady" },
  { value: "down", glyph: "↘", label: "Slipping" },
];

type Lens = "projects" | "initiatives" | "domains";
const LENS_KEY = "nuvo-mobile-plan-lens";
const LENSES: { id: Lens; label: string }[] = [
  { id: "projects", label: "Projects" },
  { id: "initiatives", label: "Initiatives" },
  { id: "domains", label: "Domains" },
];
function readLens(): Lens {
  try {
    const v = localStorage.getItem(LENS_KEY) as Lens | null;
    if (v && LENSES.some((l) => l.id === v)) return v;
  } catch {
    /* ignore */
  }
  return "projects";
}

// ── The navigation stack: a flat list at the base, details pushed on top ──────
type Frame =
  | { level: "list" }
  | { level: "domain"; id: string }
  | { level: "initiative"; id: string }
  | { level: "project"; id: string };

const frameFor = (t: PlanTarget): Frame => ({ level: t.kind, id: t.id });

export default function MobilePlan({ target, onRefine }: { target?: PlanTarget | null; onRefine?: () => void }) {
  const store = useVertical();
  const d = store.data;
  const [lens, setLensState] = useState<Lens>(readLens);
  const setLens = (l: Lens) => {
    setLensState(l);
    try {
      localStorage.setItem(LENS_KEY, l);
    } catch {
      /* ignore */
    }
  };

  const [stack, setStack] = useState<Frame[]>(() => (target ? [{ level: "list" }, frameFor(target)] : [{ level: "list" }]));
  // A search jump while the tab is already mounted: open that detail.
  useEffect(() => {
    if (target) setStack([{ level: "list" }, frameFor(target)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.n]);

  const frame = stack[stack.length - 1];
  const push = (f: Frame) => setStack((s) => [...s, f]);
  const pop = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  const detailTitle =
    frame.level === "domain"
      ? d.domains.find((x) => x.id === frame.id)?.name ?? "Domain"
      : frame.level === "initiative"
        ? d.initiatives.find((x) => x.id === frame.id)?.name ?? "Initiative"
        : frame.level === "project"
          ? d.projects.find((x) => x.id === frame.id)?.name ?? "Project"
          : "";

  const openDomain = (id: string) => push({ level: "domain", id });
  const openInitiative = (id: string) => push({ level: "initiative", id });
  const openProject = (id: string) => push({ level: "project", id });

  return (
    <div className="pb-24">
      {/* Sticky header: the lens switch at the base, Back + title in a detail. */}
      <div className="sticky top-0 z-10 border-b border-line bg-surface/90 px-3 py-2 backdrop-blur">
        {frame.level === "list" ? (
          <div className="flex gap-1">
            {LENSES.map((l) => {
              const on = lens === l.id;
              const count =
                l.id === "projects" ? d.projects.length : l.id === "initiatives" ? d.initiatives.length : d.domains.length;
              return (
                <button
                  key={l.id}
                  onClick={() => setLens(l.id)}
                  className={`tap fast flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-body font-medium ${
                    on ? "bg-accent text-white" : "text-muted active:bg-surface-2"
                  }`}
                >
                  {l.label}
                  {count > 0 && (
                    <span
                      className="mono rounded-full px-1 text-micro font-semibold leading-[14px]"
                      style={{
                        minWidth: 14,
                        height: 14,
                        background: on ? "rgba(255,255,255,0.25)" : "var(--line-strong)",
                        color: on ? "#fff" : "var(--surface)",
                      }}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={pop}
              className="tap fast -ml-1 flex items-center gap-0.5 rounded-lg px-2 text-head font-medium text-muted active:bg-surface-2"
            >
              ‹ Back
            </button>
            <span className="ml-1 min-w-0 flex-1 truncate text-head font-semibold">{detailTitle}</span>
          </div>
        )}
      </div>

      {frame.level === "list" && <WeekPlanCard />}

      {frame.level === "list" && (
        <PlanReadiness d={d} onRefine={onRefine} onOpen={(k, id) => (k === "project" ? openProject(id) : openInitiative(id))} />
      )}

      {frame.level === "list" ? (
        <ListScreen
          d={d}
          lens={lens}
          onOpenProject={openProject}
          onOpenInitiative={openInitiative}
          onOpenDomain={openDomain}
        />
      ) : frame.level === "domain" ? (
        <DomainScreen
          key={frame.id}
          d={d}
          store={store}
          id={frame.id}
          onOpenInitiative={openInitiative}
          onOpenProject={openProject}
        />
      ) : frame.level === "initiative" ? (
        <InitiativeScreen
          key={frame.id}
          d={d}
          store={store}
          id={frame.id}
          onOpenProject={openProject}
          onOpenDomain={openDomain}
        />
      ) : (
        <ProjectScreen
          key={frame.id}
          d={d}
          store={store}
          id={frame.id}
          onOpenInitiative={openInitiative}
          onOpenDomain={openDomain}
        />
      )}
    </div>
  );
}

// ── The Week's Plan / Review — the weekly narrated companion (mobile home) ────
// A "This week" hero atop the Plan tab; tap to open the full surface in a Sheet,
// where you can walk ‹ › back to sealed Reviews of past weeks.
function weekLabelOf(weekISO: string): string {
  const s = new Date(weekISO + "T00:00:00");
  const e = addDays(s, 6);
  return `${format(s, "MMM d")} – ${format(e, s.getMonth() === e.getMonth() ? "d" : "MMM d")}`;
}

function WeekPlanCard() {
  const now = useMemo(() => new Date(), []);
  const currentWeekISO = useMemo(() => toDateISO(startOfWeek(now, { weekStartsOn: 1 })), [now]);
  const report = useWeekReport(currentWeekISO, now);
  const [open, setOpen] = useState(false);
  const total = report.priorityTotal;

  return (
    <div className="px-4 pt-4">
      <button
        onClick={() => setOpen(true)}
        className="tap fast flex w-full items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-3 text-left active:bg-surface"
      >
        <WeekEmblem spec={report.emblem} state="forming" size={48} hideAmbient />
        <div className="min-w-0 flex-1">
          <div className="section-label !p-0">This week</div>
          <div className="truncate text-head font-semibold text-ink">{weekLabelOf(currentWeekISO)}</div>
          <div className="truncate text-caption text-muted">
            {total > 0 ? `${report.landedCount} of ${total} priorities landed` : "Set what matters most"}
          </div>
        </div>
        <span className="shrink-0 text-muted">›</span>
      </button>

      {open && <WeekPlanSheet currentWeekISO={currentWeekISO} now={now} onClose={() => setOpen(false)} />}
    </div>
  );
}

function WeekPlanSheet({ currentWeekISO, now, onClose }: { currentWeekISO: string; now: Date; onClose: () => void }) {
  const [viewedWeekISO, setViewedWeekISO] = useState(currentWeekISO);
  const report = useWeekReport(viewedWeekISO, now);
  const isCurrent = viewedWeekISO === currentWeekISO;
  const walk = (deltaDays: number) =>
    setViewedWeekISO((iso) => {
      const next = toDateISO(addDays(new Date(iso + "T00:00:00"), deltaDays));
      return next > currentWeekISO ? currentWeekISO : next;
    });

  const header = (
    <div className="mb-5 flex items-center gap-2">
      <button onClick={() => walk(-7)} className="tap fast flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-surface-2" aria-label="Previous week">‹</button>
      <button onClick={isCurrent ? undefined : () => walk(7)} disabled={isCurrent} className="tap fast flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-surface-2 disabled:opacity-30" aria-label="Next week">›</button>
      <div className="min-w-0 flex-1 text-center">
        <div className="section-label !p-0">{isCurrent ? "This week" : "The Review"}</div>
        <div className="masthead text-head text-ink">{weekLabelOf(viewedWeekISO)}</div>
      </div>
      <span className="h-8 w-8" />
    </div>
  );

  return (
    <Sheet onClose={onClose} tall>
      <div className="px-4 pb-8">
        <WeekPlanBody report={report} state={isCurrent ? "forming" : "sealed"} viewedWeekISO={viewedWeekISO} header={header} />
      </div>
    </Sheet>
  );
}

// ── "Now what" header — where to start when you land on the vertical ─────────
function PlanReadiness({
  d,
  onOpen,
  onRefine,
}: {
  d: VerticalData;
  onOpen: (kind: "project" | "initiative", id: string) => void;
  onRefine?: () => void;
}) {
  const top = readTending(d).groomable[0];
  const readiness = (readinessOfProjectFloor(d) + readinessOfInitiativeFloor(d)) / 2;
  const cue: FloorCue | null = top
    ? { tone: top.silent ? "drift" : "attention", label: `${top.name} — ${RIPENESS_ADVANCE[top.ripeness.stage]}` }
    : null;
  return (
    <div className="px-4 pt-4">
      <ReadinessBanner
        eyebrow="Your vertical"
        readiness={readiness}
        cue={cue}
        actionLabel={top ? "Refine" : undefined}
        onAction={top ? (onRefine ?? (() => onOpen(top.kind, top.id))) : undefined}
      />
    </div>
  );
}

// ── The flat, segmented list — tap straight to any item ──────────────────────
function ListScreen({
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
            <span>{dom.lastTouchedDays >= 99 ? "untouched" : `tended ${dom.lastTouchedDays}d ago`}</span>
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
function InitiativeScreen({
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
function ProjectScreen({
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

// ── Context line for the flat project list (where it lives) ───────────────────
function projectContext(d: VerticalData, p: Project): string {
  const dom = domainById(d, p.domainId);
  const init = p.initiativeId ? initiativeById(d, p.initiativeId) : null;
  const head = dom ? `${dom.icon} ${dom.name}` : "—";
  return init ? `${head} · ${init.name}` : head;
}

// ── Rows ─────────────────────────────────────────────────────────────────────
function InitiativeRow({ d, i, onClick }: { d: VerticalData; i: Initiative; onClick: () => void }) {
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

function ProjectRow({ d, p, onClick }: { d: VerticalData; p: Project; onClick: () => void }) {
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
  return <div className="mono mb-2 flex flex-wrap items-center gap-1.5 text-caption text-muted">{children}</div>;
}

// A tappable breadcrumb segment — climb up the hierarchy on demand.
function Crumb({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="tap fast -my-1 truncate py-1 active:text-accent">
      {children}
    </button>
  );
}
