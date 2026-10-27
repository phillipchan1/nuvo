/**
 * Strip tokens and bearer material before a string leaves the process.
 * Used for server-side error logs. Client responses stay generic codes.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/ya29\.[A-Za-z0-9._\-~]+/g, "[redacted]")
    .replace(/1\/\/[A-Za-z0-9._\-~]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/g, "[redacted]")
    .replace(/(refresh_token|access_token|id_token|client_secret)([=:])\s*[^\s&"]+/gi, "$1$2[redacted]")
    .replace(/([?&\s]code=)4\/[^\s&"]+/gi, "$1[redacted]");
}

export function logServerError(scope: string, err: unknown): void {
  const raw = err instanceof Error ? err.message : String(err);
  console.error(`[${scope}]`, redactSecrets(raw));
}
