// Domain — the anchor of faithfulness, reimagined as a place you ENTER, not a
// dashboard you scan. The floor opens on a "wall": a polyptych of arched niches,
// each lit by its own colour, each carrying a faithfulness lamp (warm when
// tended, a cold smoking ember when you've gone quiet). Click a niche to descend
// into its "chapel": the standing vow set as a Fraunces inscription, a 13-week
// faithfulness pulse instead of a progress bar, and the initiatives demoted to a
// quiet colophon at the foot. Domains don't ask for action — they ask to be kept.

import { useEffect, useId, useState, type CSSProperties } from "react";
import { useVertical } from "../../hooks/useVertical";
import { supabase } from "../../lib/supabase";
import {
  faithfulness,
  initiativesOf,
  looseTasksOfDomain,
  type Domain,
  type DomainContext,
} from "../../lib/vertical";
import type { Focus } from "../AppShell";
import { FloorHeader, InlineNumber, InlineText, InlineTextarea, DeleteBtn } from "./parts";

const SWATCHES = ["#DB2777", "#7C3AED", "#2563EB", "#0D9488", "#059669", "#D97706", "#4F46E5", "#DC2626", "#0891B2", "#65A30D"];

// ── Ornaments — a small set of hand-drawn crests. The motif is assigned by the
// domain's standing position, so the first six each get a distinct face and the
// crest stays stable for a fixture that's reordered only once in years. ────────
const MOTIFS = ["canopy", "rose", "rosette", "tide", "sun", "lattice"] as const;
type Motif = (typeof MOTIFS)[number];

const motifAt = (i: number): Motif => MOTIFS[((i % MOTIFS.length) + MOTIFS.length) % MOTIFS.length];

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" as const };

function Ornament({ motif, color, className, style }: { motif: Motif; color: string; className?: string; style?: CSSProperties }) {
  let body: React.ReactNode;
  if (motif === "canopy") {
    body = (
      <>
        <g {...STROKE}>
          <path d="M24 132 A76 76 0 0 1 176 132" />
          <path d="M42 132 A58 58 0 0 1 158 132" />
          <path d="M60 132 A40 40 0 0 1 140 132" />
          <path d="M78 132 A22 22 0 0 1 122 132" />
        </g>
        <g fill="currentColor">
          <circle cx="84" cy="146" r="6.5" /><circle cx="100" cy="151" r="7.5" /><circle cx="116" cy="146" r="6.5" />
          <circle cx="93" cy="162" r="4.5" /><circle cx="107" cy="162" r="4.5" />
        </g>
      </>
    );
  } else if (motif === "rose") {
    body = (
      <g {...STROKE} transform="translate(100,100)">
        {Array.from({ length: 12 }, (_, k) => (
          <path key={k} transform={`rotate(${k * 30})`} d="M0 -22 Q16 -50 0 -82 Q-16 -50 0 -22 Z" />
        ))}
        <circle r="82" /><circle r="60" /><circle r="20" />
        <path d="M0 -20 L0 20 M-20 0 L20 0 M-14 -14 L14 14 M-14 14 L14 -14" />
      </g>
    );
  } else if (motif === "rosette") {
    body = (
      <g {...STROKE} transform="translate(100,100)">
        {Array.from({ length: 6 }, (_, k) => (
          <rect key={k} x={-62} y={-62} width={124} height={124} rx={8} transform={`rotate(${k * 15})`} />
        ))}
        <circle r="20" />
      </g>
    );
  } else if (motif === "tide") {
    body = (
      <g {...STROKE}>
        {Array.from({ length: 5 }, (_, k) => {
          const y = 58 + k * 17;
          return <path key={k} d={`M14 ${y} Q44 ${y - 13} 74 ${y} T 134 ${y} T 196 ${y}`} />;
        })}
      </g>
    );
  } else if (motif === "sun") {
    body = (
      <g {...STROKE} transform="translate(100,100)">
        {Array.from({ length: 16 }, (_, k) => (
          <line key={k} x1={0} y1={-32} x2={0} y2={-50} transform={`rotate(${k * 22.5})`} />
        ))}
        <circle r="24" />
      </g>
    );
  } else {
    body = (
      <g {...STROKE} transform="translate(100,100)">
        {Array.from({ length: 7 }, (_, k) => {
          const o = -66 + k * 22;
          return (
            <g key={k}>
              <line x1={o} y1={-66} x2={o} y2={66} />
              <line x1={-66} y1={o} x2={66} y2={o} />
            </g>
          );
        })}
        <circle r="68" />
      </g>
    );
  }
  return (
    <svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet" aria-hidden className={className} style={{ color, ...style }}>
      {body}
    </svg>
  );
}

// ── The lamp — faithfulness made into light. Warm flame when tended; a cold
// ember with a thread of smoke when the domain has gone quiet. ────────────────
function Flame({ color, lit, size }: { color: string; lit: boolean; size: number }) {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, "");
  const w = Math.round(size * 0.71);
  if (lit) {
    return (
      <svg width={w} height={size} viewBox="0 0 60 84" style={{ overflow: "visible" }} aria-hidden>
        <defs>
          <radialGradient id={`fl${raw}`} cx="50%" cy="62%" r="52%">
            <stop offset="0%" stopColor={color} stopOpacity="0.85" />
            <stop offset="55%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="30" cy="48" rx="28" ry="34" fill={`url(#fl${raw})`} />
        <path d="M30 22 C41 38 41 54 30 62 C19 54 19 40 30 22 Z" fill={color} />
        <path d="M30 38 C36 47 36 56 30 62 C24 56 24 48 30 38 Z" fill="#FFF4DD" opacity="0.85" />
      </svg>
    );
  }
  return (
    <svg width={w} height={size} viewBox="0 0 60 84" style={{ overflow: "visible" }} aria-hidden>
      <circle cx="30" cy="56" r="6" fill="var(--muted)" />
      <circle cx="30" cy="56" r="13" fill="none" stroke="var(--muted)" strokeOpacity="0.4" strokeWidth="1" />
      <path d="M30 44 q5 6 0 11 q-5 5 0 10" fill="none" stroke="var(--muted)" strokeOpacity="0.5" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

// ── The faithfulness pulse — 13 weeks of showing-up, an EKG, not a bar. ───────
function Pulse({ weeks, color, target }: { weeks: number[]; color: string; target: number }) {
  const W = 320, H = 52, n = weeks.length, gap = 5;
  const bw = (W - (n - 1) * gap) / n;
  const norm = target > 0 ? target : Math.max(...weeks, 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet" aria-hidden style={{ maxWidth: W }}>
      {weeks.map((hours, i) => {
        const v = Math.max(0, Math.min(1.25, hours / norm));
        const h = 5 + v * 42;
        const x = i * (bw + gap);
        const lit = v > 0.06;
        return (
          <rect key={i} x={x} y={48 - h} width={bw} height={h} rx={bw / 2}
            fill={lit ? color : "var(--muted)"} opacity={lit ? 0.3 + v * 0.6 : 0.22} />
        );
      })}
    </svg>
  );
}

function Flourish({ color }: { color: string }) {
  return (
    <svg width={124} height={12} viewBox="0 0 124 12" aria-hidden style={{ color }}>
      <g stroke="currentColor" fill="none" strokeWidth={1} opacity={0.5}>
        <line x1="6" y1="6" x2="50" y2="6" /><line x1="74" y1="6" x2="118" y2="6" />
      </g>
      <rect x="58" y="2" width="8" height="8" transform="rotate(45 62 6)" fill="currentColor" opacity={0.75} />
    </svg>
  );
}

// ── Faithfulness, voiced ──────────────────────────────────────────────────────
function ago(d: number) { return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; }
function fmtH(h: number) { return `${h.toFixed(h % 1 === 0 ? 0 : 1)}h`; }

function stateOf(d: Domain): { tone: "lit" | "quiet"; line: string; short: string } {
  const f = faithfulness(d);
  if (f.lit) {
    if (d.weeklyTargetHours > 0 && d.investedThisWeek > d.weeklyTargetHours)
      return { tone: "lit", line: `Tended ${ago(d.lastTouchedDays)} — over your ${fmtH(d.weeklyTargetHours)} this week`, short: `over ${fmtH(d.investedThisWeek)}` };
    return { tone: "lit", line: `Tended ${ago(d.lastTouchedDays)} — ${fmtH(d.investedThisWeek)} kept this week`, short: "tended" };
  }
  if (d.lastTouchedDays >= 99) return { tone: "quiet", line: "Untended — no time has been kept here yet", short: "untended" };
  return { tone: "quiet", line: `Quiet for ${d.lastTouchedDays} days — when did you last show up here?`, short: `quiet · ${d.lastTouchedDays}d` };
}

const mom = (m: string) => (m === "up" ? "↑" : m === "down" ? "↓" : "→");

// ── Clarity, voiced ───────────────────────────────────────────────────────────
// A second axis from faithfulness: how well Nuvo can ROUTE captures here. Read
// purely from persisted state (no AI call) so the wall can show, at a glance,
// which domains still need refining, how far along they are, and why.
type Clarity = { level: "clear" | "partial" | "unrefined"; label: string; why: string; pct: number };

function clarityOf(d: Domain): Clarity {
  const ctx = d.context;
  if (ctx) {
    const signals = ctx.entities.length + ctx.keywords.length;
    if (signals === 0)
      return { level: "partial", label: "needs detail", why: "Refined, but Nuvo couldn't pull anything specific to route on — re-refine with a richer line.", pct: 0.6 };
    const lead = ctx.entities.slice(0, 3).join(", ") || ctx.keywords.slice(0, 3).join(", ");
    return { level: "clear", label: "refined", why: `Nuvo files captures here by ${lead}.`, pct: 1 };
  }
  if (d.charter.trim())
    return { level: "partial", label: "refine to finish", why: "You've described it — one tap on Refine teaches Nuvo what belongs here.", pct: 0.35 };
  return { level: "unrefined", label: "needs refining", why: "Nuvo files here by name alone. Describe what belongs so captures land here.", pct: 0 };
}

function ClarityMark({ domain }: { domain: Domain }) {
  const c = clarityOf(domain);
  const amber = c.level !== "clear";
  return (
    <div className="relative mt-2.5 flex w-full max-w-[116px] flex-col items-center gap-1" title={c.why}>
      <div className="h-[3px] w-full overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
        <div style={{ width: `${Math.round(c.pct * 100)}%`, height: "100%", background: amber ? "var(--signal)" : domain.color, transition: "width .3s" }} />
      </div>
      <span className="text-micro" style={{ color: amber ? "var(--signal)" : "var(--muted)", letterSpacing: "0.04em" }}>
        {amber ? "✦ " : ""}{c.label}
      </span>
    </div>
  );
}

// ══ The wall — a polyptych of niches ═════════════════════════════════════════
export default function DomainFloor({
  focus,
  onSwitchDomain,
  onOpenInitiative,
}: {
  focus: Focus;
  onSwitchDomain: (id: string) => void;
  onOpenInitiative: (id: string) => void;
}) {
  const { data, addDomain } = useVertical();
  const domains = [...data.domains].sort((a, b) => a.sort - b.sort);
  const [openId, setOpenId] = useState<string | null>(null);

  const enter = (id: string) => { onSwitchDomain(id); setOpenId(id); };
  const openIdx = openId ? domains.findIndex((d) => d.id === openId) : -1;
  const open = openIdx >= 0 ? domains[openIdx] : null;

  if (open) {
    return (
      <div className="floor-enter">
        <Chapel key={open.id} domain={open} motif={motifAt(openIdx)} onBack={() => setOpenId(null)} onOpenInitiative={onOpenInitiative} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1180px]">
      <FloorHeader
        eyebrow="The anchor · areas that persist for years"
        actions={
          <button
            onClick={() => void addDomain().then((d) => enter(d.id))}
            className="fast rounded-md border border-line px-2.5 py-1 text-label text-muted hover:border-muted hover:text-ink"
          >
            + domain
          </button>
        }
      >
        <h1 className="serif text-[26px]" style={{ fontWeight: 500 }}>The fixtures of your life</h1>
        <p className="mt-1 max-w-[560px] text-body text-muted">
          Measured by faithfulness over a long arc — not throughput. Are you still showing up?
        </p>
        {(() => {
          const total = domains.length;
          const clear = domains.filter((d) => clarityOf(d).level === "clear").length;
          if (!total || clear === total) return null;
          return (
            <p className="mt-2 max-w-[560px] text-meta text-muted">
              <span style={{ color: "var(--signal)" }}>Nuvo can route {clear} of {total}.</span>{" "}
              The rest file by name alone — refine a domain (enter it ↓) to teach Nuvo what belongs there.
            </p>
          );
        })()}
      </FloorHeader>

      {domains.length === 0 ? (
        <div className="serif mt-16 text-center text-head italic text-muted">
          No domains yet. Name the few areas you mean to keep for years.
        </div>
      ) : (
        <div className="flex flex-wrap justify-center gap-2.5">
          {domains.map((d, i) => (
            <Niche key={d.id} domain={d} motif={motifAt(i)} focused={d.id === focus.domainId} onEnter={() => enter(d.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Niche({ domain, motif, focused, onEnter }: { domain: Domain; motif: Motif; focused: boolean; onEnter: () => void }) {
  const st = stateOf(domain);
  const lit = st.tone === "lit";
  return (
    <button
      onClick={onEnter}
      className="fast group relative flex flex-col items-center justify-end overflow-hidden hover:-translate-y-1 hover:[box-shadow:var(--shadow-3)]"
      style={{
        flex: "1 1 150px", minWidth: 132, maxWidth: 220, height: 384, padding: "0 8px 22px",
        border: `0.5px solid ${focused ? `color-mix(in srgb, ${domain.color} 55%, var(--line))` : "var(--line)"}`,
        borderTop: `1px solid color-mix(in srgb, ${domain.color} ${lit ? 55 : 25}%, var(--line))`,
        borderRadius: "92px 92px 12px 12px",
        // Glass, not an opaque slab — a domain-tinted glow at the crown fading into
        // translucent frosted surface, so the warm-paper atmosphere reads through
        // each niche instead of being covered by a white panel.
        background:
          `linear-gradient(180deg, color-mix(in srgb, ${domain.color} ${lit ? 15 : 6}%, transparent) 0%, transparent 60%), ` +
          `color-mix(in srgb, var(--surface) 56%, transparent)`,
        backdropFilter: "blur(12px) saturate(1.3)",
        WebkitBackdropFilter: "blur(12px) saturate(1.3)",
        // Focus lifts — the current domain rises on a real shadow rather than
        // wearing a flat colored ring.
        ...(focused ? { boxShadow: "var(--shadow-lift)", transform: "translateY(-4px)" } : {}),
      }}
    >
      {lit && (
        <div
          className="pointer-events-none absolute inset-x-0"
          style={{ bottom: -30, height: 150, background: `radial-gradient(60% 90% at 50% 100%, ${domain.color}, transparent 70%)`, opacity: 0.16 }}
        />
      )}
      <Ornament
        motif={motif}
        color={domain.color}
        className="pointer-events-none absolute left-1/2 -translate-x-1/2"
        style={{ top: 28, width: 118, height: 118, opacity: lit ? 0.22 : 0.09, filter: lit ? "none" : "grayscale(1)" }}
      />
      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2" style={{ top: 148 }}>
        <Flame color={domain.color} lit={lit} size={46} />
      </div>
      <div className="serif relative text-display" style={{ fontWeight: 500, color: lit ? "var(--text)" : "color-mix(in srgb, var(--text) 65%, var(--muted))" }}>
        {domain.name}
      </div>
      <div className="relative mt-1.5 text-center text-meta uppercase" style={{ letterSpacing: "0.12em", color: lit ? "var(--muted)" : "var(--signal)" }}>
        {st.short}
      </div>
      <ClarityMark domain={domain} />
    </button>
  );
}

// ══ The chapel — a single domain, entered ════════════════════════════════════
function Chapel({ domain, motif, onBack, onOpenInitiative }: { domain: Domain; motif: Motif; onBack: () => void; onOpenInitiative: (id: string) => void }) {
  const { data, updateDomain, deleteDomain, addInitiative } = useVertical();
  const st = stateOf(domain);
  const lit = st.tone === "lit";
  const inits = initiativesOf(data, domain.id);
  const loose = looseTasksOfDomain(data, domain.id);
  const accent = domain.color;

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack]);

  return (
    <div
      className="group relative mx-auto overflow-hidden rounded-[18px] border"
      style={{
        maxWidth: 1080, minHeight: 640, borderColor: "var(--line)",
        background: `radial-gradient(120% 80% at 50% -5%, color-mix(in srgb, ${accent} 16%, var(--bg)) 0%, color-mix(in srgb, ${accent} 5%, var(--bg)) 45%, var(--bg) 100%)`,
      }}
    >
      <button onClick={onBack} className="fast absolute left-4 top-4 z-10 text-caption text-muted hover:text-ink">‹ all domains</button>
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
        <ColorDot domain={domain} />
        <DeleteBtn what="domain" onDelete={() => { deleteDomain(domain.id); onBack(); }} />
      </div>

      <Ornament
        motif={motif}
        color={accent}
        className="pointer-events-none absolute left-1/2 -translate-x-1/2"
        style={{ top: 60, width: 380, height: 380, opacity: 0.13 }}
      />

      <div className="relative mx-auto flex max-w-[540px] flex-col items-center px-6 pb-14 pt-16 text-center">
        <div className="flex h-[92px] items-end"><Flame color={accent} lit={lit} size={88} /></div>

        <div className="serif mt-1 text-[42px]" style={{ fontWeight: 500 }}>
          <InlineText value={domain.name} onChange={(v) => updateDomain(domain.id, { name: v })} inputClassName="serif text-[42px] text-center" />
        </div>

        <div className="my-3.5"><Flourish color={accent} /></div>

        <InlineTextarea
          value={domain.intention}
          onChange={(v) => updateDomain(domain.id, { intention: v })}
          placeholder="State the standing vow for this domain…"
          className="serif text-display italic"
        />

        <div
          className="mt-5 text-label uppercase"
          style={{ letterSpacing: "0.16em", color: lit ? "color-mix(in srgb, var(--text) 55%, var(--muted))" : "var(--signal)" }}
        >
          {st.line}
        </div>

        <div className="mt-8 w-full max-w-[360px]">
          <div className="serif text-body italic text-muted">the last quarter — are you still showing up?</div>
          <div className="mt-2.5"><Pulse weeks={domain.weeks} color={accent} target={domain.weeklyTargetHours} /></div>
          <div className="mono mt-2 text-meta text-muted">
            <span style={{ color: accent }}>{domain.quarterHours}h</span> tended this quarter · {fmtH(domain.investedThisWeek)} of{" "}
            <InlineNumber value={domain.weeklyTargetHours} onChange={(v) => updateDomain(domain.id, { weeklyTargetHours: v })} suffix="h" /> intended this week
          </div>
        </div>

        <div className="mt-9 w-full max-w-[420px] border-t pt-4" style={{ borderColor: "var(--line)" }}>
          <div className="flex items-center justify-between">
            <span className="text-meta uppercase text-muted" style={{ letterSpacing: "0.18em" }}>What you're building here</span>
            <button
              onClick={() => void addInitiative(domain.id).then((i) => onOpenInitiative(i.id))}
              className="fast text-meta text-muted hover:text-ink"
            >
              + initiative
            </button>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {inits.map((i) => (
              <button
                key={i.id}
                onClick={() => onOpenInitiative(i.id)}
                className="serif fast group/i flex items-center justify-center gap-2.5 text-head"
                style={{ color: "color-mix(in srgb, var(--text) 80%, transparent)" }}
              >
                <span style={{ color: accent, fontSize: 11, width: 11 }}>{mom(i.momentum)}</span>
                <span className="group-hover/i:underline">{i.name}</span>
              </button>
            ))}
            {inits.length === 0 && (
              <div className="serif text-body italic text-muted">No initiatives yet — this domain simply asks to be tended.</div>
            )}
          </div>
          {loose.length > 0 && (
            <div className="mono mt-3 text-meta text-muted">+ {loose.length} loose {loose.length === 1 ? "task" : "tasks"} parked here</div>
          )}
        </div>

        <DomainRefine domain={domain} />
      </div>
    </div>
  );
}

// The routing-context workbench — quiet at the foot of the chapel. Machine-facing,
// not ceremony: a one-line charter (the source of truth for filing) that Nuvo
// expands into entities/boundary so passive grooming can route captures here, and
// a mis-file catcher that re-homes work the charter says doesn't belong.
type Misfiled = { kind: "initiative" | "project" | "task"; id: string; name: string; suggestDomain: string; suggestDomainId: string | null };
type Refinement = { context: DomainContext; misfiled: Misfiled[] };

function DomainRefine({ domain }: { domain: Domain }) {
  const { data, updateDomain, updateInitiative, updateProject, routeTask } = useVertical();
  const [open, setOpen] = useState(false);
  const [charter, setCharter] = useState(domain.charter);
  const [busy, setBusy] = useState(false);
  const [prop, setProp] = useState<Refinement | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [moved, setMoved] = useState<Record<string, true>>({});
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const others = data.domains.filter((d) => d.id !== domain.id);
  const shown = prop?.context ?? domain.context;
  const pendingMis = (prop?.misfiled ?? []).filter((m) => !moved[m.id]);

  const refine = async () => {
    setBusy(true);
    setErr(null);
    try {
      const c = charter.trim();
      if (c !== domain.charter) updateDomain(domain.id, { charter: c });
      const { data: res, error } = await supabase.functions.invoke("agent", {
        body: { enrichDomain: { domainId: domain.id, charter: c } },
      });
      if (error) throw error;
      setProp(res as Refinement);
      setAccepted(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't refine just now");
    } finally {
      setBusy(false);
    }
  };

  const accept = () => {
    if (!prop) return;
    updateDomain(domain.id, { context: prop.context, charter: charter.trim() });
    setAccepted(true);
  };

  const rehome = (m: Misfiled) => {
    const target = targets[m.id] ?? m.suggestDomainId ?? "";
    if (!target) return;
    if (m.kind === "initiative") updateInitiative(m.id, { domainId: target });
    else if (m.kind === "project") updateProject(m.id, { domainId: target });
    else routeTask(m.id, { domainId: target });
    setMoved((s) => ({ ...s, [m.id]: true }));
  };

  const glyph = { initiative: "◆", project: "▸", task: "·" } as const;
  const chip = "rounded-sm px-1.5 py-px text-micro font-medium leading-none";

  return (
    <div className="mt-9 w-full max-w-[420px] border-t pt-4 text-left" style={{ borderColor: "var(--line)" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="fast flex w-full items-center justify-between text-meta uppercase text-muted hover:text-ink"
        style={{ letterSpacing: "0.18em" }}
      >
        <span>How Nuvo files things here</span>
        <span className="mono text-caption">{open ? "–" : "+"}</span>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <textarea
            value={charter}
            onChange={(e) => setCharter(e.target.value)}
            onBlur={() => charter.trim() !== domain.charter && updateDomain(domain.id, { charter: charter.trim() })}
            placeholder="In a line — what is this domain? Who and what belongs here? (e.g. “My day job at SCE — Obi, the Enterprise rollout, Super Leader.”)"
            rows={2}
            className="w-full resize-none rounded-md border border-line bg-surface/40 px-2.5 py-2 text-body placeholder:text-muted focus:border-line-strong focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={refine}
              disabled={busy}
              className="fast rounded-md px-3 py-1.5 text-meta font-medium text-white disabled:opacity-50"
              style={{ background: domain.color }}
            >
              {busy ? "Refining…" : shown ? "✦ Re-refine" : "✦ Refine with Nuvo"}
            </button>
            {err && <span className="text-meta text-signal">{err}</span>}
          </div>

          {shown && (
            <div className="rounded-md border border-dashed border-line bg-surface/40 px-2.5 py-2">
              {prop && !accepted && (
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-micro uppercase text-muted" style={{ letterSpacing: "0.14em" }}>Nuvo proposes</span>
                  <button onClick={accept} className="fast rounded px-1.5 py-px text-micro font-medium text-accent hover:bg-accent-soft">Accept</button>
                </div>
              )}
              {accepted && <div className="mb-1.5 text-micro text-muted">✓ saved</div>}
              {shown.scope && <div className="text-body italic text-muted">{shown.scope}</div>}
              {shown.entities.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {shown.entities.map((e) => (
                    <span key={e} className={chip} style={{ background: `color-mix(in srgb, ${domain.color} 14%, var(--surface))`, color: domain.color }}>{e}</span>
                  ))}
                </div>
              )}
              {shown.keywords.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5">
                  {shown.keywords.map((k) => <span key={k} className="text-meta text-muted">{k}</span>)}
                </div>
              )}
              {shown.boundary && <div className="mt-2 text-meta text-muted">⊘ {shown.boundary}</div>}
              {shown.entities.length === 0 && shown.keywords.length === 0 && (
                <div className="text-meta text-muted">No proper nouns of its own yet — routes by the line above.</div>
              )}
            </div>
          )}

          {pendingMis.length > 0 && (
            <div>
              <div className="mb-1.5 text-micro uppercase text-signal" style={{ letterSpacing: "0.14em" }}>
                Looks mis-filed here ({pendingMis.length})
              </div>
              <div className="flex flex-col gap-1.5">
                {pendingMis.map((m) => (
                  <div key={m.id} className="flex items-center gap-1.5 text-meta">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-muted" style={{ marginRight: 4 }}>{glyph[m.kind]}</span>{m.name}
                    </span>
                    <select
                      value={targets[m.id] ?? m.suggestDomainId ?? ""}
                      onChange={(e) => setTargets((t) => ({ ...t, [m.id]: e.target.value }))}
                      className="max-w-[110px] rounded border border-line bg-surface px-1 py-px text-meta"
                    >
                      <option value="">move to…</option>
                      {others.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    <button
                      onClick={() => rehome(m)}
                      disabled={!(targets[m.id] ?? m.suggestDomainId)}
                      className="fast rounded px-1.5 py-px text-micro font-medium text-accent hover:bg-accent-soft disabled:opacity-40"
                    >
                      Move
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ColorDot({ domain }: { domain: Domain }) {
  const { updateDomain } = useVertical();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="fast block h-3.5 w-3.5 rounded-full ring-1 ring-line"
        style={{ background: domain.color }}
        title="Change the domain's light"
      />
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="rise elev-2 absolute right-0 top-full z-50 mt-1 rounded-md border border-line bg-surface p-2" style={{ width: 140 }}>
            <div className="flex flex-wrap gap-1.5">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  onClick={() => { updateDomain(domain.id, { color: c }); setOpen(false); }}
                  className="fast h-5 w-5 rounded-full ring-1 ring-line"
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </span>
  );
}
