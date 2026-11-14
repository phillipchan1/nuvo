// @vitest-environment jsdom
// "Leave it where it is", remembered per account (D-207, migration 95). The
// settings row's `repairs_left` is read when the column exists; until it does,
// this device's list is used and the column is never written (a write to a
// missing column parks the outbox op — the D-152 / Memory rule).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRepairs } from "../src/components/plan/repairActs";
import type { Repair } from "../src/hooks/useWeekRepair";

const repair = (key: string): Repair =>
  ({ key, kind: "task", id: key, title: key, why: "missed", from: { dayISO: "2026-11-10", startMin: 840, durationMin: 30 }, options: [{ dayISO: "2026-11-10", startMin: 960, durationMin: 30 }] }) as unknown as Repair;

function mount(row: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["settings"], { user_id: "u", ...row });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useRepairs([repair("a"), repair("b")], { apply: () => () => {} }), { wrapper });
  return { qc, hook };
}

describe("Leave it where it is, per account", () => {
  beforeEach(() => {
    const m = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
    });
  });

  it("hides what the ACCOUNT was told, on any device", () => {
    const { hook } = mount({ repairs_left: ["a"] });
    expect(hook.result.current.open.map((r) => r.key)).toEqual(["b"]);
  });

  it("before migration 95 runs, uses this device's list and writes no column", () => {
    localStorage.setItem("nuvo.repairsLeft.v1", JSON.stringify(["b"]));
    const { qc, hook } = mount({});
    expect(hook.result.current.open.map((r) => r.key)).toEqual(["a"]);
    act(() => hook.result.current.leave(repair("a")));
    expect(hook.result.current.open).toEqual([]);
    expect("repairs_left" in (qc.getQueryData(["settings"]) as object)).toBe(false);
  });

  it("the column exists on both databases", () => {
    expect(readFileSync("supabase/migrations/00000000000095_repairs_left.sql", "utf8")).toMatch(/add column if not exists repairs_left jsonb/);
    expect(readFileSync("worker/schema/neon.sql", "utf8")).toMatch(/ADD COLUMN IF NOT EXISTS repairs_left JSONB/);
  });
});
