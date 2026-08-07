import { describe, expect, it } from "vitest";
import { applyOp, coalesce, mergeFieldLww, stampFields, type Op } from "../../src/lib/sync/ops";

let seq = 0;
function op(partial: Partial<Op> & Pick<Op, "kind" | "rowId">): Op {
  const ts = partial.ts ?? new Date(1_700_000_000_000 + seq * 1000).toISOString();
  const payload = partial.payload ?? {};
  return {
    seq: partial.seq ?? ++seq,
    opId: partial.opId ?? `op-${seq}`,
    table: partial.table ?? "tasks",
    kind: partial.kind,
    rowId: partial.rowId,
    payload,
    fieldTs: partial.fieldTs ?? stampFields(payload, ts),
    ts,
    attempts: partial.attempts ?? 0,
  };
}

describe("coalesce", () => {
  it("folds an insert and its later edits into a single insert", () => {
    const out = coalesce([
      op({ kind: "insert", rowId: "a", seq: 1, payload: { title: "Draft", status: "inbox" } }),
      op({ kind: "update", rowId: "a", seq: 2, payload: { title: "Call David" } }),
      op({ kind: "update", rowId: "a", seq: 3, payload: { status: "planned" } }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("insert");
    expect(out[0].payload).toEqual({ title: "Call David", status: "planned" });
  });

  it("annihilates a row created and deleted while offline", () => {
    const out = coalesce([
      op({ kind: "insert", rowId: "a", seq: 1, payload: { title: "oops" } }),
      op({ kind: "update", rowId: "a", seq: 2, payload: { title: "still oops" } }),
      op({ kind: "delete", rowId: "a", seq: 3 }),
    ]);

    expect(out).toEqual([]);
  });

  it("keeps only the delete when an existing row is edited then deleted", () => {
    const out = coalesce([
      op({ kind: "update", rowId: "a", seq: 1, payload: { title: "edit" } }),
      op({ kind: "delete", rowId: "a", seq: 2 }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("delete");
  });

  it("does not fold a recreate — the delete must land before the new insert", () => {
    const out = coalesce([
      op({ kind: "delete", rowId: "a", seq: 1 }),
      op({ kind: "insert", rowId: "a", seq: 2, payload: { title: "reborn" } }),
    ]);

    expect(out.map((o) => o.kind)).toEqual(["delete", "insert"]);
  });

  it("never merges across rows", () => {
    const out = coalesce([
      op({ kind: "update", rowId: "a", seq: 1, payload: { title: "A" } }),
      op({ kind: "update", rowId: "b", seq: 2, payload: { title: "B" } }),
    ]);

    expect(out).toHaveLength(2);
  });

  it("never merges across tables even for a shared id", () => {
    const out = coalesce([
      op({ kind: "update", rowId: "x", table: "tasks", seq: 1, payload: { title: "task" } }),
      op({ kind: "update", rowId: "x", table: "projects", seq: 2, payload: { title: "project" } }),
    ]);

    expect(out).toHaveLength(2);
  });

  it("holds the merged op at the earlier slot so parent inserts stay ahead of children", () => {
    const out = coalesce([
      op({ kind: "insert", rowId: "task", table: "tasks", seq: 1, payload: { project_id: "proj" } }),
      op({ kind: "insert", rowId: "proj", table: "projects", seq: 2, payload: { title: "P" } }),
      op({ kind: "update", rowId: "proj", table: "projects", seq: 3, payload: { title: "P2" } }),
    ]);

    // The project's merged insert keeps seq 2 rather than sliding to 3.
    expect(out.map((o) => o.seq)).toEqual([1, 2]);
  });

  it("takes the later value per field when two updates touch the same field", () => {
    const out = coalesce([
      op({ kind: "update", rowId: "a", seq: 1, payload: { title: "first" } }),
      op({ kind: "update", rowId: "a", seq: 2, payload: { title: "second" } }),
    ]);

    expect(out[0].payload).toEqual({ title: "second" });
    expect(out[0].fieldTs.title).toBe(out[0].ts);
  });

  it("keeps the newest stamp per field across a merge", () => {
    const early = "2026-08-01T00:00:00.000Z";
    const late = "2026-08-02T00:00:00.000Z";
    const out = coalesce([
      op({ kind: "update", rowId: "a", seq: 1, ts: early, payload: { title: "t", notes: "n" } }),
      op({ kind: "update", rowId: "a", seq: 2, ts: late, payload: { title: "t2" } }),
    ]);

    expect(out[0].fieldTs).toEqual({ title: late, notes: early });
  });

  it("is order-insensitive about its input — it sorts by seq", () => {
    const ops = [
      op({ kind: "update", rowId: "a", seq: 3, payload: { status: "done" } }),
      op({ kind: "insert", rowId: "a", seq: 1, payload: { title: "x" } }),
      op({ kind: "update", rowId: "a", seq: 2, payload: { title: "y" } }),
    ];

    expect(coalesce(ops)).toEqual(coalesce([...ops].reverse()));
  });

  it("resets the attempt budget on a freshly merged op", () => {
    const out = coalesce([
      op({ kind: "update", rowId: "a", seq: 1, payload: { title: "x" }, attempts: 5 }),
      op({ kind: "update", rowId: "a", seq: 2, payload: { title: "y" } }),
    ]);

    expect(out[0].attempts).toBe(0);
  });

  it("leaves an empty queue empty", () => {
    expect(coalesce([])).toEqual([]);
  });
});

describe("applyOp", () => {
  it("round-trips a create/edit/complete sequence to the same rows the server would hold", () => {
    const ops = [
      op({ kind: "insert", rowId: "a", seq: 1, payload: { title: "Ship it", status: "inbox" } }),
      op({ kind: "update", rowId: "a", seq: 2, payload: { status: "planned" } }),
      op({ kind: "update", rowId: "a", seq: 3, payload: { status: "done" } }),
    ];

    const direct = ops.reduce<{ id: string }[]>((rows, o) => applyOp(rows, o), []);
    const folded = coalesce(ops).reduce<{ id: string }[]>((rows, o) => applyOp(rows, o), []);

    expect(folded).toEqual(direct);
    expect(direct).toEqual([{ id: "a", title: "Ship it", status: "done" }]);
  });

  it("an insert for an id already present patches rather than duplicating", () => {
    const rows = [{ id: "a", title: "existing" }];
    const out = applyOp(rows, op({ kind: "insert", rowId: "a", payload: { title: "replay" } }));

    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("replay");
  });

  it("an update for a missing row is a no-op rather than a resurrection", () => {
    const out = applyOp([], op({ kind: "update", rowId: "ghost", payload: { title: "x" } }));
    expect(out).toEqual([]);
  });
});

describe("mergeFieldLww", () => {
  const remote = { title: "remote title", notes: "remote notes" };
  const remoteTs = {
    title: "2026-08-05T12:00:00.000Z",
    notes: "2026-08-05T12:00:00.000Z",
  };

  it("applies a field whose stamp is newer than the remote's", () => {
    const { merged, applied } = mergeFieldLww(remote, remoteTs, { title: "mine" }, {
      title: "2026-08-06T12:00:00.000Z",
    });

    expect(merged.title).toBe("mine");
    expect(applied).toEqual(["title"]);
  });

  it("rejects a stale offline edit instead of clobbering fresher remote data", () => {
    const { merged, rejected } = mergeFieldLww(remote, remoteTs, { title: "stale" }, {
      title: "2026-08-04T12:00:00.000Z",
    });

    expect(merged.title).toBe("remote title");
    expect(rejected).toEqual(["title"]);
  });

  it("merges two devices editing different fields — neither loses its write", () => {
    // Device A set the title later; device B set the notes later.
    const { merged } = mergeFieldLww(
      remote,
      remoteTs,
      { title: "from A", notes: "stale from A" },
      { title: "2026-08-06T00:00:00.000Z", notes: "2026-08-01T00:00:00.000Z" },
    );

    expect(merged).toEqual({ title: "from A", notes: "remote notes" });
  });

  it("converges regardless of arrival order — the out-of-order sync case", () => {
    const older = { patch: { title: "older" }, ts: { title: "2026-08-01T00:00:00.000Z" } };
    const newer = { patch: { title: "newer" }, ts: { title: "2026-08-09T00:00:00.000Z" } };

    // Apply older then newer.
    let a = mergeFieldLww({ title: "base" }, {}, older.patch, older.ts);
    a = mergeFieldLww(a.merged, older.ts, newer.patch, newer.ts);

    // Apply newer then older — the late-arriving stale write must not win.
    let b = mergeFieldLww({ title: "base" }, {}, newer.patch, newer.ts);
    b = mergeFieldLww(b.merged, newer.ts, older.patch, older.ts);

    expect(a.merged.title).toBe("newer");
    expect(b.merged.title).toBe("newer");
    expect(a.merged).toEqual(b.merged);
  });

  it("writes through when the remote has no stamp for the field", () => {
    const { merged } = mergeFieldLww({ title: "legacy" }, null, { title: "mine" }, {
      title: "2020-01-01T00:00:00.000Z",
    });

    expect(merged.title).toBe("mine");
  });

  it("breaks an exact tie in favour of the already-durable remote value", () => {
    const ts = "2026-08-05T12:00:00.000Z";
    const { merged, rejected } = mergeFieldLww(remote, { title: ts }, { title: "mine" }, { title: ts });

    expect(merged.title).toBe("remote title");
    expect(rejected).toEqual(["title"]);
  });
});
