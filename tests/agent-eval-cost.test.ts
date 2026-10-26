// The battery's bill and its scope — the parts of `npm run eval` that decide how
// much a live run spends. Pure, so they're held here rather than discovered on
// an invoice. See tests/agent/cost.ts and tests/agent/scope.ts.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createChatClient } from "../supabase/functions/agent/loop.ts";
import { TOOL_DEFINITIONS } from "../supabase/functions/agent/toolDefs.ts";
import {
  costOf,
  estimate,
  formatUsage,
  parseSpend,
  priceFor,
  ratesFor,
  readUsage,
  type SpendRecord,
} from "./agent/cost.ts";
import { parseDiff, scenarioBlocks, touchedGroups } from "./agent/scope.ts";
import { SCENARIOS } from "./agent/scenarios.ts";

describe("usage + cost", () => {
  it("reads the provider's usage block, cached tokens included", () => {
    expect(
      readUsage({ prompt_tokens: 26000, completion_tokens: 120, prompt_tokens_details: { cached_tokens: 24576 } }),
    ).toEqual({ requests: 1, prompt: 26000, cached: 24576, completion: 120 });
    // No usage is unknown, never zero.
    expect(readUsage(undefined)).toBeNull();
    expect(readUsage({ total_tokens: 3 })).toBeNull();
  });

  it("prices cached input at the cached rate", () => {
    const p = priceFor("gpt-5.6-terra")!;
    // 1M in, all of it cached, nothing out → the cached rate exactly.
    expect(costOf({ requests: 1, prompt: 1e6, cached: 1e6, completion: 0 }, p)).toBeCloseTo(p.cached);
    expect(costOf({ requests: 1, prompt: 1e6, cached: 0, completion: 1e6 }, p)).toBeCloseTo(p.input + p.output);
  });

  it("EVAL_PRICE overrides the table; an unknown model has no price rather than a guessed one", () => {
    expect(priceFor("qwen/qwen3.6-flash")).toBeNull();
    expect(priceFor("qwen/qwen3.6-flash", "0.1, 0.01, 0.4")).toEqual({ input: 0.1, cached: 0.01, output: 0.4 });
    expect(priceFor("gpt-5.6-terra", "junk")).toEqual(priceFor("gpt-5.6-terra"));
  });

  it("says when the provider reported nothing", () => {
    expect(formatUsage({ requests: 0, prompt: 0, cached: 0, completion: 0 }, null, 3)).toMatch(/unknown/);
  });
});

describe("the estimate", () => {
  const line = (over: Partial<SpendRecord> = {}): SpendRecord => ({
    at: "2026-10-22T00:00:00Z",
    model: "gpt-5.6-terra",
    scenarioRuns: 10,
    usage: { requests: 20, prompt: 500_000, cached: 450_000, completion: 3_000 },
    args: "",
    ...over,
  });

  it("assumes the worst — no cache — until a run of that model has been measured", () => {
    const r = ratesFor("gpt-5.6-terra", [], 25_000);
    expect(r.cacheRate).toBe(0);
    expect(r.prompt).toBe(50_000);
  });

  it("calibrates from the ledger once there is one, per model", () => {
    const r = ratesFor("gpt-5.6-terra", [line(), line({ model: "gpt-5.6-luna", usage: { requests: 1, prompt: 1, cached: 0, completion: 1 } })], 25_000);
    expect(r.prompt).toBe(50_000);
    expect(r.cacheRate).toBeCloseTo(0.9);
    const e = estimate(100, r, priceFor("gpt-5.6-terra"));
    expect(e.usage.prompt).toBe(5_000_000);
    expect(e.usd).toBeGreaterThan(0);
  });

  it("a corrupt ledger line loses one run, not the ledger", () => {
    expect(parseSpend(`${JSON.stringify(line())}\n{oops\n${JSON.stringify(line())}\n`)).toHaveLength(2);
  });
});

describe("the transport can report what it spent", () => {
  async function bodyFor(cfg: { includeUsage?: boolean; promptCacheKey?: string }, stream: boolean) {
    let sent: Record<string, unknown> = {};
    const client = createChatClient({
      baseUrl: "https://example.invalid/v1",
      model: "gpt-5.6-terra",
      headers: {},
      ...cfg,
      fetchImpl: ((_u: string, init: { body: string }) => {
        sent = JSON.parse(init.body);
        return Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
        );
      }) as unknown as typeof fetch,
    });
    if (stream) await client.stream([{ role: "user", content: "hi" }], []);
    else await client.complete([{ role: "user", content: "hi" }], []);
    return sent;
  }

  it("asks a streamed round for its usage only when told to — the deployed chat is unchanged", async () => {
    expect((await bodyFor({ includeUsage: true }, true)).stream_options).toEqual({ include_usage: true });
    expect((await bodyFor({}, true)).stream_options).toBeUndefined();
    // stream_options is a streaming-only field.
    expect((await bodyFor({ includeUsage: true }, false)).stream_options).toBeUndefined();
  });

  it("sends prompt_cache_key only when one is set", async () => {
    expect((await bodyFor({ promptCacheKey: "nuvo-eval" }, false)).prompt_cache_key).toBe("nuvo-eval");
    expect("prompt_cache_key" in (await bodyFor({}, false))).toBe(false);
  });
});

describe("--changed scope", () => {
  const source = readFileSync(new URL("./agent/scenarios.ts", import.meta.url), "utf8");
  const tools = [...TOOL_DEFINITIONS.map((t) => t.function.name), "point_at"];

  it("finds every scenario's block, id and group in scenarios.ts", () => {
    const blocks = scenarioBlocks(source);
    expect(blocks.map((b) => b.id).sort()).toEqual(SCENARIOS.map((s) => s.id).sort());
    for (const b of blocks) expect(b.group).toBe(SCENARIOS.find((s) => s.id === b.id)!.group);
  });

  it("an edited scenario touches its group", () => {
    const b = scenarioBlocks(source).find((x) => x.group === "slots")!;
    const diff = [
      "diff --git a/tests/agent/scenarios.ts b/tests/agent/scenarios.ts",
      "--- a/tests/agent/scenarios.ts",
      "+++ b/tests/agent/scenarios.ts",
      `@@ -${b.start + 2} +${b.start + 2} @@`,
      "-    it: \"old\",",
      "+    it: \"new\",",
    ].join("\n");
    const t = touchedGroups(diff, source, tools);
    expect([...t.groups]).toEqual(["slots"]);
  });

  it("a prompt line naming a tool touches every group that asserts on it", () => {
    const diff = [
      "diff --git a/supabase/functions/agent/prompt.ts b/supabase/functions/agent/prompt.ts",
      "--- a/supabase/functions/agent/prompt.ts",
      "+++ b/supabase/functions/agent/prompt.ts",
      "@@ -100 +100 @@",
      "-Use create_slot when one window holds several things.",
      "+Use **create_slot** when one window holds several things — never three tasks.",
    ].join("\n");
    const t = touchedGroups(diff, source, tools);
    const expected = new Set(scenarioBlocks(source).filter((b) => b.text.includes(`"create_slot"`)).map((b) => b.group));
    expect(t.groups).toEqual(expected);
    expect(t.groups.has("slots")).toBe(true);
    expect(t.untargeted).toEqual([]);
  });

  it("a change naming no tool is reported as untargeted, not silently scoped to nothing", () => {
    const diff = [
      "diff --git a/supabase/functions/agent/loop.ts b/supabase/functions/agent/loop.ts",
      "--- a/supabase/functions/agent/loop.ts",
      "+++ b/supabase/functions/agent/loop.ts",
      "@@ -10,0 +11 @@",
      "+// a comment",
    ].join("\n");
    const t = touchedGroups(diff, source, tools);
    expect(t.groups.size).toBe(0);
    expect(t.untargeted).toEqual(["supabase/functions/agent/loop.ts"]);
  });

  it("parses -U0 hunks, pure deletions included", () => {
    const [f] = parseDiff(["--- a/x.ts", "+++ b/x.ts", "@@ -5,2 +4,0 @@", "-a", "-b", "@@ -9 +8,2 @@", "+c", "+d"].join("\n"));
    expect(f.newLines).toEqual([4, 8, 9]);
    expect(f.changed).toEqual(["a", "b", "c", "d"]);
  });
});
