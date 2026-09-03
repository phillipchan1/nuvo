import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `@fullcalendar/react` does no prop diffing — componentDidUpdate calls
 * `calendar.resetOptions(this.props)` unconditionally, which re-runs the whole
 * sizing pass. Measured on a lived-in week, one React re-render of the pane cost
 * ~6,700 `getBoundingClientRect()` calls; memoizing the element cut that to
 * ~1,010 (and the remainder is a genuine width change).
 *
 * That win is invisible in every screenshot and silently reverts the moment
 * someone drops a live value into the memo's deps or un-memoizes a handler. So
 * the invariants are asserted against the source.
 */
const SRC = readFileSync(resolve(__dirname, "../src/components/CalendarPane.tsx"), "utf8");

/** The `<FullCalendar …/>` JSX and the dep array of the memo holding it. */
function readCalendarMemo(): { jsx: string; deps: string[] } {
  const start = SRC.indexOf("const calendarElement = useMemo(");
  expect(start, "CalendarPane must render <FullCalendar> through a `calendarElement` memo").toBeGreaterThan(-1);
  const jsxStart = SRC.indexOf("<FullCalendar", start);
  const jsxEnd = SRC.indexOf("/>", jsxStart) + 2;
  const depsStart = SRC.indexOf("[", jsxEnd);
  const depsEnd = SRC.indexOf("]", depsStart);
  return {
    jsx: SRC.slice(jsxStart, jsxEnd),
    deps: SRC.slice(depsStart + 1, depsEnd)
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
  };
}

describe("the FullCalendar element is insulated from unrelated re-renders", () => {
  it("renders <FullCalendar> inside the calendarElement memo, not inline in the return", () => {
    const { jsx } = readCalendarMemo();
    expect(jsx).toContain("<FullCalendar");
    // The return body must reference the memo rather than build the element again.
    const returnBody = SRC.slice(SRC.indexOf("const calendarElement = useMemo("));
    expect(returnBody).toContain("{calendarElement}");
    // Exactly one JSX opening tag — a second one means someone re-inlined it.
    expect(SRC.match(/<FullCalendar\n/g) ?? []).toHaveLength(1);
  });

  it("never lists a ticking or per-render value in the memo deps", () => {
    const { deps } = readCalendarMemo();
    // `fcNow` ticks every 30s; `view`/`settings` and the data arrays change
    // constantly. Any of them here rebuilds the element and re-measures the grid.
    const banned = ["fcNow", "now", "view", "settings", "tasks", "events", "slots", "slotTasks", "uiScale"];
    for (const b of banned) {
      expect(deps, `\`${b}\` must not be a dependency of the calendar element memo`).not.toContain(b);
    }
  });

  it("passes a hoisted plugins array, not a fresh literal", () => {
    const { jsx } = readCalendarMemo();
    expect(jsx).toContain("plugins={FC_PLUGINS}");
    expect(SRC).toMatch(/const FC_PLUGINS = \[/);
  });

  it("gives every FullCalendar handler a stable identity", () => {
    const { jsx, deps } = readCalendarMemo();
    // Props written as `prop={identifier}` — the ones whose identity decides
    // whether the element is rebuilt.
    const referenced = [...jsx.matchAll(/\s(\w+)=\{(\w+)\}/g)].map((m) => m[2]);
    const stableDecl = (name: string) =>
      new RegExp(`const ${name} = (useStableHandler|useCallback|useMemo)\\(`).test(SRC) ||
      new RegExp(`^(const|function) ${name}\\b`, "m").test(SRC);
    const literals = new Set(["true", "false", "undefined", "null"]);
    for (const name of new Set(referenced)) {
      // Literals, refs and the memo's own deps are stable by construction.
      if (literals.has(name) || /^\d/.test(name) || name.endsWith("Ref") || deps.includes(name)) continue;
      expect(stableDecl(name), `\`${name}\` is handed to <FullCalendar> but is not a stable value`).toBe(true);
    }
  });
});
