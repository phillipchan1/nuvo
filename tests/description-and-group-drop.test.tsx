// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DescriptionHtml } from "../src/lib/descriptionHtml";

// Invite bodies are written for email. Google's fence and Teams' underscore
// rule are unbroken runs that used to push the event card's column sideways
// (a horizontal scrollbar inside the card); a plain-text body lost its line
// breaks. Reported on a live account, 2026-10-15.
describe("DescriptionHtml — invite bodies read in a narrow column", () => {
  it("draws Google's fence and Teams' underscore rule as rules, not as text", () => {
    const fence = "-::~:~::~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~::~:~::-";
    const { container } = render(
      <DescriptionHtml
        html={`Agenda<br>${fence}<br>Invitation from Google Calendar<br>${"_".repeat(80)}<br>Teams`}
        className="text-caption"
      />,
    );
    expect(container.querySelectorAll("hr")).toHaveLength(2);
    expect(container.textContent).not.toContain("-::~");
    expect(container.textContent).not.toContain("____");
    expect(container.textContent).toContain("Invitation from Google Calendar");
  });

  it("wraps anything left unbroken instead of widening its column", () => {
    const { container } = render(<DescriptionHtml html="a" className="text-caption" />);
    expect(container.querySelector("[class*='overflow-wrap:anywhere']")).not.toBeNull();
  });

  it("keeps a plain-text body's line breaks and still links its URLs", () => {
    const { container } = render(
      <DescriptionHtml html={"Line one\nJoin: https://zoom.us/j/123\nLine three"} className="text-caption" />,
    );
    expect(container.querySelectorAll("br").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://zoom.us/j/123");
  });
});

// Three Today rows selected and dragged onto the Inbox tab moved only the row
// under the pointer — the tab drop acted on one id. The group is captured when
// the drag starts (the calendar's drop has always done this) and every row in
// it takes the act, under one coalesce key (one toast, one ⌘Z). Driven on the
// dummy account: 3 moved, "3 tasks returned", one ⌘Z put all three back.
describe("rail: a multi-selection dropped on a tab moves the whole selection", () => {
  const rail = readFileSync(join(__dirname, "..", "src", "components", "LeftRail.tsx"), "utf8");
  it("captures the selection at drag start and acts on every row in it", () => {
    expect(rail).toMatch(/onDragStart: \(id\) => \{\s*tabDragGroupRef\.current = groupFor\(id\);/);
    expect(rail).toContain("const ids = tabDragGroupRef.current ?? [id];");
    expect(rail).toContain("rows.forEach((t) => act.run(t, coalesceKey));");
  });
});
