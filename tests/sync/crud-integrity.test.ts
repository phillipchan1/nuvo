import "fake-indexeddb/auto";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";

import { resetIdbForTests } from "../../src/lib/sync/idb";
import {
  enqueue,
  pendingOps,
} from "../../src/lib/sync/outbox";
import { drain, type SendResult, type Transport } from "../../src/lib/sync/engine";
import {
  applyOp,
  SYNC_TABLES,
  type SyncTable,
} from "../../src/lib/sync/ops";
import {
  installOwingGuards,
  markDeleted,
  markOwing,
  preserveOwingRows,
  queryKeyOwesServer,
  refreshOwing,
  resetOwingForTests,
} from "../../src/lib/sync/coordinator";
import { OWNER_ROW } from "../../src/lib/sync";

/**
 * The data-integrity battery. Every table the outbox is allowed to write must
 * round-trip create / update / delete, and a stale refetch must not be able to
 * drop a local create or revert a local edit. The desktop "Mac creates vanish,
 * phone creates stick" report is exactly a missing row in this file.
 */

const ts = (n: number) => new Date(1_700_000_000_000 + n * 1000).toISOString();

type Fixture = {
  table: SyncTable;
  /** Cache key the UI actually reads. */
  queryKey: readonly unknown[];
  rowId: string;
  insert: Record<string, unknown>;
  update: Record<string, unknown>;
  list: boolean;
};

const FIXTURES: Fixture[] = [
  {
    table: "tasks",
    queryKey: ["tasks", "all"],
    rowId: "task-1",
    insert: { title: "Capture", status: "inbox" },
    update: { title: "Renamed", status: "planned" },
    list: true,
  },
  {
    table: "projects",
    queryKey: ["vertical", "projects"],
    rowId: "proj-1",
    insert: { name: "HRC Marketing Plan", status: "active" },
    update: { name: "HRC Marketing", status: "parked" },
    list: true,
  },
  {
    table: "initiatives",
    queryKey: ["vertical", "initiatives"],
    rowId: "init-1",
    insert: { name: "Q3 bet", status: "active" },
    update: { name: "Q3 bet renamed" },
    list: true,
  },
  {
    table: "domains",
    queryKey: ["vertical", "domains"],
    rowId: "dom-1",
    insert: { name: "Work", color: "#a00" },
    update: { name: "Work & craft" },
    list: true,
  },
  {
    table: "key_results",
    queryKey: ["vertical", "initiatives"],
    rowId: "kr-1",
    insert: { title: "Ship v1", initiative_id: "init-1" },
    update: { title: "Ship v1.1" },
    list: true,
  },
  {
    table: "slots",
    queryKey: ["slots", "2026-08-17", "2026-08-23"],
    rowId: "slot-1",
    insert: { title: "Deep work", duration_minutes: 90 },
    update: { duration_minutes: 120 },
    list: true,
  },
  {
    table: "labels",
    queryKey: ["labels"],
    rowId: "lab-1",
    insert: { name: "wait", color: "#ccc" },
    update: { name: "waiting" },
    list: true,
  },
  {
    table: "task_labels",
    queryKey: ["tasks", "all"],
    rowId: "task-1|lab-1",
    insert: {},
    update: {},
    list: false,
  },
  {
    table: "user_settings",
    queryKey: ["settings"],
    rowId: OWNER_ROW,
    insert: { theme: "dark" },
    update: { theme: "light", week_start: 1 },
    list: false,
  },
  {
    table: "record_comments",
    queryKey: ["record_comments", "project", "proj-1"],
    rowId: "cmt-1",
    insert: { body: "note", author_kind: "user" },
    update: { body: "edited note" },
    list: true,
  },
  {
    table: "week_reviews",
    queryKey: ["week_reviews", "2026-08-17"],
    rowId: "2026-08-17",
    insert: { report: {} },
    update: { note_to_monday: "go again" },
    list: true,
  },
  {
    table: "sprints",
    queryKey: ["sprint", "2026-08-17"],
    rowId: "2026-08-17",
    insert: { big_rocks: ["proj-1"] },
    update: { big_rocks: ["proj-1", "proj-2"] },
    list: false,
  },
  {
    table: "recurrences",
    queryKey: ["recurrences"],
    rowId: "rec-1",
    insert: { title: "standup", freq: "WEEKLY", active: true },
    update: { active: false },
    list: true,
  },
  {
    table: "reminders",
    queryKey: ["reminders"],
    rowId: "rem-1",
    insert: { lead_minutes: 15, task_id: "task-1" },
    update: { lead_minutes: 30 },
    list: true,
  },
];

function recordingTransport(): Transport & { sent: { table: string; kind: string; rowId: string }[] } {
  const sent: { table: string; kind: string; rowId: string }[] = [];
  return {
    sent,
    async send(op): Promise<SendResult> {
      sent.push({ table: op.table, kind: op.kind, rowId: op.rowId });
      return { ok: true };
    },
  };
}

beforeEach(async () => {
  resetIdbForTests();
  resetOwingForTests();
  await refreshOwing();
});

describe("outbox covers every sync table", () => {
  it("the battery lists every table SYNC_TABLES allows", () => {
    const covered = new Set(FIXTURES.map((f) => f.table));
    expect([...SYNC_TABLES].sort()).toEqual([...covered].sort());
  });
});

describe.each(FIXTURES)("$table CRUD", (fix) => {
  it("insert then update then delete round-trips through the outbox", async () => {
    const t = recordingTransport();
    await enqueue({
      table: fix.table,
      kind: "insert",
      rowId: fix.rowId,
      payload: fix.insert,
      ts: ts(1),
    });
    await enqueue({
      table: fix.table,
      kind: "update",
      rowId: fix.rowId,
      payload: fix.update,
      ts: ts(2),
    });

    const pending = await pendingOps();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      table: fix.table,
      kind: "insert",
      rowId: fix.rowId,
    });
    expect(pending[0].payload).toMatchObject({ ...fix.insert, ...fix.update });

    await drain(t);
    expect(t.sent).toEqual([
      { table: fix.table, kind: "insert", rowId: fix.rowId },
    ]);
    expect(await pendingOps()).toEqual([]);

    await enqueue({
      table: fix.table,
      kind: "delete",
      rowId: fix.rowId,
      payload: {},
      ts: ts(3),
    });
    t.sent.length = 0;
    await drain(t);
    expect(t.sent).toEqual([
      { table: fix.table, kind: "delete", rowId: fix.rowId },
    ]);
    expect(await pendingOps()).toEqual([]);
  });

  it("create-then-delete while still queued never reaches the server", async () => {
    const t = recordingTransport();
    await enqueue({
      table: fix.table,
      kind: "insert",
      rowId: fix.rowId,
      payload: fix.insert,
      ts: ts(1),
    });
    await enqueue({
      table: fix.table,
      kind: "delete",
      rowId: fix.rowId,
      payload: {},
      ts: ts(2),
    });
    await drain(t);
    expect(t.sent).toEqual([]);
    expect(await pendingOps()).toEqual([]);
  });

  it("applyOp agrees with the fold: insert, edit, delete", () => {
    const insert = {
      seq: 1,
      opId: "op-ins",
      table: fix.table,
      kind: "insert" as const,
      rowId: fix.rowId,
      payload: fix.insert,
      fieldTs: {},
      ts: ts(1),
      attempts: 0,
    };
    const update = {
      ...insert,
      seq: 2,
      opId: "op-upd",
      kind: "update" as const,
      payload: fix.update,
      ts: ts(2),
    };
    const del = {
      ...insert,
      seq: 3,
      opId: "op-del",
      kind: "delete" as const,
      payload: {},
      ts: ts(3),
    };
    let rows: { id: string }[] = [];
    rows = applyOp(rows, insert);
    expect(rows.some((r) => r.id === fix.rowId)).toBe(true);
    rows = applyOp(rows, update);
    expect(rows.find((r) => r.id === fix.rowId)).toMatchObject(fix.update);
    rows = applyOp(rows, del);
    expect(rows.some((r) => r.id === fix.rowId)).toBe(false);
  });
});

describe("stale refetch cannot destroy local writes", () => {
  it.each(FIXTURES.filter((f) => f.list))(
    "$table: a pre-insert server list cannot drop a local create",
    (fix) => {
      markOwing(fix.table);
      const previous = [
        { id: "existing", name: "Old" },
        { id: fix.rowId, ...(fix.insert as object) },
      ];
      const incoming = [{ id: "existing", name: "Old" }];
      const kept = preserveOwingRows(fix.table, previous, incoming);
      expect(kept.map((r) => r.id).sort()).toEqual(["existing", fix.rowId].sort());
    },
  );

  it.each(FIXTURES.filter((f) => f.list))(
    "$table: a stale refetch cannot revert a local edit of an existing row",
    (fix) => {
      markOwing(fix.table);
      const previous = [{ id: fix.rowId, title: "Local", ...(fix.update as object) }];
      const incoming = [{ id: fix.rowId, title: "Server old", ...(fix.insert as object) }];
      const kept = preserveOwingRows(fix.table, previous, incoming);
      expect(kept).toHaveLength(1);
      expect(kept[0]).toEqual(previous[0]);
    },
  );

  it("lets the server win once the table owes nothing", () => {
    const previous = [{ id: "local", name: "Gone" }];
    const incoming = [{ id: "server", name: "Only" }];
    expect(preserveOwingRows("tasks", previous, incoming)).toEqual(incoming);
  });

  it("still admits a genuinely new remote row while owing", () => {
    markOwing("tasks");
    const previous = [{ id: "local", title: "Mine" }];
    const incoming = [
      { id: "remote", title: "Theirs" },
    ];
    const kept = preserveOwingRows("tasks", previous, incoming);
    expect(kept.map((r) => r.id).sort()).toEqual(["local", "remote"]);
  });

  it.each(FIXTURES.filter((f) => f.list))(
    "$table: a stale refetch cannot restore a locally deleted row",
    (fix) => {
      markDeleted(fix.table, fix.rowId);
      const previous = [{ id: "existing", name: "Old" }];
      const incoming = [
        { id: "existing", name: "Old" },
        { id: fix.rowId, ...(fix.insert as object) },
      ];
      const kept = preserveOwingRows(fix.table, previous, incoming);
      expect(kept.map((r) => r.id)).toEqual(["existing"]);
    },
  );
});

describe("queryKeyOwesServer maps every UI cache", () => {
  it.each(FIXTURES)("$table query $queryKey.0 is gated while that table owes", (fix) => {
    expect(queryKeyOwesServer(fix.queryKey)).toBe(false);
    markOwing(fix.table);
    expect(queryKeyOwesServer(fix.queryKey)).toBe(true);
  });

  it("does not gate an unrelated table", () => {
    markOwing("projects");
    expect(queryKeyOwesServer(["tasks", "all"])).toBe(false);
    expect(queryKeyOwesServer(["settings"])).toBe(false);
    expect(queryKeyOwesServer(["vertical", "projects"])).toBe(true);
  });

  it("blocks sync refetches until the outbox has been read (launch race)", async () => {
    resetOwingForTests();
    expect(queryKeyOwesServer(["tasks", "all"])).toBe(true);
    expect(queryKeyOwesServer(["vertical", "projects"])).toBe(true);
    expect(queryKeyOwesServer(["settings"])).toBe(true);
    expect(queryKeyOwesServer(["subscription"])).toBe(false);
    await refreshOwing();
    expect(queryKeyOwesServer(["tasks", "all"])).toBe(false);
  });
});

describe("TanStack cache guards", () => {
  it("a window-focus-shaped setQueryData cannot drop a just-created task", () => {
    const qc = new QueryClient();
    installOwingGuards(qc);
    markOwing("tasks");
    qc.setQueryData(["tasks", "all"], [
      { id: "old", title: "Existing" },
      { id: "new", title: "Typed on the Mac" },
    ]);
    qc.setQueryData(["tasks", "all"], [{ id: "old", title: "Existing" }]);
    const after = qc.getQueryData<{ id: string; title: string }[]>(["tasks", "all"]);
    expect(after?.map((t) => t.id).sort()).toEqual(["new", "old"]);
    expect(after?.find((t) => t.id === "new")?.title).toBe("Typed on the Mac");
  });

  it("a stale refetch cannot revert a renamed project", () => {
    const qc = new QueryClient();
    installOwingGuards(qc);
    markOwing("projects");
    qc.setQueryData(["vertical", "projects"], [{ id: "p", name: "Renamed locally" }]);
    qc.setQueryData(["vertical", "projects"], [{ id: "p", name: "Old server name" }]);
    const after = qc.getQueryData<{ id: string; name: string }[]>(["vertical", "projects"]);
    expect(after?.[0].name).toBe("Renamed locally");
  });

  it("a stale refetch cannot restore a locally deleted project", () => {
    const qc = new QueryClient();
    installOwingGuards(qc);
    markDeleted("projects", "p");
    qc.setQueryData(["vertical", "projects"], []);
    qc.setQueryData(["vertical", "projects"], [{ id: "p", name: "Still on the server" }]);
    expect(qc.getQueryData(["vertical", "projects"])).toEqual([]);
  });

  it("once the outbox is empty the next refetch is authoritative", async () => {
    const qc = new QueryClient();
    installOwingGuards(qc);
    markOwing("tasks");
    qc.setQueryData(["tasks", "inbox"], [{ id: "ghost", title: "Never sent" }]);
    resetOwingForTests();
    await refreshOwing();
    qc.setQueryData(["tasks", "inbox"], []);
    expect(qc.getQueryData(["tasks", "inbox"])).toEqual([]);
  });
});
