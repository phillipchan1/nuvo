// The worker twin of supabase/functions/route-events — same contract, same
// judgment. Attribution asks the routing kernel's Decisions classifier through
// the shared half (`_shared/eventRouting.ts`), over the same charter-led domain
// descriptions + confirmed exemplars the Inbox uses, and attributes only at the
// AUTO tier (null is cached below it). The free-form prompt is the FALLBACK, for
// titles the classifier couldn't be reached for (beta not enabled, timeout).

import type { Context } from "hono";
import { OPEN_CORS, json } from "./cors.ts";
import { requireStore, type AppEnv } from "./session.ts";
import type { Store } from "./store.ts";
import {
  EVENT_BATCH,
  attributeEvents,
  eventTitleKey,
  fanOut,
  postDecision,
  toRouteDomains,
  type AttributableEvent,
  type EventVerdict,
} from "../../supabase/functions/_shared/eventRouting.ts";
import type { ExemplarTask } from "../../supabase/functions/_shared/domainRouting.ts";

const clean = (s: unknown): string => (typeof s === "string" ? s : "").replace(/[\x00-\x1F\x7F]/g, " ").trim();

type InEvent = AttributableEvent;

type DomainRow = {
  id: string;
  name: string;
  intention: string | null;
  charter: string | null;
  context: { scope?: string; entities?: string[]; boundary?: string } | null;
};

async function completeJSON<T>(apiKey: string, prompt: string): Promise<T> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-nano",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`LLM error ${res.status}`);
  const completion = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return JSON.parse(completion.choices?.[0]?.message?.content ?? "{}") as T;
}

export async function handleRouteEvents(c: Context<AppEnv>): Promise<Response> {
  if (c.req.method === "OPTIONS") return new Response("ok", { headers: OPEN_CORS });
  if (c.req.method !== "POST") return json({ error: "Method not allowed" }, 405, OPEN_CORS);

  const got = await requireStore(c);
  if ("error" in got) return got.error;
  const store = got.store;
  const body = (await c.req.json().catch(() => ({}))) as { events?: InEvent[] };
  const events: InEvent[] = Array.isArray(body.events) ? body.events.slice(0, EVENT_BATCH) : [];
  if (!events.length) return json({ routed: [] }, 200, OPEN_CORS);

  const domains = (await store.sql`
    SELECT id, name, intention, charter, context
    FROM domains
    WHERE user_id = ${store.userId}
    ORDER BY sort_order
  `) as DomainRow[];
  if (!domains.length) return json({ routed: [] }, 200, OPEN_CORS);

  const key = c.env.OPENAI_API_KEY?.trim() ?? "";
  if (!key) return json({ error: "llm unavailable" }, 503, OPEN_CORS);

  // The classifier first; whatever it couldn't be reached for, the old prompt.
  const routeDomains = toRouteDomains(domains, await recentExemplars(store));
  const judged = await attributeEvents(routeDomains, events, (req) => postDecision(key, req));
  const verdicts = judged.verdicts;
  if (judged.missed.length) {
    try {
      for (const [k, v] of await legacyRoute(key, domains, judged.missed)) verdicts.set(k, v);
    } catch (e) {
      // Nothing judged at all → fail as before. Partly judged → keep what the
      // classifier gave; the rest stays uncached and is retried next load.
      if (!verdicts.size) throw e;
      console.warn("[route-events] fallback failed:", e instanceof Error ? e.message : "error");
    }
  }

  const out = fanOut(events, verdicts);
  const now = new Date().toISOString();
  for (const v of out) {
    await store.sql`
      INSERT INTO event_domain_routing (user_id, event_key, domain_id, confidence, routed_at)
      VALUES (${store.userId}, ${v.key}, ${v.domainId}, ${v.confidence}, ${now})
      ON CONFLICT (user_id, event_key) DO UPDATE
      SET domain_id = EXCLUDED.domain_id,
          confidence = EXCLUDED.confidence,
          routed_at = EXCLUDED.routed_at
    `;
  }
  return json({ routed: out }, 200, OPEN_CORS);
}

/** Recent tasks, as evidence for which domain they count toward — the rows
 *  `pickExemplars` (the kernel) chooses examples from. A parented task counts
 *  toward its PROJECT's domain; its own `domain_id` is a stale-prone copy
 *  (D-088). Neon has no `suggestion` column — the worker never auto-files a
 *  capture — so no row here can be the router's own unreviewed guess. */
async function recentExemplars(store: Store): Promise<ExemplarTask[]> {
  try {
    const rows = (await store.sql`
      SELECT t.title, t.created_at, COALESCE(p.domain_id, t.domain_id) AS domain_id
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id AND p.user_id = t.user_id
      WHERE t.user_id = ${store.userId}
        AND t.parent_task_id IS NULL
        AND t.status <> 'trashed'
        AND t.trashed_at IS NULL
      ORDER BY t.created_at DESC
      LIMIT 400
    `) as Array<{ title: string; created_at: string | Date; domain_id: string | null }>;
    return rows.map((r) => ({
      title: r.title,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      domainId: r.domain_id,
    }));
  } catch (e) {
    // Examples sharpen the classifier; their absence never blocks it.
    console.warn("[route-events] exemplars unavailable:", e instanceof Error ? e.message : "error");
    return [];
  }
}

/** The old router — one free-form JSON completion over the batch. Now only the
 *  FALLBACK for titles the classifier couldn't be reached for. `uniques` are
 *  already de-duplicated by title; an omitted title falls to null, as before. */
async function legacyRoute(apiKey: string, domains: DomainRow[], uniques: InEvent[]): Promise<Map<string, EventVerdict>> {
  const catchAll =
    domains.find((d) => !(d.context?.entities?.length) && /personal|life|misc|other/i.test(d.name)) ??
    domains.find((d) => !(d.context?.entities?.length));

  const domLine = domains
    .map((d) => {
      const ctx = d.context;
      const bits: string[] = [];
      if (ctx?.scope) bits.push(clean(ctx.scope));
      else if (d.intention) bits.push(clean(d.intention));
      if (ctx?.entities?.length) bits.push(`signals: ${ctx.entities.map(clean).join(", ")}`);
      if (ctx?.boundary) bits.push(`NOT: ${clean(ctx.boundary)}`);
      const tag = d.id === catchAll?.id ? " [CATCH-ALL personal domain]" : "";
      return `[${d.id}] ${clean(d.name)}${tag}${bits.length ? ` — ${bits.join(" · ")}` : ""}`;
    })
    .join("\n");

  const evLine = uniques
    .map((e, i) => {
      const meta = [e.calendarName ? `cal: ${clean(e.calendarName)}` : "", e.attendees ? `with ${clean(e.attendees)}` : ""]
        .filter(Boolean)
        .join("; ");
      return `[${i}] "${clean(e.title) || "(untitled)"}"${meta ? ` (${meta})` : ""}`;
    })
    .join("\n");

  const prompt = `You are quietly attributing a person's calendar events to their life domains so their time-allocation is honest — they should not have to tag meetings by hand. Be a sharp copilot: match each event to the domain its title/signals fit.

Their life domains (with the scope, signal words, and boundaries that define each):
${domLine}

The events to attribute:
${evLine}

For EACH event:
1. Assign a SPECIFIC (non-catch-all) domain ONLY when the title clearly names or strongly implies that domain's scope or signal words.
2. If it does not strongly match a specific domain, and a domain is marked [CATCH-ALL personal domain] above, assign that catch-all's id.
3. Return null only when the title is truly cryptic/uninformative, or there is no [CATCH-ALL] domain at all.

Never invent a domain id; use only the bracketed ids above. Return exactly one entry for EVERY index listed above.

Respond with JSON only:
{"routed":[{"i":<event index>,"domainId":<domain id string or null>,"confidence":<0..1>}]}`;

  const raw = await completeJSON<{ routed?: Array<{ i: unknown; domainId: unknown; confidence: unknown }> }>(apiKey, prompt);
  const valid = new Set(domains.map((d) => d.id));
  const out = new Map<string, EventVerdict>();
  for (const r of raw.routed ?? []) {
    const idx = Number(r.i);
    if (!Number.isInteger(idx) || idx < 0 || idx >= uniques.length) continue;
    const k = eventTitleKey(uniques[idx]);
    if (out.has(k)) continue;
    const domainId = typeof r.domainId === "string" && valid.has(r.domainId) ? r.domainId : null;
    const confidence = Math.max(0, Math.min(1, Number(r.confidence) || 0));
    out.set(k, { domainId, confidence });
  }
  for (const e of uniques) if (!out.has(eventTitleKey(e))) out.set(eventTitleKey(e), { domainId: null, confidence: 0 });
  return out;
}
