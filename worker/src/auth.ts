import { betterAuth } from "better-auth";
import { bearer, emailOTP } from "better-auth/plugins";
import { Pool } from "pg";
import { authCookieSecure, isLocalAuthHost, isLocalAuthRuntime, resolveAuthBaseURL } from "./authUrl.ts";
import { databaseUrl, type Env } from "./env.ts";

export type AuthDatabase = Pool | { db: object; type: "postgres" };
export type AuthInstance = ReturnType<typeof createAuth>;

async function sendOtpEmail(env: Env, email: string, otp: string, type: string): Promise<void> {
  const subject = type === "forget-password"
    ? "Reset your Nuvo sign-in"
    : "Your Nuvo sign-in code";
  const text = `Your code is ${otp}. It expires in 5 minutes.\n\nIf you did not request this, ignore the email.`;
  if (!env.RESEND_API_KEY) {
    if (isLocalAuthRuntime(env)) {
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
      bearer(),
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
