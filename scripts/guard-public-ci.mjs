/**
 * Public-repo CI guards. Nuvo is public: dumps, CSVs, and row data must
 * never become Actions artifacts, and cutover logs must stay counts +
 * hashes. Run from checks.yml so a new workflow cannot sneak in an
 * upload-artifact of anything else. The cutover job also runs --job
 * immediately before the checksum-report upload.
 *
 * Mirror of phillipchan1/leadwell PR #16 (scripts/guard-public-ci.mjs).
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

export function extractUploadArtifactSteps(workflowText) {
  const steps = [];
  const re = /uses:\s*actions\/upload-artifact[^\n]*\n((?:[ \t]+[^\n]*\n)*)/g;
  for (const match of String(workflowText).matchAll(re)) {
    const block = match[0];
    const pathMatch = block.match(/^[ \t]+path:[ \t]*(\|[^\n]*\n(?:[ \t]+[^\n]+\n)*|.+)$/m);
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
    const nameMatch = block.match(/^[ \t]+name:[ \t]*(.+)$/m);
    steps.push({
      block,
      path,
      name: (nameMatch?.[1] ?? "").trim().replace(/^['"]|['"]$/g, ""),
    });
  }
  return steps;
}

export function assertWorkflowUploadAllowlist(workflowText, filename = "workflow") {
  const problems = [];
  const steps = extractUploadArtifactSteps(workflowText);
  for (const step of steps) {
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

function parseBool(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return true;
  return !["0", "false", "no", "private"].includes(s);
}

const here = dirname(fileURLToPath(import.meta.url));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const job = process.argv.includes("--job");
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
