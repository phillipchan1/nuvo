// The Supabase agent's binding of blueprintCore.ts, which the Cloudflare Worker
// runs too: the same code, handed the service-role client and Deno.env.

import type { Rest } from "./agentDeps.ts";
import * as core from "./blueprintCore.ts";
import { supabaseDeps } from "./supabaseDeps.ts";

export * from "./blueprintCore.ts";

export const blueprintInitiative = (...args: Rest<typeof core.blueprintInitiative>) => core.blueprintInitiative(supabaseDeps, ...args);
export const draftInitiativeProjects = (...args: Rest<typeof core.draftInitiativeProjects>) => core.draftInitiativeProjects(supabaseDeps, ...args);
