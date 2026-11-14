// The Supabase agent's binding of decisionsCore.ts (shared with the Worker):
// the OpenAI Decisions caller, reading Deno.env at call time.

import type { DecisionRequest, RouteDomain, RouteHome } from "../_shared/domainRouting.ts";
import * as core from "./decisionsCore.ts";
import type { EnvGet } from "./llmCore.ts";

export { mapLimit } from "./decisionsCore.ts";

const env: EnvGet = (name) => Deno.env.get(name);

export const decisionsAvailable = (): boolean => core.decisionsAvailable(env);
export const decide = (req: DecisionRequest) => core.decide(env, req);
export const routeDomainAnswer = (domains: RouteDomain[], text: string) => core.routeDomainAnswer(env, domains, text);
export const routeDomain = (domains: RouteDomain[], text: string) => core.routeDomain(env, domains, text);
export const routeHome = (homes: RouteHome[], domainName: string, text: string) => core.routeHome(env, homes, domainName, text);
