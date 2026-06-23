// Project — a chunk of work with its own tasks and timeline. Full treatment:
// name + goal + description, start/target dates, a task Gantt, and the task
// backlog with full inline CRUD. Progress is derived from the tasks (the Gain
// rippling up into the initiative).

import { useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import {
  domainById,
  initiativeById,
  projectById,
  projectProgress,
  projectSprintCount,
  tasksOf,
} from "../../lib/vertical";
import { ENERGY_META } from "../../lib/energy";
import type { Focus } from "../AppShell";
import {
  Bar,
  DeleteBtn,
  FloorHeader,
  Hook,
  InlineDate,
  InlineText,
  InlineTextarea,
  PROJECT_STATUS,
  PROJECT_STATUS_COLORS,
  PROJECT_STATUS_LABEL,
  RipenessPip,
  StatusPill,
} from "./parts";
import { RIPENESS_HINT, RIPENESS_LABEL, ripenessOfProject, verdictOf } from "../../lib/tending";
import { projectPace, type PaceRead, type ProjectPace } from "../../lib/pace";
import TaskList from "./TaskList";
import { Btn } from "../ui";

// ── Pace presentation — tone + phrasing for the weekly-rate verdict ──────────
const PACE_TONE: Record<PaceRead, "signal" | "accent" | "muted"> = {
  behind: "signal",
  overdue: "signal",
  stalled: "signal",
  ahead: "accent",
  on_track: "accent",
  undated: "muted",
  clear: "muted",
};

function hrs(mins: number): string {
  const h = mins / 60;
  return h >= 10 ? `${Math.round(h)}h` : `${Math.round(h * 10) / 10}h`;
}

function driftPhrase(days: number, word: "behind" | "ahead"): string {
  if (days >= 14) return `${Math.round(days / 7)} wks ${word}`;
  if (days >= 7) return `1 wk ${word}`;
  return `${days}d ${word}`;
}

function paceVerdict(p: ProjectPace): string {
  switch (p.read) {
    case "behind":
      return driftPhrase(p.driftDays ?? 0, "behind");
    case "ahead":
      return driftPhrase(-(p.driftDays ?? 0), "ahead");
    case "on_track":
      return "on pace";
    case "overdue":
      return `${p.driftDays}d overdue`;
    case "stalled":
      return "stalled — no recent motion";
    case "undated":
      return "no finish line yet — set a target to pace it";
    case "clear":
      return "no open work to pace";
  }
}

export default function ProjectFloor({
  focus,
  accent,
  onUp,
  onBack,
}: {
  focus: Focus;
  accent: string;
  onUp: () => void;
  onBack?: () => void;
}) {
  const { data, updateProject, deleteProject, addProjectReadyToSprint } = useVertical();
  const project = projectById(data, focus.projectId);
  const initiative = initiativeById(data, focus.initiativeId);
  const domain = domainById(data, focus.domainId);
  const [note, setNote] = useState<string | null>(null);

  if (!project) return <div className="text-body text-muted">No project selected.</div>;
  const tasks = tasksOf(data, project.id);
  const pct = projectProgress(data, project);
  const inSprint = projectSprintCount(data, project.id);
  const ripe = ripenessOfProject(data, project);
  const pace = projectPace(data, project, new Date());
  const paceTone =
    PACE_TONE[pace.read] === "signal" ? "var(--signal)" : PACE_TONE[pace.read] === "accent" ? accent : "var(--muted)";

  const barColor = (status: string) => (status === "complete" || status === "done" ? "var(--muted)" : accent);

  // sequence the Gantt by list order (a → b → c)
  const n = Math.max(1, tasks.length);
  const positioned = tasks.map((t, i) => ({
    t,
    tl: { start: (i / n) * 0.92, span: Math.max(0.12, 0.85 / n) },
  }));

  return (
    <div className="mx-auto max-w-[1080px]">
      <FloorHeader
        eyebrow={
          <span className="flex items-center gap-2.5">
            {onBack && <button onClick={onBack} className="fast mono text-meta text-muted hover:text-ink">‹ all projects</button>}
            {domain && <span className="mono text-meta" style={{ color: domain.color }}>{domain.icon} {domain.name}</span>}
            <Hook dir="up" label={initiative?.name ?? "no initiative"} onClick={initiative ? onUp : undefined} />
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <span className="mono flex items-center gap-1.5 text-meta text-muted" title={RIPENESS_HINT[ripe.stage]}>
              <RipenessPip stage={ripe.stage} unsound={ripe.stage === "active" && verdictOf(data, "project", project.id)?.sound !== true} />
              {RIPENESS_LABEL[ripe.stage]}
            </span>
            <StatusPill
              value={project.status}
              options={PROJECT_STATUS}
              colors={PROJECT_STATUS_COLORS}
              labels={PROJECT_STATUS_LABEL}
              filled={project.status === "in_progress" ? new Set(["in_progress"]) : undefined}
              onChange={(s) => updateProject(project.id, { status: s })}
            />
            <DeleteBtn what="project" onDelete={() => { deleteProject(project.id); onUp(); }} />
          </div>
        }
      >
        <h1 className="text-display masthead">
          <InlineText value={project.name} onChange={(v) => updateProject(project.id, { name: v })} />
        </h1>
        <div className="mt-1.5 flex items-baseline gap-2 text-head">
          <span className="section-label shrink-0" style={{ marginTop: 2 }}>Goal</span>
          <InlineText
            value={project.outcome}
            onChange={(v) => updateProject(project.id, { outcome: v })}
            placeholder="What does done look like, in one line?"
            className="font-medium"
          />
        </div>
      </FloorHeader>

      {/* progress + dates */}
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-line bg-surface px-4 py-3">
        <div className="min-w-[200px] flex-1">
          <div className="flex items-baseline justify-between">
            <span className="section-label">Progress ({tasks.filter((t) => t.status === "done").length}/{tasks.length} tasks)</span>
            <span className="mono text-label" style={{ color: accent }}>{pct}%</span>
          </div>
          <Bar pct={pct} color={accent} />
        </div>
        <div className="mono flex items-center gap-4 text-label text-muted">
          <span>start <InlineDate value={project.startDate} onChange={(v) => updateProject(project.id, { startDate: v })} /></span>
          <span>·</span>
          <span>target <InlineDate value={project.targetDate} onChange={(v) => updateProject(project.id, { targetDate: v })} /></span>
        </div>

        {/* pace — the project as a weekly rate, and its drift against the target */}
        <div className="flex w-full flex-wrap items-center gap-x-5 gap-y-1 border-t border-line pt-2.5">
          <span className="section-label">Pace</span>
          {pace.read === "undated" || pace.read === "clear" ? (
            <span className="text-label text-muted">{paceVerdict(pace)}</span>
          ) : (
            <>
              {pace.read !== "overdue" && pace.requiredMinsPerWeek > 0 && (
                <span className="mono text-label text-muted">
                  <span className="text-ink">~{hrs(pace.requiredMinsPerWeek)}/wk</span> to finish on time
                </span>
              )}
              <span className="mono text-label text-muted">{hrs(pace.remainingMins)} left</span>
              {pace.recentMinsPerWeek > 0 && (
                <span className="mono text-label text-muted">~{hrs(pace.recentMinsPerWeek)}/wk lately</span>
              )}
              <span className="mono ml-auto flex items-center gap-1.5 text-label" style={{ color: paceTone }}>
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: paceTone }} />
                {paceVerdict(pace)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* description */}
      <div className="mb-7">
        <InlineTextarea
          value={project.description}
          onChange={(v) => updateProject(project.id, { description: v })}
          placeholder="Notes, scope, what's in and out…"
          className="max-w-[720px] text-head text-muted"
        />
      </div>

      {/* Gantt */}
      <section className="mb-8">
        <div className="section-label mb-2">Task timeline</div>
        <div className="rounded-md border border-line bg-surface p-4">
          <div className="mb-1.5 flex pl-[150px]">
            {["W1", "W2", "W3", "W4"].map((w) => <div key={w} className="mono flex-1 text-micro text-muted">{w}</div>)}
          </div>
          {positioned.map(({ t, tl }) => (
            <div key={t.id} className="mb-1 flex items-center">
              <span className="w-[146px] truncate pr-2 text-label" title={t.title}>
                <span className="mr-1" style={{ color: accent }}>{t.energy ? ENERGY_META[t.energy].icon : "·"}</span>
                {t.title || "untitled"}
              </span>
              <div className="relative h-4 flex-1 rounded-sm bg-bg">
                {[25, 50, 75].map((g) => <div key={g} className="absolute top-0 bottom-0 w-px bg-line" style={{ left: `${g}%` }} />)}
                <div
                  className="fast absolute top-0.5 bottom-0.5 rounded-sm"
                  style={{ left: `${tl.start * 100}%`, width: `${tl.span * 100}%`, background: barColor(t.status), opacity: t.status === "done" ? 0.45 : 1 }}
                  title={`${t.title} · ${t.durationMins}m`}
                />
              </div>
            </div>
          ))}
          {tasks.length === 0 && <div className="py-3 text-center text-label text-muted italic">Add tasks below to populate the timeline.</div>}
        </div>
      </section>

      {/* task backlog — full CRUD */}
      <section>
        <div className="section-label mb-1.5">Tasks</div>
        <TaskList
          tasks={tasks}
          parent={{ projectId: project.id, initiativeId: project.initiativeId, domainId: project.domainId }}
          accent={accent}
          emptyHint="No tasks yet — add the first step."
        />
      </section>

      <div className="mt-6 flex items-center gap-2">
        <Btn onClick={() => { addProjectReadyToSprint(project.id); setNote("Committed this project's open tasks to the week — they're in the Week rail now."); }}>
          ★ commit to week{inSprint > 0 ? ` (${inSprint} in)` : ""}
        </Btn>
        {note && <span className="text-label text-muted">{note}</span>}
        <span className="mono ml-auto text-meta text-muted">Grooming moved to ◇ Tending — ripen this from the spine.</span>
      </div>
    </div>
  );
}
