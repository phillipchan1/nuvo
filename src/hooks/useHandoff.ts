// Hand-off (D-250, docs/handoff.md) — the app's side.
//
// An agent is a Full account token in Apps & devices with "Takes hand-offs" on.
// Handing a task to it, and taking it back, are server acts (`/api/handoff`):
// the task's `handed_to` is the hand-off's to write, never the outbox's. The
// caches are painted at once (`patchCaches`) and the server's row replaces it.

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import type { Task } from "../lib/types";
import { patchCaches, putTaskInCaches } from "./useTasks";

export interface HandoffAgent {
  id: string;
  name: string;
}

export interface HandoffRecord {
  id: string;
  task_id: string;
  connection_id: string;
  note: string;
  outcome: "open" | "done" | "back" | "recalled";
  agent_note: string;
  rang_at: string | null;
  ring_error: string | null;
  created_at: string;
  closed_at: string | null;
}

export const HANDOFF_AGENTS_QK = ["handoff-agents"] as const;
const historyKey = (taskId: string) => ["handoffs", taskId] as const;

/** The agents this account can hand a task to. Empty for most accounts — and
 *  then the act simply isn't offered (P16). */
export function useHandoffAgents() {
  return useQuery({
    queryKey: HANDOFF_AGENTS_QK,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<HandoffAgent[]> => {
      const { data, error } = await supabase
        .from("connections")
        .select("id, name, scopes, takes_handoffs, revoked_at")
        .order("created_at", { ascending: true });
      // A database the migration hasn't reached answers with an unknown column:
      // no agents, not an error.
      if (error) return [];
      return ((data ?? []) as { id: string; name: string; scopes: string[]; takes_handoffs?: boolean; revoked_at: string | null }[])
        .filter((c) => c.takes_handoffs && !c.revoked_at && c.scopes?.includes("account"))
        .map((c) => ({ id: c.id, name: c.name }));
    },
  });
}

/** Who a task is with (or was, when it's done), by name. */
export function agentName(agents: HandoffAgent[] | undefined, id: string | null | undefined): string | null {
  if (!id) return null;
  return agents?.find((a) => a.id === id)?.name ?? "an agent";
}

/** A task's hand-offs, newest first — the agent's notes live here. */
export function useTaskHandoffs(taskId: string | null, enabled = true) {
  return useQuery({
    queryKey: historyKey(taskId ?? ""),
    enabled: Boolean(taskId) && enabled,
    queryFn: async (): Promise<HandoffRecord[]> => {
      const { data, error } = await supabase
        .from("handoffs")
        .select("*")
        .eq("task_id", taskId!)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) return [];
      return (data ?? []) as HandoffRecord[];
    },
  });
}

async function call(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke<Record<string, unknown>>("handoff", { body });
  if (error) {
    let message = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      const j = ctx ? await ctx.json() : null;
      if (j?.error) message = String(j.error);
    } catch {
      /* keep the transport's message */
    }
    throw new Error(message);
  }
  return data ?? {};
}

export function useHandoffActs() {
  const qc = useQueryClient();

  const settle = useCallback(
    (task: unknown) => {
      if (task && typeof task === "object" && "id" in task) putTaskInCaches(qc, String((task as Task).id), task as Task);
      qc.invalidateQueries({ queryKey: ["handoffs"] });
    },
    [qc],
  );

  /** Take a task back. Its clock time isn't restored; it keeps its day. */
  const recall = useCallback(
    async (task: Task, agent?: HandoffAgent | null) => {
      patchCaches(qc, task.id, { handed_to: null });
      try {
        const out = await call({ action: "recall", task_id: task.id });
        settle(out.task);
        toast.success(agent ? `Taken back from ${agent.name}` : "Taken back");
      } catch (e) {
        patchCaches(qc, task.id, { handed_to: task.handed_to ?? null });
        toast.error(`Couldn't take it back: ${(e as Error).message}`);
      }
    },
    [qc, settle],
  );

  /** Hand a task to an agent. The clock time comes off; the day stays. */
  const hand = useCallback(
    async (task: Task, agent: HandoffAgent, note: string) => {
      const before: Partial<Task> = { handed_to: task.handed_to ?? null, start_time: task.start_time, slot_id: task.slot_id };
      patchCaches(qc, task.id, { handed_to: agent.id, start_time: null, slot_id: null });
      try {
        const out = await call({ action: "hand", task_id: task.id, connection_id: agent.id, note });
        settle(out.task);
        const ringError = typeof out.ring_error === "string" ? out.ring_error : null;
        toast.success(`With ${agent.name} — ${task.title}`, {
          description: ringError ? `Couldn't ring its doorbell (${ringError}). It will find it on its next check.` : undefined,
          action: { label: "Take back", onClick: () => void recall({ ...task, handed_to: agent.id }, agent) },
        });
      } catch (e) {
        patchCaches(qc, task.id, before);
        toast.error(`Couldn't hand it off: ${(e as Error).message}`);
      }
    },
    [qc, settle, recall],
  );

  return { hand, recall };
}

/** Settings: set an agent's doorbell, or ring it to test. */
export async function setDoorbell(connectionId: string, url: string, key: string | null) {
  return call({ action: "doorbell", connection_id: connectionId, url, ...(key != null ? { key } : {}) });
}
export async function ringDoorbell(connectionId: string) {
  return call({ action: "ring", connection_id: connectionId });
}
