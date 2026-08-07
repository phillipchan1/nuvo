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
import { useVertical } from "../../hooks/useVertical";
import { FloorGuide } from "../orientation/FloorGuide";
import { WelcomeVisual } from "../orientation/Visuals";
import {
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
  isOpenStatus,
  type Domain,
} from "../../lib/vertical";
// The domain's derived voice lives in one place so the phone reads it the same
// way (src/lib/domainRead.ts); the marks it wears do too (components/domain).
import {
  domainRead,
  domainShipped,
  fmtH,
  mom,
  shipWhen,
  stateOf,
  weekSplit,
} from "../../lib/domainRead";
import {
  ClarityMark,
  DomainGroom,
  FaithPulse,
  Flourish,
  SigilFormGrid,
  SwatchGrid,
  WeekShape,
} from "../domain/DomainParts";
import {
  domainForm,
  domainSigilSpec,
  setDomainForm,
  SIGIL_FORM_LABEL,
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
  useRefinedCelebration,
} from "./parts";
import { readSpine } from "../../lib/readiness";

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

      {totalWeek > 0 && (
        <div className="mb-5">
          <WeekShape domains={domains} />
        </div>
      )}
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
  const shipped = domainShipped(data, domain.id, now);

  // the Gain — this week's deep-work vs meeting split
  const { deep, meet } = weekSplit(domain);

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
        <div style={{ maxWidth: 320 }}>
          <FaithPulse weeks={domain.weeks} color={accent} target={domain.weeklyTargetHours} />
        </div>
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

        <DomainGroom domain={domain} />
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
// preview of each form drawn from THIS domain's real data (the tiles themselves
// are shared with the phone's chooser).
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
            <SigilFormGrid domain={domain} form={form} onPick={(f) => { onPick(f); setOpen(false); }} />
          </div>
        </>
      )}
    </span>
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
            <SwatchGrid value={domain.color} onPick={(c) => { updateDomain(domain.id, { color: c }); setOpen(false); }} />
          </div>
        </>
      )}
    </span>
  );
}
