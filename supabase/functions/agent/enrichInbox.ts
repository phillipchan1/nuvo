// The Supabase agent's binding of enrichInboxCore.ts, which the Cloudflare Worker
// runs too: the same code, handed the service-role client and Deno.env.

import type { Rest } from "./agentDeps.ts";
import * as core from "./enrichInboxCore.ts";
import { supabaseDeps } from "./supabaseDeps.ts";

export * from "./enrichInboxCore.ts";

export const enrichInboxBatch = (...args: Rest<typeof core.enrichInboxBatch>) => core.enrichInboxBatch(supabaseDeps, ...args);
export const routeDomainsFor = (...args: Rest<typeof core.routeDomainsFor>) => core.routeDomainsFor(supabaseDeps, ...args);
export const routeProject = (...args: Rest<typeof core.routeProject>) => core.routeProject(supabaseDeps, ...args);
