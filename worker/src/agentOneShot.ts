// The Supabase agent function's one-shot endpoints, ported as-is onto the
// Worker store. Same prompt and LLM call (supabase/functions/agent/
// draftOutcomePrompt.ts + llmCore.ts), same ownership rule and the same
// thrown messages — handleAgent turns a throw into 500 {error}, as the
// Supabase function's outer catch does.

import { completeJSONFrom, type EnvGet } from "../../supabase/functions/agent/llmCore.ts";
import {
  draftOutcomePrompt,
  draftOutcomeResult,
  draftOutcomeTable,
  type DraftOutcomeDomain,
  type DraftOutcomeInput,
} from "../../supabase/functions/agent/draftOutcomePrompt.ts";
import type { Env } from "./env.ts";
import { getOwned, type Store } from "./store.ts";

/** The Worker's bindings, read the way llm.ts reads Deno.env.get: a string as-is, else unset. */
export function workerEnvGet(env: Env): EnvGet {
  return (name) => {
    const v = (env as unknown as Record<string, unknown>)[name];
    return typeof v === "string" ? v : undefined;
  };
}

/** Tending's "raw → shaped" advance: one outcome line for a project / initiative. */
export async function draftOutcome(
  store: Store,
  env: Env,
  input: DraftOutcomeInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ outcome: string }> {
  // Supabase: `.eq("id").eq("user_id").single()` — a foreign, missing or
  // malformed id all end in `${kind} not found`.
  let item: Record<string, unknown> | null = null;
  try {
    item = await getOwned(store, draftOutcomeTable(input.kind), String(input.id));
  } catch {
    item = null;
  }
  if (!item) throw new Error(`${input.kind} not found`);

  // One deliberate difference: Supabase read the domain by id with the service
  // role; here it must also be the caller's. The Worker's FK guard already keeps
  // a foreign domain_id off owned rows, so for real data the prompt is the same.
  let domain: DraftOutcomeDomain = null;
  if (item.domain_id) {
    try {
      domain = (await getOwned(store, "domains", String(item.domain_id))) as DraftOutcomeDomain;
    } catch {
      domain = null;
    }
  }

  const raw = await completeJSONFrom<{ outcome?: unknown }>(
    workerEnvGet(env),
    draftOutcomePrompt(input, item, domain),
    fetchImpl,
  );
  return draftOutcomeResult(raw);
}
