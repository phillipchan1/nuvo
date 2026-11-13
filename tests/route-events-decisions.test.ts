// Calendar-event attribution runs on the routing kernel's Decisions classifier
// (D-088's domains, the Inbox's thresholds) in BOTH runtimes, through the shared
// half `_shared/eventRouting.ts`. What is held here:
//   · the request is the kernel's shape, against the measured model;
//   · only the AUTO tier attributes — a middling answer and a hallucinated id
//     both cache null (an event's attribution is invisible, so it must be sure);
//   · a transport failure is NOT a verdict — it falls to the old prompt;
//   · the Deno handler wires all of that to the cache table, and still works on
//     an OpenRouter-only deploy (no OPENAI_API_KEY → the old path, unchanged).

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DECISIONS_ENDPOINT,
  attributeEvents,
  eventText,
  eventVerdict,
  fanOut,
  postDecision,
  toRouteDomains,
  type AttributableEvent,
} from "../supabase/functions/_shared/eventRouting";
import { DECISIONS_MODEL, DOMAIN_QUESTION_NAME, ROUTE_AUTO, type RouteDomain } from "../supabase/functions/_shared/domainRouting";
import { db, resetDb } from "./agent/fakeSupabase";

const DOMAINS: RouteDomain[] = toRouteDomains(
  [
    { id: "d-ward", name: "Ward", charter: "My job as a charge nurse on 4 West.", context: { entities: ["4 West"] } },
    { id: "d-kids", name: "Kids", charter: "Leo and Ana: school, sport, appointments." },
  ],
  [{ title: "Book Ana's checkup", createdAt: "2026-11-01", domainId: "d-kids" }],
);

/** A `/v1/decisions` answer: choice + distribution. */
const answer = (choice: string, top: number, other = "d-kids") => ({
  answers: [
    {
      type: "choice",
      name: DOMAIN_QUESTION_NAME,
      choice,
      probabilities: [
        { value: choice, probability: top },
        { value: other, probability: Math.max(0, 1 - top) },
      ],
    },
  ],
  usage: { input_tokens: 120, output_tokens: 4 },
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

const ev = (key: string, title: string, calendarName?: string): AttributableEvent => ({ key, title, calendarName });

describe("the shared half (both runtimes)", () => {
  it("asks the kernel's question, against gpt-6-luna, with the event's words", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => ok(answer("d-ward", 0.9)));
    await postDecision("sk-test", { model: "x", input: "y", questions: [] }, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0][0]).toBe(DECISIONS_ENDPOINT);

    const seen: unknown[] = [];
    await attributeEvents(DOMAINS, [ev("a:1", "Night shift", "Work")], async (req) => {
      seen.push(req);
      return answer("d-ward", 0.9);
    });
    const req = seen[0] as { model: string; input: string; questions: Array<{ type: string; name: string; choices: Array<{ value: string; description: string }> }> };
    expect(req.model).toBe(DECISIONS_MODEL);
    expect(req.model).toBe("gpt-6-luna");
    expect(req.input).toBe("Night shift\nCalendar: Work");
    expect(req.questions).toHaveLength(1);
    expect(req.questions[0]).toMatchObject({ type: "choice", name: DOMAIN_QUESTION_NAME });
    expect(req.questions[0].choices.map((c) => c.value)).toEqual(["d-ward", "d-kids"]);
    // Charter-led, with confirmed exemplars — the same description the Inbox sends.
    expect(req.questions[0].choices[1].description).toContain("Recent tasks here: Book Ana's checkup.");
  });

  it("attributes at the auto tier", () => {
    expect(eventVerdict(answer("d-ward", 0.85), DOMAINS)).toEqual({ domainId: "d-ward", confidence: 0.85 });
    expect(eventVerdict(answer("d-ward", ROUTE_AUTO), DOMAINS).domainId).toBe("d-ward");
  });

  it("caches null below it — a suggestion is not an attribution", () => {
    expect(eventVerdict(answer("d-ward", 0.6), DOMAINS)).toEqual({ domainId: null, confidence: 0.6 });
    expect(eventVerdict(answer("d-ward", 0.3), DOMAINS).domainId).toBeNull();
  });

  it("caches null for a hallucinated id or a refusal", () => {
    expect(eventVerdict(answer("d-ghost", 0.99), DOMAINS)).toEqual({ domainId: null, confidence: 0 });
    expect(eventVerdict({ answers: [{ type: "refusal", name: DOMAIN_QUESTION_NAME }] }, DOMAINS)).toEqual({ domainId: null, confidence: 0 });
  });

  it("routes each title once, fans out to every instance, and hands transport failures back", async () => {
    const events = [ev("a:1", "Night shift"), ev("a:2", "night  shift"), ev("a:3", "Leo practice"), ev("a:4", "")];
    const decide = vi.fn(async (req: { input: string }) => (req.input.startsWith("Leo") ? null : answer("d-ward", 0.9)));
    const got = await attributeEvents(DOMAINS, events, decide);
    expect(decide).toHaveBeenCalledTimes(2); // de-duplicated; the untitled one costs nothing
    expect(got.missed.map((e) => e.key)).toEqual(["a:3"]);
    expect(fanOut(events, got.verdicts)).toEqual([
      { key: "a:1", domainId: "d-ward", confidence: 0.9 },
      { key: "a:2", domainId: "d-ward", confidence: 0.9 },
      { key: "a:4", domainId: null, confidence: 0 },
    ]);
  });

  it("a failed or rejected call is null, never a throw", async () => {
    const deny = vi.fn(async () => new Response("not enabled", { status: 403 }));
    expect(await postDecision("sk-test", { model: "x", input: "y", questions: [] }, deny as unknown as typeof fetch)).toBeNull();
    const boom = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect(await postDecision("sk-test", { model: "x", input: "y", questions: [] }, boom as unknown as typeof fetch)).toBeNull();
    expect(await postDecision("", { model: "x", input: "y", questions: [] }, deny as unknown as typeof fetch)).toBeNull();
    expect(deny).toHaveBeenCalledTimes(1);
  });

  it("the event's text carries the calendar and attendees, nothing else", () => {
    expect(eventText({ key: "k", title: "  Sync ", attendees: "Dev <d@x.com>" })).toBe("Sync\nWith: Dev <d@x.com>");
    expect(eventText({ key: "k", title: "Sync" })).toBe("Sync");
  });
});

// ── the Deno handler, driven for real ────────────────────────────────────────

vi.mock("../supabase/functions/agent/enrichInbox.ts", async () => {
  const shared = await import("../supabase/functions/_shared/eventRouting");
  // The exemplar query is enrichInbox's (and tested with it); here only the
  // domains matter.
  return { routeDomainsFor: async (_u: string, domains: never[]) => shared.toRouteDomains(domains) };
});

type Handler = (req: Request) => Promise<Response>;
let handler: Handler;
const deno = (globalThis as unknown as { Deno: { env: { set(k: string, v: string): void }; serve?: (h: Handler) => void } }).Deno;

beforeAll(async () => {
  deno.serve = (h) => {
    handler = h;
  };
  const { admin } = await import("../supabase/functions/_shared/admin");
  (admin as unknown as { auth: { getUser: () => Promise<unknown> } }).auth.getUser = async () => ({ data: { user: { id: "u1" } }, error: null });
  await import("../supabase/functions/route-events/index");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function seed() {
  resetDb({
    domains: [
      { id: "d-ward", user_id: "u1", name: "Ward", color: null, intention: null, charter: "Charge nurse on 4 West.", context: { entities: ["4 West"] } },
      { id: "d-kids", user_id: "u1", name: "Kids", color: null, intention: null, charter: "Leo and Ana.", context: null },
    ],
    event_domain_routing: [],
  });
}

const post = (events: AttributableEvent[]) =>
  handler(new Request("https://fn.local/route-events", { method: "POST", headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" }, body: JSON.stringify({ events }) }));

describe("route-events (Deno)", () => {
  it("attributes through the classifier and caches every verdict, null included", async () => {
    seed();
    deno.env.set("OPENAI_API_KEY", "sk-test");
    const calls: Array<{ url: string; body: { model: string; input: string } }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body });
      if (body.input.startsWith("Night shift")) return ok(answer("d-ward", 0.85));
      if (body.input.startsWith("Lunch")) return ok(answer("d-kids", 0.6));
      return ok(answer("d-ghost", 0.97));
    });
    const res = await post([ev("a:1", "Night shift"), ev("a:2", "Lunch with Priya"), ev("a:3", "Mystery")]);
    const out = (await res.json()) as { routed: unknown[] };
    expect(res.status).toBe(200);
    expect(calls.every((c) => c.url === DECISIONS_ENDPOINT && c.body.model === "gpt-6-luna")).toBe(true);
    expect(out.routed).toEqual([
      { key: "a:1", domainId: "d-ward", confidence: 0.85 },
      { key: "a:2", domainId: null, confidence: 0.6 },
      { key: "a:3", domainId: null, confidence: 0 },
    ]);
    expect(db.event_domain_routing.map((r) => [r.event_key, r.domain_id])).toEqual([
      ["a:1", "d-ward"],
      ["a:2", null],
      ["a:3", null],
    ]);
  });

  it("falls back to the old prompt for what the classifier couldn't answer", async () => {
    seed();
    deno.env.set("OPENAI_API_KEY", "sk-test");
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      if (url === DECISIONS_ENDPOINT) return new Response("not enabled", { status: 403 });
      return ok({ choices: [{ message: { content: JSON.stringify({ routed: [{ i: 0, domainId: "d-kids", confidence: 0.7 }] }) } }] });
    });
    const out = (await (await post([ev("a:9", "Leo practice")])).json()) as { routed: unknown[] };
    expect(urls).toEqual([DECISIONS_ENDPOINT, "https://api.openai.com/v1/chat/completions"]);
    expect(out.routed).toEqual([{ key: "a:9", domainId: "d-kids", confidence: 0.7 }]);
  });

  it("with no OpenAI key (OpenRouter-only), never calls the classifier — the old path, unchanged", async () => {
    seed();
    deno.env.set("OPENAI_API_KEY", "");
    deno.env.set("OPENROUTER_API_KEY", "or-test");
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return ok({ choices: [{ message: { content: JSON.stringify({ routed: [{ i: 0, domainId: "d-ward", confidence: 0.9 }] }) } }] });
    });
    const out = (await (await post([ev("a:5", "Unit council")])).json()) as { routed: unknown[] };
    expect(urls).toEqual(["https://openrouter.ai/api/v1/chat/completions"]);
    expect(out.routed).toEqual([{ key: "a:5", domainId: "d-ward", confidence: 0.9 }]);
    expect(db.event_domain_routing).toHaveLength(1);
  });
});
