/**
 * Compare a shipped app version to the maintenance `min_version`.
 * CI rewrites package.json to major.minor.run before a release build.
 */
export function parseVersion(raw: string | null | undefined): [number, number, number] | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function isBelowMinVersion(current: string, minimum: string): boolean {
  const a = parseVersion(current);
  const b = parseVersion(minimum);
  if (!a || !b) return false;
  if (a[0] !== b[0]) return a[0] < b[0];
  if (a[1] !== b[1]) return a[1] < b[1];
  return a[2] < b[2];
}

export function readMinVersion(body: {
  min_version?: unknown;
  min_client_version?: unknown;
  minimum_version?: unknown;
}): string | null {
  for (const key of ["min_version", "min_client_version", "minimum_version"] as const) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
