#!/usr/bin/env node
/**
 * Read-only check of Supabase edge secrets before ANY functions redeploy.
 *
 * Calls `supabase secrets list --project-ref <ref> -o json` and compares
 * WRITE_FREEZE / MAINTENANCE_WRITE_FREEZE digests to sha256 hex of the
 * values writeFreeze.ts treats as unfrozen ('', '0', 'false', 'no', 'off').
 * Absent → PASS. Known-off digest → PASS. Anything else, a missing digest
 * field, or an unexpected JSON shape → FAIL (nonzero).
 *
 * Prints only secret names and PASS/FAIL. Never digests or values.
 * Tests import evaluateSecretsList with fixture JSON — they must not
 * spawn supabase.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Same names writeFreeze.ts ORs. */
export const WATCHED_SECRETS = Object.freeze(["WRITE_FREEZE", "MAINTENANCE_WRITE_FREEZE"]);

/**
 * Exact strings writeFreeze.ts treats as unfrozen after trim+lower:
 * empty, plus EXPLICIT_OFF. Digests are of these raw bytes, not the
 * trimmed/lowercased form of some other spelling.
 */
export const UNFROZEN_VALUES = Object.freeze(["", "0", "false", "no", "off"]);

export function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function knownOffDigests() {
  return new Set(UNFROZEN_VALUES.map(sha256Hex));
}

function failClosed(lines, message) {
  lines.push(message);
  return { ok: false, lines };
}

/**
 * @param {unknown} parsed  JSON from `supabase secrets list -o json`
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function evaluateSecretsList(parsed) {
  const lines = [];
  if (!Array.isArray(parsed)) {
    return failClosed(lines, "secrets-list FAIL unexpected JSON shape");
  }
  const byName = new Map();
  for (const row of parsed) {
    if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.name !== "string" || !row.name) {
      return failClosed(lines, "secrets-list FAIL unexpected JSON shape");
    }
    byName.set(row.name, row);
  }
  const off = knownOffDigests();
  let ok = true;
  for (const name of WATCHED_SECRETS) {
    if (!byName.has(name)) {
      lines.push(`${name} PASS`);
      continue;
    }
    const row = byName.get(name);
    if (typeof row.digest !== "string" || row.digest.length === 0) {
      lines.push(`${name} FAIL`);
      ok = false;
      continue;
    }
    if (off.has(row.digest.toLowerCase())) {
      lines.push(`${name} PASS`);
    } else {
      lines.push(`${name} FAIL`);
      ok = false;
    }
  }
  return { ok, lines };
}

export function parseProjectRef(argv) {
  const args = [...argv];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project-ref" && args[i + 1]) return args[i + 1];
    if (args[i].startsWith("--project-ref=")) return args[i].slice("--project-ref=".length);
  }
  return (process.env.SUPABASE_PROJECT_REF || "").trim();
}

export function main(argv = process.argv.slice(2), spawn = spawnSync) {
  const ref = parseProjectRef(argv);
  if (!ref) {
    console.error("usage: node scripts/preflight-edge-write-freeze.mjs --project-ref <ref>");
    return 2;
  }
  const spawned = spawn("supabase", ["secrets", "list", "--project-ref", ref, "-o", "json"], {
    encoding: "utf8",
  });
  if (spawned.status !== 0) {
    console.error("secrets-list FAIL");
    return 1;
  }
  let parsed;
  try {
    parsed = JSON.parse(spawned.stdout ?? "");
  } catch {
    console.error("secrets-list FAIL unexpected JSON shape");
    return 1;
  }
  const result = evaluateSecretsList(parsed);
  for (const line of result.lines) console.log(line);
  return result.ok ? 0 : 1;
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  process.exit(main());
}
