// Layer 3 of time allocation — the AI router.
//
// Events on calendars the user mapped (Settings → Connections) are attributed
// deterministically. This handles the rest: a mixed personal calendar holding
// both Trading meetings and family time. For a batch of such events it reads the
// user's domains + their routing `context` (scope / entities / boundary — the
// same signal passive grooming uses) and assigns each event the domain it
// matches, caching the verdict per stable event_key in `event_domain_routing`.
// Conservative: null (no confident home) is cached too, so we never re-spend
// tokens on an event we've already judged.
//
// The judgment itself is the routing kernel's (`_shared/domainRouting.ts`, via
// `_shared/eventRouting.ts`): the Decisions classifier over the same charter-led
// domain descriptions and confirmed exemplars the Inbox uses, attributing only
// at the AUTO tier. The free-form prompt below is the FALLBACK — used only when
// the classifier can't be reached (no OPENAI_API_KEY, e.g. an OpenRouter-only
// deploy; beta not enabled; a timeout). The worker twin is
// worker/src/routeEventsHttp.ts and calls the same shared half.
//
// Standalone (not folded into `agent`) so it deploys on its own.

import { admin, handleOptions, json, requireUser } from "../_shared/admin.ts";
import { llmBaseUrl, llmHeaders, llmKey, llmModel } from "../agent/llm.ts";
import { refuseFrozenWrite } from "../_shared/writeFreeze.ts";
import {
  EVENT_BATCH,
  attributeEvents,
  eventTitleKey,
  fanOut,
  uniqueEvents,
  type AttributableEvent,
  type EventVerdict,
} from "../_shared/eventRouting.ts";
import { decide, decisionsAvailable } from "../agent/decisions.ts";
import { routeDomainsFor, type Domain } from "../agent/enrichInbox.ts";

// deno-lint-ignore no-control-regex
const clean = (s: unknown): string => (typeof s === "string" ? s : "").replace(/[\x00-\x1F\x7F]/g, " ").trim();

async function completeJSON<T>(prompt: string): Promise<T> {
  const key = llmKey();
  const res = await fetch(`${llmBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: llmHeaders(key),
    body: JSON.stringify({
      model: llmModel("gpt-5.4-nano"),
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2, // attribution is judgment, not prose — keep it stable
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`);
  const completion = await res.json();
  return JSON.parse(completion.choices?.[0]?.message?.content ?? "{}") as T;
}

type InEvent = AttributableEvent;

type DomainRow = Domain & {
  context: { scope?: string; entities?: string[]; boundary?: string } | null;
};

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const frozen = refuseFrozenWrite(req);
  if (frozen) return frozen;
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    // Cap the batch — the client re-fires as the cache fills, converging over a
    // few loads without ever sending a giant prompt.
    const events: InEvent[] = Array.isArray(body.events) ? body.events.slice(0, EVENT_BATCH) : [];
    if (!events.length) return json({ routed: [] });

    const { data: domRows } = await admin
      .from("domains")
      .select("id, name, color, intention, charter, context")
      .eq("user_id", user.id)
      .order("sort_order");
    const domains = (domRows ?? []) as DomainRow[];
    if (!domains.length) return json({ routed: [] });

    let verdicts = new Map<string, EventVerdict>();
    let pending: InEvent[] = uniqueEvents(events);
    if (decisionsAvailable()) {
      const got = await attributeEvents(await routeDomainsFor(user.id, domains), events, decide);
      verdicts = got.verdicts;
      pending = got.missed;
    }
    if (pending.length) {
      try {
        for (const [k, v] of await legacyRoute(domains, pending)) verdicts.set(k, v);
      } catch (e) {
        // Nothing judged at all → fail as before. Partly judged → keep what the
        // classifier gave; the rest stays uncached and is retried next load.
        if (!verdicts.size) throw e;
        console.warn("[route-events] fallback failed:", e instanceof Error ? e.message : "error");
      }
    }

    // Fan each unique-title verdict back to every instance.
    const out = fanOut(events, verdicts);
    const now = new Date().toISOString();
    const rows = out.map((v) => ({ user_id: user.id, event_key: v.key, domain_id: v.domainId, confidence: v.confidence, routed_at: now }));

    if (rows.length) {
      const { error } = await admin.from("event_domain_routing").upsert(rows, { onConflict: "user_id,event_key" });
      if (error) throw new Error(error.message);
    }
    return json({ routed: out });
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

/** The old router — one free-form JSON completion over the whole batch, graded
 *  by the model's own confidence. Now only the FALLBACK for titles the
 *  classifier couldn't be reached for. `uniques` are already de-duplicated by
 *  title; a title the model omits falls to null, as it always did. */
async function legacyRoute(domains: DomainRow[], uniques: InEvent[]): Promise<Map<string, EventVerdict>> {
  // A catch-all domain is defined by exclusions, not positive signals (empty
  // entities). The model can't reliably infer it, and weak-matches residual
  // events onto signal-rich domains instead — so name it explicitly.
  const catchAll =
    domains.find((d) => !(d.context?.entities?.length) && /personal|life|misc|other/i.test(d.name)) ??
    domains.find((d) => !(d.context?.entities?.length));

  const domLine = domains
    .map((d) => {
      const c = d.context;
      const bits: string[] = [];
      if (c?.scope) bits.push(clean(c.scope));
      else if (d.intention) bits.push(clean(d.intention));
      if (c?.entities?.length) bits.push(`signals: ${c.entities.map(clean).join(", ")}`);
      if (c?.boundary) bits.push(`NOT: ${clean(c.boundary)}`);
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
1. Assign a SPECIFIC (non-catch-all) domain ONLY when the title clearly names or strongly implies that domain's scope or signal words. A weak or thematic association is NOT enough — do not stretch a generic event onto a signal-rich domain just because a word loosely fits.
2. If it does not strongly match a specific domain, and a domain is marked [CATCH-ALL personal domain] above, assign that catch-all's id. A social, relational, or life-admin event — a 1:1 or lunch with a named person, a call/Facetime, an errand, appointment, or travel — belongs in the catch-all, NOT in a specific work/church/trading domain it only loosely resembles.
3. Return null only when the title is truly cryptic/uninformative, or there is no [CATCH-ALL] domain at all.

Never invent a domain id; use only the bracketed ids above. Return exactly one entry for EVERY index listed above — do not skip any.

Respond with JSON only:
{"routed":[{"i":<event index>,"domainId":<domain id string or null>,"confidence":<0..1>}]}`;

  const raw = await completeJSON<{ routed?: Array<{ i: unknown; domainId: unknown; confidence: unknown }> }>(prompt);

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
