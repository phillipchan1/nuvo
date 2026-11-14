/**
 * `RESEND_FROM`-style sender ("Nuvo <noreply@inbox.nuvo.day>" or a bare
 * address) → what the Cloudflare `send_email` binding takes: `{ name, email }`
 * when there is a display name, else the bare address. Same value as before;
 * only the shape changes.
 */
export function mailFrom(raw: string): string | { name: string; email: string } {
  const m = /^\s*(.*?)\s*<\s*([^<>\s]+)\s*>\s*$/.exec(raw);
  if (!m) return raw.trim();
  const name = m[1].replace(/^"(.*)"$/, "$1").trim();
  return name ? { name, email: m[2] } : m[2];
}
