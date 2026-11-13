// Domains — the anchor of presence. Two layouts over one voice (D-086, D-190):
//
//  · The WALL (Board): one hero — the hours kept this week — the week's shape
//    under it, then a kit Card per domain: its mark (symbol and color inside a
//    halo generated from its 13-week pulse: warm when tended, a cold ember when
//    you've gone quiet), its name, its state, its mandate, this week's and the
//    quarter's hours, and whether Nuvo can route captures there.
//  · The OPEN DOMAIN (Document): the mark and name as the title, the standing
//    mandate as its lead, then sections under kit SectionHeaders on hairline
//    rows — the last quarter's pulse, the Gain, what shipped, what's in flight,
//    Nuvo's derived read, how Nuvo files things here — and a property panel
//    (the mark, the weekly intent, the routing, delete).
//
// Domains don't ask for action — they ask to be kept. The voice lives in
// lib/domainRead.ts and the marks in components/domain, shared with the phone.

import { useEffect, useMemo, useRef, useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { FloorGuide } from "../orientation/FloorGuide";
import { WelcomeVisual } from "../orientation/Visuals";
import {
  initiativesOf,
  openLooseProjectsOf,
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
  PresencePulse,
  DomainSymbolPicker,
  SwatchGrid,
  WeekShape,
} from "../domain/DomainParts";
import DomainSymbol from "../domain/DomainSymbol";
import DomainMark from "../domain/DomainMark";
import { domainMarkSpec } from "../../lib/domainMark";
import type { Focus } from "../AppShell";
import {
  FloorHeader,
  InlineNumber,
  InlineText,
  InlineTextarea,
  DeleteBtn,
  PROJECT_STATUS_COLORS,
  PROJECT_STATUS_LABEL,
  RefinedSeal,
  useRefinedCelebration,
} from "./parts";
import { readSpine } from "../../lib/readiness";
import { pressable } from "../../lib/a11y";
import { Icon } from "../Icon";
import { Button, Card, Chip, Dot, IconButton, Popover, Row, SectionHeader } from "../kit";

// ══ The wall ═════════════════════════════════════════════════════════════════
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
  const create = () => void addDomain().then((d) => { setFreshDomain(d); enter(d.id); });

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
        teach="Domains are your standing commitments — Family, Work, Health, Finances. Everything you plan hangs off one of them."
        Visual={WelcomeVisual}
        actionLabel="Add your first domain"
        onAction={create}
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1180px]">
      <FloorHeader
        actions={
          <>
            {atRest && <RefinedSeal noun="domains" celebrate={celebrate} />}
            <Button kind="secondary" size="sm" icon={<Icon name="plus" size={14} />} onClick={create}>
              New domain
            </Button>
          </>
        }
      >
        <h1 className="text-display masthead">{totalWeek > 0 ? `${fmtH(totalWeek)} kept this week` : "Nothing kept this week"}</h1>
      </FloorHeader>

      {totalWeek > 0 && (
        <div className="mb-5">
          <WeekShape domains={domains} head={false} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-teach="domain-wall">
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
  const mark = domainMarkSpec(domain);
  return (
    <Card
      interactive
      selected={focused}
      className="fl-card fl-dcard"
      data-quiet={lit ? undefined : ""}
      data-teach={teach}
      {...pressable(onEnter, { label: domain.name })}
      onClick={onEnter}
    >
      <div className="fl-dcard-top">
        <DomainMark spec={mark} size={52} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="fl-dcard-name">{domain.name}</div>
          <div className="fl-dcard-state">{st.short}</div>
        </div>
      </div>

      {domain.intention.trim() && <p className="fl-dcard-mandate">{domain.intention}</p>}

      <div className="fl-dcard-foot">
        <span className="fl-meta-fact">
          <b className="font-semibold text-ink">{fmtH(domain.investedThisWeek)}</b>
          {domain.weeklyTargetHours > 0 && ` / ${fmtH(domain.weeklyTargetHours)}`} week
        </span>
        <span className="fl-meta-fact">
          <b className="font-semibold text-ink">{domain.quarterHours}h</b> quarter
        </span>
        <span className="k-grow" />
        <ClarityMark domain={domain} />
      </div>
    </Card>
  );
}

// ══ The open domain — a document ═════════════════════════════════════════════
function DomainDetail({ domain, onBack, onOpenInitiative, onOpenProject }: { domain: Domain; onBack: () => void; onOpenInitiative: (id: string) => void; onOpenProject: (id: string) => void }) {
  const { data, updateDomain, deleteDomain, addInitiative, addProject } = useVertical();
  const now = useMemo(() => new Date(), []);
  const st = stateOf(domain);
  const inits = initiativesOf(data, domain.id);
  const openInits = inits.filter((i) => isOpenStatus(i.status));
  const looseProjects = openLooseProjectsOf(data, domain.id);
  const loose = looseTasksOfDomain(data, domain.id);
  const accent = domain.color;

  const mark = domainMarkSpec(domain);

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

  const inFlight = openInits.length + looseProjects.length;
  const meetTone = `color-mix(in srgb, ${accent} 38%, var(--line-2))`;

  return (
    <div className="fl-doc">
      <div className="fl-doc-main">
        <div>
          <Button kind="ghost" size="sm" icon={<Icon name="chevron-left" size={14} />} onClick={onBack} title="All domains (Esc)" style={{ marginLeft: -8 }}>
            All domains
          </Button>
        </div>

        {/* ── the title: mark · name · state · the mandate as the lead ── */}
        <header className="grid gap-3">
          <div className="fl-doc-title">
            <DomainMark spec={mark} size={64} className="shrink-0" />
            <div className="min-w-0">
              <h1 className="text-display masthead m-0">
                <InlineText value={domain.name} onChange={(v) => updateDomain(domain.id, { name: v })} placeholder="Name this domain" />
              </h1>
              <p className="fl-doc-state">{st.line}</p>
            </div>
          </div>
          <InlineTextarea
            value={domain.intention}
            onChange={(v) => updateDomain(domain.id, { intention: v })}
            placeholder="The standing mandate for this domain"
            className="fl-doc-lead"
          />
        </header>

        {/* ── the last quarter — the pulse ── */}
        <section className="fl-sec">
          <SectionHeader title="The last quarter" count={`${kept} of 13 weeks`} />
          <div className="pt-2" style={{ maxWidth: 360 }}>
            <PresencePulse weeks={domain.weeks} color={accent} target={domain.weeklyTargetHours} />
          </div>
          <p className="fl-note">
            Showed up {kept} of the last 13 weeks.
            {longestQuiet > 1 ? ` Longest quiet stretch: ${longestQuiet} weeks.` : ""}
            {domain.weeklyTargetHours > 0 ? ` The dashed line is your ${fmtH(domain.weeklyTargetHours)} a week.` : ""}
          </p>
        </section>

        {/* ── the Gain ── */}
        <section className="fl-sec">
          <SectionHeader title="The Gain" />
          <div className="fl-nums">
            <div className="fl-num"><b>{domain.quarterHours}<small>h</small></b><span>this quarter</span></div>
            <div className="fl-num">
              <b>{fmtH(domain.investedThisWeek)}{domain.weeklyTargetHours > 0 && <small> / {fmtH(domain.weeklyTargetHours)}</small>}</b>
              <span>this week</span>
            </div>
            <div className="fl-num"><b>{streak}<small>wk</small></b><span>current streak</span></div>
            <div className="fl-num"><b>{doneCount}</b><span>blocks done</span></div>
          </div>
          {domain.investedThisWeek > 0 && (
            <div className="grid gap-2 pt-3">
              <div className="fl-split" aria-hidden>
                {deep > 0 && <i style={{ width: `${(deep / domain.investedThisWeek) * 100}%`, background: accent }} />}
                {meet > 0 && <i style={{ width: `${(meet / domain.investedThisWeek) * 100}%`, background: meetTone }} />}
              </div>
              <div className="fl-legend">
                <span><Dot color={accent} />Deep work · {fmtH(deep)}</span>
                {meet > 0 && <span><Dot color={meetTone} />Meetings · {fmtH(meet)}</span>}
              </div>
            </div>
          )}
        </section>

        {/* ── what shipped here ── */}
        <section className="fl-sec">
          <SectionHeader title="Shipped" count={shipped.length || undefined} />
          {shipped.length > 0 ? (
            <div className="fl-rows">
              {shipped.map((it) => (
                <Row
                  key={it.id}
                  density="comfy"
                  leading={<Icon name="check" size={14} style={{ color: "var(--ok)" }} />}
                  title={it.name}
                  meta={it.at ? shipWhen(it.at) : undefined}
                />
              ))}
            </div>
          ) : (
            <p className="fl-note pt-2">
              {doneCount > 0 ? `${doneCount} block${doneCount === 1 ? "" : "s"} kept this quarter` : "Nothing shipped yet"}
            </p>
          )}
        </section>

        {/* ── what's in flight — outcome vs effort ── */}
        <section className="fl-sec">
          <SectionHeader
            title="In flight"
            count={inFlight || undefined}
            actions={
              <span className="flex items-center gap-1">
                <Button kind="ghost" size="xs" icon={<Icon name="plus" size={13} />} onClick={() => void addProject(domain.id, null).then((p) => onOpenProject(p.id))}>
                  Project
                </Button>
                <Button kind="ghost" size="xs" icon={<Icon name="plus" size={13} />} onClick={() => void addInitiative(domain.id).then((i) => onOpenInitiative(i.id))}>
                  Initiative
                </Button>
              </span>
            }
          />

          {inFlight === 0 ? (
            <p className="fl-note pt-2">{shipped.length > 0 ? "Nothing in flight" : "No initiatives yet"}</p>
          ) : (
            <div className="fl-rows">
              {openInits.map((i) => {
                const attain = initiativeAttainment(data, i);
                const outcome = attain ?? initiativeProgress(data, i);
                const exec = initiativeExecution(data, i);
                const risk = initiativeAtRisk(data, i, now);
                return (
                  <div key={i.id} className="fl-hrow">
                    <span className="w-3 shrink-0 text-center text-caption" style={{ color: "var(--muted)" }} title="Momentum">
                      {mom(i.momentum)}
                    </span>
                    <button type="button" onClick={() => onOpenInitiative(i.id)} className="inline-edit min-w-0 flex-1 truncate text-left font-semibold" style={{ border: 0, background: "transparent", color: "var(--ink)", padding: "2px 4px", marginLeft: -4 }}>
                      {i.name}
                    </button>
                    {risk.atRisk && <Chip title={risk.reasons.join(" · ")}>{risk.reasons[0]}</Chip>}
                    <div className="fl-twin" aria-label={`Outcome ${attain != null ? `${outcome}%` : "not measured"}, build ${exec}%`}>
                      <div className="fl-twin-row">
                        <span>Outcome</span>
                        <span className="fl-bar" style={{ height: 3 }}><i style={{ width: `${outcome}%`, background: accent }} /></span>
                        <span>{attain != null ? `${outcome}%` : "—"}</span>
                      </div>
                      <div className="fl-twin-row">
                        <span>Build</span>
                        <span className="fl-bar" style={{ height: 3 }}><i style={{ width: `${exec}%`, background: meetTone }} /></span>
                        <span>{exec}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {looseProjects.map((p) => (
                <Row
                  key={p.id}
                  density="comfy"
                  leading={<Dot color={PROJECT_STATUS_COLORS[p.status]} shape="round" />}
                  title={p.name}
                  meta={PROJECT_STATUS_LABEL[p.status]}
                  onActivate={() => onOpenProject(p.id)}
                />
              ))}
            </div>
          )}
          {loose.length > 0 && (
            <p className="fl-note pt-1">
              {loose.length} loose {loose.length === 1 ? "task" : "tasks"} here
            </p>
          )}
        </section>

        {/* ── Nuvo's read — derived interpretation ── */}
        {reads.length > 0 && (
          <section className="fl-sec">
            <SectionHeader title="Nuvo's read" />
            <div className="fl-rows">
              {reads.map((r, i) => {
                const c = r.tone === "warn" ? "var(--warn)" : r.tone === "good" ? "var(--ok)" : "var(--faint)";
                return (
                  <div key={i} className="fl-hrow" style={{ alignItems: "flex-start", paddingTop: 10, paddingBottom: 10 }}>
                    <span className="mt-[5px]"><Dot color={c} shape="round" /></span>
                    <p className="m-0 min-w-0 flex-1 text-body">{r.text}</p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <DomainGroom domain={domain} />
      </div>

      {/* ── the property panel ── */}
      <aside className="fl-doc-props" aria-label="Properties">
        <MarkPicker domain={domain} />
        <div className="k-prop">
          <span className="k-prop-label">Weekly intent</span>
          <span className="k-prop-value">
            <InlineNumber value={domain.weeklyTargetHours} onChange={(v) => updateDomain(domain.id, { weeklyTargetHours: v })} suffix="h" />
          </span>
        </div>
        <div className="k-prop">
          <span className="k-prop-label">State</span>
          <span className="k-prop-value" style={{ fontWeight: 450 }}>{st.short}</span>
        </div>
        <div className="k-prop">
          <span className="k-prop-label">Routing</span>
          <span className="k-prop-value"><ClarityMark domain={domain} /></span>
        </div>
        <div className="fl-doc-props-foot">
          <DeleteBtn what="domain" onDelete={() => { deleteDomain(domain.id); onBack(); }} />
        </div>
      </aside>
    </div>
  );
}

// One door for one identity. The symbol and its light are edited together; the
// presence halo is always generated from the domain and never separately styled.
// A property row whose value opens the mark in a kit popover.
function MarkPicker({ domain }: { domain: Domain }) {
  const { updateDomain } = useVertical();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <div className="k-prop">
      <span className="k-prop-label">Mark</span>
      <button
        ref={btn}
        type="button"
        className="k-prop-value"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Edit domain mark"
      >
        <span className="inline-flex" style={{ color: domain.color }}><DomainSymbol value={domain.icon} size={15} /></span>
        <Dot color={domain.color} />
        <span style={{ color: "var(--muted)", fontWeight: 450 }}>Edit</span>
      </button>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} placement="bottom-end" label="Domain mark" className="w-[272px]">
        <div className="grid gap-3 p-2">
          <div className="fl-work-row">
            <span className="fl-label">Symbol</span>
            <span className="k-grow" />
            <IconButton size="xs" label="Close" icon={<Icon name="close" size={13} />} onClick={() => setOpen(false)} />
          </div>
          <DomainSymbolPicker
            value={domain.icon}
            domainName={domain.name}
            domainContext={domain.intention}
            onPick={(icon) => updateDomain(domain.id, { icon })}
          />
          <span className="fl-label">Color</span>
          <SwatchGrid value={domain.color} onPick={(color) => updateDomain(domain.id, { color })} />
        </div>
      </Popover>
    </div>
  );
}
