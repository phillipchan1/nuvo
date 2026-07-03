import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { ActivityBinding, ActivitySource, ActivityUnit } from "../lib/types";

const SOURCE_KEY = ["activity_source"];
const BINDINGS_KEY = ["activity_bindings"];

/** The connected GitHub source (single, single-user app), or null. */
export function useActivitySource() {
  return useQuery({
    queryKey: SOURCE_KEY,
    queryFn: async (): Promise<ActivitySource | null> => {
      const { data, error } = await supabase
        .from("activity_sources")
        .select("id, kind, login, avatar_url, repos, needs_reconnect, last_synced_at")
        .eq("kind", "github")
        .maybeSingle();
      if (error) throw error;
      return (data as ActivitySource | null) ?? null;
    },
    staleTime: 30_000,
    retry: false,
    meta: { silent: true }, // table may not exist pre-migration — fail fast, don't hang
  });
}

/** All repo → project bindings. */
export function useActivityBindings() {
  return useQuery({
    queryKey: BINDINGS_KEY,
    queryFn: async (): Promise<ActivityBinding[]> => {
      const { data, error } = await supabase
        .from("activity_bindings")
        .select("id, source_id, project_id, selector");
      if (error) throw error;
      return (data ?? []) as ActivityBinding[];
    },
    staleTime: 30_000,
    retry: false,
    meta: { silent: true },
  });
}

/** Completed units (merged PRs) in a time window. */
export function useActivityUnits(startISO: string, endISO: string) {
  return useQuery({
    queryKey: ["activity_units", startISO, endISO],
    queryFn: async (): Promise<ActivityUnit[]> => {
      const { data, error } = await supabase
        .from("activity_units")
        .select("id, source_id, kind, external_id, title, url, selector, project_id, occurred_at")
        .gte("occurred_at", startISO)
        .lt("occurred_at", endISO)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ActivityUnit[];
    },
    staleTime: 30_000,
    retry: false,
    meta: { silent: true },
  });
}

/** Lift the readable error out of a Supabase functions error (the body holds it). */
async function edgeError(err: unknown): Promise<string> {
  const e = err as { message?: string; context?: { json?: () => Promise<{ error?: string }> } };
  try {
    const body = await e.context?.json?.();
    if (body?.error) return body.error;
  } catch { /* ignore */ }
  return e.message ?? "Something went wrong.";
}

async function invokeGitHub<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("github-activity", { body });
  if (error) throw new Error(await edgeError(error));
  if (data?.error) throw new Error(data.error as string);
  return data as T;
}

/** Connect / sync / bind mutations. */
export function useActivityActions() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: SOURCE_KEY });
    qc.invalidateQueries({ queryKey: BINDINGS_KEY });
    qc.invalidateQueries({ queryKey: ["activity_units"] });
  };

  const connect = useMutation({
    mutationFn: (token: string) => invokeGitHub<{ source: ActivitySource }>({ action: "connect", token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: SOURCE_KEY }),
  });

  const disconnect = useMutation({
    mutationFn: (sourceId: string) => invokeGitHub({ action: "disconnect", sourceId }),
    onSuccess: invalidate,
  });

  /** Re-pull the repo list (e.g. after re-scoping the token on GitHub). */
  const refreshRepos = useMutation({
    mutationFn: () => invokeGitHub<{ repos: unknown[] }>({ action: "repos" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: SOURCE_KEY }),
  });

  /** Bind a repo to a project, then pull its merged PRs (the "found N shipped" moment). */
  const bindRepo = useMutation({
    mutationFn: async ({ sourceId, projectId, repo }: { sourceId: string; projectId: string; repo: string }) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("activity_bindings")
        .upsert({ user_id: u.user!.id, source_id: sourceId, project_id: projectId, selector: repo }, { onConflict: "source_id,selector" });
      if (error) throw error;
      return invokeGitHub<{ count: number; recent: Array<{ title: string; url: string }> }>({ action: "sync", sourceId, repo });
    },
    onSuccess: invalidate,
  });

  const unbind = useMutation({
    mutationFn: async (bindingId: string) => {
      const { error } = await supabase.from("activity_bindings").delete().eq("id", bindingId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { connect, disconnect, refreshRepos, bindRepo, unbind };
}
