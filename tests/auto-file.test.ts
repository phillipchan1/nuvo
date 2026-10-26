// The Inbox row's automatic filing: a domain Nuvo WROTE is a fact with an Undo,
// never a proposal with an Accept — and every verdict the person gives is
// stamped on the guess, because that stamp is the router's only feedback.

import { describe, expect, it } from "vitest";
import { acceptPatch, autoFiled, dismissPatch, liveSuggestion, suggestionSig, undoAutoPatch } from "../src/lib/grooming";
import type { InboxSuggestion, Task } from "../src/lib/types";

const sugg = (over: Partial<InboxSuggestion> = {}): InboxSuggestion => ({
  sig: suggestionSig("Plan Easter setup", ""),
  level: "domain",
  targetId: "d-front",
  targetLabel: "Frontier",
  domainId: "d-front",
  domainColor: "#445",
  durationMinutes: null,
  energy: null,
  rationale: "",
  confidence: 0.91,
  engine: "decisions",
  ...over,
});

const task = (over: Partial<Task> = {}): Task =>
  ({ id: "t1", title: "Plan Easter setup", notes: "", status: "inbox", project_id: null, initiative_id: null, domain_id: "d-front", suggestion: sugg({ auto: true }), ...over }) as Task;

describe("an automatic filing", () => {
  it("is read as filed, never offered as a proposal", () => {
    expect(autoFiled(task())?.targetLabel).toBe("Frontier");
    expect(liveSuggestion(task())).toBeNull();
  });

  it("a proposal below the bar is still a proposal", () => {
    const t = task({ domain_id: null, suggestion: sugg({ auto: undefined, confidence: 0.62 }) });
    expect(autoFiled(t)).toBeNull();
    expect(liveSuggestion(t)?.targetLabel).toBe("Frontier");
  });

  it("stops being offered once the person moves it by hand", () => {
    expect(autoFiled(task({ domain_id: "d-sce" }))).toBeNull();
  });

  it("stops being offered once the words change under it", () => {
    expect(autoFiled(task({ title: "Something else entirely" }))).toBeNull();
  });

  it("stops being offered once triaged out of the Inbox, or once reviewed", () => {
    expect(autoFiled(task({ status: "backlog" }))).toBeNull();
    expect(autoFiled(task({ suggestion: sugg({ auto: true, outcome: "confirmed" }) }))).toBeNull();
    expect(autoFiled(task({ suggestion: sugg({ auto: true, dismissed: true }) }))).toBeNull();
  });
});

describe("the verdicts the router learns from", () => {
  it("undo takes the domain back off and records the miss", () => {
    const p = undoAutoPatch(task());
    expect(p.domain_id).toBeNull();
    expect(p.suggestion).toMatchObject({ dismissed: true, outcome: "undone", auto: true });
  });

  it("accepting a proposal is recorded as accepted", () => {
    const t = task({ domain_id: null, suggestion: sugg({ auto: undefined, confidence: 0.62 }) });
    const p = acceptPatch(t);
    expect(p.domain_id).toBe("d-front");
    expect(p.suggestion).toMatchObject({ dismissed: true, outcome: "accepted" });
  });

  it("dismissing a proposal is recorded as rejected, and files nothing", () => {
    const t = task({ domain_id: null, suggestion: sugg({ auto: undefined, confidence: 0.62 }) });
    const p = dismissPatch(t);
    expect(p).toEqual({ suggestion: expect.objectContaining({ dismissed: true, outcome: "rejected" }) });
    expect("domain_id" in p).toBe(false);
  });
});
