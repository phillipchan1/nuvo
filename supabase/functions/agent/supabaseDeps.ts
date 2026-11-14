// The Supabase agent's runtime for the shared one-shot cores: the service-role
// client and Deno.env.

import { admin } from "../_shared/admin.ts";
import type { AgentDb, AgentDeps } from "./agentDeps.ts";

export const supabaseDeps: AgentDeps = { db: admin as unknown as AgentDb, env: (name) => Deno.env.get(name) };
