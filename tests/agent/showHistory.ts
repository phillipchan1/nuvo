// `npm run eval:history` — what the battery has said over time.
//
// Every recorded run, newest last, plus the latest result for each cell of the
// model x prompt matrix. Reads the file the runner appends to; runs nothing and
// costs nothing.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cellKey, diffRuns, formatMatrix, lastRunForCell, parseHistory } from "./history.ts";

const HISTORY = join(dirname(fileURLToPath(import.meta.url)), "history", "runs.jsonl");

if (!existsSync(HISTORY)) {
  console.log("No battery runs recorded yet. Run: npm run eval -- --repeat 5");
  process.exit(0);
}

const history = parseHistory(readFileSync(HISTORY, "utf8"));
if (!history.length) {
  console.log("The history file is empty.");
  process.exit(0);
}

console.log(`${history.length} recorded run${history.length === 1 ? "" : "s"}:\n`);
for (const r of history) {
  const red = r.total - r.passed;
  console.log(
    `${r.at.slice(0, 16).replace("T", " ")}  ${String(r.passed).padStart(3)}/${r.total}` +
      `  ×${r.repeat}  ${cellKey(r)}${r.git ? `  @${r.git}` : ""}${red ? `  (${red} red)` : ""}`,
  );
}

console.log(formatMatrix(history));

// The last run's movement, so the most recent question is answered up front.
const latest = history[history.length - 1];
const previous = lastRunForCell(history.slice(0, -1), cellKey(latest));
if (previous) {
  const d = diffRuns(previous, latest);
  if (d.regressed.length) {
    console.log(`\nMost recent run REGRESSED ${d.regressed.length}: ${d.regressed.join(", ")}`);
  } else if (d.fixed.length) {
    console.log(`\nMost recent run fixed ${d.fixed.length}: ${d.fixed.join(", ")}`);
  } else {
    console.log(`\nMost recent run matched the previous run of the same cell, scenario for scenario.`);
  }
}
