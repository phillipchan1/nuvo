// Keyboard-operability gate.
//
// The regression net for the "focusable but unreachable" class of bug: a row
// that opens on click and does nothing on Enter, an action that only exists
// while a pointer hovers it, a menu with no way out but the mouse. Every one of
// those is invisible to a typecheck and to every other test in this suite —
// the app renders, the logic is right, and the keyboard simply cannot get
// there. They were found by hand once (see the keyboard audit); this is what
// stops them coming back.
//
// Reads the deployed source, never a copy — same contract as the token-contrast
// gate next door.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const FILES = walk(SRC);
const rel = (p: string) => p.slice(p.indexOf("/src/") + 1);

/**
 * Every opening tag of a non-interactive element, with its full attribute list
 * however many lines it spans. Brace-aware, because JSX attributes routinely
 * contain `>` inside expressions (`onClick={() => x > 1 && f()}`), which is
 * what a regex for `<div ...>` gets wrong.
 */
function nonInteractiveTags(src: string) {
  const tags: { line: number; attrs: string }[] = [];
  const re = /<(div|span|li|td|tr|section|article|header|footer)\s/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = re.lastIndex;
    let depth = 0;
    let end = -1;
    while (i < src.length) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (depth === 0 && c === ">") { end = i; break; }
      else if (depth === 0 && c === "<") break;
      i++;
    }
    if (end === -1) continue;
    tags.push({ line: src.slice(0, m.index).split("\n").length, attrs: src.slice(m.index, end) });
  }
  return tags;
}

describe("keyboard operability", () => {
  it("no clickable div/span without a keyboard path", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      for (const { line, attrs } of nonInteractiveTags(src)) {
        if (!/\bonClick=/.test(attrs)) continue;
        // A full-screen scrim is a click-outside dismiss, not a control. Its
        // keyboard equivalent is Escape, which `useEscape` owns.
        if (/fixed inset-0/.test(attrs)) continue;
        // A wrapper whose only job is to stop a click reaching the row beneath
        // it isn't a control either — there is nothing to activate.
        if (/onClick=\{\(e\)\s*=>\s*e\.stopPropagation\(\)\}/.test(attrs)) continue;
        const reachable = /\bonKeyDown=|\bonKeyUp=|\bpressable\(/.test(attrs);
        if (!reachable) offenders.push(`${rel(f)}:${line}`);
      }
    }
    expect(
      offenders,
      `These elements open something on click but do nothing on Enter/Space. Spread ` +
        `\`pressable()\` from src/lib/a11y.ts onto them, or make them a <button>.\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the focus ring is defined once, on :focus-visible, and nothing globally suppresses it", () => {
    const css = readFileSync(join(SRC, "index.css"), "utf8");
    // The ring itself.
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--ring\)/);
    // `:focus` (not `:focus-visible`) would paint the ring for mouse users too,
    // which is the flat outline the design language spends its focus budget
    // avoiding. Any bare `outline: <n>px solid` on a plain `:focus` is a bug.
    const bareFocusOutline = /(?<!-visible)\s*:focus\s*\{[^}]*outline:\s*\d/.test(css);
    expect(bareFocusOutline, "focus ring must be :focus-visible, not :focus").toBe(false);
  });

  it("hover-revealed controls come back on keyboard focus", () => {
    const css = readFileSync(join(SRC, "index.css"), "utf8");
    // Row actions are `opacity-0 group-hover:opacity-100`. Without these rules
    // they stay focusable and invisible — a tab stop you cannot see.
    expect(css).toMatch(/\.opacity-0:focus-within/);
    expect(css).toMatch(/:focus-within\s+\.opacity-0/);
  });

  it("every popover with a dismiss scrim can also be dismissed by Escape", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      const hasScrim = /fixed inset-0[^>]*onClick/.test(src);
      if (!hasScrim) continue;
      // Either an inline Escape handler or the shared hook satisfies this.
      if (/["']Escape["']|useEscape\(|useDialogFocus\(/.test(src)) continue;
      offenders.push(rel(f));
    }
    expect(
      offenders,
      `These surfaces can be dismissed with the mouse but not the keyboard — a ` +
        `keyboard trap (WCAG 2.1.2). Add \`useEscape\` from src/hooks/useEscape.ts.\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the desktop has a pointer-target floor to reach for", () => {
    // WCAG 2.2 SC 2.5.8 is 24×24 regardless of input device, but `.tap` and
    // `.tap-bloom` are deliberately scoped to phones (a 44px bloom on a desk
    // swallows the row around it), which left the desktop with no floor at all
    // — 51 sub-24px controls on a single Week view. These are the classes a
    // desktop control reaches for; deleting them silently re-opens that hole.
    const css = readFileSync(join(SRC, "index.css"), "utf8");
    for (const cls of [".tap-desk", ".tap-desk-h", ".tap-desk-bloom"]) {
      expect(css, `${cls} missing — the desktop target floor`).toContain(cls);
    }
    // The floor must live OUTSIDE the phone-only block, or it isn't a desktop
    // floor at all — which was the original bug, one level up.
    const desktopBlock = css.slice(css.indexOf("@media (min-width: 768px)"));
    expect(desktopBlock).toMatch(/\.tap-desk\s*\{[^}]*min-height:\s*24px/);
    expect(desktopBlock).toMatch(/\.tap-desk\s*\{[^}]*min-width:\s*24px/);
  });

  it("no interactive element declares a sub-24px box on the desktop step", () => {
    // The `md:` step is the desktop one. A control that explicitly shrinks
    // itself there (`md:h-4`, `md:min-h-0`, `md:h-[13px]`) is opting out of the
    // floor on purpose, so it has to say so by carrying a hit-area class.
    // Trailing boundary is `(?![\w.-])` rather than `\b`: after a `]` there is
    // no word boundary before the closing quote, so a `\b` here silently let
    // every `md:h-[13px]` through — a gate that matched nothing.
    const SMALL =
      /\bmd:(?:min-)?h-(?:\[(?:[0-9]|1[0-9]|2[0-3])(?:\.\d+)?px\]|(?:0|px|0\.5|1|1\.5|2|2\.5|3|3\.5|4|4\.5|5)(?![\w.-]))/;
    const EXEMPT = /tap-desk|tap-bloom|tap-h|\btap\b/;
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      const re = /<button\s/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        // Same brace-aware scan the tag reader above uses.
        let i = re.lastIndex, depth = 0, end = -1;
        while (i < src.length) {
          const c = src[i];
          if (c === "{") depth++;
          else if (c === "}") depth--;
          else if (depth === 0 && c === ">") { end = i; break; }
          i++;
        }
        if (end === -1) continue;
        const attrs = src.slice(m.index, end);
        if (!SMALL.test(attrs) || EXEMPT.test(attrs)) continue;
        offenders.push(`${rel(f)}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(
      offenders,
      `These buttons shrink below 24px at the desktop breakpoint without a hit-area ` +
        `class. Add \`tap-desk\`/\`tap-desk-h\`/\`tap-desk-bloom\` (src/index.css), or ` +
        `raise the box.\n` + offenders.join("\n"),
    ).toEqual([]);
  });

  it("interactive ARIA roles carry real keyboard handling", () => {
    // A role is a promise to assistive tech about how the thing behaves. A
    // `role="button"` that ignores Enter is worse than no role at all: it tells
    // a screen-reader user to press a key that does nothing.
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      for (const { line, attrs } of nonInteractiveTags(src)) {
        const role = attrs.match(/role="(button|menuitem|option|switch|tab|checkbox|radio)"/);
        if (!role) continue;
        if (/\bonKeyDown=|\bonKeyUp=|\bpressable\(/.test(attrs)) continue;
        offenders.push(`${rel(f)}:${line} role=${role[1]}`);
      }
    }
    expect(offenders, `role without matching keyboard behaviour:\n${offenders.join("\n")}`).toEqual(
      [],
    );
  });
});
