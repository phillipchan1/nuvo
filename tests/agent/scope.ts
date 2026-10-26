// Which scenarios a change actually touches — the scope of `npm run eval -- --changed`.
//
// The old gate was "every scenario ×5" for any prompt or tool change: ~65×5×2
// requests of ~26k tokens, a few dollars a go, for a change that usually moved
// one capability. The scoped gate repeats only what the diff reached and runs
// the rest once — still the whole suite, so a regression elsewhere is caught as
// a red, just not interrogated for flakiness until it shows up.
//
// What counts as "touched", from a unified diff against the base branch:
//
//   · a scenario whose own block in scenarios.ts changed (edited or new);
//   · a scenario that names a tool appearing on a changed line of the agent's
//     code (supabase/functions/agent/**) — the prompt, the tool definitions,
//     the tool notes — because a prompt edit about create_slot is an edit to
//     every scenario that asserts on create_slot.
//
// Then widened to whole GROUPS: a capability is judged as a group, and two
// scenarios in a group usually differ by one word of phrasing the model reads
// the same way. A changed line that names no tool touches nothing by this rule;
// the once-through of the rest is what covers it, and the runner says so.
//
// Pure: the runner hands in the diff text and the scenario source.

export interface ScenarioBlock {
  id: string;
  group: string;
  /** 1-based, inclusive, in the CURRENT scenarios.ts. */
  start: number;
  end: number;
  text: string;
}

/** Each `pin({ … })` in scenarios.ts with its id, group and line range. */
export function scenarioBlocks(source: string): ScenarioBlock[] {
  const lines = source.split("\n");
  const starts: number[] = [];
  lines.forEach((l, i) => {
    if (/^\s*pin\(\{/.test(l)) starts.push(i);
  });
  return starts.flatMap((s, n) => {
    const e = n + 1 < starts.length ? starts[n + 1] - 1 : lines.length - 1;
    const text = lines.slice(s, e + 1).join("\n");
    const id = /\bid:\s*"([^"]+)"/.exec(text)?.[1];
    const group = /\bgroup:\s*"([^"]+)"/.exec(text)?.[1];
    return id && group ? [{ id, group, start: s + 1, end: e + 1, text }] : [];
  });
}

export interface FileDiff {
  path: string;
  /** Line numbers in the new file that were added or sit where lines were removed. */
  newLines: number[];
  /** Text of every added or removed line. */
  changed: string[];
}

/** Parse `git diff -U0` output. */
export function parseDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: FileDiff | null = null;
  let line = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      cur = null;
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const p = raw.slice(4).replace(/^b\//, "");
      cur = { path: p === "/dev/null" ? "" : p, newLines: [], changed: [] };
      files.push(cur);
      continue;
    }
    if (raw.startsWith("--- ")) continue;
    if (!cur) continue;
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (h) {
      line = Number(h[1]);
      // A pure deletion (+N,0) points at the line after which it happened.
      if (h[2] === "0") cur.newLines.push(Math.max(1, line));
      continue;
    }
    if (raw.startsWith("+")) {
      cur.newLines.push(line++);
      cur.changed.push(raw.slice(1));
    } else if (raw.startsWith("-")) {
      cur.changed.push(raw.slice(1));
    }
  }
  return files.filter((f) => f.path);
}

export const SCENARIOS_FILE = "tests/agent/scenarios.ts";
export const AGENT_DIR = "supabase/functions/agent/";

export interface Touched {
  groups: Set<string>;
  /** One line per reason, for the run header — a scope has to explain itself. */
  why: string[];
  /** Agent files that changed but named no tool: covered only by the once-through. */
  untargeted: string[];
}

export function touchedGroups(diff: string, scenarioSource: string, toolNames: string[]): Touched {
  const blocks = scenarioBlocks(scenarioSource);
  const groups = new Set<string>();
  const why: string[] = [];
  const untargeted: string[] = [];
  const add = (b: ScenarioBlock, reason: string) => {
    if (!groups.has(b.group)) why.push(`${b.group} — ${reason}`);
    groups.add(b.group);
  };

  for (const f of parseDiff(diff)) {
    if (f.path === SCENARIOS_FILE) {
      for (const n of f.newLines) {
        const b = blocks.find((x) => n >= x.start && n <= x.end);
        if (b) add(b, `scenario ${b.id} changed`);
      }
      continue;
    }
    if (!f.path.startsWith(AGENT_DIR)) continue;
    const text = f.changed.join("\n");
    const tools = toolNames.filter((t) => new RegExp(`\\b${t}\\b`).test(text));
    if (!tools.length) {
      untargeted.push(f.path);
      continue;
    }
    for (const t of tools) {
      for (const b of blocks) {
        if (b.text.includes(`"${t}"`)) add(b, `${f.path.slice(AGENT_DIR.length)} changed lines naming ${t}`);
      }
    }
  }
  return { groups, why, untargeted };
}
