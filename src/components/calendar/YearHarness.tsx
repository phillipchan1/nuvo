// Standalone verify harness for the Year's marks — the desktop Year
// (`CalendarYear`) at a full pane and a chat-narrowed one, and the phone's
// (`MobileYearView`) at 375px. Reached at ?year, mounted in main.tsx. Not
// part of any real surface. Precedent: DomainHarness (?domains),
// WeekCrownHarness (?weekcrown).
//
// The two shells share `YearParts`, so this is where a divergence would show
// up as a difference you can see: the same Tuesday must wear the same numeral
// and the same today ring on the desk and in your hand (D-127, D-128, D-129).
// The desktop panes are tall on purpose — fill-the-pane only proves itself
// when the box has height to claim.

import { useState, type ReactNode } from "react";
import { startOfDay } from "date-fns";
import CalendarYear from "../CalendarYear";
import MobileYearView from "../mobile/MobileYearView";

const today = startOfDay(new Date());
const YEAR = today.getFullYear();
const NOW = new Date(today.getTime() + (10 * 60 + 15) * 60_000);

function Frame({
  label,
  width,
  height = 720,
  children,
}: {
  label: string;
  width: number;
  height?: number;
  children: ReactNode;
}) {
  return (
    <div className="shrink-0">
      <div className="mb-1 text-micro uppercase tracking-wide text-muted">{label}</div>
      <div
        className="relative overflow-hidden rounded-lg border border-line"
        style={{ width, height, background: "transparent" }}
      >
        <div className="absolute inset-0 flex flex-col">{children}</div>
      </div>
    </div>
  );
}

export default function YearHarness() {
  const [year, setYear] = useState(YEAR);
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
        Same year, three panes. The year numeral sits on the map (swipe the
        phone pane — it travels with the months). Then month name → ink
        numerals → today as a signal disc → weekday whisper. Number grids stay
        dense (six square weeks); leftover height sits under the grid, not
        between the dates.
      </p>
      <div className="flex gap-4 overflow-x-auto pb-6">
        <Frame label="desktop · 1100×720" width={1100}>
          <CalendarYear
            year={year}
            now={NOW}
            weekStartsOn={0}
            onPickDay={noop}
            onPickMonth={noop}
          />
        </Frame>
        <Frame label="desktop · chat-narrow 400×720" width={400}>
          <CalendarYear
            year={year}
            now={NOW}
            weekStartsOn={0}
            onPickDay={noop}
            onPickMonth={noop}
          />
        </Frame>
        <Frame label="phone · 375px" width={375} height={640}>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <MobileYearView
              year={year}
              now={NOW}
              weekStartsOn={0}
              onPickMonth={noop}
              onPrev={() => setYear((y) => y - 1)}
              onNext={() => setYear((y) => y + 1)}
            />
          </div>
        </Frame>
      </div>
    </div>
  );
}
