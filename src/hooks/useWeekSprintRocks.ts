// useWeekSprintRocks — read + edit the priorities (big_rocks) of an ARBITRARY
// week's sprint, by week_start. The Week's Plan / Review needs this to act across
// week boundaries: reckon this week's priorities (complete / remove) AND seed
// next week's (carry-forward + fresh capture) — the forward-fold. Shares the
// ["sprint", weekStart] cache key with useVertical, so the current week stays in
// sync. Writes upsert the sprint row (creating it on first use).

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { BigRock, Sprint } from "../lib/types";

function blankRock(title: string): BigRock {
  return { id: crypto.randomUUID(), title, win: "", initiative_id: null, done_at: null, roll_count: 0 };
}

export interface WeekSprintRocks {
  rocks: BigRock[];
  /** add fresh priorities from free text (one per non-empty line). */
  addTitles: (titles: string[]) => void;
  removeRock: (id: string) => void;
  /** edit a priority in place — title, description (win), etc. */
  updateRock: (id: string, patch: Partial<BigRock>) => void;
  /** check off / un-check as landed (the "mark complete" action). */
  toggleDone: (id: string) => void;
  /** carry priorities in (id-deduped, roll_count bumped, done reset). Returns count newly added. */
  carryIn: (incoming: BigRock[]) => number;
  /** persist a new order of the priorities (array order IS the order). */
  reorder: (orderedIds: string[]) => void;
}

export function useWeekSprintRocks(weekStartISO: string): WeekSprintRocks {
  const qc = useQueryClient();
  const { data: sprint } = useQuery({
    queryKey: ["sprint", weekStartISO],
    queryFn: async (): Promise<Sprint | null> => {
      const { data, error } = await supabase.from("sprints").select("*").eq("week_start", weekStartISO).maybeSingle();
      if (error) throw error;
      return data as Sprint | null;
    },
  });
  const rocks = sprint?.big_rocks ?? [];

  const write = async (next: BigRock[]) => {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return;
    qc.setQueryData<Sprint | null>(["sprint", weekStartISO], (old) =>
      old ? { ...old, big_rocks: next } : ({ user_id: uid, week_start: weekStartISO, big_rocks: next } as unknown as Sprint),
    );
    const { error } = await supabase
      .from("sprints")
      .upsert({ user_id: uid, week_start: weekStartISO, big_rocks: next }, { onConflict: "user_id,week_start" });
    if (error) console.error("[useWeekSprintRocks] upsert failed", error);
    qc.invalidateQueries({ queryKey: ["sprint", weekStartISO] });
  };

  return {
    rocks,
    addTitles: (titles) => {
      const fresh = titles.map((t) => t.trim()).filter(Boolean).map(blankRock);
      if (fresh.length) void write([...rocks, ...fresh]);
    },
    removeRock: (id) => void write(rocks.filter((r) => r.id !== id)),
    updateRock: (id, patch) => void write(rocks.map((r) => (r.id === id ? { ...r, ...patch } : r))),
    toggleDone: (id) =>
      void write(rocks.map((r) => (r.id === id ? { ...r, done_at: r.done_at ? null : new Date().toISOString() } : r))),
    carryIn: (incoming) => {
      const have = new Set(rocks.map((r) => r.id));
      const add = incoming.filter((r) => !have.has(r.id)).map((r) => ({ ...r, done_at: null, roll_count: (r.roll_count ?? 0) + 1 }));
      if (!add.length) return 0;
      void write([...rocks, ...add]);
      return add.length;
    },
    reorder: (orderedIds) => {
      const byId = new Map(rocks.map((r) => [r.id, r]));
      const next = orderedIds.map((id) => byId.get(id)).filter((r): r is BigRock => Boolean(r));
      // keep any rock not named in the order (safety) appended in its old place
      for (const r of rocks) if (!orderedIds.includes(r.id)) next.push(r);
      if (next.length === rocks.length && next.some((r, i) => r.id !== rocks[i].id)) void write(next);
    },
  };
}
