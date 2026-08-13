#!/usr/bin/env node
// Classifies every file under src/ as mobile-only, desktop-only, or shared —
// by tracing the REAL static import graph from the two shell entry points,
// not a hand-maintained list. Self-updates every run: add a new mobile screen
// or a new desktop-only floor and it's classified correctly next time this
// runs, with zero edits anywhere else.
//
// Desktop entry: src/components/AppShell.tsx, with the mobile branch
// (`./mobile/MobileShell`) excluded from traversal — this is the "AppShell
// minus mobile" closure: shared infra + desktop-only surfaces.
// Mobile entry: src/components/mobile/MobileShell.tsx, traced normally.
//
//   mobileOnly  = mobileReachable \ nonMobileReachable   (only mobile touches it)
//   desktopOnly = nonMobileReachable \ mobileReachable   (only desktop touches it)
//   shared      = the intersection
//
// Anything not under src/ at all (docs, marketing, tests, supabase edge
// functions, root build config, src-tauri) isn't part of this graph — see the
// small structural allow/deny lists below, which classify by REPO LAYOUT
// (what kind of file is this), not by APP FEATURE (which surface is it part
// of). That distinction matters: the feature-level classification is exactly
// what used to need constant manual upkeep, and is now fully automatic; the
// layout-level list is structural and essentially never changes.
//
// Usage:
//   node scripts/platform-reachability.mjs classify
//     → prints the full classification as JSON (for inspection/debugging).
//   node scripts/platform-reachability.mjs check <desktop|mobile>
//     → reads changed file paths (repo-relative, one per line) from stdin,
//       exits 0 if the build for <platform> should run, 1 if every changed
//       file is provably irrelevant to it. Prints its reasoning to stderr.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SRC = path.join(ROOT, "src");
const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

const DESKTOP_ENTRY = path.join(SRC, "components", "AppShell.tsx");
const MOBILE_ENTRY = path.join(SRC, "components", "mobile", "MobileShell.tsx");

// --- repo-layout rules (structural, not feature-based — see header) -------

// Never part of either app bundle: not reachable from src/main.tsx no matter
// what, so a change here can't affect what either shell ships.
const NEVER_RELEVANT = [
  /^docs\//,
  /^marketing\//,
  /^tests\//,
  /^supabase\//,
  /\.md$/i,
  /^\.github\/workflows\/checks\.yml$/,
];

// Exists only for the iOS package/build.
const IOS_ONLY = [
  /^src-tauri\/ios\//,
  /^src-tauri\/icons\/ios\//,
  /^src-tauri\/tauri\.ios\.conf\.json$/,
  /^scripts\/ios-postinit\.sh$/,
  // The WidgetKit extension's injection into the generated Xcode project. Only
  // ios-postinit.sh calls it, and only the iOS build runs that.
  /^scripts\/ios-widgets\.rb$/,
  // The watchOS companion's injection into the generated Xcode project. Same
  // shape as ios-widgets.rb — only ios-postinit.sh calls it, and only the iOS
  // build runs that. Without this entry a watch-only change falls through to
  // the conservative default and wakes the macOS runner too.
  /^scripts\/ios-watch\.rb$/,
  /^\.github\/workflows\/ios-release\.yml$/,
];

// Exists only for the macOS package/build.
const MACOS_ONLY = [/^\.github\/workflows\/release\.yml$/];

function matches(patterns, relPath) {
  return patterns.some((re) => re.test(relPath));
}

// --- import graph -----------------------------------------------------------

// `import type {...} from "spec"` / `export type {...} from "spec"` are erased
// entirely at build time (TypeScript guarantees this for the whole-statement
// `type` form) — they create a source-level reference but no runtime bundling
// dependency, so they're deliberately NOT treated as graph edges. A mixed
// import like `import { type Foo, Bar } from "spec"` still counts (Bar is
// real), since only the whole-statement form is excluded here.
const FROM_IMPORT_RE = /\b(import|export)\s+(type\s+)?[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /\bimport\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractEdgeSpecifiers(text) {
  const specs = new Set();
  for (const m of text.matchAll(FROM_IMPORT_RE)) {
    const isTypeOnly = Boolean(m[2]);
    if (!isTypeOnly) specs.add(m[3]);
  }
  for (const m of text.matchAll(SIDE_EFFECT_IMPORT_RE)) specs.add(m[1]);
  for (const m of text.matchAll(DYNAMIC_IMPORT_RE)) specs.add(m[1]);
  return specs;
}

function walkSrcFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkSrcFiles(full, out);
    } else if (EXTENSIONS.includes(path.extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

function resolveSpecifier(spec, fromFile) {
  if (!spec.startsWith(".")) return null; // bare package import, not ours
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => path.join(base, "index" + ext)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function buildGraph() {
  const files = walkSrcFiles(SRC);
  const graph = new Map();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const edges = new Set();
    for (const spec of extractEdgeSpecifiers(text)) {
      const resolved = resolveSpecifier(spec, file);
      if (resolved) edges.add(resolved);
    }
    graph.set(file, edges);
  }
  return graph;
}

function reachableFrom(graph, start, exclude = new Set()) {
  const visited = new Set();
  const stack = [start];
  while (stack.length) {
    const node = stack.pop();
    if (visited.has(node) || exclude.has(node)) continue;
    visited.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!visited.has(next) && !exclude.has(next)) stack.push(next);
    }
  }
  return visited;
}

function classify() {
  const graph = buildGraph();
  const mobileReachable = reachableFrom(graph, MOBILE_ENTRY);
  const nonMobileReachable = reachableFrom(graph, DESKTOP_ENTRY, new Set([MOBILE_ENTRY]));

  const mobileOnly = new Set([...mobileReachable].filter((f) => !nonMobileReachable.has(f)));
  const desktopOnly = new Set([...nonMobileReachable].filter((f) => !mobileReachable.has(f)));

  const toRel = (f) => path.relative(ROOT, f).split(path.sep).join("/");
  return {
    mobileOnly: [...mobileOnly].map(toRel).sort(),
    desktopOnly: [...desktopOnly].map(toRel).sort(),
  };
}

// --- relevance check ---------------------------------------------------------

function isRelevant(relPath, platform, classification) {
  if (matches(NEVER_RELEVANT, relPath)) return false;
  if (matches(IOS_ONLY, relPath)) return platform === "mobile";
  if (matches(MACOS_ONLY, relPath)) return platform === "desktop";

  if (relPath.startsWith("src/")) {
    if (platform === "desktop" && classification.mobileOnly.includes(relPath)) return false;
    if (platform === "mobile" && classification.desktopOnly.includes(relPath)) return false;
    return true; // shared, or not in either graph (e.g. main.tsx) — conservative default
  }

  return true; // unclassified outside src/ (config, src-tauri Rust, lockfiles…) — conservative default
}

// --- CLI ----------------------------------------------------------------------

async function readStdinLines() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

const [, , cmd, arg] = process.argv;

if (cmd === "classify") {
  process.stdout.write(JSON.stringify(classify(), null, 2) + "\n");
} else if (cmd === "check") {
  const platform = arg;
  if (platform !== "desktop" && platform !== "mobile") {
    console.error(`Usage: platform-reachability.mjs check <desktop|mobile>`);
    process.exit(2);
  }
  const changed = await readStdinLines();
  if (changed.length === 0) {
    console.error("No changed files given — building to be safe.");
    process.exit(0);
  }
  const classification = classify();
  const relevantFiles = changed.filter((f) => isRelevant(f, platform, classification));
  console.error(`Changed files (${changed.length}): ${changed.join(", ")}`);
  if (relevantFiles.length > 0) {
    console.error(`Relevant to ${platform}: ${relevantFiles.join(", ")} — build should run.`);
    process.exit(0);
  }
  console.error(`Nothing relevant to ${platform} — build can be skipped.`);
  process.exit(1);
} else {
  console.error("Usage: platform-reachability.mjs classify | check <desktop|mobile>");
  process.exit(2);
}
