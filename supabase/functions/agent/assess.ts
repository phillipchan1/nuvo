// The Supabase agent's binding of assessCore.ts, which the Cloudflare Worker
// runs too: the same code, handed the service-role client and Deno.env.

import type { Rest } from "./agentDeps.ts";
import * as core from "./assessCore.ts";
import { supabaseDeps } from "./supabaseDeps.ts";

export * from "./assessCore.ts";

export const assessRecord = (...args: Rest<typeof core.assessRecord>) => core.assessRecord(supabaseDeps, ...args);
