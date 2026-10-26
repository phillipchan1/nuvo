import { spawnSync } from "node:child_process";
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
  collectSteps,
  extractUploadArtifactSteps,
  findForbiddenUploadCommands,
  isAtFileToken,
  isDataUrlencodeFileArg,
  isLtFileToken,
  parseWorkflowDocument,
  lineLooksLikeCacheSave,
  lineLooksLikeGhApiInput,
  lineLooksLikeHttpUpload,
  logLooksLikeRowData,
  looksLikeDataUpload,
  tokenMentionsTool,
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

function runYaml(cmd: string) {
  return `run: ${JSON.stringify(cmd)}\n`;
}

function releasePublishYaml(createLine: string, assign = "NOTES=$(cat RELEASE_NOTES.md)") {
  return ["run: |", `  ${assign}`, `  ${createLine}`, ""].join("\n");
}

const DESKTOP_CREATE =
  'gh release create "$TAG" --repo "$RELEASES_REPO" --title t --notes "$NOTES" --latest "$DMG" "$STABLE_DMG" "$APPTAR" latest.json';

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
        "uses: actions/upload-artifact@sha\nwith:\n  path: secret.dump\n",
        "bad.yml",
      ),
    ).toThrow(/secret\.dump/);
  });

  it("rejects quoted uses and upload-artifact/merge", () => {
    expect(() =>
      assertWorkflowUploadAllowlist(
        "uses: 'actions/upload-artifact@sha'\nwith:\n  path: leak.dump\n",
        "quoted.yml",
      ),
    ).toThrow(/leak\.dump/);
    expect(() =>
      assertWorkflowUploadAllowlist(
        'uses: "actions/upload-artifact@sha"\nwith:\n  path: leak.dump\n',
        "dquoted.yml",
      ),
    ).toThrow(/leak\.dump/);
    expect(() =>
      assertWorkflowUploadAllowlist("uses: actions/upload-artifact/merge@sha\n", "merge.yml"),
    ).toThrow(/upload-artifact\/merge/);
    const quotedOk = extractUploadArtifactSteps(
      "uses: 'actions/upload-artifact@sha'\nwith:\n  path: artifacts/cutover-report.md\n",
    );
    expect(quotedOk[0]?.path).toBe("artifacts/cutover-report.md");
    assertWorkflowUploadAllowlist(
      "uses: 'actions/upload-artifact@sha'\nwith:\n  path: artifacts/cutover-report.md\n",
      "ok.yml",
    );
  });

  it("rejects gh release upload and curl/wget upload flags", () => {
    expect(findForbiddenUploadCommands(runYaml("gh release upload v1 secret.dump"))).toEqual([
      { line: 1, kind: "gh release upload" },
    ]);
    expect(lineLooksLikeHttpUpload("curl -T secret.dump https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload("curl --upload-file secret.dump https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload("curl -F @secret.dump https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload('curl -F "f=@secret.dump" https://example.com')).toBe(true);
    expect(lineLooksLikeHttpUpload("curl -F 'file=@secret.dump' https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload("curl --data @secret.dump https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload("curl --data-raw @secret.dump https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload("curl --data-binary @secret.dump https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload("wget --upload-file=secret.dump https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload("wget --post-file=secret.dump https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload("wget --body-file secret.dump https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload("wget -T 30 https://example.com")).toBe(false);
    expect(() =>
      assertWorkflowUploadAllowlist("run: gh release upload v1 secret.dump\n", "gh.yml"),
    ).toThrow(/gh release upload/);
    expect(() =>
      assertWorkflowUploadAllowlist("run: curl -T secret.dump https://example.com\n", "curl.yml"),
    ).toThrow(/curl\/wget upload/);
    expect(() =>
      assertWorkflowUploadAllowlist('run: curl -F "f=@secret.dump" https://example.com\n', "form.yml"),
    ).toThrow(/curl\/wget upload/);
    expect(() =>
      assertWorkflowUploadAllowlist("run: curl --data @secret.dump https://example.com\n", "data.yml"),
    ).toThrow(/curl\/wget upload/);
    expect(() =>
      assertWorkflowUploadAllowlist("run: curl --data-raw @secret.dump https://example.com\n", "raw.yml"),
    ).toThrow(/curl\/wget upload/);
    expect(() =>
      assertWorkflowUploadAllowlist("run: wget --post-file secret.dump https://example.com\n", "post.yml"),
    ).toThrow(/curl\/wget upload/);
    expect(() =>
      assertWorkflowUploadAllowlist("run: wget --body-file=secret.dump https://example.com\n", "body.yml"),
    ).toThrow(/curl\/wget upload/);
  });

  it("rejects curl -d @file and --data-* @ forms", () => {
    const cmds = [
      "curl -d @file https://example.com",
      'curl -d "@file" https://example.com',
      "curl -d@file https://example.com",
      "curl --data-binary @file https://example.com",
      "curl --data-raw @file https://example.com",
      "curl --data-urlencode @file https://example.com",
      "curl --data-binary=@file https://example.com",
      "curl --data-raw=@file https://example.com",
      "curl --data-urlencode=@file https://example.com",
    ];
    for (const cmd of cmds) {
      expect(lineLooksLikeHttpUpload(cmd), cmd).toBe(true);
      expect(() => assertWorkflowUploadAllowlist(`run: ${cmd}\n`, "d.yml"), cmd).toThrow(
        /curl\/wget upload/,
      );
    }
    expect(isAtFileToken("@file")).toBe(true);
    expect(isAtFileToken("-d@file")).toBe(true);
    expect(isAtFileToken("x=@file")).toBe(true);
    expect(isAtFileToken("user@host")).toBe(false);
    expect(isAtFileToken("postgres@127.0.0.1")).toBe(false);
    expect(isAtFileToken("email=a@b.com")).toBe(false);
    expect(lineLooksLikeHttpUpload("curl -d email=a@b.com https://example.com")).toBe(false);
  });

  it("rejects gh release create files, gist, api @file, and third-party release actions", () => {
    expect(findForbiddenUploadCommands(runYaml("gh release create v1 secret.dump"))).toEqual([
      { line: 1, kind: "gh release create" },
    ]);
    expect(findForbiddenUploadCommands(runYaml("gh gist create secret.dump"))).toEqual([
      { line: 1, kind: "gh gist create" },
    ]);
    expect(findForbiddenUploadCommands(runYaml("gh api -F x=@file repos/o/r"))).toEqual([
      { line: 1, kind: "gh @file" },
    ]);
    expect(findForbiddenUploadCommands(runYaml("gh api -f x=@file repos/o/r"))).toEqual([
      { line: 1, kind: "gh @file" },
    ]);
    expect(findForbiddenUploadCommands(runYaml('gh api -F "x=@file" repos/o/r'))).toEqual([
      { line: 1, kind: "gh @file" },
    ]);
    expect(() =>
      assertWorkflowUploadAllowlist(
        "uses: ncipollo/release-action@v1\nwith:\n  artifacts: secret.dump\n",
        "ncipollo.yml",
      ),
    ).toThrow(/ncipollo\/release-action/);
    expect(() =>
      assertWorkflowUploadAllowlist(
        "uses: svenstaro/upload-release-action@v2\nwith:\n  file: secret.dump\n",
        "sven.yml",
      ),
    ).toThrow(/svenstaro\/upload-release-action/);
    expect(() =>
      assertWorkflowUploadAllowlist("run: gh release create v1 secret.dump\n", "create.yml"),
    ).toThrow(/gh release create/);
    expect(() =>
      assertWorkflowUploadAllowlist("run: gh gist create secret.dump\n", "gist.yml"),
    ).toThrow(/gh gist create/);
    expect(() =>
      assertWorkflowUploadAllowlist("run: gh api -F x=@file repos/o/r\n", "field.yml"),
    ).toThrow(/gh @file/);
    const desktopPublish = releasePublishYaml(DESKTOP_CREATE);
    expect(findForbiddenUploadCommands(desktopPublish, "release.yml")).toEqual([]);
    expect(findForbiddenUploadCommands(desktopPublish, "cutover-migrate.yml")).toEqual([
      { line: 2, kind: "gh release create" },
    ]);
    expect(findForbiddenUploadCommands(runYaml("gh api repos/o/r --method PUT --field content=$CONTENT"))).toEqual(
      [],
    );
  });

  it("rejects gh api --input, action-gh-release, and cache save", () => {
    expect(lineLooksLikeGhApiInput("gh api repos/o/r/contents/f --input secret.dump")).toBe(true);
    expect(lineLooksLikeGhApiInput("gh api repos/o/r --method GET")).toBe(false);
    expect(lineLooksLikeCacheSave("uses: actions/cache/save@v4")).toBe(true);
    expect(lineLooksLikeCacheSave("uses: actions/cache@v4")).toBe(true);
    expect(lineLooksLikeCacheSave('uses: "actions/cache@v4"')).toBe(true);
    expect(lineLooksLikeCacheSave("uses: actions/cache/restore@v4")).toBe(false);
    expect(() =>
      assertWorkflowUploadAllowlist("run: gh api repos/o/r/contents/f --input secret.dump\n", "input.yml"),
    ).toThrow(/gh api --input/);
    expect(() =>
      assertWorkflowUploadAllowlist("uses: softprops/action-gh-release@v2\n", "rel.yml"),
    ).toThrow(/softprops\/action-gh-release/);
    expect(() =>
      assertWorkflowUploadAllowlist("uses: actions/cache/save@v4\n", "cachesave.yml"),
    ).toThrow(/actions\/cache\/save/);
    expect(() =>
      assertWorkflowUploadAllowlist("uses: actions/cache@v4\nwith:\n  path: dist\n", "cache.yml"),
    ).toThrow(/actions\/cache save/);
    assertWorkflowUploadAllowlist("uses: actions/cache/restore@v4\n", "cacherestore.yml");
  });

  it("reads uses: from the parsed YAML tree, including flow-map and folded values", () => {
    const flow = [
      "on: push",
      "jobs:",
      "  t:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - { uses: softprops/action-gh-release@v2 }",
      "",
    ].join("\n");
    expect(collectSteps(flow).map((s) => s.uses)).toEqual(["softprops/action-gh-release@v2"]);
    expect(() => assertWorkflowUploadAllowlist(flow, "flow.yml")).toThrow(/softprops\/action-gh-release/);

    const folded = [
      "on: push",
      "jobs:",
      "  t:",
      "    steps:",
      "      - uses: >",
      "          ncipollo/release-action@v1",
      "",
    ].join("\n");
    expect(collectSteps(folded)[0]?.uses).toMatch(/^ncipollo\/release-action@v1/);
    expect(() => assertWorkflowUploadAllowlist(folded, "fold.yml")).toThrow(/ncipollo\/release-action/);

    const literal = [
      "jobs:",
      "  t:",
      "    steps:",
      "      - uses: |",
      "          svenstaro/upload-release-action@v2",
      "",
    ].join("\n");
    expect(() => assertWorkflowUploadAllowlist(literal, "lit.yml")).toThrow(/svenstaro\/upload-release-action/);
  });

  it("rejects curl -F with < file contents", () => {
    expect(isLtFileToken("a=<file")).toBe(true);
    expect(isLtFileToken("-F<file")).toBe(true);
    expect(lineLooksLikeHttpUpload('curl -F "a=<file" https://example.com')).toBe(true);
    expect(lineLooksLikeHttpUpload("curl --form a=<secret.dump https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload("curl -d a<b https://example.com")).toBe(false);
    expect(() =>
      assertWorkflowUploadAllowlist('run: curl -F "a=<file" https://example.com\n', "lt.yml"),
    ).toThrow(/curl\/wget upload/);
  });

  it("rejects curl --data-urlencode name@file", () => {
    expect(isDataUrlencodeFileArg("name@file")).toBe(true);
    expect(isDataUrlencodeFileArg("@file")).toBe(true);
    expect(isDataUrlencodeFileArg("name=value")).toBe(false);
    expect(lineLooksLikeHttpUpload("curl --data-urlencode name@file https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload("curl --data-urlencode=name@secret.dump https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload("curl --data-urlencode name=value https://example.com")).toBe(false);
    expect(() =>
      assertWorkflowUploadAllowlist("run: curl --data-urlencode name@file https://example.com\n", "enc.yml"),
    ).toThrow(/curl\/wget upload/);
  });

  it("detects curl/wget/gh inside command tokens, not just as a bare word", () => {
    expect(tokenMentionsTool("$(which curl)", "curl")).toBe(true);
    expect(tokenMentionsTool("`curl`", "curl")).toBe(true);
    expect(tokenMentionsTool("curl)", "curl")).toBe(true);
    expect(tokenMentionsTool("github", "gh")).toBe(false);
    expect(lineLooksLikeHttpUpload("$(which curl) -d @f https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload("`curl` -d @f https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload("env curl -d @f https://example.com")).toBe(true);
    expect(lineLooksLikeHttpUpload("command curl -d @f https://example.com")).toBe(true);
    expect(findForbiddenUploadCommands(runYaml("$(which curl) -d @f https://example.com"))).toEqual([
      { line: 1, kind: "curl/wget upload" },
    ]);
    expect(findForbiddenUploadCommands(runYaml("command gh gist create secret.dump"))).toEqual([
      { line: 1, kind: "gh gist create" },
    ]);
  });

  it("allows gh release create assets only in release.yml with the exact desktop tokens", () => {
    const sneak = "tar czf d.tar.gz dump; gh release create x d.tar.gz";
    expect(findForbiddenUploadCommands(runYaml(sneak), "cutover-migrate.yml")).toEqual([
      { line: 1, kind: "gh release create" },
    ]);
    expect(() => assertWorkflowUploadAllowlist(runYaml(sneak), "cutover-migrate.yml")).toThrow(
      /gh release create/,
    );
    expect(findForbiddenUploadCommands(runYaml("gh release create x $DUMP"), "other.yml")).toEqual([
      { line: 1, kind: "gh release create" },
    ]);
    expect(findForbiddenUploadCommands(runYaml("gh release create x secret.dump"), "other.yml")).toEqual([
      { line: 1, kind: "gh release create" },
    ]);
    expect(
      findForbiddenUploadCommands(
        releasePublishYaml('gh release create "$TAG" --repo "$RELEASES_REPO" --notes "$NOTES" --latest d.tar.gz'),
        "release.yml",
      ).map((h) => h.kind),
    ).toContain("gh release create file");
  });

  it("denies local ./ and docker:// uses unless allowlisted", () => {
    expect(() => assertWorkflowUploadAllowlist("uses: ./local-upload\n", "local.yml")).toThrow(/local uses/);
    expect(() =>
      assertWorkflowUploadAllowlist("uses: docker://ghcr.io/foo/upload:latest\n", "dock.yml"),
    ).toThrow(/docker:\/\/ uses/);
    expect(() =>
      assertWorkflowUploadAllowlist(
        ["on: push", "jobs:", "  t:", "    steps:", "      - { uses: ./evil }", ""].join("\n"),
        "flow-local.yml",
      ),
    ).toThrow(/local uses/);
  });

  it("rejects gh issue/pr --body-file and -F", () => {
    expect(findForbiddenUploadCommands(runYaml("gh issue create --body-file secret.dump"))).toEqual([
      { line: 1, kind: "gh file flag" },
    ]);
    expect(findForbiddenUploadCommands(runYaml("gh pr create -F secret.dump"))).toEqual([
      { line: 1, kind: "gh file flag" },
    ]);
    expect(findForbiddenUploadCommands(runYaml("gh issue comment 1 --body-file notes.md"))).toEqual([
      { line: 1, kind: "gh file flag" },
    ]);
    expect(() =>
      assertWorkflowUploadAllowlist(runYaml("gh pr create --body-file dump.csv"), "pr.yml"),
    ).toThrow(/gh file flag/);
    expect(findForbiddenUploadCommands(runYaml("gh pr list"))).toEqual([]);
  });

  it("denies gh release create/edit/upload outside release.yml, and edit/upload inside it", () => {
    expect(findForbiddenUploadCommands(runYaml("gh release create v1 --notes-file secret.dump"), "leak.yml")).toEqual(
      [{ line: 1, kind: "gh release create" }],
    );
    expect(findForbiddenUploadCommands(runYaml("gh release edit v1 --notes-file dump.csv"), "release.yml")).toEqual([
      { line: 1, kind: "gh release edit" },
    ]);
    expect(findForbiddenUploadCommands(runYaml("gh release upload v1 secret.dump"), "release.yml")).toEqual([
      { line: 1, kind: "gh release upload" },
    ]);
    expect(findForbiddenUploadCommands(runYaml("gh gist edit id --body-file secret.dump"))).toEqual([
      { line: 1, kind: "gh file flag" },
    ]);
    expect(() =>
      assertWorkflowUploadAllowlist(runYaml("gh release create v1 --notes-file notes.md"), "any.yml"),
    ).toThrow(/gh release create/);
  });

  it("throws on YAML parse errors, multiple documents, and a non-mapping root", () => {
    expect(() => parseWorkflowDocument("uses: [\n")).toThrow(/parse error/);
    expect(() => findForbiddenUploadCommands("uses: [\n")).toThrow(/parse error/);
    expect(() => assertWorkflowUploadAllowlist("---\na: 1\n---\nb: 2\n", "multi.yml")).toThrow(
      /exactly one document/,
    );
    expect(() => parseWorkflowDocument("- uses: softprops/action-gh-release@v2\n")).toThrow(
      /root must be a mapping/,
    );
    expect(() => findForbiddenUploadCommands("gh release upload v1 secret.dump\n")).toThrow(
      /root must be a mapping/,
    );
  });

  it("fails on duplicate keys and << merge keys", () => {
    expect(() => parseWorkflowDocument("on: push\non: pull_request\njobs: {}\n")).toThrow(/parse error|unique/);
    expect(() =>
      assertWorkflowUploadAllowlist(
        ["x: &a", "  uses: softprops/action-gh-release@v2", "jobs:", "  t:", "    steps:", "      - <<: *a", ""].join(
          "\n",
        ),
        "merge.yml",
      ),
    ).toThrow(/merge keys/);
  });

  it("rejects interpolated notes, glued -F, two-step assignment, and double --repo", () => {
    expect(
      findForbiddenUploadCommands(runYaml('gh issue create --notes "$(cat dump.sql)"')),
    ).toEqual([{ line: 1, kind: "gh interpolated notes" }]);

    expect(
      findForbiddenUploadCommands(runYaml('X=$(cat dump); gh issue create --notes "$X"')),
    ).toEqual([{ line: 1, kind: "gh interpolated notes" }]);
    expect(
      findForbiddenUploadCommands(
        releasePublishYaml(DESKTOP_CREATE.replace('--notes "$NOTES"', '--notes "$X"'), "X=$(cat dump)"),
        "release.yml",
      ).map((h) => h.kind),
    ).toEqual(expect.arrayContaining(["gh release notes", "NOTES assignment"]));

    expect(findForbiddenUploadCommands(runYaml("gh release create v1 -Fdump.sql"), "other.yml")).toEqual([
      { line: 1, kind: "gh release create" },
    ]);
    expect(
      findForbiddenUploadCommands(
        releasePublishYaml(
          'gh release create "$TAG" --repo "$RELEASES_REPO" --notes "$NOTES" --latest -Fdump.sql "$DMG" "$STABLE_DMG" "$APPTAR" latest.json',
        ),
        "release.yml",
      ).map((h) => h.kind),
    ).toContain("gh release notes");

    expect(
      findForbiddenUploadCommands(
        releasePublishYaml(
          'gh release create "$TAG" --repo "$RELEASES_REPO" --repo x/y --notes "$NOTES" --latest "$DMG" "$STABLE_DMG" "$APPTAR" latest.json',
        ),
        "release.yml",
      ).map((h) => h.kind),
    ).toContain("gh release repo");
  });

  it("requires the exact desktop publish shape in release.yml", () => {
    expect(findForbiddenUploadCommands(releasePublishYaml(DESKTOP_CREATE), "release.yml")).toEqual([]);
    expect(
      findForbiddenUploadCommands(
        releasePublishYaml(DESKTOP_CREATE, "NOTES=$(cat dump.sql)"),
        "release.yml",
      ).map((h) => h.kind),
    ).toContain("NOTES assignment");
  });

  it("pins yaml at exactly 2.9.1", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.devDependencies.yaml).toBe("2.9.1");
  });

  it("documents Limits: github-script and python/node uploads are out of scope", () => {
    const src = readFileSync(join(ROOT, "scripts/guard-public-ci.mjs"), "utf8");
    expect(src).toMatch(/## Limits/);
    expect(src).toMatch(/actions\/github-script/);
    expect(src).toMatch(/Python or Node/);
    expect(src).toMatch(/Reviewers must check those paths by hand/);
    const doc = readFileSync(join(ROOT, "docs/cloudflare-cutover.md"), "utf8");
    expect(doc).toMatch(/### Limits/);
    expect(doc).toMatch(/actions\/github-script/);
    expect(doc).toMatch(/Python or Node/);
  });

  it("rejects a multi-path dump + hash upload", () => {
    expect(() =>
      assertWorkflowUploadAllowlist(
        [
          "uses: actions/upload-artifact@sha",
          "with:",
          "  path: |",
          "    artifacts/nuvo-source.dump",
          "    artifacts/nuvo-source.sha256",
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
    expect(() => assertCutoverLogDir(join(dir, "missing"))).toThrow(/log dir missing/);
    writeFileSync(join(dir, "dump.log"), "verified backup: 12 bytes sha256=abc (runner only, not uploaded)\n");
    expect(assertCutoverLogDir(dir)).toEqual(["dump.log"]);
    writeFileSync(join(dir, "restore.log"), "auth map leaked phil@example.com\n");
    expect(() => assertCutoverLogDir(dir)).toThrow(/row data/);
  });

  it("exits non-zero when --check-log is pointed at a missing dir", () => {
    const missing = join(tmp(), "no-such-logs");
    const result = spawnSync(process.execPath, [join(ROOT, "scripts/guard-public-ci.mjs"), "--check-log", missing], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(/log dir missing/);
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
    expect(workflow.match(/COALESCE\(updated_at, created_at\)/g)?.length).toBe(2);
    expect(workflow).toMatch(/name: Shred dumps/);
    expect(workflow).toMatch(/id: guard/);
    expect(workflow).toMatch(/steps\.guard\.outcome == 'success'/);
    expect(workflow).toMatch(/--check-log/);
    expect(workflow).toMatch(
      /always\(\) && \(steps\.dump\.outcome == 'success' \|\| steps\.dump\.outcome == 'failure'\)/,
    );
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
