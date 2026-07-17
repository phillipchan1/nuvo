// Inline, fully-CRUD task list. Used for a project's backlog and for the loose
// tasks that hang straight off an initiative or domain (the "teach my kid to
// ride a bike" case — first-class work that deserves no project).
//
// Built for speed: a persistent composer at the bottom (type → Enter → it lands
// and the field stays focused for the next, Todoist-style). Rows stay quiet —
// checkbox · title · duration · the Week star · delete — and energy is set
// elsewhere (planning), not here. Delete is instant with an Undo toast. When the
// list belongs to a project, "✦ Refine with Nuvo" proposes a reviewable diff.

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useVertical, type TaskParent } from "../../hooks/useVertical";
import type { KeyResult, VTask } from "../../lib/vertical";
import { parseCapture } from "../../lib/nlp";
import { InlineNumber, InlineText, KrPicker } from "./parts";
import TaskRefine from "./TaskRefine";

export type { TaskParent };

export default function TaskList({
  tasks,
  parent,
  accent,
  emptyHint = "No tasks yet.",
  keyResults,
  composerFirst = false,
}: {
  tasks: VTask[];
  parent: TaskParent;
  accent: string;
  emptyHint?: string;
  /** When present, each row gets a chip to point the task at the key result it
   *  moves (the OKR link). Omit to keep the plain list — desktop unchanged. */
  keyResults?: KeyResult[];
  /** Pin the composer (and Groom) ABOVE the rows — the entry point is the first
   *  thing, for scaffolding-first surfaces like the project record. */
  composerFirst?: boolean;
}) {
  const { addTask, addTasks, updateTask, deleteTask, restoreTask, toggleTask, toggleTaskInbox } = useVertical();
  const [draft, setDraft] = useState("");
  const [refining, setRefining] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Turn one line of free text into a backlog draft — a trailing duration token
  // ("…draft outline 30m") is parsed off the title.
  const draftFromLine = (line: string) => {
    const parsed = parseCapture(line);
    return {
      title: parsed.title || line,
      energy: "quick" as VTask["energy"],
      durationMins: parsed.durationMinutes ?? 20,
    };
  };

  // Type → Enter → land a backlog task → clear → stay focused for the next.
  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    const parsed = parseCapture(text);
    addTask(parent, { title: parsed.title || text, durationMins: parsed.durationMinutes ?? undefined });
    setDraft("");
    inputRef.current?.focus();
  };

  // Paste a whole list → one task per non-empty line, in order. The single-line
  // path stays untouched (React inserts it into the field as usual).
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    const lines = text.split(/\r?\n/).map((l) => l.replace(/^\s*[-*•\d.)\]]+\s*/, "").trim()).filter(Boolean);
    if (lines.length < 2) return; // let the browser handle a plain single-line paste
    e.preventDefault();
    void addTasks(parent, lines.map(draftFromLine));
    setDraft("");
    inputRef.current?.focus();
  };

  const remove = (t: VTask) => {
    const prev = deleteTask(t.id);
    toast("Task deleted", {
      action: { label: "Undo", onClick: () => restoreTask(t.id, prev ?? "backlog") },
      duration: 6000,
    });
  };

  const sendToInbox = (t: VTask) => {
    toggleTaskInbox(t.id);
    if (!t.inbox) toast("Added to Inbox — triage it from there.");
  };

  const rows = (
    <>
      {/* rows are hairline-SEPARATED, so the last one doesn't close with a rule —
          otherwise it doubles up with whatever section follows. */}
      {tasks.map((t) => (
        <div key={t.id} className="group fast flex items-center gap-2.5 border-b border-line py-2 last:border-b-0 hover:bg-accent-soft/40">
          <button
            onClick={() => toggleTask(t.id)}
            className="fast flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-meta"
            style={{
              borderColor: t.status === "done" ? accent : "var(--line)",
              background: t.status === "done" ? accent : "transparent",
              color: "#fff",
            }}
            title={t.status === "done" ? "Mark not done" : "Mark done"}
          >
            {t.status === "done" ? "✓" : ""}
          </button>

          <InlineText
            value={t.title}
            onChange={(v) => updateTask(t.id, { title: v })}
            placeholder="Untitled task"
            autoFocusEmpty
            className={`min-w-0 flex-1 text-body ${t.status === "done" ? "text-muted line-through" : ""}`}
          />

          <span className="mono shrink-0 text-meta text-muted">
            <InlineNumber value={t.durationMins} onChange={(v) => updateTask(t.id, { durationMins: v })} suffix="m" />
          </span>

          {keyResults && keyResults.length > 0 && (
            <span className={`shrink-0 ${t.keyResultId ? "" : "opacity-0 group-hover:opacity-100"}`}>
              <KrPicker
                keyResults={keyResults}
                value={t.keyResultId}
                onChange={(krId) => updateTask(t.id, { keyResultId: krId })}
                color={accent}
                align="right"
              />
            </span>
          )}

          {/* send to the Inbox triage queue — the real next action */}
          <button
            onClick={() => sendToInbox(t)}
            className={`fast shrink-0 rounded-full border px-2 py-0.5 text-micro font-medium ${
              t.inbox ? "" : "opacity-0 group-hover:opacity-100"
            }`}
            style={
              t.inbox
                ? { borderColor: "var(--accent)", color: "var(--accent)", background: "var(--accent-soft)" }
                : { borderColor: "var(--line)", color: "var(--muted)" }
            }
            title={t.inbox ? "In your Inbox — click to pull back to the backlog" : "Add to Inbox to triage & schedule"}
          >
            {t.inbox ? "✦ in inbox" : "→ inbox"}
          </button>

          {/* delete — instant, with Undo */}
          <button
            onClick={() => remove(t)}
            className="fast shrink-0 rounded-full px-1.5 py-0.5 text-caption text-muted opacity-0 hover:text-signal group-hover:opacity-100"
            title="Delete task"
            aria-label="Delete task"
          >
            ✕
          </button>
        </div>
      ))}

      {tasks.length === 0 && <div className="py-2 text-caption text-muted italic">{emptyHint}</div>}
    </>
  );

  // The persistent composer — the Todoist-fast add, and (in the record) the
  // PRIMARY action. No outline (that reads restrictive and fights the paper);
  // it rests softly raised off the canvas and LIFTS on focus — presence through
  // fill + float + the accent badge, per "focus lifts, it doesn't outline."
  const composer = (
    <div
      className={`fast flex items-center gap-3 rounded-[var(--radius)] px-3.5 py-3 [box-shadow:var(--shadow-1)] focus-within:-translate-y-px focus-within:[box-shadow:var(--shadow-lift)] ${composerFirst ? "" : "mt-2.5"}`}
      style={{ background: "var(--surface)" }}
    >
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-caption font-semibold text-white"
        style={{ background: accent }}
      >
        +
      </span>
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(); }
          if (e.key === "Escape") setDraft("");
        }}
        onPaste={onPaste}
        placeholder="Add a task… ↵ to add another, or paste a list"
        className="min-w-0 flex-1 bg-transparent text-lead outline-none placeholder:text-muted/60"
        style={{ caretColor: accent }}
      />
    </div>
  );

  const groom = parent.projectId ? (
    <div className={composerFirst ? "mt-2" : "mt-2"}>
      {refining ? (
        <TaskRefine
          projectId={parent.projectId}
          parent={parent}
          tasks={tasks}
          accent={accent}
          onClose={() => setRefining(false)}
        />
      ) : (
        <button
          onClick={() => setRefining(true)}
          className="fast inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-meta text-muted hover:border-line-strong hover:text-ink"
          title="Let Nuvo tighten wording, add missing steps, and suggest an order"
        >
          <span style={{ color: accent }}>✦</span> Groom with Nuvo
        </button>
      )}
    </div>
  ) : null;

  // Scaffolding-first surfaces pin the entry point on top; everywhere else keeps
  // the familiar rows-then-composer order.
  return (
    <div>
      {composerFirst ? (
        <>
          {composer}
          {groom}
          <div className="mt-3">{rows}</div>
        </>
      ) : (
        <>
          {rows}
          {composer}
          {groom}
        </>
      )}
    </div>
  );
}
