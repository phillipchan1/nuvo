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
// Standalone (not folded into `agent`) so it deploys on its own. Mirrors
// agent/enrichInbox.ts; shares model selection with agent/llm.ts so a model
// swap there doesn't silently miss this endpoint.

import { admin, handleOptions, json, requireUser } from "../_shared/admin.ts";
import { llmBaseUrl, llmHeaders, llmKey, llmModel } from "../agent/llm.ts";
import { cleanText as clean, domainRoutingBlock, fromDomainRow } from "../_shared/domainRouting.ts";
import { type EventSignal, eventSignalKey, readEventSignal } from "../_shared/eventSignal.ts";

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

interface InEvent {
  key: string; // account_id:provider_event_id — the cache key
  /** `external_events.id` — the exact, indexed handle for the server-side
   *  attendee lookup. Sent alongside `key` rather than parsing the composite. */
  id?: string;
  title: string;
  calendarName?: string;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    // Cap the batch — the client re-fires as the cache fills, converging over a
    // few loads without ever sending a giant prompt.
    const events: InEvent[] = Array.isArray(body.events) ? body.events.slice(0, 40) : [];
    if (!events.length) return json({ routed: [] });

    const { data: domRows } = await admin
      .from("domains")
      .select("id, name, intention, charter, context")
      .eq("user_id", user.id)
      .order("sort_order");
    if (!domRows?.length) return json({ routed: [] });
    const domains = domRows.map(fromDomainRow);

    // The domain block — including which domain is the catch-all — is built by
    // the shared routing kernel, so this endpoint, passive inbox grooming and
    // the project router describe a domain the same way. It used to be built
    // here by hand and saw three of the seven fields we generate.
    const { text: domLine } = domainRoutingBlock(domains);

    // The signal a title can't carry: who is in the meeting, where, and the
    // first line of the invite. Resolved HERE rather than in the client because
    // `useExternalEvents` deliberately doesn't select `raw` — and attendee
    // addresses have no business making a round trip through the browser.
    const ids = events.map((e) => e.id).filter((v): v is string => typeof v === "string");
    const signals = new Map<string, EventSignal>();
    if (ids.length) {
      const { data: rows } = await admin
        .from("external_events")
        .select("id, location, raw")
        .eq("user_id", user.id)
        .in("id", ids);
      for (const r of rows ?? []) signals.set(r.id as string, readEventSignal(r.raw, r.location));
    }
    const signalOf = (e: InEvent): EventSignal =>
      (e.id && signals.get(e.id)) || { attendees: "", description: "", location: "", orgs: [] };

    // Recurring events (a daily "Facetime", a weekly "Deep Focus Work") flood the
    // batch with the same title; routing each instance separately is wasteful and
    // lets the model return partial results. Route each UNIQUE question once,
    // then fan the verdict back out to every instance.
    //
    // The key includes the attendees' org domains: once attendees are in the
    // prompt, a title-only key would collapse a 1:1 with the day job and a 1:1
    // with the church into one verdict — discarding the very signal that was
    // just added.
    const uniques: InEvent[] = [];
    const uniqueIdx = new Map<string, number>();
    for (const e of events) {
      const tk = eventSignalKey(e.title, e.calendarName ?? "", signalOf(e));
      if (!uniqueIdx.has(tk)) {
        uniqueIdx.set(tk, uniques.length);
        uniques.push(e);
      }
    }

    const evLine = uniques
      .map((e, i) => {
        const s = signalOf(e);
        const meta = [
          e.calendarName ? `cal: ${clean(e.calendarName)}` : "",
          s.attendees ? `with ${s.attendees}` : "",
          s.location ? `at ${s.location}` : "",
          s.description ? `note: ${s.description}` : "",
        ]
          .filter(Boolean)
          .join("; ");
        return `[${i}] "${clean(e.title) || "(untitled)"}"${meta ? ` (${meta})` : ""}`;
      })
      .join("\n");

    const prompt = `You are quietly attributing a person's calendar events to their life domains so their time-allocation is honest — they should not have to tag meetings by hand. Be a sharp copilot: match each event to the domain its title/signals fit.

Their life domains (each with what it is, the people, signals, recurring activities and tools that mark it, and the boundaries that exclude it):
${domLine}

The events to attribute. An attendee written "Name (@acme.com)" carries their organisation — the org domain is often a stronger signal than the meeting's title, and an unlisted person from a known org still points at that org's life domain:
${evLine}

For EACH event:
1. Assign a SPECIFIC (non-catch-all) domain ONLY when the title, the attendees' organisation, or the note clearly names or strongly implies that domain. A weak or thematic association is NOT enough — do not stretch a generic event onto a signal-rich domain just because a word loosely fits. If a domain lists the event under "looks like this but ISN'T", believe it.
2. If it does not strongly match a specific domain, and a domain is marked [CATCH-ALL] above, assign that catch-all's id. A social, relational, or life-admin event — a 1:1 or lunch with a named person, a call/Facetime, an errand, appointment, or travel — belongs in the catch-all, NOT in a specific work/church/trading domain it only loosely resembles.
3. Return null only when the event is truly cryptic/uninformative, or there is no [CATCH-ALL] domain at all.
4. Report confidence honestly. A verdict you are unsure of is more useful marked unsure than asserted — a low score leaves the time unattributed instead of inventing an hour in the wrong place.

Never invent a domain id; use only the bracketed ids above. Return exactly one entry for EVERY index listed above — do not skip any.

Respond with JSON only:
{"routed":[{"i":<event index>,"domainId":<domain id string or null>,"confidence":<0..1>}]}`;

    const raw = await completeJSON<{ routed?: Array<{ i: unknown; domainId: unknown; confidence: unknown }> }>(prompt);

    const valid = new Set(domains.map((d) => d.id));
    // verdict per UNIQUE routing question (title + calendar + attendee orgs)
    const verdict = new Map<number, { domainId: string | null; confidence: number }>();
    for (const r of raw.routed ?? []) {
      const idx = Number(r.i);
      if (!Number.isInteger(idx) || idx < 0 || idx >= uniques.length || verdict.has(idx)) continue;
      const domainId = typeof r.domainId === "string" && valid.has(r.domainId) ? r.domainId : null;
      const confidence = Math.max(0, Math.min(1, Number(r.confidence) || 0));
      verdict.set(idx, { domainId, confidence });
    }

    // Fan each verdict back to every instance of the same question. One the
    // model omitted falls to null — rare, with few unique questions per batch.
    const out: Array<{ key: string; domainId: string | null; confidence: number }> = [];
    const rows: Array<Record<string, unknown>> = [];
    const now = new Date().toISOString();
    for (const ev of events) {
      const idx = uniqueIdx.get(eventSignalKey(ev.title, ev.calendarName ?? "", signalOf(ev)));
      const v = (idx === undefined ? undefined : verdict.get(idx)) ?? { domainId: null, confidence: 0 };
      out.push({ key: ev.key, domainId: v.domainId, confidence: v.confidence });
      rows.push({ user_id: user.id, event_key: ev.key, domain_id: v.domainId, confidence: v.confidence, routed_at: now });
    }

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
