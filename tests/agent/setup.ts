// Make a Deno edge module importable from vitest.
//
// Runs before any test module, so `Deno.env.get(...)` at the top of
// _shared/admin.ts resolves instead of throwing on a missing global.
const env: Record<string, string> = {
  SUPABASE_URL: "https://test.supabase.local",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
};

(globalThis as unknown as { Deno: unknown }).Deno = {
  env: {
    get: (k: string) => env[k],
    set: (k: string, v: string) => {
      env[k] = v;
    },
  },
};
