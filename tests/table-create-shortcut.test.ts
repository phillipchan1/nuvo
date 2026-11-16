// Table create-shortcut copy must name the key that actually creates.
//
// Vera recertified #35 on live 2026-08-22: Table "+ new project" works; she
// will not patch the string. Projects → Table still said "Press N to create."
// N has no create handler (N is "plan for next week" on Inbox). Create is P
// (project) and I (initiative), plus the + new buttons. This file locks the
// blurbs to those keys so a future copy pass cannot re-invent N. Since D-189
// the key rides the "+ new" button as a keycap (`newKey`) rather than a
// sentence under the hero; the lock moved with it.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "src");
const rel = (p: string) => p.slice(p.indexOf("/src/") + 1);

function read(relPath: string) {
  return readFileSync(join(SRC, relPath), "utf8");
}

const TABLE_FLOORS = ["components/floors/OutlineFloor.tsx", "components/floors/Collection.tsx"] as const;

describe("Table create-shortcut copy", () => {
  // One Table at both altitudes since D-220: its "+ New" keycap is P for
  // projects and I for initiatives.
  it("the Table names P for projects and I for initiatives", () => {
    const table = read("components/floors/OutlineFloor.tsx");
    expect(table, `${rel("components/floors/OutlineFloor.tsx")} must name P / I`).toMatch(
      /altitude === "project" \? "P" : "I"/,
    );
  });

  it("Collection / Table floors do not advertise N as create", () => {
    for (const file of TABLE_FLOORS) {
      expect(read(file), `${file} must not say Press N to create`).not.toMatch(
        /Press[\s\S]{0,240}>N<\/kbd>[\s\S]{0,40}to create/i,
      );
    }
  });

  it("create stays on P / I — no N keybinding was invented", () => {
    const shell = read("components/AppShell.tsx");
    expect(shell, "P / I must stay the only create letters").toMatch(
      /if \(key !== "p" && key !== "i"\) return/,
    );
    expect(shell, "P must stay on new-project, I on new-initiative").toMatch(
      /openFloorModal\(key === "p" \? "new-project" : "new-initiative"\)/,
    );
  });
});
