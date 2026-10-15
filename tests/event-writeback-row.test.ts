/**
 * The edge functions' half of the re-drag race (docs/schedule-ux-audit-
 * 2026-10-15.md, P0 #5): after the provider answers a PATCH, `google-events`
 * and `icloud-events` rewrite the mirror row — and that rewrite used to be
 * unconditional, so a slow answer for the first drag put it back over a second
 * drag already written to the row. `rewriteMirrorRow` is the guard both now
 * use; it runs here against a table stand-in that applies filters the way
 * PostgREST does (instants compared as instants).
 */
import { describe, expect, it } from "vitest";

import {
  type MirrorRowFilter,
  type MirrorRowTable,
  parseRowAt,
  rewriteMirrorRow,
} from "../supabase/functions/_shared/eventWriteback.ts";

function tableOf(row: Record<string, unknown>) {
  const writes: Record<string, unknown>[] = [];
  const table: MirrorRowTable = {
    update(values) {
      const filters: [string, string][] = [];
      const filter: MirrorRowFilter = {
        eq(column, value) {
          filters.push([column, value]);
          return filter;
        },
        select() {
          const matches = filters.every(([column, value]) =>
            column.endsWith("_at")
              ? Date.parse(String(row[column])) === Date.parse(value)
              : row[column] === value,
          );
          if (matches) {
            Object.assign(row, values);
            writes.push(values);
          }
          return Promise.resolve({ data: matches ? [{ id: row.id }] : [], error: null });
        },
      };
      return filter;
    },
  };
  return { table, writes, row };
}

const at = (hour: number) => `2026-10-15T${hour}:00:00.000Z`;

describe("rewriting the mirror row from the provider's answer", () => {
  it("applies while the row still holds the times this write left", async () => {
    const { table, row } = tableOf({ id: "standup", start_at: "2026-10-15T18:00:00+00:00", end_at: at(19) });
    const outcome = await rewriteMirrorRow(table, "standup", { start_at: at(18), end_at: at(19), raw: { v: 1 } }, {
      start_at: at(18),
      end_at: at(19),
    });
    expect(outcome).toBe("written");
    expect(row.raw).toEqual({ v: 1 });
  });

  it("is dropped once a newer write has moved the row", async () => {
    // Drag 1 wrote 18:00; drag 2 has since written 20:00. Drag 1's answer arrives.
    const { table, writes, row } = tableOf({ id: "standup", start_at: at(20), end_at: at(21) });
    const outcome = await rewriteMirrorRow(table, "standup", { start_at: at(18), end_at: at(19) }, {
      start_at: at(18),
      end_at: at(19),
    });
    expect(outcome).toBe("superseded");
    expect(writes).toEqual([]);
    expect(row.start_at).toBe(at(20));
  });

  it("stays unconditional for a client that sends no rowAt", async () => {
    const { table, row } = tableOf({ id: "standup", start_at: at(20), end_at: at(21) });
    expect(await rewriteMirrorRow(table, "standup", { start_at: at(18) }, null)).toBe("written");
    expect(row.start_at).toBe(at(18));
  });

  it("reports a failed write instead of failing an edit the provider already has", async () => {
    const table: MirrorRowTable = {
      update: () => {
        const filter: MirrorRowFilter = {
          eq: () => filter,
          select: () => Promise.resolve({ data: null, error: { message: "timeout" } }),
        };
        return filter;
      },
    };
    expect(await rewriteMirrorRow(table, "standup", {}, null)).toBe("failed");
  });
});

describe("parseRowAt", () => {
  it("accepts two parseable instants and nothing else", () => {
    expect(parseRowAt({ start_at: at(18), end_at: at(19) })).toEqual({ start_at: at(18), end_at: at(19) });
    expect(parseRowAt(undefined)).toBeNull();
    expect(parseRowAt({ start_at: at(18) })).toBeNull();
    expect(parseRowAt({ start_at: "soon", end_at: at(19) })).toBeNull();
    expect(parseRowAt("2026-10-15")).toBeNull();
  });
});
