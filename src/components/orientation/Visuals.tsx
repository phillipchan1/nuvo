// Product-true mini-illustrations for the welcome walkthrough. Built from the
// same tokens as the app (never a raw hex — the Appearance step below is the one
// deliberate exception, see its own comment) so they flip in light/dark automatically,
// and animated with the shared orientation motion. These aren't decoration — they
// mirror the REAL app chrome (the Spine's ⌘1–4 rail, On Deck's week grid, the
// Schedule, the Domain floor's pulse) so a new user learns WHERE each concept lives,
// not just what it means.
//
// The task→project→initiative ladder (steps 2–4 in steps.tsx) shares the app's own
// real lifecycle as its visual grammar, not an invented one: a thing sits loose/ungroomed
// until it earns a slot in a progressively bigger time-container (hour → week → quarter).
// Domain (step 5) is the deliberate exception — ongoing, never slotted. Lightweight —
// inline divs/SVG, no deps.
import type { CSSProperties } from "react";
import { Kbd } from "../kit";

// The plate an illustration sits on — a raised kit surface, like a card (D-190).
function Plate({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[var(--r-card)] p-5" style={{ background: "var(--raised)", boxShadow: "0 0 0 1px var(--line-1), var(--sh-1)" }}>
      {children}
    </div>
  );
}

const AREAS = [
  { label: "Family", color: "var(--accent)" },
  { label: "Work", color: "var(--slot)" },
  { label: "Health", color: "var(--ok)" },
  { label: "Finances", color: "var(--muted)" },
];

function tint(color: string, pct = 16) {
  return `color-mix(in oklab, ${color} ${pct}%, transparent)`;
}

// Stagger helper: the `--i` index drives the shared `.orient-stagger` delay.
const at = (i: number) => ({ "--i": i } as CSSProperties);

// The ⌘N chip that tells the user exactly where a concept lives in the Spine.
function KeyBadge({ k }: { k: string }) {
  return <Kbd keys={[...k]} className="shrink-0" />;
}

// A small "still loose" precursor card — dashed, muted — shown to the LEFT of where
// a thing lands, so the ladder reads left-to-right like the rest of the app's art.
function LooseCard({ label, note, i = 0 }: { label: string; note: string; i?: number }) {
  return (
    <div
      className="orient-stagger flex w-14 shrink-0 flex-col justify-center gap-0.5 rounded-[var(--r-ctl)] border border-dashed border-[color:var(--line-2)] px-1.5 py-1.5"
      style={at(i)}
    >
      <span className="section-label">{label}</span>
      <span className="line-clamp-2 text-micro text-muted">{note}</span>
    </div>
  );
}

// The rightward "it just got groomed / slotted" connector between a LooseCard and
// the time-container it lands in.
function FlowArrow({ i = 1 }: { i?: number }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="orient-stagger shrink-0 self-center" style={at(i)}>
      <path d="M0 5h6m-2.5-2.5l2.5 2.5-2.5 2.5" stroke="var(--line-2)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
            className="orient-stagger flex items-center gap-2.5 rounded-[var(--r-card)] border border-[color:var(--line-1)] px-3 py-2"
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

// 2 — Schedule: a task starts loose in the Inbox, then a real time-block makes it
// work. The atom of the ladder — the smallest time-container (an hour).
export function TimeblockVisual() {
  const rows = ["9", "10", "11", "12", "1"];
  return (
    <Plate>
      <div className="flex w-full max-w-[260px] items-stretch gap-1.5">
        <LooseCard label="Inbox" note="Book trail passes" i={0} />
        <FlowArrow i={1} />
        <div className="flex flex-1 gap-2 overflow-hidden">
          <div className="flex flex-col justify-between py-0.5">
            {rows.map((r) => (
              <span key={r} className="mono text-micro leading-none text-muted">{r}</span>
            ))}
          </div>
          <div className="relative flex-1">
            {rows.map((_, i) => (
              <div key={i} className="h-7 border-t border-[color:var(--line-1)]" />
            ))}
            {/* an existing calendar commitment */}
            <div
              className="absolute left-1 right-1 top-[2px] flex items-center rounded-[var(--r-chip)] px-2"
              style={{ height: 24, background: tint("var(--muted)", 22), borderLeft: "2px solid var(--muted)" }}
            >
              <span className="text-micro text-muted">Standup</span>
            </div>
            {/* the task, dropping in and landing lifted like a grabbed block */}
            <div
              className="orient-drop glass-lift absolute left-3 right-0 flex items-center rounded-[var(--r-chip)] px-2"
              style={{ top: 58, height: 34, background: tint("var(--accent)", 30), borderLeft: "2px solid var(--accent)" }}
            >
              <span className="text-meta text-ink">Book trail passes</span>
            </div>
          </div>
        </div>
      </div>
    </Plate>
  );
}

// 3 — On Deck: a project sits ungroomed until it's ready, then it earns a week
// (or two) — the next size up in the same time-container grammar as Schedule.
export function OnDeckVisual() {
  const weeks = ["Jul 21", "Jul 28", "Aug 4"];
  const blocks: Record<number, { t: string; color: string }[]> = {
    0: [{ t: "Sat adventure", color: "var(--accent)" }, { t: "Q3 plan", color: "var(--slot)" }],
    1: [{ t: "Bedtime routine", color: "var(--accent)" }],
    2: [],
  };
  return (
    <Plate>
      <div className="flex w-full max-w-[260px] items-stretch gap-1.5">
        <LooseCard label="Not ready" note="Sat adventure" i={0} />
        <FlowArrow i={1} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="orient-stagger flex items-center gap-1" style={at(2)}>
            <span className="section-label flex-1">This week</span>
            <span className="rounded-[var(--r-chip)] px-1 py-0.5 text-micro leading-none" style={{ color: "var(--warn)", background: tint("var(--warn)", 12) }}>full</span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {weeks.map((w, i) => (
              <div key={w} className="orient-stagger flex min-w-0 flex-col gap-1 rounded-[var(--r-ctl)] border border-[color:var(--line-1)] bg-[var(--sunk)] p-1" style={{ ...at(i + 3), minHeight: 70 }}>
                <span className="mono text-micro text-muted">{w}</span>
                {blocks[i].map((b) => (
                  <span key={b.t} className="truncate rounded-[var(--r-chip)] px-1 py-1 text-micro text-ink" style={{ borderLeft: `2px solid ${b.color}`, background: tint(b.color, 16) }}>{b.t}</span>
                ))}
                {blocks[i].length === 0 && <span className="mt-auto rounded-[var(--r-chip)] border border-dashed border-[color:var(--line-2)] px-1 py-1 text-center text-micro text-muted">open</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Plate>
  );
}

// 4 — Initiative: the same groom-then-slot pattern one size up — a handful of
// projects converging on one outcome, sized to a quarter rather than a week.
export function InitiativeVisual() {
  const c = "var(--accent)";
  const projects = ["Sat adventure", "Bedtime routine", "Family trip"];
  const months = ["Jul", "Aug", "Sep"];
  return (
    <Plate>
      <div className="flex w-full max-w-[260px] items-stretch gap-1.5">
        <div className="flex w-16 shrink-0 flex-col justify-center gap-1">
          {projects.map((p, i) => (
            <span
              key={p}
              className="orient-stagger truncate rounded-[var(--r-chip)] px-1 py-1 text-micro text-ink"
              style={{ ...at(i), borderLeft: `2px solid ${c}`, background: tint(c, 16) }}
            >
              {p}
            </span>
          ))}
        </div>
        <FlowArrow i={3} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div
            className="orient-stagger flex items-center gap-1 rounded-[var(--r-ctl)] border border-[color:var(--line-1)] px-1.5 py-1.5"
            style={{ ...at(4), background: tint(c, 12) }}
          >
            <span className="h-4 w-1 shrink-0 rounded-full" style={{ background: c }} />
            <span className="min-w-0 flex-1 truncate text-micro text-ink">More present at home</span>
            <KeyBadge k="⌘3" />
          </div>
          <div className="grid grid-cols-3 gap-1">
            {months.map((m, i) => (
              <div
                key={m}
                className="orient-stagger flex items-center justify-center rounded-[var(--r-ctl)] border border-[color:var(--line-1)] bg-[var(--sunk)] text-micro text-muted"
                style={{ ...at(i + 5), minHeight: 30 }}
              >
                {m}
              </div>
            ))}
          </div>
          <span className="orient-stagger text-micro text-muted" style={at(8)}>groomed · this quarter</span>
        </div>
      </div>
    </Plate>
  );
}

// 5 — Domain: it all rolls up here. No grid, no edges — the deliberate exception to
// the groom-then-slot pattern above: a Domain has no start or end, just a continuous
// pulse of weeks you can glance back across.
export function DomainVisual() {
  const c = "var(--accent)";
  const weeks = [30, 55, 20, 70, 45, 85, 35, 60, 25, 75, 50, 40];
  return (
    <Plate>
      <div className="flex w-full max-w-[260px] items-stretch gap-1.5">
        <div
          className="orient-stagger flex w-16 shrink-0 flex-col justify-center gap-1 rounded-[var(--r-ctl)] border border-[color:var(--line-1)] px-1.5 py-1.5"
          style={{ ...at(0), background: tint(c, 12) }}
        >
          <span className="h-4 w-1 rounded-full" style={{ background: c }} />
          <span className="truncate text-micro text-ink">Family</span>
          <KeyBadge k="⌘4" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
          <div className="orient-stagger flex items-end gap-[3px]" style={{ ...at(1), height: 40 }}>
            {weeks.map((h, i) => (
              <span
                key={i}
                className="flex-1 rounded-sm"
                style={{ height: `${h}%`, background: tint(c, 24 + (i % 3) * 10) }}
              />
            ))}
          </div>
          <span className="orient-stagger text-micro text-muted" style={at(2)}>every week, however it went</span>
        </div>
      </div>
    </Plate>
  );
}

// 6 — Nuvo: the assistant does the legwork; you decide. Rides after the ladder so
// its own words (grooms, slots, plans the week) are already the reader's vocabulary.
export function NuvoVisual() {
  return (
    <Plate>
      <div className="flex w-full max-w-[250px] flex-col gap-2.5">
        <div className="orient-stagger flex items-center gap-2" style={at(0)}>
          <span className="text-body" style={{ color: "var(--accent)" }}>✦</span>
          <span className="section-label flex-1">Nuvo</span>
        </div>
        <div className="orient-stagger rounded-[var(--r-card)] rounded-tl-sm border border-[color:var(--line-1)] px-3 py-2.5" style={at(1)}>
          <p className="text-meta leading-relaxed text-ink">
            You have <span className="text-ink">3 open hours</span> Thursday. Want me to place
            <span style={{ color: "var(--accent)" }}> Saturday adventure</span> there?
          </p>
        </div>
        <div className="orient-stagger flex gap-2" style={at(2)}>
          <span className="orient-pulse rounded-[var(--r-ctl)] border border-accent px-2.5 py-1 text-micro" style={{ background: tint("var(--accent)", 14), color: "var(--accent)" }}>Place it</span>
          <span className="rounded-[var(--r-ctl)] border border-[color:var(--line-1)] px-2.5 py-1 text-micro text-muted">Not now</span>
        </div>
      </div>
    </Plate>
  );
}

// 7 — Capture: brain-dump raw text; it parses into structure and lands right in the
// Inbox already taught in step 2 — the fast door in, revealed once the room behind
// it makes sense.
export function CaptureVisual() {
  const chips = [
    { t: "Call David", meta: "tue 9am", color: "var(--accent)" },
    { t: "Book flights", meta: "#family", color: "var(--slot)" },
    { t: "Draft Q3 plan", meta: "!high", color: "var(--warn)" },
  ];
  return (
    <Plate>
      <div className="flex w-full max-w-[260px] items-stretch gap-1.5">
        <div className="orient-stagger flex w-20 shrink-0 flex-col justify-center gap-1 rounded-[var(--r-card)] border border-[color:var(--line-1)] bg-[var(--sunk)] px-1.5 py-1.5" style={at(0)}>
          <KeyBadge k="⌘K" />
          <span className="line-clamp-2 text-micro text-muted">Brain-dump anything…</span>
        </div>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0 self-center">
          <path className="orient-flow" d="M0 5h4" stroke="var(--line-2)" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M7 5h3m-2.5-2.5l2.5 2.5-2.5 2.5" stroke="var(--line-2)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {chips.map((c, i) => (
            <div key={c.t} className="orient-stagger flex items-center gap-2 rounded-[var(--r-ctl)] border border-[color:var(--line-1)] px-2.5 py-1.5" style={{ ...at(i + 1), borderLeft: `2px solid ${c.color}` }}>
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

// 9 — Ready: the week, at rest.
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

// The flow: domain → initiative → project → task, each with its ⌘ home. Not part of
// the numbered walkthrough sequence above — reused by the Initiatives empty-state
// teacher (see InitiativeOnDeckFloor.tsx).
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
              className="flex items-center gap-2 rounded-[var(--r-ctl)] border border-[color:var(--line-1)] px-2.5 py-1.5"
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
