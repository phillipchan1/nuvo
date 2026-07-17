// The record log — a time-ordered journal of "what's going on" with a project
// OR an initiative, shown newest-first below the work in the record modal.
// Loaded on demand when a record opens. Realtime invalidation is wired via
// TABLE_TO_KEYS in useRealtime.ts.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

export type RecordKind = "project" | "initiative";

export type RecordComment = {
  id: string;
  body: string;
  created_at: string;
};

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
      const { data, error } = await supabase
        .from("record_comments")
        .select("id, body, created_at")
        .eq(col, id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as RecordComment[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const addComment = async (body: string) => {
    const text = body.trim();
    if (!text) return;
    const uid = await userId();
    const { error } = await supabase
      .from("record_comments")
      .insert({ user_id: uid, [col]: id, body: text });
    if (error) throw error;
    invalidate();
  };

  const deleteComment = async (commentId: string) => {
    const { error } = await supabase.from("record_comments").delete().eq("id", commentId);
    if (error) throw error;
    invalidate();
  };

  return {
    comments: query.data ?? [],
    loading: query.isLoading,
    addComment,
    deleteComment,
  };
}
