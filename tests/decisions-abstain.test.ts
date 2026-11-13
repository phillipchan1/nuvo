import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// decisions.ts reads Deno.env; give it a key.
beforeEach(() => {
  (globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => (k === "OPENAI_API_KEY" ? "test-key" : undefined) } };
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { Deno?: unknown }).Deno;
});

const DOMAINS = [
  { id: "d-work", name: "Hospital", description: "Shifts and the unit" },
  { id: "d-home", name: "Home", description: "The flat and money" },
] as never;

const answer = (body: unknown, status = 200) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

describe("the classifier's two kinds of silence (Inbox fallback)", () => {
  it("a refusal is an abstention, not an outage — nothing falls back", async () => {
    const { routeDomainAnswer } = await import("../supabase/functions/agent/decisions.ts");
    answer({ answers: [{ name: "domain", type: "refusal" }] });
    expect(await routeDomainAnswer(DOMAINS, "Call Sarah back")).toBe("abstained");
  });

  it("an id that isn't one of yours is an abstention too", async () => {
    const { routeDomainAnswer } = await import("../supabase/functions/agent/decisions.ts");
    answer({ answers: [{ name: "domain", type: "choice", choice: "d-made-up", probabilities: [{ value: "d-made-up", probability: 0.9 }] }] });
    expect(await routeDomainAnswer(DOMAINS, "Pay rent")).toBe("abstained");
  });

  it("only an error or no answer at all is null, the one case that may fall back", async () => {
    const { routeDomainAnswer } = await import("../supabase/functions/agent/decisions.ts");
    answer({ error: "nope" }, 500);
    expect(await routeDomainAnswer(DOMAINS, "Pay rent")).toBeNull();
  });

  it("a real choice comes back as a verdict with its tier", async () => {
    const { routeDomainAnswer } = await import("../supabase/functions/agent/decisions.ts");
    answer({ answers: [{ name: "domain", type: "choice", choice: "d-home", probabilities: [{ value: "d-home", probability: 0.86 }] }] });
    expect(await routeDomainAnswer(DOMAINS, "Pay rent")).toMatchObject({ id: "d-home", tier: "auto" });
  });
});
