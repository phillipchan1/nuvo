// What a battery run costs: measured afterwards, estimated beforehand.
//
// The battery ran for months without printing a token count, and its bill was a
// surprise: ~495 scenario-runs on 2026-10-22 came to about $5 for someone who
// expected pennies. Each round sends every tool definition and the whole static
// prompt (~20.6k tokens, measured), and most scenarios take two rounds, so a
// full `--repeat 5` is ~650 requests and ~13M input tokens — ~$4 even with the
// prefix cache hitting ~95%. Nobody chose that number; it just wasn't visible. So:
//
//   · every live request's `usage` is captured (harness.ts meters the fetch),
//     summed per run, and printed with the cache hit rate and a dollar figure;
//   · every live run appends that to history/usage.jsonl, filtered runs too —
//     a spend ledger, separate from the verdict history;
//   · before a live run, the runner estimates the bill from that ledger and
//     refuses above --max-cost unless told to go ahead.
//
// Pure: no fs, no clock, no network. The runner passes those in.

/** One chat-completions `usage` block, or a sum of them. */
export interface Usage {
  /** HTTP requests that returned usage. */
  requests: number;
  /** Input tokens, cached ones included. */
  prompt: number;
  /** The part of `prompt` served from the provider's prefix cache. */
  cached: number;
  completion: number;
}

export const emptyUsage = (): Usage => ({ requests: 0, prompt: 0, cached: 0, completion: 0 });

/** Read the provider's `usage` object (OpenAI and OpenRouter share the shape).
 *  Null when the response carried none — a provider that doesn't report is
 *  "unknown", never "zero". */
export function readUsage(raw: unknown): Usage | null {
  if (!raw || typeof raw !== "object") return null;
  // deno-lint-ignore no-explicit-any
  const u = raw as any;
  if (typeof u.prompt_tokens !== "number") return null;
  return {
    requests: 1,
    prompt: u.prompt_tokens,
    cached: Number(u.prompt_tokens_details?.cached_tokens ?? 0) || 0,
    completion: Number(u.completion_tokens ?? 0) || 0,
  };
}

export function addUsage(into: Usage, u: Usage): Usage {
  into.requests += u.requests;
  into.prompt += u.prompt;
  into.cached += u.cached;
  into.completion += u.completion;
  return into;
}

export function diffUsage(after: Usage, before: Usage): Usage {
  return {
    requests: after.requests - before.requests,
    prompt: after.prompt - before.prompt,
    cached: after.cached - before.cached,
    completion: after.completion - before.completion,
  };
}

export const cacheRate = (u: Usage) => (u.prompt ? u.cached / u.prompt : 0);

// ── prices ───────────────────────────────────────────────────────────────────

/** $ per 1M tokens. */
export interface Price {
  input: number;
  cached: number;
  output: number;
}

/** OpenAI's list prices, read from developers.openai.com/api/docs/models on
 *  2026-10-22 — the promotional rates, which OpenAI says run at least through
 *  2026-11-21. **Re-check after that date**; when they lapse the figures this
 *  prints will read low. A model not listed here gets tokens but no dollar
 *  figure, unless EVAL_PRICE ("input,cached,output" per 1M) says what it costs. */
export const PRICES: Record<string, Price> = {
  "gpt-5.6-sol": { input: 4, cached: 0.4, output: 20 },
  "gpt-5.6-terra": { input: 2, cached: 0.2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cached: 0.02, output: 1.2 },
};

/** EVAL_PRICE="2,0.2,12" overrides the table. Junk is ignored, not guessed at. */
export function priceFor(model: string, override?: string): Price | null {
  if (override) {
    const [input, cached, output] = override.split(",").map((s) => Number(s.trim()));
    if ([input, cached, output].every((n) => Number.isFinite(n) && n >= 0)) return { input, cached, output };
  }
  return PRICES[model] ?? null;
}

export function costOf(u: Usage, p: Price): number {
  return ((u.prompt - u.cached) * p.input + u.cached * p.cached + u.completion * p.output) / 1e6;
}

const usd = (n: number) => (n < 0.995 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

/** The line a run ends on. */
export function formatUsage(u: Usage, price: Price | null, scenarioRuns: number): string {
  if (!u.requests) return "usage: the provider reported none — cost unknown";
  const cost = price ? usd(costOf(u, price)) : "price unknown (set EVAL_PRICE)";
  const per = scenarioRuns ? ` · ${k(Math.round(u.prompt / scenarioRuns))} in/scenario-run` : "";
  return (
    `usage: ${u.requests} requests · ${k(u.prompt)} in (${(cacheRate(u) * 100).toFixed(0)}% cached) · ` +
    `${k(u.completion)} out${per} · ${cost}`
  );
}

// ── the ledger + the estimate ────────────────────────────────────────────────

/** One line of history/usage.jsonl — every live run, filtered or not. */
export interface SpendRecord {
  at: string;
  model: string;
  /** Scenario executions (a scenario at --repeat 5 is five). */
  scenarioRuns: number;
  usage: Usage;
  /** Dollars at the table price on the day, when the model was priced. */
  usd?: number;
  /** What was asked for, so a big line in the ledger explains itself. */
  args: string;
  git?: string;
}

export function parseSpend(text: string): SpendRecord[] {
  const out: SpendRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as SpendRecord;
      if (r && typeof r.model === "string" && r.usage && r.scenarioRuns > 0) out.push(r);
    } catch { /* one bad line loses one run, never the ledger */ }
  }
  return out;
}

/** Per scenario-run averages for a model, from its recent ledger lines. */
export interface Rates {
  prompt: number;
  completion: number;
  /** Share of input served from cache once the cache is WARM. */
  cacheRate: number;
  /** Tokens that miss once per run regardless: the first request of a run
   *  finds a cold cache and pays full price for the shared prefix. */
  coldMiss: number;
  /** Where the numbers came from — printed, so an estimate says how good it is. */
  basis: string;
}

/**
 * `prefixShare` is the part of a first-round request that is the same on every
 * request (the tools + the static prompt), measured from the request about to
 * be sent. It's what separates the two kinds of miss in a ledger line: a run's
 * first request misses its whole prefix once, every later one misses only what
 * changed. Without that, a one-scenario run (one cold request in two) would
 * read as "50% cached" and price a full run at double.
 *
 * Without any measurement: two rounds of the request we're about to send, no
 * cache at all. Deliberately the worst case — an estimate that guesses low is
 * how the last bill happened.
 */
export function ratesFor(model: string, ledger: SpendRecord[], firstRoundTokens: number, prefixShare = 0): Rates {
  const mine = ledger.filter((r) => r.model === model && r.usage.requests > 0).slice(-5);
  const runs = mine.reduce((n, r) => n + r.scenarioRuns, 0);
  if (runs > 0) {
    const sum = mine.reduce((acc, r) => addUsage(acc, r.usage), emptyUsage());
    const perRequest = sum.prompt / sum.requests;
    const coldMiss = perRequest * prefixShare;
    const warm = Math.min(sum.prompt, sum.cached + mine.length * coldMiss);
    return {
      prompt: sum.prompt / runs,
      completion: sum.completion / runs,
      cacheRate: sum.prompt ? warm / sum.prompt : 0,
      coldMiss,
      basis:
        `measured over the last ${mine.length} live run${mine.length === 1 ? "" : "s"} of ${model} ` +
        `(${runs} scenario-runs, ${(cacheRate(sum) * 100).toFixed(0)}% cached as billed)`,
    };
  }
  return {
    prompt: firstRoundTokens * 2,
    completion: 300,
    cacheRate: 0,
    coldMiss: 0,
    basis: `no ${model} runs in the ledger yet — worst case: 2 rounds of ~${k(firstRoundTokens)} tokens, nothing cached`,
  };
}

export interface Estimate {
  scenarioRuns: number;
  usage: Usage;
  usd: number | null;
}

export function estimate(scenarioRuns: number, rates: Rates, price: Price | null): Estimate {
  const prompt = Math.round(rates.prompt * scenarioRuns);
  const usage: Usage = {
    requests: 0,
    prompt,
    cached: Math.max(0, Math.round(prompt * rates.cacheRate - rates.coldMiss)),
    completion: Math.round(rates.completion * scenarioRuns),
  };
  return { scenarioRuns, usage, usd: price ? costOf(usage, price) : null };
}

export function formatEstimate(e: Estimate, rates: Rates): string {
  const cost = e.usd == null ? "price unknown" : `~${usd(e.usd)}`;
  return (
    `estimate: ${e.scenarioRuns} scenario-runs · ~${k(e.usage.prompt)} in ` +
    `(~${(cacheRate(e.usage) * 100).toFixed(0)}% cached) · ${cost}\n  basis: ${rates.basis}`
  );
}
