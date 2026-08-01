// The battery's harness, exercised without a model.
//
// `npm run eval` needs an API key, so on a normal push nothing would prove that
// the harness still works — and a battery that silently stopped running is
// worse than no battery, because the green check keeps arriving. These tests
// drive the same path (`runScenario` → the real prompt, the real tool list, the
// real loop) with a scripted model standing in for the real one, so a break in
// the plumbing fails here, in CI, in milliseconds.
//
// They assert the harness reports correctly — that a right answer passes and a
// wrong one fails with a sentence someone can act on. Whether the real model
// gives the right answer is what `npm run eval` is for.
//
// Run: npm test

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { ChatClient } from "../supabase/functions/agent/loop.ts";
import { runScenario } from "./agent/harness.ts";
import { SCENARIOS, scenarioById } from "./agent/scenarios.ts";
import { ID as WORLD_ID, TODAY } from "./agent/world.ts";

/** A model that answers with exactly the calls you hand it. */
function scripted(rounds: { content?: string; calls?: { name: string; args: unknown }[] }[]): ChatClient {
  let i = 0;
  const next = () => rounds[i++] ?? { content: "" };
  const asCalls = (r: { calls?: { name: string; args: unknown }[] }) =>
    (r.calls ?? []).map((c, idx) => ({
      id: `c${idx}`,
      type: "function" as const,
      function: { name: c.name, arguments: JSON.stringify(c.args) },
    }));
  return {
    stream() {
      const r = next();
      const enc = new TextEncoder();
      const frames: string[] = [];
      if (r.content) frames.push(`data: ${JSON.stringify({ choices: [{ delta: { content: r.content } }] })}\n\n`);
      asCalls(r).forEach((tc, idx) =>
        frames.push(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: idx, id: tc.id, function: tc.function }] } }] })}\n\n`),
      );
      frames.push("data: [DONE]\n\n");
      return Promise.resolve(new ReadableStream<Uint8Array>({
        start(c) { for (const f of frames) c.enqueue(enc.encode(f)); c.close(); },
      }));
    },
    complete() {
      const r = next();
      const calls = asCalls(r);
      return Promise.resolve({ content: r.content ?? null, tool_calls: calls.length ? calls : undefined });
    },
  };
}

const SLOT = scenarioById("slot-one-window-many-items")!;

/** What a correct agent does with the sentence from the 2026-07-31 screenshot. */
const RIGHT_ANSWER = [
  {
    calls: [{
      name: "create_slot",
      args: {
        title: "Ship & fix",
        start_local: `${TODAY}T09:00`,
        duration_minutes: 180,
        tasks: [
          { title: "Update documentation" },
          { title: "Deploy Dayspring" },
          { title: "Fix Stampede subdomains" },
        ],
      },
    }],
  },
  { content: "Held **Ship & fix** — 9:00 AM–12:00 PM today, three things inside." },
];

/** What it actually did: three separate blocks, an hour apart. */
const THE_BUG = [
  {
    calls: [
      { name: "create_task", args: { title: "Update documentation", do_date: TODAY, start_time: `${TODAY}T09:00` } },
      { name: "create_task", args: { title: "Deploy Dayspring", do_date: TODAY, start_time: `${TODAY}T10:00` } },
      { name: "create_task", args: { title: "Fix Stampede subdomains", do_date: TODAY, start_time: `${TODAY}T11:00` } },
    ],
  },
  { content: "Done — I put three 9am-plus blocks on today." },
];

const run = (rounds: Parameters<typeof scripted>[0]) =>
  runScenario({
    id: SLOT.id,
    worldName: SLOT.world,
    turns: SLOT.turns,
    respond: SLOT.respond,
    mode: "live",           // "live" only means "use this client"; nothing leaves the process
    client: scripted(rounds),
  });

describe("the battery harness", () => {
  it("sends the real prompt, the real tools and the real snapshot", async () => {
    const o = await run(RIGHT_ANSWER);
    expect(o.messages[0].content).toContain("You are Nuvo");
    expect(o.messages[1].content).toContain("Get Stampede Ready for ATC Review");
    expect(o.calls.map((c) => c.name)).toEqual(["create_slot"]);
  });

  it("passes the slot scenario when the agent answers correctly", async () => {
    const o = await run(RIGHT_ANSWER);
    const failures = SLOT.expect.map((c) => c.run(o)).filter(Boolean);
    expect(failures).toEqual([]);
  });

  it("fails it on the exact answer the screenshot captured — and says why", async () => {
    const o = await run(THE_BUG);
    const failures = SLOT.expect.map((c) => c.run(o)).filter((f): f is string => f != null);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join(" ")).toMatch(/expected create_slot/);
    expect(failures.join(" ")).toMatch(/create_task/);
  });

  // A scenario nobody has watched fail is a scenario that might assert nothing.
  // These replay the 2026-08-01 Dayspring transcript — the real answers, as
  // given — against the checks written to catch them, so the checks are known
  // to be load-bearing before a live run ever gets the credit.
  it("catches the reply that repeated the question instead of showing the options", async () => {
    const s = scenarioById("structure-ambiguity-shows-the-options")!;
    const o = await runScenario({
      id: s.id,
      worldName: s.world,
      turns: s.turns,
      respond: s.respond,
      mode: "live",
      client: scripted([
        { calls: [{ name: "update_project", args: { project_name: "Dayspring support infrastructure", description: "…" } }] },
        { content: "I found two matching Dayspring support infrastructure projects, so I need the exact one to update." },
      ]),
    });
    const failures = s.expect.map((c) => c.run(o)).filter((f): f is string => f != null);
    expect(failures.join(" ")).toMatch(/names the first candidate's initiative/);
    expect(failures.join(" ")).toMatch(/expected ≥2 suggestions/);
  });

  it("catches the turn that answered ambiguity by writing to both", async () => {
    const s = scenarioById("structure-one-target-per-write")!;
    const o = await runScenario({
      id: s.id,
      worldName: s.world,
      turns: s.turns,
      respond: s.respond,
      mode: "live",
      client: scripted([
        { calls: [{ name: "update_project", args: { project_name: "Dayspring support infrastructure", description: "…" } }] },
        {
          calls: [
            { name: "update_project", args: { project_id: WORLD_ID.projDayspring, description: "…" } },
            { name: "update_project", args: { project_id: WORLD_ID.projDayspringDocs, description: "…" } },
          ],
        },
        { content: "Done — I updated both Dayspring support infrastructure projects." },
      ]),
    });
    const failures = s.expect.map((c) => c.run(o)).filter((f): f is string => f != null);
    expect(failures.join(" ")).toMatch(/wrote the same update to 2 projects/);
  });

  it("passes that same scenario when the agent picks one and asks", async () => {
    const s = scenarioById("structure-one-target-per-write")!;
    const o = await runScenario({
      id: s.id,
      worldName: s.world,
      turns: s.turns,
      respond: s.respond,
      mode: "live",
      client: scripted([
        { calls: [{ name: "update_project", args: { project_name: "Dayspring support infrastructure", description: "…" } }] },
        { content: "Two projects carry that name — one under **Get Dayspring into the Public**, one under **Dayspring v2**. Which one?" },
      ]),
    });
    expect(s.expect.map((c) => c.run(o)).filter(Boolean)).toEqual([]);
  });

  it("catches a no-op reported as a creation", async () => {
    const s = scenarioById("structure-existing-is-not-a-creation")!;
    const o = await runScenario({
      id: s.id,
      worldName: s.world,
      turns: s.turns,
      respond: s.respond,
      mode: "live",
      client: scripted([
        { calls: [{ name: "create_project", args: { name: "Dayspring docs" } }] },
        { content: "Created project **Dayspring docs** for you." },
      ]),
    });
    const failures = s.expect.map((c) => c.run(o)).filter((f): f is string => f != null);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join(" ")).toMatch(/calls a no-op a creation/);
  });

  it("reads a multi-turn conversation, assistant turns included", async () => {
    const s = scenarioById("slot-add-to-existing")!;
    const o = await runScenario({
      id: s.id,
      worldName: s.world,
      turns: s.turns,
      mode: "live",
      client: scripted([{ calls: [{ name: "add_to_slot", args: { slot_title: "Stampede push" } }] }, { content: "Added it." }]),
    });
    const roles = o.messages.filter((m) => m.role !== "system" && m.role !== "tool").map((m) => m.role);
    expect(roles.slice(0, 3)).toEqual(["user", "assistant", "user"]);
  });
});

// ── replay, when cassettes exist ─────────────────────────────────────────────

const CASSETTES = join(import.meta.dirname, "agent", "cassettes");
const recorded = existsSync(CASSETTES)
  ? readdirSync(CASSETTES).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))
  : [];

describe.skipIf(recorded.length === 0)("recorded runs (npm run eval:replay)", () => {
  for (const id of recorded) {
    const s = SCENARIOS.find((x) => x.id === id);
    it.skipIf(!s)(`${id} — ${s?.it ?? "no longer in the battery"}`, async () => {
      const o = await runScenario({
        id,
        worldName: s!.world,
        turns: s!.turns,
        respond: s!.respond,
        navFocus: s!.navFocus,
        mode: "replay",
      });
      const failures = s!.expect.map((c) => c.run(o)).filter((f): f is string => f != null);
      expect(failures, `${id}: ${s!.it}`).toEqual([]);
    });
  }
});
