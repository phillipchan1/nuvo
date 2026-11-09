import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A baked desktop build: VITE_API_BASE_URL is set at build time, but the app
// stays on Supabase (PostgREST + GoTrue) until the launch probe flips it.
vi.mock("../src/lib/authClient", () => ({ signedBearerToken: () => "ba-token" }));
vi.mock("../src/lib/workerSession", () => ({
  workerSession: async () => ({ user: { id: "worker-user" }, access_token: "ba-token" }),
}));

const API = "https://api.nuvo.day/api";
const seen: { url: string; auth: string | null }[] = [];

beforeAll(() => {
  vi.stubEnv("VITE_API_BASE_URL", API);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    seen.push({ url: req.url, auth: req.headers.get("Authorization") });
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("baked Worker URL: runtime flip", () => {
  it("pre-flip: PostgREST on Supabase, GoTrue answers the session", async () => {
    const backend = await import("../src/lib/backend");
    const { supabase, supabaseUrl, supabaseConfigured } = await import("../src/lib/supabase");
    expect(supabaseConfigured).toBe(true);
    expect(backend.workersEnabled).toBe(false);

    seen.length = 0;
    await supabase.from("tasks").select("id");
    expect(seen).toHaveLength(1);
    expect(seen[0].url.startsWith(`${supabaseUrl}/rest/v1/tasks?`)).toBe(true);

    const { data } = await supabase.auth.getSession();
    expect(data.session).toBeNull(); // GoTrue's own empty storage, not the Worker's user
  });

  it("post-flip: the same client routes to the Worker with the Better Auth bearer", async () => {
    const backend = await import("../src/lib/backend");
    const { supabase } = await import("../src/lib/supabase");
    backend.setWorkersEnabled(true);
    try {
      seen.length = 0;
      await supabase.from("tasks").select("id");
      expect(seen).toHaveLength(1);
      expect(seen[0].url.startsWith(`${API}/rest/v1/tasks?`)).toBe(true);
      expect(seen[0].auth).toBe("Bearer ba-token");

      const { data } = await supabase.auth.getSession();
      expect(data.session?.user.id).toBe("worker-user");
    } finally {
      backend.resetWorkersEnabledForTests();
    }
  });
});
