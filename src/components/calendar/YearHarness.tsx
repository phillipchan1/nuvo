// Standalone verify harness for the Year's marks — the desktop Year
// (`CalendarYear`) at a full pane and a chat-narrowed one, and the phone's
// (`MobileYearView`) at 375px, over ONE set of fixtures. Reached at ?year,
// mounted in main.tsx. Not part of any real surface. Precedent: DomainHarness
// (?domains), WeekCrownHarness (?weekcrown).
//
// The two shells share `YearParts`, so this is where a divergence would show
// up as a difference you can see: the same Tuesday must wear the same shade
// and the same numeral on the desk and in your hand (D-106, D-127).

import { useMemo, useState, type ReactNode } from "react";
import { startOfDay } from "date-fns";
import CalendarYear from "../CalendarYear";
import MobileYearView from "../mobile/MobileYearView";
import type { DayCtx } from "../mobile/dayPlan";
import type { ExternalEvent, Task } from "../../lib/types";

const today = startOfDay(new Date());
const YEAR = today.getFullYear();
const NOW = new Date(today.getTime() + (10 * 60 + 15) * 60_000);

const iso = (dayOffset: number, h: number, m = 0) =>
  new Date(today.getTime() + dayOffset * 24 * 3600_000 + (h * 60 + m) * 60_000).toISOString();

let seq = 0;
const ev = (
  dayOffset: number,
  h: number,
  m: number,
  durMins: number,
  title: string,
): ExternalEvent =>
  ({
    id: `e${++seq}`,
    account_id: "a1",
    provider_event_id: `p${seq}`,
    calendar_id: "c1",
    title,
    start_at: iso(dayOffset, h, m),
    end_at: iso(dayOffset, h, m + durMins),
    all_day: false,
    location: null,
    busy: true,
    self_rsvp: null,
  }) as ExternalEvent;

const blk = (dayOffset: number, h: number, m: number, durMins: number, title: string): Task =>
  ({
    id: `t${++seq}`,
    title,
    start_time: iso(dayOffset, h, m),
    duration_minutes: durMins,
    status: "ready",
    project_id: null,
  }) as unknown as Task;

// Enough spread to paint every band: a packed day, a light one, a clear run,
// and an overcommitted Tuesday — so the numeral can be judged on every fill
// it has to survive, not just on paper.
const EVENTS: ExternalEvent[] = [
  ev(0, 9, 0, 30, "Standup"),
  ev(0, 10, 0, 90, "Design review"),
  ev(0, 13, 0, 180, "Offsite block"),
  ev(0, 17, 0, 60, "Wrap"),
  ev(1, 9, 0, 30, "Standup"),
  ev(2, 9, 0, 480, "Too much"),
  ev(2, 10, 0, 180, "Also this"),
  ...[-40, -26, -12, 6, 13, 20, 34].flatMap((d, i) => [
    ev(d, 9, 0, 30, "Standup"),
    ...(i % 2 === 0 ? [ev(d, 13, 0, 90, "Partner sync")] : []),
  ]),
];

const BLOCKS: Task[] = [
  blk(0, 15, 0, 90, "Write launch notes"),
  blk(2, 14, 0, 180, "Cram"),
  ...[-30, -16, 8, 22].map((d) => blk(d, 11, 0, 60, "Deep work")),
];

const CTX: DayCtx = {
  visibleEvents: EVENTS,
  blocks: BLOCKS,
  anytime: [],
  slots: [],
  slotChildren: {},
  slotTitles: new Map(),
  hidden: new Set(),
  workStart: 8 * 60,
  workEnd: 16 * 60 + 30,
  now: NOW,
};

function Frame({
  label,
  width,
  children,
}: {
  label: string;
  width: number;
  children: ReactNode;
}) {
  return (
    <div className="shrink-0">
      <div className="mb-1 text-micro uppercase tracking-wide text-muted">{label}</div>
      <div
        className="overflow-auto rounded-lg border border-line"
        style={{ width, height: 640, background: "transparent" }}
      >
        {children}
      </div>
    </div>
  );
}

export default function YearHarness() {
  const [year, setYear] = useState(YEAR);
  const ctx = useMemo(() => CTX, []);
  const noop = () => {};

  return (
    <div className="atmosphere min-h-screen p-4">
      <div className="mb-1 flex items-center gap-3">
        <h1 className="masthead text-head">The Year&apos;s marks (fixtures)</h1>
        <button
          className="rounded-full border border-line px-3 py-1 text-label text-muted"
          onClick={() => {
            const el = document.documentElement;
            el.dataset.theme = el.dataset.theme === "dark" ? "light" : "dark";
          }}
        >
          theme
        </button>
      </div>
      <p className="mb-3 max-w-[70ch] text-caption text-muted">
        Same fixtures, three panes. Shade is the read; the numeral is how you name
        the square. A Tuesday that is heavy on the desk and mute in your hand is
        the failure.
      </p>
      <div className="flex gap-4 overflow-x-auto pb-6">
        <Frame label="desktop · 1100px" width={1100}>
          <CalendarYear
            year={year}
            ctx={ctx}
            now={NOW}
            weekStartsOn={0}
            onPickDay={noop}
            onPickMonth={noop}
          />
        </Frame>
        <Frame label="desktop · chat-narrow 400px" width={400}>
          <CalendarYear
            year={year}
            ctx={ctx}
            now={NOW}
            weekStartsOn={0}
            onPickDay={noop}
            onPickMonth={noop}
          />
        </Frame>
        <Frame label="phone · 375px" width={375}>
          <MobileYearView
            year={year}
            ctx={ctx}
            now={NOW}
            weekStartsOn={0}
            onPickMonth={noop}
            onPrev={() => setYear((y) => y - 1)}
            onNext={() => setYear((y) => y + 1)}
          />
        </Frame>
      </div>
    </div>
  );
}
