#!/usr/bin/env node
/**
 * Reset the QA account to the QA world (scripts/qa/fixture.mjs, qa/WORLD.md).
 *
 *   QA_API_URL=https://api.nuvo.day/api QA_EMAIL=… QA_PASSWORD=… npm run qa:seed
 *
 * It signs in AS the QA account over the public API and uses only that
 * session's REST surface (/api/rest/v1, worker/src/rest.ts), so every read,
 * wipe and write is scoped to that one user by the server: it cannot reach any
 * other account's rows, needs no database credentials, and works the same
 * against production, the preview Worker, or a local `wrangler dev`.
 *
 * Guards, because "wipe" is in the job description:
 *   • QA_EMAIL must contain "qa" as a word (nuvo-qa@…, qa+bot@…, …); and
 *   • the signed-in session must report exactly that email back.
 * Anything else refuses before a single row is touched.
 *
 * Flags: --dry-run (sign in, print the plan, write nothing) · --json (summary as JSON)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorld } from "./fixture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");

const API = (process.env.QA_API_URL ?? "").replace(/\/+$/, "");
const EMAIL = process.env.QA_EMAIL ?? "";
const PASSWORD = process.env.QA_PASSWORD ?? "";
// Better Auth checks Origin on credentialed POSTs; send the app's own.
const ORIGIN = process.env.QA_APP_URL ? new URL(process.env.QA_APP_URL).origin : "https://app.nuvo.day";

export const QA_EMAIL_RULE = /(^|[^a-z0-9])qa([^a-z0-9]|$)/i;

function die(msg) {
  console.error(`qa:seed — ${msg}`);
  process.exit(1);
}

if (!API || !EMAIL || !PASSWORD) die("set QA_API_URL, QA_EMAIL and QA_PASSWORD");
if (!QA_EMAIL_RULE.test(EMAIL.split("@")[0])) {
  die(`refusing: "${EMAIL}" is not a QA account (its local part must contain "qa" as a word)`);
}

// ── HTTP ───────────────────────────────────────────────────────────────────

let bearer = "";

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, ok: res.ok, json, text };
}

const rest = (method, table, query = "", body, prefer = "return=minimal") =>
  call(method, `/rest/v1/${table}${query}`, body, { Prefer: prefer });

// ── sign in, and prove who we are ──────────────────────────────────────────

const signIn = await call("POST", "/auth/sign-in/email", { email: EMAIL, password: PASSWORD });
if (!signIn.ok) die(`sign-in failed (${signIn.status}): ${signIn.text.slice(0, 200)}`);
bearer = signIn.json?.token ?? "";
if (!bearer) die("sign-in returned no token");
const who = await call("GET", "/auth/get-session");
const sessionEmail = who.json?.user?.email ?? "";
if (sessionEmail.toLowerCase() !== EMAIL.toLowerCase()) {
  die(`refusing: the session belongs to "${sessionEmail || "nobody"}", not ${EMAIL}`);
}
// Settings are keyed by the PLANNER user id, which can differ from the auth id.
const settingsRow = await rest("GET", "user_settings", "?select=user_id", undefined, "return=representation");
const plannerId = settingsRow.json?.[0]?.user_id;
if (!plannerId) die(`could not read user_settings (${settingsRow.status})`);

const ent = await call("GET", "/entitlement");
const entitled = ent.json?.entitled === true;

const world = buildWorld();
const { tables, settings } = world;
const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));

console.log(`qa:seed — ${EMAIL} on ${API}`);
console.log(`  today ${world.today} (week of ${world.mon}) · entitled: ${entitled ? "yes" : "NO"}`);
if (DRY) {
  console.log("  --dry-run: would wipe and insert", counts);
  process.exit(0);
}

// ── wipe: children first ───────────────────────────────────────────────────
// A delete needs a filter (rest.ts refuses a bare DELETE); `id=not.is.null`
// matches every row, and the server ANDs the session's owner clause onto it.

const WIPE = [
  ["task_labels", "?task_id=not.is.null"],
  ["reminders", "?id=not.is.null"],
  ["record_comments", "?id=not.is.null"],
  ["activity_bindings", "?id=not.is.null"],
  ["tasks", "?id=not.is.null"],
  ["slots", "?id=not.is.null"],
  ["recurrences", "?id=not.is.null"],
  ["week_reviews", "?id=not.is.null"],
  ["key_results", "?id=not.is.null"],
  ["projects", "?id=not.is.null"],
  ["initiatives", "?id=not.is.null"],
  ["sprints", "?id=not.is.null"],
  ["labels", "?id=not.is.null"],
  ["event_domain_routing", "?event_key=not.is.null"],
  // domains are NOT here: every authenticated request re-creates the four
  // defaults when a user has none (store.ts ensureSettingsAndDomains). The
  // fixture's domains go in first; the old ones are removed after (below).
];

// A self-reference (tasks.parent_task_id) or a slot a task points at can make a
// one-shot delete refuse; clear the pointers first.
await rest("PATCH", "tasks", "?id=not.is.null", { slot_id: null, parent_task_id: null });

const warnings = [];
for (const [table, filter] of WIPE) {
  const r = await rest("DELETE", table, filter);
  if (!r.ok) {
    // A table this environment doesn't serve is not a reason to stop.
    if (r.status === 404 || /does not exist|not exposed|unknown table/i.test(r.text)) {
      warnings.push(`${table}: not in this environment, skipped`);
      continue;
    }
    die(`wipe ${table} failed (${r.status}): ${r.text.slice(0, 300)}`);
  }
}

// ── insert, tolerating schema drift ────────────────────────────────────────
// Production has columns a local or preview database may not (see
// docs/cloudflare-migration). When the server names a column it lacks, drop it
// from every row and retry — loudly, so drift is visible, never silent.

// A bulk insert takes the union of the rows' keys and writes NULL where a row
// lacks one — which trips NOT NULL columns that have a default. So rows go in
// grouped by their exact key set: a column a row doesn't name gets its default.
async function insert(table, rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = Object.keys(r).sort().join(",");
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const group of groups.values()) await insertGroup(table, group);
}

async function insertGroup(table, rows) {
  let batch = rows.map((r) => ({ ...r }));
  for (let attempt = 0; attempt < 12; attempt++) {
    const r = await rest("POST", table, "", batch);
    if (r.ok) return;
    const missing = /Could not find the '([^']+)' column/.exec(r.json?.message ?? "")?.[1]
      ?? /column [a-z_]+\.([a-z_]+) does not exist/.exec(r.json?.message ?? "")?.[1];
    if (r.status === 400 && missing) {
      warnings.push(`${table}.${missing}: column not in this environment, dropped`);
      batch = batch.map(({ [missing]: _drop, ...rest }) => rest);
      continue;
    }
    die(`insert ${table} failed (${r.status}): ${r.text.slice(0, 300)}`);
  }
  die(`insert ${table}: too many missing columns`);
}

for (const [table, rows] of Object.entries(tables)) await insert(table, rows);

// Now that the fixture's domains exist, every other domain can go.
const keep = tables.domains.map((d) => d.id).join(",");
const oldDomains = await rest("DELETE", "domains", `?id=not.in.(${keep})`);
if (!oldDomains.ok) die(`removing old domains failed (${oldDomains.status}): ${oldDomains.text.slice(0, 300)}`);

// ── settings: onboarded, Monday weeks, a working day ──────────────────────

const orientation = Number(
  /ORIENTATION_VERSION\s*=\s*(\d+)/.exec(
    readFileSync(join(here, "../../src/components/orientation/version.ts"), "utf8"),
  )?.[1] ?? 0,
);
let patch = { ...settings, onboarding_completed_version: orientation };
for (let attempt = 0; attempt < 12; attempt++) {
  const r = await rest("PATCH", "user_settings", `?user_id=eq.${plannerId}`, patch);
  if (r.ok) break;
  const missing = /Could not find the '([^']+)' column/.exec(r.json?.message ?? "")?.[1];
  if (r.status === 400 && missing) {
    warnings.push(`user_settings.${missing}: column not in this environment, dropped`);
    delete patch[missing];
    continue;
  }
  die(`settings failed (${r.status}): ${r.text.slice(0, 300)}`);
}

// ── say what happened ──────────────────────────────────────────────────────

const summary = { email: EMAIL, api: API, today: world.today, week_of: world.mon, entitled, counts, warnings };
if (args.has("--json")) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(14)} ${n}`);
  for (const w of warnings) console.log(`  warn: ${w}`);
}
if (!entitled) {
  console.log("  WARNING: the QA account is not entitled — the app will show the paywall. See qa/README.md § One-time setup.");
}
console.log("seeded");
