import type { Context } from "hono";
import { OPEN_CORS, json } from "./cors.ts";
import { requireStore, type AppEnv } from "./session.ts";

const clean = (s: unknown): string => (typeof s === "string" ? s : "").replace(/[\x00-\x1F\x7F]/g, " ").trim();

interface InEvent {
  key: string;
  title: string;
  calendarName?: string;
  attendees?: string;
}

type DomainRow = {
  id: string;
  name: string;
  intention: string | null;
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
  const events: InEvent[] = Array.isArray(body.events) ? body.events.slice(0, 40) : [];
  if (!events.length) return json({ routed: [] }, 200, OPEN_CORS);

  const domains = (await store.sql`
    SELECT id, name, intention, context
    FROM domains
    WHERE user_id = ${store.userId}
    ORDER BY sort_order
  `) as DomainRow[];
  if (!domains.length) return json({ routed: [] }, 200, OPEN_CORS);

  const key = c.env.OPENAI_API_KEY?.trim() ?? "";
  if (!key) return json({ error: "llm unavailable" }, 503, OPEN_CORS);

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

  const titleKey = (e: InEvent) => `${clean(e.title).toLowerCase()}|${clean(e.calendarName ?? "")}`;
  const uniques: InEvent[] = [];
  const uniqueIdx = new Map<string, number>();
  for (const e of events) {
    const tk = titleKey(e);
    if (!uniqueIdx.has(tk)) {
      uniqueIdx.set(tk, uniques.length);
      uniques.push(e);
    }
  }

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

  const raw = await completeJSON<{ routed?: Array<{ i: unknown; domainId: unknown; confidence: unknown }> }>(key, prompt);
  const valid = new Set(domains.map((d) => d.id));
  const verdict = new Map<number, { domainId: string | null; confidence: number }>();
  for (const r of raw.routed ?? []) {
    const idx = Number(r.i);
    if (!Number.isInteger(idx) || idx < 0 || idx >= uniques.length || verdict.has(idx)) continue;
    const domainId = typeof r.domainId === "string" && valid.has(r.domainId) ? r.domainId : null;
    const confidence = Math.max(0, Math.min(1, Number(r.confidence) || 0));
    verdict.set(idx, { domainId, confidence });
  }

  const out: Array<{ key: string; domainId: string | null; confidence: number }> = [];
  const now = new Date().toISOString();
  for (const ev of events) {
    const v = verdict.get(uniqueIdx.get(titleKey(ev))!) ?? { domainId: null, confidence: 0 };
    out.push({ key: ev.key, domainId: v.domainId, confidence: v.confidence });
    await store.sql`
      INSERT INTO event_domain_routing (user_id, event_key, domain_id, confidence, routed_at)
      VALUES (${store.userId}, ${ev.key}, ${v.domainId}, ${v.confidence}, ${now})
      ON CONFLICT (user_id, event_key) DO UPDATE
      SET domain_id = EXCLUDED.domain_id,
          confidence = EXCLUDED.confidence,
          routed_at = EXCLUDED.routed_at
    `;
  }
  return json({ routed: out }, 200, OPEN_CORS);
}
