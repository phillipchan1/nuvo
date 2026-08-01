// What the battery said last time, and the time before that.
//
// The runner printed a score and exited, so every number the battery ever
// produced was gone the moment the terminal scrolled. That makes the two
// questions you actually ask unanswerable:
//
//   · "Is this better than before?" — better than WHAT? Nobody wrote it down.
//   · "Which cell of the matrix won?" — four console outputs, compared by eye,
//     on a suite where the interesting result is one scenario moving.
//
// A score is the least useful part of a run. `35/36` twice in a row can hide a
// scenario that broke and another that got fixed, which is exactly the movement
// worth seeing. So a record keeps the PER-SCENARIO verdicts, and the diff is
// computed from those.
//
// Runs are grouped by **cell** — model + prompt variant + reasoning effort.
// Comparing a run to the last run of the same cell answers "did my change
// help?"; comparing cells to each other answers "which should I ship?". They
// are different questions and conflating them is how a model change gets
// credited to a prompt edit.
//
// Pure: no fs, no clock, no network. The runner passes those in.

import type { Verdict } from "./verdict.ts";

export interface ScenarioVerdict {
  id: string;
  verdict: Verdict;
  passes: number;
  runs: number;
  quarantined?: string;
}

export interface RunRecord {
  /** ISO timestamp, supplied by the caller. */
  at: string;
  model: string;
  prompt: string;
  reasoning: string;
  mode: "live" | "replay";
  repeat: number;
  /** Commit the run was made at, when it could be read. */
  git?: string;
  scenarios: ScenarioVerdict[];
  /** Scenarios at 100%. */
  passed: number;
  total: number;
  /** Red and not parked — what would fail CI. */
  blocked: number;
  seconds: number;
}

/** Model + prompt + reasoning. Two runs are only comparable within one cell. */
export function cellKey(r: Pick<RunRecord, "model" | "prompt" | "reasoning">): string {
  return `${r.model} · ${r.prompt} · ${r.reasoning}`;
}

export function serializeRecord(r: RunRecord): string {
  return JSON.stringify(r);
}

/** Tolerant by design: a corrupt line loses one run, never the whole history. */
export function parseHistory(text: string): RunRecord[] {
  const out: RunRecord[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t) as RunRecord;
      if (r && typeof r.at === "string" && Array.isArray(r.scenarios)) out.push(r);
    } catch { /* skip the bad line, keep the history */ }
  }
  return out;
}

/** The most recent earlier run of the same cell, if there is one. */
export function lastRunForCell(history: RunRecord[], cell: string): RunRecord | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (cellKey(history[i]) === cell) return history[i];
  }
  return null;
}

export interface RunDiff {
  /** Red before, green now. */
  fixed: string[];
  /** Green before, red now — the line that matters. */
  regressed: string[];
  /** Red both times but the verdict moved (fail↔flaky). */
  shifted: { id: string; from: Verdict; to: Verdict }[];
  /** In this run and not the last — a scenario was added. */
  added: string[];
  /** In the last run and not this one. */
  removed: string[];
}

export function diffRuns(prev: RunRecord, next: RunRecord): RunDiff {
  const before = new Map(prev.scenarios.map((s) => [s.id, s.verdict]));
  const after = new Map(next.scenarios.map((s) => [s.id, s.verdict]));

  const fixed: string[] = [];
  const regressed: string[] = [];
  const shifted: RunDiff["shifted"] = [];
  const added: string[] = [];

  for (const [id, to] of after) {
    const from = before.get(id);
    if (from === undefined) { added.push(id); continue; }
    if (from === to) continue;
    if (to === "pass") fixed.push(id);
    else if (from === "pass") regressed.push(id);
    else shifted.push({ id, from, to });
  }
  const removed = [...before.keys()].filter((id) => !after.has(id));

  return { fixed, regressed, shifted, added, removed };
}

export function isImprovement(d: RunDiff): boolean {
  return d.fixed.length > 0 && d.regressed.length === 0;
}

const mark = (v: Verdict) => (v === "pass" ? "✓" : v === "flaky" ? "~" : "✗");

/** What changed since the last run of this same cell. */
export function formatDiff(prev: RunRecord, next: RunRecord, d: RunDiff): string {
  const lines: string[] = [];
  const delta = next.passed - prev.passed;
  const sign = delta > 0 ? `+${delta}` : `${delta}`;
  lines.push(
    `\nvs. this cell's last run (${prev.at.slice(0, 16).replace("T", " ")}): ` +
      `${prev.passed}/${prev.total} → ${next.passed}/${next.total} (${delta === 0 ? "no change" : sign})`,
  );

  if (d.regressed.length) {
    lines.push(`  REGRESSED — green before, red now:`);
    for (const id of d.regressed) lines.push(`    ✗ ${id}`);
  }
  if (d.fixed.length) {
    lines.push(`  fixed:`);
    for (const id of d.fixed) lines.push(`    ✓ ${id}`);
  }
  for (const s of d.shifted) lines.push(`    ${mark(s.to)} ${s.id} (${s.from} → ${s.to})`);
  if (d.added.length) lines.push(`  new scenarios: ${d.added.join(", ")}`);
  if (d.removed.length) lines.push(`  no longer in the suite: ${d.removed.join(", ")}`);

  if (!d.regressed.length && !d.fixed.length && !d.shifted.length && !d.added.length && !d.removed.length) {
    lines.push(`  every scenario landed exactly where it did last time.`);
  }
  return lines.join("\n");
}

/** The latest run of each cell, best first — the matrix, once it has been run. */
export function formatMatrix(history: RunRecord[]): string {
  const latest = new Map<string, RunRecord>();
  for (const r of history) latest.set(cellKey(r), r);
  if (!latest.size) return "No runs recorded yet.";

  const rows = [...latest.values()].sort(
    (a, b) => b.passed / b.total - a.passed / a.total || a.seconds - b.seconds,
  );
  const width = Math.max(...rows.map((r) => cellKey(r).length));
  const lines = [`\nlatest run per cell (${rows.length}):`];
  for (const r of rows) {
    const blocked = r.blocked ? `  ${r.blocked} blocking` : "";
    lines.push(
      `  ${cellKey(r).padEnd(width)}  ${String(r.passed).padStart(3)}/${r.total}` +
        `  ×${r.repeat}  ${r.mode}  ${r.at.slice(0, 10)}${blocked}`,
    );
  }
  return lines.join("\n");
}
