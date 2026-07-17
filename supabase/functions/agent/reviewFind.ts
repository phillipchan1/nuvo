// Warm narration for The Find — schema-locked, numbers never invented.
// Receives the already-selected candidate + receipt labels; returns only
// warmer headline/detail prose. Falls back to the deterministic copy on failure.

import { completeJSON } from "./llm.ts";

export interface ReviewFindInput {
  kind: string;
  tone: string;
  headline: string;
  detail: string;
  receiptLabels: string[];
  sealed?: boolean;
}

export interface ReviewFindOutput {
  headline: string;
  detail: string;
}

export async function narrateReviewFind(input: ReviewFindInput): Promise<ReviewFindOutput> {
  const prompt = `You are Nuvo writing the weekly Review's one discovery — "The Find."
Voice: a wise friend at the end of the week. Warm, unhurried, affirming. Never shame. Never advice-y. No exclamation marks. No hype words ("crushing it", "amazing", "incredible").

You are given ONE pre-selected finding with real facts. Rewrite the headline (max 22 words) and detail (1–2 sentences, max 40 words) in that voice.
Rules:
- Do NOT invent numbers, domains, projects, or receipts.
- Keep every concrete fact from the original (names, hours, counts).
- You may soften phrasing; you may not change meaning.
- Return JSON only: { "headline": string, "detail": string }

Finding:
${JSON.stringify(
  {
    kind: input.kind,
    tone: input.tone,
    headline: input.headline,
    detail: input.detail,
    receipts: input.receiptLabels.slice(0, 6),
    tense: input.sealed ? "past" : "present",
  },
  null,
  2,
)}`;

  const out = await completeJSON<ReviewFindOutput>(prompt);
  if (!out?.headline?.trim() || !out?.detail?.trim()) {
    return { headline: input.headline, detail: input.detail };
  }
  return {
    headline: out.headline.trim().replace(/^"|"$/g, ""),
    detail: out.detail.trim().replace(/^"|"$/g, ""),
  };
}
