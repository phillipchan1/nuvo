// The Supabase agent's binding of narrateCore.ts, which the Cloudflare Worker
// runs too: the same code, handed the service-role client and Deno.env.

import type { Rest } from "./agentDeps.ts";
import * as core from "./narrateCore.ts";
import { supabaseDeps } from "./supabaseDeps.ts";

export * from "./narrateCore.ts";

export const narrate = (...args: Rest<typeof core.narrate>) => core.narrate(supabaseDeps, ...args);
