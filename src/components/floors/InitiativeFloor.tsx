// Initiative — the bet with a finish line. Full treatment: name + goal +
// description, start/target dates, key results (CRUD, framed as Gain from a
// baseline), a month-scale timeline of the projects under it, and the projects
// + loose tasks that feed it. Everything editable in place.

import { useVertical } from "../../hooks/useVertical";
import {
  domainById,
  initiativeById,
  initiativeProgress,
  isProjectComplete,
  looseTasksOfInitiative,
  projectProgress,
  projectsOf,
  type KeyResult,
} from "../../lib/vertical";
import type { Focus } from "../AppShell";
import {
  Bar,
  DeleteBtn,
  DomainPicker,
  FloorHeader,
  Hook,
  InlineDate,
  InlineNumber,
  InlineText,
  InlineTextarea,
  MomentumChip,
  PROJECT_STATUS,
  PROJECT_STATUS_COLORS,
  PROJECT_STATUS_LABEL,
  RipenessPip,
  StatusPill,
  Timeline,
  type TimelineItem,
} from "./parts";
import { RIPENESS_HINT, RIPENESS_LABEL, ripenessOfInitiative, verdictOf } from "../../lib/tending";
import TaskList from "./TaskList";
import { Btn } from "../ui";

function krPct(kr: KeyResult) {
  if (kr.target === kr.baseline) return kr.current >= kr.target ? 100 : 0;
  const p = (kr.current - kr.baseline) / (kr.target - kr.baseline);
  return Math.max(0, Math.min(100, Math.round(p * 100)));
}

export default function InitiativeFloor({
  focus,
  onUp,
  onBack,
  onOpenProject,
}: {
  focus: Focus;
  onUp: () => void;
  onBack?: () => void;
  onOpenProject: (id: string) => void;
}) {
  const { data, updateInitiative, deleteInitiative, addProject, updateProject, addKeyResult, updateKeyResult, deleteKeyResult } = useVertical();
  const initiative = initiativeById(data, focus.initiativeId);

  if (!initiative) return <div className="text-body text-muted">No initiative selected.</div>;
  // Read the domain off the initiative so a just-reassigned bet re-accents at once.
  const domain = domainById(data, initiative.domainId);
  const accent = domain?.color ?? "var(--accent)";
  const domains = [...data.domains].sort((a, b) => a.sort - b.sort);

  // Reassigning the bet's domain ripples down to its projects so the spine stays
  // coherent — the same move the initiatives board makes.
  const changeDomain = (domainId: string) => {
    updateInitiative(initiative.id, { domainId });
    projectsOf(data, initiative.id).forEach((p) => updateProject(p.id, { domainId }));
  };

  const projects = projectsOf(data, initiative.id);
  const loose = looseTasksOfInitiative(data, initiative.id);
  const pct = initiativeProgress(data, initiative);
  const ripe = ripenessOfInitiative(data, initiative);

  const timelineItems: TimelineItem[] = projects.map((p) => ({
    id: p.id,
    label: p.name,
    color: accent,
    start: p.startDate,
    end: p.targetDate,
    progress: projectProgress(data, p),
    dim: isProjectComplete(p.status),
    onClick: () => onOpenProject(p.id),
    onChangeDates: (start, end) => updateProject(p.id, { startDate: start, targetDate: end }),
  }));

  return (
    <div className="mx-auto max-w-[1180px]">
      <FloorHeader
        eyebrow={
          <span className="flex items-center gap-2.5">
            {onBack && <button onClick={onBack} className="fast mono text-meta text-muted hover:text-ink">‹ all initiatives</button>}
            <Hook dir="up" label={domain?.name ?? "domain"} onClick={onUp} />
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <span className="mono flex items-center gap-1.5 text-meta text-muted" title={RIPENESS_HINT[ripe.stage]}>
              <RipenessPip stage={ripe.stage} unsound={ripe.stage === "active" && verdictOf(data, "initiative", initiative.id)?.sound !== true} />
              {RIPENESS_LABEL[ripe.stage]}
            </span>
            <DomainPicker domains={domains} value={initiative.domainId} onChange={changeDomain} align="right" />
            <StatusPill
              value={initiative.status}
              options={PROJECT_STATUS}
              colors={PROJECT_STATUS_COLORS}
              labels={PROJECT_STATUS_LABEL}
              filled={initiative.status === "in_progress" ? new Set(["in_progress"]) : undefined}
              onChange={(s) => updateInitiative(initiative.id, { status: s })}
            />
            <MomentumChip value={initiative.momentum} onChange={(m) => updateInitiative(initiative.id, { momentum: m })} />
            <DeleteBtn what="initiative" onDelete={() => { deleteInitiative(initiative.id); onUp(); }} />
          </div>
        }
      >
        <h1 className="text-display masthead">
          <InlineText value={initiative.name} onChange={(v) => updateInitiative(initiative.id, { name: v })} />
        </h1>
        <div className="mt-1.5 flex items-baseline gap-2 text-head">
          <span className="section-label shrink-0" style={{ marginTop: 2 }}>Goal</span>
          <InlineText
            value={initiative.outcome}
            onChange={(v) => updateInitiative(initiative.id, { outcome: v })}
            placeholder="What does done look like, in one line?"
            className="font-medium"
          />
        </div>
      </FloorHeader>

      {/* overall progress + dates */}
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-line bg-surface px-4 py-3">
        <div className="min-w-[200px] flex-1">
          <div className="flex items-baseline justify-between">
            <span className="section-label">Progress (rolled up from projects)</span>
            <span className="mono text-label" style={{ color: accent }}>{pct}%</span>
          </div>
          <Bar pct={pct} color={accent} />
        </div>
        <div className="mono flex items-center gap-4 text-label text-muted">
          <span>start <InlineDate value={initiative.startDate} onChange={(v) => updateInitiative(initiative.id, { startDate: v })} /></span>
          <span>·</span>
          <span>target <InlineDate value={initiative.targetDate} onChange={(v) => updateInitiative(initiative.id, { targetDate: v })} /></span>
        </div>
      </div>

      {/* description */}
      <div className="mb-7">
        <InlineTextarea
          value={initiative.description}
          onChange={(v) => updateInitiative(initiative.id, { description: v })}
          placeholder="Describe the bet — the why and the shape of it…"
          className="max-w-[760px] text-head text-muted"
        />
      </div>

      {/* timeline */}
      <section className="mb-8">
        <div className="section-label mb-2">Timeline</div>
        <Timeline items={timelineItems} persistKey={`initiative-${initiative.id}`} />
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* projects feeding it */}
        <section className="lg:col-span-7">
          <div className="mb-3 flex items-center justify-between">
            <div className="section-label">{projects.length} project{projects.length === 1 ? "" : "s"} feeding it</div>
            <Btn onClick={() => void addProject(initiative.domainId, initiative.id).then((p) => onOpenProject(p.id))}>+ new project</Btn>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {projects.map((p) => {
              const pp = projectProgress(data, p);
              return (
                <button
                  key={p.id}
                  onClick={() => onOpenProject(p.id)}
                  className="fast group flex flex-col rounded-md border border-line bg-surface p-3.5 text-left hover:border-muted"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-body font-medium leading-snug">{p.name}</span>
                    <span
                      className="mono ml-auto shrink-0 rounded-full border px-1.5 text-micro"
                      style={{
                        borderColor: PROJECT_STATUS_COLORS[p.status as keyof typeof PROJECT_STATUS_COLORS] ?? "var(--muted)",
                        color: p.status === "in_progress" ? "#fff" : PROJECT_STATUS_COLORS[p.status as keyof typeof PROJECT_STATUS_COLORS] ?? "var(--muted)",
                        background: p.status === "in_progress" ? "var(--accent)" : "transparent",
                      }}
                    >
                      {PROJECT_STATUS_LABEL[p.status as keyof typeof PROJECT_STATUS_LABEL] ?? p.status}
                    </span>
                  </div>
                  {p.outcome && <div className="mt-1 line-clamp-2 text-label text-muted">{p.outcome}</div>}
                  <div className="mt-auto pt-2">
                    <Bar pct={pp} color={accent} h={1} />
                    <div className="mono text-meta text-muted">{pp}%{p.targetDate ? ` · by ${p.targetDate.slice(5)}` : ""}</div>
                  </div>
                </button>
              );
            })}
          </div>
          {projects.length === 0 && (
            <div className="rounded-md border border-dashed border-line p-5 text-center text-caption text-muted">
              No projects yet. A project is a chunk of work with its own tasks — add one, or keep small things as loose tasks below.
            </div>
          )}

          {/* loose tasks straight on the initiative — no project ceremony */}
          <div className="mt-6">
            <div className="section-label mb-1.5">Loose tasks (no project)</div>
            <TaskList
              tasks={loose}
              parent={{ initiativeId: initiative.id, domainId: initiative.domainId, projectId: null }}
              accent={accent}
              emptyHint="Small things that don't deserve a project live here."
            />
          </div>
        </section>

        {/* key results */}
        <section className="lg:col-span-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="section-label">Key results</div>
            <button onClick={() => addKeyResult(initiative.id)} className="fast mono text-label text-muted hover:text-ink">+ add</button>
          </div>
          <div className="space-y-4">
            {initiative.keyResults.map((kr) => (
              <div key={kr.id} className="group rounded-md border border-line bg-surface p-3">
                <div className="flex items-center gap-2">
                  <InlineText value={kr.name} onChange={(v) => updateKeyResult(initiative.id, kr.id, { name: v })} className="text-caption font-medium" />
                  <div className="ml-auto opacity-0 transition-opacity group-hover:opacity-100">
                    <DeleteBtn what="result" onDelete={() => deleteKeyResult(initiative.id, kr.id)} />
                  </div>
                </div>
                <div className="mono mt-1 flex items-center gap-1 text-meta text-muted">
                  <InlineNumber value={kr.baseline} onChange={(v) => updateKeyResult(initiative.id, kr.id, { baseline: v })} />
                  <span>→</span>
                  <span style={{ color: accent }}><InlineNumber value={kr.current} onChange={(v) => updateKeyResult(initiative.id, kr.id, { current: v })} /></span>
                  <span>→</span>
                  <InlineNumber value={kr.target} onChange={(v) => updateKeyResult(initiative.id, kr.id, { target: v })} />
                  <InlineText value={kr.unit} onChange={(v) => updateKeyResult(initiative.id, kr.id, { unit: v })} placeholder="unit" className="ml-1 w-10" />
                </div>
                <Bar pct={krPct(kr)} color={accent} />
              </div>
            ))}
            {initiative.keyResults.length === 0 && (
              <div className="rounded-md border border-dashed border-line p-4 text-center text-label text-muted">
                No key results. Add measurable outcomes — each framed from a baseline so you read the Gain, not just the gap.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
