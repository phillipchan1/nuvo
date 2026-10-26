// OpenAI Decisions API — the thin Deno caller under the routing kernel.
//
// `POST /v1/decisions` is a classifier, not a chat: it takes text and a typed
// question and returns a probability distribution. It is billed on input only
// (~$0.10 / 1M tokens) and OpenAI documents it as ~10x faster than the Responses
// API, which is why filing a capture no longer has to wait on a general model.
//
// OPENAI_API_KEY only. OpenRouter does not serve this endpoint, so `llm.ts`'s
// "OpenRouter wins if set" rule must NOT apply here — a router key sent to
// api.openai.com is a 401 on every capture.
//
// Every failure resolves to `null`, never a throw: the endpoint is in public
// beta (one reviewer saw a 403 "not enabled for your account"), and the caller's
// contract is "no verdict → fall back to the old path". The kernel does all the
// deciding; this file only moves bytes.

import {
  domainRequest,
  homeRequest,
  readDomainVerdict,
  readHome,
  type DecisionRequest,
  type RouteDomain,
  type RouteHome,
  type RouteVerdict,
} from "../_shared/domainRouting.ts";

const ENDPOINT = "https://api.openai.com/v1/decisions";
const TIMEOUT_MS = 8000;

/** True when a Decisions call could possibly succeed from this runtime. */
export function decisionsAvailable(): boolean {
  return Boolean(Deno.env.get("OPENAI_API_KEY"));
}

export async function decide(req: DecisionRequest): Promise<unknown | null> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // Log the status, never the body: the body can echo the capture's text.
      console.warn(`[decisions] ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn("[decisions] failed:", e instanceof Error ? e.name : "error");
    return null;
  }
}

/** Which of the person's domains does `text` belong to? Null = no verdict. */
export async function routeDomain(domains: RouteDomain[], text: string): Promise<RouteVerdict | null> {
  if (!domains.length || !text.trim()) return null;
  return readDomainVerdict(await decide(domainRequest(domains, text)), domains);
}

/** Having settled on a domain, is it unmistakably about one specific project /
 *  initiative inside it? A second request: it depends on the first answer. */
export async function routeHome(
  homes: RouteHome[],
  domainName: string,
  text: string,
): Promise<{ home: RouteHome; probability: number } | null> {
  if (!homes.length) return null;
  return readHome(await decide(homeRequest(homes, domainName, text)), homes);
}

/** Run `fn` over `items` at most `limit` at a time, preserving order. A grooming
 *  batch is up to 25 captures; firing 25 requests at once is a rate-limit
 *  invitation for no gain in a call this fast. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
