// The Supabase agent's binding of proposalContextCore.ts, which the Cloudflare Worker
// runs too: the same code, handed the service-role client and Deno.env.

import type { Rest } from "./agentDeps.ts";
import * as core from "./proposalContextCore.ts";
import { supabaseDeps } from "./supabaseDeps.ts";

export * from "./proposalContextCore.ts";

export const buildProposalContext = (...args: Rest<typeof core.buildProposalContext>) => core.buildProposalContext(supabaseDeps, ...args);
