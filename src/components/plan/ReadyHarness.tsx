// `?rail=ready` / `?rail=ready-phone` — Get ready (D-206) over a busy fixture:
// a broken block, today's work with no time (one falling to Friday), the
// week's loose pieces past what the cards carry (so "Plan the whole week"
// shows), inbox guesses, a thin path and a Memory observation. Every act logs
// and removes its card, so the stack's refill, "Ready." and the hand-back can
// be watched. Writes nothing. Mounted by RailHarness (its providers).

import { useMemo, useState } from "react";
import GetReadyRail from "./GetReadyRail";
import { Button } from "../kit";
import { ReadyStackSheet } from "../mobile/MobileGetReady";
import { composeReadyCards, type ReadyActs } from "../../lib/readyCards";
import { toDateISO } from "../../lib/dates";

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return toDateISO(d);
};

export default function ReadyHarness({ phone = false }: { phone?: boolean }) {
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [log, setLog] = useState<string[]>([]);
  const [open, setOpen] = useState(true);
  const say = (s: string) => setLog((l) => [s, ...l].slice(0, 6));

  const cards = useMemo(() => {
    const today = day(0);
    const gone = (k: string) => setDone((d) => new Set(d).add(k));
    const acts: ReadyActs = {
      move: (k) => (say(`moved ${k}`), gone(`repair:${k}`)),
      leave: (k) => (say(`left ${k}`), gone(`repair:${k}`)),
      repairAll: () => say("→ Repair mode"),
      hold: (id) => (say(`held ${id}`), gone(`hold:${id}`)),
      holdLoose: (id) => (say(`held ${id} (into the week)`), gone(`loose:${id}`)),
      planWeek: () => say("→ Plan the week"),
      file: (id) => (say(`filed ${id}`), gone(`file:${id}`)),
      draftPath: (id) => (say(`draft the path · ${id}`), gone(`path:${id}`)),
      keep: (k) => (say(`kept ${k}`), gone(`memory:${k}`)),
      notNow: (k) => (say(`not now · ${k}`), gone(k)),
    };
    return composeReadyCards({
      todayISO: today,
      weekISO: day(-new Date().getDay() + 1),
      acts,
      repairs: [
        {
          key: "r1",
          title: "Pricing page review with the whole leadership team",
          why: "meeting",
          event: "Board prep",
          from: { dayISO: today, startMin: 600, durationMin: 60 },
          to: { dayISO: day(1), startMin: 540, durationMin: 60 },
          projectId: "p1",
        },
      ],
      holds: [
        { taskId: "t1", title: "Email Dana the contract", projectId: null, at: { dayISO: today, startMin: 930, durationMin: 30 } },
        { taskId: "t2", title: "Order the replacement filter", projectId: null, at: { dayISO: day(2), startMin: 540, durationMin: 15 } },
      ],
      loose: [
        { taskId: "l1", title: "Draft the onboarding brief", projectId: "p2", projectName: "Volunteer onboarding", at: { dayISO: day(1), startMin: 600, durationMin: 60 } },
        { taskId: "l2", title: "Interview two leads", projectId: "p2", projectName: "Volunteer onboarding", at: { dayISO: day(2), startMin: 780, durationMin: 90 } },
        { taskId: "l3", title: "Rewrite the FAQ", projectId: "p3", projectName: "Garage studio", at: null },
      ],
      inbox: [
        { taskId: "i1", title: "Book the hall for March", place: "Frontier Church", projectId: null },
        { taskId: "i2", title: "Quote for the workbench and the long pegboard wall", place: "Garage studio and the long workbench", projectId: "p3" },
      ],
      thin: [{ projectId: "p4", name: "Launch site", evidence: "3h held · 20m of work" }],
      memory: { key: "m1", statement: "You stop at 4pm on Fridays", evidence: "6 of the last 8 weeks", consequence: "Fridays end at 4pm" },
    }).filter((c) => !done.has(c.key));
  }, [done]);

  const reset = () => (setDone(new Set()), setOpen(true), setLog([]));

  if (phone)
    return (
      <div className="flex h-dvh flex-col bg-[var(--bg)] p-4">
        <Button className="self-start" onClick={reset}>
          Reset
        </Button>
        <ol className="mt-3 text-caption text-muted">{log.map((l, i) => <li key={i}>{l}</li>)}</ol>
        {open && <ReadyStackSheet cards={cards} onClose={() => (setOpen(false), say("sheet closed"))} />}
      </div>
    );

  return (
    <div className="flex h-dvh bg-[var(--bg)]">
      {open ? (
        <GetReadyRail cards={cards} onClose={() => (setOpen(false), say("rail handed back"))} />
      ) : (
        <div className="w-[340px] shrink-0 p-4" style={{ borderRight: "1px solid var(--line-1)" }}>
          <p className="text-caption text-muted">The rest rail would be here.</p>
        </div>
      )}
      <div className="grid min-w-0 flex-1 content-start gap-3 p-6">
        <Button className="justify-self-start" onClick={reset}>
          Reset
        </Button>
        <ol className="text-caption text-muted">{log.map((l, i) => <li key={i}>{l}</li>)}</ol>
      </div>
    </div>
  );
}
