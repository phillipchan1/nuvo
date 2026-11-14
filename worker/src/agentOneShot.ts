// The Supabase agent function's one-shot endpoints on the Worker. The routing
// (supabase/functions/agent/oneShots.ts), the prompts, the LLM calls and the
// post-processing are the Supabase agent's own code; only the runtime differs:
// `db` is agentDb.ts (the session-scoped PostgREST layer) instead of the
// service-role client, and `env` reads the Worker's bindings instead of Deno.env.

import type { AgentDeps } from "../../supabase/functions/agent/agentDeps.ts";
import type { EnvGet } from "../../supabase/functions/agent/llmCore.ts";
import { runOneShot } from "../../supabase/functions/agent/oneShots.ts";
import { agentDb } from "./agentDb.ts";
import type { Env } from "./env.ts";
import type { Store } from "./store.ts";

/** The Worker's bindings, read the way llm.ts reads Deno.env.get: a string as-is, else unset. */
export function workerEnvGet(env: Env): EnvGet {
  return (name) => {
    const v = (env as unknown as Record<string, unknown>)[name];
    return typeof v === "string" ? v : undefined;
  };
}

export function workerAgentDeps(store: Store, env: Env): AgentDeps {
  return { db: agentDb(store), env: workerEnvGet(env) };
}

/** The one-shot's JSON, or undefined when the body names none (fall through to chat). */
export function runWorkerOneShot(store: Store, env: Env, body: Record<string, unknown>): Promise<unknown | undefined> {
  return runOneShot(workerAgentDeps(store, env), store.userId, body);
}
