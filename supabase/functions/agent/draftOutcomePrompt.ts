// The draftOutcome prompt, pure. Zero imports so the Supabase agent
// (draftOutcome.ts) and the Cloudflare Worker (worker/src/agentOneShot.ts)
// send the model the same words.

export type DraftOutcomeInput = { kind: "project" | "initiative"; id: string; guidance?: string };

export type DraftOutcomeItem = {
  name?: unknown;
  outcome?: unknown;
  description?: unknown;
  domain_id?: unknown;
};

export type DraftOutcomeDomain = { name?: unknown; intention?: unknown } | null;

/** Anything but "initiative" reads `projects` — the Supabase function never validated kind. */
export function draftOutcomeTable(kind: unknown): "initiatives" | "projects" {
  return kind === "initiative" ? "initiatives" : "projects";
}

export function draftOutcomePrompt(input: DraftOutcomeInput, item: DraftOutcomeItem, domain: DraftOutcomeDomain): string {
  const kindWord = input.kind === "initiative"
    ? "initiative (a bet with a finish line)"
    : "project (a concrete chunk of work)";

  return `You are helping define the OUTCOME of a personal ${kindWord}.

Name: ${item.name}
${item.outcome ? `Current outcome (improve on it): ${item.outcome}` : ""}
${item.description ? `Notes: ${item.description}` : ""}
${domain ? `Life domain: ${domain.name}. Standing intention: ${domain.intention}` : ""}
${input.guidance ? `The person redirected: "${input.guidance}". Honor this redirection.` : ""}

Write ONE crisp outcome line — what "done" looks like, concrete and verifiable, in the person's own voice. No preamble, no surrounding quotes, under 18 words.
Say what is TRUE in the world when it's done (who can now do what, or what changed, by when if it matters) — not that a document or deliverable exists, and never just the name restated.
  Weak: "I wrote a full plan for the canoe trip."
  Strong: "Four of us paddle the river in June with every permit and campsite booked."

Respond with JSON only: {"outcome": string}`;
}

export function draftOutcomeResult(raw: { outcome?: unknown }): { outcome: string } {
  return { outcome: String(raw.outcome ?? "").trim() };
}
