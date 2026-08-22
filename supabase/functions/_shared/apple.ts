// App Store Server Notifications V2 + StoreKit transaction payloads.
// No prices. Product ids come from env (NUVO_IAP_MONTHLY / NUVO_IAP_ANNUAL).

export function decodeJwsPayload(jws: string): Record<string, unknown> {
  const parts = jws.split(".");
  if (parts.length < 2) throw new Error("not a JWS");
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const pad = payload.length % 4 === 0 ? "" : "=".repeat(4 - (payload.length % 4));
  const json = atob(payload + pad);
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("JWS payload is not an object");
  return parsed as Record<string, unknown>;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** Apple sends expiresDate as milliseconds since epoch (number or numeric string). */
export function appleDateToIso(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return new Date(Number(value)).toISOString();
  }
  return null;
}

export function appleBundleId(): string | null {
  return Deno.env.get("APPLE_BUNDLE_ID")?.trim() || null;
}

export function notificationSecretOk(req: Request): boolean {
  const secret = Deno.env.get("APPLE_NOTIFICATION_SECRET")?.trim();
  if (!secret) return true;
  try {
    return new URL(req.url).searchParams.get("secret") === secret;
  } catch {
    return false;
  }
}

export function readIapEnv(): { NUVO_IAP_MONTHLY?: string; NUVO_IAP_ANNUAL?: string } {
  return {
    NUVO_IAP_MONTHLY: Deno.env.get("NUVO_IAP_MONTHLY") ?? undefined,
    NUVO_IAP_ANNUAL: Deno.env.get("NUVO_IAP_ANNUAL") ?? undefined,
  };
}
