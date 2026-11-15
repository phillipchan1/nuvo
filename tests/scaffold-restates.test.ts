// D-216: a draft never restates one of the person's own steps under a new name.
import { describe, expect, it } from "vitest";
import { restates } from "../supabase/functions/agent/scaffoldCore.ts";

describe("restates", () => {
  it("catches a step said again in other words", () => {
    expect(restates("Implement the pricing toggle to switch Annual vs Monthly correctly", "Wire the pricing toggle")).toBe(true);
    expect(restates("Write tier comparison table", "Write tier comparison")).toBe(true);
  });
  it("lets genuinely different work through", () => {
    expect(restates("QA pricing page on mobile", "Wire the pricing toggle")).toBe(false);
    expect(restates("Write tier-by-tier annual pricing labels and CTA microcopy", "Write tier comparison")).toBe(false);
    expect(restates("Define the onboarding success criteria", "Agree scope with Pastor Jen")).toBe(false);
  });
});
