// The open domain, on a phone — the twin of the desktop's `DomainDetail`
// (`floors/DomainFloor.tsx`), at full feature parity.
//
// The desktop opens a domain as a tall bordered plate with a radial wash of the
// domain's own light: hero (mark · name · mandate · presence voice), the last
// quarter's pulse, the Gain beside what you've built, the portfolio pointed at
// outcomes, Nuvo's derived read, and the grooming workbench at the foot. The
// phone runs the SAME acts down one column inside the detail Sheet, in the same
// order, off the same selectors (`lib/domainRead.ts`) and the same marks
// (`components/domain/DomainParts.tsx`). Nothing here re-derives a domain's
// state — a domain that reads "quiet for 9 days" at a desk says exactly that in
// your hand.
//
// The two things that are the phone's own: the mark controls (symbol + light)
// are a disclosure under the hero rather than hover-revealed chrome in a corner,
// and "Parked here" is an editable list with a composer, because capture on a
// phone is the point.

import { useMemo, useState } from "react";
import {
  domainKeptCount,
  domainLongestQuiet,
  domainQuarterDone,
  domainStreak,
  initiativeAtRisk,
  initiativeAttainment,
  initiativeExecution,
  initiativeProgress,
  initiativesOf,
  isOpenStatus,
  openLooseProjectsOf,
  looseTasksOfDomain,
  type VerticalData,
} from "../../../lib/vertical";
import {
  domainRead,
  domainShipped,
  fmtH,
  mom,
  shipWhen,
  stateOf,
  weekSplit,
} from "../../../lib/domainRead";
import {
  ClarityMark,
  DomainGroom,
  PresencePulse,
  Flourish,
  DomainSymbolPicker,
  SwatchGrid,
} from "../../domain/DomainParts";
import DomainSymbol from "../../domain/DomainSymbol";
import { Icon } from "../../Icon";
import { Card, Chip, Dot } from "../../kit";
import { TouchButton } from "../touch";
import DomainMark from "../../domain/DomainMark";
import { domainMarkSpec } from "../../../lib/domainMark";
import { Bar, DeleteBtn, PROJECT_STATUS_COLORS, PROJECT_STATUS_LABEL } from "../../floors/parts";
import {
  CardList,
  Empty,
  Hint,
  NumberField,
  RecordHead,
  Section,
  DetailTaskList,
  type Store,
} from "./verticalDetail";

export default function MobileDomainScreen({
  d,
  store,
  id,
  onOpenInitiative,
  onOpenProject,
  onClose,
}: {
  d: VerticalData;
  store: Store;
  id: string;
  onOpenInitiative: (id: string) => void;
  onOpenProject: (id: string) => void;
  /** Deleting the domain closes the sheet — there's nothing left to show. */
  onClose?: () => void;
}) {
  const now = useMemo(() => new Date(), []);
  const dom = d.domains.find((x) => x.id === id);
  const [dressing, setDressing] = useState(false);

  if (!dom) return <Empty>Gone</Empty>;

  const accent = dom.color;
  const st = stateOf(dom);
  const mark = domainMarkSpec(dom);

  // rhythm reads — the same four the desktop's Gain prints
  const streak = domainStreak(dom.weeks);
  const kept = domainKeptCount(dom.weeks);
  const longestQuiet = domainLongestQuiet(dom.weeks);
  const doneCount = domainQuarterDone(d, dom.id, now);

  const shipped = domainShipped(d, dom.id, now);
  const { deep, meet } = weekSplit(dom);
  const reads = domainRead(d, dom, now);

  const openInits = initiativesOf(d, dom.id).filter((i) => isOpenStatus(i.status));
  const looseProjects = openLooseProjectsOf(d, dom.id);
  const looseTasks = looseTasksOfDomain(d, dom.id);

  return (
    // The domain's light IS the accent inside its own screen — including the
    // wash and the ring, or a chip lit inside it would wear the app's mulberry
    // beside a rule in the domain's hue. The ground stays flat (D-189).
    <div
      className="ph-body pt-1"
      style={{
        ["--accent" as string]: accent,
        ["--accent-ink" as string]: accent,
        ["--accent-soft" as string]: `color-mix(in srgb, ${accent} 12%, transparent)`,
        ["--accent-wash" as string]: `color-mix(in srgb, ${accent} 12%, transparent)`,
        ["--accent-ring" as string]: `color-mix(in srgb, ${accent} 40%, transparent)`,
      }}
    >
      {/* ── the hero: mark · name · mandate · presence voice ── */}
      <div className="flex flex-col items-center pb-1 text-center">
        <DomainMark spec={mark} size={96} />
        <div className="mt-2 w-full">
          <RecordHead
            accent={accent}
            name={dom.name}
            onName={(v) => store.updateDomain(dom.id, { name: v })}
            outcome={dom.intention}
            onOutcome={(v) => store.updateDomain(dom.id, { intention: v })}
            outcomePlaceholder="Mandate"
            center
            flourish={<Flourish color={accent} width={96} />}
            stateTag={st.short}
            captionOutcome
          />
        </div>
        <div className="mt-2.5">
          <ClarityMark domain={dom} />
        </div>
      </div>

      {/* ── one door for the domain mark — chrome, so it hides ── */}
      <div className="mt-4 flex items-center justify-center gap-2">
        <TouchButton
          compact
          aria-expanded={dressing}
          onClick={() => setDressing((v) => !v)}
          icon={<DomainSymbol value={dom.icon} size={16} />}
          trailing={<Icon name="chevron-down" size={14} className={`fast text-[var(--faint)] ${dressing ? "rotate-180" : ""}`} />}
        >
          <Dot color={accent} shape="round" />
          Edit mark
        </TouchButton>
      </div>
      {dressing && (
        <Card className="ph-card mt-3">
          <div className="text-caption font-semibold text-muted">Symbol</div>
          <div className="mt-2">
            <DomainSymbolPicker
              value={dom.icon}
              domainName={dom.name}
              domainContext={dom.intention}
              onPick={(icon) => store.updateDomain(dom.id, { icon })}
              phone
            />
          </div>
          <div className="mt-2 text-caption font-semibold text-muted">Color</div>
          <div>
            <SwatchGrid value={accent} onPick={(c) => store.updateDomain(dom.id, { color: c })} phone />
          </div>
        </Card>
      )}

      {/* ── the last quarter — the pulse ── */}
      <Section label="The last quarter">
        <div>
          <PresencePulse weeks={dom.weeks} color={accent} target={dom.weeklyTargetHours} height={48} />
          <div className="mt-2 text-caption tabular-nums text-muted">
            <span className="font-semibold text-ink">{kept} of 13</span> weeks showed up
            {longestQuiet > 1 ? ` · longest quiet ${longestQuiet} wk` : ""}
            {dom.weeklyTargetHours > 0 ? ` · dashed ${fmtH(dom.weeklyTargetHours)}/wk` : ""}
          </div>
        </div>
      </Section>

      {/* ── the Gain — what this domain has cost you ── */}
      <Section label="The Gain">
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <GainNum n={`${dom.quarterHours}`} unit="h" label="this quarter" />
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="ph-stat">{fmtH(dom.investedThisWeek)}</span>
              <span className="text-caption text-muted">/</span>
              <NumberField
                value={dom.weeklyTargetHours}
                accent={accent}
                onCommit={(v) => store.updateDomain(dom.id, { weeklyTargetHours: v })}
              />
              <span className="text-caption text-muted">h</span>
            </div>
            <div className="text-caption text-muted">this week · intent</div>
          </div>
          <GainNum n={`${streak}`} unit="wk" label="current streak" />
          <GainNum n={`${doneCount}`} unit="" label="blocks done" />
        </div>
        {dom.investedThisWeek > 0 && (
          <>
            <div className="mt-3 flex h-1.5 overflow-hidden rounded-full" style={{ background: "var(--line-1)" }}>
              {deep > 0 && <span style={{ width: `${(deep / dom.investedThisWeek) * 100}%`, background: accent }} />}
              {meet > 0 && (
                <span style={{ width: `${(meet / dom.investedThisWeek) * 100}%`, background: `color-mix(in srgb, ${accent} 38%, var(--raised))` }} />
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-caption tabular-nums text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Dot color={accent} size="sm" />
                Deep work · {fmtH(deep)}
              </span>
              {meet > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <Dot color={`color-mix(in srgb, ${accent} 38%, var(--raised))`} size="sm" />
                  Meetings · {fmtH(meet)}
                </span>
              )}
            </div>
          </>
        )}
      </Section>

      {/* ── what you've built — milestones crossed here ── */}
      <Section label="What you've built" meter={shipped.length ? String(shipped.length) : null}>
        {shipped.length > 0 ? (
          <CardList>
            {shipped.map((it) => (
              <div key={it.id} className="ph-row">
                <span className="ph-row-lead" style={{ color: "var(--ok)" }}>
                  <Icon name="check" size={18} />
                </span>
                <span className="ph-row-label" data-grow="">
                  {it.name}
                </span>
                {it.at && <span className="ph-row-meta">{shipWhen(it.at)}</span>}
              </div>
            ))}
          </CardList>
        ) : (
          <Hint>
            {doneCount > 0 ? `${doneCount} block${doneCount === 1 ? "" : "s"} kept · nothing shipped` : "Nothing shipped yet"}
          </Hint>
        )}
      </Section>

      {/* ── the portfolio — is the work moving the needle? ── */}
      <Section
        label="What you're building toward"
        meter={openInits.length || looseProjects.length ? `${openInits.length + looseProjects.length}` : null}
      >
        {openInits.length === 0 && looseProjects.length === 0 ? (
          <Hint>
            {shipped.length > 0 ? "Nothing in flight" : "No initiatives yet"}
          </Hint>
        ) : (
          <CardList>
            {openInits.map((i) => {
              const attain = initiativeAttainment(d, i);
              const outcome = attain ?? initiativeProgress(d, i);
              const exec = initiativeExecution(d, i);
              const risk = initiativeAtRisk(d, i, now);
              return (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => onOpenInitiative(i.id)}
                  className="ph-row row-hover !items-start py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="shrink-0 text-caption" style={{ color: accent }} aria-hidden>
                        {mom(i.momentum)}
                      </span>
                      <span className="ph-row-title">{i.name}</span>
                    </div>
                    {risk.atRisk && (
                      <div className="mt-1.5">
                        <Chip dot="var(--warn)">{risk.reasons[0]}</Chip>
                      </div>
                    )}
                    {/* outcome over build — the two axes the desktop stacks in a
                        148px column, here full width under the name */}
                    <div className="mt-2 grid gap-1">
                      <div className="flex justify-between text-caption tabular-nums text-muted">
                        <span>Outcome</span>
                        <span>{attain != null ? `${outcome}%` : "—"}</span>
                      </div>
                      <Bar pct={outcome} color={accent} h={1} />
                      <div className="mt-1 flex justify-between text-caption tabular-nums text-muted">
                        <span>Build</span>
                        <span>{exec}%</span>
                      </div>
                      <Bar pct={exec} color={`color-mix(in srgb, ${accent} 45%, var(--raised))`} h={1} />
                    </div>
                  </div>
                  <Icon name="chevron-right" size={16} className="ph-row-chev mt-0.5" />
                </button>
              );
            })}

            {looseProjects.map((p) => (
              <button key={p.id} type="button" onClick={() => onOpenProject(p.id)} className="ph-row row-hover">
                <span className="ph-row-lead">
                  <Dot color={PROJECT_STATUS_COLORS[p.status]} shape="round" />
                </span>
                <span className="ph-row-title">{p.name}</span>
                <span className="ph-row-meta">{PROJECT_STATUS_LABEL[p.status]}</span>
                <Icon name="chevron-right" size={16} className="ph-row-chev" />
              </button>
            ))}
          </CardList>
        )}
        <div className="mt-3 flex gap-2">
          <TouchButton
            className="flex-1"
            icon={<Icon name="plus" size={16} />}
            onClick={() => void store.addProject(dom.id, null).then((p) => onOpenProject(p.id))}
          >
            Project
          </TouchButton>
          <TouchButton
            className="flex-1"
            icon={<Icon name="plus" size={16} />}
            onClick={() => void store.addInitiative(dom.id).then((i) => onOpenInitiative(i.id))}
          >
            Initiative
          </TouchButton>
        </div>
      </Section>

      {/* ── Nuvo's read — derived interpretation, no AI call ── */}
      <Section label="Nuvo's read">
        {/* Read, not decorated: a mark in the read's tone, then the words. */}
        <div className="flex flex-col gap-2.5">
          {reads.map((r, idx) => {
            const c = r.tone === "warn" ? "var(--warn)" : r.tone === "good" ? accent : "var(--faint)";
            return (
              <div key={idx} className="flex items-start gap-3">
                <span className="mt-[7px] flex shrink-0">
                  <Dot color={c} shape="round" size="sm" />
                </span>
                <p className="m-0 text-body leading-relaxed text-[var(--ink-2)]">{r.text}</p>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── parked here — the desktop prints the count; a phone can act on it ── */}
      <Section label="Parked here" meter={looseTasks.length ? String(looseTasks.length) : null}>
        <DetailTaskList tasks={looseTasks} parent={{ domainId: dom.id }} placeholder="Add a task" reorderable />
      </Section>

      {/* ── how Nuvo files things here — the routing workbench, shared ── */}
      <Section label="Routing">
        <DomainGroom domain={dom} phone />
      </Section>

      <div className="mt-6 flex justify-start border-t border-[var(--line-1)] pt-3">
        <DeleteBtn
          what="domain"
          phone
          onDelete={() => {
            store.deleteDomain(dom.id);
            onClose?.();
          }}
        />
      </div>
    </div>
  );
}

function GainNum({ n, unit, label }: { n: string; unit: string; label: string }) {
  return (
    <div>
      <div className="ph-stat">
        {n}
        {unit && <span className="text-caption font-medium text-muted">{unit}</span>}
      </div>
      <div className="text-caption text-muted">{label}</div>
    </div>
  );
}
