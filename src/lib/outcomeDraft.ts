// One ✦ outcome draft for a project with none (D-207, docs/rail-line.md §5) —
// the agent's own `draftOutcome` endpoint (the Tending ritual's raw → shaped
// step), on the Worker and on Supabase alike. It PROPOSES: the deck's Get ready
// card shows the line, says it's a draft, and writes nothing until you press
// *Set as outcome* (P3). Failure is a quiet state — the card falls back to Open.

import { supabase } from "./supabase";

export async function fetchOutcomeDraft(kind: "project" | "initiative", id: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("agent", { body: { draftOutcome: { kind, id } } });
  if (error) throw error;
  const text = String((data as { outcome?: unknown } | null)?.outcome ?? "").trim();
  if (!text) throw new Error("empty outcome draft");
  return text;
}
