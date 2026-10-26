#!/usr/bin/env node
/**
 * Mutation proof for access isolation.
 * Asserts the unmutated tree is green, then deletes each owner filter in
 * store.ts on its own and expects access.check to fail.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const storePath = "worker/src/store.ts";
const originalStore = readFileSync(storePath, "utf8");

const USER_FILTER = /(?:\w+\.)?user_id = \$\{store\.userId\}/g;

function restore() {
  writeFileSync(storePath, originalStore);
}

function runCheck() {
  return spawnSync(process.execPath, ["--experimental-strip-types", "worker/src/access.check.ts"], {
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

function collectFilters() {
  const items = [];
  USER_FILTER.lastIndex = 0;
  for (const match of originalStore.matchAll(USER_FILTER)) {
    items.push({
      path: storePath,
      source: originalStore,
      index: match.index ?? 0,
      text: match[0],
      line: lineOf(originalStore, match.index ?? 0),
    });
  }
  return items;
}

function neutralize(source, index, text) {
  const before = source.slice(0, index);
  const after = source.slice(index + text.length);
  return `${before}(TRUE)${after}`;
}

function expectFail(label, mutate) {
  try {
    mutate();
    const res = runCheck();
    const out = `${res.stdout || ""}\n${res.stderr || ""}`.trim();
    console.log(`\n=== ${label} ===`);
    console.log(out);
    if (res.status === 0) {
      throw new Error(`${label}: isolation check still passed — mutation was not detected`);
    }
    const failed = / (\d+) failed/.exec(out);
    console.log(`${label}: failed as expected (exit ${res.status}, ${failed?.[1] ?? "?"} checks failed)`);
  } finally {
    restore();
  }
}

const baseline = runCheck();
const baselineOut = `${baseline.stdout || ""}\n${baseline.stderr || ""}`.trim();
console.log("=== baseline (unmutated) ===");
console.log(baselineOut);
if (baseline.status !== 0) {
  throw new Error("unmutated isolation check must be green before mutations run");
}
console.log("baseline: isolation check green");

const filters = collectFilters();
if (filters.length === 0) {
  throw new Error("no owner filters found in store.ts");
}
console.log(`derived ${filters.length} owner filters:`);
for (const f of filters) console.log(`  store.ts:${f.line} ${f.text}`);

expectFail("M1 set every user_id filter to TRUE", () => {
  writeFileSync(storePath, originalStore.replace(/(?:\w+\.)?user_id = \$\{store\.userId\}/g, "(TRUE)"));
});

for (const filter of filters) {
  const label = `store.ts:${filter.line} delete \`${filter.text}\``;
  expectFail(label, () => {
    writeFileSync(filter.path, neutralize(filter.source, filter.index, filter.text));
  });
}

console.log(`\nmutation proof: ok (${filters.length}/${filters.length})`);
