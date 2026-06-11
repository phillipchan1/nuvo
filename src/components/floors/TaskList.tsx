// Inline, fully-CRUD task list. Used for a project's backlog and for the loose
// tasks that hang straight off an initiative or domain (the "teach my kid to
// ride a bike" case — first-class work that deserves no project).

import { useVertical } from "../../hooks/useVertical";
import { emptyTask, type VTask } from "../../lib/vertical";
import { DeleteBtn, EnergyPicker, InlineNumber, InlineText } from "./parts";

export interface TaskParent {
  projectId?: string | null;
  initiativeId?: string | null;
  domainId?: string | null;
}

export default function TaskList({
  tasks,
  parent,
  accent,
  emptyHint = "No tasks yet.",
}: {
  tasks: VTask[];
  parent: TaskParent;
  accent: string;
  emptyHint?: string;
}) {
  const { addTask, updateTask, deleteTask, toggleTask } = useVertical();

  const add = () => {
    const t = emptyTask(parent);
    t.title = "";
    addTask(t);
  };

  return (
    <div>
      {tasks.map((t) => (
        <div key={t.id} className="group flex items-center gap-2.5 border-b border-line py-2">
          <button
            onClick={() => toggleTask(t.id)}
            className="fast flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-[10px]"
            style={{
              borderColor: t.status === "done" ? accent : "var(--line)",
              background: t.status === "done" ? accent : "transparent",
              color: "#fff",
            }}
            title={t.status === "done" ? "Mark not done" : "Mark done"}
          >
            {t.status === "done" ? "✓" : ""}
          </button>

          <EnergyPicker value={t.energy} onChange={(e) => updateTask(t.id, { energy: e })} color={accent} />

          <InlineText
            value={t.title}
            onChange={(v) => updateTask(t.id, { title: v })}
            placeholder="Untitled task"
            autoFocusEmpty
            className={`min-w-0 flex-1 text-[13px] ${t.status === "done" ? "text-muted line-through" : ""}`}
          />

          <span className="mono shrink-0 text-[10px] text-muted">
            <InlineNumber value={t.durationMins} onChange={(v) => updateTask(t.id, { durationMins: v })} suffix="m" />
          </span>

          {/* status cycle: ready → blocked → ready (done is the checkbox) */}
          <button
            onClick={() => updateTask(t.id, { status: t.status === "blocked" ? "ready" : "blocked" })}
            className="mono w-14 shrink-0 text-right text-[10px]"
            style={{ color: t.status === "blocked" ? "var(--signal)" : "var(--muted)" }}
            title="Toggle blocked"
          >
            {t.status}
          </button>

          <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
            <DeleteBtn what="task" onDelete={() => deleteTask(t.id)} />
          </div>
        </div>
      ))}

      {tasks.length === 0 && <div className="py-2 text-[12px] text-muted italic">{emptyHint}</div>}

      <button onClick={add} className="fast mono mt-2 text-[11px] text-muted hover:text-ink">+ add task</button>
    </div>
  );
}
