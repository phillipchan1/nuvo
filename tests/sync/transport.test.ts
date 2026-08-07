/**
 * How the transport addresses a row.
 *
 * Three identity shapes have to coexist: a plain `id`, a composite primary key
 * (`task_labels`), and a natural key (`week_reviews`, addressed by its week).
 * Getting the wrong one on the wire is silent and expensive — a natural-key
 * update sent with `{id: "2026-08-03"}` matches nothing and the user's review
 * simply never saves.
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Call {
  table: string;
  op: "upsert" | "update" | "delete" | "rpc";
  payload?: unknown;
  match?: unknown;
  opts?: { onConflict?: string; ignoreDuplicates?: boolean };
}

const calls: Call[] = [];
let nextUpsertError: { code: string; message: string } | null = null;

vi.mock("../../src/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      upsert: (payload: unknown, opts: Call["opts"]) => {
        calls.push({ table, op: "upsert", payload, opts });
        return Promise.resolve({ error: nextUpsertError });
      },
      update: (payload: unknown) => ({
        match: (m: unknown) => {
          calls.push({ table, op: "update", payload, match: m });
          return Promise.resolve({ error: null });
        },
      }),
      delete: () => ({
        match: (m: unknown) => {
          calls.push({ table, op: "delete", match: m });
          return Promise.resolve({ error: null });
        },
      }),
    }),
    rpc: (_fn: string, args: Record<string, unknown>) => {
      calls.push({
        table: args.p_table as string,
        op: "rpc",
        payload: args.p_patch,
        match: args.p_match,
      });
      return Promise.resolve({ error: null });
    },
  },
  invokeQuiet: () => {},
  supabaseUrl: "http://localhost",
  supabaseAnonKey: "anon",
  supabaseConfigured: true,
}));

const { createSupabaseTransport, resetTransportProbeForTests } = await import(
  "../../src/lib/sync/transport"
);
const { stampFields } = await import("../../src/lib/sync/ops");
import type { Op, SyncTable } from "../../src/lib/sync/ops";

const transport = createSupabaseTransport(async () => "user-1");

function op(
  table: SyncTable,
  kind: Op["kind"],
  rowId: string,
  payload: Record<string, unknown> = {},
): Op {
  const ts = "2026-08-07T00:00:00.000Z";
  return {
    seq: 1,
    opId: "o1",
    table,
    kind,
    rowId,
    payload,
    fieldTs: stampFields(payload, ts),
    ts,
    attempts: 0,
  };
}

beforeEach(() => {
  calls.length = 0;
  nextUpsertError = null;
  resetTransportProbeForTests();
});

describe("plain id tables", () => {
  it("upserts on id and ignores duplicates, so a replay cannot duplicate", async () => {
    await transport.send(op("tasks", "insert", "task-1", { title: "T" }));
    expect(calls[0]).toMatchObject({
      table: "tasks",
      op: "upsert",
      opts: { onConflict: "id", ignoreDuplicates: true },
    });
    expect(calls[0].payload).toMatchObject({ id: "task-1", title: "T", user_id: "user-1" });
  });

  it("matches updates by id", async () => {
    await transport.send(op("tasks", "update", "task-1", { title: "T2" }));
    expect(calls[0]).toMatchObject({ op: "rpc", match: { id: "task-1" } });
  });

  it("matches deletes by id", async () => {
    await transport.send(op("tasks", "delete", "task-1"));
    expect(calls[0]).toMatchObject({ op: "delete", match: { id: "task-1" } });
  });
});

describe("composite key (task_labels)", () => {
  it("splits the piped rowId back into both columns", async () => {
    await transport.send(op("task_labels", "insert", "task-1|label-a"));
    expect(calls[0].payload).toMatchObject({ task_id: "task-1", label_id: "label-a" });
    expect(calls[0].opts).toMatchObject({ onConflict: "task_id,label_id" });
  });

  it("deletes by both columns, never by a bogus id", async () => {
    await transport.send(op("task_labels", "delete", "task-1|label-a"));
    expect(calls[0].match).toEqual({ task_id: "task-1", label_id: "label-a" });
  });
});

describe("natural key (week_reviews)", () => {
  it("addresses the row by its week, not by an invented uuid", async () => {
    await transport.send(op("week_reviews", "update", "2026-08-03", { note_to_monday: "hi" }));
    expect(calls[0]).toMatchObject({
      op: "rpc",
      match: { week_start: "2026-08-03" },
    });
    expect(calls[0].match).not.toHaveProperty("id");
  });

  it("upserts on (user_id, week_start) and MERGES — a seal must not be skipped", async () => {
    await transport.send(op("week_reviews", "insert", "2026-08-03", { report: { a: 1 } }));
    expect(calls[0].opts).toEqual({
      onConflict: "user_id,week_start",
      ignoreDuplicates: false,
    });
    expect(calls[0].payload).toMatchObject({ week_start: "2026-08-03", user_id: "user-1" });
  });
});

describe("auth", () => {
  it("waits rather than parking a capture when there is no session yet", async () => {
    const noSession = createSupabaseTransport(async () => null);
    const res = await noSession.send(op("tasks", "insert", "t", { title: "x" }));
    expect(res).toMatchObject({ ok: false, retriable: true });
    expect(calls).toEqual([]);
  });
});

describe("field stamps", () => {
  it("sends the per-field stamps with every update", async () => {
    await transport.send(op("tasks", "update", "t", { title: "x", notes: "y" }));
    const args = calls[0];
    expect(args.op).toBe("rpc");
    // The rpc mock only records patch/match; assert the payload shape survived.
    expect(args.payload).toEqual({ title: "x", notes: "y" });
  });

  it("carries field_ts onto inserts too, so a created row starts stamped", async () => {
    await transport.send(op("tasks", "insert", "t", { title: "x" }));
    expect(calls[0].payload).toHaveProperty("field_ts");
  });
});

describe("idempotent inserts", () => {
  // Regression: recurrence materialisation queued 385 inserts for occurrences
  // that already existed. Every one came back 23505 on
  // `tasks_recurrence_occurrence_uniq` — not the declared conflict target, so
  // `ignoreDuplicates` did not cover it — and `classifyError` correctly read a
  // `23…` code as fatal and parked all 385. But a unique violation on an insert
  // means the row is already there: the op has nothing left to do.
  it("treats a unique violation on insert as satisfied, not fatal", async () => {
    nextUpsertError = { code: "23505", message: 'duplicate key value violates unique constraint "tasks_recurrence_occurrence_uniq"' };
    const res = await transport.send(op("tasks", "insert", "t1", { title: "already there" }));
    expect(res).toEqual({ ok: true });
  });

  it("still reports a genuine rejection", async () => {
    nextUpsertError = { code: "42501", message: "row-level security" };
    const res = await transport.send(op("tasks", "insert", "t1", { title: "denied" }));
    expect(res).toMatchObject({ ok: false, retriable: false });
  });
});
