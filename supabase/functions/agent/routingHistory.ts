// The Supabase agent's binding of routingHistoryCore.ts, which the Cloudflare Worker
// runs too: the same code, handed the service-role client and Deno.env.

import type { Rest } from "./agentDeps.ts";
import * as core from "./routingHistoryCore.ts";
import { supabaseDeps } from "./supabaseDeps.ts";

export * from "./routingHistoryCore.ts";

export const loadRoutingEvents = (...args: Rest<typeof core.loadRoutingEvents>) => core.loadRoutingEvents(supabaseDeps, ...args);
export const routingReadout = (...args: Rest<typeof core.routingReadout>) => core.routingReadout(supabaseDeps, ...args);
