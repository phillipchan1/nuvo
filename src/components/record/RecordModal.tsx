// The Record modal — a project or initiative's command center, and the ONLY
// single-record surface for both (neither rung has a full page anymore — the
// modal is it, so the two stay symmetric). Clicking a record anywhere opens this
// beautiful, fully-editable "moment" over whatever floor you're on: breadcrumb,
// inline title + goal, a progress ring, status, dates, brief, key results / tasks
// (full CRUD), and — the headline — "Tasks that belong here", the intelligence
// that pulls matching loose/inbox work in with one click.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useVertical } from "../../hooks/useVertical";
import {
  domainById,
  initiativeById,
  initiativeProgress,
  isStatusOverride,
  projectById,
  projectProgress,
  projectSprintCount,
  projectsOf,
  tasksOf,
  type KeyResult,
  type Project,
  type ProjectStatus,
} from "../../lib/vertical";
import { ProjectShipAssess, type LeftoverVerdict } from "./ShipAssess";
import { suggestForInitiative, suggestForProject, type Suggestion } from "../../lib/belonging";
import { ENERGY_META } from "../../lib/energy";
import {
  Bar,
  DeleteBtn,
  DomainPicker,
  InlineDate,
  InlineNumber,
  InlineText,
  MomentumChip,
  PROJECT_STATUS,
  PROJECT_STATUS_COLORS,
  PROJECT_STATUS_LABEL,
  StatusPill,
} from "../floors/parts";
import TaskList from "../floors/TaskList";
import { ProjectActivityBind } from "../floors/ProjectActivityBind";
import { RecordLog } from "./RecordLog";
import { AssessLayer, type AssessFinding } from "./AssessLayer";
import { Btn } from "../ui";

export type RecordKind = "project" | "initiative";

export default function RecordModal({
  kind,
  id,
  onClose,
  onOpenProject,
  onOpenInitiative,
}: {
  kind: RecordKind;
  id: string;
  onClose: () => void;
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
          onOpenInitiative={onOpenInitiative}
        />
      ) : (
        <InitiativeRecord
          id={id}
          onClose={onClose}
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
    <div className="moment elev-3 relative flex max-h-[92vh] w-full max-w-[1080px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-bg">
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
  goalLabel = "Goal",
  showGoal = true,
  pct,
  onClose,
}: {
  accent: string;
  crumbs: ReactNode;
  title: string;
  onTitle: (v: string) => void;
  goal: string;
  onGoal: (v: string) => void;
  goalPlaceholder: string;
  goalLabel?: string;
  /** Projects carry their Goal in the masthead; initiatives move the Objective
   *  into the body so it heads the Key Results (a true OKR block), so hide it here. */
  showGoal?: boolean;
  pct: number;
  onClose: () => void;
}) {
  return (
    <div className="px-7 pt-5 pb-4">
      <div className="mono mb-2.5 flex items-center gap-1.5 text-meta">
        {crumbs}
        <div className="flex-1" />
        <button onClick={onClose} className="keycap" title="Close">esc</button>
      </div>

      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-display masthead leading-tight">
            <InlineText value={title} onChange={onTitle} placeholder="Untitled" />
          </h1>
          {showGoal && (
            <div data-assess-anchor="objective" className="mt-1.5 flex items-baseline gap-2 text-head">
              <span className="section-label shrink-0" style={{ marginTop: 2 }}>{goalLabel}</span>
              <InlineText value={goal} onChange={onGoal} placeholder={goalPlaceholder} className="font-medium" />
            </div>
          )}
        </div>
        <Ring pct={pct} color={accent} />
      </div>
    </div>
  );
}

// ── Scrollable two-column body ────────────────────────────────────────────────
function Body({ main, side, overlay, scrollRef }: {
  main: ReactNode;
  side: ReactNode;
  /** Absolute layer inside the scroll container (Assess notes) — scrolls with content. */
  overlay?: ReactNode;
  scrollRef?: RefObject<HTMLDivElement>;
}) {
  return (
    <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 px-8 py-7 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-7">{main}</div>
        <div className="space-y-6">{side}</div>
      </div>
      {overlay}
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
    <section>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="section-label" style={{ color: accent }}>✦ Belongs here</span>
        <div className="h-px flex-1" style={{ background: "var(--line)" }} />
      </div>

      {suggestions.length === 0 ? (
        <p className="text-label leading-relaxed text-muted">{hint}</p>
      ) : (
        <>
          <p className="mb-1 text-meta leading-relaxed text-muted">
            From your inbox & loose work — fold in what fits.
          </p>
          <div>
            {suggestions.map((s) => (
              <div
                key={s.task.id}
                className="group fast flex items-start gap-2 border-b border-line py-2 last:border-b-0"
              >
                <span className="mt-px shrink-0 text-caption text-muted">
                  {s.task.energy ? ENERGY_META[s.task.energy].icon : "·"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-caption leading-snug text-muted group-hover:text-ink">{s.task.title || "Untitled"}</div>
                  {s.reasons.length > 0 && (
                    <div className="mt-0.5 truncate text-micro leading-tight text-muted/70">
                      {s.reasons.join(" · ")}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => onFold(s.task.id)}
                  title="Fold this task in"
                  className="fast mt-px shrink-0 text-meta font-medium hover:underline"
                  style={{ color: accent }}
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

// ── Derived status — reads the truth off the tasks, never a field you maintain ─
// A project/initiative SHIPS; only a task is "done". One word per altitude, and
// the Shipped wall is already named for it. Waiting / Cancelled are the only
// human-set states (the machine can't infer them), offered behind a "···"
// override; everything else is computed in buildVertical — finish every task and
// the project reads Shipped, here and everywhere else, with no step in between.
const STATUS_LABEL: Record<ProjectStatus, string> = {
  backlog: "Idea",
  in_progress: "In motion",
  waiting: "Waiting",
  cancelled: "Cancelled",
  complete: "Shipped",
};

function StatusControl({
  project,
  status,
  color,
  onChange,
}: {
  project: Project;
  status: ProjectStatus; // the DERIVED status
  color: string;
  onChange: (s: ProjectStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  // Shipped / Waiting / Cancelled earn a label — they're the states worth saying
  // out loud, whoever decided them. Read the EFFECTIVE status, not the stored one:
  // tick the last task and the project IS shipped, so the strip has to say so.
  // (Reading `storedStatus` here left a 5/5 project showing nothing at all — the
  // very "it didn't mark it complete" silence this whole change set out to kill.)
  const labelled = isStatusOverride(status);
  // …but only a status you SET by hand can be handed back to the tasks.
  const manual = isStatusOverride(project.storedStatus);
  const filled = status === "in_progress" || status === "complete";
  const pick = (s: ProjectStatus) => { onChange(s); setOpen(false); };
  return (
    <span className="relative inline-flex items-center gap-1">
      {/* The derived middle states ("Idea", "In motion") stay silent — they named
          nothing you could act on, and progress is already the tasks + the week
          chip right here on this strip. */}
      {labelled && (
        <span
          className="mono rounded-full border px-2 py-0.5 text-meta"
          style={{ borderColor: color, color: filled ? "#fff" : color, background: filled ? color : "transparent" }}
          title={manual ? "Status you set — click ··· to let it track your tasks again" : "Every task is done"}
        >
          {STATUS_LABEL[status]}
        </span>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fast mono rounded-full px-1 text-meta text-muted hover:text-ink"
        title="Mark shipped, waiting, or cancelled"
        aria-label="Set status"
      >
        ···
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="rise elev-2 absolute left-0 top-full z-50 mt-1 min-w-[150px] rounded-md border border-line bg-surface py-1">
            <button onClick={() => pick("waiting")} className="fast mono block w-full px-2.5 py-1 text-left text-label hover:bg-accent-soft" style={{ color: PROJECT_STATUS_COLORS.waiting }}>Mark waiting</button>
            <button onClick={() => pick("cancelled")} className="fast mono block w-full px-2.5 py-1 text-left text-label hover:bg-accent-soft" style={{ color: PROJECT_STATUS_COLORS.cancelled }}>Mark cancelled</button>
            <button onClick={() => pick("complete")} className="fast mono block w-full px-2.5 py-1 text-left text-label hover:bg-accent-soft" style={{ color: PROJECT_STATUS_COLORS.complete }}>Mark shipped</button>
            {manual && (
              <>
                <div className="my-1 h-px bg-line" />
                <button onClick={() => pick("in_progress")} className="fast mono block w-full px-2.5 py-1 text-left text-label text-muted hover:bg-accent-soft">↺ Back to auto</button>
              </>
            )}
          </div>
        </>
      )}
    </span>
  );
}

// ── Project record ────────────────────────────────────────────────────────────
function ProjectRecord({
  id,
  onClose,
  onOpenInitiative,
}: {
  id: string;
  onClose: () => void;
  onOpenInitiative: (id: string) => void;
}) {
  const { data, updateProject, updateTask, deleteProject, routeTask, addProjectReadyToSprint } = useVertical();
  const project = projectById(data, id);
  const [note, setNote] = useState<string | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [shipping, setShipping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Record vanished (deleted elsewhere) — close rather than show an empty shell.
  useEffect(() => {
    if (!project) onClose();
  }, [project, onClose]);
  if (!project) return null;

  // Apply an accepted coach patch to the right target.
  const applyAssess = (f: AssessFinding) => {
    if (!f.patch) return;
    if (f.patch.kind === "outcome" && f.patch.outcome) updateProject(project.id, { outcome: f.patch.outcome });
    else if (f.patch.kind === "title" && f.patch.title && f.anchor.startsWith("task:")) {
      updateTask(f.anchor.slice(5), { title: f.patch.title });
    }
  };

  const domain = domainById(data, project.domainId);
  const initiative = initiativeById(data, project.initiativeId);
  const domains = [...data.domains].sort((a, b) => a.sort - b.sort);
  const accent = domain?.color ?? "var(--accent)";
  const tasks = tasksOf(data, project.id);
  const done = tasks.filter((t) => t.status === "done").length;
  const pct = projectProgress(data, project);
  const inSprint = projectSprintCount(data, project.id);
  const suggestions = suggestForProject(data, project);
  // Already the honest answer — buildVertical derives `complete` the moment the
  // last task is ticked, so there's nothing to compute (or invite) here.
  const status = project.status;
  const statusColor = PROJECT_STATUS_COLORS[status];

  const shipped = (verdict: LeftoverVerdict | null, open: number) =>
    setNote(
      verdict === "done"
        ? `Shipped — and marked ${open} open task${open === 1 ? "" : "s"} done.`
        : verdict === "drop"
          ? `Shipped — and dropped ${open} task${open === 1 ? "" : "s"} you didn't need.`
          : "Shipped.",
    );

  return (
    <Card accent={accent}>
      <Header
        accent={accent}
        crumbs={
          <>
            {/* The domain is identity AND a routing decision you change — it was
                read-only here, so a mis-filed project had to be fixed elsewhere. */}
            <DomainPicker
              domains={domains}
              value={project.domainId}
              onChange={(domainId) => {
                // An initiative lives in one domain — crossing domains detaches
                // the project (same rule as the Projects table). Leaving the
                // FK set would keep it nested under the old bet.
                const init = initiativeById(data, project.initiativeId);
                const crossDomain = Boolean(init && init.domainId !== domainId);
                updateProject(project.id, {
                  domainId,
                  ...(crossDomain ? { initiativeId: null, keyResultId: null } : {}),
                });
              }}
            />
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
        onClose={onClose}
      />

      <Body
        main={
          <>
            {/* Tasks are the hero — composer pinned on top, scaffolding-first */}
            <Section
              label="Tasks"
              action={
                <button
                  onClick={() => {
                    addProjectReadyToSprint(project.id);
                    setNote("Committed this project's open tasks to the week.");
                  }}
                  className="fast mono text-label text-muted hover:text-ink"
                  title="Slot this project's open tasks into this week"
                >
                  ★ slot to this week{inSprint > 0 ? ` (${inSprint})` : ""}
                </button>
              }
            >
              <div data-assess-anchor="tasks">
                <TaskList
                  tasks={tasks}
                  parent={{ projectId: project.id, initiativeId: project.initiativeId, domainId: project.domainId }}
                  accent={accent}
                  composerFirst
                  emptyHint="No tasks yet — dump the steps above, or paste a list."
                />
              </div>
            </Section>

            {/* A quiet meta strip under the work. No derived "status" pill: the only
                real measures of progress are the tasks and whether it's committed to
                a week — both already visible — so a separate state label tracked
                nothing you could act on. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-3 text-label text-muted">
              <span className="mono">{done}/{tasks.length} done</span>
              <StatusControl
                project={project}
                status={status}
                color={statusColor}
                onChange={(s) => (s === "complete" ? setShipping(true) : updateProject(project.id, { status: s }))}
              />
              <div className="flex-1" />
              <div className="mono flex items-center gap-2">
                <span>start <InlineDate value={project.startDate} onChange={(v) => updateProject(project.id, { startDate: v })} /></span>
                <span className="opacity-50">→</span>
                <span>target <InlineDate value={project.targetDate} onChange={(v) => updateProject(project.id, { targetDate: v })} /></span>
              </div>
            </div>

            {/* The Log — the "what's going on" journal that replaced the Brief.
                Full main-column width so it's actually readable. */}
            <Section label="Log">
              <RecordLog kind="project" id={project.id} accent={accent} />
            </Section>
          </>
        }
        scrollRef={scrollRef}
        overlay={assessing && (
          <AssessLayer kind="project" id={project.id} scrollRef={scrollRef} accent={accent} onAccept={applyAssess} onExit={() => setAssessing(false)} />
        )}
        side={assessing ? null : (
          <>
            <SuggestionPanel
              suggestions={suggestions}
              accent={accent}
              onFold={(taskId) => routeTask(taskId, { projectId: project.id })}
              hint="Nothing loose matches yet. Capture tasks to your inbox, and matches surface here."
            />
            <Section label="Activity">
              <ProjectActivityBind projectId={project.id} projectName={project.name} />
            </Section>
          </>
        )}
      />

      <Footer
        onClose={onClose}
        deleteWhat="project"
        onDelete={() => { deleteProject(project.id); onClose(); }}
        note={note}
        leftExtra={!assessing && <AssessButton accent={accent} onClick={() => setAssessing(true)} />}
      />

      {shipping && <ProjectShipAssess id={project.id} onClose={() => setShipping(false)} onShipped={shipped} />}
    </Card>
  );
}

// ── Initiative record ─────────────────────────────────────────────────────────
function krPct(kr: KeyResult) {
  if (kr.target === kr.baseline) return kr.current >= kr.target ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round(((kr.current - kr.baseline) / (kr.target - kr.baseline)) * 100)));
}

// A persistent project composer, mirroring the task composer (TaskList): type a
// name → Enter → the project lands (optimistically, via addProject) and the field
// stays focused for the next one. ⌘/Ctrl+Enter opens the fresh project's record
// to flesh it out; pasting a list creates one project per line. Projects need
// less than tasks to be real (just a name under the initiative), so this makes
// standing up an initiative's projects as fast as jotting its tasks.
function ProjectComposer({
  domainId,
  initiativeId,
  addProject,
  onOpenProject,
}: {
  domainId: string;
  initiativeId: string;
  addProject: (domainId: string, initiativeId: string | null, init?: Partial<Project>) => Promise<Project>;
  onOpenProject: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (open = false) => {
    const name = draft.trim();
    if (!name) return;
    void addProject(domainId, initiativeId, { name }).then((p) => {
      if (open) onOpenProject(p.id);
    });
    setDraft("");
    inputRef.current?.focus();
  };

  // Paste a whole list → one project per non-empty line, in order.
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    const names = text
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*[-*•\d.)\]]+\s*/, "").trim())
      .filter(Boolean);
    if (names.length < 2) return; // let the browser handle a plain single-line paste
    e.preventDefault();
    names.forEach((name) => void addProject(domainId, initiativeId, { name }));
    setDraft("");
    inputRef.current?.focus();
  };

  return (
    <div className="mt-2.5 flex items-center gap-2 rounded-[var(--radius)] border border-line px-3 py-2 focus-within:border-muted">
      <span className="text-muted">＋</span>
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(e.metaKey || e.ctrlKey); }
          if (e.key === "Escape") setDraft("");
        }}
        onPaste={onPaste}
        placeholder="Add a project… ↵ to add another, ⌘↵ to open, or paste a list"
        className="tap flex-1 bg-transparent text-caption outline-none placeholder:text-muted"
      />
    </div>
  );
}

function InitiativeRecord({
  id,
  onClose,
  onOpenProject,
}: {
  id: string;
  onClose: () => void;
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
  const [assessing, setAssessing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!initiative) onClose();
  }, [initiative, onClose]);
  if (!initiative) return null;

  const domain = domainById(data, initiative.domainId);
  const accent = domain?.color ?? "var(--accent)";
  const domains = [...data.domains].sort((a, b) => a.sort - b.sort);

  // Apply an accepted coach patch: the objective one-liner, or a key result.
  const applyAssess = (f: AssessFinding) => {
    if (!f.patch) return;
    if (f.patch.kind === "outcome" && f.patch.outcome) updateInitiative(initiative.id, { outcome: f.patch.outcome });
    else if (f.patch.kind === "kr" && f.anchor.startsWith("kr:")) {
      const krId = f.anchor.slice(3);
      const p: Record<string, unknown> = {};
      if (f.patch.name != null) p.name = f.patch.name;
      if (f.patch.baseline != null && !Number.isNaN(f.patch.baseline)) p.baseline = f.patch.baseline;
      if (f.patch.target != null && !Number.isNaN(f.patch.target)) p.target = f.patch.target;
      if (f.patch.unit != null) p.unit = f.patch.unit;
      if (Object.keys(p).length) updateKeyResult(initiative.id, krId, p);
    }
  };
  const changeDomain = (domainId: string) => {
    updateInitiative(initiative.id, { domainId });
    projectsOf(data, initiative.id).forEach((p) => updateProject(p.id, { domainId }));
  };
  const projects = projectsOf(data, initiative.id);
  const pct = initiativeProgress(data, initiative);
  const suggestions = suggestForInitiative(data, initiative);

  return (
    <Card accent={accent}>
      <Header
        accent={accent}
        crumbs={
          /* Same DomainPicker as projects — domain is identity you change here,
             not a read-only crumb. New initiatives default to domains[0]
             (often Trading); without this, a mis-file looked permanent. */
          <DomainPicker domains={domains} value={initiative.domainId} onChange={changeDomain} />
        }
        title={initiative.name}
        onTitle={(v) => updateInitiative(initiative.id, { name: v })}
        goal={initiative.outcome}
        onGoal={(v) => updateInitiative(initiative.id, { outcome: v })}
        goalPlaceholder="The outcome, one inspiring line — not a task"
        goalLabel="Objective"
        showGoal={false}
        pct={pct}
        onClose={onClose}
      />

      <Body
        main={
          <>
            {/* The OKR block — Objective heads its Key Results, together, so the
                record reads as a true OKR (the Objective is pulled out of the
                masthead into the body for this). */}
            <Section label="Objective">
              <div data-assess-anchor="objective">
                <InlineText
                  value={initiative.outcome}
                  onChange={(v) => updateInitiative(initiative.id, { outcome: v })}
                  placeholder="The outcome, one inspiring line — not a task"
                  className="text-lead font-medium"
                />
              </div>
            </Section>

            <Section
              label={`Key results${initiative.keyResults.length ? ` · ${initiative.keyResults.length}` : ""}`}
              action={
                <button onClick={() => addKeyResult(initiative.id)} className="fast mono text-label text-muted hover:text-ink">+ add</button>
              }
            >
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {initiative.keyResults.map((kr) => (
                  <div key={kr.id} data-assess-anchor={`kr:${kr.id}`} className="group glass-card rounded-[var(--radius)] border border-line p-3">
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
              </div>
              {initiative.keyResults.length === 0 && (
                <div className="rounded-[var(--radius)] border border-dashed border-line p-4 text-center text-caption text-muted">
                  No key results yet — this initiative has no number to move. Add one from a baseline (or draft the full set on the Groom deck) so you read the Gain, not just the gap.
                </div>
              )}
            </Section>

            <Section label={`${projects.length} project${projects.length === 1 ? "" : "s"} feeding it`}>
              {projects.length > 0 ? (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {projects.map((p) => {
                    const pp = projectProgress(data, p);
                    return (
                      <button
                        key={p.id}
                        data-assess-anchor={`project:${p.id}`}
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
                  No projects yet — type one below to carry this initiative's work.
                </div>
              )}
              <ProjectComposer
                domainId={initiative.domainId}
                initiativeId={initiative.id}
                addProject={addProject}
                onOpenProject={onOpenProject}
              />
            </Section>

            {/* Demoted status: state · momentum · counts · dates — domain lives in
                the crumbs (parity with projects). */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-label text-muted">
              <StatusPill
                value={initiative.status}
                options={[...PROJECT_STATUS]}
                colors={PROJECT_STATUS_COLORS}
                labels={PROJECT_STATUS_LABEL}
                filled={initiative.status === "in_progress" ? new Set(["in_progress"]) : undefined}
                onChange={(s) => updateInitiative(initiative.id, { status: s })}
              />
              <MomentumChip value={initiative.momentum} onChange={(m) => updateInitiative(initiative.id, { momentum: m })} />
              <span className="mono">
                {projects.length} project{projects.length === 1 ? "" : "s"} · {initiative.keyResults.length} KR
              </span>
              <div className="flex-1" />
              <div className="mono flex items-center gap-2">
                <span>start <InlineDate value={initiative.startDate} onChange={(v) => updateInitiative(initiative.id, { startDate: v })} /></span>
                <span className="opacity-50">→</span>
                <span>target <InlineDate value={initiative.targetDate} onChange={(v) => updateInitiative(initiative.id, { targetDate: v })} /></span>
              </div>
            </div>

            <Section label="Log">
              <RecordLog kind="initiative" id={initiative.id} accent={accent} />
            </Section>
          </>
        }
        scrollRef={scrollRef}
        overlay={assessing && (
          <AssessLayer kind="initiative" id={initiative.id} scrollRef={scrollRef} accent={accent} onAccept={applyAssess} onExit={() => setAssessing(false)} />
        )}
        side={assessing ? null : (
          <SuggestionPanel
            suggestions={suggestions}
            accent={accent}
            onFold={(taskId) => routeTask(taskId, { projectId: null, initiativeId: initiative.id })}
            hint="Nothing loose matches yet. Capture tasks to your inbox, and matches surface here."
          />
        )}
      />

      <Footer
        onClose={onClose}
        deleteWhat="initiative"
        onDelete={() => { deleteInitiative(initiative.id); onClose(); }}
        leftExtra={!assessing && <AssessButton accent={accent} onClick={() => setAssessing(true)} />}
      />
    </Card>
  );
}

// ── Shared footer ─────────────────────────────────────────────────────────────
function Footer({
  onClose,
  deleteWhat,
  onDelete,
  note,
  leftExtra,
}: {
  onClose: () => void;
  deleteWhat: string;
  onDelete: () => void;
  note?: string | null;
  leftExtra?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 border-t border-line bg-surface/50 px-7 py-3.5">
      <DeleteBtn what={deleteWhat} onDelete={onDelete} />
      {leftExtra}
      {note && <span className="text-label text-muted">{note}</span>}
      <div className="flex-1" />
      <Btn kind="primary" onClick={onClose}>Done</Btn>
    </div>
  );
}

// ── The "Assess" toggle — invites the coach's pass; the record wires the layer ─
function AssessButton({ accent, onClick }: { accent: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="fast inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-meta font-medium text-muted hover:border-line-strong hover:text-ink"
      title="Have Nuvo review this and show where to sharpen it"
    >
      <span style={{ color: accent }}>✦</span> Assess
    </button>
  );
}
