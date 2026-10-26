// The battery's runner.
//
//   npm run eval:gate                 THE gate: groups touched since master ×5, the rest ×1
//   npm run eval:gate -- --no-rest    only the touched groups — cents, but blind elsewhere
//   npm run eval                      every scenario once, live model (a smoke test)
//   npm run eval -- --only slot-      just the slot scenarios
//   npm run eval -- --repeat 5        five runs each — the full reliability read (~$4)
//   npm run eval -- --group week
//   npm run eval:replay               recorded runs — deterministic, free
//
// A live run costs money, so it says how much — before (an estimate from the
// spend ledger, refused above --max-cost unless --yes) and after (the provider's
// own token counts, the cache hit rate, dollars). See cost.ts and scope.ts.
//
// **The bar is 100%.** Every scenario, every run. The chat is a first-class
// surface, and a planner you have to double-check is not doing its job — so
// there is no tier of behaviors it's allowed to get wrong sometimes.
//
// That makes FLAKY the failure mode worth naming separately, and this runner
// does. A scenario that fails every time is a chat that can't do the thing. A
// scenario that fails one run in five is worse in a way that's easy to miss:
// the capability is there but it isn't dependable, which is exactly what the
// user experiences as "I can't trust it". Both are red. They're just fixed
// differently — one by teaching the chat, one by removing the ambiguity that
// lets it drift.
//
// Because a single green run is weak evidence at a 100% bar, a prompt change is
// gated on repeats — but only of what it touched (`--changed`). One run of
// everything else is enough to catch a red; it's the touched groups whose
// flakiness is the open question.

import { execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createInterface } from "node:readline/promises";

import { firstRequest, runScenario, settleSpend, spend } from "./harness.ts";
import {
  diffUsage,
  estimate,
  formatEstimate,
  formatUsage,
  parseSpend,
  priceFor,
  ratesFor,
  costOf,
  type SpendRecord,
  type Usage,
} from "./cost.ts";
import { AGENT_DIR, SCENARIOS_FILE, touchedGroups, type Touched } from "./scope.ts";
import { TOOL_DEFINITIONS } from "../../supabase/functions/agent/toolDefs.ts";
import {
  cellKey,
  diffRuns,
  formatDiff,
  formatMatrix,
  lastRunForCell,
  parseHistory,
  serializeRecord,
  type RunRecord,
} from "./history.ts";
import { resolveAgentModel } from "../../supabase/functions/agent/modelChoice.ts";
import { readPromptVariant } from "../../supabase/functions/agent/prompt.ts";
import { SCENARIOS, type Scenario } from "./scenarios.ts";
import { blocking, exitCode, verdictFor, type Verdict } from "./verdict.ts";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);

const MODE: "live" | "replay" = has("replay") ? "replay" : "live";
const CHANGED = has("changed");
// With --changed: skip the once-through of untouched groups. The cheapest honest
// read of a change (~$0.40 for a six-scenario group ×5, against ~$1 with the
// rest) — but blind to a regression elsewhere.
const NO_REST = has("no-rest");
// The scoped gate repeats what the diff touched; a bare run is a smoke test.
const REPEAT = Number(flag("repeat") ?? (CHANGED ? 5 : 1));
const ONLY = flag("only");
const GROUP = flag("group");
const BASE = flag("base") ?? "master";
// Dollars. Above this, a live run asks (or, with no terminal, refuses).
// The default sits above the scoped gate and a once-through (~$1 each) and
// below a full --repeat 5 (~$4), which is the run that should be a decision.
const MAX_COST = Number(flag("max-cost") ?? process.env.EVAL_MAX_COST ?? 2);
const FORCE = has("yes");
// A filtered run is not comparable to a full one, so it isn't recorded unless
// asked for — otherwise `--only slot-` would look like the suite collapsing.
// (Its SPEND is always recorded — see usage.jsonl below.)
const RECORD = !has("no-record") && !ONLY && !GROUP && !NO_REST;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const HISTORY = join(HERE, "history", "runs.jsonl");
const LEDGER = join(HERE, "history", "usage.jsonl");

const choice = resolveAgentModel({
  AGENT_MODEL: process.env.AGENT_MODEL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  AGENT_REASONING: process.env.AGENT_REASONING,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
});
const PRICE = priceFor(choice.model, process.env.EVAL_PRICE);

let git: string | undefined;
try { git = execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf8" }).trim(); } catch { /* not a repo */ }

const selected = SCENARIOS.filter(
  (s) => (!ONLY || s.id.includes(ONLY)) && (!GROUP || s.group === GROUP),
);

if (!selected.length) {
  console.error(`No scenarios match${ONLY ? ` --only ${ONLY}` : ""}${GROUP ? ` --group ${GROUP}` : ""}`);
  process.exit(2);
}

// ── scope: what the change touched ───────────────────────────────────────────

let touched: Touched | null = null;
if (CHANGED) {
  try {
    const base = execSync(`git merge-base ${BASE} HEAD`, { cwd: ROOT, encoding: "utf8" }).trim();
    // Against the working tree, so uncommitted edits count too.
    const diff = execSync(`git diff -U0 ${base} -- ${AGENT_DIR} ${SCENARIOS_FILE}`, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const toolNames = [...TOOL_DEFINITIONS.map((t) => t.function.name), "point_at"];
    touched = touchedGroups(diff, readFileSync(join(ROOT, SCENARIOS_FILE), "utf8"), toolNames);
  } catch (e) {
    console.error(`--changed needs a diff against ${BASE}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  console.log(`scope: changes since ${BASE}`);
  if (touched.why.length) for (const w of touched.why) console.log(`  ×${REPEAT}  ${w}`);
  else console.log(`  nothing the diff names reaches a scenario — every group runs once`);
  if (touched.untargeted.length) {
    console.log(`  (changed, but naming no tool — covered only by the once-through: ${touched.untargeted.join(", ")})`);
    console.log(`  If that edit is aimed at a capability, add --group <name> --repeat 5 for it.`);
  }
  console.log("");
}

/** How many times a scenario runs: the touched groups at REPEAT, the rest once. */
const runsFor = (s: Scenario) => (!touched || touched.groups.has(s.group) ? REPEAT : 1);
if (touched && NO_REST) {
  const keep = selected.filter((s) => touched!.groups.has(s.group));
  if (!keep.length) {
    console.log("--no-rest, and the change touches no group — nothing to run.");
    process.exit(0);
  }
  selected.splice(0, selected.length, ...keep);
}
const scenarioRuns = selected.reduce((n, s) => n + runsFor(s), 0);

// ── what it will cost, before spending it ────────────────────────────────────

const ledger: SpendRecord[] = existsSync(LEDGER) ? parseSpend(readFileSync(LEDGER, "utf8")) : [];

if (MODE === "live") {
  // The request each scenario opens with, and how much of it is the prefix every
  // request shares (tools + static prompt) — what the cache can serve.
  const firsts = selected.map((s) => firstRequest({ worldName: s.world, turns: s.turns, navFocus: s.navFocus }));
  const avgChars = firsts.reduce((n, r) => n + JSON.stringify(r).length, 0) / firsts.length;
  const prefixChars = JSON.stringify(firsts[0].tools).length + String(firsts[0].messages[0].content).length;
  // ~4 characters a token for this English + JSON mix; only used until the
  // ledger has a measured run of this model to go on.
  const rates = ratesFor(choice.model, ledger, Math.round(avgChars / 4), Math.min(1, prefixChars / avgChars));
  const est = estimate(scenarioRuns, rates, PRICE);
  console.log(formatEstimate(est, rates));

  const over = est.usd == null ? true : est.usd > MAX_COST;
  if (over && !FORCE) {
    const why =
      est.usd == null
        ? `${choice.model} has no price in cost.ts — set EVAL_PRICE="input,cached,output" ($/1M) to estimate it`
        : `that's over --max-cost $${MAX_COST.toFixed(2)}`;
    if (process.stdin.isTTY && process.stdout.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(`  ${why}. Spend it? [y/N] `);
      rl.close();
      if (!/^y(es)?$/i.test(answer.trim())) {
        console.log("Not run. Narrow it (--changed, --group, --only) or raise --max-cost.");
        process.exit(3);
      }
    } else {
      console.error(`  ${why}. Refusing without a terminal to ask — pass --yes to spend it anyway.`);
      process.exit(3);
    }
  }
  console.log("");
}

interface Result {
  scenario: Scenario;
  runs: { passed: boolean; failures: string[] }[];
  verdict: Verdict;
  usage: Usage;
}

async function runOnce(s: Scenario): Promise<{ passed: boolean; failures: string[] }> {
  try {
    const outcome = await runScenario({
      id: s.id,
      worldName: s.world,
      turns: s.turns,
      respond: s.respond,
      navFocus: s.navFocus,
      mode: MODE,
    });
    const failures = s.expect.map((c) => c.run(outcome)).filter((f): f is string => f != null);
    return { passed: failures.length === 0, failures };
  } catch (e) {
    return { passed: false, failures: [`threw: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

const results: Result[] = [];
const started = Date.now();

for (const s of selected) {
  const runs: Result["runs"] = [];
  const n = runsFor(s);
  const before = { ...(await settleSpend()) };
  for (let i = 0; i < n; i++) runs.push(await runOnce(s));
  const usage = diffUsage(await settleSpend(), before);

  const passes = runs.filter((r) => r.passed).length;
  const verdict: Verdict = verdictFor(passes, runs.length);
  results.push({ scenario: s, runs, verdict, usage });

  const mark = verdict === "pass" ? "✓" : verdict === "flaky" ? "~" : "✗";
  const rate = n > 1 ? ` ${passes}/${n}` : "";
  const parked = s.quarantined ? " [quarantined]" : "";
  console.log(`${mark} ${s.id}${rate}${parked}  — ${s.it}`);

  if (verdict !== "pass") {
    if (verdict === "flaky") {
      console.log(`    ⚠ passed ${passes} of ${n} — the capability is there but not dependable.`);
      console.log("      Either the chat drifts here, or the expectation is loose enough to fail a right answer.");
    }
    // Each distinct failure once: the same wrong answer five times is one
    // problem, and five copies of it buries the other scenarios.
    const seen = new Set<string>();
    for (const r of runs) {
      for (const f of r.failures) {
        if (seen.has(f)) continue;
        seen.add(f);
        console.log(`    → ${f}`);
      }
    }
    if (s.because) console.log(`    (this scenario exists because: ${s.because})`);
    if (s.quarantined) console.log(`    (parked: ${s.quarantined})`);
  }
}

const judged = results.map((r) => ({ id: r.scenario.id, verdict: r.verdict, quarantined: r.scenario.quarantined }));
const red = results.filter((r) => r.verdict !== "pass");
const parked = red.filter((r) => r.scenario.quarantined);
const blocked = blocking(judged);
const flaky = blocked.filter((b) => b.verdict === "flaky");

const secs = ((Date.now() - started) / 1000).toFixed(1);
const depth = touched
  ? `${REPEAT}× ${touched.groups.size} touched group${touched.groups.size === 1 ? "" : "s"}, 1× the rest`
  : `${REPEAT} run${REPEAT === 1 ? "" : "s"} each`;
console.log(`\n${results.length - red.length}/${results.length} at 100% · ${depth} · ${MODE} · ${secs}s`);

// ── what it cost ─────────────────────────────────────────────────────────────

const total = await settleSpend();
const usd = PRICE && total.requests ? costOf(total, PRICE) : undefined;
if (MODE === "live") {
  console.log(formatUsage(total, PRICE, scenarioRuns));
  // Where the money went, so a costly scenario is a fact rather than a hunch.
  const dear = [...results].sort((a, b) => b.usage.prompt - a.usage.prompt).slice(0, 3);
  if (results.length > 3 && dear[0]?.usage.prompt) {
    console.log(`  heaviest: ${dear.map((r) => `${r.scenario.id} ${(r.usage.prompt / 1000).toFixed(0)}k`).join(" · ")}`);
  }
  if (total.requests) {
    // Every live run, filtered or not: the bill is the sum of all of them.
    try {
      const line: SpendRecord = {
        at: new Date().toISOString(),
        model: choice.model,
        scenarioRuns,
        usage: { ...total },
        usd,
        args: argv.join(" "),
        git,
      };
      mkdirSync(dirname(LEDGER), { recursive: true });
      appendFileSync(LEDGER, JSON.stringify(line) + "\n");
    } catch (e) {
      console.warn(`(could not write the spend ledger: ${e instanceof Error ? e.message : String(e)})`);
    }
  }
}

// ── write it down ────────────────────────────────────────────────────────────
//
// The score is the least useful part of a run: two runs at 35/36 can hide one
// scenario breaking and another getting fixed. The record keeps every
// scenario's verdict so that movement is visible, and the diff below is the
// answer to "is this actually better?".

// A live run where no request came back (no key, a bad key, the provider down)
// judged nothing about the chat — recording it would put a 0/N in the history
// that reads as the suite collapsing.
const reachedModel = MODE === "replay" || total.requests > 0;
if (RECORD && !reachedModel) {
  console.log("\nNot recorded: no request reached the model, so this run says nothing about the chat.");
}

if (RECORD && reachedModel) {
  try {
    const record: RunRecord = {
      at: new Date().toISOString(),
      model: MODE === "replay" ? "replay" : choice.model,
      prompt: readPromptVariant(process.env.AGENT_PROMPT),
      reasoning: choice.reasoningEffort ?? "default",
      mode: MODE,
      repeat: REPEAT,
      git,
      scenarios: results.map((r) => ({
        id: r.scenario.id,
        verdict: r.verdict,
        passes: r.runs.filter((x) => x.passed).length,
        runs: r.runs.length,
        quarantined: r.scenario.quarantined,
      })),
      passed: results.length - red.length,
      total: results.length,
      blocked: blocked.length,
      seconds: Number(secs),
      ...(MODE === "live" && total.requests ? { usage: { ...total }, usd } : {}),
      ...(touched ? { changed: [...touched.groups].sort() } : {}),
    };

    const history = existsSync(HISTORY) ? parseHistory(readFileSync(HISTORY, "utf8")) : [];
    const previous = lastRunForCell(history, cellKey(record));

    mkdirSync(dirname(HISTORY), { recursive: true });
    appendFileSync(HISTORY, serializeRecord(record) + "\n");

    if (previous) {
      console.log(formatDiff(previous, record, diffRuns(previous, record)));
    } else {
      console.log(`\nFirst recorded run for ${cellKey(record)} — this is the baseline to compare against.`);
    }
    console.log(formatMatrix([...history, record]));
    console.log(`\nrecorded → ${HISTORY.replace(process.cwd() + "/", "")}`);
  } catch (e) {
    // Never let bookkeeping change the verdict of a run.
    console.warn(`(could not record this run: ${e instanceof Error ? e.message : String(e)})`);
  }
}

if (parked.length) {
  console.log(`\n${parked.length} quarantined (not blocking, still red):`);
  for (const p of parked) console.log(`  · ${p.scenario.id} — ${p.scenario.quarantined}`);
}

if (blocked.length) {
  console.log(`\n${blocked.length} scenario(s) below the bar.`);
  if (flaky.length) {
    console.log(
      `${flaky.length} of them are FLAKY — they pass sometimes. At a 100% bar that's the` +
        ` signal to tighten the rule in the prompt or the assertion, not to re-run until it's green.`,
    );
  }
  if (REPEAT === 1) {
    console.log(
      "One run can't tell fail from flaky — re-run just the red: npm run eval -- --only <id> --repeat 5",
    );
  }
  process.exit(exitCode(judged));
}

if (REPEAT === 1 && MODE === "live" && !touched) {
  console.log("Smoke pass. Gate a prompt or tool change on `npm run eval:gate`, not on this.");
}
