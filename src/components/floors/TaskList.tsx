// Inline, fully-CRUD task list. Used for a project's backlog and for the loose
// tasks that hang straight off an initiative or domain (the "teach my kid to
// ride a bike" case — first-class work that deserves no project).
//
// Built for speed: type → Enter → it lands and the field stays focused for the
// next, Todoist-style. Rows stay quiet — checkbox · title · duration · the Inbox
// toggle · delete — and energy is set elsewhere (planning), not here. Delete is
// instant with an Undo toast (via the app-wide undo stack).
//
// ── `spine` — the record's layout ────────────────────────────────────────────
// The record modal hangs every control in one 26px gutter so the section label,
// every task title and the composer share ONE left edge. Without it the label,
// the composer's box padding and the checkbox each started at a different x, and
// three ragged left edges is most of what "disjointed" was.
//
// It also flips the composer BELOW the rows once there are rows to read. The
// composer-on-top order was built for scaffolding a new project, and it still
// wins there — so the composer stays on top (and autofocuses) while the list is
// empty, and drops to the foot the moment there's work to look at. `t` puts the
// caret in it from anywhere, so the fast path costs one keystroke, not a slot at
// the top of the hierarchy.

import { useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { useVertical, type TaskParent } from "../../hooks/useVertical";
import type { KeyResult, VTask } from "../../lib/vertical";
import { parseCapture } from "../../lib/nlp";
import { DEFAULT_PROJECT_DURATION_MINUTES } from "../../lib/types";
import { InlineText, KrPicker } from "./parts";
import TaskRefine from "./TaskRefine";
import DurationSelect from "../DurationSelect";

export type { TaskParent };

/** Is the user typing? Every bare-letter binding is gated on this — otherwise
 *  "t" in a title jumps the caret out of the title. */
export function isTypingIn(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  if (!n || !n.tagName) return false;
  return n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.tagName === "SELECT" || n.isContentEditable;
}

export default function TaskList({
  tasks,
  parent,
  accent,
  emptyHint = "No tasks yet.",
  keyResults,
  spine = false,
  keyboardNav = false,
  composerRef,
  refining: refiningProp,
  onRefining,
}: {
  tasks: VTask[];
  parent: TaskParent;
  accent: string;
  emptyHint?: string;
  /** When present, each row gets a chip to point the task at the key result it
   *  moves (the OKR link). Omit to keep the plain list — desktop unchanged. */
  keyResults?: KeyResult[];
  /** The record's one-left-edge layout (see the note above). */
  spine?: boolean;
  /** ↑↓ select · ↵ edit · space toggle · ⌫ delete, while nothing is being typed in. */
  keyboardNav?: boolean;
  /** so the record's `t` can put the caret in the composer from anywhere. */
  composerRef?: RefObject<HTMLInputElement>;
  /** Lift the Groom pass into the surface's own action cluster. When these are
   *  passed the list drops its inline button and obeys the parent. */
  refining?: boolean;
  onRefining?: (v: boolean) => void;
}) {
  const { addTask, addTasks, updateTask, deleteTask, toggleTask, toggleTaskInbox } = useVertical();
  const [draft, setDraft] = useState("");
  const [refiningLocal, setRefiningLocal] = useState(false);
  const [sel, setSel] = useState(-1);
  const innerRef = useRef<HTMLInputElement>(null);
  const inputRef = composerRef ?? innerRef;
  const listRef = useRef<HTMLDivElement>(null);

  const controlled = refiningProp != null;
  const refining = controlled ? refiningProp : refiningLocal;
  const setRefining = (v: boolean) => (controlled ? onRefining?.(v) : setRefiningLocal(v));

  // Turn one line of free text into a backlog draft — a trailing duration token
  // ("…draft outline 30m") is parsed off the title.
  const draftFromLine = (line: string) => {
    const parsed = parseCapture(line);
    return {
      title: parsed.title || line,
      energy: "quick" as VTask["energy"],
      durationMins: parsed.durationMinutes ?? DEFAULT_PROJECT_DURATION_MINUTES,
    };
  };

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    const parsed = parseCapture(text);
    addTask(parent, { title: parsed.title || text, durationMins: parsed.durationMinutes ?? undefined });
    setDraft("");
    inputRef.current?.focus();
  };

  // Paste a whole list → one task per non-empty line, in order.
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
    deleteTask(t.id);
  };

  const sendToInbox = (t: VTask) => {
    toggleTaskInbox(t.id);
    if (!t.inbox) toast("Added to Inbox — triage it from there.");
  };

  // ── ↑↓ select · ↵ edit · space toggle · ⌫ delete ────────────────────────────
  // No ⌥↑/⌥↓ reorder: `tasks` has no sort column, so there is nothing to write.
  // Adding one is a migration, not a keybinding.
  useEffect(() => {
    if (!keyboardNav) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingIn(e.target) || e.metaKey || e.ctrlKey) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!tasks.length) return;
        e.preventDefault();
        setSel((i) => {
          const next = e.key === "ArrowDown" ? i + 1 : i - 1;
          return Math.max(0, Math.min(tasks.length - 1, next < 0 ? 0 : next));
        });
        return;
      }
      if (sel < 0 || sel >= tasks.length) return;
      const t = tasks[sel];
      if (e.key === "Enter") {
        e.preventDefault();
        const row = listRef.current?.querySelector<HTMLElement>(`[data-row="${sel}"] [contenteditable]`);
        row?.focus();
        // put the caret at the end rather than selecting the whole title
        const r = document.createRange();
        if (row) { r.selectNodeContents(row); r.collapse(false); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r); }
      } else if (e.key === " ") {
        e.preventDefault();
        toggleTask(t.id);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        remove(t);
        setSel((i) => Math.min(i, tasks.length - 2));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // keep the selection inside the list as it shrinks
  useEffect(() => {
    if (sel >= tasks.length) setSel(tasks.length - 1);
  }, [tasks.length, sel]);

  const gutter = spine ? "w-[26px]" : "";

  const rows = (
    <div ref={listRef}>
      {tasks.map((t, i) => {
        const selected = keyboardNav && i === sel;
        return (
          <div
            key={t.id}
            data-row={i}
            onMouseDown={() => keyboardNav && setSel(i)}
            className={
              spine
                ? // -mx-2/px-2 so the hover wash and the focal lift have room to
                  // breathe either side of the text instead of hugging it.
                  `group fast -mx-2 flex items-center rounded-[var(--radius-sm)] border-b border-line px-2 last:border-b-0 ${
                    selected
                      ? "glass-lift-row lift-anim border-transparent"
                      : "hover:bg-accent-soft/40"
                  }`
                : "group fast flex items-center gap-2.5 border-b border-line py-2 last:border-b-0 hover:bg-accent-soft/40"
            }
            style={spine ? { minHeight: 36 } : undefined}
          >
            <span className={`flex shrink-0 items-center ${gutter}`}>
              <button
                onClick={() => toggleTask(t.id)}
                className="fast flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border text-micro"
                style={{
                  // `--line-strong` is 1.37:1 on the paper; a non-text control
                  // needs 3:1. `--muted` clears it at 3.7:1. See D-054a.
                  borderColor: t.status === "done" ? accent : "var(--muted)",
                  background: t.status === "done" ? accent : "transparent",
                  color: "#fff",
                }}
                title={t.status === "done" ? "Mark not done" : "Mark done"}
              >
                {t.status === "done" ? "✓" : ""}
              </button>
            </span>

            <InlineText
              value={t.title}
              onChange={(v) => updateTask(t.id, { title: v })}
              placeholder="Untitled task"
              autoFocusEmpty
              className={`min-w-0 flex-1 text-body ${t.status === "done" ? "text-muted line-through" : ""}`}
            />

            <span className="mono shrink-0 pl-3 text-meta text-muted">
              <DurationSelect
                value={t.durationMins}
                onChange={(m) => updateTask(t.id, { durationMins: m })}
                className="shrink-0 rounded px-1 py-0.5 hover:bg-surface-2"
                title="Sitting length"
              />
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

            {/* send to the Inbox triage queue. In the record it's a glyph, not a
                bordered pill: every enclosure in this column belongs to the work. */}
            <button
              onClick={() => sendToInbox(t)}
              className={
                spine
                  ? `fast ml-1.5 shrink-0 rounded-[var(--radius-sm)] px-1 text-meta ${t.inbox ? "" : "text-muted opacity-0 group-hover:opacity-100"}`
                  : `fast shrink-0 rounded-full border px-2 py-0.5 text-micro font-medium ${t.inbox ? "" : "opacity-0 group-hover:opacity-100"}`
              }
              style={
                spine
                  ? t.inbox ? { color: "var(--accent)" } : undefined
                  : t.inbox
                    ? { borderColor: "var(--accent)", color: "var(--accent)", background: "var(--accent-soft)" }
                    : { borderColor: "var(--line)", color: "var(--muted)" }
              }
              title={t.inbox ? "In your Inbox — click to pull back to the backlog" : "Add to Inbox to triage & schedule"}
            >
              {spine ? (t.inbox ? "✦" : "→") : t.inbox ? "✦ in inbox" : "→ inbox"}
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
        );
      })}

      {tasks.length === 0 && !spine && <div className="py-2 text-caption text-muted italic">{emptyHint}</div>}
    </div>
  );

  // The composer. In the record it's a row on the same spine with a ＋ in the
  // gutter — one input idiom for the whole sheet. Elsewhere it keeps the raised
  // card that lifts on focus.
  const composer = spine ? (
    <div className="flex items-center" style={{ minHeight: 36 }}>
      <span className="flex w-[26px] shrink-0 items-center text-body" style={{ color: accent }}>＋</span>
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(); }
          if (e.key === "Escape") { e.stopPropagation(); setDraft(""); e.currentTarget.blur(); }
        }}
        onPaste={onPaste}
        placeholder="Add a task…"
        // `nuvo-inline-input` drops the global 3px accent ring: this field IS the
        // focal element of its own row, and focus lifts here — it doesn't outline.
        className="nuvo-inline-input min-w-0 flex-1 bg-transparent text-body shadow-none outline-none placeholder:text-muted"
        style={{ caretColor: accent }}
      />
    </div>
  ) : (
    <div
      className="fast mt-2.5 flex items-center gap-3 rounded-[var(--radius)] px-3.5 py-3 [box-shadow:var(--shadow-1)] focus-within:-translate-y-px focus-within:[box-shadow:var(--shadow-lift)]"
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
          if (e.key === "Escape") { e.stopPropagation(); setDraft(""); }
        }}
        onPaste={onPaste}
        placeholder="Add a task… ↵ to add another, or paste a list"
        // the card around it already lifts on focus — a ring inside that is noise
        className="nuvo-inline-input min-w-0 flex-1 bg-transparent text-lead shadow-none outline-none placeholder:text-muted/60"
        style={{ caretColor: accent }}
      />
    </div>
  );

  // The Groom pass. When the surface owns the trigger (the record's ✦), only the
  // diff renders here.
  const groom = parent.projectId ? (
    refining ? (
      <div className="mt-2">
        <TaskRefine
          projectId={parent.projectId}
          parent={parent}
          tasks={tasks}
          accent={accent}
          onClose={() => setRefining(false)}
        />
      </div>
    ) : controlled ? null : (
      <div className="mt-2">
        <button
          onClick={() => setRefining(true)}
          className="fast inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-meta text-muted hover:border-line-strong hover:text-ink"
          title="Let Nuvo tighten wording, add missing steps, and suggest an order"
        >
          <span style={{ color: accent }}>✦</span> Groom with Nuvo
        </button>
      </div>
    )
  ) : null;

  // Empty → the composer leads (and takes the caret). Populated → you read the
  // work first and the composer waits at the foot.
  const composerLeads = spine ? tasks.length === 0 : false;

  return (
    <div>
      {composerLeads ? (
        <>
          {composer}
          {groom}
          {rows}
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
