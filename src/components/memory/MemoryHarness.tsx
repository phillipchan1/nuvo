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
import { describe, sectionOf, addDaysISO, blocksOf, chipOf, clauseOf, labelOf, type MemoryAnswer } from "../../lib/memory";
import { readMemoryFace, type MemoryItem } from "../../lib/memoryRead";
import { appendGraded, type Graded, type GradeIn } from "../../lib/memoryGrade";
import type { Observation } from "../../../supabase/functions/_shared/memory/rhythm";
import { readRhythm, windowOf, type RhythmEvent } from "../../../supabase/functions/_shared/memory/rhythm";
import { todayISO } from "../../lib/dates";

const DOMAINS = [
  { id: "school", name: "School", kind: "work" as const, kindStored: true, color: "#2f63c9", charter: "Teaching Year 9 and 10 science, and what the school asks of me.", intention: "Leave school at school." },
  { id: "swim", name: "Swimming", kind: "discipline" as const, kindStored: true, color: "#0b7f86", charter: "Two swims a week, every week.", intention: "" },
  { id: "home", name: "Home", kind: "stewardship" as const, kindStored: true, color: "#5b7a22", charter: "", intention: "" },
  { id: "choir", name: "Choir", kind: "community" as const, kindStored: true, color: "#8a6a12", charter: "The Wednesday choir and its concerts.", intention: "" },
];

/** Forty drafted steps graded: the first twenty 9 kept, the last twenty 14 (§13.4). */
function gradedFixture(today: string): Graded[] {
  const out: GradeIn[] = [];
  const keptIn = (i: number) => (i < 20 ? i % 20 < 9 : (i - 20) % 20 < 14);
  for (let i = 0; i < 40; i++)
    out.push({ s: "path", o: keptIn(i) ? "kept" : i % 3 ? "edited" : "dropped", at: `${addDaysISO(today, -60 + i)}T12:00:00.000Z`, t: `Step ${i + 1}` });
  return appendGraded([], out);
}

/** What a Keep stores, the way useMemory stores it: the clause and the shape travel with the answer. */
function keptAnswer(o: Observation, at: string, workLabel: string, statement: string, evidence: string): MemoryAnswer {
  return {
    key: o.key, answer: "kept", at, area: "Time", statement, evidence, source: "From your calendar", uses: [],
    clause: clauseOf(o, "kept"), chip: chipOf(o, workLabel), blocks: blocksOf(o), label: labelOf(o, workLabel), kind: o.kind,
    domainId: o.kind === "habit" ? o.domainId : null,
  };
}

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
  const lived = new URLSearchParams(location.search).get("account") !== "fresh";
  const [answersState, setAnswers] = useState<MemoryAnswer[] | null>(null);
  const [gradedState, setGraded] = useState<Graded[] | null>(null);
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

  // A lived-in account kept its hours and its swim three weeks ago.
  const seeded = useMemo(() => {
    if (!lived) return [];
    const at = `${addDaysISO(today, -21)}T09:00:00.000Z`;
    return observations
      .filter((o) => o.kind === "hours" || (o.kind === "habit" && o.title === "Swim"))
      .map((o) => keptAnswer(o, at, "School", describe(o, { domainName: () => null, currentHours: { startMin: 480, endMin: 990 } }).statement, `${o.hits} of ${o.of}`));
  }, [lived, observations, today]);
  const answers = answersState ?? seeded;
  const graded = gradedState ?? (lived ? gradedFixture(today) : []);
  const grade = (g: GradeIn[]) => setGraded(appendGraded(graded, g));

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

  const answer = (item: MemoryItem, kind: "kept" | "refused"): MemoryAnswer => kind === "kept" && item.observation
    ? { ...keptAnswer(item.observation, new Date().toISOString(), "School", item.described.statement, item.described.evidence), source: `${item.described.source} · kept today`, uses: item.described.uses, forget: item.described.forget }
    : ({
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
  const asked = (item: MemoryItem, o: GradeIn["o"]) => item.section === "new" && grade([{ s: "question", o, t: item.described.title }]);

  const face = readMemoryFace({
    today,
    items,
    observations,
    answers,
    graded,
    workNames: DOMAINS.filter((d) => work.includes(d.id)).map((d) => d.name),
    events: fx.events,
    learning,
  });

  const memory: MemoryApi = {
    available: true,
    learning,
    items,
    keep: async (item) => { asked(item, "kept"); setAnswers([...answers.filter((x) => x.key !== item.key), answer(item, "kept")]); },
    refuse: (item) => { asked(item, "dropped"); setAnswers([...answers.filter((x) => x.key !== item.key), answer(item, "refused")]); },
    forget: async (item) => setAnswers(answers.map((x) => (x.key === item.key ? { ...x, answer: "refused" as const, until: addDaysISO(today, 56), source: "Forgotten today" } : x))),
    askAgain: (item) => setAnswers(answers.filter((x) => x.key !== item.key)),
    setLearning,
    markSeen: () => {},
    forgetAll: () => { setAnswers([]); setGraded([]); },
    needsWorkDomain: work.length === 0,
    domains: DOMAINS as unknown as MemoryApi["domains"],
    workDomainIds: work,
    setWorkDomain: (id: string, on = true) => setWork((w) => (on ? [...new Set([...w, id])] : w.filter((x) => x !== id))),
    heat,
    reading: { weeks: 8, events: fx.events.length, written: fx.tasks.length },
    ...face,
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--ground)", padding: 16, display: "grid", alignContent: "start", gap: 12 }}>
      <p className="text-caption" style={{ color: "var(--muted)", margin: 0 }}>
        ?memory — the real detectors and page over a fixture account (a teacher), {lived ? "lived in: hours and swim kept three weeks ago, 40 drafts graded" : "fresh: nothing kept, nothing graded"}.{" "}
        <a href={lived ? "?memory&account=fresh" : "?memory"}>{lived ? "Fresh account" : "Lived-in account"}</a>
      </p>
      <button className="sb-item" style={{ width: 200 }} onClick={() => setOpen(true)} aria-label="Memory">
        <span className="sb-icon sb-icon-dot"><MemoryIcon /></span>
        <span className="sb-label">Memory</span>
      </button>
      {open && <MemoryPageView memory={memory} onClose={() => setOpen(false)} />}
    </div>
  );
}
