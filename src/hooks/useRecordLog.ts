// Record comments — a time-ordered thread below the work in a project or
// initiative record. Loaded on demand when a record opens. Realtime
// invalidation is wired via TABLE_TO_KEYS in useRealtime.ts.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { invalidateWhenSafe, makeOp, queueWrite } from "../lib/sync";

export type RecordKind = "project" | "initiative";

export type CommentAuthorKind = "user" | "agent";

export type RecordComment = {
  id: string;
  body: string;
  created_at: string;
  updated_at: string | null;
  user_id: string;
  author_kind: CommentAuthorKind;
};

type CommentRow = {
  id: string;
  body: string;
  created_at: string;
  updated_at?: string | null;
  user_id: string;
  author_kind?: CommentAuthorKind | null;
};

function normalize(row: CommentRow): RecordComment {
  return {
    id: row.id,
    body: row.body,
    created_at: row.created_at,
    user_id: row.user_id,
    updated_at: row.updated_at ?? null,
    author_kind: row.author_kind ?? "user",
  };
}

async function userId(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error("Not signed in");
  return session.user.id;
}

const column = (kind: RecordKind) => (kind === "project" ? "project_id" : "initiative_id");

export function useRecordLog(kind: RecordKind, id: string) {
  const qc = useQueryClient();
  const key = ["record_comments", kind, id];
  const col = column(kind);

  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<RecordComment[]> => {
      // select("*") so older schemas without author_kind / updated_at still load.
      const { data, error } = await supabase
        .from("record_comments")
        .select("*")
        .eq(col, id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as CommentRow[] ?? []).map(normalize);
    },
  });

  const invalidate = () => invalidateWhenSafe(qc, "record_comments", key);

  /** Patch the open thread so the comment moves now, before the queue drains. */
  const patchThread = (fn: (rows: RecordComment[]) => RecordComment[]) =>
    qc.setQueryData<RecordComment[]>(key, (old) => fn(old ?? []));

  const addComment = async (body: string) => {
    const text = body.trim();
    if (!text) return;
    const commentId = crypto.randomUUID();
    const uid = await userId().catch(() => "");

    patchThread((rows) => [
      ...rows,
      {
        id: commentId,
        body: text,
        created_at: new Date().toISOString(),
        updated_at: null,
        user_id: uid,
        author_kind: "user",
      },
    ]);

    // The old two-step "insert with author_kind, retry bare if the column is
    // missing" fallback is gone: it needed the server's error to decide, which a
    // queued write does not have. Migration 51 added the column, and a schema
    // that predates it is no longer a case worth carrying — the fallback would
    // have silently written a comment with no author on any failure whose
    // message happened to mention the column.
    await queueWrite(
      makeOp("record_comments", "insert", commentId, {
        [col]: id,
        body: text,
        author_kind: "user",
      }),
    );
    invalidate();
  };

  const deleteComment = async (commentId: string) => {
    patchThread((rows) => rows.filter((r) => r.id !== commentId));
    await queueWrite(makeOp("record_comments", "delete", commentId));
    invalidate();
  };

  const updateComment = async (commentId: string, body: string) => {
    const text = body.trim();
    if (!text) return;
    const updated_at = new Date().toISOString();
    patchThread((rows) =>
      rows.map((r) => (r.id === commentId ? { ...r, body: text, updated_at } : r)),
    );
    await queueWrite(makeOp("record_comments", "update", commentId, { body: text, updated_at }));
    invalidate();
  };

  return {
    comments: query.data ?? [],
    loading: query.isLoading,
    error: query.error,
    addComment,
    deleteComment,
    updateComment,
  };
}
