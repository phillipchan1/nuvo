import { betterAuth } from "better-auth";
import { bearer, emailOTP } from "better-auth/plugins";
import { Pool } from "pg";
import { authCookieSecure, isLocalAuthHost, resolveAuthBaseURL } from "./authUrl.ts";
import { databaseUrl, type Env } from "./env.ts";

export type AuthDatabase = Pool | { db: object; type: "postgres" };
export type AuthInstance = ReturnType<typeof createAuth>;

/** Console OTP delivery: `ENVIRONMENT=local` or `ENVIRONMENT=preview` only. Never production. */
export function otpConsoleAllowed(env: Pick<Env, "ENVIRONMENT">): boolean {
  const mode = (env.ENVIRONMENT ?? "").trim().toLowerCase();
  return mode === "local" || mode === "preview";
}

async function sendOtpEmail(env: Env, email: string, otp: string, type: string): Promise<void> {
  const subject = type === "forget-password"
    ? "Reset your Nuvo sign-in"
    : "Your Nuvo sign-in code";
  const text = `Your code is ${otp}. It expires in 5 minutes.\n\nIf you did not request this, ignore the email.`;
  if (!env.RESEND_API_KEY) {
    if (otpConsoleAllowed(env)) {
      console.log(`[auth] OTP for ${email} (${type}): ${otp}`);
    }
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM || "Nuvo <noreply@localhost>",
      to: email,
      subject,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`resend ${res.status}: ${body.slice(0, 200)}`);
  }
}

export function createAuth(env: Env, database: AuthDatabase) {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  const baseURL = resolveAuthBaseURL(env);
  return betterAuth({
    secret,
    baseURL,
    basePath: "/api/auth",
    database,
    // App Review + the existing review login need a password. OTP is the
    // everyday path (same as today's GoTrue email code).
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    trustedOrigins: isLocalAuthHost(baseURL)
      ? [baseURL, "http://localhost:5717", "http://localhost:8787", "http://[::1]:5717", "http://[::1]:8787"]
      : [baseURL],
    advanced: {
      database: {
        generateId: () => crypto.randomUUID(),
      },
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: authCookieSecure(baseURL),
        httpOnly: true,
        path: "/",
      },
    },
    plugins: [
      bearer({ requireSignature: true }),
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        sendVerificationOTP: async ({ email, otp, type }) => {
          await sendOtpEmail(env, email, otp, type);
        },
      }),
    ],
  });
}

/** Fresh Pool + Better Auth per request. Workers cannot reuse I/O across requests. */
export function openAuth(env: Env): { auth: AuthInstance; close: () => Promise<void> } {
  const url = databaseUrl(env);
  if (!url) throw new Error("database is not configured (HYPERDRIVE or DATABASE_URL)");
  const pool = new Pool({ connectionString: url, max: 1 });
  const auth = createAuth(env, pool);
  return {
    auth,
    close: async () => {
      await pool.end();
    },
  };
}

/** Prefer the signed cookie value (`set-auth-token`) over the raw DB session token. */
export async function exposeSignedAuthToken(res: Response): Promise<Response> {
  const signed = res.headers.get("set-auth-token");
  if (!signed) return res;
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return res;
  const text = await res.text();
  try {
    const body = JSON.parse(text) as Record<string, unknown> | null;
    if (body && typeof body === "object") {
      if (typeof body.token === "string" && !body.token.includes(".")) body.token = signed;
      const session = body.session;
      if (session && typeof session === "object") {
        const row = session as Record<string, unknown>;
        if (typeof row.token === "string" && !row.token.includes(".")) row.token = signed;
      }
    }
    return new Response(JSON.stringify(body), {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  } catch {
    return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
  }
}

export async function sessionUser(
  auth: AuthInstance,
  req: Request,
): Promise<{ id: string; email?: string | null } | null> {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.id) return null;
    return { id: session.user.id, email: session.user.email };
  } catch {
    return null;
  }
}
