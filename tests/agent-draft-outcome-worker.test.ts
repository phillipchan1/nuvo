// The Worker's `draftOutcome` one-shot is the Supabase agent's, ported as-is:
// same prompt and model call, the same owner check, and the same {error} body
// a throw becomes in the Supabase outer catch (500; a missing/foreign row is 404).
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { oneShotPg } from "./agent/oneShotPg.ts";
import { resetRestCatalogForTests } from "../worker/src/rest.ts";
import { makePgliteSql } from "../worker/src/pgliteSql.ts";
import { makeStore, type Store } from "../worker/src/store.ts";
import { draftOutcomePrompt } from "../supabase/functions/agent/draftOutcomePrompt.ts";

const A = "11111111-1111-1111-1111-111111111111";
const A_DOMAIN = "aaaaaaaa-0000-4000-8000-000000000001";
const A_PROJECT = "aaaaaaaa-1111-4000-8000-000000000001";
const A_INITIATIVE = "aaaaaaaa-7777-4000-8000-000000000001";
const B_PROJECT = "bbbbbbbb-1111-4000-8000-000000000001";
const RANDOM_ID = "99999999-9999-4999-8999-999999999999";

let currentStore: Store;
vi.mock("../worker/src/session.ts", () => ({
  requireStore: async () => ({ store: currentStore, email: null, user: { id: currentStore.userId, emailVerified: true } }),
}));
const { handleAgent } = await import("../worker/src/agentHttp.ts");

type Call = { url: string; body: Record<string, unknown>; auth: string | null };

function llmStub(content: string, status = 200) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")),
      auth: new Headers(init?.headers).get("authorization"),
    });
    return new Response(status === 200 ? JSON.stringify({ choices: [{ message: { content } }] }) : content, { status });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

async function call(body: unknown, env: Record<string, string> = { OPENAI_API_KEY: "sk-test" }) {
  const c = {
    req: { method: "POST", json: async () => body, raw: new Request("https://api.test/api/agent") },
    env,
  };
  // deno-lint-ignore no-explicit-any
  const res = await handleAgent(c as any);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

let db: PGlite;
beforeAll(async () => {
  // The isolation schema plus the prod columns the one-shots read (projects /
  // initiatives description, ...), which the rehearsal neon.sql lacks.
  db = await oneShotPg();
  resetRestCatalogForTests();
  await db.query("UPDATE public.domains SET intention = 'Ship calm work' WHERE id = $1", [A_DOMAIN]);
  currentStore = makeStore(makePgliteSql(db), A);
});
afterAll(async () => {
  await db.close();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Worker agent draftOutcome (ported from the Supabase agent)", () => {
  it("owner gets {outcome} from the same prompt and model call", async () => {
    const calls = llmStub(JSON.stringify({ outcome: "  A Project live for 10 paying users  " }));
    const res = await call({ draftOutcome: { kind: "project", id: A_PROJECT, guidance: "keep it small" } });
    expect(res).toEqual({ status: 200, body: { outcome: "A Project live for 10 paying users" } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0].auth).toBe("Bearer sk-test");
    expect(calls[0].body).toMatchObject({ model: "gpt-5.4-nano", temperature: 0.2, response_format: { type: "json_object" } });
    const prompt = (calls[0].body.messages as { content: string }[])[0].content;
    expect(prompt).toBe(
      draftOutcomePrompt(
        { kind: "project", id: A_PROJECT, guidance: "keep it small" },
        { name: "A Project", outcome: "", description: null },
        { name: "A Work", intention: "Ship calm work" },
      ),
    );
    expect(prompt).toContain("project (a concrete chunk of work)");
    expect(prompt).toContain("Life domain: A Work. Standing intention: Ship calm work");
    expect(prompt).toContain('The person redirected: "keep it small". Honor this redirection.');
  });

  it("initiatives read the initiatives table; OPENAI_MODEL overrides the model", async () => {
    const calls = llmStub(JSON.stringify({ outcome: "Bet won" }));
    const res = await call({ draftOutcome: { kind: "initiative", id: A_INITIATIVE } }, { OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "gpt-x" });
    expect(res).toEqual({ status: 200, body: { outcome: "Bet won" } });
    expect(calls[0].body.model).toBe("gpt-x");
    expect((calls[0].body.messages as { content: string }[])[0].content).toContain("Name: A Initiative");
  });

  it("a non-owner is rejected like a missing id: 404 {error: '<kind> not found'}, no LLM call", async () => {
    const calls = llmStub(JSON.stringify({ outcome: "never" }));
    const foreign = await call({ draftOutcome: { kind: "project", id: B_PROJECT } });
    const missing = await call({ draftOutcome: { kind: "project", id: RANDOM_ID } });
    const malformed = await call({ draftOutcome: { kind: "project", id: "not-a-uuid" } });
    expect(foreign).toEqual({ status: 404, body: { error: "project not found" } });
    expect(missing).toEqual(foreign);
    expect(malformed).toEqual(foreign);
    expect(calls).toHaveLength(0);
  });

  it("a bad kind gets the Supabase behavior: read as a project, error names the kind", async () => {
    const calls = llmStub(JSON.stringify({ outcome: "Shipped" }));
    expect(await call({ draftOutcome: { kind: "goal", id: RANDOM_ID } })).toEqual({ status: 500, body: { error: "goal not found" } });
    expect(await call({ draftOutcome: { kind: "goal", id: A_INITIATIVE } })).toEqual({ status: 500, body: { error: "goal not found" } });
    expect(calls).toHaveLength(0);
    // Supabase never validated kind: anything but "initiative" reads `projects`.
    expect(await call({ draftOutcome: { kind: "goal", id: A_PROJECT } })).toEqual({ status: 200, body: { outcome: "Shipped" } });
  });

  it("renders the outcome and notes lines, the exact Supabase wording, and no domain line without a domain", async () => {
    await db.query(
      "INSERT INTO public.projects (id, user_id, name, outcome, description) VALUES ($1, $2, 'Garage', 'Clean it', 'Boxes everywhere')",
      [ "aaaaaaaa-1111-4000-8000-0000000000ff", A ],
    );
    const calls = llmStub(JSON.stringify({ outcome: "Garage fits the car" }));
    const res = await call({ draftOutcome: { kind: "project", id: "aaaaaaaa-1111-4000-8000-0000000000ff" } });
    expect(res).toEqual({ status: 200, body: { outcome: "Garage fits the car" } });
    expect((calls[0].body.messages as { content: string }[])[0].content).toBe(
      `You are helping define the OUTCOME of a personal project (a concrete chunk of work).

Name: Garage
Current outcome (improve on it): Clean it
Notes: Boxes everywhere



Write ONE crisp outcome line — what "done" looks like, concrete and verifiable, in the person's own voice. No preamble, no surrounding quotes, under 18 words.

Respond with JSON only: {"outcome": string}`,
    );
  });

  it("no id falls through to chat, like Supabase: 400 messages required", async () => {
    llmStub("{}");
    expect(await call({ draftOutcome: { kind: "project" } })).toEqual({ status: 400, body: { error: "messages required" } });
  });

  it("LLM failures surface as Supabase's 500 messages", async () => {
    llmStub("rate limited", 429);
    expect(await call({ draftOutcome: { kind: "project", id: A_PROJECT } })).toEqual({
      status: 500,
      body: { error: expect.stringMatching(/^LLM error 429: /) },
    });
    llmStub("not json");
    expect(await call({ draftOutcome: { kind: "project", id: A_PROJECT } })).toEqual({
      status: 500,
      body: { error: "Could not parse the model's JSON response" },
    });
    llmStub("{}");
    expect(await call({ draftOutcome: { kind: "project", id: A_PROJECT } }, {})).toEqual({
      status: 500,
      body: { error: "OPENROUTER_API_KEY or OPENAI_API_KEY not configured" },
    });
    expect(await call({ draftOutcome: { kind: "project", id: A_PROJECT } })).toEqual({ status: 200, body: { outcome: "" } });
  });
});

describe("llmCore (shared by Supabase llm.ts and the Worker)", () => {
  it("routes through OpenRouter with its headers and default model when OPENROUTER_API_KEY is set", async () => {
    const { completeJSONFrom } = await import("../supabase/functions/agent/llmCore.ts");
    const seen: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"outcome":"x"}' } }] }));
    }) as unknown as typeof fetch;
    const env: Record<string, string> = { OPENROUTER_API_KEY: "or-key", OPENAI_API_KEY: "sk" };
    expect(await completeJSONFrom((k) => env[k], "p", fetchImpl)).toEqual({ outcome: "x" });
    expect(seen[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(seen[0].headers.get("authorization")).toBe("Bearer or-key");
    expect(seen[0].headers.get("http-referer")).toBe("https://nuvo.app");
    expect(seen[0].headers.get("x-title")).toBe("Nuvo");
    expect(seen[0].body).toEqual({
      model: "qwen/qwen3.7-plus-20260602",
      messages: [{ role: "user", content: "p" }],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });
  });

  it("an empty OPENROUTER_API_KEY still wins over OPENAI_API_KEY, as Deno.env's ?? did", async () => {
    const { llmKeyFrom } = await import("../supabase/functions/agent/llmCore.ts");
    const env: Record<string, string> = { OPENROUTER_API_KEY: "", OPENAI_API_KEY: "sk" };
    expect(() => llmKeyFrom((k) => env[k])).toThrow("OPENROUTER_API_KEY or OPENAI_API_KEY not configured");
  });
});
