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
  StatusPill,
} from "./parts";
import TaskList from "./TaskList";
import { Btn } from "../ui";

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
  const { data, updateProject, deleteProject } = useVertical();
  const project = projectById(data, focus.projectId);
  const initiative = initiativeById(data, focus.initiativeId);
  const domain = domainById(data, focus.domainId);
  const [note, setNote] = useState<string | null>(null);

  if (!project) return <div className="text-[13px] text-muted">No project selected.</div>;
  const tasks = tasksOf(data, project.id);
  const pct = projectProgress(data, project);

  const barColor = (status: string) =>
    status === "done" ? "var(--muted)" : status === "blocked" ? "var(--signal)" : accent;

  // derive a position for tasks that don't carry one, so the Gantt is never empty
  const n = Math.max(1, tasks.length);
  const positioned = tasks.map((t, i) => ({
    t,
    tl: t.tl ?? { start: i / n, span: Math.max(0.12, 0.85 / n) },
  }));

  return (
    <div className="mx-auto max-w-[1080px]">
      <FloorHeader
        eyebrow={
          <span className="flex items-center gap-2.5">
            {onBack && <button onClick={onBack} className="fast mono text-[10px] text-muted hover:text-ink">‹ all projects</button>}
            {domain && <span className="mono text-[10px]" style={{ color: domain.color }}>{domain.icon} {domain.name}</span>}
            <Hook dir="up" label={initiative?.name ?? "no initiative"} onClick={initiative ? onUp : undefined} />
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <StatusPill value={project.status} options={PROJECT_STATUS} colors={PROJECT_STATUS_COLORS} onChange={(s) => updateProject(project.id, { status: s })} />
            <DeleteBtn what="project" onDelete={() => { deleteProject(project.id); onUp(); }} />
          </div>
        }
      >
        <h1 className="text-[23px] font-semibold tracking-tight">
          <InlineText value={project.name} onChange={(v) => updateProject(project.id, { name: v })} />
        </h1>
        <div className="mt-1.5 flex items-baseline gap-2 text-[14px]">
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
            <span className="mono text-[11px]" style={{ color: accent }}>{pct}%</span>
          </div>
          <Bar pct={pct} color={accent} />
        </div>
        <div className="mono flex items-center gap-4 text-[11px] text-muted">
          <span>start <InlineDate value={project.startDate} onChange={(v) => updateProject(project.id, { startDate: v })} /></span>
          <span>·</span>
          <span>target <InlineDate value={project.targetDate} onChange={(v) => updateProject(project.id, { targetDate: v })} /></span>
        </div>
      </div>

      {/* description */}
      <div className="mb-7">
        <InlineTextarea
          value={project.description}
          onChange={(v) => updateProject(project.id, { description: v })}
          placeholder="Notes, scope, what's in and out…"
          className="max-w-[720px] text-[14px] text-muted"
        />
      </div>

      {/* Gantt */}
      <section className="mb-8">
        <div className="section-label mb-2">Task timeline</div>
        <div className="rounded-md border border-line bg-surface p-4">
          <div className="mb-1.5 flex pl-[150px]">
            {["W1", "W2", "W3", "W4"].map((w) => <div key={w} className="mono flex-1 text-[9px] text-muted">{w}</div>)}
          </div>
          {positioned.map(({ t, tl }) => (
            <div key={t.id} className="mb-1 flex items-center">
              <span className="w-[146px] truncate pr-2 text-[11px]" title={t.title}>
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
          {tasks.length === 0 && <div className="py-3 text-center text-[11px] text-muted italic">Add tasks below to populate the timeline.</div>}
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
        <Btn kind="signal" onClick={() => setNote("AI would scaffold ~3 more tasks here, sequenced on the timeline — wired to the agent next.")}>✦ scaffold with AI</Btn>
        <Btn onClick={() => setNote("Sent ready tasks to your Day backlog — they'll show under 'ready to schedule'.")}>→ send ready to Day</Btn>
        {note && <span className="text-[11px] text-muted">{note}</span>}
      </div>
    </div>
  );
}
