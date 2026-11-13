// The routing eval — the live check on "which domain does this belong to".
//
//   node tests/agent/runModule.mjs tests/eval/routing.ts
//
// One pass of ~40 labelled items (captures AND calendar-event titles) from a
// STRANGER's account (routingFixtures.ts) through the REAL /v1/decisions
// endpoint, built and read by the kernel (`domainRequest` / `readDomainVerdict`
// / `eventText`) — the same code both runtimes ship, never a copy. Seconds, well
// under a cent.
//
// What it reports, per tier (domainRouting.ts):
//   auto    ≥ ROUTE_AUTO    — written for you. PRECISION is the product here;
//                              coverage is how much of the labelled work it took.
//   suggest ≥ ROUTE_SUGGEST — only proposed. Accuracy shown, never gated.
//   silent  below           — nothing said (a `refusal` answer is an abstention
//                              and lands here too; it is not a request error).
// and the expensive error: an item with NO clear home that auto-filed anyway.
//
// Exit 1 when auto precision < 0.9, any no-clear-home item auto-files, or any
// request failed. Each run appends one line to tests/eval/history.jsonl.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DECISIONS_MODEL,
  ROUTE_AUTO,
  ROUTE_SUGGEST,
  captureText,
  domainRequest,
  readDomainVerdict,
  type RouteTier,
} from "../../supabase/functions/_shared/domainRouting";
import { DECISIONS_ENDPOINT, eventText } from "../../supabase/functions/_shared/eventRouting";
import { ROUTING_CASES, STRANGER_DOMAINS, type RoutingCase } from "./routingFixtures";

const PRECISION_BAR = 0.9;
const CONCURRENCY = 8;
const TIMEOUT_MS = 20_000;
// gpt-6-luna, $ per 1M tokens.
const PRICE = { input: 0.1, cached: 0.01, output: 0.5 };

const key = process.env.OPENAI_API_KEY?.trim();
if (!key) {
  console.error("OPENAI_API_KEY is not set — the routing eval calls the live /v1/decisions endpoint.");
  process.exit(2);
}

interface Result {
  c: RoutingCase;
  got: string | null;
  probability: number;
  tier: RouteTier;
  error?: string;
  /** The classifier declined to choose (`type: "refusal"`) — an abstention,
   *  which the product treats exactly like a low score: nothing is said. */
  refused?: boolean;
  tokens: { input: number; cached: number; output: number; estimated: boolean };
  ms: number;
}

const name = (id: string | null) => (id ? STRANGER_DOMAINS.find((d) => d.id === id)?.name ?? id : "—");

function usageOf(body: unknown, reqChars: number, resChars: number): Result["tokens"] {
  const u = (body as { usage?: Record<string, unknown> } | null)?.usage;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  if (u && (u.input_tokens != null || u.prompt_tokens != null)) {
    const details = (u.input_tokens_details ?? u.prompt_tokens_details) as Record<string, unknown> | undefined;
    return {
      input: num(u.input_tokens ?? u.prompt_tokens),
      cached: num(details?.cached_tokens),
      output: num(u.output_tokens ?? u.completion_tokens),
      estimated: false,
    };
  }
  return { input: Math.ceil(reqChars / 4), cached: 0, output: Math.ceil(resChars / 4), estimated: true };
}

async function judge(c: RoutingCase): Promise<Result> {
  const text = c.kind === "event" ? eventText({ key: "eval", title: c.text, calendarName: c.calendar }) : captureText(c.text);
  const req = domainRequest(STRANGER_DOMAINS, text);
  const payload = JSON.stringify(req);
  const t0 = performance.now();
  try {
    const res = await fetch(DECISIONS_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: payload,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const raw = await res.text();
    const ms = performance.now() - t0;
    if (!res.ok) {
      return { c, got: null, probability: 0, tier: "none", error: `HTTP ${res.status}: ${raw.slice(0, 400)}`, tokens: usageOf(null, payload.length, 0), ms };
    }
    const body = JSON.parse(raw) as unknown;
    const v = readDomainVerdict(body, STRANGER_DOMAINS);
    const tokens = usageOf(body, payload.length, raw.length);
    if (!v) {
      const answers = (body as { answers?: Array<{ type?: string }> }).answers;
      if (Array.isArray(answers) && answers.some((a) => a?.type === "refusal")) {
        return { c, got: null, probability: 0, tier: "none", refused: true, tokens, ms };
      }
      return { c, got: null, probability: 0, tier: "none", error: `no readable verdict: ${raw.slice(0, 300)}`, tokens, ms };
    }
    return { c, got: v.id, probability: v.probability, tier: v.tier, tokens, ms };
  } catch (e) {
    return { c, got: null, probability: 0, tier: "none", error: e instanceof Error ? `${e.name}: ${e.message}` : "error", tokens: usageOf(null, payload.length, 0), ms: performance.now() - t0 };
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : "n/a");

const started = performance.now();
const results = await mapLimit(ROUTING_CASES, CONCURRENCY, judge);
const wallMs = performance.now() - started;

const errors = results.filter((r) => r.error);
const ok = results.filter((r) => !r.error);
const labelled = ok.filter((r) => r.c.expect);
const ambiguous = ok.filter((r) => !r.c.expect);

const auto = ok.filter((r) => r.tier === "auto");
const autoRight = auto.filter((r) => r.c.expect && r.got === r.c.expect);
const autoPrecision = auto.length ? autoRight.length / auto.length : 1;
const autoCoverage = labelled.length ? labelled.filter((r) => r.tier === "auto" && r.got === r.c.expect).length / labelled.length : 0;

const suggest = ok.filter((r) => r.tier === "suggest");
const suggestRight = suggest.filter((r) => r.c.expect && r.got === r.c.expect);
const silent = ok.filter((r) => r.tier === "none");
const silentLabelled = silent.filter((r) => r.c.expect);

const ambiguousAutoFiled = ambiguous.filter((r) => r.tier === "auto");
const misfiles = auto.filter((r) => r.got !== r.c.expect);

const tokens = results.reduce(
  (s, r) => ({ input: s.input + r.tokens.input, cached: s.cached + r.tokens.cached, output: s.output + r.tokens.output, estimated: s.estimated || r.tokens.estimated }),
  { input: 0, cached: 0, output: 0, estimated: false },
);
const cost = ((tokens.input - tokens.cached) * PRICE.input + tokens.cached * PRICE.cached + tokens.output * PRICE.output) / 1_000_000;

// ── report ────────────────────────────────────────────────────────────────────

const line = (r: Result) =>
  `    ${r.c.kind === "event" ? "event  " : "capture"} "${r.c.text}" → ${name(r.got)} @ ${r.probability.toFixed(2)} (expected ${r.c.expect ? name(r.c.expect) : "no clear home"})`;

console.log(`\nrouting eval · ${DECISIONS_MODEL} · ${ROUTING_CASES.length} items (${ROUTING_CASES.filter((c) => c.kind === "capture").length} captures, ${ROUTING_CASES.filter((c) => c.kind === "event").length} events, ${ROUTING_CASES.filter((c) => !c.expect).length} no-clear-home) · stranger account (${STRANGER_DOMAINS.length} domains)\n`);
console.log(`  auto    ≥${ROUTE_AUTO}  ${auto.length} filed · precision ${autoRight.length}/${auto.length} = ${pct(autoRight.length, auto.length)} · coverage ${pct(autoCoverage * labelled.length, labelled.length)} of labelled items`);
console.log(`  suggest ≥${ROUTE_SUGGEST}  ${suggest.length} proposed · top choice right ${suggestRight.length}/${suggest.length - suggest.filter((r) => !r.c.expect).length} labelled (${suggest.filter((r) => !r.c.expect).length} no-clear-home proposed)`);
console.log(`  silent  <${ROUTE_SUGGEST}  ${silent.length} (${silent.filter((r) => r.refused).length} refusals) · of which ${silentLabelled.length} had a clear home (missed)`);
console.log(`  no-clear-home items auto-filed: ${ambiguousAutoFiled.length}/${ambiguous.length}`);
for (const kind of ["capture", "event"] as const) {
  const k = ok.filter((r) => r.c.kind === kind);
  const ka = k.filter((r) => r.tier === "auto");
  const kr = ka.filter((r) => r.got === r.c.expect);
  console.log(`    ${kind}s: auto ${kr.length}/${ka.length} right, coverage ${pct(kr.length, k.filter((r) => r.c.expect).length)}`);
}

if (misfiles.length) {
  console.log(`\n  ✗ auto-tier misfiles (${misfiles.length}):`);
  misfiles.forEach((r) => console.log(line(r)));
}
if (suggest.length) {
  console.log(`\n  ~ suggest tier — proposed, never written (${suggest.length}):`);
  suggest.forEach((r) => console.log(`${line(r)}${r.got === r.c.expect ? "  ✓" : ""}`));
}
if (silentLabelled.length) {
  console.log(`\n  · silent on a clear item (${silentLabelled.length}):`);
  silentLabelled.forEach((r) => console.log(line(r)));
}
if (errors.length) {
  console.log(`\n  ! request errors (${errors.length}):`);
  errors.slice(0, 5).forEach((r) => console.log(`    "${r.c.text}": ${r.error}`));
}

const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
const p50 = latencies[Math.floor(latencies.length / 2)] ?? 0;
console.log(
  `\n  ${results.length} requests · ${(wallMs / 1000).toFixed(1)}s wall · p50 ${p50.toFixed(0)}ms · ` +
    `${tokens.input} in (${tokens.cached} cached) / ${tokens.output} out${tokens.estimated ? " (some estimated ~chars/4)" : ""} · ~$${cost.toFixed(5)}`,
);

const failures: string[] = [];
if (errors.length) failures.push(`${errors.length} request(s) failed`);
if (autoPrecision < PRECISION_BAR) failures.push(`auto precision ${autoPrecision.toFixed(2)} < ${PRECISION_BAR}`);
if (ambiguousAutoFiled.length) failures.push(`${ambiguousAutoFiled.length} no-clear-home item(s) auto-filed`);
const pass = failures.length === 0;
console.log(pass ? "\n✓ PASS\n" : `\n✗ FAIL — ${failures.join("; ")}\n`);

const history = resolve(process.cwd(), "tests/eval/history.jsonl");
mkdirSync(dirname(history), { recursive: true });
appendFileSync(
  history,
  JSON.stringify({
    at: new Date().toISOString(),
    eval: "routing",
    model: DECISIONS_MODEL,
    items: results.length,
    errors: errors.length,
    auto: { filed: auto.length, right: autoRight.length, precision: Number(autoPrecision.toFixed(3)), coverage: Number(autoCoverage.toFixed(3)) },
    suggest: { proposed: suggest.length, right: suggestRight.length },
    silent: { count: silent.length, refused: silent.filter((r) => r.refused).length, missedClear: silentLabelled.length },
    ambiguousAutoFiled: ambiguousAutoFiled.map((r) => r.c.text),
    misfiles: misfiles.map((r) => ({ text: r.c.text, got: r.got, expect: r.c.expect, p: Number(r.probability.toFixed(3)) })),
    wallMs: Math.round(wallMs),
    tokens,
    costUsd: Number(cost.toFixed(6)),
    pass,
  }) + "\n",
);

process.exitCode = pass ? 0 : 1;
