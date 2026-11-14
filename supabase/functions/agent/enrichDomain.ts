// The Supabase agent's binding of enrichDomainCore.ts, which the Cloudflare Worker
// runs too: the same code, handed the service-role client and Deno.env.

import type { Rest } from "./agentDeps.ts";
import * as core from "./enrichDomainCore.ts";
import { supabaseDeps } from "./supabaseDeps.ts";

export * from "./enrichDomainCore.ts";

export const enrichDomain = (...args: Rest<typeof core.enrichDomain>) => core.enrichDomain(supabaseDeps, ...args);
