// The battery's runner.
//
//   npm run eval                      every scenario, live model, 1 pass each
//   npm run eval -- --only slot-      just the slot group
//   npm run eval -- --repeat 5        five runs each, reported as a pass rate
//   npm run eval -- --group week
//   npm run eval:replay               recorded runs — deterministic, free
//
// Why pass RATE and not pass/fail: the thing under test is a sampled model, so
// a single green run proves less than it looks like it does and a single red
// run is not necessarily a regression. `must` scenarios are held to 100% and
// `should` to 80% — a should that slips is a place to go look, not a stop-ship.
// Anything below its bar exits non-zero.

import { runScenario } from "./harness.ts";
import { SCENARIOS, type Scenario } from "./scenarios.ts";

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
const BAR = { must: 1, should: 0.8 };

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
  results.push({ scenario: s, runs });

  const rate = runs.filter((r) => r.passed).length / runs.length;
  const bar = BAR[s.weight ?? "should"];
  const mark = rate >= bar ? "✓" : "✗";
  const pct = REPEAT > 1 ? ` ${Math.round(rate * 100)}%` : "";
  console.log(`${mark} ${s.id}${pct}  — ${s.it}`);
  if (rate < bar) {
    // Print each distinct failure once: the same wrong answer five times is one
    // problem, and five copies of it buries the other four scenarios.
    const seen = new Set<string>();
    for (const r of runs) {
      for (const f of r.failures) {
        if (seen.has(f)) continue;
        seen.add(f);
        console.log(`    → ${f}`);
      }
    }
    if (s.because) console.log(`    (this scenario exists because: ${s.because})`);
  }
}

const failed = results.filter(({ scenario, runs }) => {
  const rate = runs.filter((r) => r.passed).length / runs.length;
  return rate < BAR[scenario.weight ?? "should"];
});

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `\n${results.length - failed.length}/${results.length} scenarios at bar` +
    ` · ${REPEAT} run${REPEAT === 1 ? "" : "s"} each · ${MODE} · ${secs}s`,
);

if (failed.length) {
  const musts = failed.filter((f) => (f.scenario.weight ?? "should") === "must");
  if (musts.length) console.log(`\n${musts.length} MUST scenario(s) below bar — this is a broken chat, not a wobble.`);
  process.exit(1);
}
