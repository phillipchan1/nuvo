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
 *   1. Parse jobs/steps with a real YAML parser; read uses: from the tree
 *      (flow-map steps and multi-line uses: values included).
 *   2. Any @file / name=<file / --data-urlencode name@file argument to
 *      curl / wget / gh. Tools are detected anywhere in a token
 *      ($(which curl), `curl`, env/command curl, …).
 *   3. Any uses: matching /upload|release/, plus ./ and docker://, outside
 *      the allowlists. actions/upload-artifact is path-checked.
 *   4. Outside release.yml, gh release create / edit / upload is denied
 *      entirely. Inside release.yml, create is allowed only as: exactly one
 *      --repo/-R on the line, value $RELEASES_REPO; notes only the literal
 *      --notes "$NOTES"; NOTES assigned only from $(cat RELEASE_NOTES.md);
 *      assets only $DMG $STABLE_DMG $APPTAR latest.json. File-valued flags
 *      stay denied (empty allowlist). gh issue/pr/gist create or comment
 *      is denied when a body/notes value (--notes/-n/--body/-b/-F/
 *      --body-file/--notes-file, including glued -Fdump.sql / -bX) contains
 *      $, a backtick, or $(. gh gist create is always denied.
 *   5. actions/cache and actions/cache/save (restore-only is allowed).
 *   6. YAML is fail-closed: parse errors, doc.errors, more than one
 *      document, a non-mapping root, duplicate keys, or << merge keys
 *      throw. There is no raw-text fallback.
 *
 * ## Limits
 *
 * This deny-list does not cover `actions/github-script` or upload code
 * written in Python or Node (or any other runtime) inside a `run:` step.
 * Reviewers must check those paths by hand.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isScalar, parseAllDocuments, visit } from "yaml";

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

/** Local ./ and docker:// uses: none of the four workflows ship one. */
export const ALLOWED_LOCAL_OR_DOCKER_USES = Object.freeze([]);

/** Positional assets `gh release create` may attach — only in release.yml. */
export const RELEASE_YML_ALLOWED_ASSETS = Object.freeze(["$DMG", "$STABLE_DMG", "$APPTAR", "latest.json"]);

/** File-valued gh flags (--notes-file, --body-file, -F). Empty: nothing is allowed. */
export const ALLOWED_GH_FILE_FLAG_VALUES = Object.freeze([]);

const GH_FILE_VALUE_FLAGS = new Set(["--notes-file", "--body-file", "-F"]);
const GH_FILE_FLAG_COMMANDS = new Set(["release", "issue", "pr", "gist"]);
const GH_NOTES_BODY_FLAGS = new Set([
  "--notes",
  "-n",
  "--body",
  "-b",
  "-F",
  "--body-file",
  "--notes-file",
]);
const GH_REPO_FLAGS = new Set(["--repo", "-R"]);
const ALLOWED_NOTES_ASSIGNMENTS = new Set([
  "$(cat RELEASE_NOTES.md)",
  '"$(cat RELEASE_NOTES.md)"',
  "'$(cat RELEASE_NOTES.md)'",
]);

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

function rejectMergeKeys(doc) {
  visit(doc, {
    Pair(_, pair) {
      if (isScalar(pair.key) && String(pair.key.value) === "<<") {
        throw new Error("workflow YAML merge keys (<<) are not allowed");
      }
    },
  });
}

/**
 * Fail-closed workflow parse: exactly one document, mapping root, no
 * parse errors, unique keys, no << merges. Never returns a partial tree.
 */
export function parseWorkflowDocument(text) {
  let docs;
  try {
    docs = parseAllDocuments(String(text), { uniqueKeys: true });
  } catch (err) {
    throw new Error(`workflow YAML parse error: ${err instanceof Error ? err.message : err}`);
  }
  if (docs.length !== 1) {
    throw new Error(`workflow YAML must be exactly one document (got ${docs.length})`);
  }
  const doc = docs[0];
  if (doc.errors?.length) {
    throw new Error(`workflow YAML parse error: ${doc.errors.map((e) => e.message).join("; ")}`);
  }
  rejectMergeKeys(doc);
  const js = doc.toJS({ maxAliasCount: -1 });
  if (js == null || typeof js !== "object" || Array.isArray(js)) {
    throw new Error("workflow YAML root must be a mapping");
  }
  return js;
}

function withPath(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean).join("\n");
  return String(value).trim();
}

export function normalizeUses(uses) {
  if (uses == null) return null;
  return String(uses).trim().replace(/\s+/g, " ").trim();
}

export function actionName(uses) {
  const u = normalizeUses(uses);
  if (!u) return null;
  if (u.startsWith("docker://") || u.startsWith("./") || u.startsWith("../") || u.startsWith("/")) {
    return u;
  }
  return u.replace(/@.*$/, "");
}

function normalizeStep(step, line = 1) {
  if (step == null) return { uses: null, run: "", with: {}, name: "", line };
  if (typeof step === "string") return { uses: null, run: step, with: {}, name: "", line };
  const withBlock = step.with && typeof step.with === "object" ? step.with : {};
  return {
    uses: normalizeUses(step.uses),
    run: step.run == null ? "" : String(step.run),
    with: withBlock,
    name: step.name == null ? "" : String(step.name),
    line,
  };
}

function walkJobSteps(doc) {
  const steps = [];
  if (!doc || typeof doc !== "object") return steps;
  const jobs = doc.jobs;
  if (!jobs || typeof jobs !== "object") return steps;
  for (const job of Object.values(jobs)) {
    if (!job || typeof job !== "object") continue;
    if (job.uses) steps.push(normalizeStep({ uses: job.uses, with: job.with }));
    if (Array.isArray(job.steps)) {
      for (const step of job.steps) steps.push(normalizeStep(step));
    }
  }
  return steps;
}

/**
 * Read steps from the parsed YAML tree. Fragments must still be a mapping
 * (`uses: …`, `run: …`, `jobs:`). Sequences and raw shell throw.
 */
export function collectSteps(workflowText) {
  const doc = parseWorkflowDocument(workflowText);
  if (doc.jobs) return walkJobSteps(doc);
  if (Array.isArray(doc.steps)) return doc.steps.map((step) => normalizeStep(step));
  if (doc.uses != null || doc.run != null) return [normalizeStep(doc)];
  return [];
}

export function extractUploadArtifactSteps(workflowText) {
  const steps = [];
  for (const step of collectSteps(workflowText)) {
    const name = actionName(step.uses);
    if (name !== "actions/upload-artifact" && name !== "actions/upload-artifact/merge") continue;
    steps.push({
      block: step.uses ?? "",
      path: withPath(step.with.path),
      merge: name.endsWith("/merge"),
      name: String(step.with.name ?? step.name ?? "").trim(),
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

/** curl -F "a=<file" / --form name=<file — file contents as a form field. */
export function isLtFileToken(tok) {
  const t = String(tok);
  if (!t.includes("<")) return false;
  if (t.startsWith("<") && t.length > 1) return true;
  if (/^-[A-Za-z0-9]</.test(t)) return true;
  if (/^--[A-Za-z0-9-]+=</.test(t)) return true;
  const eq = t.indexOf("=");
  return eq > 0 && t[eq + 1] === "<";
}

/**
 * curl / wget / gh anywhere in a token: `curl`, $(which curl), `curl`,
 * $(curl), env/command/exec wrappers, `curl)` after a split `$(which curl)`.
 */
export function tokenMentionsTool(tok, tool) {
  return new RegExp(`(?:^|[^A-Za-z0-9_])${tool}(?:[^A-Za-z0-9_]|$)`).test(String(tok));
}

function toolKind(tokens) {
  for (const t of tokens) {
    if (tokenMentionsTool(t, "curl")) return "curl";
    if (tokenMentionsTool(t, "wget")) return "wget";
    if (tokenMentionsTool(t, "gh")) return "gh";
  }
  return null;
}

function ghTokenIndex(tokens) {
  return tokens.findIndex((t) => tokenMentionsTool(t, "gh"));
}

function isGhSubcommand(tokens, ...parts) {
  const i = ghTokenIndex(tokens);
  if (i < 0) return false;
  return parts.every((p, k) => tokens[i + 1 + k] === p);
}

function flagName(tok) {
  return splitFlag(tok)?.name ?? String(tok).split("=")[0];
}

/** `-Fdump.sql`, `-F=dump`, `--notes=x`, `--notes` + next token. */
export function splitFlag(tok) {
  const t = String(tok);
  if (!t.startsWith("-")) return null;
  if (t.startsWith("--")) {
    const eq = t.indexOf("=");
    if (eq < 0) return { name: t, value: null, glued: false };
    return { name: t.slice(0, eq), value: t.slice(eq + 1), glued: true };
  }
  const name = t.slice(0, 2);
  const rest = t.slice(2);
  if (!rest) return { name, value: null, glued: false };
  if (rest.startsWith("=")) return { name, value: rest.slice(1), glued: true };
  return { name, value: rest, glued: true };
}

function flagValuePairs(tokens, names) {
  const pairs = [];
  for (let i = 0; i < tokens.length; i++) {
    const f = splitFlag(tokens[i]);
    if (!f || !names.has(f.name)) continue;
    if (f.value != null) {
      pairs.push({ name: f.name, value: f.value });
      continue;
    }
    const next = tokens[i + 1];
    if (next != null && !String(next).startsWith("-")) {
      pairs.push({ name: f.name, value: next });
      i += 1;
    } else {
      pairs.push({ name: f.name, value: "" });
    }
  }
  return pairs;
}

export function looksInterpolated(val) {
  return /\$|`/.test(String(val));
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

/** --data-urlencode name@file (and @file / name=@file), not name=value. */
export function isDataUrlencodeFileArg(arg) {
  const a = String(arg);
  if (isAtFileToken(a)) return true;
  return a.includes("@") && !a.includes("=");
}

function hasDataUrlencodeFile(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--data-urlencode" && tokens[i + 1] && isDataUrlencodeFileArg(tokens[i + 1])) {
      return true;
    }
    if (t.startsWith("--data-urlencode=") && isDataUrlencodeFileArg(t.slice("--data-urlencode=".length))) {
      return true;
    }
  }
  return false;
}

function hasFormLtFile(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const name = flagName(t);
    const isForm = name === "-F" || name === "--form";
    if (!isForm) continue;
    if (isLtFileToken(t)) return true;
    if (tokens[i + 1] && isLtFileToken(tokens[i + 1])) return true;
  }
  return false;
}

/** curl -T is upload; wget -T is timeout — only treat -T as upload on curl. */
export function lineLooksLikeHttpUpload(line) {
  const tokens = tokenize(stripFullLineComment(line));
  const kind = toolKind(tokens);
  if (kind !== "curl" && kind !== "wget") return false;
  if (hasHttpUploadFileFlag(tokens, kind)) return true;
  if (kind === "curl" && (hasDataUrlencodeFile(tokens) || hasFormLtFile(tokens))) return true;
  return tokens.some(isAtFileToken);
}

export function lineLooksLikeGhApiInput(line) {
  const tokens = tokenize(stripFullLineComment(line));
  if (!isGhSubcommand(tokens, "api")) return false;
  if (tokens.some((t) => flagName(t) === "--input")) return true;
  return tokens.some(isAtFileToken);
}

export function isLocalOrDockerUses(action) {
  if (!action) return false;
  return /^(?:\.\/|\.\.\/|\/|docker:\/\/)/.test(action);
}

export function isForbiddenUse(action) {
  if (!action) return false;
  const a = String(action).trim();
  if (isLocalOrDockerUses(a)) {
    return !ALLOWED_LOCAL_OR_DOCKER_USES.includes(a);
  }
  const name = actionName(a);
  if (!name) return false;
  if (name === "actions/cache/save" || name === "actions/cache") return true;
  if (name === "actions/cache/restore") return false;
  if (ALLOWED_UPLOAD_OR_RELEASE_USES.includes(name)) return false;
  return /upload|release/i.test(name);
}

export function lineLooksLikeCacheSave(line) {
  for (const step of collectSteps(line)) {
    const name = actionName(step.uses);
    if (name === "actions/cache/save") return true;
    if (name === "actions/cache/restore") return false;
    if (name === "actions/cache") return true;
  }
  return false;
}

/** Positional assets after `gh release create <tag>` (flags + tag skipped). */
export function ghReleaseCreateFiles(tokens) {
  const i = ghTokenIndex(tokens);
  if (i < 0) return [];
  const rest = tokens.slice(i + 3);
  const files = [];
  let seenTag = false;
  for (let j = 0; j < rest.length; j++) {
    const t = rest[j];
    if (t.startsWith("-")) {
      const f = splitFlag(t);
      if (f && !f.glued && GH_RELEASE_CREATE_VALUE_FLAGS.has(f.name)) j += 1;
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

/** File-valued flags on gh release / issue / pr / gist, unless allowlisted. */
export function ghFileFlagValues(tokens) {
  const i = ghTokenIndex(tokens);
  if (i < 0) return [];
  if (!GH_FILE_FLAG_COMMANDS.has(tokens[i + 1])) return [];
  return flagValuePairs(tokens, GH_FILE_VALUE_FLAGS).map((p) => p.value);
}

function ghForbiddenFileFlags(tokens) {
  return ghFileFlagValues(tokens).filter((v) => !ALLOWED_GH_FILE_FLAG_VALUES.includes(v));
}

export function notesAssignments(run) {
  const found = [];
  for (const { text } of logicalLines(run)) {
    const stripped = stripFullLineComment(text);
    for (const part of stripped.split(";")) {
      const m = part.trim().match(/^NOTES=(.*)$/);
      if (m) found.push(m[1].trim());
    }
  }
  return found;
}

function isIssuePrGistWrite(tokens) {
  const i = ghTokenIndex(tokens);
  if (i < 0) return false;
  const cmd = tokens[i + 1];
  const sub = tokens[i + 2];
  if (!["issue", "pr", "gist"].includes(cmd)) return false;
  return sub === "create" || sub === "comment";
}

function interpolatedNotesBody(tokens) {
  if (!isIssuePrGistWrite(tokens)) return [];
  return flagValuePairs(tokens, GH_NOTES_BODY_FLAGS).filter((p) => looksInterpolated(p.value));
}

export function releaseCreateShapeHits(tokens, run) {
  const hits = [];
  const repos = flagValuePairs(tokens, GH_REPO_FLAGS);
  if (repos.length !== 1 || repos[0].value !== "$RELEASES_REPO") {
    hits.push("gh release repo");
  }
  const notes = flagValuePairs(tokens, GH_NOTES_BODY_FLAGS);
  if (notes.length !== 1 || notes[0].name !== "--notes" || notes[0].value !== "$NOTES") {
    hits.push("gh release notes");
  }
  const assigns = notesAssignments(run);
  if (!assigns.length || assigns.some((a) => !ALLOWED_NOTES_ASSIGNMENTS.has(a))) {
    hits.push("NOTES assignment");
  }
  const files = ghReleaseCreateFiles(tokens);
  if (!files.length || files.some((f) => !RELEASE_YML_ALLOWED_ASSETS.includes(f))) {
    hits.push("gh release create file");
  }
  return hits;
}

function forbiddenUseKind(action) {
  const name = actionName(action) ?? action;
  if (isLocalOrDockerUses(name)) return name.startsWith("docker://") ? "docker:// uses" : "local uses";
  if (name === "actions/cache") return "actions/cache save";
  if (name === "actions/cache/save") return "actions/cache/save";
  return name;
}

function scanRunScript(run, filename) {
  const hits = [];
  for (const { line, text } of logicalLines(run)) {
    const code = stripFullLineComment(text);
    if (!code.trim()) continue;
    const tokens = tokenize(code);
    const kind = toolKind(tokens);
    if (kind === "curl" || kind === "wget") {
      if (lineLooksLikeHttpUpload(code)) hits.push({ line, kind: "curl/wget upload" });
    }
    if (kind === "gh") {
      const releaseWrite =
        isGhSubcommand(tokens, "release", "create") ||
        isGhSubcommand(tokens, "release", "edit") ||
        isGhSubcommand(tokens, "release", "upload");
      if (releaseWrite) {
        const sub = tokens[ghTokenIndex(tokens) + 2];
        if (filename !== "release.yml" || sub !== "create") {
          hits.push({ line, kind: `gh release ${sub}` });
        } else {
          for (const shapeKind of releaseCreateShapeHits(tokens, run)) {
            hits.push({ line, kind: shapeKind });
          }
        }
      } else {
        if (isGhSubcommand(tokens, "gist", "create")) {
          hits.push({ line, kind: "gh gist create" });
        }
        if (interpolatedNotesBody(tokens).length) {
          hits.push({ line, kind: "gh interpolated notes" });
        }
        if (ghForbiddenFileFlags(tokens).length) {
          hits.push({ line, kind: "gh file flag" });
        }
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

export function findForbiddenUploadCommands(workflowText, filename = "workflow") {
  const hits = [];
  for (const step of collectSteps(workflowText)) {
    if (step.uses && isForbiddenUse(step.uses)) {
      hits.push({ line: step.line, kind: forbiddenUseKind(step.uses) });
    }
    if (step.run) hits.push(...scanRunScript(step.run, filename));
  }
  return hits;
}

export function assertWorkflowUploadAllowlist(workflowText, filename = "workflow") {
  const problems = [];
  for (const hit of findForbiddenUploadCommands(workflowText, filename)) {
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
