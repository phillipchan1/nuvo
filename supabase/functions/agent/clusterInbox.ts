// The Supabase agent's binding of clusterInboxCore.ts, which the Cloudflare Worker
// runs too: the same code, handed the service-role client and Deno.env.

import type { Rest } from "./agentDeps.ts";
import * as core from "./clusterInboxCore.ts";
import { supabaseDeps } from "./supabaseDeps.ts";

export * from "./clusterInboxCore.ts";

export const clusterInbox = (...args: Rest<typeof core.clusterInbox>) => core.clusterInbox(supabaseDeps, ...args);
