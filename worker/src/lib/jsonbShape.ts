/**
 * Read-side healing for jsonb columns that were double-encoded on write
 * (`${JSON.stringify(x)}::jsonb` through postgres.js stores a jsonb STRING
 * scalar like "[{...}]" instead of the array/object). Readers route through
 * these so already-bad rows still come back in the right shape.
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Coerce a jsonb value that should be an array. Never throws. */
export function asJsonArray(v: unknown, depth = 0): unknown[] {
  if (Array.isArray(v)) return v;
  if (isPlainObject(v)) return [v];
  if (typeof v === "string" && depth < 2) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(v);
    } catch {
      return [];
    }
    return asJsonArray(parsed, depth + 1);
  }
  return [];
}

/** Unwrap a stringified JSON object/array; anything else passes through. */
export function asJsonValue(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const first = v.trimStart()[0];
  if (first !== "[" && first !== "{") return v;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return v;
  }
}
