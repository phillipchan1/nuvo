// Draft a one-line outcome for a raw project or initiative — the Tending
// ritual's "raw → shaped" advance. Reads the item's name + domain intention
// (and an optional `guidance` redirect from the reshape loop) and returns one
// crisp "what done looks like" line. Proposes only; the client writes it on take.

import { admin } from "../_shared/admin.ts";
import { completeJSON } from "./llm.ts";

export async function draftOutcome(
  userId: string,
  input: { kind: "project" | "initiative"; id: string; guidance?: string },
): Promise<{ outcome: string }> {
  const table = input.kind === "initiative" ? "initiatives" : "projects";
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

  const kindWord = input.kind === "initiative"
    ? "initiative (a bet with a finish line)"
    : "project (a concrete chunk of work)";

  const prompt = `You are helping define the OUTCOME of a personal ${kindWord}.

Name: ${item.name}
${item.outcome ? `Current outcome (improve on it): ${item.outcome}` : ""}
${item.description ? `Notes: ${item.description}` : ""}
${domain ? `Life domain: ${domain.name}. Standing intention: ${domain.intention}` : ""}
${input.guidance ? `The person redirected: "${input.guidance}". Honor this redirection.` : ""}

Write ONE crisp outcome line — what "done" looks like, concrete and verifiable, in the person's own voice. No preamble, no surrounding quotes, under 18 words.

Respond with JSON only: {"outcome": string}`;

  const raw = await completeJSON<{ outcome?: unknown }>(prompt);
  return { outcome: String(raw.outcome ?? "").trim() };
}
