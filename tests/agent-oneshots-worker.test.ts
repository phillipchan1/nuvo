// The Worker runs the Supabase agent's one-shots as-is (supabase/functions/
// agent/oneShots.ts + the *Core.ts modules), over agentDb.ts — the Worker's
// session-scoped PostgREST layer — instead of the service-role client. For each
// branch: the owner's happy path with the LLM mocked, another user's ids
// rejected or ignored the way the Supabase function treats them, and the
// Supabase error shapes (a throw → {error: message}; 500, except a missing or
// foreign row, which is 404 on the Worker so the access gate holds).
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { makePgliteSql } from "../worker/src/pgliteSql.ts";
import { resetRestCatalogForTests } from "../worker/src/rest.ts";
import { makeStore, type Store } from "../worker/src/store.ts";
import { oneShotPg } from "./agent/oneShotPg.ts";

const A = "11111111-1111-1111-1111-111111111111";
const A_DOMAIN = "aaaaaaaa-0000-4000-8000-000000000001";
const A_HOME_DOMAIN = "aaaaaaaa-0000-4000-8000-0000000000d2";
const A_PROJECT = "aaaaaaaa-1111-4000-8000-000000000001";
const A_INITIATIVE = "aaaaaaaa-7777-4000-8000-000000000001";
const A_TASK = "aaaaaaaa-2222-4000-8000-000000000001";
const A_STEP2 = "aaaaaaaa-2222-4000-8000-0000000000a2";
const A_INBOX1 = "aaaaaaaa-2222-4000-8000-0000000000b1";
const A_INBOX2 = "aaaaaaaa-2222-4000-8000-0000000000b2";
const B_DOMAIN = "bbbbbbbb-0000-4000-8000-000000000001";
const B_PROJECT = "bbbbbbbb-1111-4000-8000-000000000001";
const B_INITIATIVE = "bbbbbbbb-7777-4000-8000-000000000001";
const B_TASK = "bbbbbbbb-2222-4000-8000-000000000001";
const B_INBOX = "bbbbbbbb-2222-4000-8000-0000000000b1";
const RANDOM_ID = "99999999-9999-4999-8999-999999999999";
const ENV = { OPENAI_API_KEY: "sk-test" };

let currentStore: Store;
vi.mock("../worker/src/session.ts", () => ({
  requireStore: async () => ({ store: currentStore, email: null, user: { id: currentStore.userId, emailVerified: true } }),
}));
const { handleAgent } = await import("../worker/src/agentHttp.ts");

type Sent = { url: string; body: Record<string, unknown> };
type Reply = string | { status: number; body: string };

/** One fetch stub for both OpenAI endpoints: chat completions and /v1/decisions. */
function stubLlm(opts: { chat?: Reply | Reply[]; decisions?: unknown | { status: number } } = {}) {
  const sent: Sent[] = [];
  const chats = Array.isArray(opts.chat) ? [...opts.chat] : opts.chat === undefined ? [] : [opts.chat];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      sent.push({ url: u, body: JSON.parse(String(init?.body ?? "{}")) });
      if (u.endsWith("/v1/decisions")) {
        const d = opts.decisions ?? { status: 403 };
        if (d && typeof d === "object" && "status" in (d as object)) return new Response("not enabled", { status: (d as { status: number }).status });
        return new Response(JSON.stringify(d));
      }
      const next = chats.length > 1 ? chats.shift()! : chats[0] ?? "{}";
      if (typeof next === "object") return new Response(next.body, { status: next.status });
      return new Response(JSON.stringify({ choices: [{ message: { content: next } }] }));
    }),
  );
  return {
    sent,
    chats: () => sent.filter((s) => s.url.endsWith("/chat/completions")),
    prompt: (i = 0) => String((sent.filter((s) => s.url.endsWith("/chat/completions"))[i]?.body.messages as { content: string }[] | undefined)?.[0]?.content ?? ""),
  };
}

async function call(body: unknown, env: Record<string, string> = ENV) {
  const c = { req: { method: "POST", json: async () => body, raw: new Request("https://api.test/api/agent") }, env };
  // deno-lint-ignore no-explicit-any
  const res = await handleAgent(c as any);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

let db: PGlite;
const row = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows[0];

beforeAll(async () => {
  db = await oneShotPg();
  resetRestCatalogForTests();
  await db.exec(`
    UPDATE public.domains SET intention = 'Ship calm work', charter = 'Day job: product work at Acme' WHERE id = '${A_DOMAIN}';
    INSERT INTO public.domains (id, user_id, name, color, intention) VALUES ('${A_HOME_DOMAIN}', '${A}', 'A Home', '#16A34A', 'A calm house');
    UPDATE public.projects SET outcome = 'Launch v1', description = 'The first release', status = 'in_progress', initiative_id = '${A_INITIATIVE}' WHERE id = '${A_PROJECT}';
    UPDATE public.initiatives SET outcome = 'Win the quarter', description = 'The big bet', status = 'in_progress' WHERE id = '${A_INITIATIVE}';
    UPDATE public.tasks SET title = 'Write spec', status = 'backlog', sort_order = 1 WHERE id = '${A_TASK}';
    INSERT INTO public.tasks (id, user_id, title, status, project_id, sort_order, duration_minutes) VALUES
      ('${A_STEP2}', '${A}', 'Fix bug', 'backlog', '${A_PROJECT}', 2, 45);
    INSERT INTO public.tasks (id, user_id, title, notes, status, sort_order) VALUES
      ('${A_INBOX1}', '${A}', 'Email Acme invoice', '', 'inbox', 1),
      ('${A_INBOX2}', '${A}', 'Call plumber', '', 'inbox', 2),
      ('${B_INBOX}', '22222222-2222-2222-2222-222222222222', 'B secret inbox', 'private B', 'inbox', 1);
    UPDATE public.user_settings SET work_start_minutes = 540, work_end_minutes = 1020 WHERE user_id = '${A}';
  `);
  currentStore = makeStore(makePgliteSql(db), A);
});
afterAll(async () => {
  await db.close();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scaffold", () => {
  it("owner: proposes normalized tasks grounded in the project, its bet, domain and steps", async () => {
    const llm = stubLlm({ chat: JSON.stringify({ tasks: [{ title: " Draft outline ", energy: "deep", duration_minutes: 900 }, { title: "", energy: "x" }] }) });
    const res = await call({ scaffold: { projectId: A_PROJECT, guidance: "smaller steps" } });
    expect(res).toEqual({ status: 200, body: { tasks: [{ title: "Draft outline", energy: "deep", durationMins: 480 }] } });
    const p = llm.prompt();
    expect(p).toContain("A Project");
    expect(p).toContain("Launch v1");
    expect(p).toContain("A Initiative");
    expect(p).toContain("Ship calm work");
    expect(p).toContain("Write spec");
    expect(llm.chats()[0].body).toMatchObject({ model: "gpt-5.4-nano" });
  });
  it("non-owner / missing project: 404 Project not found, no LLM call", async () => {
    const llm = stubLlm();
    expect(await call({ scaffold: { projectId: B_PROJECT } })).toEqual({ status: 404, body: { error: "Project not found" } });
    expect(await call({ scaffold: { projectId: RANDOM_ID } })).toEqual({ status: 404, body: { error: "Project not found" } });
    expect(llm.sent).toHaveLength(0);
  });
  it("LLM errors keep Supabase's messages", async () => {
    stubLlm({ chat: "not json" });
    expect(await call({ scaffold: { projectId: A_PROJECT } })).toEqual({ status: 500, body: { error: "Could not parse the scaffold proposal" } });
    stubLlm({ chat: { status: 429, body: "slow down" } });
    expect(await call({ scaffold: { projectId: A_PROJECT } })).toEqual({ status: 500, body: { error: "LLM error 429: slow down" } });
    stubLlm();
    expect(await call({ scaffold: { projectId: A_PROJECT } }, {})).toEqual({
      status: 500,
      body: { error: "OPENROUTER_API_KEY or OPENAI_API_KEY not configured" },
    });
  });
});

describe("scaffoldDraft", () => {
  it("owner: grounds in the owner's initiative and domain", async () => {
    const llm = stubLlm({ chat: JSON.stringify({ tasks: [{ title: "Pick a vendor", energy: "decide", duration_minutes: 30 }] }) });
    const res = await call({ scaffoldDraft: { name: "Kitchen", outcome: "New sink", initiativeId: A_INITIATIVE, domainId: A_DOMAIN } });
    expect(res.status).toBe(200);
    expect(res.body.tasks).toEqual([{ title: "Pick a vendor", energy: "decide", durationMins: 30 }]);
    expect(llm.prompt()).toContain("A Initiative");
    expect(llm.prompt()).toContain("A Work");
  });
  it("another user's initiative/domain is not read (Supabase scoped these by user too)", async () => {
    const llm = stubLlm({ chat: JSON.stringify({ tasks: [] }) });
    expect(await call({ scaffoldDraft: { name: "Kitchen", initiativeId: B_INITIATIVE, domainId: B_DOMAIN } })).toEqual({ status: 200, body: { tasks: [] } });
    expect(llm.prompt()).not.toContain("B Initiative");
    expect(llm.prompt()).not.toContain("B Work");
  });
  it("no name: 500 Name the project first", async () => {
    stubLlm();
    expect(await call({ scaffoldDraft: { name: " " } })).toEqual({ status: 500, body: { error: "Name the project first" } });
  });
});

describe("refine", () => {
  it("owner: keeps real edits to live tasks, additions and a real reorder", async () => {
    stubLlm({
      chat: JSON.stringify({
        edits: [{ id: A_TASK, title: "Write the spec", reason: "clearer" }, { id: B_TASK, title: "hijack" }],
        additions: [{ title: "Ship it", energy: "quick", duration_minutes: 20 }],
        order: [A_STEP2, A_TASK],
      }),
    });
    expect(await call({ refine: { projectId: A_PROJECT } })).toEqual({
      status: 200,
      body: {
        edits: [{ id: A_TASK, original: "Write spec", title: "Write the spec", reason: "clearer" }],
        additions: [{ title: "Ship it", energy: "quick", durationMins: 20 }],
        order: [A_STEP2, A_TASK],
      },
    });
  });
  it("non-owner: 404 Project not found", async () => {
    const llm = stubLlm();
    expect(await call({ refine: { projectId: B_PROJECT } })).toEqual({ status: 404, body: { error: "Project not found" } });
    expect(llm.sent).toHaveLength(0);
  });
  it("bad model JSON: 500 Could not parse the refine proposal", async () => {
    stubLlm({ chat: "nope" });
    expect(await call({ refine: { projectId: A_PROJECT } })).toEqual({ status: 500, body: { error: "Could not parse the refine proposal" } });
  });
});

describe("assess", () => {
  it("owner project and initiative: findings, anchored to real ids", async () => {
    const llm = stubLlm({ chat: JSON.stringify({ findings: [{ anchor: "outcome", severity: "high", issue: "Vague", suggestion: "Name a number" }] }) });
    const p = await call({ assess: { kind: "project", id: A_PROJECT } });
    expect(p.status).toBe(200);
    expect((p.body.findings as unknown[]).length).toBe(1);
    expect(llm.prompt()).toContain("Write spec");
    const i = await call({ assess: { kind: "initiative", id: A_INITIATIVE } });
    expect(i.status).toBe(200);
    expect(llm.prompt(1)).toContain("A Project");
  });
  it("non-owner: Project / Initiative not found", async () => {
    stubLlm();
    expect(await call({ assess: { kind: "project", id: B_PROJECT } })).toEqual({ status: 404, body: { error: "Project not found" } });
    expect(await call({ assess: { kind: "initiative", id: B_INITIATIVE } })).toEqual({ status: 404, body: { error: "Initiative not found" } });
  });
  it("a bad kind is not a one-shot on Supabase either: falls through to 400 messages required", async () => {
    stubLlm();
    expect(await call({ assess: { kind: "goal", id: A_PROJECT } })).toEqual({ status: 400, body: { error: "messages required" } });
  });
});

describe("verify", () => {
  it("owner: a normalized verdict, reading tasks and the work window", async () => {
    const llm = stubLlm({
      chat: JSON.stringify({
        sound: true, confidence: 0.7,
        outcome: { ok: true, note: "clear", suggestion: "" },
        steps: { ok: true, note: "fine", verdict: "sound", missing: [] },
        time: { ok: true, note: "ok", read: "comfortable", estHours: 3 },
        dates: { ok: true, note: "ok" },
      }),
    });
    const res = await call({ verify: { kind: "project", id: A_PROJECT } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sound: true, confidence: 0.7, steps: { verdict: "sound" }, time: { read: "comfortable" } });
    expect(llm.prompt()).toContain("Fix bug");
  });
  it("non-owner: 404 '<kind> not found'", async () => {
    stubLlm();
    expect(await call({ verify: { kind: "project", id: B_PROJECT } })).toEqual({ status: 404, body: { error: "project not found" } });
    expect(await call({ verify: { kind: "initiative", id: B_INITIATIVE } })).toEqual({ status: 404, body: { error: "initiative not found" } });
  });
});

describe("blueprint", () => {
  it("owner: key results and projects from the model", async () => {
    const llm = stubLlm({
      chat: JSON.stringify({
        keyResults: [{ name: "Paying users", baseline: 0, target: 10, unit: "users" }],
        projects: [{ name: "Beta", outcome: "Ten testers", tasks: [{ title: "Invite testers", energy: "quick", duration_minutes: 20 }] }],
      }),
    });
    const res = await call({ blueprint: { name: "Grow", outcome: "10 paying users", domainId: A_DOMAIN, draftProjectNames: ["Landing page"] } });
    expect(res.status).toBe(200);
    expect((res.body.keyResults as unknown[]).length).toBe(1);
    expect((res.body.projects as unknown[]).length).toBe(1);
    expect(llm.prompt()).toContain("Ship calm work");
    expect(llm.prompt()).toContain("Landing page");
  });
  it("another user's domain is not read", async () => {
    const llm = stubLlm({ chat: JSON.stringify({ keyResults: [], projects: [] }) });
    expect((await call({ blueprint: { name: "Grow", outcome: "x", domainId: B_DOMAIN } })).status).toBe(200);
    expect(llm.prompt()).not.toContain("B Work");
  });
});

describe("draftProjects", () => {
  it("owner: project proposals across the weeks", async () => {
    const llm = stubLlm({ chat: JSON.stringify({ projects: [{ name: "Pricing page", outcome: "Live", startWeek: 0, weeks: 2 }] }) });
    const res = await call({ draftProjects: { initiativeId: A_INITIATIVE, weekStarts: ["2026-11-16", "2026-11-23", "2026-11-30"] } });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.projects)).toBe(true);
    expect(llm.prompt()).toContain("A Initiative");
  });
  it("non-owner: 404 Initiative not found; no weeks: 500 No weeks to draft into", async () => {
    stubLlm();
    expect(await call({ draftProjects: { initiativeId: B_INITIATIVE, weekStarts: ["2026-11-16"] } })).toEqual({ status: 404, body: { error: "Initiative not found" } });
    expect(await call({ draftProjects: { initiativeId: A_INITIATIVE, weekStarts: ["soon"] } })).toEqual({ status: 500, body: { error: "No weeks to draft into" } });
  });
});

describe("priorities and breakdown", () => {
  it("priorities: parses free text against the owner's vertical only", async () => {
    const llm = stubLlm({ chat: JSON.stringify({ priorities: [{ title: "Ship v1", win: "v1 live" }], tasks: [] }) });
    const res = await call({ priorities: { text: "ship v1 this week", today: "2026-11-13" } });
    expect(res.status).toBe(200);
    expect((res.body.priorities as { title: string }[])[0].title).toBe("Ship v1");
    expect(llm.prompt()).toContain("A Project");
    expect(llm.prompt()).not.toContain("B Project");
  });
  it("priorities: empty text answers without the LLM", async () => {
    const llm = stubLlm();
    expect(await call({ priorities: { text: "  " } })).toEqual({ status: 200, body: { priorities: [], tasks: [] } });
    expect(llm.sent).toHaveLength(0);
  });
  it("breakdown: this week's next actions; empty title answers without the LLM", async () => {
    stubLlm({ chat: JSON.stringify({ tasks: [{ title: "Book QA", energy: "quick", duration_minutes: 15 }] }) });
    const res = await call({ breakdown: { title: "Ship v1", projectId: A_PROJECT } });
    expect(res).toEqual({ status: 200, body: { tasks: [{ title: "Book QA", energy: "quick", durationMins: 15 }] } });
    const llm = stubLlm();
    expect(await call({ breakdown: { title: "" } })).toEqual({ status: 200, body: { tasks: [] } });
    expect(llm.sent).toHaveLength(0);
  });
});

describe("prepare (writes the task's prework)", () => {
  it("owner: writes prework, prework_at and assignee on the owner's task only", async () => {
    const llm = stubLlm({ chat: "1. Open the doc\n2. List sections" });
    const res = await call({ prepare: { taskId: A_TASK } });
    expect(res).toEqual({ status: 200, body: { prework: "1. Open the doc\n2. List sections" } });
    expect(llm.chats()[0].body.response_format).toBeUndefined();
    const t = await row("SELECT prework, assignee, prework_at, field_ts FROM tasks WHERE id = $1", [A_TASK]);
    expect(t.prework).toBe("1. Open the doc\n2. List sections");
    expect(t.assignee).toBe("me");
    expect(t.prework_at).toBeTruthy();
    expect(Object.keys(t.field_ts as object)).toEqual(expect.arrayContaining(["prework", "prework_at", "assignee"]));
  });
  it("non-owner: 404 Task not found, B's task untouched", async () => {
    const llm = stubLlm({ chat: "steal" });
    expect(await call({ prepare: { taskId: B_TASK } })).toEqual({ status: 404, body: { error: "Task not found" } });
    expect(llm.sent).toHaveLength(0);
    expect((await row("SELECT prework FROM tasks WHERE id = $1", [B_TASK])).prework).toBe("");
  });
  it("empty model text: 500 The model returned empty pre-work", async () => {
    stubLlm({ chat: "   " });
    expect(await call({ prepare: { taskId: A_STEP2 } })).toEqual({ status: 500, body: { error: "The model returned empty pre-work" } });
  });
});

describe("clusterInbox", () => {
  it("owner inbox: groups only the owner's captures", async () => {
    const llm = stubLlm({ chat: JSON.stringify({ groups: [{ name: "Admin", energy: "quick", taskIds: [A_INBOX1, A_INBOX2, B_INBOX] }] }) });
    const res = await call({ clusterInbox: {} });
    expect(res.status).toBe(200);
    const groups = res.body.groups as { taskIds: string[] }[];
    expect(groups.flatMap((g) => g.taskIds).sort()).toEqual([A_INBOX1, A_INBOX2].sort());
    expect(llm.prompt()).not.toContain("B secret inbox");
  });
  it("another user's explicit ids: nothing to cluster, no LLM call", async () => {
    const llm = stubLlm();
    expect(await call({ clusterInbox: { taskIds: [B_INBOX, B_TASK] } })).toEqual({ status: 200, body: { groups: [] } });
    expect(llm.sent).toHaveLength(0);
  });
});

describe("nameSlot", () => {
  it("owner: a name from the block's tasks", async () => {
    stubLlm({ chat: JSON.stringify({ name: "Acme admin" }) });
    expect(await call({ nameSlot: { taskIds: [A_INBOX1] } })).toEqual({ status: 200, body: { name: "Acme admin" } });
  });
  it("another user's tasks: 500 Nothing in that block to name yet; none: taskIds required", async () => {
    stubLlm();
    expect(await call({ nameSlot: { taskIds: [B_INBOX] } })).toEqual({ status: 500, body: { error: "Nothing in that block to name yet" } });
    expect(await call({ nameSlot: { taskIds: [] } })).toEqual({ status: 500, body: { error: "taskIds required — a block is named by its contents" } });
  });
});

describe("enrichInbox (writes suggestions; an auto-filed domain)", () => {
  it("Decisions unavailable → the chat path; suggestion stored as a jsonb object", async () => {
    const llm = stubLlm({
      decisions: { status: 403 },
      chat: JSON.stringify({ items: [{ i: 0, level: "domain", targetId: `D:${A_DOMAIN}`, durationMinutes: 10, energy: "quick", rationale: "Acme", confidence: 0.6 }] }),
    });
    const res = await call({ enrichInbox: { taskIds: [A_INBOX1] } });
    expect(res.status).toBe(200);
    expect((res.body[A_INBOX1] as { level: string; targetId: string }).level).toBe("domain");
    const t = await row("SELECT jsonb_typeof(suggestion) AS kind, suggestion->>'level' AS level, domain_id, suggested_at FROM tasks WHERE id = $1", [A_INBOX1]);
    expect(t).toMatchObject({ kind: "object", level: "domain", domain_id: null });
    expect(t.suggested_at).toBeTruthy();
    expect(llm.sent.some((s) => s.url.endsWith("/v1/decisions"))).toBe(true);
  });
  it("Decisions auto verdict → files the domain onto the still-homeless capture", async () => {
    stubLlm({
      decisions: { answers: [{ name: "domain", type: "choice", choice: A_HOME_DOMAIN, probabilities: [{ value: A_HOME_DOMAIN, probability: 0.93 }] }] },
      chat: JSON.stringify({ items: [{ i: 0, durationMinutes: 15, energy: "quick", rationale: "errand", confidence: 0.8 }] }),
    });
    const res = await call({ enrichInbox: { taskIds: [A_INBOX2] } });
    expect(res.status).toBe(200);
    expect(res.body[A_INBOX2]).toMatchObject({ level: "domain", targetId: A_HOME_DOMAIN, auto: true, engine: "decisions" });
    const t = await row("SELECT domain_id, status, jsonb_typeof(suggestion) AS kind, suggestion->>'auto' AS auto FROM tasks WHERE id = $1", [A_INBOX2]);
    expect(t).toMatchObject({ domain_id: A_HOME_DOMAIN, status: "inbox", kind: "object", auto: "true" });
  });
  it("another user's ids: {} and their rows untouched", async () => {
    const llm = stubLlm({ chat: JSON.stringify({ items: [{ i: 0, level: "none" }] }) });
    expect(await call({ enrichInbox: { taskIds: [B_INBOX] } })).toEqual({ status: 200, body: {} });
    expect(llm.sent).toHaveLength(0);
    expect(await row("SELECT suggestion, domain_id FROM tasks WHERE id = $1", [B_INBOX])).toEqual({ suggestion: null, domain_id: null });
  });
});

describe("enrichDomain", () => {
  it("owner: grounded context and mis-files resolved to the owner's sibling domain", async () => {
    const llm = stubLlm({
      chat: JSON.stringify({ scope: "Acme product work", entities: ["Acme", "Unrelated Zebra"], keywords: ["spec"], boundary: "not home", exemplars: [], misfiled: [] }),
    });
    const res = await call({ enrichDomain: { domainId: A_DOMAIN, charter: "Day job: product work at Acme" } });
    expect(res.status).toBe(200);
    expect(res.body.context).toMatchObject({ scope: "Acme product work", entities: ["Acme"] });
    expect(llm.prompt()).toContain("A Home");
    expect(llm.prompt()).not.toContain("B Work");
  });
  it("non-owner: 404 Domain not found", async () => {
    stubLlm();
    expect(await call({ enrichDomain: { domainId: B_DOMAIN } })).toEqual({ status: 404, body: { error: "Domain not found" } });
  });
});

describe("routeProject", () => {
  it("owner: the classifier's domain verdict", async () => {
    const llm = stubLlm({ decisions: { answers: [{ name: "domain", type: "choice", choice: A_DOMAIN, probabilities: [{ value: A_DOMAIN, probability: 0.85 }] }] } });
    expect(await call({ routeProject: { name: "Acme roadmap" } })).toEqual({ status: 200, body: { route: { domainId: A_DOMAIN, probability: 0.85, tier: "auto" } } });
    const q = llm.sent.find((s) => s.url.endsWith("/v1/decisions"))!.body.questions as { choices: { value: string }[] }[];
    expect(q[0].choices.map((c) => c.value).sort()).toEqual([A_DOMAIN, A_HOME_DOMAIN].sort());
  });
  it("another user's domain is never a valid answer; no key → route null", async () => {
    stubLlm({ decisions: { answers: [{ name: "domain", type: "choice", choice: B_DOMAIN, probabilities: [{ value: B_DOMAIN, probability: 0.99 }] }] } });
    expect(await call({ routeProject: { name: "x" } })).toEqual({ status: 200, body: { route: null } });
    expect(await call({ routeProject: { name: "x" } }, {})).toEqual({ status: 200, body: { route: null } });
  });
});

describe("narrate and reviewFind (no data reads)", () => {
  const stats = { window: "week", doneCount: 3, doneHours: 5, byDomain: [], moved: [] };
  it("narrate: one sentence, quotes stripped; empty → 500 Empty narration", async () => {
    const llm = stubLlm({ chat: '"Three things done, five hours in."' });
    expect(await call({ narrate: stats })).toEqual({ status: 200, body: { sentence: "Three things done, five hours in." } });
    expect(llm.chats()[0].body.temperature).toBe(0.5);
    stubLlm({ chat: "" });
    expect(await call({ narrate: stats })).toEqual({ status: 500, body: { error: "Empty narration" } });
  });
  it("reviewFind: rewritten in voice; a blank model answer keeps the original", async () => {
    const input = { kind: "gain", tone: "warm", headline: "Five hours on Acme", detail: "Up from two.", receiptLabels: ["Spec"] };
    stubLlm({ chat: JSON.stringify({ headline: "You gave Acme five hours", detail: "Up from two last week." }) });
    expect(await call({ reviewFind: input })).toEqual({ status: 200, body: { headline: "You gave Acme five hours", detail: "Up from two last week." } });
    stubLlm({ chat: JSON.stringify({ headline: " ", detail: "" }) });
    expect(await call({ reviewFind: input })).toEqual({ status: 200, body: { headline: "Five hours on Acme", detail: "Up from two." } });
  });
});

describe("dispatch", () => {
  it("one body naming two one-shots runs the first in Supabase's order (scaffold before refine)", async () => {
    const llm = stubLlm({ chat: JSON.stringify({ tasks: [{ title: "Only scaffold", energy: "light", duration_minutes: 30 }] }) });
    const res = await call({ refine: { projectId: A_PROJECT }, scaffold: { projectId: A_PROJECT } });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["tasks"]);
    expect((res.body.tasks as { title: string }[])[0].title).toBe("Only scaffold");
    expect(llm.chats()).toHaveLength(1);
  });
  it("no LLM key: Supabase's 500 message, no call out", async () => {
    const llm = stubLlm();
    const res = await call({ narrate: { completed: 1 } }, {});
    expect(res.status).toBe(500);
    expect(String(res.body.error)).toMatch(/OPENAI_API_KEY not configured/);
    expect(llm.sent).toHaveLength(0);
  });
  it("a malformed id answers 404 like a missing one, not a Postgres error", async () => {
    stubLlm();
    expect(await call({ prepare: { taskId: "not-a-uuid" } })).toEqual({ status: 404, body: { error: "Task not found" } });
  });
});
