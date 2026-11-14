// The Supabase agent's binding of scaffoldCore.ts, which the Cloudflare Worker
// runs too: the same code, handed the service-role client and Deno.env.

import type { Rest } from "./agentDeps.ts";
import * as core from "./scaffoldCore.ts";
import { supabaseDeps } from "./supabaseDeps.ts";

export * from "./scaffoldCore.ts";

export const scaffoldProject = (...args: Rest<typeof core.scaffoldProject>) => core.scaffoldProject(supabaseDeps, ...args);
export const scaffoldDraft = (...args: Rest<typeof core.scaffoldDraft>) => core.scaffoldDraft(supabaseDeps, ...args);
