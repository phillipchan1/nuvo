/**
 * Draft the path's one request (D-193): ask the agent for a project's missing
 * tasks. Every surface that drafts a project's work — the record's own list
 * (`usePathDraft`) and the deck's Plan projects walk — goes through this, so
 * there is one drafter, not two.
 *
 * `guidance` steers (a "Tell Nuvo what to change" line); `redraft` names the
 * drafted lines the steer may replace — anything you touched is left out of it
 * by the caller (R12), so the agent never sees it as up for rewriting.
 */

import { supabase } from "./supabase";
import type { ProposedStep } from "./pathDraft";

export type AskScaffold = (projectId: string, guidance?: string, redraft?: string[]) => Promise<ProposedStep[]>;

export const askScaffold: AskScaffold = async (projectId, guidance, redraft) => {
  const { data, error } = await supabase.functions.invoke<{ tasks?: ProposedStep[] }>("agent", {
    body: { scaffold: { projectId, guidance, redraft } },
  });
  if (error) throw error;
  return (data?.tasks ?? []).filter((p) => p && typeof p.title === "string" && p.title.trim());
};
