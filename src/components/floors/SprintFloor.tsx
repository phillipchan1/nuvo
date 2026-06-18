// This Week — the sprint funnel. Pull from the three sources (Inbox captures,
// project Backlogs, whole Projects) into a single weekly commitment on the
// right. A capacity meter guards against over-committing; a domain-balance
// strip guards against going quiet on a domain (the faithfulness thesis).
// The funnel body (SprintFunnel) is shared with the Sunday ritual's Pull step.

import { useMemo, useState } from "react";
import { endOfWeek, format, startOfWeek } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import {
  backlogTasks,
  domainById,
  inboxTasks,
  initiativeById,
  isProjectComplete,
  projectById,
  projectProgress,
  projectSprintCount,
  sprintLoadMins,
  sprintMinsByDomain,
  sprintTasks,
  weeklyCapacityHours,
  type VTask,
} from "../../lib/vertical";
import { pullSummary, suggestPull } from "../../lib/pull";
import { fmtHours as hrs } from "../../lib/dates";
import { ENERGY_META } from "../../lib/energy";
import { FloorHeader, InlineText } from "./parts";
import { Btn } from "../ui";

type Source = "inbox" | "backlog" | "projects";

export default function SprintFloor() {
  const { data, setSprintGoal, clearSprint } = useVertical();

  const week = useMemo(() => {
    const now = new Date();
    const s = startOfWeek(now, { weekStartsOn: 1 });
    const e = endOfWeek(now, { weekStartsOn: 1 });
    return `${format(s, "MMM d")} – ${format(e, "MMM d")}`;
  }, []);

  return (
    <div className="mx-auto max-w-[1320px]">
      <FloorHeader
        eyebrow={`Weekly sprint · ${week}`}
        actions={<Btn kind="signal" onClick={clearSprint}>clear week</Btn>}
      >
        <h1 className="text-display masthead">This Week</h1>
        <div className="mt-1 flex items-baseline gap-2 text-head">
          <span className="section-label shrink-0" style={{ marginTop: 2 }}>Goal</span>
          <InlineText
            value={data.sprintGoal ?? ""}
            onChange={setSprintGoal}
            placeholder="What does a good week look like?"
            className="font-medium"
          />
        </div>
      </FloorHeader>

      <SprintFunnel />
    </div>
  );
}

/** The funnel proper: capacity + balance, sources → commitment, suggested pull. */
export function SprintFunnel() {
  const { data, toggleTaskSprint, commitTasksToSprint } = useVertical();
  const [source, setSource] = useState<Source>("backlog");
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);

  const committed = sprintTasks(data).filter((t) => t.status !== "done");
  const loadMins = sprintLoadMins(data);
  const capacityHrs = weeklyCapacityHours(data);
  const loadHrs = loadMins / 60;
  const overPct = capacityHrs > 0 ? Math.min(100, (loadHrs / capacityHrs) * 100) : 0;
  const over = capacityHrs > 0 && loadHrs > capacityHrs;

  const suggestions = useMemo(() => suggestPull(data), [data]);
  const showSuggestions = !suggestionsDismissed && suggestions.length > 0;

  return (
    <div>
      {/* capacity + balance */}
      <div className="mb-4 grid grid-cols-1 gap-4 rounded-md border border-line bg-surface px-4 py-3 lg:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="section-label">Committed load</span>
            <span className="mono text-label" style={{ color: over ? "var(--signal)" : "var(--accent)" }}>
              {hrs(loadMins)}h / {capacityHrs}h {over && "· over"}
            </span>
          </div>
          <div className="relative mt-1.5 h-2 rounded-full bg-bg">
            <div className="fast absolute left-0 top-0 bottom-0 rounded-full" style={{ width: `${overPct}%`, background: over ? "var(--signal)" : "var(--accent)" }} />
          </div>
          <div className="mono mt-1 text-meta text-muted">{committed.length} tasks committed</div>
        </div>
        <div>
          <div className="section-label mb-1.5">Domain balance</div>
          <DomainBalance />
        </div>
      </div>

      {/* the intelligence strip — a starting pull, always yours to prune */}
      {showSuggestions && (
        <div className="mb-6 rounded-md border border-accent/40 bg-accent-soft px-4 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-caption font-medium text-accent">✦ Suggested pull</span>
            <span className="mono text-meta text-muted">{pullSummary(data, suggestions)}</span>
            <div className="flex-1" />
            <button
              onClick={() => commitTasksToSprint(suggestions.map((s) => s.task.id))}
              className="fast mono text-label font-medium text-accent hover:underline"
            >
              add all {suggestions.length}
            </button>
            <button onClick={() => setSuggestionsDismissed(true)} className="fast mono text-label text-muted hover:text-ink">
              dismiss
            </button>
          </div>
          <div className="mt-2 space-y-0.5">
            {suggestions.map((s) => {
              const domain = domainById(data, s.task.domainId);
              return (
                <div key={s.task.id} className="flex items-center gap-2 text-label">
                  <button
                    onClick={() => toggleTaskSprint(s.task.id)}
                    className="fast mono text-meta text-accent hover:underline"
                    title="Add to week"
                  >
                    + add
                  </button>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: domain?.color }} />
                  <span className="min-w-0 truncate">{s.task.title}</span>
                  <span className="mono shrink-0 text-micro text-muted">{s.reason} · {s.task.durationMins}m</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* funnel: sources → commitment */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* left: sources */}
        <section className="lg:col-span-6">
          <div className="mb-3 inline-flex rounded-md border border-line p-0.5">
            {(["inbox", "backlog", "projects"] as Source[]).map((s) => (
              <button
                key={s}
                onClick={() => setSource(s)}
                className="fast mono rounded-[5px] px-3 py-1 text-label"
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
  if (total === 0) return <div className="mono text-meta text-muted italic">Nothing committed yet.</div>;
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-bg">
        {split.map((x) => (
          <div key={x.domain.id} title={`${x.domain.name} · ${hrs(x.mins)}h`} style={{ width: `${(x.mins / total) * 100}%`, background: x.domain.color }} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {split.map((x) => (
          <span key={x.domain.id} className="mono flex items-center gap-1 text-micro text-muted">
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
        className="fast flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-micro"
        style={{ borderColor: task.sprint ? "var(--signal)" : "var(--line)", background: task.sprint ? "var(--signal)" : "transparent", color: "#fff" }}
        title={task.sprint ? "Remove from week" : "Add to week"}
      >
        {task.sprint ? "★" : ""}
      </button>
      <span className="shrink-0 text-label" style={{ color: accent }} title={task.energy ?? ""}>{task.energy ? ENERGY_META[task.energy].icon : "·"}</span>
      <span className={`min-w-0 flex-1 truncate text-caption ${task.sprint ? "text-muted" : ""}`}>{task.title || "untitled"}</span>
      {project && <span className="mono hidden shrink-0 truncate text-micro text-muted sm:inline" style={{ maxWidth: 120 }}>{project.name}</span>}
      <span className="mono shrink-0 text-meta text-muted">{task.durationMins}m</span>
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
  const { data, commitTasksToSprint } = useVertical();
  const items = backlogTasks(data);
  const focus = new Set(data.focusInitiativeIds);

  // group by project, falling back to the initiative or domain a loose task
  // was routed to in the Sweep — everything processed stays pullable
  const groups = useMemo(() => {
    interface Group { key: string; label: string; color?: string; lead: boolean; tasks: VTask[] }
    const m = new Map<string, Group>();
    items.forEach((t) => {
      const project = projectById(data, t.projectId);
      const initiative = initiativeById(data, project?.initiativeId ?? t.initiativeId);
      const domain = domainById(data, project?.domainId ?? initiative?.domainId ?? t.domainId);
      const key = project?.id ?? (initiative ? `i:${initiative.id}` : `d:${t.domainId}`);
      const g = m.get(key) ?? {
        key,
        label: project?.name ?? (initiative ? `${initiative.name} · loose` : `${domain?.name ?? "—"} · someday`),
        color: domain?.color,
        lead: focus.has(project?.initiativeId ?? initiative?.id ?? ""),
        tasks: [],
      };
      g.tasks.push(t);
      m.set(key, g);
    });
    // the week's lead initiatives surface first — pull the right next steps
    return [...m.values()].sort((a, b) => Number(b.lead) - Number(a.lead));
  }, [items, data, focus]);

  if (groups.length === 0) return <Empty>No backlog — everything processed is done.</Empty>;
  return (
    <div>
      <Hint>Ready work under each project (and loose, routed work). Add tasks one by one, or pull a group in.</Hint>
      <div className="space-y-3">
        {groups.map((g) => {
          const remaining = g.tasks.filter((t) => !t.sprint);
          return (
            <div key={g.key}>
              <div className="mb-0.5 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: g.color }} />
                <span className="text-label font-medium">{g.label}</span>
                {g.lead && <span className="mono text-micro" style={{ color: "var(--signal)" }}>★ lead</span>}
                {remaining.length > 0 && (
                  <button
                    onClick={() => commitTasksToSprint(remaining.map((t) => t.id))}
                    className="fast mono ml-auto text-micro text-muted hover:text-signal"
                    title="Add all ready tasks"
                  >
                    + add all {remaining.length}
                  </button>
                )}
              </div>
              {g.tasks.map((t) => <CandidateRow key={t.id} task={t} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProjectsSource() {
  const { data, addProjectReadyToSprint } = useVertical();
  const focus = new Set(data.focusInitiativeIds);
  const projects = data.projects
    .filter((p) => !isProjectComplete(p.status))
    .sort((a, b) => Number(focus.has(b.initiativeId ?? "")) - Number(focus.has(a.initiativeId ?? "")));
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
                <div className="truncate text-caption">
                  {p.name}
                  {focus.has(p.initiativeId ?? "") && <span className="mono ml-1.5 text-micro" style={{ color: "var(--signal)" }}>★</span>}
                </div>
                <div className="mono truncate text-micro text-muted">{initiative?.name ?? domain?.name} · {pct}%</div>
              </div>
              {inSprint > 0 && <span className="mono shrink-0 text-micro" style={{ color: "var(--signal)" }}>★ {inSprint}</span>}
              <button onClick={() => addProjectReadyToSprint(p.id)} className="fast mono shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-micro text-muted hover:border-signal hover:text-signal">
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
        <div className="text-body text-muted">Your week is empty.</div>
        <div className="mono mt-1 text-label text-muted">Pull work from the sources on the left to commit it.</div>
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
              <span className="text-caption font-medium">{domain.name}</span>
              <span className="mono ml-auto text-meta text-muted">{tasks.length} · {hrs(mins)}h</span>
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
        className="fast flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-meta"
        style={{ borderColor: task.status === "done" ? accent : "var(--line)", background: task.status === "done" ? accent : "transparent", color: "#fff" }}
        title="Mark done"
      >
        {task.status === "done" ? "✓" : ""}
      </button>
      <span className="shrink-0 text-label" style={{ color: accent }}>{task.energy ? ENERGY_META[task.energy].icon : "·"}</span>
      <span className={`min-w-0 flex-1 truncate text-caption ${task.status === "done" ? "text-muted line-through" : ""}`}>{task.title || "untitled"}</span>
      <span className="mono hidden shrink-0 truncate text-micro text-muted sm:inline" style={{ maxWidth: 110 }}>{ctx}</span>
      <span className="mono shrink-0 text-meta text-muted">{task.durationMins}m</span>
      <button onClick={onRemove} className="fast shrink-0 text-caption text-muted opacity-0 hover:text-signal group-hover:opacity-100" title="Remove from week">×</button>
    </div>
  );
}

// ── tiny helpers ─────────────────────────────────────────────────────────────
function Hint({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-label text-muted">{children}</div>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-6 text-center text-caption text-muted italic">{children}</div>;
}
