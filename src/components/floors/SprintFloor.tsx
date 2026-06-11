// This Week — the sprint funnel. Pull from the three sources (Inbox captures,
// project Backlogs, whole Projects) into a single weekly commitment on the
// right. A capacity meter guards against over-committing; a domain-balance
// strip guards against going quiet on a domain (the faithfulness thesis).

import { useMemo, useState } from "react";
import { endOfWeek, format, startOfWeek } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import {
  backlogTasks,
  domainById,
  inboxTasks,
  initiativeById,
  projectById,
  projectProgress,
  projectSprintCount,
  sprintLoadMins,
  sprintMinsByDomain,
  sprintTasks,
  weeklyCapacityHours,
  type VTask,
} from "../../lib/vertical";
import { ENERGY_META } from "../../lib/energy";
import { FloorHeader, InlineText } from "./parts";
import { Btn } from "../ui";

type Source = "inbox" | "backlog" | "projects";

const hrs = (mins: number) => (mins / 60).toFixed(mins % 60 === 0 ? 0 : 1);

export default function SprintFloor() {
  const { data, setSprintGoal, clearSprint } = useVertical();
  const [source, setSource] = useState<Source>("backlog");
  const [note, setNote] = useState<string | null>(null);

  const week = useMemo(() => {
    const now = new Date();
    const s = startOfWeek(now, { weekStartsOn: 1 });
    const e = endOfWeek(now, { weekStartsOn: 1 });
    return `${format(s, "MMM d")} – ${format(e, "MMM d")}`;
  }, []);

  const committed = sprintTasks(data).filter((t) => t.status !== "done");
  const loadMins = sprintLoadMins(data);
  const capacityHrs = weeklyCapacityHours(data);
  const loadHrs = loadMins / 60;
  const overPct = Math.min(100, (loadHrs / capacityHrs) * 100);
  const over = loadHrs > capacityHrs;

  return (
    <div className="mx-auto max-w-[1320px]">
      <FloorHeader
        eyebrow={`Weekly sprint · ${week}`}
        actions={
          <div className="flex items-center gap-2">
            <Btn onClick={() => setNote("Sent committed tasks to your Day backlog — schedule them on the calendar.")}>send to Day →</Btn>
            <Btn kind="signal" onClick={clearSprint}>clear week</Btn>
          </div>
        }
      >
        <h1 className="text-[24px] font-semibold tracking-tight">This Week</h1>
        <div className="mt-1 flex items-baseline gap-2 text-[14px]">
          <span className="section-label shrink-0" style={{ marginTop: 2 }}>Goal</span>
          <InlineText
            value={data.sprintGoal ?? ""}
            onChange={setSprintGoal}
            placeholder="What does a good week look like?"
            className="font-medium"
          />
        </div>
      </FloorHeader>

      {/* capacity + balance */}
      <div className="mb-6 grid grid-cols-1 gap-4 rounded-md border border-line bg-surface px-4 py-3 lg:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="section-label">Committed load</span>
            <span className="mono text-[11px]" style={{ color: over ? "var(--signal)" : "var(--accent)" }}>
              {hrs(loadMins)}h / {capacityHrs}h {over && "· over"}
            </span>
          </div>
          <div className="relative mt-1.5 h-2 rounded-full bg-bg">
            <div className="fast absolute left-0 top-0 bottom-0 rounded-full" style={{ width: `${overPct}%`, background: over ? "var(--signal)" : "var(--accent)" }} />
          </div>
          <div className="mono mt-1 text-[10px] text-muted">{committed.length} tasks committed</div>
        </div>
        <div>
          <div className="section-label mb-1.5">Domain balance</div>
          <DomainBalance />
        </div>
      </div>

      {/* funnel: sources → commitment */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* left: sources */}
        <section className="lg:col-span-6">
          <div className="mb-3 inline-flex rounded-md border border-line p-0.5">
            {(["inbox", "backlog", "projects"] as Source[]).map((s) => (
              <button
                key={s}
                onClick={() => setSource(s)}
                className="fast mono rounded-[5px] px-3 py-1 text-[11px]"
                style={{ background: source === s ? "var(--accent)" : "transparent", color: source === s ? "#fff" : "var(--muted)" }}
              >
                {s === "inbox" ? "Inbox" : s === "backlog" ? "Backlogs" : "Projects"}
              </button>
            ))}
          </div>

          <div className="rounded-md border border-line bg-surface p-3">
            {source === "inbox" && <InboxSource />}
            {source === "backlog" && <BacklogSource />}
            {source === "projects" && <ProjectsSource />}
          </div>
        </section>

        {/* right: the committed week */}
        <section className="lg:col-span-6">
          <div className="section-label mb-3">This week's commitment</div>
          <SprintColumn />
          {note && <div className="mt-3 text-[11px] text-muted">{note}</div>}
        </section>
      </div>
    </div>
  );
}

// ── domain balance strip ─────────────────────────────────────────────────────
function DomainBalance() {
  const { data } = useVertical();
  const split = sprintMinsByDomain(data);
  const total = split.reduce((s, x) => s + x.mins, 0);
  if (total === 0) return <div className="mono text-[10px] text-muted italic">Nothing committed yet.</div>;
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-bg">
        {split.map((x) => (
          <div key={x.domain.id} title={`${x.domain.name} · ${hrs(x.mins)}h`} style={{ width: `${(x.mins / total) * 100}%`, background: x.domain.color }} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {split.map((x) => (
          <span key={x.domain.id} className="mono flex items-center gap-1 text-[9px] text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: x.domain.color }} />
            {x.domain.name} {hrs(x.mins)}h
          </span>
        ))}
      </div>
    </div>
  );
}

// ── candidate row (a task you can add/remove) ────────────────────────────────
function CandidateRow({ task }: { task: VTask }) {
  const { data, toggleTaskSprint } = useVertical();
  const domain = domainById(data, task.domainId);
  const project = projectById(data, task.projectId);
  const accent = domain?.color ?? "var(--muted)";
  return (
    <div className="group flex items-center gap-2.5 border-b border-line py-1.5">
      <button
        onClick={() => toggleTaskSprint(task.id)}
        className="fast flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-[9px]"
        style={{ borderColor: task.sprint ? "var(--signal)" : "var(--line)", background: task.sprint ? "var(--signal)" : "transparent", color: "#fff" }}
        title={task.sprint ? "Remove from week" : "Add to week"}
      >
        {task.sprint ? "★" : ""}
      </button>
      <span className="shrink-0 text-[11px]" style={{ color: accent }} title={task.energy ?? ""}>{task.energy ? ENERGY_META[task.energy].icon : "·"}</span>
      <span className={`min-w-0 flex-1 truncate text-[12px] ${task.sprint ? "text-muted" : ""}`}>{task.title || "untitled"}</span>
      {project && <span className="mono hidden shrink-0 truncate text-[9px] text-muted sm:inline" style={{ maxWidth: 120 }}>{project.name}</span>}
      <span className="mono shrink-0 text-[10px] text-muted">{task.durationMins}m</span>
    </div>
  );
}

function InboxSource() {
  const { data } = useVertical();
  const items = inboxTasks(data);
  if (items.length === 0) return <Empty>Inbox is clear — no loose captures waiting.</Empty>;
  return (
    <div>
      <Hint>Loose captures with no project. Pull the ones worth doing this week.</Hint>
      {items.map((t) => <CandidateRow key={t.id} task={t} />)}
    </div>
  );
}

function BacklogSource() {
  const { data, addProjectReadyToSprint } = useVertical();
  const items = backlogTasks(data);
  const groups = useMemo(() => {
    const m = new Map<string, VTask[]>();
    items.forEach((t) => {
      const k = t.projectId!;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    });
    return [...m.entries()];
  }, [items]);

  if (groups.length === 0) return <Empty>No project backlog — every project task is done.</Empty>;
  return (
    <div>
      <Hint>Ready work under each project. Add tasks one by one, or pull a whole project in.</Hint>
      <div className="space-y-3">
        {groups.map(([projectId, tasks]) => {
          const project = projectById(data, projectId);
          const domain = domainById(data, project?.domainId ?? null);
          const remaining = tasks.filter((t) => !t.sprint).length;
          return (
            <div key={projectId}>
              <div className="mb-0.5 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: domain?.color }} />
                <span className="text-[11px] font-medium">{project?.name}</span>
                {remaining > 0 && (
                  <button onClick={() => addProjectReadyToSprint(projectId)} className="fast mono ml-auto text-[9px] text-muted hover:text-signal" title="Add all ready tasks">
                    + add all {remaining}
                  </button>
                )}
              </div>
              {tasks.map((t) => <CandidateRow key={t.id} task={t} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProjectsSource() {
  const { data, addProjectReadyToSprint } = useVertical();
  const projects = data.projects.filter((p) => p.status !== "done");
  if (projects.length === 0) return <Empty>No active projects.</Empty>;
  return (
    <div>
      <Hint>Commit a whole project — pulls all its ready tasks into the week.</Hint>
      <div className="space-y-1">
        {projects.map((p) => {
          const domain = domainById(data, p.domainId);
          const initiative = initiativeById(data, p.initiativeId);
          const inSprint = projectSprintCount(data, p.id);
          const pct = projectProgress(data, p);
          return (
            <div key={p.id} className="flex items-center gap-2.5 border-b border-line py-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: domain?.color }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px]">{p.name}</div>
                <div className="mono truncate text-[9px] text-muted">{initiative?.name ?? domain?.name} · {pct}%</div>
              </div>
              {inSprint > 0 && <span className="mono shrink-0 text-[9px]" style={{ color: "var(--signal)" }}>★ {inSprint}</span>}
              <button onClick={() => addProjectReadyToSprint(p.id)} className="fast mono shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-[9px] text-muted hover:border-signal hover:text-signal">
                ★ commit
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── the committed week, grouped by domain ────────────────────────────────────
function SprintColumn() {
  const { data, toggleTaskSprint, toggleTask } = useVertical();
  const committed = sprintTasks(data);
  if (committed.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-line p-8 text-center">
        <div className="text-[13px] text-muted">Your week is empty.</div>
        <div className="mono mt-1 text-[11px] text-muted">Pull work from the sources on the left to commit it.</div>
      </div>
    );
  }
  const byDomain = data.domains
    .map((domain) => ({ domain, tasks: committed.filter((t) => t.domainId === domain.id) }))
    .filter((g) => g.tasks.length > 0);
  // tasks with no domain still belong somewhere
  const orphan = committed.filter((t) => !t.domainId);

  return (
    <div className="space-y-4">
      {byDomain.map(({ domain, tasks }) => {
        const mins = tasks.filter((t) => t.status !== "done").reduce((s, t) => s + t.durationMins, 0);
        return (
          <div key={domain.id} className="rounded-md border border-line bg-surface">
            <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: domain.color }} />
              <span className="text-[12px] font-medium">{domain.name}</span>
              <span className="mono ml-auto text-[10px] text-muted">{tasks.length} · {hrs(mins)}h</span>
            </div>
            <div className="px-3 py-1">
              {tasks.map((t) => <CommittedRow key={t.id} task={t} accent={domain.color} onToggleDone={() => toggleTask(t.id)} onRemove={() => toggleTaskSprint(t.id)} />)}
            </div>
          </div>
        );
      })}
      {orphan.length > 0 && (
        <div className="rounded-md border border-line bg-surface px-3 py-1">
          {orphan.map((t) => <CommittedRow key={t.id} task={t} accent="var(--muted)" onToggleDone={() => toggleTask(t.id)} onRemove={() => toggleTaskSprint(t.id)} />)}
        </div>
      )}
    </div>
  );
}

function CommittedRow({ task, accent, onToggleDone, onRemove }: { task: VTask; accent: string; onToggleDone: () => void; onRemove: () => void }) {
  const { data } = useVertical();
  const project = projectById(data, task.projectId);
  const initiative = initiativeById(data, task.initiativeId);
  const ctx = project?.name ?? initiative?.name ?? "loose";
  return (
    <div className="group flex items-center gap-2.5 border-b border-line py-1.5 last:border-0">
      <button
        onClick={onToggleDone}
        className="fast flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-[10px]"
        style={{ borderColor: task.status === "done" ? accent : "var(--line)", background: task.status === "done" ? accent : "transparent", color: "#fff" }}
        title="Mark done"
      >
        {task.status === "done" ? "✓" : ""}
      </button>
      <span className="shrink-0 text-[11px]" style={{ color: accent }}>{task.energy ? ENERGY_META[task.energy].icon : "·"}</span>
      <span className={`min-w-0 flex-1 truncate text-[12px] ${task.status === "done" ? "text-muted line-through" : ""}`}>{task.title || "untitled"}</span>
      <span className="mono hidden shrink-0 truncate text-[9px] text-muted sm:inline" style={{ maxWidth: 110 }}>{ctx}</span>
      <span className="mono shrink-0 text-[10px] text-muted">{task.durationMins}m</span>
      <button onClick={onRemove} className="fast shrink-0 text-[12px] text-muted opacity-0 hover:text-signal group-hover:opacity-100" title="Remove from week">×</button>
    </div>
  );
}

// ── tiny helpers ─────────────────────────────────────────────────────────────
function Hint({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-[11px] text-muted">{children}</div>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-6 text-center text-[12px] text-muted italic">{children}</div>;
}
