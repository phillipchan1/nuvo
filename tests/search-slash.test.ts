// `/` is search's, app-wide (D-212). The rail's filter used to claim it
// whenever a row was selected, and the path draft claimed it while reviewing,
// so the same key opened search on one screen and something else on the next.
// One binding, in AppShell, in the capture phase — this fails on a second.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

// A bare `/` handled as a key: `e.key === "/"` (or `!==`), `case "/":`, or the Slash code.
const BINDS_SLASH = /key\s*[!=]==?\s*["'`]\/["'`]|case\s+["'`]\/["'`]\s*:|["'`]Slash["'`]/;

describe("`/` is reserved for search", () => {
  it("is bound in exactly one place — AppShell", () => {
    const owners = sources(SRC)
      .filter((f) => BINDS_SLASH.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f));
    expect(owners).toEqual(["src/components/AppShell.tsx"]);
  });

  it("listens in the capture phase, ahead of every list and card", () => {
    const shell = readFileSync(join(SRC, "components/AppShell.tsx"), "utf8");
    const at = shell.search(/if \(e\.key !== "\/"/);
    expect(at).toBeGreaterThan(-1);
    const effect = shell.slice(at, at + 900);
    expect(effect).toMatch(/stopImmediatePropagation\(\)/);
    expect(effect).toMatch(/addEventListener\("keydown", onKey, true\)/);
  });
});
