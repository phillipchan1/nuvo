// Record comments — a Notion-style thread below the work. Each line carries
// an author (you today; Nuvo when agent comments land) with edit/delete on ⋯.

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { useAuth } from "../../hooks/useAuth";
import { useRecordLog, type RecordComment, type RecordKind } from "../../hooks/useRecordLog";
import { ASSISTANT_NAME } from "../../lib/assistant";
import { FloatingMenu } from "../floors/parts";
import { MenuItem } from "./recordFrame";

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

function wasEdited(comment: RecordComment): boolean {
  if (!comment.updated_at) return false;
  return new Date(comment.updated_at).getTime() - new Date(comment.created_at).getTime() > 1000;
}

function displayNameFromSession(session: ReturnType<typeof useAuth>["session"]): string {
  const meta = session?.user.user_metadata as Record<string, unknown> | undefined;
  const full = meta?.full_name ?? meta?.name;
  if (typeof full === "string" && full.trim()) return full.trim();
  const email = session?.user.email;
  if (email) {
    const local = email.split("@")[0]?.replace(/[._]/g, " ").trim();
    if (local) return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return "You";
}

function authorOf(
  comment: RecordComment,
  selfName: string,
): { name: string; initial: string; agent: boolean } {
  if (comment.author_kind === "agent") {
    return { name: ASSISTANT_NAME, initial: "N", agent: true };
  }
  const initial = (selfName.match(/\b\w/g)?.slice(0, 2).join("") ?? selfName.charAt(0)).toUpperCase();
  return { name: selfName, initial, agent: false };
}

function CommentAvatar({
  initial,
  agent,
  accent,
}: {
  initial: string;
  agent: boolean;
  accent: string;
}) {
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-micro font-semibold"
      style={
        agent
          ? { background: "var(--accent-soft)", color: "var(--accent)" }
          : {
              background: `color-mix(in srgb, ${accent} 16%, var(--surface))`,
              color: `color-mix(in srgb, ${accent} 72%, var(--ink))`,
            }
      }
      aria-hidden
    >
      {agent ? "✦" : initial}
    </span>
  );
}

function CommentRow({
  comment,
  accent,
  selfName,
  selfId,
  editing,
  onEdit,
  onCancelEdit,
  onSave,
  onRemove,
}: {
  comment: RecordComment;
  accent: string;
  selfName: string;
  selfId: string | undefined;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (body: string) => void;
  onRemove: () => void;
}) {
  const author = authorOf(comment, selfName);
  const menuRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const canEdit = comment.author_kind === "user" && comment.user_id === selfId;
  const canDelete = comment.user_id === selfId;

  useEffect(() => {
    if (editing) setDraft(comment.body);
  }, [editing, comment.body]);

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  const save = () => {
    const text = draft.trim();
    if (!text) return;
    onSave(text);
  };

  return (
    <div className="group fast flex gap-3 rounded-[var(--radius-sm)] py-2.5 hover:bg-accent-soft/30">
      <CommentAvatar initial={author.initial} agent={author.agent} accent={accent} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-caption font-medium text-ink">{author.name}</span>
          <span className="mono text-meta text-muted">
            {ago(comment.created_at)}
            {wasEdited(comment) && <span className="ml-1 opacity-70">(edited)</span>}
          </span>
          {(canEdit || canDelete) && !editing && (
            <span className="relative ml-auto">
              <button
                ref={menuRef}
                onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
                className="tap-icon fast flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-meta text-muted opacity-50 hover:bg-surface hover:text-ink hover:opacity-100 group-hover:opacity-100"
                title="Comment options"
                aria-label="Comment options"
              >
                ⋯
              </button>
              <FloatingMenu open={menuOpen} anchorRef={menuRef} align="right" minWidth={130} onClose={() => setMenuOpen(false)}>
                {canEdit && (
                  <MenuItem
                    onClick={() => {
                      setMenuOpen(false);
                      onEdit();
                    }}
                  >
                    Edit
                  </MenuItem>
                )}
                {canDelete && (
                  <MenuItem
                    onClick={() => {
                      setMenuOpen(false);
                      onRemove();
                    }}
                    color="var(--signal)"
                  >
                    Delete
                  </MenuItem>
                )}
              </FloatingMenu>
            </span>
          )}
        </div>

        {editing ? (
          <div className="mt-1.5">
            <textarea
              ref={editRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
                if (e.key === "Escape") { e.stopPropagation(); onCancelEdit(); }
              }}
              rows={3}
              className="nuvo-inline-input w-full resize-none rounded-[var(--radius-sm)] bg-surface px-2.5 py-2 text-body leading-relaxed outline-none"
              style={{ caretColor: accent, boxShadow: "var(--shadow-1)" }}
            />
            <div className="mt-1.5 flex items-center gap-2">
              <button
                onClick={save}
                disabled={!draft.trim() || draft.trim() === comment.body.trim()}
                className="fast rounded-[var(--radius-sm)] px-2.5 py-1 text-caption font-medium text-white disabled:opacity-40"
                style={{ background: accent }}
              >
                Save
              </button>
              <button
                onClick={onCancelEdit}
                className="fast rounded-[var(--radius-sm)] px-2 py-1 text-caption text-muted hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-1 whitespace-pre-wrap text-body leading-relaxed text-ink/90">{comment.body}</div>
        )}
      </div>
    </div>
  );
}

export function RecordLog({
  kind,
  id,
  accent,
  spine = false,
  composerRef,
}: {
  kind: RecordKind;
  id: string;
  accent: string;
  spine?: boolean;
  composerRef?: RefObject<HTMLTextAreaElement>;
}) {
  const { session } = useAuth();
  const { comments, addComment, deleteComment, updateComment, error: loadError } = useRecordLog(kind, id);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const inner = useRef<HTMLTextAreaElement>(null);
  const ref = composerRef ?? inner;
  const selfName = useMemo(() => displayNameFromSession(session), [session]);
  const selfId = session?.user.id;
  const selfInitial = useMemo(
    () => (selfName.match(/\b\w/g)?.slice(0, 2).join("") ?? selfName.charAt(0)).toUpperCase(),
    [selfName],
  );

  const post = () => {
    const text = draft.trim();
    if (!text) return;
    void addComment(text)
      .then(() => {
        setDraft("");
        ref.current?.focus();
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : "Couldn't post comment");
      });
  };

  const remove = (c: RecordComment) => {
    if (editingId === c.id) setEditingId(null);
    void deleteComment(c.id);
    toast("Comment deleted", {
      action: { label: "Undo", onClick: () => void addComment(c.body) },
      duration: 6000,
    });
  };

  const saveEdit = async (c: RecordComment, body: string) => {
    await updateComment(c.id, body);
    setEditingId(null);
  };

  const composer = (
    <div className={`flex gap-3 ${comments.length > 0 ? "border-t border-line pt-3" : "pt-1"}`}>
      <CommentAvatar initial={selfInitial} agent={false} accent={accent} />
      <textarea
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); post(); }
          if (e.key === "Escape") { e.stopPropagation(); setDraft(""); e.currentTarget.blur(); }
        }}
        rows={spine ? 2 : 2}
        placeholder="Add a comment…"
        className="nuvo-inline-input min-w-0 flex-1 resize-none bg-transparent text-body leading-relaxed outline-none placeholder:text-muted"
        style={{ caretColor: accent }}
      />
    </div>
  );

  return (
    <div className={spine ? "-mx-1 px-1" : ""}>
      {loadError && (
        <p className="mb-2 text-caption text-signal">Comments couldn't load — try refreshing.</p>
      )}
      {comments.length === 0 && !loadError ? (
        <p className="mb-2 text-caption text-muted italic">No comments yet.</p>
      ) : (
        <div className="flex flex-col">
          {comments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              accent={accent}
              selfName={selfName}
              selfId={selfId}
              editing={editingId === c.id}
              onEdit={() => setEditingId(c.id)}
              onCancelEdit={() => setEditingId(null)}
              onSave={(body) => void saveEdit(c, body)}
              onRemove={() => remove(c)}
            />
          ))}
        </div>
      )}
      {composer}
    </div>
  );
}
