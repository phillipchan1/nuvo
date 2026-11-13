import { describe, expect, it } from "vitest";
import { composeOffers, hasUnseen, isSnoozed, MEMORY_OFFERS_MAX, OFFERS_MAX, SNOOZE_DAYS } from "../src/lib/nuvoOffers";
import { onPathDraftRequest, requestPathDraft, takePathDraft } from "../src/lib/draftIntent";
import type { ThinPath } from "../src/lib/thinPath";

const thin = (id: string, name = id): ThinPath => ({
  projectId: id,
  name,
  domainId: "d",
  heldMins: 180,
  workMins: 20,
  openSteps: 1,
  first: { dateISO: "2026-11-17", startISO: "2026-11-17T13:00:00Z", durationMins: 180 },
});
const mem = (k: string) => ({ key: k, statement: `${k} statement`, evidence: "7 of 8 weeks", keep: `keeps ${k}` });
const NOW = Date.parse("2026-11-13T12:00:00Z");

describe("the Nuvo panel's offers (D-198)", () => {
  it("names a ledger row on every offer", () => {
    const offers = composeOffers({ thin: [thin("a")], memory: [mem("m1")], now: NOW });
    expect(offers.map((o) => o.row)).toEqual(["Q4", "W1"]);
  });

  it("is a few at most, never a queue", () => {
    const offers = composeOffers({ thin: [thin("a"), thin("b")], memory: [mem("1"), mem("2"), mem("3")], now: NOW });
    expect(offers.length).toBe(OFFERS_MAX);
    expect(offers.filter((o) => o.kind === "memory").length).toBeLessThanOrEqual(MEMORY_OFFERS_MAX);
  });

  it("on a project, offers only that project's path — Memory waits", () => {
    const offers = composeOffers({ thin: [thin("a"), thin("b")], memory: [mem("1")], projectId: "b", now: NOW });
    expect(offers.map((o) => o.key)).toEqual(["path:b"]);
    expect(composeOffers({ thin: [thin("a")], memory: [mem("1")], projectId: "zzz", now: NOW })).toEqual([]);
  });

  it("an empty account offers nothing (P7)", () => {
    expect(composeOffers({ thin: [], memory: [], now: NOW })).toEqual([]);
  });

  it("Not now holds for two weeks, then the offer may come back", () => {
    const at = new Date(NOW).toISOString();
    expect(isSnoozed("path:a", { "path:a": at }, NOW + 1000)).toBe(true);
    expect(isSnoozed("path:a", { "path:a": at }, NOW + SNOOZE_DAYS * 86_400_000 + 1)).toBe(false);
    const offers = composeOffers({ thin: [thin("a"), thin("b")], memory: [], snoozed: { "path:a": at }, now: NOW });
    expect(offers.map((o) => o.key)).toEqual(["path:b"]);
  });

  it("the door's dot is one bit, spent by seeing", () => {
    const offers = composeOffers({ thin: [thin("a")], memory: [mem("1")], now: NOW });
    expect(hasUnseen(offers, [])).toBe(true);
    expect(hasUnseen(offers, offers.map((o) => o.key))).toBe(false);
  });

  it("speaks only from two facts, never a score", () => {
    const [o] = composeOffers({ thin: [thin("a", "Launch site")], memory: [], now: NOW });
    expect(o.statement).toContain("Launch site");
    expect(o.evidence).toMatch(/held/);
    expect(`${o.statement} ${o.evidence}`).not.toMatch(/%|score/i);
  });
});

describe("a draft asked for while its list is on screen", () => {
  it("reaches a list that's already mounted", () => {
    const heard: string[] = [];
    const off = onPathDraftRequest((id) => heard.push(id));
    requestPathDraft("p1");
    off();
    requestPathDraft("p2");
    expect(heard).toEqual(["p1"]);
    expect(takePathDraft("p2")).toBe(true);
  });
});
