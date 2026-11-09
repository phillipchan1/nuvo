// App Store env for the edge functions. Signed data is verified in
// appleJws.ts — there is deliberately no unverified JWS decoder here.
// No prices. Product ids come from env (NUVO_IAP_MONTHLY / NUVO_IAP_ANNUAL).

export function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
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
