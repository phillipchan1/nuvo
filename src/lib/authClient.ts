/**
 * Better Auth browser client. Lazy-imported only when VITE_API_BASE_URL is set.
 */
import { createAuthClient } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { authBaseUrl } from "./backend";

export function createNuvoAuthClient() {
  const base = authBaseUrl();
  if (!base) throw new Error("VITE_API_BASE_URL is not set");
  return createAuthClient({
    baseURL: base.replace(/\/api$/, "") || base,
    basePath: "/api/auth",
    plugins: [emailOTPClient()],
    fetchOptions: { credentials: "include" },
  });
}

export type NuvoAuthClient = ReturnType<typeof createNuvoAuthClient>;
