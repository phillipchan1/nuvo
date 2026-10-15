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

describe("the memo's deps don't tick one callback away", () => {
  /** A hook declaration's own dependency array — the `[...]` that closes it. */
  function depsOf(name: string): string[] | null {
    const decl = SRC.match(new RegExp(`const ${name} = (useCallback|useMemo)\\(`));
    if (!decl || decl.index === undefined) return null;
    // Walk to the matching close paren of the hook call, then read its last `[…]`.
    let depth = 0;
    let i = SRC.indexOf("(", decl.index);
    for (; i < SRC.length; i++) {
      if (SRC[i] === "(") depth++;
      else if (SRC[i] === ")" && --depth === 0) break;
    }
    const call = SRC.slice(decl.index, i);
    const open = call.lastIndexOf("[");
    return call
      .slice(open + 1, call.lastIndexOf("]"))
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
  }

  // `onFcResizeStop` was a `useCallback([resumeGridSync])`, and `resumeGridSync`
  // a `useCallback([now])` — "stable" by declaration, so the check above passed,
  // while the whole <FullCalendar> was re-created on every 30s clock tick.
  it("no memo dep (followed one level through useCallback/useMemo) depends on the clock", () => {
    const { deps } = readCalendarMemo();
    const ticking = ["now", "fcNow"];
    const seen = new Set<string>();
    const walk = (name: string, via: string[]) => {
      if (seen.has(name)) return;
      seen.add(name);
      const inner = depsOf(name);
      if (!inner) return;
      for (const d of inner) {
        expect(ticking, `${[...via, name, d].join(" → ")} — a ticking value reaches the calendar element`).not.toContain(d);
        walk(d, [...via, name]);
      }
    };
    for (const d of deps) walk(d, []);
  });
});

describe("the grid's block selection never rebuilds the calendar (D-156)", () => {
  it("is painted (eventClassNames off a ref + a class toggle), never a memo dep", () => {
    const { jsx, deps } = readCalendarMemo();
    expect(jsx).toContain("eventClassNames={blockClassNames}");
    for (const live of ["gridCursor", "gridSelected", "draft", "renaming", "gridRows"]) {
      expect(deps, `\`${live}\` must not be a dependency of the calendar element memo`).not.toContain(live);
    }
    // The class callback reads the selection through a ref and has no deps of
    // its own — a dep there would rebuild the element on every click.
    const decl = SRC.match(/const blockClassNames = useCallback\([\s\S]*?\n {2}\}, \[\]\);/);
    expect(decl, "blockClassNames must be useCallback(…, [])").not.toBeNull();
    expect(decl![0]).toContain("gridSelRef.current");
  });
});
