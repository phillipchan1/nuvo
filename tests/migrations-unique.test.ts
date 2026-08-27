/**
 * One version number, one migration file.
 *
 * `supabase db push` tracks what it has applied by the VERSION PREFIX, not by
 * filename or content. Two files sharing a prefix means the first one applied
 * marks that version done and the second is skipped — forever, with no error
 * and no diff: `db push` reports success and `migration list` shows the version
 * as applied. That is exactly how `00000000000071_plan_source.sql` never
 * reached production while an untracked `00000000000071_review_account_otp.sql`
 * held the same number. The shell's subscription read then asked for a computed
 * column that did not exist, PostgREST 400'd it (42703) on every launch, and
 * the phone toasted a failure every five seconds — through three attempts to
 * "re-deploy" a migration the CLI was quietly refusing to run.
 *
 * A collision is invisible at the moment it is created and expensive later.
 * This is the check that makes it loud.
 */
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = new URL("../supabase/migrations/", import.meta.url).pathname;

function migrationFiles(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

describe("supabase/migrations", () => {
  it("has at least one migration to check", () => {
    expect(migrationFiles().length).toBeGreaterThan(0);
  });

  it("names every file <version>_<slug>.sql", () => {
    const bad = migrationFiles().filter((f) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(f));
    expect(bad, `unparseable migration filenames: ${bad.join(", ")}`).toEqual([]);
  });

  it("never lets two files claim the same version", () => {
    const byVersion = new Map<string, string[]>();
    for (const file of migrationFiles()) {
      const version = file.slice(0, 14);
      byVersion.set(version, [...(byVersion.get(version) ?? []), file]);
    }
    const collisions = [...byVersion.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([version, files]) => `${version}: ${files.join(" + ")}`);
    expect(
      collisions,
      `Two migrations share a version. \`db push\` will silently skip all but ` +
        `the first — renumber the one that has NOT been applied yet:\n  ${collisions.join("\n  ")}`,
    ).toEqual([]);
  });
});
