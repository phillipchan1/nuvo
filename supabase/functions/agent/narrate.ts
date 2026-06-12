// The narrator: turns the raw weekly/quarterly deltas into one gain-framed
// sentence (measure from where you started, not from the ideal). Pure voice —
// the numbers are computed client-side and passed in; nothing is invented.

import { completeText } from "./llm.ts";

export interface NarrateStats {
  window: "week" | "quarter";
  doneCount: number;
  doneHours: number;
  byDomain: { name: string; hours: number; targetHours: number }[];
  moved: { name: string; from: number; to: number }[];
  shipped?: string[];
}

export async function narrate(stats: NarrateStats): Promise<{ sentence: string }> {
  const prompt = `You write ONE sentence (max 30 words) reflecting someone's last ${stats.window} of work, in the Dan Sullivan "gap and gain" spirit: measure backward from where they started, never against the ideal. Warm, specific, grounded — no exclamation marks, no hype words, no advice.

The measured facts (do not invent anything beyond these):
${JSON.stringify(stats, null, 2)}

Respond with the sentence only.`;

  const sentence = (await completeText(prompt)).trim().replace(/^"|"$/g, "");
  if (!sentence) throw new Error("Empty narration");
  return { sentence };
}
