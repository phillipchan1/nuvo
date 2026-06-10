import { createClient } from "npm:@supabase/supabase-js@2";

/** Service-role client. All edge functions run with full DB access; RLS
 *  protects the browser, not these functions. */
export const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function handleOptions(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return null;
}

export async function logSync(
  provider: string,
  operation: string,
  status: "ok" | "error",
  error?: string,
  userId?: string,
) {
  await admin.from("sync_log").insert({
    provider,
    operation,
    status,
    error: error ?? null,
    user_id: userId ?? null,
  });
}

/** Resolve the authenticated user from a request's Authorization header. */
export async function requireUser(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Response("Unauthorized", { status: 401 });
  return data.user;
}

// ── Vault helpers (via security-definer RPCs) ──────────────────────────
export async function storeSecret(name: string, secret: string): Promise<string> {
  const { data, error } = await admin.rpc("store_secret", { p_name: name, p_secret: secret });
  if (error) throw new Error(`store_secret failed: ${error.message}`);
  return data as string;
}

export async function readSecret(id: string): Promise<string | null> {
  const { data, error } = await admin.rpc("read_secret", { p_id: id });
  if (error) throw new Error(`read_secret failed: ${error.message}`);
  return (data as string | null) ?? null;
}

// ── Signed OAuth state (HMAC with the service role key) ────────────────
async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function signState(payload: Record<string, string>): Promise<string> {
  const body = btoa(JSON.stringify(payload)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${body}.${await hmac(body)}`;
}

export async function verifyState(state: string): Promise<Record<string, string>> {
  const [body, sig] = state.split(".");
  if (!body || !sig || (await hmac(body)) !== sig) throw new Error("bad oauth state");
  return JSON.parse(atob(body.replaceAll("-", "+").replaceAll("_", "/")));
}

/** Today's date in the app timezone. */
export function todayLA(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
