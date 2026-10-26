import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ALLOWED_UPLOAD_ARTIFACT_PATHS,
  assertCutoverLogDir,
  assertSafeMigrateLog,
  assertStagedUpload,
  assertWorkflowUploadAllowlist,
  assertWorkflowsUploadAllowlist,
  assertWorkspaceHasNoDataFiles,
  extractUploadArtifactSteps,
  findForbiddenUploadCommands,
  lineLooksLikeHttpUpload,
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

  it("rejects quoted uses and upload-artifact/merge", () => {
    expect(() =>
      assertWorkflowUploadAllowlist(
        "uses: 'actions/upload-artifact@sha'\n        with:\n          path: leak.dump\n",
        "quoted.yml",
      ),
    ).toThrow(/leak\.dump/);
    expect(() =>
      assertWorkflowUploadAllowlist(
        'uses: "actions/upload-artifact@sha"\n        with:\n          path: leak.dump\n',
        "dquoted.yml",
      ),
    ).toThrow(/leak\.dump/);
    expect(() =>
      assertWorkflowUploadAllowlist("uses: actions/upload-artifact/merge@sha\n", "merge.yml"),
    ).toThrow(/upload-artifact\/merge/);
    const quotedOk = extractUploadArtifactSteps(
      "uses: 'actions/upload-artifact@sha'\n        with:\n          path: artifacts/cutover-report.md\n",
    );
    expect(quotedOk[0]?.path).toBe("artifacts/cutover-report.md");
    assertWorkflowUploadAllowlist(
      "uses: 'actions/upload-artifact@sha'\n        with:\n          path: artifacts/cutover-report.md\n",
      "ok.yml",
    );
  });

  it("rejects gh release upload and curl/wget upload flags", () => {
    expect(findForbiddenUploadCommands("gh release upload v1 secret.dump\n")).toEqual([
      { line: 1, kind: "gh release upload" },
    ]);
    expect(lineLooksLikeHttpUpload("curl -T secret.dump https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload("curl --upload-file secret.dump https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload("curl -F @secret.dump https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload("curl --data-binary @secret.dump https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload("wget --upload-file=secret.dump https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload("wget -T 30 https://example.com")).toBe(false);
    expect(() =>
      assertWorkflowUploadAllowlist("run: gh release upload v1 secret.dump\n", "gh.yml"),
    ).toThrow(/gh release upload/);
    expect(() =>
      assertWorkflowUploadAllowlist("run: curl -T secret.dump https://example.com\n", "curl.yml"),
    ).toThrow(/curl\/wget upload/);
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

  it("asserts teed cutover logs and fails on row data", () => {
    const dir = tmp();
    expect(assertCutoverLogDir(join(dir, "missing"))).toEqual([]);
    writeFileSync(join(dir, "dump.log"), "verified backup: 12 bytes sha256=abc (runner only, not uploaded)\n");
    expect(assertCutoverLogDir(dir)).toEqual(["dump.log"]);
    writeFileSync(join(dir, "restore.log"), "auth map leaked phil@example.com\n");
    expect(() => assertCutoverLogDir(dir)).toThrow(/row data/);
  });

  it("cutover workflow never uploads a dump and always shreds", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/cutover-migrate.yml"), "utf8");
    expect(workflow).not.toMatch(/nuvo-source-dump/);
    expect(workflow).toMatch(/NEVER upload/);
    expect(workflow).toMatch(/CUTOVER_DUMP_DIR/);
    expect(workflow).toMatch(/CUTOVER_LOG_DIR/);
    expect(workflow).toMatch(/migration_tmp\.auth_users\(\)/);
    expect(workflow).toMatch(/migration_tmp\.auth_identities\(\)/);
    expect(workflow).toMatch(/AUTH_USERS_SRC_HASH_SQL/);
    expect(workflow).toMatch(/AUTH_IDENT_DST_HASH_SQL/);
    expect(workflow).toMatch(/auth_parity/);
    expect(workflow).toMatch(/name: Shred dumps/);
    expect(workflow).toMatch(/id: guard/);
    expect(workflow).toMatch(/steps\.guard\.outcome == 'success'/);
    expect(workflow).toMatch(/--check-log/);
    expect(workflow).toMatch(/\|\s*tee "/);
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
    expect(doc).toMatch(/cloudflare-migration\/migration_tmp\.sql/);
    expect(doc).toMatch(/SECURITY DEFINER/);
    expect(doc).toMatch(/migration_reader/);
    expect(doc).toMatch(/DROP SCHEMA migration_tmp CASCADE/);
    expect(doc).toMatch(/Engineer 3/);
    expect(doc).toMatch(/public,graphql_public/);
    expect(doc).not.toMatch(/dump is uploaded/);
    expect(doc).toMatch(/never uploaded/);
    expect(doc).toMatch(/cutover-report\.md/);
  });

  it("commits the live prod function bodies outside supabase/migrations", () => {
    const sql = readFileSync(join(ROOT, "docs/cloudflare-migration/migration_tmp.sql"), "utf8");
    expect(sql).toMatch(/CREATE SCHEMA IF NOT EXISTS migration_tmp/);
    expect(sql).toContain(
      "SELECT u.id, pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('name', u.raw_user_meta_data->>'name', 'full_name', u.raw_user_meta_data->>'full_name')), u.email::text, u.email_confirmed_at, u.created_at, u.updated_at FROM auth.users u",
    );
    expect(sql).toContain(
      "SELECT i.id, i.user_id, i.provider::text, pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('sub', i.identity_data->>'sub', 'provider_id', i.identity_data->>'provider_id')), i.provider_id::text, i.created_at, i.updated_at FROM auth.identities i",
    );
    expect(sql).toMatch(/SET search_path TO ''/);
    expect(sql).toMatch(/ALTER FUNCTION migration_tmp\.auth_users\(\) OWNER TO postgres/);
    expect(sql).toMatch(/ALTER FUNCTION migration_tmp\.auth_identities\(\) OWNER TO postgres/);
    expect(sql).toMatch(/REVOKE ALL ON SCHEMA migration_tmp FROM PUBLIC/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION migration_tmp\.auth_users\(\)/);
    expect(sql).toMatch(/GRANT USAGE ON SCHEMA migration_tmp TO migration_reader/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION migration_tmp\.auth_users\(\) TO migration_reader/);
    expect(sql).toMatch(/DROP SCHEMA migration_tmp CASCADE/);
    expect(sql).toMatch(/Engineer 3/);
    expect(sql).toMatch(/public,graphql_public/);
    expect(sql).toMatch(/has_function_privilege\('migration_reader'/);
    expect(sql).not.toMatch(/encrypted_password|recovery_token|confirmation_token/);
    const migrations = readFileSync(join(ROOT, "docs/cloudflare-migration/migration_tmp.sql"), "utf8");
    expect(migrations).toMatch(/NOT a supabase\/migrations file/);
  });
});
