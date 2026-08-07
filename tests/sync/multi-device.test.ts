/**
 * Two devices, one row.
 *
 * These tests model the server's `apply_patch` rule in TypeScript and drive it
 * with op streams from two independent devices. What is being proved is the
 * *strategy*, not the plumbing (the outbox suite covers delivery): that the
 * conflict outcome is defined, deterministic, and identical no matter which
 * order the writes arrive in.
 *
 * The model here and the plpgsql in `00000000000053_offline_sync.sql` implement
 * the same rule, and `mergeFieldLww` in the client implements it a third time
 * for the optimistic view. That is three copies of one rule, which this codebase
 * normally forbids — so the shared cases are asserted against `mergeFieldLww`
 * directly (see the last block) rather than against a reimplementation, and the
 * SQL carries a comment pointing here.
 */
import { describe, expect, it } from "vitest";
import { coalesce, mergeFieldLww, stampFields, type Op } from "../../src/lib/sync/ops";

// ---------------------------------------------------------------------------
// A server that resolves per-field LWW, exactly as apply_patch does.
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  [k: string]: unknown;
}

class FakeServer {
  rows = new Map<string, Row>();
  fieldTs = new Map<string, Record<string, string>>();
  /** Every op the server accepted, in arrival order. */
  log: Op[] = [];

  apply(op: Op) {
    this.log.push(op);
    if (op.kind === "insert") {
      // Idempotent: a replayed insert for an existing id changes nothing.
      if (!this.rows.has(op.rowId)) {
        this.rows.set(op.rowId, { id: op.rowId, ...op.payload });
        this.fieldTs.set(op.rowId, { ...op.fieldTs });
      }
      return;
    }
    if (op.kind === "delete") {
      this.rows.delete(op.rowId);
      this.fieldTs.delete(op.rowId);
      return;
    }
    const row = this.rows.get(op.rowId);
    // A patch for a row that is gone is a no-op — the delete wins.
    if (!row) return;
    const { merged, applied } = mergeFieldLww(
      row,
      this.fieldTs.get(op.rowId),
      op.payload,
      op.fieldTs,
    );
    this.rows.set(op.rowId, merged as Row);
    const ts = { ...this.fieldTs.get(op.rowId) };
    for (const f of applied) ts[f] = op.fieldTs[f];
    this.fieldTs.set(op.rowId, ts);
  }

  get(id: string) {
    return this.rows.get(id);
  }
}

/** A device that stamps its ops with its own clock. */
class Device {
  private seq = 0;
  queue: Op[] = [];
  constructor(
    readonly name: string,
    /** Milliseconds this device's clock is ahead of the shared timeline. */
    private skewMs = 0,
  ) {}

  edit(rowId: string, payload: Record<string, unknown>, atMs: number) {
    const ts = new Date(atMs + this.skewMs).toISOString();
    this.queue.push({
      seq: ++this.seq,
      opId: `${this.name}-${this.seq}`,
      table: "tasks",
      kind: "update",
      rowId,
      payload,
      fieldTs: stampFields(payload, ts),
      ts,
      attempts: 0,
    });
  }

  create(rowId: string, payload: Record<string, unknown>, atMs: number) {
    const ts = new Date(atMs + this.skewMs).toISOString();
    this.queue.push({
      seq: ++this.seq,
      opId: `${this.name}-${this.seq}`,
      table: "tasks",
      kind: "insert",
      rowId,
      payload,
      fieldTs: stampFields(payload, ts),
      ts,
      attempts: 0,
    });
  }

  remove(rowId: string, atMs: number) {
    const ts = new Date(atMs + this.skewMs).toISOString();
    this.queue.push({
      seq: ++this.seq,
      opId: `${this.name}-${this.seq}`,
      table: "tasks",
      kind: "delete",
      rowId,
      payload: {},
      fieldTs: {},
      ts,
      attempts: 0,
    });
  }

  /** What this device would actually send — coalesced, as the outbox does. */
  flush(): Op[] {
    const out = coalesce(this.queue);
    this.queue = [];
    return out;
  }
}

const T = (min: number) => Date.UTC(2026, 7, 5, 9, min, 0);

function seed(server: FakeServer, id = "task-1") {
  server.apply({
    seq: 0,
    opId: "seed",
    table: "tasks",
    kind: "insert",
    rowId: id,
    payload: { title: "Original", notes: "", status: "inbox" },
    fieldTs: stampFields({ title: "", notes: "", status: "" }, new Date(T(0)).toISOString()),
    ts: new Date(T(0)).toISOString(),
    attempts: 0,
  });
}

describe("two devices editing different fields", () => {
  it("keeps both writes — neither device loses its work", () => {
    const server = new FakeServer();
    seed(server);

    const laptop = new Device("laptop");
    const phone = new Device("phone");

    laptop.edit("task-1", { title: "From the laptop" }, T(10));
    phone.edit("task-1", { notes: "From the phone" }, T(11));

    for (const op of laptop.flush()) server.apply(op);
    for (const op of phone.flush()) server.apply(op);

    expect(server.get("task-1")).toMatchObject({
      title: "From the laptop",
      notes: "From the phone",
    });
  });

  it("converges to the same row whichever device syncs first", () => {
    const build = (phoneFirst: boolean) => {
      const server = new FakeServer();
      seed(server);
      const laptop = new Device("laptop");
      const phone = new Device("phone");
      laptop.edit("task-1", { title: "L" }, T(10));
      phone.edit("task-1", { notes: "P" }, T(11));

      const first = phoneFirst ? phone : laptop;
      const second = phoneFirst ? laptop : phone;
      for (const op of first.flush()) server.apply(op);
      for (const op of second.flush()) server.apply(op);
      return server.get("task-1");
    };

    expect(build(true)).toEqual(build(false));
  });
});

describe("two devices editing the same field", () => {
  it("the later edit wins, and it is the same winner in either arrival order", () => {
    const run = (laptopFirst: boolean) => {
      const server = new FakeServer();
      seed(server);
      const laptop = new Device("laptop");
      const phone = new Device("phone");
      laptop.edit("task-1", { title: "laptop wrote this" }, T(10));
      phone.edit("task-1", { title: "phone wrote this later" }, T(20));

      const order = laptopFirst ? [laptop, phone] : [phone, laptop];
      for (const d of order) for (const op of d.flush()) server.apply(op);
      return server.get("task-1")!.title;
    };

    // The phone's edit is later in wall-clock terms, so it wins — even when it
    // is DELIVERED first and the laptop's older write arrives afterwards.
    expect(run(true)).toBe("phone wrote this later");
    expect(run(false)).toBe("phone wrote this later");
  });
});

describe("out-of-order delivery", () => {
  it("a stale write arriving last does not overwrite the fresher one", () => {
    const server = new FakeServer();
    seed(server);

    const phone = new Device("phone");
    const laptop = new Device("laptop");

    // The phone made this edit on Monday but was offline until Friday.
    phone.edit("task-1", { status: "planned" }, T(5));
    // The laptop moved it on Wednesday and synced straight away.
    laptop.edit("task-1", { status: "done" }, T(50));

    for (const op of laptop.flush()) server.apply(op);
    // ...and now the phone finally reconnects.
    for (const op of phone.flush()) server.apply(op);

    expect(server.get("task-1")!.status).toBe("done");
  });

  it("delivers the same final state for every permutation of three writes", () => {
    const permutations = <T,>(xs: T[]): T[][] =>
      xs.length <= 1
        ? [xs]
        : xs.flatMap((x, i) =>
            permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]),
          );

    const makeOps = () => {
      const a = new Device("a");
      const b = new Device("b");
      const c = new Device("c");
      a.edit("task-1", { title: "A" }, T(10));
      b.edit("task-1", { title: "B", notes: "b-notes" }, T(20));
      c.edit("task-1", { notes: "c-notes", status: "done" }, T(15));
      return [a.flush()[0], b.flush()[0], c.flush()[0]];
    };

    const results = permutations(makeOps()).map((order) => {
      const server = new FakeServer();
      seed(server);
      for (const op of order) server.apply(op);
      return server.get("task-1");
    });

    // Every ordering lands on the same row: title from B (t=20), notes from
    // B (t=20 beats C's t=15), status from C.
    for (const r of results) expect(r).toEqual(results[0]);
    expect(results[0]).toMatchObject({ title: "B", notes: "b-notes", status: "done" });
  });
});

describe("an offline device rejoining", () => {
  it("merges a week of queued edits with what the other device did meanwhile", () => {
    const server = new FakeServer();
    seed(server);

    const laptop = new Device("laptop");
    const phone = new Device("phone");

    // The laptop stays online all week.
    laptop.edit("task-1", { status: "planned" }, T(10));
    for (const op of laptop.flush()) server.apply(op);
    laptop.edit("task-1", { do_date: "2026-08-07" }, T(30));
    for (const op of laptop.flush()) server.apply(op);

    // The phone was in a tunnel and made several edits to a different field.
    phone.edit("task-1", { title: "Renamed on the phone" }, T(15));
    phone.edit("task-1", { title: "Renamed again" }, T(40));
    phone.edit("task-1", { notes: "thoughts" }, T(45));

    // One coalesced patch on reconnect.
    const sent = phone.flush();
    expect(sent).toHaveLength(1);
    for (const op of sent) server.apply(op);

    expect(server.get("task-1")).toMatchObject({
      title: "Renamed again",   // phone's, newest
      notes: "thoughts",         // phone's, uncontested
      status: "planned",         // laptop's, untouched by the phone
      do_date: "2026-08-07",     // laptop's, untouched by the phone
    });
  });

  it("a delete on one device beats a queued edit from the other", () => {
    const server = new FakeServer();
    seed(server);

    const laptop = new Device("laptop");
    const phone = new Device("phone");

    phone.edit("task-1", { title: "Still editing" }, T(10));
    laptop.remove("task-1", T(20));

    for (const op of laptop.flush()) server.apply(op);
    for (const op of phone.flush()) server.apply(op);

    expect(server.get("task-1")).toBeUndefined();
  });

  it("a delete stays deleted even when the edit arrives first", () => {
    const server = new FakeServer();
    seed(server);

    const laptop = new Device("laptop");
    const phone = new Device("phone");
    phone.edit("task-1", { title: "Still editing" }, T(10));
    laptop.remove("task-1", T(20));

    for (const op of phone.flush()) server.apply(op);
    for (const op of laptop.flush()) server.apply(op);

    expect(server.get("task-1")).toBeUndefined();
  });
});

describe("idempotent replay", () => {
  it("a create redelivered after a lost response does not duplicate the row", () => {
    const server = new FakeServer();
    const phone = new Device("phone");
    phone.create("task-9", { title: "Only once" }, T(10));

    const ops = phone.flush();
    // The response was lost, so the device retries the same op next launch.
    for (const op of ops) server.apply(op);
    for (const op of ops) server.apply(op);

    expect(server.rows.size).toBe(1);
    expect(server.get("task-9")).toMatchObject({ title: "Only once" });
  });

  it("a replayed create does not roll back edits made since it landed", () => {
    const server = new FakeServer();
    const phone = new Device("phone");
    const laptop = new Device("laptop");

    phone.create("task-9", { title: "Draft" }, T(10));
    const createOps = phone.flush();
    for (const op of createOps) server.apply(op);

    laptop.edit("task-9", { title: "Edited on the laptop" }, T(20));
    for (const op of laptop.flush()) server.apply(op);

    // The phone never saw the ack and replays.
    for (const op of createOps) server.apply(op);

    expect(server.get("task-9")!.title).toBe("Edited on the laptop");
  });
});

describe("clock skew", () => {
  it("a device running fast can win a field it should not — known limitation", () => {
    const server = new FakeServer();
    seed(server);

    // The phone's clock is an hour ahead.
    const phone = new Device("phone", 60 * 60 * 1000);
    const laptop = new Device("laptop");

    phone.edit("task-1", { title: "written first, stamped late" }, T(10));
    laptop.edit("task-1", { title: "actually written later" }, T(20));

    for (const op of phone.flush()) server.apply(op);
    for (const op of laptop.flush()) server.apply(op);

    // This documents the behaviour rather than endorsing it: wall-clock LWW is
    // only as good as the clocks. The migration clamps future stamps to now()
    // server-side, which bounds the damage; a hybrid logical clock would remove
    // it, and is recorded as a known risk rather than silently assumed away.
    expect(server.get("task-1")!.title).toBe("written first, stamped late");
  });
});

describe("the client's optimistic view agrees with the server", () => {
  it("mergeFieldLww and the server model reach the same row", () => {
    const server = new FakeServer();
    seed(server);

    const laptop = new Device("laptop");
    laptop.edit("task-1", { title: "L", notes: "n" }, T(10));
    const [op] = laptop.flush();
    server.apply(op);

    const local = mergeFieldLww(
      { id: "task-1", title: "Original", notes: "", status: "inbox" },
      stampFields({ title: "", notes: "", status: "" }, new Date(T(0)).toISOString()),
      op.payload,
      op.fieldTs,
    );

    expect(local.merged).toEqual(server.get("task-1"));
  });
});
