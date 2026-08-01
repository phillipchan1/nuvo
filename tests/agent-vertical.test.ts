// The half of the chat the battery can't see: what a handler DOES with the
// arguments the model chose.
//
// tests/agent/harness.ts records tool calls rather than executing them, and
// names that gap out loud (docs/agent-conformance.md §5). This file closes it
// for the vertical tools, because the gap is where a real conversation went
// wrong on 2026-08-01:
//
//   user:  "add a project as I launch Dayspring to the App Store"
//   agent: ✓ Created project "Build Dayspring Support Infrastructure"
//   user:  "Update the Dayspring support infrastructure project."
//   agent: "I found two matching projects, so I need the exact one."
//   user:  "Use the one tied to Get Dayspring into the Public."
//   agent: "There are still 2 matching projects."
//   user:  "Update both"
//   agent: ✓ Updated project ... ✓ Updated project ...
//
// Read as a model failure it looks like stubbornness. It isn't. Every turn
// there is the tool layer's fault:
//   · create_project inserted a second project with a name that already
//     existed, with no unique constraint behind it and no guard in front —
//     so the ambiguity was manufactured by the agent, in that conversation.
//   · the multi-match error said "Multiple projects match (2)" and nothing
//     else. No ids, no names, no parent. The model could not offer a choice
//     because it had not been told what the choices were, so all it could do
//     was hand the question back — three times.
//   · the user then answered it, precisely ("tied to Get Dayspring into the
//     Public") — and there was no way to spend that answer, because a project
//     lookup could be narrowed by domain and by nothing else.
//   · the only exit the tool layer offered was the advice baked into the
//     error string: delete_all_matching. From an UPDATE. So the conversation
//     ended by writing the same description over two different projects.
//
// Every case below is one of those, and each fails against the code as it
// stood that day.
//
// Run: npm test

import { beforeEach, describe, expect, it } from "vitest";

import { db, resetDb } from "./agent/fakeSupabase.ts";
import { executeVerticalTool } from "../supabase/functions/agent/verticalTools.ts";

const USER = "user-phil";

const ID = {
  domWork: "d-work",
  initPublic: "i-public",
  initOther: "i-other",
  projA: "p-support-a",
  projB: "p-support-b",
};

/** Phil's account at the moment the conversation went wrong: one initiative,
 *  and two projects that are the same name to the letter. */
function twoIdenticalProjects() {
  resetDb({
    domains: [{ id: ID.domWork, user_id: USER, name: "Work", sort_order: 1 }],
    initiatives: [
      { id: ID.initPublic, user_id: USER, domain_id: ID.domWork, name: "Get Dayspring into the Public", sort_order: 1 },
      { id: ID.initOther, user_id: USER, domain_id: ID.domWork, name: "Dayspring v2", sort_order: 2 },
    ],
    projects: [
      {
        id: ID.projA, user_id: USER, domain_id: ID.domWork, initiative_id: ID.initPublic,
        name: "Build Dayspring Support Infrastructure", outcome: "", description: "", status: "backlog", sort_order: 1,
      },
      {
        id: ID.projB, user_id: USER, domain_id: ID.domWork, initiative_id: ID.initOther,
        name: "Build Dayspring Support Infrastructure", outcome: "", description: "", status: "backlog", sort_order: 2,
      },
    ],
    key_results: [],
  });
}

const projects = () => db.projects as Record<string, unknown>[];

/** Run a tool and hand back whichever happened — a result or the error text.
 *  Both are things the model reads, so both are things a test asserts on. */
async function run(name: string, args: Record<string, unknown>) {
  try {
    const out = await executeVerticalTool(USER, name, args);
    return { ok: true as const, ...out, data: JSON.parse(out.result) };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
}

// ── the ambiguity should never have existed ──────────────────────────────────

describe("creating structure that already exists", () => {
  beforeEach(() => {
    resetDb({
      domains: [{ id: ID.domWork, user_id: USER, name: "Work", sort_order: 1 }],
      initiatives: [
        { id: ID.initPublic, user_id: USER, domain_id: ID.domWork, name: "Get Dayspring into the Public", sort_order: 1 },
      ],
      projects: [
        {
          id: ID.projA, user_id: USER, domain_id: ID.domWork, initiative_id: ID.initPublic,
          name: "Build Dayspring Support Infrastructure", outcome: "", description: "", status: "backlog", sort_order: 1,
        },
      ],
      key_results: [],
    });
  });

  it("hands back the project that already has that name instead of making a second one", async () => {
    const res = await run("create_project", {
      name: "Build Dayspring Support Infrastructure",
      domain_id: ID.domWork,
      initiative_id: ID.initPublic,
      outcome: "A support system that runs itself",
    });

    expect(res.ok).toBe(true);
    expect(projects()).toHaveLength(1);
    expect(res.data.id).toBe(ID.projA);
  });

  it("says it already existed, so the reply can't call it a creation", async () => {
    // The model writes its confirmation from this result. If the shape of a
    // no-op is identical to the shape of a create, the user is told something
    // was built that wasn't — the failure structure-no-phantom-claims pins
    // from the other direction.
    const res = await run("create_project", {
      name: "build dayspring support infrastructure", // case differs; same project
      domain_id: ID.domWork,
    });

    expect(res.ok).toBe(true);
    expect(res.data.existing).toBe(true);
    expect(res.action?.summary).toMatch(/already exists/i);
    expect(projects()).toHaveLength(1);
  });

  it("still creates when the name is genuinely new", async () => {
    const res = await run("create_project", {
      name: "Dayspring App Store Listing",
      domain_id: ID.domWork,
    });

    expect(res.ok).toBe(true);
    expect(res.data.existing).toBeFalsy();
    expect(projects()).toHaveLength(2);
  });

  it("lets the user have a second one when they say so outright", async () => {
    // A guard with no override is a guard that eventually gets removed. The
    // escape hatch exists so the rule can stay strict by default.
    const res = await run("create_project", {
      name: "Build Dayspring Support Infrastructure",
      domain_id: ID.domWork,
      allow_duplicate: true,
    });

    expect(res.ok).toBe(true);
    expect(projects()).toHaveLength(2);
  });

  it("guards initiatives the same way — the transcript's first turn", async () => {
    // "do we have an initiative to track that?" — the agent found one and
    // updated it. Had it not, this is what would have stopped a twin.
    const res = await run("create_initiative", {
      name: "Get Dayspring into the Public",
      domain_id: ID.domWork,
    });

    expect(res.ok).toBe(true);
    expect(res.data.existing).toBe(true);
    expect(db.initiatives).toHaveLength(1);
  });
});

// ── when it does exist, the model must be able to resolve it ─────────────────

describe("a lookup that matches more than one project", () => {
  beforeEach(twoIdenticalProjects);

  it("names the candidates, so the model can offer a choice instead of asking again", async () => {
    const res = await run("update_project", {
      project_name: "Dayspring support infrastructure",
      description: "Support entry points, subscription handling, AI triage.",
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;

    // The whole failure in one assertion: the old error was the bare count.
    expect(res.error).toContain(ID.projA);
    expect(res.error).toContain(ID.projB);
  });

  it("carries what actually tells them apart — the initiative each one sits under", async () => {
    // The user's disambiguator was "tied to Get Dayspring into the Public".
    // If the error doesn't carry that, the answer is unspendable no matter how
    // precisely it's given.
    const res = await run("update_project", {
      project_name: "Dayspring support infrastructure",
      description: "x",
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("Get Dayspring into the Public");
    expect(res.error).toContain("Dayspring v2");
  });

  it("does not write to anything while it's ambiguous", async () => {
    await run("update_project", { project_name: "Dayspring support infrastructure", description: "x" });

    expect(projects().every((p) => p.description === "")).toBe(true);
  });

  it("never tells an update to go delete things", async () => {
    // The old error appended "or delete_all_matching after user confirms" to
    // every resolve failure, including this one. That advice is how "Update
    // both" became a plausible next move.
    const res = await run("update_project", { project_name: "Dayspring support infrastructure", description: "x" });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).not.toMatch(/delete/i);
  });

  it("updates exactly the one named by id, leaving its twin alone", async () => {
    const res = await run("update_project", {
      project_id: ID.projA,
      description: "Support entry points, subscription handling, AI triage.",
    });

    expect(res.ok).toBe(true);
    const [a, b] = [projects().find((p) => p.id === ID.projA), projects().find((p) => p.id === ID.projB)];
    expect(a?.description).toMatch(/Support entry points/);
    expect(b?.description).toBe("");
  });
});

describe("a lookup that could be exact", () => {
  beforeEach(() => {
    resetDb({
      domains: [{ id: ID.domWork, user_id: USER, name: "Work", sort_order: 1 }],
      initiatives: [],
      projects: [
        { id: "p-support", user_id: USER, domain_id: ID.domWork, initiative_id: null, name: "Dayspring Support", outcome: "", description: "", status: "backlog", sort_order: 1 },
        { id: "p-support-v2", user_id: USER, domain_id: ID.domWork, initiative_id: null, name: "Dayspring Support v2 Rollout", outcome: "", description: "", status: "backlog", sort_order: 2 },
      ],
      key_results: [],
    });
  });

  it("takes the exact name over the one that merely contains it", async () => {
    // Substring matching alone makes every short project name ambiguous the
    // moment a longer one is created next to it — an ambiguity the user would
    // never call ambiguous.
    const res = await run("update_project", { project_name: "Dayspring Support", status: "in_progress" });

    expect(res.ok).toBe(true);
    expect(projects().find((p) => p.id === "p-support")?.status).toBe("in_progress");
    expect(projects().find((p) => p.id === "p-support-v2")?.status).toBe("backlog");
  });

  it("still falls back to substring when nothing matches exactly", async () => {
    const res = await run("update_project", { project_name: "v2 Rollout", status: "in_progress" });

    expect(res.ok).toBe(true);
    expect(projects().find((p) => p.id === "p-support-v2")?.status).toBe("in_progress");
  });
});

describe("a lookup narrowed by the initiative the user named", () => {
  beforeEach(twoIdenticalProjects);

  it("resolves two identical names down to one when the parent is given", async () => {
    // "Use the Dayspring support infrastructure project tied to Get Dayspring
    // into the Public" — the sentence the old tool layer had nowhere to put.
    const res = await run("update_project", {
      project_name: "Build Dayspring Support Infrastructure",
      in_initiative_name: "Get Dayspring into the Public",
      description: "Support entry points, subscription handling, AI triage.",
    });

    expect(res.ok).toBe(true);
    expect(projects().find((p) => p.id === ID.projA)?.description).toMatch(/Support entry points/);
    expect(projects().find((p) => p.id === ID.projB)?.description).toBe("");
  });

  it("keeps the narrowing filter separate from the field that re-parents a project", async () => {
    // in_initiative_name picks WHICH project; initiative_name says where the
    // project should now live. One name for both would make "the one under X"
    // silently move a project to X.
    const res = await run("update_project", {
      project_id: ID.projA,
      initiative_name: "Dayspring v2",
    });

    expect(res.ok).toBe(true);
    expect(projects().find((p) => p.id === ID.projA)?.initiative_id).toBe(ID.initOther);
  });

  it("says so plainly when the narrowing rules everything out", async () => {
    const res = await run("update_project", {
      project_name: "Build Dayspring Support Infrastructure",
      in_initiative_name: "Frontier Rebrand",
      description: "x",
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/No initiative matching/i);
  });
});

// ── the same shape, on the tool that can't be undone ─────────────────────────

describe("deleting under ambiguity", () => {
  beforeEach(twoIdenticalProjects);

  it("refuses to guess, and lists what it found", async () => {
    const res = await run("delete_project", { project_name: "Build Dayspring Support Infrastructure" });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain(ID.projA);
    expect(projects()).toHaveLength(2);
  });

  it("still deletes both when the user has explicitly said all of them", async () => {
    const res = await run("delete_project", {
      project_name: "Build Dayspring Support Infrastructure",
      delete_all_matching: true,
    });

    expect(res.ok).toBe(true);
    expect(projects()).toHaveLength(0);
  });
});
