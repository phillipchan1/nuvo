// The Supabase agent's binding of reviewFindCore.ts, which the Cloudflare Worker
// runs too: the same code, handed the service-role client and Deno.env.

import type { Rest } from "./agentDeps.ts";
import * as core from "./reviewFindCore.ts";
import { supabaseDeps } from "./supabaseDeps.ts";

export * from "./reviewFindCore.ts";

export const narrateReviewFind = (...args: Rest<typeof core.narrateReviewFind>) => core.narrateReviewFind(supabaseDeps, ...args);
