/**
 * ?memory — Memory over a stranger's eight weeks (docs/memory.md §10). No auth,
 * no network: the REAL detectors (`readRhythm`) and the real panel, over a
 * fixture account that looks nothing like the builder's — a teacher with a
 * four-and-a-half-day week, an evening swim, a choir that's already a calendar
 * series, and two chores written by hand. Answers live in local state.
 */

import { useMemo, useState } from "react";
import { MemoryPageView, type MemoryApi } from "./MemoryPage";
import { MemoryIcon } from "./MemoryIcon";
import { describe, sectionOf, addDaysISO, type MemoryAnswer } from "../../lib/memory";
import type { MemoryItem } from "../../hooks/useMemory";
import { readRhythm, windowOf, type RhythmEvent } from "../../../supabase/functions/_shared/memory/rhythm";
import { todayISO } from "../../lib/dates";

const DOMAINS = [
  { id: "school", name: "School", kind: "work" as const, kindStored: true },
  { id: "swim", name: "Swimming", kind: "discipline" as const, kindStored: true },
  { id: "home", name: "Home", kind: "stewardship" as const, kindStored: true },
  { id: "choir", name: "Choir", kind: "community" as const, kindStored: true },
];

function fixture(today: string): { events: RhythmEvent[]; tasks: { title: string; createdDay: string }[] } {
  const win = windowOf(today);
  const day = (w: number, wd: number) => addDaysISO(win.start, w * 7 + wd);
  const ev = (w: number, wd: number, s: number, e: number, title: string, domainId: string, seriesId: string | null = null): RhythmEvent => ({
    title, day: day(w, wd), startMin: s * 60, endMin: e * 60, domainId, seriesId,
  });
  const events: RhythmEvent[] = [];
  for (let w = 0; w < 8; w++) {
    for (let d = 0; d < 5; d++) {
      events.push(ev(w, d, 8, 8.5, "Homeroom", "school"));
      events.push(ev(w, d, 9, 11.5, "Classes", "school"));
      if (d !== 4) {
        // Mon/Wed afternoons stay free for marking; Tue/Thu carry meetings.
        if (d === 1 || d === 3) events.push(ev(w, d, 13, 14, "Department meeting", "school"));
        events.push(ev(w, d, 14, 15.5, "Classes", "school"));
      } else events.push(ev(w, d, 11.5, 12.5, "Assembly", "school"));
    }
    if (!(w === 3)) events.push(ev(w, 1, 18.5, 19.5, "Swim", "swim"));
    if (!(w === 6)) events.push(ev(w, 3, 18.5, 19.5, "Swim", "swim"));
    events.push(ev(w, 2, 19, 21, "Choir rehearsal", "choir", "choir-series"));
  }
  const tasks = [
    ...[2, 3, 4, 5, 6, 7].map((i) => ({ title: "Order groceries", createdDay: addDaysISO(win.start, 6 + i * 7) })),
    ...["2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"].map((createdDay) => ({ title: "Pay rent", createdDay })),
  ];
  return { events, tasks };
}

export default function MemoryHarness() {
  const today = todayISO();
  const [open, setOpen] = useState(true);
  const [answers, setAnswers] = useState<MemoryAnswer[]>([]);
  const [learning, setLearning] = useState(true);

  const fx = useMemo(() => fixture(today), [today]);
  const heat = useMemo(() => {
    const win = windowOf(today);
    const seen = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => new Set<number>()));
    for (const e of fx.events) {
      const w = win.weekIndex(e.day);
      if (w < 0) continue;
      const wd = (new Date(`${e.day}T00:00:00Z`).getUTCDay() + 6) % 7;
      for (let h = Math.floor(e.startMin / 60); h < Math.ceil(e.endMin / 60); h++) seen[wd][h].add(w);
    }
    return seen.map((r) => r.map((x) => x.size));
  }, [fx, today]);
  const [work, setWork] = useState<string[]>(["school"]);
  const observations = useMemo(() => {
    const { events, tasks } = fx;
    return readRhythm({ today, events, tasks, workDomainIds: work, repeatingTitles: [], fallbackHours: { startMin: 480, endMin: 990 } });
  }, [today, fx, work]);

  const ctx = { domainName: (id: string | null) => DOMAINS.find((d) => d.id === id)?.name ?? null, currentHours: { startMin: 480, endMin: 990 } };
  const items: MemoryItem[] = [
    ...(learning ? observations : []).flatMap((o) => {
      const section = sectionOf(o, answers, today);
      return section ? [{ key: o.key, section, area: "Time" as const, described: describe(o, ctx), observation: o, answer: null }] : [];
    }),
    ...answers.map((a) => ({
      key: a.key,
      section: a.answer === "kept" ? ("kept" as const) : ("no" as const),
      area: "Time" as const,
      described: { title: a.statement, statement: a.statement, evidence: a.evidence, confidence: "sure" as const, source: a.source, uses: a.uses, keep: "", no: "", forget: a.forget ?? "" },
      observation: null,
      answer: a,
    })),
  ];

  const answer = (item: MemoryItem, kind: "kept" | "refused"): MemoryAnswer => ({
    key: item.key,
    answer: kind,
    at: new Date().toISOString(),
    until: kind === "refused" ? addDaysISO(today, 56) : null,
    area: "Time",
    statement: item.described.statement,
    evidence: item.described.evidence,
    source: kind === "kept" ? `${item.described.source} · kept today` : "You said not true today",
    uses: kind === "kept" ? item.described.uses : [],
    forget: item.described.forget,
  });

  const memory: MemoryApi = {
    available: true,
    learning,
    items,
    keep: async (item) => setAnswers((a) => [...a.filter((x) => x.key !== item.key), answer(item, "kept")]),
    refuse: (item) => setAnswers((a) => [...a.filter((x) => x.key !== item.key), answer(item, "refused")]),
    forget: async (item) => setAnswers((a) => a.map((x) => (x.key === item.key ? { ...x, answer: "refused" as const, until: addDaysISO(today, 56), source: "Forgotten today" } : x))),
    askAgain: (item) => setAnswers((a) => a.filter((x) => x.key !== item.key)),
    setLearning,
    markSeen: () => {},
    forgetAll: () => setAnswers([]),
    needsWorkDomain: work.length === 0,
    domains: DOMAINS as unknown as MemoryApi["domains"],
    workDomainIds: work,
    setWorkDomain: (id: string, on = true) => setWork((w) => (on ? [...new Set([...w, id])] : w.filter((x) => x !== id))),
    heat,
    reading: { weeks: 8, events: fx.events.length, written: fx.tasks.length },
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--ground)", padding: 16, display: "grid", alignContent: "start", gap: 12 }}>
      <p className="text-caption" style={{ color: "var(--muted)", margin: 0 }}>
        ?memory — the real detectors and panel over a fixture account (a teacher). {observations.length} observations.
      </p>
      <button className="sb-item" style={{ width: 200 }} onClick={() => setOpen(true)} aria-label="Memory">
        <span className="sb-icon sb-icon-dot"><MemoryIcon /></span>
        <span className="sb-label">Memory</span>
      </button>
      {open && <MemoryPageView memory={memory} onClose={() => setOpen(false)} />}
    </div>
  );
}
