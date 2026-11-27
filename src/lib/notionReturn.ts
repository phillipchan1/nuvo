/**
 * Back from Notion's consent screen (D-257) the Worker lands on `?notion=…`.
 * Read it once and drop it, so a reload doesn't reopen Settings. Each shell
 * opens Settings → Apps & devices → Notion its own way; this is the only reader of the flag.
 */
export function takeNotionReturn(): boolean {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("notion")) return false;
  url.searchParams.delete("notion");
  window.history.replaceState(window.history.state, "", url.toString());
  return true;
}
