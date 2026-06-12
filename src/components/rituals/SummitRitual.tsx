// Summit — the quarterly flow. Inputs: the quarter's ledger and the standing
// vows. Output: a re-affirmed set of domains and a decided portfolio of bets,
// rough-cut across the months. Four steps: the Quarter's Gain → the Vows →
// the Portfolio → the Months.

import { useMemo, useState } from "react";
import { subDays } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { useNarrator } from "../../hooks/useNarrator";
import {
  domainById,
  initiativeProgress,
  initiativeProgressAt,
  type VerticalData,
} from "../../lib/vertical";
import { fmtHours as hrs } from "../../lib/dates";
import {
  Bar,
  InlineNumber,
  InlineTextarea,
  MomentumChip,
  Timeline,
  type TimelineItem,
} from "../floors/parts";
import FlowShell, { type FlowStage } from "./FlowShell";
import { Btn } from "../ui";

const QUARTER_KEY = () => {
  const d = new Date();
  return `nuvo-summit-${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
};

export default function SummitRitual({
  onClose,
  onOpenBlueprint,
}: {
  onClose: () => void;
  onOpenBlueprint: () => void;
}) {
  const { data } = useVertical();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);

  const finish = () => {
    localStorage.setItem(QUARTER_KEY(), "1");
    setDone(true);
  };

  // header pipeline: live outputs along the canvas
  const gain = useMemo(() => quarterGain(data), [data]);
  const active = data.initiatives.filter((i) => i.status === "active");
  const paused = data.initiatives.filter((i) => i.status === "paused");
  const dated = active.filter((i) => i.startDate || i.targetDate);
  const targetSum = Math.round(data.domains.reduce((s, d) => s + d.weeklyTargetHours, 0));

  const stages: FlowStage[] = [
    {
      id: "gain",
      label: "Quarter's Gain",
      value: `${hrs(gain.doneMins)}h · ${gain.shipped.length} shipped`,
      body: <QuarterGainStep />,
    },
    {
      id: "vows",
      label: "The Vows",
      value: `${data.domains.length} vows · ${targetSum}h/wk`,
      body: <VowsStep />,
    },
    {
      id: "portfolio",
      label: "The Portfolio",
      value: `${active.length} live · ${paused.length} paused`,
      body: <PortfolioStep onOpenBlueprint={onOpenBlueprint} />,
    },
    {
      id: "months",
      label: "The Months",
      value: `${dated.length}/${active.length} dated`,
      body: <MonthsStep />,
    },
  ];

  return (
    <FlowShell
      title="Summit"
      sub="the quarter, decided"
      inputs={{ label: "the season", value: `90 days · ${data.domains.length} domains` }}
      output={{
        label: "the quarter",
        value: done ? `${active.length} bets sealed` : `${active.length} bets in play`,
        reached: done,
      }}
      stages={stages}
      step={step}
      setStep={setStep}
      finished={
        done ? (
          <div className="flex min-h-[50vh] items-center justify-center">
            <div className="max-w-[460px] text-center">
              <div className="text-[22px] font-semibold tracking-tight">The quarter is shaped.</div>
              <div className="mt-2 text-[13px] text-muted">
                Vows re-affirmed, bets decided, months rough-cut. The Sunday flow takes it from here, week by week.
              </div>
              <div className="mt-6"><Btn kind="primary" onClick={onClose}>Back to the week</Btn></div>
            </div>
          </div>
        ) : undefined
      }
      lastCta={{ label: "Seal the quarter →", onClick: finish }}
      onClose={onClose}
    />
  );
}


// ── 1 · The Quarter's Gain ───────────────────────────────────────────────────
function quarterGain(data: VerticalData) {
  const cutoff = subDays(new Date(), 90);
  const done = data.tasks.filter(
    (t) => t.status === "done" && t.completedAt && new Date(t.completedAt) >= cutoff,
  );
  const doneMins = done.reduce((s, t) => s + t.durationMins, 0);
  const shipped = data.initiatives.filter((i) => i.status === "shipped");
  const moved = data.initiatives
    .filter((i) => i.status === "active")
    .map((initiative) => ({
      initiative,
      from: initiativeProgressAt(data, initiative, cutoff),
      to: initiativeProgress(data, initiative),
    }))
    .filter((x) => x.to > x.from)
    .sort((a, b) => b.to - b.from - (a.to - a.from));
  return { done, doneMins, shipped, moved };
}

function QuarterGainStep() {
  const { data } = useVertical();
  const gain = useMemo(() => quarterGain(data), [data]);
  const narrated = useNarrator(
    useMemo(
      () => ({
        window: "quarter" as const,
        doneCount: gain.done.length,
        doneHours: Math.round((gain.doneMins / 60) * 10) / 10,
        byDomain: data.domains.map((d) => ({
          name: d.name,
          hours: d.quarterHours,
          targetHours: d.weeklyTargetHours * 13,
        })),
        moved: gain.moved.slice(0, 5).map(({ initiative, from, to }) => ({ name: initiative.name, from, to })),
        shipped: gain.shipped.map((i) => i.name),
      }),
      [gain, data.domains],
    ),
  );

  return (
    <div>
      <StepTitle title="The Quarter's Gain" sub="Ninety days, measured from where you started. Including what shipped — gains need a place to live." />

      <div className="mb-6 rounded-md border border-line bg-surface px-5 py-4">
        <div className="text-[16px] font-medium">
          {gain.done.length} tasks done · {hrs(gain.doneMins)}h invested · {gain.shipped.length} initiative{gain.shipped.length === 1 ? "" : "s"} shipped
        </div>
        {narrated && <div className="mt-1 text-[13px] text-muted">{narrated}</div>}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section>
          <div className="section-label mb-2">The long arc, by domain</div>
          <div className="space-y-3">
            {data.domains.map((d) => {
              const target = d.weeklyTargetHours * 13;
              const pct = target > 0 ? Math.min(100, (d.quarterHours / target) * 100) : 0;
              return (
                <div key={d.id}>
                  <div className="flex items-baseline justify-between text-[12px]">
                    <span><span style={{ color: d.color }}>{d.icon}</span> {d.name}</span>
                    <span className="mono text-[10px] text-muted">{d.quarterHours}h / ~{Math.round(target)}h</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-surface">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: d.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <div className="section-label mb-2">The trophy shelf</div>
          {gain.shipped.length > 0 ? (
            <div className="flex flex-wrap gap-2.5">
              {gain.shipped.map((i) => {
                const domain = domainById(data, i.domainId);
                return (
                  <div key={i.id} className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
                    <span className="text-[13px]" style={{ color: domain?.color }}>✓</span>
                    <span className="text-[12px] font-medium">{i.name}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[12px] text-muted italic">Nothing shipped yet this season — the bets below are how that changes.</div>
          )}

          {gain.moved.length > 0 && (
            <>
              <div className="section-label mb-2 mt-6">Still in flight, moved</div>
              <div className="space-y-2">
                {gain.moved.slice(0, 6).map(({ initiative, from, to }) => (
                  <div key={initiative.id} className="flex items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: domainById(data, initiative.domainId)?.color }} />
                    <span className="min-w-0 flex-1 truncate text-[12px]">{initiative.name}</span>
                    <span className="mono shrink-0 text-[11px]" style={{ color: "var(--accent)" }}>{from}% → {to}%</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ── 2 · The Vows — re-read every intention, re-set every target ─────────────
function VowsStep() {
  const { data, updateDomain } = useVertical();
  return (
    <div>
      <StepTitle title="The Vows" sub="Domains are vows, not goals. Re-read each intention — edit it or let it stand — and re-set the weekly hours it deserves this season." />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {data.domains.map((d) => (
          <div key={d.id} className="rounded-md border border-line bg-surface p-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-md text-[15px]" style={{ background: `${d.color}1a`, color: d.color }}>
                {d.icon}
              </span>
              <span className="text-[14px] font-semibold">{d.name}</span>
              <span className="mono ml-auto text-[10px] text-muted">
                <InlineNumber value={d.weeklyTargetHours} onChange={(v) => updateDomain(d.id, { weeklyTargetHours: v })} suffix="h/wk" />
              </span>
            </div>
            <div className="mt-2.5 border-l-2 pl-3" style={{ borderColor: `${d.color}55` }}>
              <InlineTextarea
                value={d.intention}
                onChange={(v) => updateDomain(d.id, { intention: v })}
                placeholder="State the standing intention…"
                className="text-[13px] italic text-muted"
              />
            </div>
            <div className="mono mt-2 text-[10px] text-muted">{d.quarterHours}h this quarter</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 3 · The Portfolio — every bet gets a verdict; new bets get a blueprint ──
function PortfolioStep({ onOpenBlueprint }: { onOpenBlueprint: () => void }) {
  const { data, updateInitiative } = useVertical();
  const rows = data.initiatives.filter((i) => i.status === "active" || i.status === "paused");

  return (
    <div>
      <StepTitle title="The Portfolio" sub="Every bet gets a verdict — ship it, keep it, pause it, or drop it. No zombies into the new quarter. Start the next bet with a blueprint." />
      <div className="mb-4">
        <Btn kind="primary" onClick={onOpenBlueprint}>✦ blueprint a new bet</Btn>
      </div>
      <div className="space-y-1.5">
        {rows.map((i) => {
          const domain = domainById(data, i.domainId);
          const pct = initiativeProgress(data, i);
          const paused = i.status === "paused";
          return (
            <div key={i.id} className="flex items-center gap-3 rounded-md border border-line bg-surface px-3.5 py-2.5" style={{ opacity: paused ? 0.55 : 1 }}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: domain?.color }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{i.name}</div>
                <div className="mono truncate text-[9px] text-muted">{domain?.name}{i.outcome && ` · ${i.outcome}`}</div>
              </div>
              <div className="hidden w-[120px] shrink-0 sm:block"><Bar pct={pct} color={domain?.color ?? "var(--accent)"} h={2} /></div>
              <span className="mono shrink-0 text-[11px] text-muted">{pct}%</span>
              <MomentumChip value={i.momentum} onChange={(m) => updateInitiative(i.id, { momentum: m })} />
              {paused ? (
                <Btn onClick={() => updateInitiative(i.id, { status: "active" })}>resume</Btn>
              ) : (
                <>
                  <Btn onClick={() => updateInitiative(i.id, { status: "shipped" })} title="Done — onto the trophy shelf">✓ ship</Btn>
                  <Btn onClick={() => updateInitiative(i.id, { status: "paused" })}>pause</Btn>
                  <Btn kind="signal" onClick={() => updateInitiative(i.id, { status: "dropped" })}>drop</Btn>
                </>
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="rounded-md border border-dashed border-line p-8 text-center text-[12px] text-muted">
            No live bets. Blueprint the first one above.
          </div>
        )}
      </div>
    </div>
  );
}

// ── 4 · The Months — stagger the finish lines on purpose ────────────────────
function MonthsStep() {
  const { data, updateInitiative } = useVertical();
  const items: TimelineItem[] = data.initiatives
    .filter((i) => i.status === "active")
    .map((i) => {
      const domain = domainById(data, i.domainId);
      return {
        id: i.id,
        label: i.name,
        color: domain?.color ?? "var(--accent)",
        start: i.startDate,
        end: i.targetDate,
        progress: initiativeProgress(data, i),
        onChangeDates: (start, end) => updateInitiative(i.id, { startDate: start, targetDate: end }),
      };
    });

  const undated = data.initiatives.filter((i) => i.status === "active" && !i.startDate && !i.targetDate);

  return (
    <div>
      <StepTitle title="The Months" sub="Drag the bars: target dates staggered on purpose are plans; stacked on the same month they're wishes. Projects inherit the rhythm in their own floors." />
      <div className="rounded-md border border-line bg-surface p-4">
        <Timeline items={items} />
      </div>
      {undated.length > 0 && (
        <div className="mono mt-3 text-[11px] text-muted">
          {undated.length} active bet{undated.length === 1 ? "" : "s"} without dates — set a start/target on the Initiative floor to see {undated.length === 1 ? "it" : "them"} here.
        </div>
      )}
      {data.initiatives.filter((i) => i.status === "active").length === 0 && (
        <div className="mt-3 text-[12px] text-muted italic">Nothing active to place.</div>
      )}
    </div>
  );
}

function StepTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 max-w-[680px] text-[13px] text-muted">{sub}</p>
    </div>
  );
}
