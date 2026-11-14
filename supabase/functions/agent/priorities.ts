// The Supabase agent's binding of prioritiesCore.ts, which the Cloudflare Worker
// runs too: the same code, handed the service-role client and Deno.env.

import type { Rest } from "./agentDeps.ts";
import * as core from "./prioritiesCore.ts";
import { supabaseDeps } from "./supabaseDeps.ts";

export * from "./prioritiesCore.ts";

export const parsePriorities = (...args: Rest<typeof core.parsePriorities>) => core.parsePriorities(supabaseDeps, ...args);
export const breakdownPriority = (...args: Rest<typeof core.breakdownPriority>) => core.breakdownPriority(supabaseDeps, ...args);
