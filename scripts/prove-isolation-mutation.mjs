#!/usr/bin/env node
/**
 * Mutation proof for access isolation.
 * Asserts the unmutated tree is green, then deletes each owner filter in
 * store.ts on its own and expects access.check to fail — and each owner clause
 * in rest.ts (the SPA's PostgREST subset) and expects rest.check to fail.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const storePath = "worker/src/store.ts";
const originalStore = readFileSync(storePath, "utf8");

const USER_FILTER = /(?:\w+\.)?user_id = \$\{store\.userId\}/g;

const restPath = "worker/src/rest.ts";
const originalRest = readFileSync(restPath, "utf8");

// `${alias}."user_id" = …`, `o."user_id" = …` (task_labels via its task),
// `r."user_id" = …` (FK / reminder targets), `cd.` / `ev.` (contacts).
const REST_OWNER = /(?:\$\{alias\}|\b(?:o|r|cd|ev))\."user_id" = \$\{[^}]+\}/g;

function restore() {
  writeFileSync(storePath, originalStore);
  writeFileSync(restPath, originalRest);
}

function runCheck(file = "worker/src/access.check.ts") {
  return spawnSync(process.execPath, ["--experimental-strip-types", file], {
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

function expectFail(label, mutate, check) {
  try {
    mutate();
    const res = runCheck(check);
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

const restBaseline = runCheck("worker/src/rest.check.ts");
if (restBaseline.status !== 0) {
  console.log(`${restBaseline.stdout || ""}\n${restBaseline.stderr || ""}`.trim());
  throw new Error("unmutated rest check must be green before mutations run");
}
const restFilters = [...originalRest.matchAll(REST_OWNER)].map((m) => ({
  index: m.index ?? 0,
  text: m[0],
  line: lineOf(originalRest, m.index ?? 0),
}));
if (restFilters.length === 0) {
  throw new Error("no owner clauses found in rest.ts");
}
console.log(`\nderived ${restFilters.length} rest.ts owner clauses:`);
for (const f of restFilters) console.log(`  rest.ts:${f.line} ${f.text}`);
for (const filter of restFilters) {
  expectFail(
    `rest.ts:${filter.line} delete \`${filter.text}\``,
    () => writeFileSync(restPath, neutralize(originalRest, filter.index, filter.text)),
    "worker/src/rest.check.ts",
  );
}

console.log(`\nmutation proof: ok (${filters.length}/${filters.length} store, ${restFilters.length}/${restFilters.length} rest)`);
