import { afterEach, describe, expect, it, vi } from "vitest";
import { resetWorkersEnabledForTests, setWorkersEnabled } from "../src/lib/backend";
import { rememberClientSession, resetClientSessionForTests } from "../src/lib/sessionAuth";
import { workerFrom, workerInvoke, workerRpc } from "../src/lib/workerData";

afterEach(() => {
  resetWorkersEnabledForTests();
  resetClientSessionForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function armWorker() {
  vi.stubEnv("VITE_API_BASE_URL", "https://api.nuvo.day");
  setWorkersEnabled(true);
  rememberClientSession({ user: { id: "user-1" }, access_token: "signed.jwt" });
}

describe("workerFrom", () => {
  it("lists then filters/orders/projects client-side", async () => {
    armWorker();
    const fetchMock = vi.fn(async () =>
      jsonOk({
        data: [
          { id: "2", title: "Later", status: "open", rank: 2 },
          { id: "1", title: "Keep", status: "open", rank: 1 },
          { id: "3", title: "Done", status: "done", rank: 3 },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { data, error } = await workerFrom("tasks")
      .select("id,title")
      .eq("status", "open")
      .order("rank", { ascending: true });

    expect(error).toBeNull();
    expect(data).toEqual([
      { id: "1", title: "Keep" },
      { id: "2", title: "Later" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.nuvo.day/api/data/tasks");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET" });
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer signed.jwt");
  });

  it("nests key_results on initiatives", async () => {
    armWorker();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk({ data: [{ id: "ini-1", name: "Ship" }] }))
      .mockResolvedValueOnce(jsonOk({
        data: [
          { id: "kr-1", initiative_id: "ini-1", title: "A" },
          { id: "kr-2", initiative_id: "other", title: "B" },
        ],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const { data, error } = await workerFrom("initiatives").select("*, key_results(*)").eq("id", "ini-1");
    expect(error).toBeNull();
    expect(data).toEqual([
      {
        id: "ini-1",
        name: "Ship",
        key_results: [{ id: "kr-1", initiative_id: "ini-1", title: "A" }],
      },
    ]);
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://api.nuvo.day/api/data/key_results");
  });

  it("PATCHes a row by id", async () => {
    armWorker();
    const fetchMock = vi.fn(async () => jsonOk({ data: { id: "t1", title: "Renamed" } }));
    vi.stubGlobal("fetch", fetchMock);

    const { data, error } = await workerFrom("tasks").update({ title: "Renamed" }).eq("id", "t1").select("id,title").maybeSingle();
    expect(error).toBeNull();
    expect(data).toEqual({ id: "t1", title: "Renamed" });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.nuvo.day/api/data/tasks/t1");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PATCH" });
  });

  it("puts HTTP status on 4xx so classifyError parks instead of retrying", async () => {
    armWorker();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "not found" }), { status: 404 })),
    );
    const { error } = await workerFrom("tasks").update({ status: "done" }).eq("id", "t1");
    expect(error?.status).toBe(404);
    expect(error?.code).toBe("404");
  });
});

describe("workerRpc / workerInvoke", () => {
  it("POSTs /api/rpc/:name", async () => {
    armWorker();
    const fetchMock = vi.fn(async () => jsonOk({ data: [{ email: "a@b.c" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const { data, error } = await workerRpc("contacts", {});
    expect(error).toBeNull();
    expect(data).toEqual([{ email: "a@b.c" }]);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.nuvo.day/api/rpc/contacts");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
  });

  it("POSTs the edge-function URL with the signed bearer", async () => {
    armWorker();
    const fetchMock = vi.fn(async () => jsonOk({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { data, error } = await workerInvoke("task-mirror", { taskId: "t1" });
    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.nuvo.day/api/task-mirror");
  });
});
