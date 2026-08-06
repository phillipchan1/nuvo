// Domain — the anchor of faithfulness, reimagined as a place you ENTER, not a
// dashboard you scan. The wall is a set of glass cards, each carrying a LIVING
// SIGIL (src/components/floors/DomainSigil.tsx) generated from the domain's own
// 13-week pulse — warm when tended, a cold ember when you've gone quiet — plus a
// balance strip that answers "am I starving a domain to feed another?". Click a
// card to open that domain: the standing vow as a Fraunces inscription, the
// faithfulness pulse, the Gain you've banked, what you've built, the portfolio
// pointed at outcomes, and Nuvo's derived read. Domains don't ask for action —
// they ask to be kept.

import { useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays, startOfWeek } from "date-fns";
import { parseDateISO, todayISO } from "../../lib/dates";
import { useVertical } from "../../hooks/useVertical";
import { supabase } from "../../lib/supabase";
import { FloorGuide } from "../orientation/FloorGuide";
import { WelcomeVisual } from "../orientation/Visuals";
import {
  faithfulness,
  initiativesOf,
  looseProjectsOf,
  looseTasksOfDomain,
  domainStreak,
  domainKeptCount,
  domainLongestQuiet,
  domainQuarterDone,
  initiativeProgress,
  initiativeExecution,
  initiativeAttainment,
  initiativeAtRisk,
  initiativeEffortGap,
  isOpenStatus,
  type Domain,
  type DomainContext,
  type VerticalData,
} from "../../lib/vertical";
import { readShipped } from "../../lib/shipped";
import {
  domainForm,
  domainSigilSpec,
  setDomainForm,
  SIGIL_FORMS,
  SIGIL_FORM_LABEL,
  SIGIL_FORM_BLURB,
  type SigilForm,
} from "../../lib/domainSigil";
import DomainSigil from "./DomainSigil";
import type { Focus } from "../AppShell";
import {
  FloorHeader,
  InlineNumber,
  InlineText,
  InlineTextarea,
  DeleteBtn,
  Bar,
  PROJECT_STATUS_COLORS,
  PROJECT_STATUS_LABEL,
  RefinedSeal,
  RefinedTick,
  useRefinedCelebration,
} from "./parts";
import { AltitudeIcon } from "../icons";
import { readSpine } from "../../lib/readiness";

const SWATCHES = ["#DB2777", "#7C3AED", "#2563EB", "#0D9488", "#059669", "#D97706", "#4F46E5", "#DC2626", "#0891B2", "#65A30D"];

// ── The faithfulness pulse — 13 weeks of showing-up, an EKG, not a bar. The
// dashed line marks your weekly intent, so a glance reads over/under. ──────────
function Pulse({ weeks, color, target }: { weeks: number[]; color: string; target: number }) {
  const W = 320, H = 54, n = weeks.length, gap = 5;
  const bw = (W - (n - 1) * gap) / n;
  const norm = target > 0 ? target : Math.max(...weeks, 1);
  const ty = 48 - (5 + 42); // the bar height at exactly one target's worth
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet" aria-hidden style={{ maxWidth: W }}>
      {target > 0 && <line x1={0} y1={ty} x2={W} y2={ty} stroke={color} strokeWidth={1} strokeDasharray="3 4" opacity={0.35} />}
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
function shipWhen(iso: string | null) {
  if (!iso) return "";
  return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function stateOf(d: Domain): { tone: "lit" | "quiet"; line: string; short: string } {
  const f = faithfulness(d);
  if (f.lit) {
    if (d.weeklyTargetHours > 0 && d.investedThisWeek > d.weeklyTargetHours)
      return { tone: "lit", line: `Groomed ${ago(d.lastTouchedDays)} — over your ${fmtH(d.weeklyTargetHours)} this week`, short: `over ${fmtH(d.investedThisWeek)}` };
    return { tone: "lit", line: `Groomed ${ago(d.lastTouchedDays)} — ${fmtH(d.investedThisWeek)} kept this week`, short: "groomed" };
  }
  if (d.lastTouchedDays >= 99) return { tone: "quiet", line: "Ungroomed — no time has been kept here yet", short: "ungroomed" };
  return { tone: "quiet", line: `Quiet for ${d.lastTouchedDays} days — when did you last show up here?`, short: `quiet · ${d.lastTouchedDays}d` };
}

const mom = (m: string) => (m === "up" ? "↑" : m === "down" ? "↓" : "→");

// ── Clarity, voiced ───────────────────────────────────────────────────────────
// A second axis from faithfulness: how well Nuvo can ROUTE captures here. Read
// purely from persisted state (no AI call).
type Clarity = { level: "clear" | "partial" | "unrefined"; label: string; why: string; pct: number };

function clarityOf(d: Domain): Clarity {
  const ctx = d.context;
  if (ctx) {
    const signals = ctx.entities.length + ctx.keywords.length;
    if (signals === 0)
      return { level: "partial", label: "needs detail", why: "Groomed, but Nuvo couldn't pull anything specific to route on — re-groom with a richer line.", pct: 0.6 };
    const lead = ctx.entities.slice(0, 3).join(", ") || ctx.keywords.slice(0, 3).join(", ");
    return { level: "clear", label: "groomed", why: `Nuvo files captures here by ${lead}.`, pct: 1 };
  }
  if (d.charter.trim())
    return { level: "partial", label: "groom to finish", why: "You've described it — one tap on Groom teaches Nuvo what belongs here.", pct: 0.35 };
  return { level: "unrefined", label: "needs grooming", why: "Nuvo files here by name alone. Describe what belongs so captures land here.", pct: 0 };
}

function ClarityMark({ domain }: { domain: Domain }) {
  const c = clarityOf(domain);
  if (c.level === "clear") {
    return (
      <div className="flex items-center gap-1.5 text-micro text-muted" title={c.why}>
        <RefinedTick /> <span style={{ letterSpacing: "0.04em" }}>routes clean</span>
      </div>
    );
  }
  return (
    <div className="flex w-full max-w-[132px] items-center gap-2" title={c.why}>
      <div className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
        <div style={{ width: `${Math.round(c.pct * 100)}%`, height: "100%", background: "var(--signal)", transition: "width .3s" }} />
      </div>
      <span className="whitespace-nowrap text-micro" style={{ color: "var(--signal)", letterSpacing: "0.04em" }}>✦ {c.label}</span>
    </div>
  );
}

// ── Nuvo's read — derived, no AI call. Turns the existing risk/effort/rhythm
// selectors into a few honest sentences with a suggested next move. ────────────
type Read = { tone: "warn" | "good" | "info"; text: string };

function domainRead(data: VerticalData, domain: Domain, now: Date): Read[] {
  const out: Read[] = [];
  const st = stateOf(domain);
  const streak = domainStreak(domain.weeks);
  const inits = initiativesOf(data, domain.id).filter((i) => isOpenStatus(i.status));

  // rhythm — the domain going quiet is the first thing worth saying
  if (domain.lastTouchedDays >= 99) {
    out.push({ tone: "info", text: "Nothing's been kept here yet — put the first hour on the calendar and the sigil lights." });
  } else if (st.tone === "quiet") {
    out.push({ tone: "warn", text: `Quiet for ${domain.lastTouchedDays} days — the sigil's cooling. Worth putting an hour back on the calendar this week?` });
  }

  // drifting bets — at-risk initiatives, named with their reasons
  const risky = inits
    .map((i) => ({ i, r: initiativeAtRisk(data, i, now) }))
    .filter((x) => x.r.atRisk)
    .slice(0, 2);
  for (const { i, r } of risky) {
    out.push({ tone: "warn", text: `${i.name} is drifting — ${r.reasons.join(", ")}. Re-groom it, or pull it into this week's plan?` });
  }

  // busywork — real effort that isn't moving the needle (skip if already flagged)
  const flagged = new Set(risky.map((x) => x.i.id));
  for (const i of inits) {
    if (flagged.has(i.id)) continue;
    const gap = initiativeEffortGap(data, i);
    if (gap.busywork) {
      out.push({ tone: "warn", text: `${i.name}: ${fmtH(gap.investedHours)} of finished work, but the outcome's barely moved — the effort isn't landing on the needle.` });
      break;
    }
  }

  // meeting creep — where deep work is getting crowded out
  if (domain.investedThisWeek > 0 && domain.meetingHoursThisWeek / domain.investedThisWeek > 0.5) {
    const pct = Math.round((domain.meetingHoursThisWeek / domain.investedThisWeek) * 100);
    out.push({ tone: "info", text: `Meetings are ${pct}% of your time here this week — worth protecting the deep-work half.` });
  }

  // the affirmation — you're keeping faith
  if (st.tone === "lit" && streak >= 5) {
    const over = domain.weeklyTargetHours > 0 && domain.investedThisWeek > domain.weeklyTargetHours;
    out.push({ tone: "good", text: `You're keeping faith — a ${streak}-week streak${over ? ", over your intent" : ""}. This one's tended.` });
  }

  if (out.length === 0) out.push({ tone: "good", text: "All calm here — nothing's asking for your attention." });
  return out.slice(0, 4);
}

// ══ The wall — glass cards + a balance strip ═════════════════════════════════
export default function DomainFloor({
  focus,
  onSwitchDomain,
  onExitDomain,
  onOpenInitiative,
  onOpenProject,
}: {
  focus: Focus;
  onSwitchDomain: (id: string) => void;
  onExitDomain: () => void;
  onOpenInitiative: (id: string) => void;
  onOpenProject: (id: string) => void;
}) {
  const { data, addDomain } = useVertical();
  const domains = [...data.domains].sort((a, b) => a.sort - b.sort);
  const [freshDomain, setFreshDomain] = useState<Domain | null>(null);
  const atRest = readSpine(data).floors.domain.calm;
  const celebrate = useRefinedCelebration("domain", atRest);

  const enter = (id: string) => onSwitchDomain(id);
  const openId = focus.domainId || null;
  const openIdx = openId ? domains.findIndex((d) => d.id === openId) : -1;
  const open = openIdx >= 0 ? domains[openIdx] : (openId && freshDomain?.id === openId ? freshDomain : null);

  const totalWeek = domains.reduce((s, d) => s + d.investedThisWeek, 0);

  if (open) {
    return (
      <div className="floor-enter">
        <DomainDetail key={open.id} domain={open} onBack={() => { setFreshDomain(null); onExitDomain(); }} onOpenInitiative={onOpenInitiative} onOpenProject={onOpenProject} />
      </div>
    );
  }

  // First visit: no domains yet → teach the top of the funnel, then hand over the
  // first-create. Self-cleans once a domain exists.
  if (domains.length === 0) {
    return (
      <FloorGuide
        eyebrow="Domains · ⌘4"
        title="Name the areas of your life."
        teach="Domains are your standing commitments — Family, Work, Faith, Health. Everything you plan hangs off one of them."
        Visual={WelcomeVisual}
        actionLabel="Add your first domain"
        onAction={() => void addDomain().then((d) => { setFreshDomain(d); enter(d.id); })}
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1180px]">
      <FloorHeader
        eyebrow="The anchor · areas that persist for years"
        actions={
          <>
            {atRest && <RefinedSeal noun="domains" celebrate={celebrate} />}
            <button
              onClick={() => void addDomain().then((d) => { setFreshDomain(d); enter(d.id); })}
              className="fast rounded-md border border-line px-2.5 py-1 text-label text-muted hover:border-muted hover:text-ink"
            >
              + domain
            </button>
          </>
        }
      >
        <h1 className="serif text-[26px]" style={{ fontWeight: 500 }}>The fixtures of your life</h1>
        <p className="mt-1 max-w-[560px] text-body text-muted">
          Measured by faithfulness over a long arc — not throughput. Are you still showing up?
        </p>
      </FloorHeader>

      {totalWeek > 0 && <WeekShape domains={domains} total={totalWeek} />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-teach="domain-wall">
        {/* The walkthrough lights the FIRST card, not the wall — a named thing they
            typed themselves reads as "this is yours"; a lit grid reads as nothing. */}
        {domains.map((d, i) => (
          <Niche
            key={d.id}
            domain={d}
            focused={d.id === focus.domainId}
            onEnter={() => enter(d.id)}
            teach={i === 0 ? "domain-card" : undefined}
          />
        ))}
      </div>
    </div>
  );
}

// This week's SHAPE — seven days, each a stack of the domains that got the hours.
//
// The old read was a 100%-stacked share bar, which hides the two things you
// actually ask of it: how much, and *when*. A share can't tell a 40-hour week
// from a 4-hour one, and it flattens "Tuesday was entirely SCE and Family got
// nothing after Monday" into a percentage. Columns are on an absolute scale
// (floor of an 8h day) so a light week reads light; today carries `--signal`,
// days still ahead sit as open `--slot` track.
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_FLOOR_HOURS = 8; // the reference day — keeps a 2h Tuesday from filling the frame

function WeekShape({ domains, total }: { domains: Domain[]; total: number }) {
  // Same week boundary the ledger buckets into (Monday, app timezone), so the
  // columns and the cards can never disagree about which days are "this week".
  const weekStart = useMemo(() => startOfWeek(parseDateISO(todayISO(new Date())), { weekStartsOn: 1 }), []);
  const todayIdx = differenceInCalendarDays(parseDateISO(todayISO(new Date())), weekStart);

  // One stable domain order for every column — a segment that jumps position
  // between days is unreadable.
  const active = useMemo(
    () => domains.filter((d) => d.investedThisWeek > 0).sort((a, b) => b.investedThisWeek - a.investedThisWeek),
    [domains],
  );
  const dayTotals = useMemo(
    () => DAY_LABELS.map((_, i) => active.reduce((s, d) => s + (d.days[i] ?? 0), 0)),
    [active],
  );
  const scale = Math.max(DAY_FLOOR_HOURS, ...dayTotals);

  return (
    <div
      className="mb-5 rounded-xl border border-line px-4 py-3.5"
      style={{ background: "color-mix(in srgb, var(--surface) 60%, transparent)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="section-label whitespace-nowrap">This week's shape</span>
        <span className="text-meta text-muted">
          <span className="mono">{fmtH(total)}</span> across {active.length} {active.length === 1 ? "domain" : "domains"}
        </span>
      </div>

      <div className="mt-3 flex items-end gap-1.5">
        {DAY_LABELS.map((label, i) => {
          const dayTotal = dayTotals[i];
          const ahead = i > todayIdx;
          const isToday = i === todayIdx;
          return (
            <div key={label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div
                className="flex w-full flex-col-reverse overflow-hidden rounded-[4px]"
                style={{
                  height: 64,
                  // days still ahead are open, not empty — the faintest --slot wash
                  background: ahead ? "color-mix(in srgb, var(--slot) 14%, transparent)" : "var(--line)",
                }}
              >
                {active.map((d) => {
                  const h = d.days[i] ?? 0;
                  if (h <= 0) return null;
                  return (
                    <span
                      key={d.id}
                      title={`${label} · ${d.name} · ${fmtH(h)}`}
                      style={{ height: `${Math.min(100, (h / scale) * 100)}%`, background: d.color }}
                    />
                  );
                })}
              </div>
              <span
                className="text-micro uppercase"
                style={{ letterSpacing: "0.07em", color: isToday ? "var(--signal)" : "var(--muted)" }}
              >
                {label}
              </span>
              <span className="mono text-micro" style={{ color: dayTotal > 0 ? "var(--muted)" : "color-mix(in srgb, var(--muted) 45%, transparent)" }}>
                {dayTotal > 0 ? fmtH(dayTotal) : "—"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1 border-t border-line pt-2.5">
        {active.map((d) => (
          <span key={d.id} className="flex items-center gap-1.5 text-meta text-muted">
            <i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: d.color }} />
            {d.name} <span className="mono">{fmtH(d.investedThisWeek)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Niche({ domain, focused, onEnter, teach }: { domain: Domain; focused: boolean; onEnter: () => void; teach?: string }) {
  const st = stateOf(domain);
  const lit = st.tone === "lit";
  const spec = domainSigilSpec(domain, domainForm(domain.id));
  return (
    <button
      onClick={onEnter}
      data-teach={teach}
      className="fast group flex flex-col rounded-xl p-5 text-left hover:-translate-y-1 hover:[box-shadow:var(--shadow-lift)]"
      style={{
        border: "1px solid var(--line)",
        borderTop: `1.5px solid color-mix(in srgb, ${domain.color} ${lit ? 55 : 28}%, var(--line))`,
        background: "color-mix(in srgb, var(--surface) 60%, transparent)",
        backdropFilter: "blur(12px) saturate(1.3)",
        WebkitBackdropFilter: "blur(12px) saturate(1.3)",
        ...(focused ? { boxShadow: "var(--shadow-lift)", transform: "translateY(-4px)" } : {}),
      }}
    >
      <div className="flex items-start gap-3.5">
        <DomainSigil spec={spec} size={64} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="serif text-lead" style={{ fontWeight: 500, color: lit ? "var(--text)" : "color-mix(in srgb, var(--text) 68%, var(--muted))" }}>
            {domain.name}
          </div>
          <div className="mt-0.5 text-meta uppercase" style={{ letterSpacing: "0.1em", color: lit ? "var(--muted)" : "var(--signal)" }}>
            {st.short}
          </div>
        </div>
      </div>

      {domain.intention.trim() && (
        <div className="serif mt-3 line-clamp-2 text-body italic text-muted">{domain.intention}</div>
      )}

      <div className="mt-4 flex items-end gap-4 border-t border-line pt-3">
        <Stat n={`${fmtH(domain.investedThisWeek)}`} sub={domain.weeklyTargetHours > 0 ? `/ ${fmtH(domain.weeklyTargetHours)}` : ""} label="this week" />
        <Stat n={`${domain.quarterHours}h`} label="quarter" />
        <div className="ml-auto">
          <ClarityMark domain={domain} />
        </div>
      </div>
    </button>
  );
}

function Stat({ n, sub, label }: { n: string; sub?: string; label: string }) {
  return (
    <div>
      <div className="mono text-body" style={{ fontWeight: 600 }}>
        {n}{sub && <span className="text-muted" style={{ fontWeight: 500 }}> {sub}</span>}
      </div>
      <div className="text-micro uppercase text-muted" style={{ letterSpacing: "0.07em" }}>{label}</div>
    </div>
  );
}

// ══ The open domain — a single domain, entered ════════════════════════════════════
function DomainDetail({ domain, onBack, onOpenInitiative, onOpenProject }: { domain: Domain; onBack: () => void; onOpenInitiative: (id: string) => void; onOpenProject: (id: string) => void }) {
  const { data, updateDomain, deleteDomain, addInitiative, addProject } = useVertical();
  const now = useMemo(() => new Date(), []);
  const st = stateOf(domain);
  const lit = st.tone === "lit";
  const inits = initiativesOf(data, domain.id);
  const openInits = inits.filter((i) => isOpenStatus(i.status));
  const looseProjects = looseProjectsOf(data, domain.id);
  const loose = looseTasksOfDomain(data, domain.id);
  const accent = domain.color;

  const [form, setForm] = useState<SigilForm>(() => domainForm(domain.id));
  const pickForm = (f: SigilForm) => { setDomainForm(domain.id, f); setForm(f); };
  const spec = domainSigilSpec(domain, form);

  // rhythm reads
  const streak = domainStreak(domain.weeks);
  const kept = domainKeptCount(domain.weeks);
  const longestQuiet = domainLongestQuiet(domain.weeks);
  const doneCount = domainQuarterDone(data, domain.id, now);

  // what you've built — shipped milestones parked in this domain, newest first
  const shipped = [
    ...readShipped(data, "initiative", now).groups.flatMap((g) => g.items),
    ...readShipped(data, "project", now).groups.flatMap((g) => g.items),
  ]
    .filter((it) => it.domain?.id === domain.id)
    .sort((a, b) => (b.targetDate ?? "").localeCompare(a.targetDate ?? ""))
    .slice(0, 5);

  // the Gain — this week's deep-work vs meeting split
  const meet = Math.max(0, Math.min(domain.investedThisWeek, domain.meetingHoursThisWeek));
  const deep = Math.max(0, domain.investedThisWeek - meet);

  const reads = domainRead(data, domain, now);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onBack(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const panelHead = (title: string, hint?: string, actions?: React.ReactNode) => (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <div className="section-label">{title}</div>
        {hint && <div className="serif mt-0.5 text-body italic text-muted">{hint}</div>}
      </div>
      {actions}
    </div>
  );

  return (
    <div
      className="group relative mx-auto overflow-hidden rounded-[18px] border"
      style={{
        maxWidth: 1080, minHeight: 640, borderColor: "var(--line)",
        background: `radial-gradient(120% 80% at 50% -5%, color-mix(in srgb, ${accent} 16%, var(--bg)) 0%, color-mix(in srgb, ${accent} 5%, var(--bg)) 45%, var(--bg) 100%)`,
      }}
    >
      <button onClick={onBack} className="fast absolute left-4 top-4 z-10 text-caption text-muted hover:text-ink">‹ all domains</button>
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <FormPicker domain={domain} form={form} onPick={pickForm} />
        <ColorDot domain={domain} />
        <span className="opacity-0 transition-opacity group-hover:opacity-100">
          <DeleteBtn what="domain" onDelete={() => { deleteDomain(domain.id); onBack(); }} />
        </span>
      </div>

      {/* faint watermark of the sigil behind the vow */}
      <DomainSigil spec={spec} size={360} className="pointer-events-none absolute left-1/2 -translate-x-1/2" style={{ top: 44, opacity: 0.06 }} />

      {/* ── the hero: mark · name · vow · faithfulness voice ── */}
      <div className="relative mx-auto flex max-w-[560px] flex-col items-center px-6 pb-8 pt-14 text-center">
        <DomainSigil spec={spec} size={120} />
        <div className="serif mt-3 text-[42px]" style={{ fontWeight: 500 }}>
          <InlineText value={domain.name} onChange={(v) => updateDomain(domain.id, { name: v })} inputClassName="serif text-[42px] text-center" />
        </div>
        <div className="my-3.5"><Flourish color={accent} /></div>
        <InlineTextarea
          value={domain.intention}
          onChange={(v) => updateDomain(domain.id, { intention: v })}
          placeholder="State the standing vow for this domain…"
          className="serif text-display italic"
        />
        <div className="mt-5 text-label uppercase" style={{ letterSpacing: "0.16em", color: lit ? "color-mix(in srgb, var(--text) 55%, var(--muted))" : "var(--signal)" }}>
          {st.line}
        </div>
      </div>

      {/* ── the last quarter — the pulse ── */}
      <div className="relative border-t px-7 py-6" style={{ borderColor: "var(--line)" }}>
        {panelHead("The last quarter", "are you still showing up?")}
        <Pulse weeks={domain.weeks} color={accent} target={domain.weeklyTargetHours} />
        <div className="mono mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-meta text-muted">
          <span><span style={{ color: accent }}>Kept faith {kept} of the last 13 weeks.</span>{longestQuiet > 1 ? ` Longest quiet stretch: ${longestQuiet} weeks.` : ""}</span>
          <span className="text-micro uppercase" style={{ letterSpacing: "0.08em" }}>dashed line · your {fmtH(domain.weeklyTargetHours)}/wk intent</span>
        </div>
      </div>

      {/* ── the Gain · what you've built (two-up) ── */}
      <div className="relative grid border-t md:grid-cols-2" style={{ borderColor: "var(--line)" }}>
        <div className="px-7 py-6">
          {panelHead("The Gain", "what this domain has cost you")}
          <div className="flex flex-wrap gap-x-7 gap-y-3">
            <GainNum n={`${domain.quarterHours}`} unit="h" label="this quarter" />
            <div>
              <div className="text-[22px]" style={{ fontWeight: 600, letterSpacing: "-.02em" }}>
                <span className="mono">{fmtH(domain.investedThisWeek)}</span>
                <span className="text-muted" style={{ fontSize: 13, fontWeight: 500 }}> / <InlineNumber value={domain.weeklyTargetHours} onChange={(v) => updateDomain(domain.id, { weeklyTargetHours: v })} suffix="h" /></span>
              </div>
              <div className="text-micro uppercase text-muted" style={{ letterSpacing: "0.08em" }}>this week</div>
            </div>
            <GainNum n={`${streak}`} unit="wk" label="current streak" />
            <GainNum n={`${doneCount}`} unit="" label="blocks done" />
          </div>
          {domain.investedThisWeek > 0 && (
            <>
              <div className="mt-4 flex h-2 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
                {deep > 0 && <span style={{ width: `${(deep / domain.investedThisWeek) * 100}%`, background: accent }} />}
                {meet > 0 && <span style={{ width: `${(meet / domain.investedThisWeek) * 100}%`, background: `color-mix(in srgb, ${accent} 38%, var(--surface))` }} />}
              </div>
              <div className="mt-2 flex gap-4 text-meta text-muted">
                <span><i className="mr-1.5 inline-block h-2 w-2 rounded-[2px] align-middle" style={{ background: accent }} />Deep work · {fmtH(deep)}</span>
                {meet > 0 && <span><i className="mr-1.5 inline-block h-2 w-2 rounded-[2px] align-middle" style={{ background: `color-mix(in srgb, ${accent} 38%, var(--surface))` }} />Meetings · {fmtH(meet)}</span>}
              </div>
            </>
          )}
        </div>

        <div className="border-t px-7 py-6 md:border-l md:border-t-0" style={{ borderColor: "var(--line)" }}>
          {panelHead("What you've built", "milestones crossed here")}
          {shipped.length > 0 ? (
            <div className="flex flex-col">
              {shipped.map((it) => (
                <div key={it.id} className="flex items-baseline gap-2.5 border-t py-2 text-body first:border-t-0" style={{ borderColor: "var(--line)" }}>
                  <span style={{ color: "var(--slot)" }}>✓</span>
                  <span className="min-w-0 flex-1 truncate">{it.name}</span>
                  {it.targetDate && <span className="mono ml-auto text-meta text-muted">{shipWhen(it.targetDate)}</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="serif text-body italic text-muted">
              {doneCount > 0
                ? `${doneCount} block${doneCount === 1 ? "" : "s"} kept this quarter — no finished milestones yet, but the hours are landing.`
                : "Nothing finished here yet. What's the first thing you'll ship?"}
            </div>
          )}
        </div>
      </div>

      {/* ── the portfolio — outcome vs effort ── */}
      <div className="relative border-t px-7 py-6" style={{ borderColor: "var(--line)" }}>
        {panelHead("What you're building toward", "is the work moving the needle?", (
          <div className="flex items-center gap-2.5">
            <button onClick={() => void addProject(domain.id, null).then((p) => onOpenProject(p.id))} className="fast text-meta text-muted hover:text-ink">+ project</button>
            <button onClick={() => void addInitiative(domain.id).then((i) => onOpenInitiative(i.id))} className="fast text-meta text-muted hover:text-ink">+ initiative</button>
          </div>
        ))}

        {openInits.length === 0 && looseProjects.length === 0 ? (
          <div className="serif text-body italic text-muted">No initiatives yet — this domain simply asks to be groomed.</div>
        ) : (
          <div className="flex flex-col">
            {openInits.map((i) => {
              const attain = initiativeAttainment(data, i);
              const outcome = attain ?? initiativeProgress(data, i);
              const exec = initiativeExecution(data, i);
              const risk = initiativeAtRisk(data, i, now);
              return (
                <div key={i.id} className="flex items-center gap-3 border-t py-3 first:border-t-0" style={{ borderColor: "var(--line)" }}>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: accent }} />
                  <span className="text-micro shrink-0" style={{ color: accent, width: 10 }}>{mom(i.momentum)}</span>
                  <button onClick={() => onOpenInitiative(i.id)} className="serif fast min-w-0 flex-1 truncate text-left text-head hover:underline">{i.name}</button>
                  {risk.atRisk && (
                    <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-micro font-medium" style={{ background: "var(--signal-soft)", color: "var(--signal)" }}>{risk.reasons[0]}</span>
                  )}
                  <div className="w-[148px] shrink-0">
                    <div className="flex justify-between text-micro uppercase text-muted"><span>outcome</span><span className="mono">{attain != null ? `${outcome}%` : "—"}</span></div>
                    <Bar pct={outcome} color={accent} h={1} />
                    <div className="flex justify-between text-micro uppercase text-muted"><span>build</span><span className="mono">{exec}%</span></div>
                    <Bar pct={exec} color={`color-mix(in srgb, ${accent} 45%, var(--surface))`} h={1} />
                  </div>
                </div>
              );
            })}

            {looseProjects.map((p) => (
              <button key={p.id} onClick={() => onOpenProject(p.id)} className="fast group/p flex items-center gap-2 border-t py-2.5 text-body first:border-t-0" style={{ borderColor: "var(--line)" }}>
                <span style={{ color: PROJECT_STATUS_COLORS[p.status], fontSize: 7, lineHeight: 1 }}>●</span>
                <span className="min-w-0 flex-1 truncate text-left group-hover/p:underline">{p.name}</span>
                <span className="text-meta" style={{ color: PROJECT_STATUS_COLORS[p.status] }}>{PROJECT_STATUS_LABEL[p.status]}</span>
              </button>
            ))}
          </div>
        )}
        {loose.length > 0 && (
          <div className="mono mt-3 text-meta text-muted">+ {loose.length} loose {loose.length === 1 ? "task" : "tasks"} parked here</div>
        )}
      </div>

      {/* ── Nuvo's read — derived interpretation ── */}
      <div className="relative border-t px-7 py-6" style={{ borderColor: "var(--line)" }}>
        {panelHead("Nuvo's read")}
        <div className="flex flex-col gap-2.5">
          {reads.map((r, i) => {
            const c = r.tone === "warn" ? "var(--signal)" : r.tone === "good" ? accent : "var(--muted)";
            const bg = r.tone === "warn" ? "var(--signal-soft)" : r.tone === "good" ? "var(--accent-soft)" : "color-mix(in srgb, var(--surface) 55%, transparent)";
            return (
              <div key={i} className="flex items-start gap-2.5 rounded-xl px-3.5 py-2.5" style={{ background: bg, border: `1px solid color-mix(in srgb, ${c} 20%, var(--line))` }}>
                <span style={{ color: c, fontSize: 13, lineHeight: 1.4 }}>{r.tone === "warn" ? "◈" : r.tone === "good" ? "✦" : "·"}</span>
                <p className="text-caption" style={{ margin: 0, lineHeight: 1.5 }}>{r.text}</p>
              </div>
            );
          })}
        </div>

        <DomainRefine domain={domain} />
      </div>
    </div>
  );
}

function GainNum({ n, unit, label }: { n: string; unit: string; label: string }) {
  return (
    <div>
      <div className="mono text-[22px]" style={{ fontWeight: 600, letterSpacing: "-.02em" }}>
        {n}{unit && <span className="text-muted" style={{ fontSize: 13, fontWeight: 500 }}>{unit}</span>}
      </div>
      <div className="text-micro uppercase text-muted" style={{ letterSpacing: "0.08em" }}>{label}</div>
    </div>
  );
}

// The sigil form chooser — the one configurable knob. A small popover with a live
// preview of each form drawn from THIS domain's real data.
function FormPicker({ domain, form, onPick }: { domain: Domain; form: SigilForm; onPick: (f: SigilForm) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="fast rounded-md border border-line px-2 py-1 text-micro text-muted hover:border-muted hover:text-ink"
        title="Choose the sigil's form"
      >
        ✦ {SIGIL_FORM_LABEL[form]}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="rise elev-2 absolute right-0 top-full z-50 mt-1 w-[220px] rounded-lg border border-line bg-surface p-2" style={{ boxShadow: "var(--shadow-3)" }}>
            <div className="grid grid-cols-2 gap-1.5">
              {SIGIL_FORMS.map((f) => (
                <button
                  key={f}
                  onClick={() => { onPick(f); setOpen(false); }}
                  className="fast flex flex-col items-center gap-1 rounded-md p-2 text-center hover:bg-surface-2"
                  style={f === form ? { background: "var(--accent-soft)", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent)" } : undefined}
                  title={SIGIL_FORM_BLURB[f]}
                >
                  <DomainSigil spec={domainSigilSpec(domain, f)} size={48} />
                  <span className="text-micro" style={{ color: f === form ? "var(--accent)" : "var(--muted)", fontWeight: f === form ? 600 : 400 }}>{SIGIL_FORM_LABEL[f]}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </span>
  );
}

// The routing-context workbench — quiet at the foot of the open domain. Machine-facing,
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
      setErr(e instanceof Error ? e.message : "Couldn't groom just now");
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

  const chip = "rounded-sm px-1.5 py-px text-micro font-medium leading-none";

  return (
    <div className="mt-8 w-full border-t pt-4 text-left" style={{ borderColor: "var(--line)" }}>
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
              className={`tap fast rounded-lg px-4 py-2.5 text-body font-medium text-white active:scale-[.98] disabled:cursor-wait disabled:opacity-75 ${busy ? "animate-pulse" : "hover:opacity-90"}`}
              style={{ background: domain.color }}
            >
              {busy ? "Grooming…" : shown ? "✦ Re-groom" : "✦ Groom with Nuvo"}
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
                      <span className="mr-1 inline-flex align-[-2px] text-muted">
                        <AltitudeIcon kind={m.kind} size={13} />
                      </span>
                      {m.name}
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
