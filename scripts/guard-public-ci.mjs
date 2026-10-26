/**
 * Public-repo CI guards. Nuvo is public: dumps, CSVs, and row data must
 * never become Actions artifacts, and cutover logs must stay counts +
 * hashes. Run from checks.yml so a new workflow cannot sneak in an
 * upload-artifact of anything else. The cutover job also runs --job
 * immediately before the checksum-report upload, and --check-log against
 * teed step logs.
 *
 * Mirror of phillipchan1/leadwell PR #16 (scripts/guard-public-ci.mjs).
 * Generic rules (not one-off regexes per flag):
 *   1. Any @file argument to curl / wget / gh (curl -d @file, -d@file,
 *      --data-* @, gh api -F/-f x=@file, gh api --input, …).
 *   2. Any uses: matching /upload|release/ outside ALLOWED_UPLOAD_OR_RELEASE_USES
 *      (actions/upload-artifact is path-checked; merge and third-party
 *      release/upload actions are not).
 *   3. gh gist create, gh release upload, and gh release create <tag> <file>
 *      unless every asset is a desktop-publish token ($VAR / .dmg / .tar.gz /
 *      .sig / latest.json) — so release.yml stays green.
 *   4. actions/cache and actions/cache/save (restore-only is allowed).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ALLOWED_UPLOAD_ARTIFACT_PATHS = Object.freeze(["artifacts/cutover-report.md"]);

const ALLOWED = new Set(ALLOWED_UPLOAD_ARTIFACT_PATHS);

/** Filenames that are dumps / COPY output / dump sidecars — never in the workspace upload tree. */
export const FORBIDDEN_WORKSPACE_BASENAMES = Object.freeze([
  "nuvo-source.dump",
  "nuvo-source.toc",
  "nuvo-source.sha256",
  "auth-users.csv",
  "auth-identities.csv",
  "auth_users.csv",
  "auth_identities.csv",
]);

const DATA_PATH_RE = /\.(dump|csv|sql|toc)$/i;

/** uses: matching /upload|release/ that the four repo workflows may keep. */
export const ALLOWED_UPLOAD_OR_RELEASE_USES = Object.freeze(["actions/upload-artifact"]);

/** File operands `gh release create` may attach (desktop publish in release.yml). */
const ALLOWED_RELEASE_CREATE_ASSET_RE =
  /^(?:\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|Nuvo\.dmg|latest\.json|.+\.(?:dmg|app\.tar\.gz|tar\.gz|sig))$/i;

const GH_RELEASE_CREATE_VALUE_FLAGS = new Set([
  "--repo",
  "-R",
  "--title",
  "-t",
  "--notes",
  "-n",
  "--notes-file",
  "-F",
  "--target",
  "--discussion-category",
]);

const USES_UPLOAD_ARTIFACT_RE =
  /uses:\s*(['"]?)actions\/upload-artifact(\/merge)?(?:@[^'"\s]+)?\1[^\n]*\n((?:[ \t]+[^\n]*\n)*)/g;

export function extractUploadArtifactSteps(workflowText) {
  const steps = [];
  const re = new RegExp(USES_UPLOAD_ARTIFACT_RE.source, "g");
  for (const match of String(workflowText).matchAll(re)) {
    const block = match[0];
    const merge = Boolean(match[2]);
    const withBlock = match[3] ?? "";
    const pathMatch = withBlock.match(/^[ \t]+path:[ \t]*(\|[^\n]*\n(?:[ \t]+[^\n]+\n)*|.+)$/m);
    let path = "";
    if (pathMatch) {
      const raw = pathMatch[1].trim();
      if (raw.startsWith("|") || raw.startsWith(">")) {
        path = raw
          .split("\n")
          .slice(1)
          .map((line) => line.trim())
          .filter(Boolean)
          .join("\n");
      } else {
        path = raw.replace(/^['"]|['"]$/g, "");
      }
    }
    const nameMatch = withBlock.match(/^[ \t]+name:[ \t]*(.+)$/m);
    steps.push({
      block,
      path,
      merge,
      name: (nameMatch?.[1] ?? "").trim().replace(/^['"]|['"]$/g, ""),
    });
  }
  return steps;
}

/** Drop a full-line `#` comment; keep inline code so `run: curl …` still scans. */
function stripFullLineComment(line) {
  return /^\s*#/.test(line) ? "" : String(line);
}

/** Join `\` continuations so `gh release create "$TAG" \` + assets is one command. */
export function logicalLines(text) {
  const raw = String(text).split("\n");
  const out = [];
  let buf = "";
  let start = 1;
  for (let i = 0; i < raw.length; i++) {
    const physical = raw[i];
    const cont = /\\$/.test(physical);
    const trimmed = physical.replace(/\\$/, "");
    if (!buf) start = i + 1;
    buf += (buf ? " " : "") + trimmed;
    if (!cont) {
      out.push({ line: start, text: buf });
      buf = "";
    }
  }
  if (buf) out.push({ line: start, text: buf });
  return out;
}

/** Shell-ish tokens; quotes are dropped so `-d "@file"` and `-d @file` agree. */
export function tokenize(line) {
  const tokens = [];
  let cur = "";
  let quote = null;
  for (const c of String(line)) {
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (/\s/.test(c)) {
      if (cur) tokens.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

/**
 * Curl / gh @file: `@path`, `-d@path`, `--data=@path`, `name=@path`.
 * Not `user@host`, `postgres@127.0.0.1`, or `email=a@b.com`.
 */
export function isAtFileToken(tok) {
  const t = String(tok);
  if (!t.includes("@")) return false;
  if (t.startsWith("@")) return true;
  if (/^-[A-Za-z0-9]@/.test(t)) return true;
  if (/^--[A-Za-z0-9-]+=@/.test(t)) return true;
  const eq = t.indexOf("=");
  return eq > 0 && t[eq + 1] === "@";
}

function toolKind(tokens) {
  for (const t of tokens) {
    if (t === "curl" || /(?:^|\/)curl$/.test(t)) return "curl";
    if (t === "wget" || /(?:^|\/)wget$/.test(t)) return "wget";
    if (t === "gh" || /(?:^|\/)gh$/.test(t)) return "gh";
  }
  return null;
}

function isGhSubcommand(tokens, ...parts) {
  const i = tokens.findIndex((t) => t === "gh" || /(?:^|\/)gh$/.test(t));
  if (i < 0) return false;
  return parts.every((p, k) => tokens[i + 1 + k] === p);
}

function flagName(tok) {
  return String(tok).split("=")[0];
}

function hasHttpUploadFileFlag(tokens, kind) {
  for (const t of tokens) {
    if (t === "--upload-file" || t.startsWith("--upload-file=")) return true;
    if (kind === "curl" && (t === "-T" || (/^-T./.test(t) && !t.startsWith("--")))) return true;
    if (kind === "wget") {
      if (t === "--post-file" || t.startsWith("--post-file=")) return true;
      if (t === "--body-file" || t.startsWith("--body-file=")) return true;
    }
  }
  return false;
}

/** curl -T is upload; wget -T is timeout — only treat -T as upload on curl. */
export function lineLooksLikeHttpUpload(line) {
  const tokens = tokenize(stripFullLineComment(line));
  const kind = toolKind(tokens);
  if (kind !== "curl" && kind !== "wget") return false;
  if (hasHttpUploadFileFlag(tokens, kind)) return true;
  return tokens.some(isAtFileToken);
}

export function lineLooksLikeGhApiInput(line) {
  const tokens = tokenize(stripFullLineComment(line));
  if (!isGhSubcommand(tokens, "api")) return false;
  if (tokens.some((t) => flagName(t) === "--input")) return true;
  return tokens.some(isAtFileToken);
}

export function parseUsesAction(line) {
  const m = String(line).match(/^\s*(?:-\s+)?uses:\s*(['"]?)([^'"\s#]+)\1/);
  if (!m) return null;
  return m[2].replace(/@.*$/, "");
}

export function isForbiddenUse(action) {
  if (!action) return false;
  if (action === "actions/cache/save" || action === "actions/cache") return true;
  if (action === "actions/cache/restore") return false;
  if (ALLOWED_UPLOAD_OR_RELEASE_USES.includes(action)) return false;
  return /upload|release/i.test(action);
}

export function lineLooksLikeCacheSave(line) {
  const action = parseUsesAction(stripFullLineComment(line));
  if (!action) return false;
  if (action === "actions/cache/save") return true;
  if (action === "actions/cache/restore") return false;
  return action === "actions/cache";
}

function isAllowedReleaseCreateAsset(tok) {
  return ALLOWED_RELEASE_CREATE_ASSET_RE.test(String(tok));
}

/** Positional assets after `gh release create <tag>` (flags + tag skipped). */
export function ghReleaseCreateFiles(tokens) {
  const i = tokens.findIndex((t) => t === "gh" || /(?:^|\/)gh$/.test(t));
  if (i < 0) return [];
  const rest = tokens.slice(i + 3);
  const files = [];
  let seenTag = false;
  for (let j = 0; j < rest.length; j++) {
    const t = rest[j];
    if (t.startsWith("-")) {
      const name = flagName(t);
      if (!t.includes("=") && GH_RELEASE_CREATE_VALUE_FLAGS.has(name)) j += 1;
      continue;
    }
    if (!seenTag) {
      seenTag = true;
      continue;
    }
    files.push(t);
  }
  return files;
}

export function findForbiddenUploadCommands(workflowText) {
  const hits = [];
  for (const { line, text } of logicalLines(workflowText)) {
    const code = stripFullLineComment(text);
    if (!code.trim()) continue;

    const action = parseUsesAction(code);
    if (action && isForbiddenUse(action)) {
      hits.push({
        line,
        kind:
          action === "actions/cache"
            ? "actions/cache save"
            : action === "actions/cache/save"
              ? "actions/cache/save"
              : action,
      });
    } else if (lineLooksLikeCacheSave(code)) {
      hits.push({
        line,
        kind: /cache\/save/.test(code) ? "actions/cache/save" : "actions/cache save",
      });
    }

    const tokens = tokenize(code);
    const kind = toolKind(tokens);
    if (kind === "curl" || kind === "wget") {
      if (lineLooksLikeHttpUpload(code)) {
        hits.push({ line, kind: "curl/wget upload" });
      }
    }
    if (kind === "gh") {
      if (isGhSubcommand(tokens, "release", "upload")) {
        hits.push({ line, kind: "gh release upload" });
      } else if (isGhSubcommand(tokens, "gist", "create")) {
        hits.push({ line, kind: "gh gist create" });
      } else if (isGhSubcommand(tokens, "release", "create")) {
        const bad = ghReleaseCreateFiles(tokens).filter((f) => !isAllowedReleaseCreateAsset(f));
        if (bad.length) hits.push({ line, kind: "gh release create file" });
      }
      if (lineLooksLikeGhApiInput(code)) {
        hits.push({
          line,
          kind: tokens.some((t) => flagName(t) === "--input") ? "gh api --input" : "gh @file",
        });
      } else if (tokens.some(isAtFileToken)) {
        hits.push({ line, kind: "gh @file" });
      }
    }
  }
  return hits;
}

export function assertWorkflowUploadAllowlist(workflowText, filename = "workflow") {
  const problems = [];
  for (const hit of findForbiddenUploadCommands(workflowText)) {
    problems.push(`${filename}:${hit.line}: forbidden upload (${hit.kind})`);
  }
  const steps = extractUploadArtifactSteps(workflowText);
  for (const step of steps) {
    if (step.merge) {
      problems.push(`${filename}: actions/upload-artifact/merge is not allowlisted`);
      continue;
    }
    const paths = String(step.path)
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    if (!paths.length) {
      problems.push(`${filename}: upload-artifact has no path`);
      continue;
    }
    for (const p of paths) {
      if (!ALLOWED.has(p)) {
        problems.push(
          `${filename}: upload-artifact path "${p}" is not allowlisted (only ${[...ALLOWED].join(", ")})`,
        );
      }
    }
  }
  if (problems.length) {
    throw new Error(
      `public-repo artifact allowlist failed:\n${problems.map((p) => `  ${p}`).join("\n")}`,
    );
  }
  return steps;
}

export function assertWorkflowsUploadAllowlist(workflowsDir) {
  const names = readdirSync(workflowsDir).filter((n) => n.endsWith(".yml") || n.endsWith(".yaml"));
  if (!names.length) throw new Error(`no workflows in ${workflowsDir}`);
  const all = [];
  for (const name of names) {
    const text = readFileSync(join(workflowsDir, name), "utf8");
    all.push(...assertWorkflowUploadAllowlist(text, name).map((step) => ({ ...step, file: name })));
  }
  return all;
}

/** True when a staged upload path looks like a dump, CSV, or other row data. */
export function looksLikeDataUpload(path) {
  const p = String(path).trim().replace(/^\.\//, "");
  if (!p) return false;
  if (ALLOWED.has(p)) return false;
  const base = p.split(/[/\\]/).pop() ?? p;
  if (FORBIDDEN_WORKSPACE_BASENAMES.includes(base)) return true;
  if (DATA_PATH_RE.test(p)) return true;
  return false;
}

/**
 * Fail if anything other than the checksum report is staged for upload.
 * On a public repo, also fail if a dump / CSV / row-data path is attempted.
 */
export function assertStagedUpload(paths, { publicRepo = true, label = "staged" } = {}) {
  const problems = [];
  const list = (Array.isArray(paths) ? paths : String(paths).split(/[\n,]/))
    .map((p) => p.trim().replace(/^\.\//, ""))
    .filter(Boolean);
  for (const p of list) {
    if (!ALLOWED.has(p)) {
      problems.push(`${label}: staged path "${p}" is not allowlisted (only ${[...ALLOWED].join(", ")})`);
    }
    if (publicRepo && looksLikeDataUpload(p)) {
      problems.push(`${label}: public repo refuses data upload "${p}"`);
    }
  }
  if (problems.length) {
    throw new Error(
      `public-repo staged-upload guard failed:\n${problems.map((p) => `  ${p}`).join("\n")}`,
    );
  }
  return list;
}

function walkFiles(root, acc = [], { skip } = {}) {
  if (!existsSync(root)) return acc;
  const st = statSync(root);
  if (st.isFile()) {
    acc.push(root);
    return acc;
  }
  if (!st.isDirectory()) return acc;
  const skipSet = skip ?? new Set(["node_modules", ".git", "dist", "coverage"]);
  for (const name of readdirSync(root)) {
    if (skipSet.has(name)) continue;
    walkFiles(join(root, name), acc, { skip: skipSet });
  }
  return acc;
}

/**
 * Dump / COPY files must live under $RUNNER_TEMP, never next to the
 * allowlisted report. A file sitting in artifacts/ would be one glob
 * away from becoming a public artifact.
 */
export function assertWorkspaceHasNoDataFiles(workspaceDir, { artifactsDir } = {}) {
  const problems = [];
  const artifacts = artifactsDir ?? join(workspaceDir, "artifacts");
  if (existsSync(artifacts)) {
    for (const file of walkFiles(artifacts)) {
      const rel = relative(workspaceDir, file).replaceAll("\\", "/");
      if (ALLOWED.has(rel)) continue;
      problems.push(`workspace has non-allowlisted file under artifacts/: ${rel}`);
    }
  }
  for (const file of walkFiles(workspaceDir).filter((p) => {
    const rel = relative(workspaceDir, p).replaceAll("\\", "/");
    if (rel.startsWith("node_modules/") || rel.startsWith(".git/")) return false;
    const base = rel.split("/").pop() ?? rel;
    return FORBIDDEN_WORKSPACE_BASENAMES.includes(base);
  })) {
    const rel = relative(workspaceDir, file).replaceAll("\\", "/");
    problems.push(`workspace contains dump/CSV that must stay on the runner: ${rel}`);
  }
  if (problems.length) {
    throw new Error(
      `public-repo workspace data-file guard failed:\n${problems.map((p) => `  ${p}`).join("\n")}`,
    );
  }
}

/** True when log text looks like emails, CSV rows, or dumped secrets. */
export function logLooksLikeRowData(text) {
  const s = String(text);
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(s)) return true;
  if (/\bencrypted_password\b|\brecovery_token\b|\bconfirmation_token\b/.test(s)) return true;
  return false;
}

export function assertSafeMigrateLog(text, label = "log") {
  if (logLooksLikeRowData(text)) {
    throw new Error(`${label} looks like row data; only counts and hashes may be logged`);
  }
}

export function assertCutoverLogDir(logDir) {
  if (!logDir || !existsSync(logDir)) {
    throw new Error(`cutover log dir missing: ${logDir || "(unset)"}`);
  }
  const files = readdirSync(logDir).filter((n) => n.endsWith(".log"));
  for (const name of files) {
    assertSafeMigrateLog(readFileSync(join(logDir, name), "utf8"), name);
  }
  return files;
}

function parseBool(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return true;
  return !["0", "false", "no", "private"].includes(s);
}

const here = dirname(fileURLToPath(import.meta.url));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const job = process.argv.includes("--job");
  const checkLog = process.argv.includes("--check-log");
  if (checkLog) {
    const idx = process.argv.indexOf("--check-log");
    const logDir = process.argv[idx + 1] || process.env.CUTOVER_LOG_DIR || "";
    const files = assertCutoverLogDir(logDir);
    if (files.length) {
      console.log(`public-ci-guard: ${files.length} log file(s) have no row data`);
    }
  } else {
    const dir = join(here, "..", ".github", "workflows");
    const steps = assertWorkflowsUploadAllowlist(dir);
    if (job) {
      const staged = process.env.STAGED_UPLOAD || "artifacts/cutover-report.md";
      const publicRepo = parseBool(process.env.REPO_IS_PUBLIC ?? "true");
      assertStagedUpload(staged, { publicRepo, label: "cutover-job" });
      const workspace = process.env.GITHUB_WORKSPACE || join(here, "..");
      assertWorkspaceHasNoDataFiles(workspace);
      console.log(
        `public-ci-guard: job ok; ${steps.length} upload-artifact path(s); staged=${staged}; public=${publicRepo}`,
      );
    } else {
      console.log(`public-ci-guard: ${steps.length} upload-artifact path(s) allowlisted`);
    }
  }
}
