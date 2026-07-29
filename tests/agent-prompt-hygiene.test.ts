// The prompt is an artifact, so check it like one.
//
// None of this needs a model. It catches the *class* of failure that has cost
// the most: not a rule being wrong, but the same rule being stated in several
// places and then edited in one of them. `start_time` was simultaneously
// documented as UTC, as the user's local wall clock, and as America/Los_Angeles
// — three homes, one of them matching the code — and the model picked a
// different one per turn.
//
// The eval (`npm run eval`) answers "is this rule earning its place". These
// tests answer the cheaper question: "does this rule have exactly one home, and
// is the prompt still a size a person can hold in their head".
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { STATIC_SYSTEM_PROMPT } from "../supabase/functions/agent/systemPrompt.ts";
import { TOOL_DEFINITIONS, buildPointAtTool } from "../supabase/functions/agent/tools.ts";

const words = (s: string) => s.trim().split(/\s+/).length;

/** Every behavioural sentence the model reads: the prompt, plus the second
 *  prompt hiding in the tool schemas' `description` fields. */
const schemaText = JSON.stringify([...TOOL_DEFINITIONS, buildPointAtTool([])]);

const toolNames = new Set(
  [...TOOL_DEFINITIONS, buildPointAtTool([])].map(
    (t) => (t as { function: { name: string } }).function.name,
  ),
);

describe("the prompt stays a size a person can hold", () => {
  // A ratchet, not a target. Today the prompt is ~4,120 words and 83% of that
  // is mechanics — the shape that let `start_time` mean three things at once.
  // Where it should end up is nearer 1,500, mostly judgment, but getting there
  // means deleting rules, and deleting a rule safely needs the eval and a live
  // model. So this number stops silent GROWTH now, and comes down as step 3
  // measures what each rule is actually worth. Raising it is allowed; raising
  // it without noticing is not.
  const BUDGET = 4_150;

  it(`the standing instructions stay under ${BUDGET} words`, () => {
    const n = words(STATIC_SYSTEM_PROMPT);
    expect(
      n,
      `the prompt is ${n} words. Before raising the budget, run \`EVAL_RUNS=5 npm run eval\` ` +
        `and delete a rule whose removal doesn't move the numbers — see docs/agent-harness.md.`,
    ).toBeLessThanOrEqual(BUDGET);
  });

  it("judgment is not crowded out entirely by mechanics", () => {
    // The sections that carry taste rather than facts. If this ratio collapses,
    // the prompt has become a rulebook and the model has stopped being asked to
    // think. Deliberately a floor, not a target.
    const judgment = ["## Scope", "## Productivity philosophy", "## When to apply judgment", "## Communication"];
    const sections = STATIC_SYSTEM_PROMPT.split(/^## /m);
    const judgmentWords = sections
      .filter((s) => judgment.some((h) => `## ${s}`.startsWith(h)))
      .reduce((n, s) => n + words(s), 0);
    expect(judgmentWords / words(STATIC_SYSTEM_PROMPT)).toBeGreaterThan(0.1);
  });
});

describe("a rule has exactly one home", () => {
  // Each entry is a rule that HAS been duplicated, or is the shape of one that
  // would be. `where` is the file allowed to state it; every other surface must
  // point at that one rather than restating it.
  const RULES: { rule: string; pattern: RegExp; home: "prompt" | "schema" }[] = [
    { rule: "a correction never answers with a fresh create", pattern: /never answer a correction with create_calendar_event/i, home: "prompt" },
    { rule: "topic never selects a calendar", pattern: /never infer a calendar/i, home: "prompt" },
    { rule: "quote the result's formatted time", pattern: /never format a time from start_at/i, home: "prompt" },
  ];

  for (const { rule, pattern, home } of RULES) {
    it(`"${rule}" is stated once, in the ${home}`, () => {
      const inPrompt = pattern.test(STATIC_SYSTEM_PROMPT);
      const inSchema = pattern.test(schemaText);
      expect(home === "prompt" ? inPrompt : inSchema, `${rule} is missing from the ${home}`).toBe(true);
      expect(
        home === "prompt" ? inSchema : inPrompt,
        `"${rule}" is stated in both the prompt and the tool schemas. Two homes drift: ` +
          `keep it in the ${home} and have the other point at it.`,
      ).toBe(false);
    });
  }
});

describe("times are described one way", () => {
  it("no surface hardcodes a timezone the user may not be in", () => {
    // The traveling-user bug: schemas said America/Los_Angeles while the prompt
    // said "the user's zone". Only the fallback constant in code may name it.
    expect(STATIC_SYSTEM_PROMPT).not.toMatch(/America\/Los_Angeles/);
    expect(schemaText).not.toMatch(/America\/Los_Angeles/);
    expect(STATIC_SYSTEM_PROMPT, "'LA time' is the same bug wearing a nickname").not.toMatch(/\b\d(:\d\d)?\s?(AM|PM)\s+LA\b/);
  });

  it("no surface tells the model to send a time as UTC", () => {
    for (const [name, text] of [["prompt", STATIC_SYSTEM_PROMPT], ["tool schemas", schemaText]] as const) {
      const claim = new RegExp("start_(time|local|at)[^.\\n]{0,40}\\bin UTC\\b", "i");
      expect(claim.test(text), `${name} tells the model to build a time in UTC; the server converts`).toBe(false);
    }
  });

  it("the context payload no longer ships a UTC offset for the model to apply", () => {
    // Deleted rather than corrected: the field existed only so the model could
    // do the conversion the server already does, and its docstring contradicted
    // the prompt. The fix that holds is the one that removes the decision.
    expect(readFileSync("supabase/functions/agent/context.ts", "utf8")).not.toMatch(/laUtcOffset/);
  });
});

describe("the prompt only names tools that exist", () => {
  it("every tool the prompt tells the model to call is registered", () => {
    // Prompt rot: a rule survives a tool being renamed, the model calls the old
    // name, and the failure looks like the model being stupid.
    const mentioned = new Set(
      [...STATIC_SYSTEM_PROMPT.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+){1,3})\b/g)].map((m) => m[1]),
    );
    // A snake_case name in the prompt is legitimate if it's a tool OR a
    // documented argument of one (`delete_all_matching` is a parameter, not a
    // tool). Anything else that reads like a tool call — same verb prefix as a
    // real tool — is a name that has stopped existing.
    const verbs = new Set([...toolNames].map((n) => n.split("_")[0]));
    const paramNames = new Set(
      [...TOOL_DEFINITIONS, buildPointAtTool([])].flatMap((t) =>
        Object.keys((t as { function: { parameters?: { properties?: object } } }).function.parameters?.properties ?? {}),
      ),
    );
    const suspects = [...mentioned].filter(
      (n) => verbs.has(n.split("_")[0]) && !toolNames.has(n) && !paramNames.has(n),
    );
    expect(suspects, `the prompt names tools that are not registered: ${suspects.join(", ")}`).toEqual([]);
  });
});
