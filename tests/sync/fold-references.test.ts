import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import { idbAllOps, resetIdbForTests } from "../../src/lib/sync/idb";
import { enqueue, parkedOps, pendingOps, resetDeliveryForTests, whenDelivered } from "../../src/lib/sync/outbox";
import { drain, type SendResult, type Transport } from "../../src/lib/sync/engine";
import { coalesce, stampFields, type NewOp, type Op, type SyncTable } from "../../src/lib/sync/ops";

/**
 * A merged op replays at its earlier member's seq, so a reference the later
 * member added can reach Postgres ahead of the row it points at. Seen on the
 * dummy account (2026-10-27): a combine patched a repeating task, made a block
 * and assigned the task into it; the assign folded into the patch and landed
 * ahead of the block's insert — 23503 `tasks_slot_id_fkey`, parked.
 *
 * These drive the real outbox and drain against a server that enforces the
 * two foreign keys the Schedule's block acts lean on, `on delete set null`
 * included, so "the order is right" is proved by what the server ends up
 * holding rather than by reading the op list.
 */

const FKS: Partial<Record<SyncTable, { column: string; target: SyncTable }[]>> = {
  tasks: [
    { column: "slot_id", target: "slots" },
    { column: "project_id", target: "projects" },
  ],
};

type Row = Record<string, unknown>;

function fakePostgres(
  seed: Partial<Record<SyncTable, Row[]>> = {},
  refuse: (op: Op) => string | null = () => null,
) {
  const db = new Map<SyncTable, Map<string, Row>>();
  const table = (t: SyncTable) => {
    let rows = db.get(t);
    if (!rows) db.set(t, (rows = new Map()));
    return rows;
  };
  for (const [t, rows] of Object.entries(seed) as [SyncTable, Row[]][]) {
    for (const r of rows) table(t).set(String(r.id), { ...r });
  }
  const violation = (t: SyncTable, row: Row) => {
    for (const fk of FKS[t] ?? []) {
      const v = row[fk.column];
      if (v != null && !table(fk.target).has(String(v))) {
        return `23503 insert or update on table "${t}" violates foreign key constraint "${t}_${fk.column}_fkey"`;
      }
    }
    return null;
  };

  const sent: Op[] = [];
  const transport: Transport = {
    async send(op): Promise<SendResult> {
      sent.push(op);
      const refused = refuse(op);
      if (refused) return { ok: false, retriable: false, error: refused };
      const rows = table(op.table);
      if (op.kind === "insert") {
        if (rows.has(op.rowId)) return { ok: true };
        const row = { ...op.payload, id: op.rowId };
        const bad = violation(op.table, row);
        if (bad) return { ok: false, retriable: false, error: bad };
        rows.set(op.rowId, row);
        return { ok: true };
      }
      if (op.kind === "update") {
        const row = rows.get(op.rowId);
        if (!row) return { ok: true }; // apply_patch on a missing row does nothing
        const next = { ...row, ...op.payload };
        const bad = violation(op.table, next);
        if (bad) return { ok: false, retriable: false, error: bad };
        rows.set(op.rowId, next);
        return { ok: true };
      }
      rows.delete(op.rowId);
      for (const [t, fks] of Object.entries(FKS) as [SyncTable, { column: string; target: SyncTable }[]][]) {
        for (const fk of fks) {
          if (fk.target !== op.table) continue;
          for (const r of table(t).values()) if (r[fk.column] === op.rowId) r[fk.column] = null;
        }
      }
      return { ok: true };
    },
  };
  return { transport, sent, row: (t: SyncTable, id: string) => table(t).get(id) };
}

let clock = 0;
function write(
  table: SyncTable,
  kind: Op["kind"],
  rowId: string,
  payload: Record<string, unknown> = {},
): NewOp {
  return { table, kind, rowId, payload, ts: new Date(1_700_000_000_000 + ++clock * 1000).toISOString() };
}

/** The patch `assignToSlot` queues for each task a block takes. */
const assign = (slotId: string) => ({
  slot_id: slotId,
  start_time: null,
  do_date: "2026-10-28",
  status: "planned",
});

const offline: Transport = {
  async send() {
    return { ok: false, retriable: true, error: "Failed to fetch" };
  },
};

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory();
  resetIdbForTests();
  resetDeliveryForTests();
});

describe("a fold never moves a reference ahead of the insert it points at", () => {
  it("an update carrying slot_id after a slot insert lands after the slot", async () => {
    const pg = fakePostgres({ tasks: [{ id: "t1", title: "Call David" }, { id: "t2", title: "Email Ana" }] });

    // Offline: rename one task, then drop both onto open time (createSlotWith:
    // the block's insert, then one assign per task).
    await enqueue(write("tasks", "update", "t1", { title: "Call David re: offsite" }));
    await enqueue(write("slots", "insert", "s1", { title: "", do_date: "2026-10-28" }));
    await enqueue(write("tasks", "update", "t1", assign("s1")));
    await enqueue(write("tasks", "update", "t2", assign("s1")));

    const plan = await pendingOps();
    // The assign could not join the rename — it would have replayed first.
    expect(plan.map((o) => `${o.kind} ${o.rowId}`)).toEqual([
      "update t1",
      "insert s1",
      "update t1",
      "update t2",
    ]);

    const report = await drain(pg.transport);

    expect(report.parked).toBe(0);
    expect(pg.row("tasks", "t1")).toMatchObject({ title: "Call David re: offsite", slot_id: "s1" });
    expect(pg.row("tasks", "t2")).toMatchObject({ slot_id: "s1" });
    expect(await idbAllOps()).toEqual([]);
  });

  it("an update folding into an insert that names a later insert stays behind it", async () => {
    const pg = fakePostgres();

    // Capture a task, make a block, put the task in it — all before a drain.
    await enqueue(write("tasks", "insert", "t1", { title: "Draft agenda", status: "inbox" }));
    await enqueue(write("slots", "insert", "s1", { title: "", do_date: "2026-10-28" }));
    await enqueue(write("tasks", "update", "t1", assign("s1")));

    expect((await pendingOps()).map((o) => `${o.kind} ${o.rowId}`)).toEqual([
      "insert t1",
      "insert s1",
      "update t1",
    ]);

    const report = await drain(pg.transport);

    expect(report.parked).toBe(0);
    expect(pg.row("tasks", "t1")).toMatchObject({ title: "Draft agenda", slot_id: "s1" });
  });

  it("a delete → insert recreate keeps the children it restores", async () => {
    // Two blocks; t1 sits in B. Merge B into A, then undo before the drain.
    const pg = fakePostgres({
      slots: [{ id: "A" }, { id: "B" }],
      tasks: [{ id: "t1", slot_id: "B" }],
    });

    await enqueue(write("tasks", "update", "t1", { slot_id: "A" })); // merge: re-home
    await enqueue(write("slots", "delete", "B")); //                       merge: drop B
    await enqueue(write("slots", "insert", "B", { title: "B" })); //       undo: B is back
    await enqueue(write("tasks", "update", "t1", { slot_id: "B" })); //    undo: t1 goes home

    const report = await drain(pg.transport);

    // Folded, the restore replays first and B's delete then sets it null.
    expect(report.parked).toBe(0);
    expect(pg.row("slots", "B")).toBeDefined();
    expect(pg.row("tasks", "t1")).toMatchObject({ slot_id: "B" });
    expect(await idbAllOps()).toEqual([]);
  });

  // The rule that was NOT chosen — fold at the later seq — fails this one: the
  // assign would be re-asserted after the block is gone.
  it("an earlier reference still replays ahead of the delete that releases it", async () => {
    const pg = fakePostgres({ slots: [{ id: "s1" }], tasks: [{ id: "t1", title: "Plan" }] });

    await enqueue(write("tasks", "update", "t1", { slot_id: "s1" }));
    await enqueue(write("slots", "delete", "s1")); // removeSlot leans on set null
    await enqueue(write("tasks", "update", "t1", { title: "Plan the offsite" }));

    const report = await drain(pg.transport);

    expect(report.parked).toBe(0);
    expect(pg.row("tasks", "t1")).toMatchObject({ title: "Plan the offsite", slot_id: null });
  });

  it("still folds an edit whose reference already existed when the first op was queued", () => {
    const seq = (n: number, o: NewOp): Op => ({
      ...o,
      seq: n,
      opId: `op-${n}`,
      fieldTs: stampFields(o.payload, o.ts),
      attempts: 0,
    });
    const out = coalesce([
      seq(1, write("slots", "insert", "s1", { title: "" })),
      seq(2, write("tasks", "update", "t1", { title: "Rename" })),
      seq(3, write("slots", "insert", "s2", { title: "" })),
      seq(4, write("tasks", "update", "t1", assign("s1"))),
    ]);

    // s1's insert replays at 1, ahead of the merged patch at 2 — one request.
    expect(out.filter((o) => o.rowId === "t1")).toHaveLength(1);
    expect(out.find((o) => o.rowId === "t1")).toMatchObject({
      seq: 2,
      fromSeq: 2,
      throughSeq: 4,
      payload: { title: "Rename", slot_id: "s1" },
    });
  });

  it("finds a reference nested in an array", () => {
    const seq = (n: number, o: NewOp): Op => ({
      ...o,
      seq: n,
      opId: `op-${n}`,
      fieldTs: stampFields(o.payload, o.ts),
      attempts: 0,
    });
    const out = coalesce([
      seq(1, write("projects", "update", "p1", { title: "Offsite" })),
      seq(2, write("tasks", "insert", "t9", { title: "Book venue" })),
      seq(3, write("projects", "update", "p1", { pinned: ["t9"] })),
    ]);

    expect(out.map((o) => `${o.kind} ${o.rowId}`)).toEqual(["update p1", "insert t9", "update p1"]);
  });
});

describe("retiring a row that folded into more than one op", () => {
  it("one drain retires both halves of a refused fold", async () => {
    const pg = fakePostgres({ tasks: [{ id: "t1" }] });
    await enqueue(write("tasks", "update", "t1", { title: "Rename" }));
    await enqueue(write("slots", "insert", "s1", {}));
    await enqueue(write("tasks", "update", "t1", assign("s1")));

    await drain(pg.transport);
    expect(await idbAllOps()).toEqual([]);

    pg.sent.length = 0;
    await drain(pg.transport);
    expect(pg.sent).toEqual([]);
  });

  it("a parked earlier op is not retired when the row's later op lands", async () => {
    const pg = fakePostgres({ tasks: [{ id: "t1" }] }, (op) =>
      op.rowId === "t1" && "title" in op.payload ? "23514 violates check constraint" : null,
    );
    const rename = await enqueue(write("tasks", "update", "t1", { title: "" }));
    await enqueue(write("slots", "insert", "s1", {}));
    await enqueue(write("tasks", "update", "t1", assign("s1")));

    await drain(pg.transport);

    expect(pg.row("tasks", "t1")).toMatchObject({ slot_id: "s1" });
    // The refused rename is still there for the recovery UI.
    expect((await parkedOps()).map((o) => o.seq)).toEqual([rename.seq]);
  });

  it("a later op failing does not unsay the earlier op's delivery", async () => {
    const pg = fakePostgres({ tasks: [{ id: "t1" }] }, (op) =>
      op.rowId === "t1" && "slot_id" in op.payload ? "42501 row-level security" : null,
    );
    const rename = await enqueue(write("tasks", "update", "t1", { title: "Rename" }));
    await enqueue(write("slots", "insert", "s1", {}));
    const placed = await enqueue(write("tasks", "update", "t1", assign("s1")));
    const landed = whenDelivered(rename);

    await drain(pg.transport);

    expect(await landed).toBe(true);
    expect((await parkedOps()).map((o) => o.seq)).toEqual([placed.seq]);
  });

  // delete → recreate → delete annihilates only the second pair. The sweep
  // used to reach below it and drop the first delete, which was still owed:
  // offline, the row the user deleted survived on the server for good.
  it("the sweep of an annihilated recreate leaves the delete before it owed", async () => {
    const pg = fakePostgres({ slots: [{ id: "s1" }] });
    await enqueue(write("slots", "delete", "s1"));
    await enqueue(write("slots", "insert", "s1", { title: "back" })); // undo
    await enqueue(write("slots", "delete", "s1")); //                     and again

    await drain(offline);
    await new Promise((r) => setTimeout(r, 0)); // sweep is fire-and-forget
    expect((await pendingOps()).map((o) => o.kind)).toEqual(["delete"]);

    await drain(pg.transport);

    expect(pg.row("slots", "s1")).toBeUndefined();
    expect(await idbAllOps()).toEqual([]);
  });
});
