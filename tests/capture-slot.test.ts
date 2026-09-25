// A slot from a typed line (D-149) — the capture door's third face.
//
// Same sentence, same grammar, a different object: a block that will HOLD work.
// The words win over the surface exactly as they do for a task (typed tokens >
// the surface's context > defaults), and a slot is never made without a clock.

import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SLOT_MINUTES, slotFromCapture, type CaptureEnv, type SlotWhen } from "../src/lib/captureDraft";
import { nlpReady, parseCapture } from "../src/lib/nlp";

// Thursday 17 Sep 2026, 8am.
const REF = new Date(2026, 8, 17, 8, 0, 0);

beforeAll(async () => {
  await nlpReady;
});

const env: CaptureEnv = {
  labels: [],
  routeTargets: [
    { id: "P1", kind: "project", name: "Launch site" },
    { id: "D1", kind: "domain", name: "Work" },
  ],
  homeOfProject: () => ({ initiativeId: "I1", domainId: "D1" }),
  homeOfInitiative: () => ({ domainId: "D1" }),
  todayISO: "2026-09-17",
  defaultDurationMins: 30,
};
const colour = (id: string) => (id === "D1" ? "#123456" : null);

const at = (h: number, m = 0, day = 17) => new Date(2026, 8, day, h, m, 0);
const slot = (text: string, when: Partial<SlotWhen> = {}) =>
  slotFromCapture(parseCapture(text, REF), text, { doDate: null, start: at(10), durationMinutes: null, ...when }, env, colour);

describe("slotFromCapture", () => {
  it("holds the surface's clock when the words don't name one", () => {
    const a = slot("deep work");
    expect(a?.kind).toBe("slot");
    if (a?.kind !== "slot") return;
    expect(a.input).toMatchObject({
      title: "deep work",
      do_date: "2026-09-17",
      duration_minutes: DEFAULT_SLOT_MINUTES,
      project_id: null,
      domain_id: null,
      color: null,
    });
    expect(new Date(a.input.start_time).getHours()).toBe(10);
  });

  it("lets a typed day, time and length win over the surface", () => {
    const a = slot("deep work tomorrow 2pm 2h", { start: at(9), durationMinutes: 30 });
    if (a?.kind !== "slot") throw new Error("expected a slot");
    expect(a.input.title).toBe("deep work");
    expect(a.input.do_date).toBe("2026-09-18");
    expect(new Date(a.input.start_time).getHours()).toBe(14);
    expect(a.input.duration_minutes).toBe(120);
  });

  it("keeps the surface's clock on a typed day", () => {
    const a = slot("writing friday", { start: at(9, 30) });
    if (a?.kind !== "slot") throw new Error("expected a slot");
    expect(a.input.do_date).toBe("2026-09-18");
    const s = new Date(a.input.start_time);
    expect([s.getHours(), s.getMinutes()]).toEqual([9, 30]);
  });

  it("gets its affinity from @home — a domain, or a project and its domain", () => {
    const d = slot("admin @work");
    if (d?.kind !== "slot") throw new Error("expected a slot");
    expect(d.input).toMatchObject({ title: "admin", domain_id: "D1", project_id: null, color: "#123456" });

    const p = slot("push @launch-site");
    if (p?.kind !== "slot") throw new Error("expected a slot");
    expect(p.input).toMatchObject({ title: "push", project_id: "P1", domain_id: "D1" });
  });

  it("takes a picked domain when nothing was typed, and typed @home over it", () => {
    const picked = slot("errands", { domainId: "D9" });
    expect(picked?.kind === "slot" && picked.input.domain_id).toBe("D9");
    const typed = slot("errands @work", { domainId: "D9" });
    expect(typed?.kind === "slot" && typed.input.domain_id).toBe("D1");
  });

  it("an unmatched @token stays in the title rather than vanishing", () => {
    const a = slot("prep @nowhere");
    expect(a?.kind === "slot" && a.input.title).toBe("prep @nowhere");
  });

  it("is unnamed, not titled by its own tokens, when only a time was typed", () => {
    const a = slot("9am 2h @work");
    expect(a?.kind === "slot" && a.input.title).toBe("");
  });

  it("a cadence makes a standing slot series at the typed time", () => {
    const a = slot("deep work every weekday 9am 2h @work");
    expect(a?.kind).toBe("slot-series");
    if (a?.kind !== "slot-series") return;
    expect(a.template).toMatchObject({
      title: "deep work",
      duration_minutes: 120,
      time_of_day_minutes: 9 * 60,
      domain_id: "D1",
      color: "#123456",
    });
  });

  it("is never made without a clock", () => {
    expect(slot("deep work", { start: null })).toBeNull();
  });
});
