/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DomainMark from "../src/components/domain/DomainMark";
import { domainMarkSpec } from "../src/lib/domainMark";
import type { Domain } from "../src/lib/vertical";

const domain = {
  id: "domain-work",
  name: "Work",
  color: "#2563EB",
  icon: "briefcase",
  weeklyTargetHours: 8,
  weeks: [2, 4, 0, 8, 6, 5, 9, 7, 0, 3, 8, 10, 6],
  lastTouchedDays: 1,
} as Domain;

describe("domainMarkSpec", () => {
  it("combines the chosen symbol, color, and thirteen-week presence", () => {
    const spec = domainMarkSpec(domain);
    expect(spec.symbol).toBe("briefcase");
    expect(spec.color).toBe("#2563EB");
    expect(spec.weeks).toEqual(domain.weeks);
    expect(spec.target).toBe(8);
    expect(spec.seed).toBeGreaterThan(0);
  });

  it("pads malformed history without inventing activity", () => {
    const spec = domainMarkSpec({ ...domain, weeks: [4] });
    expect(spec.weeks).toEqual(new Array(13).fill(0));
  });
});

describe("DomainMark", () => {
  it("renders one accessible mark with one week node per week", () => {
    const { container } = render(<DomainMark spec={domainMarkSpec(domain)} size={96} />);
    expect(screen.getByRole("img", { name: "Domain mark" })).toBeTruthy();
    expect(container.querySelectorAll("[data-domain-week]")).toHaveLength(13);
    expect(container.querySelectorAll("svg")).toHaveLength(2);
  });
});
