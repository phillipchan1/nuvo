// Product-faithful mini-illustrations for the welcome walkthrough. Built from the
// same tokens as the app (never a raw hex) so they flip in light/dark automatically,
// and animated with the shared orientation motion. These aren't decoration — they
// mirror the REAL app chrome (the Spine's ⌘1–4 rail, the domain→initiative→project→
// task funnel, On Deck's sprint grid, the Schedule) so a new user learns WHERE each
// concept lives, not just what it means. Lightweight — inline divs/SVG, no deps.
import type { CSSProperties } from "react";

// A soft glass plate the illustration sits on — echoes the app's resting material.
function Plate({ children }: { children: React.ReactNode }) {
  return (
    <div className="glass-card relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl border border-line p-5">
      {children}
    </div>
  );
}

const AREAS = [
  { label: "Family", color: "var(--accent)" },
  { label: "Work", color: "var(--slot)" },
  { label: "Faith", color: "var(--signal)" },
  { label: "Health", color: "var(--muted)" },
];

function tint(color: string, pct = 16) {
  return `color-mix(in oklab, ${color} ${pct}%, transparent)`;
}

// Stagger helper: the `--i` index drives the shared `.orient-stagger` delay.
const at = (i: number) => ({ "--i": i } as CSSProperties);

// The ⌘N chip that tells the user exactly where a concept lives in the Spine.
function KeyBadge({ k }: { k: string }) {
  return (
    <span className="mono shrink-0 rounded border border-line px-1.5 py-0.5 text-micro leading-none text-muted">
      {k}
    </span>
  );
}

// 1 — Welcome: the areas of a life, gathering into one calm frame.
export function WelcomeVisual() {
  return (
    <Plate>
      <div className="flex w-full max-w-[240px] flex-col gap-2.5">
        <div className="orient-stagger section-label mb-0.5 text-center" style={at(0)}>your week, held together</div>
        {AREAS.map((a, i) => (
          <div
            key={a.label}
            className="orient-stagger flex items-center gap-2.5 rounded-lg border border-line px-3 py-2"
            style={{ ...at(i + 1), background: tint(a.color, 10), borderLeft: `2px solid ${a.color}` }}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: a.color }} />
            <span className="text-caption text-ink">{a.label}</span>
            <span className="ml-auto h-1 w-10 rounded-full" style={{ background: tint(a.color, 40) }} />
          </div>
        ))}
      </div>
    </Plate>
  );
}

// 2 — The map: a faithful mini of the left Spine (Execute / Build · ⌘1–4).
export function SpineMapVisual() {
  const Row = ({ n, label, active, ready, i }: { n: string; label: string; active?: boolean; ready: number; i: number }) => (
    <div
      className="orient-stagger flex flex-col gap-1 rounded-md px-2 py-1.5"
      style={{ ...at(i), background: active ? "color-mix(in oklab, var(--surface) 75%, transparent)" : "transparent", boxShadow: active ? "var(--shadow-1)" : undefined }}
    >
      <div className="flex items-center gap-2">
        <span className="serif w-3.5 text-center text-caption leading-none" style={{ color: active ? "var(--accent)" : "var(--muted)" }}>{n}</span>
        <span className="flex-1 text-caption leading-none" style={{ color: active ? "var(--ink)" : "var(--muted)", fontWeight: active ? 600 : 400 }}>{label}</span>
      </div>
      <span className="ml-[22px] h-0.5 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
        <span className="block h-full rounded-full" style={{ width: `${ready}%`, background: "var(--accent)" }} />
      </span>
    </div>
  );
  return (
    <Plate>
      <div className="flex w-[188px] flex-col gap-1 rounded-lg border border-line bg-surface-2/30 p-2">
        <div className="wordmark px-1 pb-1 text-body leading-none text-ink">Nuvo</div>
        <div className="section-label px-1">Execute</div>
        <Row n="1" label="Schedule" active ready={70} i={0} />
        <div className="mx-1 my-1 border-t border-line" />
        <div className="section-label px-1">Build</div>
        <Row n="2" label="Projects" ready={55} i={1} />
        <Row n="3" label="Initiatives" ready={40} i={2} />
        <Row n="4" label="Domains" ready={85} i={3} />
      </div>
    </Plate>
  );
}

// 3 — The flow: domain → initiative → project → task, each with its ⌘ home.
export function FlowVisual() {
  const c = "var(--accent)";
  const tiers = [
    { k: "⌘4", type: "Domain", name: "Family", indent: 0 },
    { k: "⌘3", type: "Initiative", name: "Present, unhurried dad", indent: 1 },
    { k: "⌘2", type: "Project", name: "Plan Saturday adventure", indent: 2 },
    { k: "⌘1", type: "Task", name: "Book the trail passes", indent: 3 },
  ];
  return (
    <Plate>
      <div className="flex w-full max-w-[256px] flex-col gap-1">
        {tiers.map((t, i) => (
          <div key={t.type} className="orient-stagger flex flex-col" style={at(i)}>
            <div
              className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5"
              style={{ marginLeft: t.indent * 14, background: tint(c, 8) }}
            >
              <span className="h-4 w-1 shrink-0 rounded-full" style={{ background: c, opacity: 1 - t.indent * 0.16 }} />
              <span className="min-w-0 flex-1 truncate text-meta text-ink">{t.name}</span>
              <span className="text-micro text-muted">{t.type}</span>
              <KeyBadge k={t.k} />
            </div>
            {i < tiers.length - 1 && (
              <span
                aria-hidden
                className="text-micro leading-none text-muted"
                style={{ marginLeft: t.indent * 14 + 7 }}
              >
                ↓
              </span>
            )}
          </div>
        ))}
      </div>
    </Plate>
  );
}

// 4 — On Deck: time-box projects into the weeks (sprints) you'll do them.
export function OnDeckVisual() {
  const weeks = ["Jul 21", "Jul 28", "Aug 4"];
  const blocks: Record<number, { t: string; color: string }[]> = {
    0: [{ t: "Sat adventure", color: "var(--accent)" }, { t: "Q3 plan", color: "var(--slot)" }],
    1: [{ t: "Bedtime routine", color: "var(--accent)" }],
    2: [],
  };
  return (
    <Plate>
      <div className="flex w-full max-w-[260px] flex-col gap-1.5">
        <div className="orient-stagger flex items-center gap-1" style={at(0)}>
          <span className="section-label flex-1">Sprint 30</span>
          <span className="rounded-full border border-signal px-1.5 py-0.5 text-micro leading-none" style={{ color: "var(--signal)", background: tint("var(--signal)", 12) }}>week full</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {weeks.map((w, i) => (
            <div key={w} className="orient-stagger flex flex-col gap-1 rounded-md border border-line bg-surface-2/30 p-1.5" style={{ ...at(i + 1), minHeight: 74 }}>
              <span className="mono text-micro text-muted">{w}</span>
              {blocks[i].map((b) => (
                <span key={b.t} className="glass-card truncate rounded px-1.5 py-1 text-micro text-ink" style={{ borderLeft: `2px solid ${b.color}`, background: tint(b.color, 16) }}>{b.t}</span>
              ))}
              {blocks[i].length === 0 && <span className="mt-auto rounded border border-dashed border-line px-1 py-1 text-center text-micro text-muted">open</span>}
            </div>
          ))}
        </div>
      </div>
    </Plate>
  );
}

// 5 — Schedule: a task dropped onto the day becomes a real block of time.
export function TimeblockVisual() {
  const rows = ["9", "10", "11", "12", "1"];
  return (
    <Plate>
      <div className="flex w-full max-w-[240px] gap-2">
        <div className="flex flex-col justify-between py-0.5">
          {rows.map((r) => (
            <span key={r} className="mono text-micro leading-none text-muted">{r}</span>
          ))}
        </div>
        <div className="relative flex-1">
          {rows.map((_, i) => (
            <div key={i} className="h-7 border-t border-line" />
          ))}
          {/* an existing calendar commitment */}
          <div
            className="absolute left-1 right-1 top-[2px] flex items-center rounded px-2"
            style={{ height: 24, background: tint("var(--muted)", 22), borderLeft: "2px solid var(--muted)" }}
          >
            <span className="text-micro text-muted">Standup</span>
          </div>
          {/* the task, dropping in and landing lifted like a grabbed block */}
          <div
            className="orient-drop glass-lift absolute left-3 right-0 flex items-center rounded px-2"
            style={{ top: 58, height: 34, background: tint("var(--accent)", 30), borderLeft: "2px solid var(--accent)" }}
          >
            <span className="text-meta text-ink">Book trail passes</span>
          </div>
        </div>
      </div>
    </Plate>
  );
}

// 6 — Capture: brain-dump raw text; it parses into structure.
export function CaptureVisual() {
  const chips = [
    { t: "Call David", meta: "tue 9am", color: "var(--accent)" },
    { t: "Book flights", meta: "#family", color: "var(--slot)" },
    { t: "Draft Q3 plan", meta: "!high", color: "var(--signal)" },
  ];
  return (
    <Plate>
      <div className="flex w-full max-w-[250px] flex-col gap-3">
        <div className="orient-stagger flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2" style={at(0)}>
          <KeyBadge k="⌘K" />
          <span className="text-meta text-muted">Brain-dump anything…</span>
        </div>
        <svg width="18" height="16" viewBox="0 0 18 16" fill="none" className="mx-auto rotate-90">
          <path className="orient-flow" d="M2 8h12" stroke="var(--line-strong)" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M14 8l-4-4m4 4l-4 4" stroke="var(--line-strong)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="flex flex-col gap-1.5">
          {chips.map((c, i) => (
            <div key={c.t} className="orient-stagger glass-card flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5" style={{ ...at(i + 1), borderLeft: `2px solid ${c.color}` }}>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c.color }} />
              <span className="text-meta text-ink">{c.t}</span>
              <span className="mono ml-auto text-micro text-muted">{c.meta}</span>
            </div>
          ))}
        </div>
      </div>
    </Plate>
  );
}

// 7 — Nuvo: the assistant does the legwork; you decide.
export function NuvoVisual() {
  return (
    <Plate>
      <div className="flex w-full max-w-[250px] flex-col gap-2.5">
        <div className="orient-stagger flex items-center gap-2" style={at(0)}>
          <span className="text-body" style={{ color: "var(--accent)" }}>✦</span>
          <span className="section-label flex-1">Nuvo</span>
          <KeyBadge k="⌘J" />
        </div>
        <div className="orient-stagger glass-card rounded-lg rounded-tl-sm border border-line px-3 py-2.5" style={at(1)}>
          <p className="text-meta leading-relaxed text-ink">
            You have <span className="text-ink">3 open hours</span> Thursday. Want me to place
            <span style={{ color: "var(--accent)" }}> Saturday adventure</span> there?
          </p>
        </div>
        <div className="orient-stagger flex gap-2" style={at(2)}>
          <span className="orient-pulse rounded-md border border-accent px-2.5 py-1 text-micro" style={{ background: tint("var(--accent)", 14), color: "var(--accent)" }}>Place it</span>
          <span className="rounded-md border border-line px-2.5 py-1 text-micro text-muted">Not now</span>
        </div>
      </div>
    </Plate>
  );
}

// 8 — Ready: the week, at rest.
export function ReadyVisual() {
  return (
    <Plate>
      <div className="flex flex-col items-center gap-3">
        <div className="orient-stagger flex items-center gap-1.5" style={at(0)}>
          {AREAS.map((a) => (
            <span key={a.label} className="h-2.5 w-2.5 rounded-full" style={{ background: a.color }} />
          ))}
        </div>
        <svg width="52" height="52" viewBox="0 0 52 52" fill="none" className="orient-stagger" style={at(1)}>
          <circle cx="26" cy="26" r="24" stroke="var(--accent)" strokeWidth="1.5" opacity="0.35" />
          <path d="M17 26.5l6 6 12-13" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="orient-stagger section-label" style={at(2)}>all at rest</span>
      </div>
    </Plate>
  );
}
