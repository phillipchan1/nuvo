// The battery's runner.
//
//   npm run eval                      every scenario, live model
//   npm run eval -- --only slot-      just the slot scenarios
//   npm run eval -- --repeat 5        five runs each — the real reliability read
//   npm run eval -- --group week
//   npm run eval:replay               recorded runs — deterministic, free
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
// Because a single green run is weak evidence at a 100% bar, `--repeat 3` or
// more is what should gate a prompt change. One run is a smoke test.

import { runScenario } from "./harness.ts";
import { SCENARIOS, type Scenario } from "./scenarios.ts";
import { blocking, exitCode, verdictFor, type Verdict } from "./verdict.ts";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);

const MODE: "live" | "replay" = has("replay") ? "replay" : "live";
const REPEAT = Number(flag("repeat") ?? 1);
const ONLY = flag("only");
const GROUP = flag("group");

const selected = SCENARIOS.filter(
  (s) => (!ONLY || s.id.includes(ONLY)) && (!GROUP || s.group === GROUP),
);

if (!selected.length) {
  console.error(`No scenarios match${ONLY ? ` --only ${ONLY}` : ""}${GROUP ? ` --group ${GROUP}` : ""}`);
  process.exit(2);
}

interface Result {
  scenario: Scenario;
  runs: { passed: boolean; failures: string[] }[];
  verdict: Verdict;
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
  for (let i = 0; i < REPEAT; i++) runs.push(await runOnce(s));

  const passes = runs.filter((r) => r.passed).length;
  const verdict: Verdict = verdictFor(passes, runs.length);
  results.push({ scenario: s, runs, verdict });

  const mark = verdict === "pass" ? "✓" : verdict === "flaky" ? "~" : "✗";
  const rate = REPEAT > 1 ? ` ${passes}/${REPEAT}` : "";
  const parked = s.quarantined ? " [quarantined]" : "";
  console.log(`${mark} ${s.id}${rate}${parked}  — ${s.it}`);

  if (verdict !== "pass") {
    if (verdict === "flaky") {
      console.log(`    ⚠ passed ${passes} of ${REPEAT} — the capability is there but not dependable.`);
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
console.log(
  `\n${results.length - red.length}/${results.length} at 100% · ${REPEAT} run${REPEAT === 1 ? "" : "s"} each · ${MODE} · ${secs}s`,
);

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
  if (REPEAT === 1) console.log("Re-run with --repeat 5 before concluding anything: one run can't tell fail from flaky.");
  process.exit(exitCode(judged));
}

if (REPEAT === 1 && MODE === "live") {
  console.log("Smoke pass. Gate a prompt or model change on --repeat 5, not on this.");
}
