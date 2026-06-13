import ReactDOM from "react-dom/client";
import "./index.css";

/* A standalone, data-free preview of the design prototype — the real index.css,
   the dark-anchor Spine, the light rail, and the oversized week numerals — so the
   look can be screenshotted without standing up auth/Supabase. Faithful replica
   of the real markup, not the live components. Not shipped. */

const FONTS: Record<string, string> = {
  jakarta: `"Plus Jakarta Sans", system-ui, sans-serif`,
  inter: `"Inter Variable", system-ui, sans-serif`,
  geist: `"Geist Variable", system-ui, sans-serif`,
  manrope: `"Manrope Variable", system-ui, sans-serif`,
  figtree: `"Figtree Variable", system-ui, sans-serif`,
};
const fontParam = new URLSearchParams(location.search).get("font");
if (fontParam && FONTS[fontParam]) {
  document.documentElement.style.setProperty("--font-sans", FONTS[fontParam]);
}
const themeParam = new URLSearchParams(location.search).get("theme");
if (themeParam === "dark") document.documentElement.setAttribute("data-theme", "dark");

const RUNGS = ["Today", "Day · Week", "Project", "Initiative", "Domain"];

const DAYS = [
  { n: "07", d: "mon" },
  { n: "08", d: "tue", today: true },
  { n: "09", d: "wed" },
  { n: "10", d: "thu" },
  { n: "11", d: "fri" },
  { n: "12", d: "sat" },
  { n: "13", d: "sun" },
];

// domain-tinted blocks: indigo (accent), sage, ember, slate
const sage = "#7fae9b";
const slate = "#8b8aa0";
const EVENTS = [
  { col: 0, top: 40, h: 88, title: "Monday sync", time: "9:00", color: "var(--accent)" },
  { col: 1, top: 70, h: 70, title: "Weekly design", time: "10:00", color: sage },
  { col: 1, top: 250, h: 96, title: "Write proposal", time: "1:00", color: "var(--accent)" },
  { col: 2, top: 96, h: 80, title: "Blog post", time: "10:30", color: "var(--signal)" },
  { col: 3, top: 150, h: 64, title: "Interview", time: "12:00", color: slate },
  { col: 4, top: 56, h: 110, title: "Book offsite", time: "8:45", color: sage },
  { col: 4, top: 250, h: 70, title: "Deep work", time: "1:00", color: "var(--accent)" },
];

const TASKS = [
  { t: "Design onboarding", dot: "var(--accent)", done: false },
  { t: "Write hiring criteria", dot: sage, done: false },
  { t: "Publish blog post", dot: "var(--signal)", done: false },
  { t: "Book offsite", dot: sage, done: false },
  { t: "Setup Zapier integration", dot: slate, done: false },
  { t: "Review Q3 numbers", dot: "var(--accent)", done: true },
];

function Spine() {
  return (
    <div className="spine-dark relative z-40 flex w-[74px] shrink-0 flex-col items-center border-r border-line bg-surface">
      <div className="h-9 w-full shrink-0" />
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="relative flex flex-col items-center gap-7">
          <div className="pointer-events-none absolute left-1/2 w-px -translate-x-1/2 bg-line" style={{ top: 6, bottom: 22 }} />
          {RUNGS.map((label, i) => {
            const on = i === 0;
            return (
              <div key={label} className="relative flex w-[74px] flex-col items-center">
                <span
                  className="rounded-full"
                  style={{
                    width: on ? 12 : 8,
                    height: on ? 12 : 8,
                    background: on ? "var(--accent)" : "var(--line-strong)",
                    boxShadow: on ? "0 0 0 4px var(--accent-soft), 0 0 12px 1px var(--accent-glow)" : "none",
                  }}
                />
                <span className="mono mt-1.5 text-center text-[9px] leading-tight" style={{ color: on ? "var(--text)" : "var(--muted)" }}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mono pb-3 text-center text-[9px] leading-tight text-muted">⌘1–5<br />⌘↓↑</div>
    </div>
  );
}

function Rail() {
  return (
    <div className="relative flex h-full w-[300px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex border-b border-line">
        {["Inbox", "Week", "Today"].map((t, i) => (
          <button key={t} className={`flex-1 px-3 py-2 text-caption font-semibold ${i === 2 ? "border-b-2 border-accent text-ink" : "text-muted"}`}>
            {t}<span className="mono ml-1.5 text-meta text-muted">{i === 2 ? 6 : i === 1 ? 9 : 3}</span>
          </button>
        ))}
      </div>
      <div className="border-b border-line p-2">
        <div className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-body text-muted/70">Capture… try "call David 9am 30m #work"</div>
      </div>
      <div className="section-label">Planned</div>
      {TASKS.map((task) => (
        <div key={task.t} className="group flex items-center gap-2.5 border-b border-line/60 px-3 py-2">
          <span className="h-3.5 w-3.5 shrink-0 rounded-[4px] border border-line-strong" style={{ borderColor: task.done ? task.dot : undefined, background: task.done ? task.dot : "transparent" }} />
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: task.dot }} />
          <span className={`flex-1 text-body ${task.done ? "text-muted line-through" : "text-ink"}`}>{task.t}</span>
        </div>
      ))}
      <div className="flex-1" />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-3 py-2 text-[10px] text-muted">
        {["E today", "T tmrw", "W next", "D done", "X trash"].map((k) => <span key={k}>{k}</span>)}
      </div>
    </div>
  );
}

function Calendar() {
  const colW = 100 / DAYS.length;
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-bg">
      {/* header bar — mirrors Planner */}
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
        <span className="wordmark wordmark-grad text-head">Nuvo</span>
        <span className="mono text-meta text-muted">Tue Mar 8</span>
        <span className="mono rounded border border-signal px-1 text-meta leading-snug text-signal">10:24 AM</span>
        <div className="flex-1" />
        <div className="flex overflow-hidden rounded-md border border-line">
          {["Day", "Week", "Month"].map((v) => (
            <span key={v} className={`px-2 py-1 text-label font-medium ${v === "Week" ? "bg-accent text-white" : "text-muted"}`}>{v}</span>
          ))}
        </div>
      </header>

      {/* week numerals */}
      <div className="flex shrink-0 border-b border-line bg-surface">
        <div className="w-12 shrink-0 border-r border-line/50" />
        {DAYS.map((day) => (
          <div key={day.n} className={`flex flex-1 flex-col items-center gap-0.5 border-r border-line/40 py-1.5 ${day.today ? "bg-accent-soft/40" : ""}`}>
            <span className={`mono text-[30px] font-bold leading-none tabular-nums tracking-[-0.02em] ${day.today ? "text-accent" : "text-ink"}`}>{day.n}</span>
            <span className={`text-micro font-semibold lowercase tracking-[0.08em] ${day.today ? "text-accent" : "text-muted"}`}>{day.d}</span>
          </div>
        ))}
      </div>

      {/* grid */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute inset-0 flex">
          <div className="w-12 shrink-0 border-r border-line/50">
            {["9 AM", "10 AM", "11 AM", "noon", "1 PM", "2 PM"].map((h, i) => (
              <div key={h} className="relative" style={{ height: 60 }}>
                <span className="mono absolute -top-1.5 right-1.5 text-[10px] text-muted">{h}</span>
                <div className="absolute inset-x-0 top-0 border-t border-line/60" />
              </div>
            ))}
          </div>
          <div className="relative flex-1">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="absolute inset-x-0 border-t border-line/60" style={{ top: i * 60 }} />
            ))}
            {DAYS.map((_, i) => (
              <div key={i} className="absolute top-0 bottom-0 border-r border-line/40" style={{ left: `${(i + 1) * colW}%` }} />
            ))}
            {EVENTS.map((e, i) => (
              <div
                key={i}
                className="lift absolute overflow-hidden rounded-md px-2 py-1.5"
                style={{
                  left: `calc(${e.col * colW}% + 4px)`,
                  width: `calc(${colW}% - 8px)`,
                  top: e.top,
                  height: e.h,
                  background: `color-mix(in srgb, ${e.color} 14%, var(--surface))`,
                  borderLeft: `3px solid ${e.color}`,
                  boxShadow: "var(--shadow-1)",
                }}
              >
                <div className="text-label font-semibold text-ink">{e.title}</div>
                <div className="mono text-micro text-muted">{e.time}</div>
              </div>
            ))}
            {/* now indicator */}
            <div className="absolute inset-x-0 z-10" style={{ top: 86 }}>
              <div className="h-px w-full" style={{ background: "var(--signal)" }} />
              <div className="absolute -left-0 -top-1 h-2 w-2 rounded-full" style={{ background: "var(--signal)" }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <div className="atmosphere flex h-screen w-screen overflow-hidden">
    <Spine />
    <Rail />
    <Calendar />
  </div>,
);
