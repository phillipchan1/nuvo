import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { resetIdbForTests } from "../../src/lib/sync/idb";
import {
  markOwing,
  preserveOwingRows,
  queryKeyOwesServer,
  refreshOwing,
} from "../../src/lib/sync/coordinator";

beforeEach(async () => {
  resetIdbForTests();
  await refreshOwing();
});

describe("preserveOwingRows", () => {
  it("keeps a local create when a refetch returns the pre-insert server list", () => {
    markOwing("projects");
    const previous = [
      { id: "existing", name: "Old" },
      { id: "local", name: "HRC Marketing Plan" },
    ];
    const incoming = [{ id: "existing", name: "Old" }];
    expect(preserveOwingRows("projects", previous, incoming)).toEqual([
      { id: "existing", name: "Old" },
      { id: "local", name: "HRC Marketing Plan" },
    ]);
  });

  it("lets the server win once the table owes nothing", () => {
    const previous = [
      { id: "existing", name: "Old" },
      { id: "local", name: "Gone" },
    ];
    const incoming = [{ id: "existing", name: "Old" }];
    expect(preserveOwingRows("projects", previous, incoming)).toEqual(incoming);
  });

  it("is a no-op when every cached id is already in the refetch", () => {
    markOwing("projects");
    const rows = [{ id: "a", name: "A" }];
    expect(preserveOwingRows("projects", rows, rows)).toBe(rows);
  });

  it("keeps a local edit of an existing row over a stale server snapshot", () => {
    markOwing("tasks");
    const previous = [{ id: "t1", title: "Renamed on the Mac" }];
    const incoming = [{ id: "t1", title: "Old title" }];
    expect(preserveOwingRows("tasks", previous, incoming)).toEqual(previous);
  });
});

describe("queryKeyOwesServer", () => {
  it("gates the vertical project query while a create is still queued", () => {
    expect(queryKeyOwesServer(["vertical", "projects"])).toBe(false);
    markOwing("projects");
    expect(queryKeyOwesServer(["vertical", "projects"])).toBe(true);
    expect(queryKeyOwesServer(["vertical", "initiatives"])).toBe(false);
    expect(queryKeyOwesServer(["tasks", "all"])).toBe(false);
  });

  it("gates task queries while a capture is still queued", () => {
    markOwing("tasks");
    expect(queryKeyOwesServer(["tasks", "all"])).toBe(true);
    expect(queryKeyOwesServer(["tasks", "inbox"])).toBe(true);
    expect(queryKeyOwesServer(["vertical", "projects"])).toBe(false);
  });

  it("gates settings via the user_settings table", () => {
    markOwing("user_settings");
    expect(queryKeyOwesServer(["settings"])).toBe(true);
  });
});
