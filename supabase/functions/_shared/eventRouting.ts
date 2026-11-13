// Calendar-event attribution on the routing kernel — the runtime-neutral half
// that BOTH `route-events` (Supabase / Deno) and its worker twin
// (`worker/src/routeEventsHttp.ts`, Cloudflare / Neon) call.
//
// "Which domain does this hour count toward" used to be a free-form JSON prompt,
// written twice (gpt-5.4-nano here, gpt-4.1-nano in the worker) and graded by
// the model's own self-reported confidence. It now asks the same classifier the
// Inbox asks (`domainRouting.ts`: one `choice` question over the person's
// domains, read off the returned distribution) — so a capture and a meeting
// with the same words land in the same place.
//
// The bar is higher than the Inbox's: a capture's automatic filing is VISIBLE
// (it sits in the Inbox with an Undo), an event's is not — it silently moves
// hours in the time ledger. So an event is attributed only at the AUTO tier
// (≥ ROUTE_AUTO); anything weaker caches null, exactly as the old router cached
// "no confident home", so the same event is never paid for twice.
//
// No Deno, no env, no database: the caller hands in the `decide` function (the
// HTTP call) and its own rows. A transport failure (`decide` → null) is NOT a
// verdict — those events come back as `missed`, for the caller's old path.

import {
  domainRequest,
  pickExemplars,
  readDomainVerdict,
  type DecisionRequest,
  type ExemplarTask,
  type RouteDomain,
} from "./domainRouting.ts";

export interface AttributableEvent {
  /** account_id:provider_event_id — the cache key. */
  key: string;
  title: string;
  calendarName?: string;
  /** Optional pre-joined "name <email>, …". */
  attendees?: string;
}

/** What is cached per event and returned to the client — unchanged shape. */
export interface EventVerdict {
  domainId: string | null;
  confidence: number;
}

/** The client re-fires as the cache fills; a batch never grows past this. */
export const EVENT_BATCH = 40;
/** Requests in flight at once. The call is fast; 40 at once is a rate-limit invitation. */
export const EVENT_CONCURRENCY = 8;

export const DECISIONS_ENDPOINT = "https://api.openai.com/v1/decisions";
const TIMEOUT_MS = 8000;

// Postgres jsonb / the prompt reject C0 control characters; strip them.
// deno-lint-ignore no-control-regex
const clean = (s: unknown): string => (typeof s === "string" ? s : "").replace(/[\x00-\x1F\x7F]/g, " ").replace(/\s+/g, " ").trim();

/** Recurring events (a daily stand-up) flood a batch with one title. Route each
 *  title-on-a-calendar ONCE and fan the verdict back out. */
export function eventTitleKey(e: AttributableEvent): string {
  return `${clean(e.title).toLowerCase()}|${clean(e.calendarName ?? "")}`;
}

export function uniqueEvents(events: AttributableEvent[]): AttributableEvent[] {
  const seen = new Set<string>();
  const out: AttributableEvent[] = [];
  for (const e of events) {
    const k = eventTitleKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

/** An event's text as the classifier sees it: the title, plus the calendar it
 *  sits on and who it's with when the client sent them — the same signals the
 *  old prompt read. No times, no ids. */
export function eventText(e: AttributableEvent): string {
  const lines = [clean(e.title)];
  const cal = clean(e.calendarName);
  if (cal) lines.push(`Calendar: ${cal}`);
  const who = clean(e.attendees);
  if (who) lines.push(`With: ${who.length > 200 ? `${who.slice(0, 199)}…` : who}`);
  return lines.join("\n");
}

/** One `/v1/decisions` answer → what is cached. Only the AUTO tier attributes;
 *  a weaker answer, a refusal, or a hallucinated id caches null. */
export function eventVerdict(response: unknown, domains: RouteDomain[]): EventVerdict {
  const v = readDomainVerdict(response, domains);
  if (!v) return { domainId: null, confidence: 0 };
  return v.tier === "auto" ? { domainId: v.id, confidence: v.probability } : { domainId: null, confidence: v.probability };
}

export type Decide = (req: DecisionRequest) => Promise<unknown | null>;

/** The HTTP call for a runtime that holds the key itself (the worker). Every
 *  failure is null, never a throw — "no verdict → the old path". Logs the
 *  status only: the body can echo the event's title. */
export async function postDecision(
  apiKey: string,
  req: DecisionRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown | null> {
  if (!apiKey) return null;
  try {
    const res = await fetchImpl(DECISIONS_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[decisions] ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn("[decisions] failed:", e instanceof Error ? e.name : "error");
    return null;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

export interface Attribution {
  /** Verdict per `eventTitleKey`. */
  verdicts: Map<string, EventVerdict>;
  /** Unique events the classifier could not be reached for — the caller's
   *  fallback path decides these (or leaves them unjudged). */
  missed: AttributableEvent[];
}

/** Ask the classifier about each unique title in the batch. */
export async function attributeEvents(
  domains: RouteDomain[],
  events: AttributableEvent[],
  decide: Decide,
  concurrency = EVENT_CONCURRENCY,
): Promise<Attribution> {
  const verdicts = new Map<string, EventVerdict>();
  const missed: AttributableEvent[] = [];
  if (!domains.length) return { verdicts, missed };
  await mapLimit(uniqueEvents(events), concurrency, async (e) => {
    const k = eventTitleKey(e);
    // An untitled event has nothing to judge — null, and no spend.
    if (!clean(e.title)) return void verdicts.set(k, { domainId: null, confidence: 0 });
    const res = await decide(domainRequest(domains, eventText(e)));
    if (res == null) missed.push(e);
    else verdicts.set(k, eventVerdict(res, domains));
  });
  return { verdicts, missed };
}

/** Fan per-title verdicts back to every instance. An event with no verdict
 *  (classifier and fallback both unreachable) is left out — uncached, so the
 *  next load tries it again. */
export function fanOut(
  events: AttributableEvent[],
  verdicts: Map<string, EventVerdict>,
): Array<{ key: string; domainId: string | null; confidence: number }> {
  const out: Array<{ key: string; domainId: string | null; confidence: number }> = [];
  for (const e of events) {
    const v = verdicts.get(eventTitleKey(e));
    if (v) out.push({ key: e.key, domainId: v.domainId, confidence: v.confidence });
  }
  return out;
}

/** A domain row as either database returns it. */
export interface DomainRowLike {
  id: string;
  name: string;
  intention?: string | null;
  charter?: string | null;
  context?: unknown;
}

/** Domain rows + recent tasks → what the classifier reads. The same shape the
 *  Inbox's `routeDomainsFor` builds: charter-led, with each domain's newest
 *  confirmed titles (`pickExemplars`) as live examples. */
export function toRouteDomains(domains: DomainRowLike[], tasks: ExemplarTask[] = []): RouteDomain[] {
  const recent = pickExemplars(tasks);
  return domains.map((d) => ({
    id: d.id,
    name: clean(d.name),
    intention: d.intention ?? null,
    charter: d.charter ?? null,
    context: (d.context ?? null) as RouteDomain["context"],
    recent: recent.get(d.id) ?? [],
  }));
}
