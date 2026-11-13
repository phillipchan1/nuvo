import type { ReactNode } from "react";
import { Ladder } from "./Ladder";
import { readLadder } from "./ladderRead";
import { ORIENTATION_TEACH_STEPS } from "./steps";
import { TeachCard } from "./TeachCard";
import { WelcomePage } from "./Orientation";
import type { VerticalData } from "../../lib/vertical";
import type { Task } from "../../lib/types";

// `?orientation` — the welcome and every walkthrough step over fixtures (D-200).
//   ?orientation            the welcome, full page (resize to 375 for the phone)
//   ?orientation=steps      every step's card, waiting and landed, Light | Dark
//   ?orientation=empty      the closing ladder on an account that made nothing
// The live walkthrough still has to be walked in the app; this is where the
// look and the copy are checked in one screen.

const noop = () => {};

// Example data in the domain kinds (P16), never one operator's life.
const DOMAINS = [
  { id: "d1", name: "Work", color: "#2563EB" },
  { id: "d2", name: "Family", color: "#DB2777" },
  { id: "d3", name: "Health", color: "#059669" },
  { id: "d4", name: "Community", color: "#7C3AED" },
];

const THU_9 = (() => {
  const d = new Date();
  d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7));
  d.setHours(9, 0, 0, 0);
  return d;
})();

const TASKS = [
  {
    id: "t1",
    title: "Draft the pricing page",
    status: "planned",
    do_date: THU_9.toISOString().slice(0, 10),
    start_time: THU_9.toISOString(),
    created_at: "2026-11-13T10:00:00Z",
    updated_at: "2026-11-13T10:02:00Z",
    trashed_at: null,
    project_id: "p1",
    initiative_id: null,
    domain_id: "d1",
  },
] as unknown as Task[];

const DATA = {
  domains: DOMAINS,
  initiatives: [],
  projects: [{ id: "p1", name: "Launch the paid plan", domainId: "d1", initiativeId: null, createdAt: "2026-11-13T10:01:00Z" }],
} as unknown as VerticalData;

const RECEIPTS: Record<string, ReactNode> = {
  capture: <>“Draft the pricing page” is in.</>,
  timeblock: <>“Draft the pricing page” · Thu 9am</>,
  project: <>“Launch the paid plan” is a project.</>,
  nuvo: "Asked. Nuvo has it.",
  calendars: "Your calendar is in.",
};

function Steps({ empty = false }: { empty?: boolean }) {
  const filled = readLadder(empty ? ({ domains: DOMAINS, initiatives: [], projects: [] } as unknown as VerticalData) : DATA, empty ? [] : TASKS);
  const cards = ORIENTATION_TEACH_STEPS.flatMap((s, i) => {
    const visual = s.ladder ? <Ladder rungs={filled.rungs} hour={filled.hour} size="dock" /> : s.Visual ? <div className="flex justify-center"><s.Visual /></div> : null;
    const base = { step: s, index: i, total: ORIENTATION_TEACH_STEPS.length, visual, onSkip: noop, onBack: noop, onNext: noop, onCta: s.cta ? noop : undefined };
    return s.milestone
      ? [<TeachCard key={`${s.id}-w`} {...base} />, <TeachCard key={`${s.id}-d`} {...base} done receipt={RECEIPTS[s.id]} />]
      : [<TeachCard key={s.id} {...base} />];
  });
  const column = (theme: "light" | "dark") => (
    <div data-theme={theme} style={{ background: "var(--ground)", padding: 24, display: "grid", gap: 20, alignContent: "start", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 360px))" }}>
      {(empty ? cards.filter((c) => String(c.key) === "rules") : cards)}
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", minHeight: "100dvh" }}>
      {column("light")}
      {column("dark")}
    </div>
  );
}

export default function OrientationHarness() {
  const page = new URLSearchParams(window.location.search).get("orientation") || "welcome";
  if (page === "steps") return <Steps />;
  if (page === "empty") return <Steps empty />;
  return (
    <div style={{ height: "100dvh", overflowY: "auto" }}>
      <WelcomePage domains={DOMAINS} onSkip={noop} onStart={noop} />
    </div>
  );
}
