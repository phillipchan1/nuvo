// The routing kernel is the product decision, so its numbers are held here.
// Every case is a failure we either measured or would otherwise ship silently.

import { describe, expect, it } from "vitest";
import {
  BROAD_MIN_MISSES,
  DECISIONS_MODEL,
  EXEMPLARS_PER_DOMAIN,
  NO_HOME,
  PAIR_MIN,
  ROUTE_AUTO,
  ROUTE_DESCEND,
  ROUTE_SUGGEST,
  captureText,
  describeDomain,
  domainQuestion,
  domainRequest,
  homeRequest,
  pickExemplars,
  readChoice,
  readDomainVerdict,
  readHome,
  readRouting,
  tierFor,
  type RouteDomain,
  type RouteEvent,
} from "../supabase/functions/_shared/domainRouting";

const D: RouteDomain[] = [
  { id: "d-front", name: "Frontier", charter: "Executive pastor at a church.", context: { boundary: "Not SCE.", keywords: ["ministry", "giving"], entities: ["Frontier Church"] } },
  { id: "d-sce", name: "SCE", charter: "", context: { scope: "Day job leadership at an electric utility.", keywords: ["rollout"] } },
  { id: "d-fam", name: "Family" },
];

const answer = (choice: string, probs: Record<string, number>) => ({
  answers: [{ type: "choice", name: "domain", choice, probabilities: Object.entries(probs).map(([value, probability]) => ({ value, probability })), confidence: 0.9 }],
});

describe("thresholds", () => {
  it("keeps the measured ordering: auto above suggest, descent stricter than both", () => {
    expect(ROUTE_AUTO).toBe(0.8);
    expect(ROUTE_SUGGEST).toBe(0.5);
    expect(ROUTE_DESCEND).toBeGreaterThan(ROUTE_AUTO);
    expect(ROUTE_AUTO).toBeGreaterThan(ROUTE_SUGGEST);
  });

  it("tiers on the boundary exactly", () => {
    expect(tierFor(0.8)).toBe("auto");
    expect(tierFor(0.7999)).toBe("suggest");
    expect(tierFor(0.5)).toBe("suggest");
    expect(tierFor(0.4999)).toBe("none");
    expect(tierFor(0)).toBe("none");
    expect(tierFor(Number.NaN)).toBe("none");
  });
});

describe("what the classifier is asked", () => {
  it("leads a domain's description with its charter, then boundary and examples", () => {
    const text = describeDomain({ ...D[0], recent: ["Plan Easter setup"] });
    expect(text.startsWith("Frontier. Executive pastor at a church.")).toBe(true);
    expect(text).toContain("Not: Not SCE.");
    expect(text).toContain("Recent tasks here: Plan Easter setup.");
  });

  it("still describes a domain that has only a name (a stranger's fresh account, P16)", () => {
    expect(describeDomain(D[2])).toBe("Family.");
  });

  it("offers each domain by id, with no 'none' bucket", () => {
    const q = domainQuestion(D);
    expect(q.choices.map((c) => c.value)).toEqual(["d-front", "d-sce", "d-fam"]);
    expect(q.choices.some((c) => /none|other/i.test(c.value))).toBe(false);
  });

  it("builds the request against the model we measured", () => {
    const r = domainRequest(D, "Plan Easter setup");
    expect(r.model).toBe(DECISIONS_MODEL);
    expect(r.input).toBe("Plan Easter setup");
  });

  it("sends the title and the person's own note, nothing else", () => {
    expect(captureText("  Call   the plumber ", "  before  friday ")).toBe("Call the plumber\nbefore friday");
    expect(captureText("Deploy", "")).toBe("Deploy");
    expect(captureText("Deploy", null)).toBe("Deploy");
  });
});

describe("reading an answer", () => {
  it("takes the top of the distribution as the confidence, and tiers it", () => {
    const v = readDomainVerdict(answer("d-front", { "d-front": 0.91, "d-sce": 0.07, "d-fam": 0.02 }), D)!;
    expect(v).toEqual({ id: "d-front", probability: 0.91, tier: "auto" });
  });

  it("a middling answer is proposed, not written", () => {
    const v = readDomainVerdict(answer("d-sce", { "d-sce": 0.62, "d-front": 0.3, "d-fam": 0.08 }), D)!;
    expect(v.tier).toBe("suggest");
  });

  it("a weak answer carries no tier — nothing is shown", () => {
    const v = readDomainVerdict(answer("d-fam", { "d-fam": 0.34, "d-sce": 0.33, "d-front": 0.33 }), D)!;
    expect(v.tier).toBe("none");
  });

  it("a hallucinated id collapses to no verdict — never a filing", () => {
    expect(readDomainVerdict(answer("d-ghost", { "d-ghost": 0.99 }), D)).toBeNull();
  });

  it("survives a refusal, a missing answer and garbage", () => {
    expect(readDomainVerdict({ answers: [{ type: "refusal", name: "domain" }] }, D)).toBeNull();
    expect(readDomainVerdict({ answers: [] }, D)).toBeNull();
    expect(readDomainVerdict({}, D)).toBeNull();
    expect(readDomainVerdict(null, D)).toBeNull();
    expect(readDomainVerdict("nope", D)).toBeNull();
    expect(readChoice({ answers: [{ type: "predicate", name: "domain", probability: 1 }] }, "domain", new Set(["x"]))).toBeNull();
  });

  it("ignores an answer to a question we didn't ask", () => {
    const r = { answers: [{ type: "choice", name: "other", choice: "d-front", probabilities: [{ value: "d-front", probability: 1 }] }] };
    expect(readDomainVerdict(r, D)).toBeNull();
  });
});

describe("descending into a project", () => {
  const homes = [
    { id: "p-1", kind: "project" as const, name: "Freedom Group V2", outcome: "Launch in the fall" },
    { id: "i-1", kind: "initiative" as const, name: "Giving culture" },
  ];
  const home = (choice: string, p: number) => ({ answers: [{ type: "choice", name: "home", choice, probabilities: [{ value: choice, probability: p }] }] });

  it("always offers the 'just the area' escape hatch", () => {
    const q = homeRequest(homes, "Frontier", "Prep for Freedom Group").questions[0] as { choices: Array<{ value: string }> };
    expect(q.choices.at(-1)?.value).toBe(NO_HOME);
  });

  it("descends only when unmistakable", () => {
    expect(readHome(home("p-1", 0.95), homes)?.home.id).toBe("p-1");
    expect(readHome(home("p-1", 0.85), homes)).toBeNull(); // auto-strong, still not descent-strong
  });

  it("choosing the general option stays at the domain", () => {
    expect(readHome(home(NO_HOME, 0.99), homes)).toBeNull();
  });
});

describe("what teaches the router", () => {
  const t = (title: string, createdAt: string, domainId: string | null, extra: object = {}) => ({ title, createdAt, domainId, ...extra });

  it("takes the newest confirmed titles per domain, capped and de-duplicated", () => {
    const tasks = [
      t("Plan Easter setup", "2026-10-01", "d-front"),
      t("Draft giving moment", "2026-10-02", "d-front"),
      t("DRAFT GIVING MOMENT", "2026-10-03", "d-front"), // same title, other case
      ...Array.from({ length: 10 }, (_, i) => t(`bulk ${i}`, `2026-09-${10 + i}`, "d-front")),
    ];
    const got = pickExemplars(tasks).get("d-front")!;
    expect(got.length).toBe(EXEMPLARS_PER_DOMAIN);
    expect(got[0]).toBe("DRAFT GIVING MOMENT"); // newest first
    expect(got.filter((x) => x.toLowerCase() === "draft giving moment")).toHaveLength(1);
  });

  it("never learns from its own unreviewed guess, a trashed task, or an unfiled one", () => {
    const got = pickExemplars([
      t("auto guess", "2026-10-05", "d-sce", { autoUnconfirmed: true }),
      t("trashed", "2026-10-04", "d-sce", { trashed: true }),
      t("loose", "2026-10-03", null),
      t("real", "2026-10-02", "d-sce"),
    ]);
    expect(got.get("d-sce")).toEqual(["real"]);
    expect(got.has("")).toBe(false);
  });
});

describe("what the corrections say", () => {
  const ev = (suggestedId: string, finalId: string | null, outcome: RouteEvent["outcome"], title = "x"): RouteEvent => ({ title, suggestedId, finalId, outcome });

  it("needs a repeated wrong→right pair before it names one", () => {
    const events = Array.from({ length: PAIR_MIN - 1 }, (_, i) => ev("d-front", "d-sce", "corrected", `t${i}`));
    expect(readRouting(events).pairs).toHaveLength(0);
    const more = [...events, ev("d-front", "d-sce", "corrected", "t9")];
    const { pairs } = readRouting(more);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ fromId: "d-front", toId: "d-sce" });
    expect(pairs[0].titles.length).toBeGreaterThan(0);
  });

  it("flags a domain as broad only past both the count and the share", () => {
    // 3 misses in 20 = 15%: noticeable, not broad.
    const few = [
      ...Array.from({ length: BROAD_MIN_MISSES }, () => ev("d-fam", "d-sce", "corrected")),
      ...Array.from({ length: 17 }, () => ev("d-fam", "d-fam", "confirmed")),
    ];
    expect(readRouting(few).health.get("d-fam")?.broad).toBe(false);
    // 3 misses in 6 = 50%: broad.
    const broad = [
      ...Array.from({ length: BROAD_MIN_MISSES }, () => ev("d-fam", "d-sce", "corrected")),
      ...Array.from({ length: 3 }, () => ev("d-fam", "d-fam", "accepted")),
    ];
    const h = readRouting(broad).health.get("d-fam")!;
    expect(h.broad).toBe(true);
    expect(h.rate).toBeCloseTo(0.5);
  });

  it("a rejected suggestion counts against its domain but names no pair", () => {
    const events = Array.from({ length: 5 }, () => ev("d-fam", null, "rejected"));
    const r = readRouting(events);
    expect(r.pairs).toHaveLength(0);
    expect(r.health.get("d-fam")?.missed).toBe(5);
  });

  it("an undo with no new home still names the domain it left", () => {
    const events = Array.from({ length: PAIR_MIN }, (_, i) => ev("d-front", null, "undone", `u${i}`));
    expect(readRouting(events).pairs[0]).toMatchObject({ fromId: "d-front", toId: null });
  });

  it("hits never produce a pair", () => {
    expect(readRouting([ev("d-sce", "d-sce", "confirmed"), ev("d-sce", "d-sce", "accepted")]).pairs).toEqual([]);
  });
});
