// The Supabase agent's binding of verifyCore.ts, which the Cloudflare Worker
// runs too: the same code, handed the service-role client and Deno.env.

import type { Rest } from "./agentDeps.ts";
import * as core from "./verifyCore.ts";
import { supabaseDeps } from "./supabaseDeps.ts";

export * from "./verifyCore.ts";

export const verifyItem = (...args: Rest<typeof core.verifyItem>) => core.verifyItem(supabaseDeps, ...args);
