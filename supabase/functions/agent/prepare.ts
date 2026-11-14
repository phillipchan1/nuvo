// The Supabase agent's binding of prepareCore.ts, which the Cloudflare Worker
// runs too: the same code, handed the service-role client and Deno.env.

import type { Rest } from "./agentDeps.ts";
import * as core from "./prepareCore.ts";
import { supabaseDeps } from "./supabaseDeps.ts";

export * from "./prepareCore.ts";

export const prepareTask = (...args: Rest<typeof core.prepareTask>) => core.prepareTask(supabaseDeps, ...args);
