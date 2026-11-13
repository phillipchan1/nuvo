// Summit — the quarterly flow, on the Flow layout (D-190). Inputs: the
// quarter's ledger and the standing mandates. Output: a re-affirmed set of
// domains and a decided portfolio of initiatives, rough-cut across the months.
// Four steps: Gain → Mandates → Portfolio → Months.

import { useMemo, useState } from "react";
import { subDays } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { useNarrator } from "../../hooks/useNarrator";
import {
  domainById,
  initiativeProgress,
  initiativeProgressAt,
  isOpenStatus,
  isProjectComplete,
  isProjectInFlight,
  type VerticalData,
} from "../../lib/vertical";
import { fmtHours as hrs } from "../../lib/dates";
import {
  InlineNumber,
  InlineTextarea,
  MomentumChip,
  Timeline,
  type TimelineItem,
} from "../floors/parts";
import FlowShell, { FlowHead, FlowMeter, type FlowStage } from "./FlowShell";
import { Button, Chip, Dot, EmptyState, Row, SectionHeader } from "../kit";
import { Icon } from "../Icon";
import DomainSymbol from "../domain/DomainSymbol";

const QUARTER_KEY = () => {
  const d = new Date();
  return `nuvo-summit-${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
};
const QUARTER_NAME = () => {
  const d = new Date();
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
};

export default function SummitRitual({
  step,
  setStep,
  onClose,
  onNewBet,
}: {
  step: number;
  setStep: (s: number) => void;
  onClose: () => void;
  onNewBet: () => void;
}) {
  const { data } = useVertical();
  const { back } = useAppNavigation();
  const [done, setDone] = useState(false);

  const finish = () => {
    localStorage.setItem(QUARTER_KEY(), "1");
    setDone(true);
  };

  // the live outputs — each stage's one line, in the footer while you're on it
  const gain = useMemo(() => quarterGain(data), [data]);
  const active = data.initiatives.filter((i) => isProjectInFlight(i.status));
  const paused = data.initiatives.filter((i) => i.status === "waiting");
  const dated = active.filter((i) => i.startDate || i.targetDate);
  const targetSum = Math.round(data.domains.reduce((s, d) => s + d.weeklyTargetHours, 0));

  const stages: FlowStage[] = [
    {
      id: "gain",
      label: "Gain",
      value: `${hrs(gain.doneMins)}h · ${gain.shipped.length} shipped`,
      body: <QuarterGainStep />,
    },
    {
      id: "mandates",
      label: "Mandates",
      value: `${data.domains.length} mandates · ${targetSum}h/wk`,
      body: <MandatesStep />,
    },
    {
      id: "portfolio",
      label: "Portfolio",
      value: `${active.length} live · ${paused.length} paused`,
      body: <PortfolioStep onNewBet={onNewBet} />,
    },
    {
      id: "months",
      label: "Months",
      value: `${dated.length} of ${active.length} dated`,
      body: <MonthsStep />,
    },
  ];

  return (
    <FlowShell
      title="Summit"
      sub="the quarter, decided"
      inputs={{ label: "the season", value: `${QUARTER_NAME()} · ${data.domains.length} domains` }}
      output={{
        label: "the quarter",
        value: done ? `${active.length} initiatives sealed` : `${active.length} initiatives in play`,
        reached: done,
      }}
      stages={stages}
      step={step}
      setStep={setStep}
      onStepBack={back}
      finished={
        done ? (
          <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 text-center">
            <FlowHead
              align="center"
              kicker={QUARTER_NAME()}
              hero="The quarter is shaped."
              fact={
                <>
                  <b>{data.domains.length}</b> mandates · <b>{active.length}</b> initiatives · <b>{dated.length}</b> dated
                </>
              }
            />
            <Button kind="primary" size="md" onClick={onClose}>
              Back to the week
            </Button>
          </div>
        ) : undefined
      }
      lastCta={{ label: "Seal the quarter", onClick: finish }}
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
  const shipped = data.initiatives.filter((i) => isProjectComplete(i.status));
  const moved = data.initiatives
    .filter((i) => isProjectInFlight(i.status))
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
    <div className="grid gap-8">
      <FlowHead
        hero="Read the quarter."
        fact={
          <>
            <b>{gain.done.length}</b> tasks done · <b>{hrs(gain.doneMins)}h</b> invested · <b>{gain.shipped.length}</b>{" "}
            initiative{gain.shipped.length === 1 ? "" : "s"} shipped
          </>
        }
      >
        {narrated && <p className="f-line mt-1">{narrated}</p>}
      </FlowHead>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section className="f-section">
          <SectionHeader title="By domain" count={data.domains.length} />
          <div className="f-rows">
            {data.domains.map((d) => {
              const target = d.weeklyTargetHours * 13;
              return (
                <div key={d.id} className="grid gap-2 px-1 py-2.5">
                  <div className="flex items-center gap-2 text-body font-medium">
                    <span style={{ color: d.color }} className="inline-flex">
                      <DomainSymbol value={d.icon} size={14} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    <span className="f-num text-caption font-normal text-muted">
                      {d.quarterHours}h of ~{Math.round(target)}h
                    </span>
                  </div>
                  <FlowMeter
                    size="sm"
                    total={Math.max(target, d.quarterHours, 1)}
                    segments={[{ key: d.id, value: d.quarterHours, color: d.color }]}
                    label={`${d.name}: ${d.quarterHours} of about ${Math.round(target)} hours`}
                  />
                </div>
              );
            })}
          </div>
        </section>

        <div className="grid content-start gap-8">
          <section className="f-section">
            <SectionHeader title="Shipped" count={gain.shipped.length} />
            {gain.shipped.length > 0 ? (
              <div className="f-rows">
                {gain.shipped.map((i) => {
                  const domain = domainById(data, i.domainId);
                  return (
                    <Row
                      key={i.id}
                      leading={<Dot color={domain?.color ?? "var(--accent)"} />}
                      title={i.name}
                      trailing={
                        <Chip tone="ok" icon={<Icon name="check" size={11} />}>
                          Shipped
                        </Chip>
                      }
                    />
                  );
                })}
              </div>
            ) : (
              <EmptyState>Nothing shipped yet</EmptyState>
            )}
          </section>

          {gain.moved.length > 0 && (
            <section className="f-section">
              <SectionHeader title="Moved" count={gain.moved.length} />
              <div className="f-rows">
                {gain.moved.slice(0, 6).map(({ initiative, from, to }) => (
                  <Row
                    key={initiative.id}
                    leading={<Dot color={domainById(data, initiative.domainId)?.color ?? "var(--accent)"} />}
                    title={initiative.name}
                    meta={
                      <span>
                        {from}% → <span style={{ color: "var(--accent-ink)" }}>{to}%</span>
                      </span>
                    }
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 2 · The Mandates — re-read every intention, re-set every target ─────────────
function MandatesStep() {
  const { data, updateDomain } = useVertical();
  const targetSum = Math.round(data.domains.reduce((s, d) => s + d.weeklyTargetHours, 0));
  return (
    <div className="grid gap-8">
      <FlowHead
        hero="Re-affirm the mandates."
        fact={
          <>
            <b>{data.domains.length}</b> domains · <b>{targetSum}h</b> a week between them
          </>
        }
      />
      <div className="f-rows" style={{ borderTop: "1px solid var(--line-1)", borderBottom: "1px solid var(--line-1)" }}>
        {data.domains.map((d) => (
          <div key={d.id} className="grid gap-1.5 px-1 py-3.5">
            <div className="flex items-center gap-2.5">
              <span
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--r-ctl)]"
                style={{ background: `color-mix(in srgb, ${d.color} 12%, transparent)`, color: d.color }}
              >
                <DomainSymbol value={d.icon} size={16} />
              </span>
              <span className="f-title min-w-0 flex-1 truncate">{d.name}</span>
              <span className="f-num hidden shrink-0 text-caption text-muted sm:inline">{d.quarterHours}h this quarter</span>
              <span className="f-num shrink-0 text-body font-medium">
                <InlineNumber value={d.weeklyTargetHours} onChange={(v) => updateDomain(d.id, { weeklyTargetHours: v })} suffix="h/wk" />
              </span>
            </div>
            <div className="pl-[38px]">
              <InlineTextarea
                value={d.intention}
                onChange={(v) => updateDomain(d.id, { intention: v })}
                placeholder="State the standing mandate…"
                className="text-body text-[var(--ink-2)]"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 3 · The Portfolio — every initiative gets a verdict; new initiatives get a blueprint ──
function PortfolioStep({ onNewBet }: { onNewBet: () => void }) {
  const { data, updateInitiative } = useVertical();
  const rows = data.initiatives.filter((i) => isOpenStatus(i.status));
  const live = rows.filter((i) => i.status !== "waiting").length;

  return (
    <div className="grid gap-8">
      <FlowHead
        hero="Decide the portfolio."
        fact={
          <>
            <b>{live}</b> live · <b>{rows.length - live}</b> paused — ship, keep, pause or drop each one
          </>
        }
      />
      <section className="f-section">
        <SectionHeader
          title="Initiatives"
          count={rows.length}
          actions={
            <Button size="xs" icon={<Icon name="plus" size={12} />} onClick={onNewBet}>
              New initiative
            </Button>
          }
        />
        {rows.length === 0 ? (
          <EmptyState>No live initiatives</EmptyState>
        ) : (
          <div className="f-rows">
            {rows.map((i) => {
              const domain = domainById(data, i.domainId);
              const pct = initiativeProgress(data, i);
              const paused = i.status === "waiting";
              const color = domain?.color ?? "var(--accent)";
              return (
                <div key={i.id} className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-1.5 px-1 py-2" style={{ opacity: paused ? 0.55 : 1 }}>
                  <Dot color={color} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-body font-medium">{i.name}</div>
                    <div className="truncate text-caption text-muted">
                      {domain?.name}
                      {i.outcome && ` · ${i.outcome}`}
                    </div>
                  </div>
                  <div className="hidden w-[120px] shrink-0 sm:block">
                    <FlowMeter size="sm" total={100} segments={[{ key: i.id, value: pct, color }]} label={`${pct}% done`} />
                  </div>
                  <span className="f-num w-9 shrink-0 text-right text-caption text-muted">{pct}%</span>
                  <MomentumChip value={i.momentum} onChange={(m) => updateInitiative(i.id, { momentum: m })} />
                  <div className="flex shrink-0 items-center gap-1">
                    {paused ? (
                      <Button size="xs" onClick={() => updateInitiative(i.id, { status: "in_progress" })}>
                        Resume
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="xs"
                          icon={<Icon name="check" size={12} />}
                          onClick={() => updateInitiative(i.id, { status: "complete" })}
                          title="Done — onto the trophy shelf"
                        >
                          Ship
                        </Button>
                        <Button size="xs" kind="ghost" onClick={() => updateInitiative(i.id, { status: "waiting" })}>
                          Pause
                        </Button>
                        <Button size="xs" kind="ghost" className="f-danger" onClick={() => updateInitiative(i.id, { status: "cancelled" })}>
                          Drop
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ── 4 · The Months — stagger the finish lines on purpose ────────────────────
function MonthsStep() {
  const { data, updateInitiative } = useVertical();
  const inFlight = data.initiatives.filter((i) => isProjectInFlight(i.status));
  const items: TimelineItem[] = inFlight.map((i) => {
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
  const dated = inFlight.filter((i) => i.startDate || i.targetDate).length;

  return (
    <div className="grid gap-8">
      <FlowHead
        hero="Stagger the finish lines."
        fact={
          <>
            <b>{dated}</b> of <b>{inFlight.length}</b> dated — drag the bars; the undated wait in the tray
          </>
        }
      />
      {inFlight.length === 0 ? <EmptyState>Nothing in flight</EmptyState> : <Timeline items={items} defaultZoom="quarter" persistKey="summit-months" />}
    </div>
  );
}

