/**
 * Draft the path's one request (D-193): ask the agent for a project's missing
 * tasks. Every surface that drafts a project's work — the record's own list
 * (`usePathDraft`) and the deck's Plan projects walk — goes through this, so
 * there is one drafter, not two.
 *
 * `guidance` steers (a "Tell Nuvo what to change" line); `redraft` names the
 * drafted lines the steer may replace — anything you touched is left out of it
 * by the caller (R12), so the agent never sees it as up for rewriting.
 * `keep` is the reverse: lines you touched or typed that aren't saved yet. The
 * agent reads them as part of your plan (its `draftTitles`), so a redraft
 * fills gaps around them instead of restating them.
 */

import { supabase } from "./supabase";
import type { ProposedStep } from "./pathDraft";

export interface ScaffoldLimits {
  maxCount?: number | null;
  maxMins?: number | null;
}
export type AskScaffold = (projectId: string, guidance?: string, redraft?: string[], keep?: string[], limits?: ScaffoldLimits) => Promise<ProposedStep[]>;

export const askScaffold: AskScaffold = async (projectId, guidance, redraft, keep, limits) => {
  const { data, error } = await supabase.functions.invoke<{ tasks?: ProposedStep[] }>("agent", {
    body: {
      scaffold: {
        projectId,
        guidance,
        redraft,
        draftTitles: keep?.length ? keep : undefined,
        maxCount: limits?.maxCount ?? undefined,
        maxMinutes: limits?.maxMins ?? undefined,
      },
    },
  });
  if (error) throw error;
  return (data?.tasks ?? []).filter((p) => p && typeof p.title === "string" && p.title.trim());
};
