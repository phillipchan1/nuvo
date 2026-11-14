// Draft a one-line outcome for a raw project or initiative — the Tending
// ritual's "raw → shaped" advance. Reads the item's name + domain intention
// (and an optional `guidance` redirect from the reshape loop) and returns one
// crisp "what done looks like" line. Proposes only; the client writes it on take.
// The prompt is shared with the Worker (draftOutcomePrompt.ts).

import { admin } from "../_shared/admin.ts";
import { completeJSON } from "./llm.ts";
import { draftOutcomePrompt, draftOutcomeResult, draftOutcomeTable } from "./draftOutcomePrompt.ts";

export async function draftOutcome(
  userId: string,
  input: { kind: "project" | "initiative"; id: string; guidance?: string },
): Promise<{ outcome: string }> {
  const table = draftOutcomeTable(input.kind);
  const { data: item, error } = await admin
    .from(table)
    .select("name, outcome, description, domain_id")
    .eq("id", input.id)
    .eq("user_id", userId)
    .single();
  if (error || !item) throw new Error(`${input.kind} not found`);

  const domain = item.domain_id
    ? (await admin.from("domains").select("name, intention").eq("id", item.domain_id).maybeSingle()).data
    : null;

  const raw = await completeJSON<{ outcome?: unknown }>(draftOutcomePrompt(input, item, domain));
  return draftOutcomeResult(raw);
}
