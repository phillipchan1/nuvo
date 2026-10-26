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
 *   5. gh api -f/-F/--field/--raw-field values (glued/= forms included)
 *      get the same $ / backtick / $( check. -F/--input @file is denied.
 *      release.yml may keep $CONTENT / $FILE_SHA and ${{ }} expressions.
 *   6. bash -c, sh -c, any shell -c, and eval: reject a script that
 *      contains gh; scan recursively; fail closed if unparseable.
 *   7. Command-position names with \, quotes, or $ / ${} / $(...) are
 *      denied (fail closed). gh alias set and gh alias import are denied.
 *   8. In the release.yml step that runs `gh release create`, each of
 *      DMG / STABLE_DMG / APPTAR / NOTES has exactly one pinned assignment
 *      from the known build paths; any reassignment fails.
 *   9. actions/cache and actions/cache/save (restore-only is allowed).
 *  10. YAML is fail-closed: parse errors, doc.errors, more than one
 *      document, a non-mapping root, duplicate keys, or << merge keys
 *      throw. There is no raw-text fallback.
 *
 * ## Limits
 *
 * This deny-list does not cover `actions/github-script` or upload code
 * written in Python or Node (or any other runtime) inside a `run:` step.
 * `nc`, `python`, and other non-`gh` exfil channels are out of scope.
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

/** Exactly one assignment each, in the release.yml publish step. */
export const PINNED_RELEASE_ASSIGNMENTS = Object.freeze({
  DMG: Object.freeze(['$(ls "$BUNDLE"/dmg/*.dmg | head -1)']),
  APPTAR: Object.freeze(['$(ls "$BUNDLE"/macos/*.app.tar.gz | head -1)']),
  STABLE_DMG: Object.freeze(['"Nuvo.dmg"']),
  NOTES: Object.freeze([...ALLOWED_NOTES_ASSIGNMENTS]),
});

const GH_API_FIELD_FLAGS = new Set(["-f", "-F", "--field", "--raw-field"]);
const ALLOWED_RELEASE_API_VARS = Object.freeze(["$CONTENT", "$FILE_SHA"]);
const SHELL_NAMES = new Set(["bash", "sh", "zsh", "dash", "ksh", "ash", "busybox"]);
const COMMAND_PREFIXES = new Set([
  "!",
  "time",
  "exec",
  "command",
  "builtin",
  "env",
  "then",
  "else",
  "elif",
  "if",
  "while",
  "until",
  "do",
  "fi",
  "done",
  "esac",
  "{",
  "}",
]);
const OPAQUE_INTERPOLATION_RE =
  /^(?:\$[A-Za-z_][A-Za-z0-9_]*|\$\{[^}]+\}|\$\([\s\S]*\)|`[\s\S]*`)$/;
const MAX_SHELL_DEPTH = 8;

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

function stripActionsExpressions(val) {
  return String(val).replace(/\$\{\{[\s\S]*?\}\}/g, "");
}

function stripWrappingQuotes(tok) {
  const s = String(tok);
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

function isAtFileValue(val) {
  const s = String(val);
  if (s.startsWith("@")) return true;
  const eq = s.indexOf("=");
  return eq >= 0 && s.slice(eq + 1).startsWith("@");
}

/** After stripping ${{ }}, only $CONTENT / $FILE_SHA may remain in release.yml. */
export function ghApiFieldValueAllowed(val, filename = "workflow") {
  if (isAtFileValue(val)) return false;
  const stripped = stripActionsExpressions(val);
  if (!looksInterpolated(stripped)) return true;
  if (filename !== "release.yml") return false;
  let rest = stripped;
  for (const name of ALLOWED_RELEASE_API_VARS) {
    rest = rest.split(name).join("");
  }
  return !looksInterpolated(rest);
}

function isOpaqueInterpolation(val) {
  const s = String(val).trim();
  if (!s) return true;
  return OPAQUE_INTERPOLATION_RE.test(s);
}

function scriptMentionsGh(script) {
  return /(?:^|[^A-Za-z0-9_])gh(?:[^A-Za-z0-9_]|$)/.test(String(script));
}

function commandBase(tok) {
  return stripWrappingQuotes(tok).split("/").pop();
}

/** Tokenize without dropping quotes, so `"gh"` and `\gh` stay dirty. */
export function tokenizeKeepQuotes(line) {
  const tokens = [];
  let cur = "";
  let quote = null;
  for (const c of String(line)) {
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
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
 * Split on ; && || | & outside quotes and $(...). Fail closed on
 * unclosed quotes / command substitutions.
 */
export function splitShellSegments(line) {
  const parts = [];
  let cur = "";
  let quote = null;
  let depth = 0;
  const s = String(line);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "`") {
      cur += c;
      const end = s.indexOf("`", i + 1);
      if (end < 0) return { error: "unclosed backtick", parts };
      cur += s.slice(i + 1, end + 1);
      i = end;
      continue;
    }
    if (c === "$" && s[i + 1] === "(") {
      depth += 1;
      cur += "$(";
      i += 1;
      continue;
    }
    if (c === "(" && depth > 0) {
      depth += 1;
      cur += c;
      continue;
    }
    if (c === ")" && depth > 0) {
      depth -= 1;
      cur += c;
      continue;
    }
    if (depth === 0) {
      if (c === ";" || (c === "&" && s[i + 1] !== "&")) {
        if (cur.trim()) parts.push(cur.trim());
        cur = "";
        continue;
      }
      if ((c === "&" && s[i + 1] === "&") || (c === "|" && s[i + 1] === "|")) {
        if (cur.trim()) parts.push(cur.trim());
        cur = "";
        i += 1;
        continue;
      }
      if (c === "|") {
        if (cur.trim()) parts.push(cur.trim());
        cur = "";
        continue;
      }
    }
    cur += c;
  }
  if (quote) return { error: "unclosed quote", parts };
  if (depth !== 0) return { error: "unclosed $(", parts };
  if (cur.trim()) parts.push(cur.trim());
  return { error: null, parts };
}

export function extractCommandSubs(text) {
  const parts = [];
  const s = String(text);
  let i = 0;
  while (i < s.length) {
    if (s[i] === "`") {
      const end = s.indexOf("`", i + 1);
      if (end < 0) return { error: "unclosed backtick", parts };
      parts.push(s.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    if (s[i] === "$" && s[i + 1] === "(") {
      let depth = 1;
      let j = i + 2;
      let quote = null;
      while (j < s.length && depth > 0) {
        const c = s[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
          quote = c;
        } else if (c === "$" && s[j + 1] === "(") {
          depth += 1;
          j += 1;
        } else if (c === "(") {
          depth += 1;
        } else if (c === ")") {
          depth -= 1;
        }
        j += 1;
      }
      if (depth !== 0) return { error: "unclosed $(", parts };
      parts.push(s.slice(i + 2, j - 1));
      i = j;
      continue;
    }
    i += 1;
  }
  return { error: null, parts };
}

function consumeShellWord(s) {
  let i = 0;
  let quote = null;
  let depth = 0;
  while (i < s.length) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      i += 1;
      continue;
    }
    if (c === "$" && s[i + 1] === "(") {
      depth += 1;
      i += 2;
      continue;
    }
    if (depth > 0) {
      if (c === "(") depth += 1;
      else if (c === ")") depth -= 1;
      i += 1;
      continue;
    }
    if (c === "`") {
      const end = s.indexOf("`", i + 1);
      if (end < 0) return { error: "unclosed backtick", length: s.length, word: s };
      i = end + 1;
      continue;
    }
    if (/\s/.test(c) || /[;|&]/.test(c)) break;
    i += 1;
  }
  if (quote) return { error: "unclosed quote", length: i, word: s.slice(0, i) };
  if (depth) return { error: "unclosed $(", length: i, word: s.slice(0, i) };
  return { error: null, length: i, word: s.slice(0, i) };
}

function firstCommandWord(segment) {
  let i = 0;
  const s = String(segment);
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i += 1;
    if (i >= s.length) return null;
    const assign = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*=/);
    if (assign) {
      i += assign[0].length;
      const word = consumeShellWord(s.slice(i));
      if (word.error) return { error: word.error, cmd: null, rest: [] };
      i += word.length;
      continue;
    }
    const word = consumeShellWord(s.slice(i));
    if (word.error) return { error: word.error, cmd: null, rest: [] };
    const cmd = word.word;
    const bare = stripWrappingQuotes(cmd);
    if (COMMAND_PREFIXES.has(bare)) {
      i += word.length;
      continue;
    }
    return {
      error: null,
      cmd,
      rest: tokenizeKeepQuotes(s.slice(i + word.length)),
    };
  }
  return null;
}

function isDirtyCommandName(cmd) {
  const s = String(cmd);
  if (!s) return false;
  // Quotes / $ / \ that wrap or substitute the name (`$G`, `"gh"`, `\gh`).
  // A later quoted arg glued onto a clean name (`print(f"…")`) is not this.
  if (/^[\\'"`$]/.test(s)) return true;
  if (/\$\(|\$\{/.test(s)) return true;
  if (s.includes("\\")) return true;
  return false;
}

/** True when a command-position token is dirty, or the line is unparseable. */
export function hasDirtyCommand(line, depth = 0) {
  if (depth > MAX_SHELL_DEPTH) return true;
  const segs = splitShellSegments(line);
  if (segs.error) return true;
  for (const seg of segs.parts) {
    const found = firstCommandWord(seg);
    if (found?.error) return true;
    if (found?.cmd && isDirtyCommandName(found.cmd)) return true;
  }
  const subs = extractCommandSubs(line);
  if (subs.error) return true;
  for (const part of subs.parts) {
    if (hasDirtyCommand(part, depth + 1)) return true;
  }
  return false;
}

function dashCScript(rest) {
  for (let i = 0; i < rest.length; i++) {
    const raw = rest[i];
    const t = stripWrappingQuotes(raw);
    if (t === "-c") {
      return rest[i + 1] == null ? { missing: true } : { value: stripWrappingQuotes(rest[i + 1]) };
    }
    if (/^-[A-Za-z]*c$/.test(t) && !t.startsWith("--")) {
      return rest[i + 1] == null ? { missing: true } : { value: stripWrappingQuotes(rest[i + 1]) };
    }
    if (t.startsWith("-c") && !t.startsWith("--") && t.length > 2) {
      return { value: t.startsWith("-c=") ? t.slice(3) : t.slice(2) };
    }
  }
  return null;
}

function shellWrapperScripts(line) {
  const scripts = [];
  const segs = splitShellSegments(line);
  if (segs.error) return { error: segs.error, scripts };
  for (const seg of segs.parts) {
    const found = firstCommandWord(seg);
    if (found?.error) return { error: found.error, scripts };
    if (!found) continue;
    const base = commandBase(found.cmd);
    if (base === "eval") {
      const script = found.rest.map(stripWrappingQuotes).join(" ");
      scripts.push({ kind: "eval", script, opaque: isOpaqueInterpolation(script) });
      continue;
    }
    if (!SHELL_NAMES.has(base) || isDirtyCommandName(found.cmd)) continue;
    const dash = dashCScript(found.rest);
    if (!dash) continue;
    if (dash.missing) {
      scripts.push({ kind: "shell -c", script: "", opaque: true });
      continue;
    }
    scripts.push({
      kind: "shell -c",
      script: dash.value,
      opaque: isOpaqueInterpolation(dash.value),
    });
  }
  return { error: null, scripts };
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

export function varAssignments(run, name) {
  const found = [];
  const re = new RegExp(`^${name}=(.*)$`);
  for (const { text } of logicalLines(run)) {
    const stripped = stripFullLineComment(text);
    for (const part of stripped.split(";")) {
      const m = part.trim().match(re);
      if (m) found.push(m[1].trim());
    }
  }
  return found;
}

export function notesAssignments(run) {
  return varAssignments(run, "NOTES");
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
  for (const [name, allowed] of Object.entries(PINNED_RELEASE_ASSIGNMENTS)) {
    const found = varAssignments(run, name);
    if (found.length !== 1 || !allowed.includes(found[0])) {
      hits.push(`${name} assignment`);
    }
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

function pushHit(hits, line, kind) {
  if (!hits.some((h) => h.line === line && h.kind === kind)) {
    hits.push({ line, kind });
  }
}

/** Blank `<<'TAG'` / `<<"TAG"` / `<<TAG` bodies so Python/Node in a run: is not scanned as shell. */
export function stripHeredocBodies(run) {
  const lines = String(run).split("\n");
  const out = [];
  let ending = null;
  for (const physical of lines) {
    if (ending) {
      out.push(physical.trim() === ending ? physical : "");
      if (physical.trim() === ending) ending = null;
      continue;
    }
    out.push(physical);
    const m = physical.match(/<<-?\s*(?:'([^']+)'|"([^"]+)"|\\?(\S+))\s*$/);
    if (m) ending = m[1] || m[2] || m[3];
  }
  return out.join("\n");
}

function scanRunScript(run, filename, depth = 0) {
  if (depth > MAX_SHELL_DEPTH) return [{ line: 1, kind: "unparseable shell" }];
  const hits = [];
  const source = depth === 0 ? stripHeredocBodies(run) : run;
  for (const { line, text } of logicalLines(source)) {
    const code = stripFullLineComment(text);
    if (!code.trim()) continue;
    const tokens = tokenize(code);

    if (hasDirtyCommand(code)) pushHit(hits, line, "dirty command");

    const wrappers = shellWrapperScripts(code);
    if (wrappers.error) {
      pushHit(hits, line, "unparseable shell");
    } else {
      for (const wrap of wrappers.scripts) {
        if (wrap.opaque) {
          pushHit(hits, line, wrap.kind);
          continue;
        }
        if (scriptMentionsGh(wrap.script)) {
          pushHit(hits, line, wrap.kind);
        }
        for (const inner of scanRunScript(wrap.script, filename, depth + 1)) {
          pushHit(hits, line, inner.kind);
        }
      }
    }

    const kind = toolKind(tokens);
    if (kind === "curl" || kind === "wget") {
      if (lineLooksLikeHttpUpload(code)) pushHit(hits, line, "curl/wget upload");
    }
    if (kind === "gh") {
      if (isGhSubcommand(tokens, "alias", "set") || isGhSubcommand(tokens, "alias", "import")) {
        pushHit(hits, line, "gh alias");
      }
      const releaseWrite =
        isGhSubcommand(tokens, "release", "create") ||
        isGhSubcommand(tokens, "release", "edit") ||
        isGhSubcommand(tokens, "release", "upload");
      if (releaseWrite) {
        const sub = tokens[ghTokenIndex(tokens) + 2];
        if (filename !== "release.yml" || sub !== "create") {
          pushHit(hits, line, `gh release ${sub}`);
        } else {
          for (const shapeKind of releaseCreateShapeHits(tokens, run)) {
            pushHit(hits, line, shapeKind);
          }
        }
      } else {
        if (isGhSubcommand(tokens, "gist", "create")) {
          pushHit(hits, line, "gh gist create");
        }
        if (interpolatedNotesBody(tokens).length) {
          pushHit(hits, line, "gh interpolated notes");
        }
        if (ghForbiddenFileFlags(tokens).length) {
          pushHit(hits, line, "gh file flag");
        }
      }
      if (isGhSubcommand(tokens, "api")) {
        const fields = flagValuePairs(tokens, GH_API_FIELD_FLAGS);
        if (fields.some((p) => !ghApiFieldValueAllowed(p.value, filename))) {
          pushHit(hits, line, "gh api field");
        }
      }
      if (lineLooksLikeGhApiInput(code)) {
        pushHit(
          hits,
          line,
          tokens.some((t) => flagName(t) === "--input") ? "gh api --input" : "gh @file",
        );
      } else if (tokens.some(isAtFileToken)) {
        pushHit(hits, line, "gh @file");
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
