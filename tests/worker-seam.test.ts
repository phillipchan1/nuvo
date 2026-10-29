import { afterEach, describe, expect, it, vi } from "vitest";
import { SUPABASE_ONLY_FUNCTIONS, workerRoute } from "../src/lib/workerRoute";

const SUPA = "https://example.supabase.co";
const API = "https://api.nuvo.day/api";

describe("workerRoute — where a Supabase-bound request goes on the Worker path", () => {
  it("sends PostgREST tables and rpcs to the Worker's subset, query intact", () => {
    expect(workerRoute(`${SUPA}/rest/v1/tasks?select=*%2Ctask_labels(label_id)&status=eq.inbox`, SUPA, API)).toBe(
      `${API}/rest/v1/tasks?select=*%2Ctask_labels(label_id)&status=eq.inbox`,
    );
    expect(workerRoute(`${SUPA}/rest/v1/rpc/apply_patch`, SUPA, API)).toBe(`${API}/rest/v1/rpc/apply_patch`);
  });

  it("sends edge functions to their Worker twin", () => {
    expect(workerRoute(`${SUPA}/functions/v1/google-events`, SUPA, API)).toBe("https://api.nuvo.day/functions/v1/google-events");
    expect(workerRoute(`${SUPA}/functions/v1/task-mirror`, SUPA, "http://localhost:5717/api")).toBe(
      "http://localhost:5717/functions/v1/task-mirror",
    );
  });

  it("leaves billing, GoTrue, storage and other hosts alone", () => {
    for (const fn of SUPABASE_ONLY_FUNCTIONS) {
      expect(workerRoute(`${SUPA}/functions/v1/${fn}`, SUPA, API)).toBeNull();
    }
    expect(workerRoute(`${SUPA}/auth/v1/token?grant_type=refresh_token`, SUPA, API)).toBeNull();
    expect(workerRoute(`${SUPA}/storage/v1/object/x`, SUPA, API)).toBeNull();
    expect(workerRoute("https://www.googleapis.com/rest/v1/tasks", SUPA, API)).toBeNull();
  });

  it("routes nothing when there is no Worker base (flag off)", () => {
    expect(workerRoute(`${SUPA}/rest/v1/tasks`, SUPA, "")).toBeNull();
  });
});

describe("flag off: the Supabase client is untouched", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("queries go to Supabase's PostgREST, not the Worker", async () => {
    const { workersEnabled } = await import("../src/lib/backend");
    expect(workersEnabled).toBe(false);
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      seen.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const { supabase, supabaseUrl } = await import("../src/lib/supabase");
    await supabase.from("tasks").select("id").eq("status", "inbox");
    expect(seen).toHaveLength(1);
    expect(seen[0].startsWith(`${supabaseUrl}/rest/v1/tasks?`)).toBe(true);
  });

  it("supabase.auth is GoTrue's own, not the Better Auth bridge", async () => {
    const { supabase } = await import("../src/lib/supabase");
    const proto = Object.getPrototypeOf(supabase.auth) as { getSession: unknown; getUser: unknown };
    expect(Object.prototype.hasOwnProperty.call(supabase.auth, "getSession")).toBe(false);
    expect(supabase.auth.getSession).toBe(proto.getSession);
    expect(supabase.auth.getUser).toBe(proto.getUser);
  });
});
