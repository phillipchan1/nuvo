// The open domain, on a phone — the twin of the desktop's `DomainDetail`
// (`floors/DomainFloor.tsx`), at full feature parity.
//
// The desktop opens a domain as a tall bordered plate with a radial wash of the
// domain's own light: hero (sigil · name · mandate · presence voice), the last
// quarter's pulse, the Gain beside what you've built, the portfolio pointed at
// outcomes, Nuvo's derived read, and the grooming workbench at the foot. The
// phone runs the SAME acts down one column inside the detail Sheet, in the same
// order, off the same selectors (`lib/domainRead.ts`) and the same marks
// (`components/domain/DomainParts.tsx`). Nothing here re-derives a domain's
// state — a domain that reads "quiet for 9 days" at a desk says exactly that in
// your hand.
//
// The two things that are the phone's own: the appearance controls (form + light)
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
  SigilFormGrid,
  SwatchGrid,
} from "../../domain/DomainParts";
import {
  domainForm,
  domainSigilSpec,
  setDomainForm,
  SIGIL_FORM_LABEL,
  type SigilForm,
} from "../../../lib/domainSigil";
import DomainSigil from "../../floors/DomainSigil";
import { Bar, DeleteBtn, PROJECT_STATUS_COLORS, PROJECT_STATUS_LABEL } from "../../floors/parts";
import {
  CardList,
  Empty,
  Hint,
  NumberField,
  RecordHead,
  Section,
  TaskComposer,
  TaskRow,
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
  const [form, setForm] = useState<SigilForm>(() => domainForm(id));
  const [dressing, setDressing] = useState(false);

  if (!dom) return <Empty>This domain is gone.</Empty>;

  const accent = dom.color;
  const st = stateOf(dom);
  const lit = st.tone === "lit";
  const spec = domainSigilSpec(dom, form);
  const pickForm = (f: SigilForm) => { setDomainForm(dom.id, f); setForm(f); };

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
    // The domain's light washes the screen the way the desktop plate does — the
    // one place a domain's colour is the ground, not an accent.
    <div
      className="px-4 pt-1"
      style={{
        // The domain's light IS the accent inside its own screen — including the
        // soft pair, or the "showing up" card tints with the app accent while
        // its rule tints with the domain's.
        ["--accent" as string]: accent,
        ["--accent-soft" as string]: `color-mix(in srgb, ${accent} 12%, transparent)`,
        background: `radial-gradient(120% 40% at 50% -2%, color-mix(in srgb, ${accent} 12%, transparent) 0%, transparent 60%)`,
      }}
    >
      {/* ── the hero: mark · name · mandate · presence voice ── */}
      <div className="flex flex-col items-center pb-1 text-center">
        <DomainSigil spec={spec} size={96} />
        <div className="mt-2 w-full">
          <RecordHead
            accent={accent}
            name={dom.name}
            onName={(v) => store.updateDomain(dom.id, { name: v })}
            outcome={dom.intention}
            onOutcome={(v) => store.updateDomain(dom.id, { intention: v })}
            outcomePlaceholder="State the standing mandate for this domain…"
            center
            flourish={<Flourish color={accent} width={96} />}
          />
        </div>
        <div
          className="mt-3 text-micro uppercase"
          style={{ letterSpacing: "0.14em", color: lit ? "color-mix(in srgb, var(--ink) 55%, var(--muted))" : "color-mix(in srgb, var(--ink) 45%, var(--muted))" }}
        >
          {st.line}
        </div>
        <div className="mt-2.5">
          <ClarityMark domain={dom} />
        </div>
      </div>

      {/* ── the sigil's form + the domain's light — chrome, so it hides ── */}
      <div className="mt-4 flex items-center justify-center gap-2">
        <button
          onClick={() => setDressing((v) => !v)}
          aria-expanded={dressing}
          className="tap fast flex items-center gap-2 rounded-full border border-line px-3 py-2 text-micro text-muted active:text-ink"
        >
          <span>✦ {SIGIL_FORM_LABEL[form]}</span>
          <span className="h-3 w-3 rounded-full ring-1 ring-line" style={{ background: accent }} />
          <span className="mono">{dressing ? "–" : "+"}</span>
        </button>
      </div>
      {dressing && (
        <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3">
          <div className="section-label !p-0">The sigil's form</div>
          <div className="mt-2">
            <SigilFormGrid domain={dom} form={form} onPick={pickForm} size={40} phone />
          </div>
          <div className="section-label mt-4 !p-0">The domain's light</div>
          <div className="mt-2">
            <SwatchGrid value={accent} onPick={(c) => store.updateDomain(dom.id, { color: c })} phone />
          </div>
        </div>
      )}

      {/* ── the last quarter — the pulse ── */}
      <Section label="The last quarter">
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <PresencePulse weeks={dom.weeks} color={accent} target={dom.weeklyTargetHours} height={48} />
          <div className="mono mt-2 text-meta text-muted">
            <span style={{ color: accent }}>Showed up {kept} of the last 13 weeks.</span>
            {longestQuiet > 1 ? ` Longest quiet stretch: ${longestQuiet} weeks.` : ""}
          </div>
          {dom.weeklyTargetHours > 0 && (
            <div className="text-micro uppercase text-muted" style={{ letterSpacing: "0.08em" }}>
              dashed line · your {fmtH(dom.weeklyTargetHours)}/wk intent
            </div>
          )}
        </div>
      </Section>

      {/* ── the Gain — what this domain has cost you ── */}
      <Section label="The Gain">
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <GainNum n={`${dom.quarterHours}`} unit="h" label="this quarter" />
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="mono text-lead" style={{ fontWeight: 600, letterSpacing: "-.02em" }}>
                {fmtH(dom.investedThisWeek)}
              </span>
              <span className="text-caption text-muted">/</span>
              <NumberField
                value={dom.weeklyTargetHours}
                accent={accent}
                onCommit={(v) => store.updateDomain(dom.id, { weeklyTargetHours: v })}
              />
              <span className="text-caption text-muted">h</span>
            </div>
            <div className="text-micro uppercase text-muted" style={{ letterSpacing: "0.08em" }}>
              this week · your intent
            </div>
          </div>
          <GainNum n={`${streak}`} unit="wk" label="current streak" />
          <GainNum n={`${doneCount}`} unit="" label="blocks done" />
        </div>
        {dom.investedThisWeek > 0 && (
          <>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
              {deep > 0 && <span style={{ width: `${(deep / dom.investedThisWeek) * 100}%`, background: accent }} />}
              {meet > 0 && (
                <span style={{ width: `${(meet / dom.investedThisWeek) * 100}%`, background: `color-mix(in srgb, ${accent} 38%, var(--surface))` }} />
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted">
              <span>
                <i className="mr-1.5 inline-block h-2 w-2 rounded-[2px] align-middle" style={{ background: accent }} />
                Deep work · {fmtH(deep)}
              </span>
              {meet > 0 && (
                <span>
                  <i className="mr-1.5 inline-block h-2 w-2 rounded-[2px] align-middle" style={{ background: `color-mix(in srgb, ${accent} 38%, var(--surface))` }} />
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
              <div key={it.id} className="flex items-baseline gap-2.5 px-3 py-2.5 text-body">
                <span style={{ color: "var(--slot)" }}>✓</span>
                <span className="min-w-0 flex-1 truncate">{it.name}</span>
                {it.at && <span className="mono shrink-0 text-meta text-muted">{shipWhen(it.at)}</span>}
              </div>
            ))}
          </CardList>
        ) : (
          <Hint>
            {doneCount > 0
              ? `${doneCount} block${doneCount === 1 ? "" : "s"} kept this quarter — no finished milestones yet, but the hours are landing.`
              : "Nothing finished here yet. What's the first thing you'll ship?"}
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
            {shipped.length > 0
              ? "Nothing in flight — everything here has shipped. What's next?"
              : "No initiatives yet — this domain simply asks to be groomed."}
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
                  onClick={() => onOpenInitiative(i.id)}
                  className="tap fast flex w-full items-start gap-2.5 px-3 py-2.5 text-left active:bg-surface"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: accent }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="mono shrink-0 text-micro" style={{ color: accent }}>{mom(i.momentum)}</span>
                      <span className="serif min-w-0 flex-1 truncate text-head">{i.name}</span>
                    </div>
                    {risk.atRisk && (
                      <span
                        className="mt-1 inline-block rounded-full px-2 py-0.5 text-micro font-medium"
                        style={{ background: "var(--signal-soft)", color: "var(--signal)" }}
                      >
                        {risk.reasons[0]}
                      </span>
                    )}
                    {/* outcome over build — the two axes the desktop stacks in a
                        148px column, here full width under the name */}
                    <div className="mt-1.5">
                      <div className="flex justify-between text-micro uppercase text-muted">
                        <span>outcome</span>
                        <span className="mono">{attain != null ? `${outcome}%` : "—"}</span>
                      </div>
                      <Bar pct={outcome} color={accent} h={1} />
                      <div className="mt-0.5 flex justify-between text-micro uppercase text-muted">
                        <span>build</span>
                        <span className="mono">{exec}%</span>
                      </div>
                      <Bar pct={exec} color={`color-mix(in srgb, ${accent} 45%, var(--surface))`} h={1} />
                    </div>
                  </div>
                  <span className="shrink-0 text-muted">›</span>
                </button>
              );
            })}

            {looseProjects.map((p) => (
              <button
                key={p.id}
                onClick={() => onOpenProject(p.id)}
                className="tap fast flex w-full items-center gap-2.5 px-3 py-2.5 text-left active:bg-surface"
              >
                <span style={{ color: PROJECT_STATUS_COLORS[p.status], fontSize: 7, lineHeight: 1 }}>●</span>
                <span className="min-w-0 flex-1 truncate text-body">{p.name}</span>
                <span className="shrink-0 text-meta" style={{ color: PROJECT_STATUS_COLORS[p.status] }}>
                  {PROJECT_STATUS_LABEL[p.status]}
                </span>
                <span className="shrink-0 text-muted">›</span>
              </button>
            ))}
          </CardList>
        )}
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => void store.addProject(dom.id, null).then((p) => onOpenProject(p.id))}
            className="tap fast flex-1 rounded-xl border border-dashed border-line py-2.5 text-center text-body text-muted active:text-ink"
          >
            ＋ project
          </button>
          <button
            onClick={() => void store.addInitiative(dom.id).then((i) => onOpenInitiative(i.id))}
            className="tap fast flex-1 rounded-xl border border-dashed border-line py-2.5 text-center text-body text-muted active:text-ink"
          >
            ＋ initiative
          </button>
        </div>
      </Section>

      {/* ── Nuvo's read — derived interpretation, no AI call ── */}
      <Section label="Nuvo's read">
        <div className="flex flex-col gap-2">
          {reads.map((r, idx) => {
            const c = r.tone === "warn" ? "var(--signal)" : r.tone === "good" ? accent : "var(--muted)";
            const bg =
              r.tone === "warn"
                ? "var(--signal-soft)"
                : r.tone === "good"
                  ? "var(--accent-soft)"
                  : "color-mix(in srgb, var(--surface) 55%, transparent)";
            return (
              <div
                key={idx}
                className="flex items-start gap-2.5 rounded-xl px-3 py-2.5"
                style={{ background: bg, border: `1px solid color-mix(in srgb, ${c} 20%, var(--line))` }}
              >
                <span style={{ color: c, fontSize: 13, lineHeight: 1.4 }}>
                  {r.tone === "warn" ? "◈" : r.tone === "good" ? "✦" : "·"}
                </span>
                <p className="text-caption" style={{ margin: 0, lineHeight: 1.5 }}>{r.text}</p>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── parked here — the desktop prints the count; a phone can act on it ── */}
      <Section label="Parked here" meter={looseTasks.length ? String(looseTasks.length) : null}>
        {looseTasks.length > 0 && (
          <CardList>
            {looseTasks.map((t) => (
              <TaskRow key={t.id} t={t} onToggle={() => store.toggleTask(t.id)} onDelete={() => store.deleteTask(t.id)} />
            ))}
          </CardList>
        )}
        <TaskComposer
          parent={{ domainId: dom.id }}
          store={store}
          accent={accent}
          placeholder="A task parked in this area…"
        />
      </Section>

      {/* ── how Nuvo files things here — the routing workbench, shared ── */}
      <Section label="Routing">
        <DomainGroom domain={dom} phone />
      </Section>

      <div className="mt-6 flex justify-end border-t border-line pt-4">
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
      <div className="mono text-lead" style={{ fontWeight: 600, letterSpacing: "-.02em" }}>
        {n}
        {unit && <span className="text-caption text-muted" style={{ fontWeight: 500 }}>{unit}</span>}
      </div>
      <div className="text-micro uppercase text-muted" style={{ letterSpacing: "0.08em" }}>{label}</div>
    </div>
  );
}
