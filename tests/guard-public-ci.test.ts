import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ALLOWED_UPLOAD_ARTIFACT_PATHS,
  assertSafeMigrateLog,
  assertStagedUpload,
  assertWorkflowUploadAllowlist,
  assertWorkflowsUploadAllowlist,
  assertWorkspaceHasNoDataFiles,
  logLooksLikeRowData,
  looksLikeDataUpload,
} from "../scripts/guard-public-ci.mjs";

const ROOT = new URL("../", import.meta.url).pathname;
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), "nuvo-guard-"));
  temps.push(dir);
  return dir;
}

describe("public-repo CI guard", () => {
  it("allowlists only the checksum report", () => {
    expect(ALLOWED_UPLOAD_ARTIFACT_PATHS).toEqual(["artifacts/cutover-report.md"]);
  });

  it("accepts the committed workflows", () => {
    const steps = assertWorkflowsUploadAllowlist(join(ROOT, ".github/workflows"));
    expect(steps).toHaveLength(1);
    expect(steps[0]?.path).toBe("artifacts/cutover-report.md");
    expect(steps[0]?.file).toBe("cutover-migrate.yml");
  });

  it("rejects a dump upload", () => {
    expect(() =>
      assertWorkflowUploadAllowlist(
        "uses: actions/upload-artifact@sha\n        with:\n          path: secret.dump\n",
        "bad.yml",
      ),
    ).toThrow(/secret\.dump/);
  });

  it("rejects a multi-path dump + hash upload", () => {
    expect(() =>
      assertWorkflowUploadAllowlist(
        [
          "uses: actions/upload-artifact@sha",
          "        with:",
          "          path: |",
          "            artifacts/nuvo-source.dump",
          "            artifacts/nuvo-source.sha256",
          "",
        ].join("\n"),
        "dump.yml",
      ),
    ).toThrow(/nuvo-source\.dump/);
  });

  it("treats dump/CSV paths as data uploads, not the report", () => {
    expect(looksLikeDataUpload("artifacts/nuvo-source.dump")).toBe(true);
    expect(looksLikeDataUpload("artifacts/auth-users.csv")).toBe(true);
    expect(looksLikeDataUpload("artifacts/cutover-report.md")).toBe(false);
  });

  it("fails if anything other than the report is staged", () => {
    expect(() => assertStagedUpload(["artifacts/nuvo-source.dump"], { publicRepo: true })).toThrow(
      /public repo refuses data upload/,
    );
    expect(() => assertStagedUpload(["artifacts/cutover-report.md", "extra.csv"])).toThrow(
      /not allowlisted/,
    );
    expect(assertStagedUpload("artifacts/cutover-report.md", { publicRepo: true })).toEqual([
      "artifacts/cutover-report.md",
    ]);
  });

  it("fails when a dump sits in the workspace artifacts folder", () => {
    const dir = tmp();
    mkdirSync(join(dir, "artifacts"), { recursive: true });
    writeFileSync(join(dir, "artifacts", "cutover-report.md"), "# ok\n");
    assertWorkspaceHasNoDataFiles(dir);
    writeFileSync(join(dir, "artifacts", "nuvo-source.dump"), "not-a-real-dump");
    expect(() => assertWorkspaceHasNoDataFiles(dir)).toThrow(/nuvo-source\.dump/);
  });

  it("treats emails/CSV as row data and checksum tables as safe", () => {
    expect(logLooksLikeRowData("phil@example.com,not-a-real-hash")).toBe(true);
    expect(
      logLooksLikeRowData("| tasks | 1 | 1 | aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa |"),
    ).toBe(false);
    assertSafeMigrateLog("  tasks: source=1 target=1 hash aaa → aaa", "count/hash log");
    expect(() => assertSafeMigrateLog("id,email\naaaa,phil@example.com\n", "csv")).toThrow(
      /row data/,
    );
  });

  it("cutover workflow never uploads a dump and always shreds", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/cutover-migrate.yml"), "utf8");
    expect(workflow).not.toMatch(/nuvo-source-dump/);
    expect(workflow).toMatch(/NEVER upload/);
    expect(workflow).toMatch(/CUTOVER_DUMP_DIR/);
    expect(workflow).toMatch(/migration_tmp\.auth_users\(\)/);
    expect(workflow).toMatch(/migration_tmp\.auth_identities\(\)/);
    expect(workflow).toMatch(/name: Shred dumps/);
    expect(workflow).toMatch(/if:\s*\$\{\{\s*always\(\)\s*\}\}/);
    expect(workflow).toMatch(/shred/);
    expect(workflow).toMatch(/scripts\/guard-public-ci\.mjs --job/);
    expect(workflow).toMatch(/default_transaction_read_only=on/);
    expect(workflow).toMatch(/CUTOVER nuvo/);
    expect(workflow).not.toMatch(/SELECT COUNT\(\*\) FROM auth\.users/);
    expect(workflow).not.toMatch(/SELECT COUNT\(\*\) FROM auth\.identities/);
    expect(workflow).not.toMatch(/console\.log\([^)]*\.email/);
  });

  it("checks.yml runs the allowlist guard", () => {
    const checks = readFileSync(join(ROOT, ".github/workflows/checks.yml"), "utf8");
    expect(checks).toMatch(/scripts\/guard-public-ci\.mjs/);
  });

  it("cutover docs name migration_tmp and the post-cutover drop", () => {
    const doc = readFileSync(join(ROOT, "docs/cloudflare-cutover.md"), "utf8");
    expect(doc).toMatch(/migration_tmp\.auth_users\(\)/);
    expect(doc).toMatch(/migration_tmp\.auth_identities\(\)/);
    expect(doc).toMatch(/SECURITY DEFINER/);
    expect(doc).toMatch(/migration_reader/);
    expect(doc).toMatch(/DROP SCHEMA migration_tmp CASCADE/);
    expect(doc).not.toMatch(/dump is uploaded/);
    expect(doc).toMatch(/never uploaded/);
    expect(doc).toMatch(/cutover-report\.md/);
  });
});
