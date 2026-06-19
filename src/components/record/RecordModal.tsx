// The Record modal — a project or initiative's command center. Clicking a
// record anywhere in the app opens this beautiful, fully-editable "moment"
// over whatever floor you're on: breadcrumb, inline title + goal, a progress
// ring, status, dates, brief, tasks (full CRUD), and — the headline —
// "Tasks that belong here", the intelligence that pulls matching loose/inbox
// work in with one click. The full-page floor stays one "Open full page ↗"
// away for the big-canvas Gantt / key-result work.

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useVertical } from "../../hooks/useVertical";
import {
  domainById,
  initiativeById,
  initiativeProgress,
  looseTasksOfInitiative,
  projectById,
  projectProgress,
  projectSprintCount,
  projectsOf,
  tasksOf,
  type KeyResult,
} from "../../lib/vertical";
import { suggestForInitiative, suggestForProject, type Suggestion } from "../../lib/belonging";
import { ENERGY_META } from "../../lib/energy";
import {
  Bar,
  DeleteBtn,
  DomainPicker,
  InlineDate,
  InlineNumber,
  InlineText,
  InlineTextarea,
  MomentumChip,
  PROJECT_STATUS,
  PROJECT_STATUS_COLORS,
  PROJECT_STATUS_LABEL,
  StatusPill,
} from "../floors/parts";
import TaskList from "../floors/TaskList";
import { Btn } from "../ui";

export type RecordKind = "project" | "initiative";

export default function RecordModal({
  kind,
  id,
  onClose,
  onExpand,
  onOpenProject,
  onOpenInitiative,
}: {
  kind: RecordKind;
  id: string;
  onClose: () => void;
  /** Promote this record to its full-page floor (the big canvas). */
  onExpand: () => void;
  /** Hop to a project's record (child project / breadcrumb). */
  onOpenProject: (id: string) => void;
  /** Hop to an initiative's record (breadcrumb). */
  onOpenInitiative: (id: string) => void;
}) {
  // Esc closes — capture phase + stopPropagation so we own it cleanly.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div
      className="scrim fixed inset-0 z-[60] flex items-start justify-center bg-black/35 px-4 py-[5vh] backdrop-blur-[3px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {kind === "project" ? (
        <ProjectRecord
          id={id}
          onClose={onClose}
          onExpand={onExpand}
          onOpenInitiative={onOpenInitiative}
        />
      ) : (
        <InitiativeRecord
          id={id}
          onClose={onClose}
          onExpand={onExpand}
          onOpenProject={onOpenProject}
        />
      )}
    </div>,
    document.body,
  );
}

// ── The raised card every record shares ──────────────────────────────────────
function Card({ accent, children }: { accent: string; children: ReactNode }) {
  return (
    <div className="moment elev-3 relative flex max-h-[90vh] w-full max-w-[940px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-bg">
      <div
        className="h-[3px] w-full shrink-0"
        style={{ background: `linear-gradient(90deg, ${accent}, ${accent}66 65%, transparent)` }}
      />
      {children}
    </div>
  );
}

// ── A progress ring — the glanceable hero of the header ───────────────────────
function Ring({ pct, color, size = 54, stroke = 5 }: { pct: number; color: string; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`${clamped}% complete`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - clamped / 100)}
          style={{ transition: "stroke-dashoffset var(--d-slow) var(--ease-out)" }}
        />
      </svg>
      <div className="mono absolute inset-0 flex items-center justify-center text-body font-semibold" style={{ color }}>
        {clamped}
      </div>
    </div>
  );
}

// ── Header (breadcrumb + actions, title + goal, ring) ─────────────────────────
function Header({
  accent,
  crumbs,
  title,
  onTitle,
  goal,
  onGoal,
  goalPlaceholder,
  pct,
  onExpand,
  onClose,
}: {
  accent: string;
  crumbs: ReactNode;
  title: string;
  onTitle: (v: string) => void;
  goal: string;
  onGoal: (v: string) => void;
  goalPlaceholder: string;
  pct: number;
  onExpand: () => void;
  onClose: () => void;
}) {
  return (
    <div className="px-7 pt-5 pb-4">
      <div className="mono mb-2.5 flex items-center gap-1.5 text-meta">
        {crumbs}
        <div className="flex-1" />
        <button
          onClick={onExpand}
          title="Open as a full page"
          className="fast flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-meta text-muted hover:border-line-strong hover:text-ink"
        >
          ⤢ full page
        </button>
        <button onClick={onClose} className="keycap" title="Close">esc</button>
      </div>

      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-display masthead leading-tight">
            <InlineText value={title} onChange={onTitle} placeholder="Untitled" />
          </h1>
          <div className="mt-1.5 flex items-baseline gap-2 text-head">
            <span className="section-label shrink-0" style={{ marginTop: 2 }}>Goal</span>
            <InlineText value={goal} onChange={onGoal} placeholder={goalPlaceholder} className="font-medium" />
          </div>
        </div>
        <Ring pct={pct} color={accent} />
      </div>
    </div>
  );
}

// ── Status band (status, momentum, counts, dates) ─────────────────────────────
function Band({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-line bg-surface/50 px-7 py-2.5">
      {children}
    </div>
  );
}

// ── Scrollable two-column body ────────────────────────────────────────────────
function Body({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid grid-cols-1 gap-x-8 gap-y-7 px-7 py-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-7">{main}</div>
        <div className="space-y-6">{side}</div>
      </div>
    </div>
  );
}

function Section({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="section-label">{label}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

// ── The intelligence: "Tasks that belong here" ────────────────────────────────
function SuggestionPanel({
  suggestions,
  accent,
  onFold,
  hint,
}: {
  suggestions: Suggestion[];
  accent: string;
  onFold: (taskId: string) => void;
  hint: string;
}) {
  return (
    <section className="rounded-[var(--radius)] border border-line bg-surface-2/60 p-3.5">
      <div className="mb-1 flex items-center gap-2">
        <span className="mono text-micro font-semibold tracking-widest" style={{ color: accent }}>✦ BELONGS HERE</span>
        <div className="h-px flex-1" style={{ background: "var(--line)" }} />
      </div>

      {suggestions.length === 0 ? (
        <p className="text-label leading-relaxed text-muted">{hint}</p>
      ) : (
        <>
          <p className="mb-2.5 text-label leading-relaxed text-muted">
            From your inbox & loose work — fold in what fits.
          </p>
          <div className="space-y-1.5">
            {suggestions.map((s) => (
              <div
                key={s.task.id}
                className="group fast glass-card flex items-start gap-2 rounded-md border border-line px-2.5 py-2 hover:border-line-strong"
              >
                <span className="mt-px shrink-0 text-caption" style={{ color: accent }}>
                  {s.task.energy ? ENERGY_META[s.task.energy].icon : "·"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-caption leading-snug">{s.task.title || "Untitled"}</div>
                  {s.reasons.length > 0 && (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {s.reasons.map((r, i) => (
                        <span
                          key={i}
                          className="rounded-full px-1.5 py-px text-micro leading-tight text-muted"
                          style={{ background: "var(--bg)" }}
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => onFold(s.task.id)}
                  title="Fold this task in"
                  className="fast mt-px shrink-0 rounded-md border px-2 py-1 text-meta font-medium"
                  style={{ borderColor: `${accent}55`, color: accent, background: `${accent}12` }}
                >
                  + fold in
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ── Project record ────────────────────────────────────────────────────────────
function ProjectRecord({
  id,
  onClose,
  onExpand,
  onOpenInitiative,
}: {
  id: string;
  onClose: () => void;
  onExpand: () => void;
  onOpenInitiative: (id: string) => void;
}) {
  const { data, updateProject, deleteProject, routeTask, addProjectReadyToSprint } = useVertical();
  const project = projectById(data, id);
  const [note, setNote] = useState<string | null>(null);

  // Record vanished (deleted elsewhere) — close rather than show an empty shell.
  useEffect(() => {
    if (!project) onClose();
  }, [project, onClose]);
  if (!project) return null;

  const domain = domainById(data, project.domainId);
  const initiative = initiativeById(data, project.initiativeId);
  const accent = domain?.color ?? "var(--accent)";
  const tasks = tasksOf(data, project.id);
  const done = tasks.filter((t) => t.status === "done").length;
  const pct = projectProgress(data, project);
  const inSprint = projectSprintCount(data, project.id);
  const suggestions = suggestForProject(data, project);

  return (
    <Card accent={accent}>
      <Header
        accent={accent}
        crumbs={
          <>
            {domain && (
              <span className="flex items-center gap-1" style={{ color: domain.color }}>
                {domain.icon} {domain.name}
              </span>
            )}
            {initiative && (
              <>
                <span className="text-muted">›</span>
                <button onClick={() => onOpenInitiative(initiative.id)} className="fast text-muted hover:text-ink">
                  {initiative.name}
                </button>
              </>
            )}
          </>
        }
        title={project.name}
        onTitle={(v) => updateProject(project.id, { name: v })}
        goal={project.outcome}
        onGoal={(v) => updateProject(project.id, { outcome: v })}
        goalPlaceholder="What does done look like, in one line?"
        pct={pct}
        onExpand={onExpand}
        onClose={onClose}
      />

      <Band>
        <StatusPill
          value={project.status}
          options={PROJECT_STATUS}
          colors={PROJECT_STATUS_COLORS}
          onChange={(s) => updateProject(project.id, { status: s })}
        />
        <span className="mono text-label text-muted">
          {done}/{tasks.length} tasks{inSprint > 0 ? ` · ★ ${inSprint} this week` : ""}
        </span>
        <div className="flex-1" />
        <div className="mono flex items-center gap-2 text-label text-muted">
          <span>start <InlineDate value={project.startDate} onChange={(v) => updateProject(project.id, { startDate: v })} /></span>
          <span className="opacity-50">→</span>
          <span>target <InlineDate value={project.targetDate} onChange={(v) => updateProject(project.id, { targetDate: v })} /></span>
        </div>
      </Band>

      <Body
        main={
          <>
            <Section label="Brief">
              <InlineTextarea
                value={project.description}
                onChange={(v) => updateProject(project.id, { description: v })}
                placeholder="Scope, what's in and out, the why… the more here, the sharper the suggestions →"
                className="text-body text-muted"
              />
            </Section>

            <Section
              label={`Tasks · ${done}/${tasks.length}`}
              action={
                <button
                  onClick={() => {
                    addProjectReadyToSprint(project.id);
                    setNote("Committed this project's open tasks to the week.");
                  }}
                  className="fast mono text-label text-muted hover:text-ink"
                  title="Commit open tasks to this week"
                >
                  ★ commit to week{inSprint > 0 ? ` (${inSprint})` : ""}
                </button>
              }
            >
              <TaskList
                tasks={tasks}
                parent={{ projectId: project.id, initiativeId: project.initiativeId, domainId: project.domainId }}
                accent={accent}
                emptyHint="No tasks yet — add the first step."
              />
            </Section>
          </>
        }
        side={
          <SuggestionPanel
            suggestions={suggestions}
            accent={accent}
            onFold={(taskId) => routeTask(taskId, { projectId: project.id })}
            hint="Nothing loose matches yet. Capture tasks to your inbox or describe the project above, and matches surface here."
          />
        }
      />

      <Footer
        onClose={onClose}
        onExpand={onExpand}
        deleteWhat="project"
        onDelete={() => { deleteProject(project.id); onClose(); }}
        note={note}
      />
    </Card>
  );
}

// ── Initiative record ─────────────────────────────────────────────────────────
function krPct(kr: KeyResult) {
  if (kr.target === kr.baseline) return kr.current >= kr.target ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round(((kr.current - kr.baseline) / (kr.target - kr.baseline)) * 100)));
}

function InitiativeRecord({
  id,
  onClose,
  onExpand,
  onOpenProject,
}: {
  id: string;
  onClose: () => void;
  onExpand: () => void;
  onOpenProject: (id: string) => void;
}) {
  const {
    data,
    updateInitiative,
    deleteInitiative,
    addProject,
    updateProject,
    addKeyResult,
    updateKeyResult,
    deleteKeyResult,
    routeTask,
  } = useVertical();
  const initiative = initiativeById(data, id);

  useEffect(() => {
    if (!initiative) onClose();
  }, [initiative, onClose]);
  if (!initiative) return null;

  const domain = domainById(data, initiative.domainId);
  const accent = domain?.color ?? "var(--accent)";
  const domains = [...data.domains].sort((a, b) => a.sort - b.sort);
  const changeDomain = (domainId: string) => {
    updateInitiative(initiative.id, { domainId });
    projectsOf(data, initiative.id).forEach((p) => updateProject(p.id, { domainId }));
  };
  const projects = projectsOf(data, initiative.id);
  const loose = looseTasksOfInitiative(data, initiative.id);
  const pct = initiativeProgress(data, initiative);
  const suggestions = suggestForInitiative(data, initiative);

  return (
    <Card accent={accent}>
      <Header
        accent={accent}
        crumbs={
          domain && (
            <span className="flex items-center gap-1" style={{ color: domain.color }}>
              {domain.icon} {domain.name}
            </span>
          )
        }
        title={initiative.name}
        onTitle={(v) => updateInitiative(initiative.id, { name: v })}
        goal={initiative.outcome}
        onGoal={(v) => updateInitiative(initiative.id, { outcome: v })}
        goalPlaceholder="What does done look like, in one line?"
        pct={pct}
        onExpand={onExpand}
        onClose={onClose}
      />

      <Band>
        <DomainPicker domains={domains} value={initiative.domainId} onChange={changeDomain} />
        <StatusPill
          value={initiative.status}
          options={[...PROJECT_STATUS]}
          colors={PROJECT_STATUS_COLORS}
          labels={PROJECT_STATUS_LABEL}
          filled={initiative.status === "in_progress" ? new Set(["in_progress"]) : undefined}
          onChange={(s) => updateInitiative(initiative.id, { status: s })}
        />
        <MomentumChip value={initiative.momentum} onChange={(m) => updateInitiative(initiative.id, { momentum: m })} />
        <span className="mono text-label text-muted">
          {projects.length} project{projects.length === 1 ? "" : "s"} · {initiative.keyResults.length} KR
        </span>
        <div className="flex-1" />
        <div className="mono flex items-center gap-2 text-label text-muted">
          <span>start <InlineDate value={initiative.startDate} onChange={(v) => updateInitiative(initiative.id, { startDate: v })} /></span>
          <span className="opacity-50">→</span>
          <span>target <InlineDate value={initiative.targetDate} onChange={(v) => updateInitiative(initiative.id, { targetDate: v })} /></span>
        </div>
      </Band>

      <Body
        main={
          <>
            <Section label="The bet">
              <InlineTextarea
                value={initiative.description}
                onChange={(v) => updateInitiative(initiative.id, { description: v })}
                placeholder="The why and the shape of it… the more here, the sharper the suggestions →"
                className="text-body text-muted"
              />
            </Section>

            <Section
              label={`${projects.length} project${projects.length === 1 ? "" : "s"} feeding it`}
              action={
                <button
                  onClick={() => void addProject(initiative.domainId, initiative.id).then((p) => onOpenProject(p.id))}
                  className="fast mono text-label text-muted hover:text-ink"
                >
                  + new project
                </button>
              }
            >
              {projects.length > 0 ? (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {projects.map((p) => {
                    const pp = projectProgress(data, p);
                    return (
                      <button
                        key={p.id}
                        onClick={() => onOpenProject(p.id)}
                        className="fast group glass-card flex flex-col rounded-[var(--radius)] border border-line p-3 text-left hover:border-muted hover:-translate-y-px hover:[box-shadow:var(--shadow-2)]"
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-caption font-medium leading-snug">{p.name}</span>
                          <span
                            className="mono ml-auto shrink-0 rounded-full border px-1.5 text-micro"
                            style={{ borderColor: PROJECT_STATUS_COLORS[p.status], color: PROJECT_STATUS_COLORS[p.status] }}
                          >
                            {PROJECT_STATUS_LABEL[p.status]}
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
              ) : (
                <div className="rounded-[var(--radius)] border border-dashed border-line p-4 text-center text-caption text-muted">
                  No projects yet — add one, or keep small things as loose tasks below.
                </div>
              )}
            </Section>

            <Section label="Loose tasks (no project)">
              <TaskList
                tasks={loose}
                parent={{ initiativeId: initiative.id, domainId: initiative.domainId, projectId: null }}
                accent={accent}
                emptyHint="Small things that don't deserve a project live here."
              />
            </Section>
          </>
        }
        side={
          <>
            <Section
              label="Key results"
              action={
                <button onClick={() => addKeyResult(initiative.id)} className="fast mono text-label text-muted hover:text-ink">+ add</button>
              }
            >
              <div className="space-y-3">
                {initiative.keyResults.map((kr) => (
                  <div key={kr.id} className="group glass-card rounded-[var(--radius)] border border-line p-3">
                    <div className="flex items-center gap-2">
                      <InlineText value={kr.name} onChange={(v) => updateKeyResult(initiative.id, kr.id, { name: v })} className="text-caption font-medium" />
                      <div className="ml-auto opacity-0 transition-opacity group-hover:opacity-100">
                        <DeleteBtn what="result" onDelete={() => deleteKeyResult(initiative.id, kr.id)} />
                      </div>
                    </div>
                    <div className="mono mt-1 flex items-center gap-1 text-meta text-muted">
                      <InlineNumber value={kr.baseline} onChange={(v) => updateKeyResult(initiative.id, kr.id, { baseline: v })} />
                      <span>→</span>
                      <span style={{ color: accent }}>
                        <InlineNumber value={kr.current} onChange={(v) => updateKeyResult(initiative.id, kr.id, { current: v })} />
                      </span>
                      <span>→</span>
                      <InlineNumber value={kr.target} onChange={(v) => updateKeyResult(initiative.id, kr.id, { target: v })} />
                      <InlineText value={kr.unit} onChange={(v) => updateKeyResult(initiative.id, kr.id, { unit: v })} placeholder="unit" className="ml-1 w-10" />
                    </div>
                    <Bar pct={krPct(kr)} color={accent} />
                  </div>
                ))}
                {initiative.keyResults.length === 0 && (
                  <div className="rounded-[var(--radius)] border border-dashed border-line p-3 text-center text-label text-muted">
                    Add measurable outcomes — each framed from a baseline, so you read the Gain.
                  </div>
                )}
              </div>
            </Section>

            <SuggestionPanel
              suggestions={suggestions}
              accent={accent}
              onFold={(taskId) => routeTask(taskId, { projectId: null, initiativeId: initiative.id })}
              hint="Nothing loose matches yet. Capture tasks to your inbox or describe the bet above, and matches surface here."
            />
          </>
        }
      />

      <Footer
        onClose={onClose}
        onExpand={onExpand}
        deleteWhat="initiative"
        onDelete={() => { deleteInitiative(initiative.id); onClose(); }}
      />
    </Card>
  );
}

// ── Shared footer ─────────────────────────────────────────────────────────────
function Footer({
  onClose,
  onExpand,
  deleteWhat,
  onDelete,
  note,
}: {
  onClose: () => void;
  onExpand: () => void;
  deleteWhat: string;
  onDelete: () => void;
  note?: string | null;
}) {
  return (
    <div className="flex items-center gap-2 border-t border-line bg-surface/50 px-7 py-3.5">
      <DeleteBtn what={deleteWhat} onDelete={onDelete} />
      {note && <span className="text-label text-muted">{note}</span>}
      <div className="flex-1" />
      <Btn onClick={onExpand}>Open full page ↗</Btn>
      <Btn kind="primary" onClick={onClose}>Done</Btn>
    </div>
  );
}
