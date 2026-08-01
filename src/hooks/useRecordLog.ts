// Record comments — a time-ordered thread below the work in a project or
// initiative record. Loaded on demand when a record opens. Realtime
// invalidation is wired via TABLE_TO_KEYS in useRealtime.ts.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

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

  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const addComment = async (body: string) => {
    const text = body.trim();
    if (!text) return;
    const uid = await userId();
    const row: Record<string, unknown> = { user_id: uid, [col]: id, body: text };
    // author_kind may not exist on older DBs — try with it first, fall back bare.
    let error = (await supabase.from("record_comments").insert({ ...row, author_kind: "user" })).error;
    if (error?.message?.includes("author_kind")) {
      error = (await supabase.from("record_comments").insert(row)).error;
    }
    if (error) throw error;
    invalidate();
  };

  const deleteComment = async (commentId: string) => {
    const { error } = await supabase.from("record_comments").delete().eq("id", commentId);
    if (error) throw error;
    invalidate();
  };

  const updateComment = async (commentId: string, body: string) => {
    const text = body.trim();
    if (!text) return;
    const patch = { body: text, updated_at: new Date().toISOString() };
    let error = (await supabase.from("record_comments").update(patch).eq("id", commentId)).error;
    if (error?.message?.includes("updated_at")) {
      error = (await supabase.from("record_comments").update({ body: text }).eq("id", commentId)).error;
    }
    if (error) throw error;
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
