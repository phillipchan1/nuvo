// The Supabase agent's binding of nameSlotCore.ts, which the Cloudflare Worker
// runs too: the same code, handed the service-role client and Deno.env.

import type { Rest } from "./agentDeps.ts";
import * as core from "./nameSlotCore.ts";
import { supabaseDeps } from "./supabaseDeps.ts";

export * from "./nameSlotCore.ts";

export const nameSlot = (...args: Rest<typeof core.nameSlot>) => core.nameSlot(supabaseDeps, ...args);
