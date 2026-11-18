import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetWorkersEnabledForTests, setWorkersEnabled } from "../../src/lib/backend";
import {
  fetchWithDelta,
  mergeDelta,
  resetDeltaCursorsForTests,
} from "../../src/lib/sync/rangeDelta";

beforeEach(() => {
  resetDeltaCursorsForTests();
  resetWorkersEnabledForTests();
  setWorkersEnabled(true);
});

describe("mergeDelta", () => {
  const id = (row: { id: string }) => row.id;

  it("overlays updates, drops missing ids, and appends new ones", () => {
    const prev = [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
      { id: "c", title: "C" },
    ];
    const next = mergeDelta(
      prev,
      [{ id: "b", title: "B2" }, { id: "d", title: "D" }],
      ["a", "b", "d"],
      id,
    );
    expect(next).toEqual([
      { id: "a", title: "A" },
      { id: "b", title: "B2" },
      { id: "d", title: "D" },
    ]);
  });

  it("a missing id is a delete, including a calendar move-out", () => {
    const prev = [
      { id: "stay", start: "9" },
      { id: "moved", start: "10" },
    ];
    expect(mergeDelta(prev, [], ["stay"], id)).toEqual([{ id: "stay", start: "9" }]);
  });
});

describe("fetchWithDelta", () => {
  it("uses the full read on the first fetch, then a quiet delta", async () => {
    const full = vi.fn(async () => [{ id: "a", title: "A" }]);
    const request = vi.fn(async () => {
      throw new Error("delta should not run on the first fetch");
    });
    const first = await fetchWithDelta({
      table: "tasks",
      search: new URLSearchParams({ select: "id,title" }),
      cursorKey: "tasks:test",
      identity: (row: { id: string }) => row.id,
      prev: undefined,
      full,
      request,
    });
    expect(first).toEqual([{ id: "a", title: "A" }]);
    expect(full).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();

    request.mockImplementation(async () =>
      new Response(JSON.stringify({ updated: [], ids: ["a"], read_at: "2026-11-18T00:00:01.000Z" }), {
        status: 200,
        headers: { "X-Nuvo-Delta": "1", "X-Read-At": "2026-11-18T00:00:01.000Z" },
      }),
    );
    const second = await fetchWithDelta({
      table: "tasks",
      search: new URLSearchParams({ select: "id,title" }),
      cursorKey: "tasks:test",
      identity: (row: { id: string }) => row.id,
      prev: first,
      full,
      request,
    });
    expect(second).toEqual([{ id: "a", title: "A" }]);
    expect(full).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    const url = request.mock.calls[0]?.[0] as string;
    expect(url).toContain("nuvo_since=");
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({ Prefer: "nuvo-delta" });
  });

  it("paints an update and a delete from the delta body", async () => {
    const full = vi.fn(async () => [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
    ]);
    await fetchWithDelta({
      table: "tasks",
      search: new URLSearchParams({ select: "id,title" }),
      cursorKey: "tasks:edit",
      identity: (row: { id: string }) => row.id,
      prev: undefined,
      full,
    });
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            updated: [{ id: "a", title: "A2" }],
            ids: ["a"],
            read_at: "2026-11-18T00:00:02.000Z",
          }),
          { status: 200, headers: { "X-Nuvo-Delta": "1" } },
        ),
    );
    const next = await fetchWithDelta({
      table: "tasks",
      search: new URLSearchParams({ select: "id,title" }),
      cursorKey: "tasks:edit",
      identity: (row: { id: string }) => row.id,
      prev: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
      full,
      request,
    });
    expect(next).toEqual([{ id: "a", title: "A2" }]);
  });

  it("falls back to the full array when the Worker does not know Prefer: nuvo-delta", async () => {
    const full = vi.fn(async () => [{ id: "a", title: "A" }]);
    await fetchWithDelta({
      table: "tasks",
      search: new URLSearchParams({ select: "id" }),
      cursorKey: "tasks:old-worker",
      identity: (row: { id: string }) => row.id,
      prev: undefined,
      full,
    });
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: "PGRST122" }), { status: 400 }),
    );
    const next = await fetchWithDelta({
      table: "tasks",
      search: new URLSearchParams({ select: "id" }),
      cursorKey: "tasks:old-worker",
      identity: (row: { id: string }) => row.id,
      prev: [{ id: "a", title: "A" }],
      full,
      request,
    });
    expect(next).toEqual([{ id: "a", title: "A" }]);
    expect(full).toHaveBeenCalledTimes(2);

    request.mockClear();
    await fetchWithDelta({
      table: "tasks",
      search: new URLSearchParams({ select: "id" }),
      cursorKey: "tasks:old-worker",
      identity: (row: { id: string }) => row.id,
      prev: [{ id: "a", title: "A" }],
      full,
      request,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("a reset body refetches the full list", async () => {
    const full = vi.fn(async () => [{ id: "a" }]);
    full.mockResolvedValueOnce([{ id: "old" }]);
    full.mockResolvedValueOnce([{ id: "new" }]);
    await fetchWithDelta({
      table: "external_events",
      search: new URLSearchParams({ select: "id" }),
      cursorKey: "events:reset",
      identity: (row: { id: string }) => row.id,
      prev: undefined,
      full,
    });
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ reset: true, read_at: "2026-11-18T00:00:03.000Z" }), {
          status: 200,
          headers: { "X-Nuvo-Delta": "1" },
        }),
    );
    const next = await fetchWithDelta({
      table: "external_events",
      search: new URLSearchParams({ select: "id" }),
      cursorKey: "events:reset",
      identity: (row: { id: string }) => row.id,
      prev: [{ id: "old" }],
      full,
      request,
    });
    expect(next).toEqual([{ id: "new" }]);
    expect(full).toHaveBeenCalledTimes(2);
  });
});
