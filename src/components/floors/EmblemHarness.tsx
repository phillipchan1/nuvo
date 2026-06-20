// Standalone verify harness for renderEmblem — a grid of fixture specs in both
// forming and sealed, so the emblem can be eyeballed without real data. Reached
// at ?emblem (mounted in main.tsx). Not part of any real surface.

import WeekEmblem from "./WeekEmblem";
import { seedFromWeek, satelliteAngles, type EmblemSpec } from "../../lib/weekEmblem";

const DOM = {
  work: "var(--accent)",
  family: "#c6708f",
  faith: "#6f8fb0",
  body: "#7faa86",
  craft: "#c8a15a",
};

function spec(
  weekISO: string,
  rings: { color: string; hours: number; target: number; quiet?: boolean }[],
  sats: ("landed" | "carried" | "open")[],
  ambient: number,
): EmblemSpec {
  const seed = seedFromWeek(weekISO);
  const maxH = Math.max(1, ...rings.map((r) => Math.max(r.hours, r.target)));
  const total = rings.reduce((s, r) => s + r.hours, 0);
  const dominant = [...rings].sort((a, b) => b.hours - a.hours)[0];
  const angles = satelliteAngles(sats.length, seed);
  return {
    sun: { color: dominant?.color ?? DOM.work, intensity: total > 0 ? (dominant?.hours ?? 0) / total : 0 },
    rings: rings.map((r) => ({
      color: r.color,
      sweep: r.quiet ? 0 : Math.min(1, r.hours / maxH),
      targetSweep: Math.min(1, r.target / maxH),
      ember: !!r.quiet,
    })),
    satellites: sats.map((state, i) => ({ state, angle: angles[i] ?? 0 })),
    ambient,
    seed,
  };
}

const FIXTURES: { label: string; spec: EmblemSpec }[] = [
  {
    label: "balanced mandala",
    spec: spec(
      "2026-06-15",
      [
        { color: DOM.work, hours: 12, target: 12 },
        { color: DOM.family, hours: 8, target: 8 },
        { color: DOM.faith, hours: 5, target: 5 },
        { color: DOM.body, hours: 4, target: 4 },
      ],
      ["landed", "landed", "carried", "open"],
      18,
    ),
  },
  {
    label: "lean / lopsided week",
    spec: spec(
      "2026-06-08",
      [
        { color: DOM.work, hours: 20, target: 12 },
        { color: DOM.family, hours: 2, target: 8 },
        { color: DOM.faith, hours: 0, target: 5, quiet: true },
        { color: DOM.body, hours: 1, target: 4, quiet: true },
      ],
      ["landed", "open", "open"],
      9,
    ),
  },
  {
    label: "every priority landed",
    spec: spec(
      "2026-06-01",
      [
        { color: DOM.work, hours: 10, target: 12 },
        { color: DOM.family, hours: 9, target: 8 },
        { color: DOM.craft, hours: 6, target: 4 },
      ],
      ["landed", "landed", "landed", "landed"],
      24,
    ),
  },
  {
    label: "all carried (a hard week)",
    spec: spec(
      "2026-05-25",
      [
        { color: DOM.work, hours: 6, target: 12 },
        { color: DOM.family, hours: 3, target: 8, quiet: true },
        { color: DOM.faith, hours: 4, target: 5 },
      ],
      ["carried", "carried", "open"],
      4,
    ),
  },
  {
    label: "quiet domains (embers)",
    spec: spec(
      "2026-05-18",
      [
        { color: DOM.work, hours: 14, target: 12 },
        { color: DOM.family, hours: 0, target: 8, quiet: true },
        { color: DOM.faith, hours: 0, target: 5, quiet: true },
        { color: DOM.body, hours: 0, target: 4, quiet: true },
      ],
      ["landed", "open"],
      11,
    ),
  },
  {
    label: "empty / nothing named yet",
    spec: spec(
      "2026-05-11",
      [
        { color: DOM.work, hours: 0, target: 12, quiet: true },
        { color: DOM.family, hours: 0, target: 8, quiet: true },
      ],
      [],
      0,
    ),
  },
];

export default function EmblemHarness() {
  return (
    <div className="atmosphere" style={{ minHeight: "100vh", padding: 32 }}>
      <h1 className="masthead text-display" style={{ marginBottom: 24 }}>
        Emblem harness
      </h1>
      {(["forming", "sealed"] as const).map((state) => (
        <section key={state} style={{ marginBottom: 40 }}>
          <div className="section-label" style={{ marginBottom: 16 }}>
            {state}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 24 }}>
            {FIXTURES.map((f) => (
              <div key={f.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <WeekEmblem spec={f.spec} state={state} size={180} />
                <div className="text-caption" style={{ color: "var(--muted)", textAlign: "center" }}>
                  {f.label}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      {/* the tiny toolbar glyph (forming, no ambient) */}
      <section>
        <div className="section-label" style={{ marginBottom: 12 }}>
          toolbar glyph (28px, forming, no ambient)
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          {FIXTURES.map((f) => (
            <WeekEmblem key={f.label} spec={f.spec} state="forming" size={28} hideAmbient />
          ))}
        </div>
      </section>
    </div>
  );
}
