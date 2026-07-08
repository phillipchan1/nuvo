// Initiative — the bet with a finish line. Full treatment: name + goal +
// description, start/target dates, key results (CRUD, framed as Gain from a
// baseline), a month-scale timeline of the projects under it, and the projects
// + loose tasks that feed it. Everything editable in place.

import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import {
  domainById,
  initiativeAtRisk,
  initiativeAttainment,
  initiativeEffortGap,
  initiativeExecution,
  initiativeById,
  isProjectComplete,
  krCoverage,
  krPct,
  krStaleDays,
  KR_STALE_DAYS,
  looseTasksOfInitiative,
  projectProgress,
  projectsOf,
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
  KrPicker,
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
  const { openFlow } = useAppNavigation();
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
  const ripe = ripenessOfInitiative(data, initiative);

  // Outcome-first reads: attainment IS the progress when KRs exist; execution
  // (work done) and invested effort sit beside it to expose the activity-gap.
  const attainment = initiativeAttainment(data, initiative);
  const execution = initiativeExecution(data, initiative);
  const { investedHours, busywork } = initiativeEffortGap(data, initiative);
  const risk = initiativeAtRisk(data, initiative);
  const hasKRs = initiative.keyResults.length > 0;

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
            {risk.atRisk && (
              <span
                className="mono flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro"
                style={{ color: "var(--signal)", borderColor: "color-mix(in srgb, var(--signal) 45%, transparent)", background: "color-mix(in srgb, var(--signal) 8%, transparent)" }}
                title={`At risk — ${risk.reasons.join(" · ")}`}
              >
                ⚠ {risk.reasons[0]}
              </span>
            )}
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

      {/* outcome attainment (the needle) + execution + invested effort + dates */}
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-md border border-line bg-surface px-4 py-3">
        <div className="min-w-[200px] flex-1">
          <div className="flex items-baseline justify-between">
            <span className="section-label">
              {hasKRs ? "Outcome attainment (key results)" : "Progress (rolled up from projects)"}
            </span>
            <span className="mono text-label" style={{ color: accent }}>{attainment ?? execution}%</span>
          </div>
          <Bar pct={attainment ?? execution} color={accent} />
          {hasKRs && (
            <div className="mono mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-meta text-muted">
              <span title="Share of the work under this bet that's done — effort, not outcome.">
                execution {execution}%
              </span>
              <span>·</span>
              <span title="Hours of completed work that served this initiative.">{investedHours}h invested</span>
              {busywork && (
                <span style={{ color: "var(--signal)" }} title="Real effort logged, but the key results have barely moved — check whether the work actually targets the outcome.">
                  · ⚠ effort isn't moving the needle
                </span>
              )}
            </div>
          )}
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

      {/* Key results — the prime property, promoted above the execution layer */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="section-label">Key results{hasKRs ? ` · ${initiative.keyResults.length}` : ""}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => openFlow("refine", { kind: "initiative", id: initiative.id, lens: "okr" })}
              className="tap fast flex items-center gap-1 rounded-md px-2.5 py-1.5 text-caption font-medium text-white active:scale-[.98]"
              style={{ background: accent }}
              title="Draft the objective + key results with Nuvo"
            >
              ✦ Draft with Nuvo
            </button>
            <button onClick={() => addKeyResult(initiative.id)} className="fast mono text-label text-muted hover:text-ink">+ add</button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              {(() => {
                const cov = krCoverage(data, kr.id);
                const stale = krStaleDays(initiative);
                return (
                  <div className="mono mt-1.5 flex flex-wrap items-center gap-x-2 text-micro text-muted">
                    {cov.covered ? (
                      <span title="Open work pointed at this key result.">
                        {cov.projects > 0 && `${cov.projects} project${cov.projects === 1 ? "" : "s"}`}
                        {cov.projects > 0 && cov.openTasks > 0 && " · "}
                        {cov.openTasks > 0 && `${cov.openTasks} task${cov.openTasks === 1 ? "" : "s"}`}
                        {" working it"}
                      </span>
                    ) : (
                      <span style={{ color: "var(--signal)" }} title="No project or task is pointed at this number — link some work, or this outcome won't move.">
                        ⚠ nothing is moving this
                      </span>
                    )}
                    {stale != null && stale >= KR_STALE_DAYS && (
                      <span title="This measurement hasn't been updated in a while.">· unmeasured {stale}d</span>
                    )}
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
        {initiative.keyResults.length === 0 && (
          <div className="rounded-md border border-dashed border-line p-5 text-center text-caption text-muted">
            No key results yet — this bet has no number to move. <button onClick={() => openFlow("refine", { kind: "initiative", id: initiative.id, lens: "okr" })} className="fast underline hover:text-ink" style={{ color: accent }}>Draft them with Nuvo</button>, or add one from a baseline so you read the Gain, not just the gap.
          </div>
        )}
      </section>

      {/* timeline */}
      <section className="mb-8">
        <div className="section-label mb-2">Timeline</div>
        <Timeline items={timelineItems} persistKey={`initiative-${initiative.id}`} />
      </section>

      <div className="grid grid-cols-1 gap-8">
        {/* projects feeding it — execution under the outcome */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div className="section-label">{projects.length} project{projects.length === 1 ? "" : "s"} feeding it</div>
            <Btn onClick={() => void addProject(initiative.domainId, initiative.id).then((p) => onOpenProject(p.id))}>+ new project</Btn>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {projects.map((p) => {
              const pp = projectProgress(data, p);
              return (
                <div key={p.id} className="fast group flex flex-col rounded-md border border-line bg-surface p-3.5 hover:border-muted">
                  <button onClick={() => onOpenProject(p.id)} className="flex flex-1 flex-col text-left">
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
                  {hasKRs && (
                    <div className={`mt-2 ${p.keyResultId ? "" : "opacity-0 group-hover:opacity-100"}`}>
                      <KrPicker
                        keyResults={initiative.keyResults}
                        value={p.keyResultId}
                        onChange={(krId) => updateProject(p.id, { keyResultId: krId })}
                        color={accent}
                      />
                    </div>
                  )}
                </div>
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
              keyResults={initiative.keyResults}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
