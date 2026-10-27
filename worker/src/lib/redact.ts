/**
 * Strip tokens and bearer material before a string leaves the process.
 * Used for server-side error logs. Client responses stay generic codes.
 */
const TOKEN_KEYS =
  "refresh_token|access_token|id_token|client_secret|refreshToken|accessToken|idToken|clientSecret|app_password|appPassword|password";

export function redactSecrets(text: string): string {
  return text
    .replace(/ya29\.[A-Za-z0-9._\-~]+/g, "[redacted]")
    .replace(/1\/\/[A-Za-z0-9._\-~]+/g, "[redacted]")
    .replace(/\bM\.C[A-Za-z0-9._\-~]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/Basic\s+\S+/gi, "Basic [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+(?:\.[A-Za-z0-9._-]+)?\b/g, "[redacted]")
    .replace(/\bhttps?:\/\/[^/\s"'<>]+?:[^/\s"'<>]+?@/gi, (m) => `${m.split("://")[0]}://[redacted]@`)
    .replace(
      new RegExp(`(["']?(?:${TOKEN_KEYS})["']?\\s*[:=]\\s*)(["'])([^"'\\\\]+)\\2`, "gi"),
      "$1$2[redacted]$2",
    )
    .replace(new RegExp(`(["']?(?:${TOKEN_KEYS})["']?\\s*[:=]\\s*)([^\\s&"'\\\\]+)`, "gi"), "$1[redacted]")
    .replace(new RegExp(`((?:${TOKEN_KEYS})%3[Dd])[^&\\s]+`, "gi"), "$1[redacted]")
    .replace(/((?:^|[?&\s"'=(]|%26)code(?:=|%3[Dd]))4\/[^\s&"]+/gi, "$1[redacted]");
}

export function logServerError(scope: string, err: unknown): void {
  const raw = err instanceof Error ? err.message : String(err);
  console.error(`[${scope}]`, redactSecrets(raw));
}
