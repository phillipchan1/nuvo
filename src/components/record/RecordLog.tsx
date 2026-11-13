// Record comments — a thread below the work, on both shells (the desktop
// record and the phone's detail sheet). Each line carries an author (you
// today; Nuvo when agent comments land) with edit/delete on ⋯. Drawn with kit
// parts: an Avatar, plain text, a Textarea to write in.

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { useAuth } from "../../hooks/useAuth";
import { useRecordLog, type RecordComment, type RecordKind } from "../../hooks/useRecordLog";
import { ASSISTANT_NAME } from "../../lib/assistant";
import { FloatingMenu } from "../floors/parts";
import { Avatar, Button, IconButton, Textarea } from "../kit";
import { Icon } from "../Icon";
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

function authorOf(comment: RecordComment, selfName: string): { name: string; agent: boolean } {
  if (comment.author_kind === "agent") return { name: ASSISTANT_NAME, agent: true };
  return { name: selfName, agent: false };
}

/** You wear your record's domain hue; Nuvo wears the accent (its voice). */
function CommentAvatar({ name, agent, accent }: { name: string; agent: boolean; accent: string }) {
  return <Avatar name={name} color={agent ? "var(--accent)" : accent} size="lg" />;
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
    <div className="doc-comment">
      <CommentAvatar name={author.name} agent={author.agent} accent={accent} />
      <div className="doc-comment-main">
        <div className="doc-comment-head">
          <span className="doc-comment-name">{author.name}</span>
          <span className="doc-comment-when">
            {ago(comment.created_at)}
            {wasEdited(comment) && " · edited"}
          </span>
          {(canEdit || canDelete) && !editing && (
            <span className="doc-comment-more">
              <IconButton
                ref={menuRef}
                size="xs"
                label="Comment options"
                icon={<Icon name="more" size={14} />}
                className="tap"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((o) => !o);
                }}
              />
              <FloatingMenu open={menuOpen} anchorRef={menuRef} align="right" minWidth={150} onClose={() => setMenuOpen(false)}>
                <div className="doc-menu">
                  {canEdit && (
                    <MenuItem
                      icon={<Icon name="pen" size={14} />}
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
                      danger
                      icon={<Icon name="trash" size={14} />}
                      onClick={() => {
                        setMenuOpen(false);
                        onRemove();
                      }}
                    >
                      Delete
                    </MenuItem>
                  )}
                </div>
              </FloatingMenu>
            </span>
          )}
        </div>

        {editing ? (
          <div className="mt-1.5 grid gap-2">
            <Textarea
              ref={editRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
                if (e.key === "Escape") { e.stopPropagation(); onCancelEdit(); }
              }}
              rows={3}
              aria-label="Edit comment"
            />
            <div className="flex items-center gap-2">
              <Button kind="primary" size="xs" className="tap" onClick={save} disabled={!draft.trim() || draft.trim() === comment.body.trim()}>
                Save
              </Button>
              <Button kind="ghost" size="xs" className="tap" onClick={onCancelEdit}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="doc-comment-body" data-selectable>
            {comment.body}
          </div>
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
  /** kept for call-site compat — the thread is one shape everywhere now */
  spine?: boolean;
  composerRef?: RefObject<HTMLTextAreaElement>;
}) {
  void spine;
  const { session } = useAuth();
  const { comments, addComment, deleteComment, updateComment, error: loadError } = useRecordLog(kind, id);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const inner = useRef<HTMLTextAreaElement>(null);
  const ref = composerRef ?? inner;
  const selfName = useMemo(() => displayNameFromSession(session), [session]);
  const selfId = session?.user.id;

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

  return (
    <div>
      {loadError && <p className="mb-2 text-caption text-danger">Comments couldn't load. Try refreshing.</p>}
      {comments.length > 0 &&
        comments.map((c) => (
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
      <div className="doc-comment-compose" data-after={comments.length > 0 ? "" : undefined}>
        <CommentAvatar name={selfName} agent={false} accent={accent} />
        <Textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); post(); }
            if (e.key === "Escape") { e.stopPropagation(); setDraft(""); e.currentTarget.blur(); }
          }}
          rows={2}
          placeholder="Add a comment…"
          aria-label="Add a comment"
        />
      </div>
    </div>
  );
}
