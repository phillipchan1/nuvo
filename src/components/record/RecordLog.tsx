// The record Log — the running "what's going on" journal, below the work in a
// project OR initiative record. A quiet composer (Enter posts, Shift+Enter for a
// new line) over newest-first entries, each with a relative timestamp and a
// quiet delete. This is the context surface that replaced the static Brief.

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useRecordLog, type RecordKind } from "../../hooks/useRecordLog";

function ago(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function RecordLog({ kind, id, accent }: { kind: RecordKind; id: string; accent: string }) {
  const { comments, addComment, deleteComment } = useRecordLog(kind, id);
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const post = () => {
    const text = draft.trim();
    if (!text) return;
    void addComment(text);
    setDraft("");
    ref.current?.focus();
  };

  const remove = (c: { id: string; body: string }) => {
    void deleteComment(c.id);
    toast("Note deleted", {
      action: { label: "Undo", onClick: () => void addComment(c.body) },
      duration: 6000,
    });
  };

  return (
    <div>
      {/* composer — deliberately QUIETER than the task composer (flat, no lift,
          muted) so the two zones don't read as twins: Tasks is the hero, the Log
          is the secondary journal. */}
      <div
        className="fast flex items-start gap-2.5 rounded-[var(--radius)] px-3 py-2 focus-within:[background:var(--surface)]"
        style={{ background: "var(--surface-2)" }}
      >
        <span className="mt-px shrink-0 text-meta" style={{ color: accent }}>✎</span>
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); post(); }
            if (e.key === "Escape") setDraft("");
          }}
          rows={1}
          placeholder="Note what's going on… ↵ to log, ⇧↵ for a new line"
          className="min-w-0 flex-1 resize-none bg-transparent text-caption outline-none placeholder:text-muted/60"
          style={{ caretColor: accent }}
        />
      </div>

      {/* entries — newest first */}
      {comments.length > 0 && (
        <div className="mt-1">
          {comments.map((c) => (
            <div key={c.id} className="group fast flex items-start gap-3 border-b border-line py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1 whitespace-pre-wrap text-body leading-relaxed">{c.body}</div>
              <div className="mono mt-0.5 flex shrink-0 items-center gap-1.5 text-meta text-muted">
                <span>{ago(c.created_at)}</span>
                <button
                  onClick={() => remove(c)}
                  className="fast rounded-full px-1 opacity-0 hover:text-signal group-hover:opacity-100"
                  title="Delete note"
                  aria-label="Delete note"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
