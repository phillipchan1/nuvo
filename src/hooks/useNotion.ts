import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { formatAppError } from "../lib/appError";

/** One Notion database the person can switch on (D-257). Mirrors worker/src/notion/feeds.ts. */
export interface NotionFeed {
  id: string;
  title: string;
  url: string | null;
  assignee: string | null;
  people: Array<{ id: string; name: string }>;
  done: { kind: "status"; prop: string; values: string[] } | { kind: "checkbox"; prop: string } | null;
  on: boolean;
}

export interface NotionSource {
  id: string;
  account_name: string | null;
  feeds: NotionFeed[];
  needs_reconnect: boolean;
  last_synced_at: string | null;
}

const KEY = ["notion_source"];

/** The connected Notion workspace, or null. */
export function useNotionSource() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<NotionSource | null> => {
      const { data, error } = await supabase
        .from("task_sources")
        .select("id, account_name, feeds, needs_reconnect, last_synced_at")
        .eq("kind", "notion")
        .limit(1);
      if (error) throw error;
      const row = (data as NotionSource[] | null)?.[0];
      return row ? { ...row, feeds: Array.isArray(row.feeds) ? row.feeds : [] } : null;
    },
    staleTime: 30_000,
    retry: false,
    meta: { silent: true }, // the table arrives with D-257's migration — fail fast before it
  });
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("notion", { body });
  if (error) throw new Error((await formatAppError(error)).message);
  if (data?.error) throw new Error(data.error as string);
  return data as T;
}

/** Off to Notion's consent screen — where the person picks which pages Nuvo may see. */
export async function startNotionConnect(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return;
  const base = import.meta.env.VITE_SUPABASE_URL;
  const redirect = encodeURIComponent(window.location.origin);
  window.location.href = `${base}/functions/v1/notion-oauth?action=start&token=${token}&redirect=${redirect}`;
}

export function useNotionActions() {
  const qc = useQueryClient();
  const refreshSource = () => qc.invalidateQueries({ queryKey: KEY });
  const landed = (added: number) => {
    refreshSource();
    if (added > 0) qc.invalidateQueries({ queryKey: ["tasks"] });
  };

  const setFeed = useMutation({
    mutationFn: (v: { sourceId: string; feedId: string; on?: boolean; assignee?: string }) =>
      invoke<{ added: number }>({ action: "feed", ...v }),
    onMutate: async (v) => {
      // Flip the switch now; the server's answer replaces it.
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<NotionSource | null>(KEY);
      if (prev) {
        qc.setQueryData<NotionSource>(KEY, {
          ...prev,
          feeds: prev.feeds.map((f) =>
            f.id === v.feedId
              ? { ...f, ...(v.on !== undefined ? { on: v.on } : {}), ...(v.assignee ? { assignee: v.assignee } : {}) }
              : f,
          ),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(KEY, ctx.prev);
    },
    onSuccess: (r) => landed(r.added),
  });

  const refresh = useMutation({
    mutationFn: (sourceId: string) => invoke<{ feeds: NotionFeed[] }>({ action: "refresh", sourceId }),
    onSettled: refreshSource,
  });

  const sync = useMutation({
    mutationFn: (sourceId: string) => invoke<{ added: number }>({ action: "sync", sourceId }),
    onSuccess: (r) => landed(r.added),
  });

  const disconnect = useMutation({
    mutationFn: (sourceId: string) => invoke<{ ok: true }>({ action: "disconnect", sourceId }),
    onSettled: refreshSource,
  });

  return { setFeed, refresh, sync, disconnect };
}
