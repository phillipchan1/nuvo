// The Supabase agent's binding of refineCore.ts, which the Cloudflare Worker
// runs too: the same code, handed the service-role client and Deno.env.

import type { Rest } from "./agentDeps.ts";
import * as core from "./refineCore.ts";
import { supabaseDeps } from "./supabaseDeps.ts";

export * from "./refineCore.ts";

export const refineProject = (...args: Rest<typeof core.refineProject>) => core.refineProject(supabaseDeps, ...args);
