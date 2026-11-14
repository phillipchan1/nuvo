import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Overflow guards — the containers that held long, real text and grew to fit
 * it instead of wrapping or ellipsizing.
 *
 * A `display: grid` with no column template gets ONE implicit `auto` column,
 * and an auto column sizes to its content's max-content width. So one long
 * line — a domain name, a loose task's title, an intention — widened the whole
 * container: the record's property panel grew to 516px inside its 288px track
 * and put a horizontal scrollbar under the entire record; one long intention
 * widened a domain card past the wall; the sign-in door grew to 1091px.
 * `minmax(0, 1fr)` is the one column that is the container's width, never its
 * longest line's.
 *
 * The PageBar sheds by its own width (a container query), because the same
 * page is 900px wide with the panels folded and 360px with them open — a
 * window media query can't see that.
 */

const read = (p: string) => readFileSync(resolve(__dirname, "../src/styles", p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function rule(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, "m").exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

describe("single-column grids hold to their container's width", () => {
  it.each([
    ["kit.css", ".k-card"],
    ["documents.css", ".doc-props-inner"],
    ["statement.css", ".st-door"],
    ["statement.css", ".st-door-inner"],
  ])("%s %s declares grid-template-columns: minmax(0, 1fr)", (file, selector) => {
    expect(rule(read(file), selector)).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
});

describe("the PageBar sheds instead of clipping", () => {
  const kit = read("kit.css");
  it("is a size container", () => {
    expect(rule(kit, ".k-bar")).toMatch(/container:\s*k-bar\s*\/\s*inline-size/);
  });
  it("lets the breadcrumb give way before the acts", () => {
    expect(rule(kit, ".k-crumb")).toMatch(/flex:\s*0 1 auto/);
    expect(rule(kit, ".k-bar-actions")).toMatch(/flex:\s*none/);
  });
  it("has the three tiers", () => {
    for (const w of [760, 600, 480]) expect(kit).toMatch(new RegExp(`@container k-bar \\(max-width: ${w}px\\)`));
  });
});
