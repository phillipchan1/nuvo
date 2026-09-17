import { beforeAll, describe, expect, it } from "vitest";
import { draftFromCapture, type CaptureEnv } from "../src/lib/captureDraft";
import { nlpReady, parseCapture } from "../src/lib/nlp";

// Thursday 17 Sep 2026.
const REF = new Date(2026, 8, 17, 8, 0, 0);

beforeAll(async () => {
  await nlpReady;
});

const env: CaptureEnv = {
  labels: [{ id: "L1", name: "calls", color: "#000" } as never],
  routeTargets: [
    { id: "P1", kind: "project", name: "Launch site" },
    { id: "P2", kind: "project", name: "Home reno" },
    { id: "D1", kind: "domain", name: "Work" },
  ],
  homeOfProject: (id) => (id === "P1" ? { initiativeId: "I1", domainId: "D1" } : { initiativeId: null, domainId: "D2" }),
  homeOfInitiative: () => ({ domainId: "D1" }),
  todayISO: "2026-09-17",
  defaultDurationMins: 30,
};

const draft = (text: string, ctx = {}) => draftFromCapture(parseCapture(text, REF), text, ctx, env);

describe("draftFromCapture — one meaning for a typed line", () => {
  it("a bare capture lands in the inbox with every token kept", () => {
    const a = draft("call Dana #calls !high // bring notes");
    expect(a?.kind).toBe("task");
    if (a?.kind !== "task") return;
    expect(a.input).toMatchObject({
      title: "call Dana",
      priority: "high",
      notes: "bring notes",
      labelIds: ["L1"],
      do_date: null,
      project_id: null,
      status: undefined,
    });
  });

  it("inside a project, undated work rests in its backlog with the project's home", () => {
    const a = draft("write FAQ", { projectId: "P1" });
    if (a?.kind !== "task") throw new Error("expected a task");
    expect(a.input).toMatchObject({ project_id: "P1", initiative_id: "I1", domain_id: "D1", status: "backlog", duration_minutes: 45 });
  });

  it("a typed @home beats the host's home", () => {
    const a = draft("order tiles @home-reno", { projectId: "P1" });
    if (a?.kind !== "task") throw new Error("expected a task");
    expect(a.input).toMatchObject({ title: "order tiles", project_id: "P2", domain_id: "D2" });
  });

  it("an unmatched @token stays in the title for grooming", () => {
    const a = draft("ask about @nothing-here");
    if (a?.kind !== "task") throw new Error("expected a task");
    expect(a.input.title).toBe("ask about @nothing-here");
    expect(a.input.project_id).toBeNull();
  });

  it("a typed day beats the host's day", () => {
    const a = draft("prep tomorrow", { doDate: "2026-09-17" });
    if (a?.kind !== "task") throw new Error("expected a task");
    expect(a.input.do_date).toBe("2026-09-18");
  });

  it("a slot keeps what's typed into it — unless the words asked for another day", () => {
    const slot = { id: "S1", do_date: "2026-09-17", project_id: null, domain_id: "D1" };
    const inside = draft("outline talk 20m", { slot });
    if (inside?.kind !== "task") throw new Error("expected a task");
    expect(inside.input).toMatchObject({ slot_id: "S1", do_date: "2026-09-17", duration_minutes: 20 });
    const out = draft("outline talk friday", { slot });
    if (out?.kind !== "task") throw new Error("expected a task");
    expect(out.input.slot_id).toBeNull();
    expect(out.input.do_date).toBe("2026-09-18");
  });

  it("a canvas tap's clock is used when the words don't name one", () => {
    const startTime = new Date(2026, 8, 17, 14, 0);
    const a = draft("review PR", { doDate: "2026-09-17", startTime, durationMinutes: 60 });
    if (a?.kind !== "task") throw new Error("expected a task");
    expect(a.input.start_time).toBe(startTime.toISOString());
    expect(a.input.duration_minutes).toBe(60);
  });

  it("a repeat becomes a series, not a plain task", () => {
    const a = draft("water plants every week", { projectId: "P1" });
    expect(a?.kind).toBe("series");
    if (a?.kind !== "series") return;
    expect(a.template).toMatchObject({ title: "water plants", project_id: "P1", domain_id: "D1" });
  });
});
