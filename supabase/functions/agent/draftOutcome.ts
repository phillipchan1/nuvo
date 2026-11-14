// The Supabase agent's binding of draftOutcomeCore.ts, which the Cloudflare Worker
// runs too: the same code, handed the service-role client and Deno.env.

import type { Rest } from "./agentDeps.ts";
import * as core from "./draftOutcomeCore.ts";
import { supabaseDeps } from "./supabaseDeps.ts";

export * from "./draftOutcomeCore.ts";

export const draftOutcome = (...args: Rest<typeof core.draftOutcome>) => core.draftOutcome(supabaseDeps, ...args);
