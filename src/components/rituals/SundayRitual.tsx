// Sunday — the weekly ritual. Five steps, ~15 minutes, ends with a committed
// week. Always opens looking backward at measured progress (the Gain), never
// forward at the mountain. Floors are for looking; this is for deciding.

import { useMemo, useState } from "react";
import { addDays, differenceInCalendarDays, format, parseISO, subDays } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import {
  domainById,
  faithfulness,
  inboxTasks,
  initiativeProgress,
  initiativeProgressAt,
  sprintLoadMins,
  sprintMinsByDomain,
  sprintTasks,
  taskDomainColor,
  type Initiative,
  type VerticalData,
} from "../../lib/vertical";
import { fmtHours as hrs, parseDateISO, planningWeekStartISO, todayISO } from "../../lib/dates";
import { CONTEXT_META, composeWeek, fmtSlot, type ComposeResult, type DayContext, type Placement } from "../../lib/compose";
import { calibrate, confidence, weeklyBudgetMins } from "../../lib/calibration";
import { useSettings } from "../../hooks/useSettings";
import { useNarrator } from "../../hooks/useNarrator";
import { useExternalEvents } from "../../hooks/useCalendar";
import { useScheduledTasks, useSprintTasks } from "../../hooks/useTasks";
import { SprintFunnel } from "../floors/SprintFloor";
import { MomentumChip } from "../floors/parts";
import FlowShell, { type FlowStage } from "./FlowShell";
import { Btn } from "../ui";

const CONTEXT_CYCLE_GLYPHS: Record<string, string> = { light: "◐", travel: "✈", off: "—" };

const fmtHM = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

export default function SundayRitual({ onClose }: { onClose: () => void }) {
  const { data } = useVertical();
  const { settings } = useSettings();
  const [step, setStep] = useState(0);
  const [committed, setCommitted] = useState(false);

  const weekStartISO = planningWeekStartISO();

  // header pipeline reads — same query keys as the Compose station, so the
  // cache is shared and the canvas preloads the whole flow on open
  const range = useMemo(() => {
    const start = parseDateISO(weekStartISO);
    return { start: start.toISOString(), end: addDays(start, 7).toISOString() };
  }, [weekStartISO]);
  const { data: events = [] } = useExternalEvents(range.start, range.end);
  const { data: blocks = [] } = useScheduledTasks(range.start, range.end);
  const { data: weekTasks = [] } = useSprintTasks(data.sprint?.id ?? null);

  const gain = useMemo(() => computeGain(data), [data]);
  const inboxCount = inboxTasks(data).length;
  const loadMins = sprintLoadMins(data);
  const pool = weekTasks.filter((t) => t.status !== "done" && !t.start_time);
  const onCal = blocks.filter((b) => b.status !== "done");
  const onCalMins = onCal.reduce((s, b) => s + (b.duration_minutes ?? 30), 0);
  const eventCount = events.filter((e) => e.busy && !e.all_day).length;
  const workStart = settings?.work_start_minutes ?? 480;
  const workEnd = settings?.work_end_minutes ?? 990;
  const weekEndISO = format(addDays(parseDateISO(weekStartISO), 7), "yyyy-MM-dd");
  const shapedDays = Object.entries(data.sprint?.day_contexts ?? {})
    .filter(([iso, c]) => iso >= weekStartISO && iso < weekEndISO && c !== "normal")
    .map(([, c]) => CONTEXT_CYCLE_GLYPHS[c] ?? "")
    .join("");

  const stages: FlowStage[] = [
    {
      id: "gain",
      label: "The Gain",
      value: `${gain.doneCount} done · ${hrs(gain.doneMins)}h`,
      body: <GainStep gain={gain} />,
    },
    {
      id: "sweep",
      label: "The Sweep",
      value: inboxCount === 0 ? "inbox zero ✓" : `${inboxCount} to route`,
      body: <SweepStep />,
    },
    {
      id: "bets",
      label: "The Bets",
      value: `★ ${data.focusInitiativeIds.length}/3 leads`,
      body: <BetsStep />,
    },
    {
      id: "pull",
      label: "The Pull",
      value: loadMins > 0 ? `${hrs(loadMins)}h committed` : "nothing pulled",
      body: (
        <div>
          <StepTitle title="The Pull" sub="Fill the week from the sources — capacity and domain balance keep you honest." />
          <SprintFunnel />
        </div>
      ),
    },
    {
      id: "compose",
      label: "The Compose",
      value: pool.length === 0 && loadMins > 0 ? "all placed ✓" : `${pool.length} to place`,
      body: <ComposeStep onCommit={() => setCommitted(true)} />,
    },
  ];

  return (
    <FlowShell
      title="Sunday"
      sub={`wk of ${format(parseISO(weekStartISO), "MMM d")}`}
      inputs={{
        label: "boundaries",
        value: `${eventCount} ev · ${fmtHM(workStart)}–${fmtHM(workEnd)}${shapedDays ? ` · ${shapedDays}` : ""}`,
      }}
      output={{
        label: "the week",
        value: onCal.length > 0 ? `${onCal.length} blocks · ${hrs(onCalMins)}h` : "awaiting compose",
        reached: onCal.length > 0,
      }}
      stages={stages}
      step={step}
      setStep={setStep}
      finished={committed ? <DoneState onClose={onClose} /> : undefined}
      lastHint="commit above ↑"
      onClose={onClose}
    />
  );
}

// ── Step 1 · The Gain — the last 7 days, measured from where you started ────
function GainStep({ gain }: { gain: ReturnType<typeof computeGain> }) {
  const { data } = useVertical();
  const narrated = useNarrator(
    useMemo(
      () => ({
        window: "week" as const,
        doneCount: gain.doneCount,
        doneHours: Math.round((gain.doneMins / 60) * 10) / 10,
        byDomain: gain.byDomain.map(({ domain, mins }) => ({
          name: domain.name,
          hours: Math.round((mins / 60) * 10) / 10,
          targetHours: domain.weeklyTargetHours,
        })),
        moved: gain.moved.map(({ initiative, from, to }) => ({ name: initiative.name, from, to })),
      }),
      [gain],
    ),
  );
  const narrator = narrated ?? gain.narrator;

  return (
    <div>
      <StepTitle
        title="The Gain"
        sub="The last 7 days, measured backward. The mountain can wait a minute."
      />

      <div className="mb-6 rounded-md border border-line bg-surface px-5 py-4">
        <div className="text-[16px] font-medium">
          {gain.doneCount} task{gain.doneCount === 1 ? "" : "s"} done · {hrs(gain.doneMins)}h invested
        </div>
        {narrator && <div className="mt-1 text-[13px] text-muted">{narrator}</div>}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section>
          <div className="section-label mb-2">Invested by domain</div>
          <div className="space-y-3">
            {gain.byDomain.map(({ domain, mins }) => {
              const target = domain.weeklyTargetHours * 60;
              const pct = target > 0 ? Math.min(100, (mins / target) * 100) : 0;
              const f = faithfulness(domain);
              return (
                <div key={domain.id}>
                  <div className="flex items-baseline justify-between text-[12px]">
                    <span className="flex items-center gap-1.5">
                      <span style={{ color: domain.color }}>{domain.icon}</span> {domain.name}
                      {!f.lit && <span className="mono text-[9px] text-signal">{f.note}</span>}
                    </span>
                    <span className="mono text-[10px] text-muted">
                      {hrs(mins)} / {domain.weeklyTargetHours}h
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-surface">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: domain.color }} />
                  </div>
                </div>
              );
            })}
            {gain.byDomain.length === 0 && (
              <div className="text-[12px] text-muted italic">No completed blocks in the window yet.</div>
            )}
          </div>
        </section>

        <section>
          <div className="section-label mb-2">Initiatives that moved</div>
          <div className="space-y-2">
            {gain.moved.map(({ initiative, from, to }) => {
              const domain = domainById(data, initiative.domainId);
              return (
                <div key={initiative.id} className="flex items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: domain?.color }} />
                  <span className="min-w-0 flex-1 truncate text-[12px]">{initiative.name}</span>
                  <span className="mono shrink-0 text-[11px]" style={{ color: "var(--accent)" }}>
                    {from}% → {to}%
                  </span>
                </div>
              );
            })}
            {gain.moved.length === 0 && (
              <div className="text-[12px] text-muted italic">No initiative moved this week — worth noticing, not punishing.</div>
            )}
          </div>

          {gain.krs.length > 0 && (
            <>
              <div className="section-label mb-2 mt-6">Key results, from the baseline</div>
              <div className="space-y-1.5">
                {gain.krs.map(({ initiative, kr }) => (
                  <div key={kr.id} className="mono flex items-center gap-2 text-[11px] text-muted">
                    <span className="min-w-0 flex-1 truncate">{initiative.name} · {kr.name}</span>
                    <span>
                      {kr.baseline} → <span style={{ color: "var(--accent)" }}>{kr.current}</span> → {kr.target}{kr.unit}
                    </span>
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

function computeGain(data: VerticalData) {
  const cutoff = subDays(new Date(), 7);
  const done = data.tasks.filter(
    (t) => t.status === "done" && t.completedAt && new Date(t.completedAt) >= cutoff,
  );
  const doneMins = done.reduce((s, t) => s + t.durationMins, 0);

  const byDomain = data.domains
    .map((domain) => ({
      domain,
      mins: done.filter((t) => t.domainId === domain.id).reduce((s, t) => s + t.durationMins, 0),
    }))
    .filter((x) => x.mins > 0 || x.domain.weeklyTargetHours > 0);

  const moved = data.initiatives
    .filter((i) => i.status === "active")
    .map((initiative) => ({
      initiative,
      from: initiativeProgressAt(data, initiative, cutoff),
      to: initiativeProgress(data, initiative),
    }))
    .filter((x) => x.to > x.from)
    .sort((a, b) => b.to - b.from - (a.to - a.from))
    .slice(0, 5);

  const krs = data.initiatives
    .filter((i) => i.status === "active")
    .flatMap((initiative) => initiative.keyResults.map((kr) => ({ initiative, kr })))
    .filter(({ kr }) => kr.current !== kr.baseline)
    .slice(0, 6);

  const top = moved[0];
  const narrator = top
    ? `Measured from where you started: ${top.initiative.name} is ${top.to}% of the way there — up ${top.to - top.from} points this week.`
    : done.length > 0
      ? "Hours went in and they count, even where the percentages held still."
      : null;

  return { doneCount: done.length, doneMins, byDomain, moved, krs, narrator };
}

// ── Step 2 · The Sweep — inbox to zero, routed into the vertical ────────────
type PickerKind = "project" | "initiative" | "domain" | null;

function SweepStep() {
  const { data, routeTask, deleteTask } = useVertical();
  const inbox = inboxTasks(data);
  const [startCount] = useState(inbox.length);
  const [picker, setPicker] = useState<PickerKind>(null);
  const current = inbox[0] ?? null;

  if (!current) {
    return (
      <div>
        <StepTitle title="The Sweep" sub="Every loose capture, routed — to a backlog, the week, or the bin." />
        <div className="rounded-md border border-dashed border-line p-10 text-center">
          <div className="text-[15px] font-medium">Inbox zero.</div>
          <div className="mono mt-1 text-[11px] text-muted">
            {startCount > 0 ? `${startCount} capture${startCount === 1 ? "" : "s"} routed.` : "Nothing was waiting."} Next: the bets.
          </div>
        </div>
      </div>
    );
  }

  const route = (dest: Parameters<typeof routeTask>[1]) => {
    routeTask(current.id, dest);
    setPicker(null);
  };

  return (
    <div>
      <StepTitle
        title="The Sweep"
        sub="One at a time. Nothing is forced onto a date — most things just need a home."
      />
      <div className="mx-auto max-w-[640px]">
        <div className="mono mb-2 text-[10px] text-muted">
          {startCount - inbox.length} routed · {inbox.length} to go
        </div>
        <div className="rounded-md border border-line bg-surface px-4 py-3 text-[15px] font-medium">
          {current.title || "untitled"}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Btn kind="primary" onClick={() => route({ toWeek: true })}>★ This week</Btn>
          <Btn onClick={() => setPicker(picker === "project" ? null : "project")}>→ project…</Btn>
          <Btn onClick={() => setPicker(picker === "initiative" ? null : "initiative")}>→ initiative…</Btn>
          <Btn onClick={() => setPicker(picker === "domain" ? null : "domain")}>someday…</Btn>
          <Btn kind="signal" onClick={() => deleteTask(current.id)}>trash</Btn>
        </div>

        {picker && (
          <div className="mt-3 max-h-[40vh] overflow-y-auto rounded-md border border-line bg-surface p-2">
            {picker === "project" &&
              data.projects
                .filter((p) => p.status !== "done")
                .map((p) => {
                  const domain = domainById(data, p.domainId);
                  return (
                    <PickerRow key={p.id} color={domain?.color} label={p.name} sub={domain?.name}
                      onPick={() => route({ projectId: p.id })} />
                  );
                })}
            {picker === "initiative" &&
              data.initiatives
                .filter((i) => i.status === "active" || i.status === "paused")
                .map((i) => {
                  const domain = domainById(data, i.domainId);
                  return (
                    <PickerRow key={i.id} color={domain?.color} label={i.name} sub={domain?.name}
                      onPick={() => route({ initiativeId: i.id })} />
                  );
                })}
            {picker === "domain" &&
              data.domains.map((d) => (
                <PickerRow key={d.id} color={d.color} label={`${d.icon} ${d.name}`} sub="someday / loose"
                  onPick={() => route({ domainId: d.id })} />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PickerRow({ color, label, sub, onPick }: { color?: string; label: string; sub?: string; onPick: () => void }) {
  return (
    <button onClick={onPick} className="fast flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left hover:bg-bg">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color ?? "var(--line)" }} />
      <span className="min-w-0 flex-1 truncate text-[12px]">{label}</span>
      {sub && <span className="mono shrink-0 text-[9px] text-muted">{sub}</span>}
    </button>
  );
}

// ── Step 3 · The Bets — pick ≤3 leads; stalled bets demand a verdict ─────────
function BetsStep() {
  const { data, setFocusInitiatives, updateInitiative } = useVertical();
  const leads = data.focusInitiativeIds;
  const cutoff = useMemo(() => subDays(new Date(), 7), []);

  const rows = data.initiatives.filter((i) => i.status === "active" || i.status === "paused");

  const toggleLead = (id: string) => {
    if (leads.includes(id)) setFocusInitiatives(leads.filter((x) => x !== id));
    else if (leads.length < 3) setFocusInitiatives([...leads, id]);
  };

  return (
    <div>
      <StepTitle
        title="The Bets"
        sub={`Pick up to three lead initiatives for the week (${leads.length}/3). Stalled bets get a verdict — commit, pause, or drop. No zombies.`}
      />
      <div className="space-y-1.5">
        {rows.map((i) => (
          <BetRow
            key={i.id}
            initiative={i}
            data={data}
            cutoff={cutoff}
            lead={leads.includes(i.id)}
            leadFull={leads.length >= 3}
            onToggleLead={() => toggleLead(i.id)}
            onUpdate={(patch) => updateInitiative(i.id, patch)}
          />
        ))}
        {rows.length === 0 && (
          <div className="rounded-md border border-dashed border-line p-8 text-center text-[12px] text-muted">
            No active initiatives. Start a bet on the Initiative floor (⌘4) — or keep the week light.
          </div>
        )}
      </div>
    </div>
  );
}

function BetRow({
  initiative,
  data,
  cutoff,
  lead,
  leadFull,
  onToggleLead,
  onUpdate,
}: {
  initiative: Initiative;
  data: VerticalData;
  cutoff: Date;
  lead: boolean;
  leadFull: boolean;
  onToggleLead: () => void;
  onUpdate: (patch: Partial<Initiative>) => void;
}) {
  const domain = domainById(data, initiative.domainId);
  const paused = initiative.status === "paused";
  const from = initiativeProgressAt(data, initiative, cutoff);
  const to = initiativeProgress(data, initiative);
  const stalled = !paused && to === from && initiative.momentum !== "up";
  const daysLeft = initiative.targetDate
    ? differenceInCalendarDays(parseDateISO(initiative.targetDate), new Date())
    : null;

  return (
    <div
      className="flex items-center gap-3 rounded-md border bg-surface px-3.5 py-2.5"
      style={{ borderColor: lead ? "var(--signal)" : "var(--line)", opacity: paused ? 0.55 : 1 }}
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: domain?.color }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{initiative.name}</div>
        <div className="mono truncate text-[9px] text-muted">
          {domain?.name}
          {initiative.outcome && ` · ${initiative.outcome}`}
        </div>
      </div>

      {stalled && (
        <span className="mono shrink-0 rounded-full border border-signal px-2 py-0.5 text-[9px] text-signal">
          stalled — commit, pause, or drop
        </span>
      )}

      <span className="mono shrink-0 text-[11px]" style={{ color: to > from ? "var(--accent)" : "var(--muted)" }}>
        {to > from ? `${from}%→${to}%` : `${to}%`}
      </span>

      {daysLeft != null && (
        <span className="mono shrink-0 text-[10px]" style={{ color: daysLeft < 14 ? "var(--signal)" : "var(--muted)" }}>
          {daysLeft >= 0 ? `${daysLeft}d left` : `${-daysLeft}d over`}
        </span>
      )}

      <MomentumChip value={initiative.momentum} onChange={(m) => onUpdate({ momentum: m })} />

      {paused ? (
        <Btn onClick={() => onUpdate({ status: "active" })}>resume</Btn>
      ) : (
        <>
          <button
            onClick={onToggleLead}
            disabled={!lead && leadFull}
            title={lead ? "Remove lead" : leadFull ? "Three leads already" : "Make this a lead bet"}
            className="fast mono shrink-0 rounded-sm border px-2 py-1 text-[10px] disabled:opacity-30"
            style={{
              borderColor: lead ? "var(--signal)" : "var(--line)",
              color: lead ? "var(--signal)" : "var(--muted)",
              background: lead ? "var(--signal-soft)" : "transparent",
            }}
          >
            ★ lead
          </button>
          <Btn onClick={() => onUpdate({ status: "paused" })}>pause</Btn>
          <Btn kind="signal" onClick={() => onUpdate({ status: "dropped" })}>drop</Btn>
        </>
      )}
    </div>
  );
}

// ── Step 5 · The Compose — boundaries in, a time-blocked week out ───────────
const CONTEXT_CYCLE: DayContext[] = ["normal", "light", "travel", "off"];

function ComposeStep({ onCommit }: { onCommit: () => void }) {
  const { data, applySchedule, setSprintGoal, setDayContexts, markSprintReviewed } = useVertical();
  const { settings, update: updateSettings } = useSettings();
  const [goal, setGoal] = useState(data.sprintGoal ?? "");
  const [result, setResult] = useState<ComposeResult | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [applying, setApplying] = useState(false);

  const weekStartISO = planningWeekStartISO();
  const today = todayISO();

  // boundaries: per-day contexts (where you are shapes what the day holds)
  const dayContexts = (data.sprint?.day_contexts ?? {}) as Record<string, DayContext>;
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => format(addDays(parseDateISO(weekStartISO), i), "yyyy-MM-dd")),
    [weekStartISO],
  );
  const cycleContext = (iso: string) => {
    const cur = dayContexts[iso] ?? "normal";
    const next = CONTEXT_CYCLE[(CONTEXT_CYCLE.indexOf(cur) + 1) % CONTEXT_CYCLE.length];
    setDayContexts({ ...dayContexts, [iso]: next });
    setResult(null); // boundaries changed — recompose
  };

  // calibration: history corrects the plan
  const cal = useMemo(() => calibrate(data.tasks), [data.tasks]);
  const budget = weeklyBudgetMins(cal);

  // the boundaries: the planning week's immovable calendar + working hours
  const range = useMemo(() => {
    const start = parseDateISO(weekStartISO);
    return { start: start.toISOString(), end: addDays(start, 7).toISOString() };
  }, [weekStartISO]);
  const { data: events = [] } = useExternalEvents(range.start, range.end);
  const { data: blocks = [] } = useScheduledTasks(range.start, range.end);
  const { data: weekTasks = [] } = useSprintTasks(data.sprint?.id ?? null);

  const pool = weekTasks.filter((t) => t.status !== "done" && !t.start_time);
  const workStart = settings?.work_start_minutes ?? 480;
  const workEnd = settings?.work_end_minutes ?? 990;

  // hours already blocked on the week count against the proven pace
  const blockedMins = blocks
    .filter((b) => b.status !== "done")
    .reduce((s, b) => s + (b.duration_minutes ?? 30), 0);

  const compose = () => {
    setResult(
      composeWeek({
        weekStartISO,
        todayISO: today,
        now: new Date(),
        tasks: pool,
        events,
        blocks: blocks.filter((b) => b.status !== "done"),
        workStartMin: workStart,
        workEndMin: workEnd,
        focusInitiativeIds: data.focusInitiativeIds,
        dayContexts,
        weeklyBudgetMins: budget != null ? Math.max(0, budget - blockedMins) : null,
      }),
    );
    setAccepted(false);
  };

  // confidence: the plan vs the proven pace (already-blocked week included)
  const plannedMins = (result?.placements.reduce((s, p) => s + p.durationMin, 0) ?? 0) + blockedMins;
  const conf = result && cal ? confidence(plannedMins, cal) : null;

  const accept = async () => {
    if (!result) return;
    setApplying(true);
    await applySchedule(
      result.placements.map((p) => {
        const [y, m, d] = p.dayISO.split("-").map(Number);
        return {
          id: p.task.id,
          doDateISO: p.dayISO,
          startISO: new Date(y, m - 1, d, Math.floor(p.startMin / 60), p.startMin % 60).toISOString(),
        };
      }),
    );
    setApplying(false);
    setAccepted(true);
  };

  const commit = () => {
    if (goal.trim() !== (data.sprintGoal ?? "")) setSprintGoal(goal.trim());
    markSprintReviewed();
    onCommit();
  };

  const toMinLabel = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const setWork = (key: "work_start_minutes" | "work_end_minutes") => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) return;
    const [h, mm] = e.target.value.split(":").map(Number);
    updateSettings({ [key]: h * 60 + mm });
    setResult(null); // boundaries changed — recompose
  };

  const eventCount = events.filter((e) => e.busy && !e.all_day).length;
  const byDay = useMemo(() => {
    const m = new Map<string, Placement[]>();
    result?.placements.forEach((p) => {
      if (!m.has(p.dayISO)) m.set(p.dayISO, []);
      m.get(p.dayISO)!.push(p);
    });
    return m;
  }, [result]);

  return (
    <div>
      <StepTitle
        title="The Compose"
        sub="Boundaries in — your calendar, your working hours. One output: a time-blocked week. You stay high-vision; the deciding-where is done for you."
      />

      {/* the boundaries bar */}
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-line bg-surface px-4 py-3">
        <span className="section-label">Boundaries</span>
        <label className="mono flex items-center gap-1.5 text-[11px] text-muted">
          working hours
          <input type="time" step={900} value={toMinLabel(workStart)} onChange={setWork("work_start_minutes")}
            className="border border-line bg-bg px-1.5 py-0.5 text-[11px] outline-none focus:border-accent" />
          –
          <input type="time" step={900} value={toMinLabel(workEnd)} onChange={setWork("work_end_minutes")}
            className="border border-line bg-bg px-1.5 py-0.5 text-[11px] outline-none focus:border-accent" />
        </label>
        <span className="mono text-[11px] text-muted">{eventCount} immovable event{eventCount === 1 ? "" : "s"}</span>
        <span className="mono text-[11px] text-muted">{pool.length} committed to place</span>
        <div className="flex-1" />
        <Btn kind="primary" onClick={compose}>✦ {result ? "recompose" : "compose the week"}</Btn>

        {/* day contexts: click to cycle normal → light → travel → off */}
        <div className="flex w-full items-center gap-1.5 border-t border-line pt-2.5">
          <span className="mono text-[10px] text-muted">days</span>
          {weekDays.map((iso) => {
            const ctx = dayContexts[iso] ?? "normal";
            const past = iso < today;
            const meta = CONTEXT_META[ctx];
            return (
              <button
                key={iso}
                disabled={past}
                onClick={() => cycleContext(iso)}
                title={`${format(parseDateISO(iso), "EEEE")} — ${meta.label} (click to change)`}
                className="fast mono flex-1 rounded-sm border px-1 py-1 text-[10px] disabled:opacity-25"
                style={{
                  borderColor: ctx === "normal" ? "var(--line)" : "var(--accent)",
                  color: ctx === "normal" ? "var(--muted)" : "var(--accent)",
                  background: ctx === "normal" ? "transparent" : "var(--accent-soft)",
                }}
              >
                {format(parseDateISO(iso), "EEEEE")} {meta.glyph}
              </button>
            );
          })}
          <span className="mono hidden text-[9px] text-muted xl:inline">· normal ◐ light ✈ travel — off</span>
        </div>
      </div>

      {/* the confidence read: this plan vs your proven pace */}
      {result && (
        <div className="mb-5 rounded-md border border-line bg-surface px-4 py-3">
          {cal && conf ? (
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span
                className="text-[13px] font-medium"
                style={{ color: conf.label === "stretch" ? "var(--signal)" : "var(--accent)" }}
              >
                {conf.pct}% confidence · {conf.label}
              </span>
              <span className="text-[12px] text-muted">
                {hrs(plannedMins)}h planned · you've completed ~{hrs(cal.avgWeeklyDoneMins)}h/wk over the last{" "}
                {cal.weeksSampled} week{cal.weeksSampled === 1 ? "" : "s"}
                {conf.deltaMins > 30 && <> — consider trimming ~{hrs(conf.deltaMins)}h</>}
              </span>
              {cal.deepMorningShare != null && (
                <span className="mono text-[10px] text-muted">
                  {Math.round(cal.deepMorningShare * 100)}% of your deep work really lands before 1pm
                </span>
              )}
              {cal.rollRates.map((r) => (
                <span key={r.energy} className="mono text-[10px] text-signal">
                  {r.energy} tasks roll {r.avgRolls}× before done — prep or shrink them
                </span>
              ))}
            </div>
          ) : (
            <span className="mono text-[11px] text-muted">
              No confidence read yet — it arrives after a week or two of completed blocks, measured from your own history.
            </span>
          )}
        </div>
      )}

      {!result && (
        <div className="rounded-md border border-dashed border-line p-10 text-center text-[12px] text-muted">
          {pool.length === 0
            ? "Nothing left to place — everything committed is already on the calendar."
            : "Compose proposes morning deep work, batched small tasks, breathers after long blocks, deadlines first — inside your boundaries. Nothing lands until you accept."}
        </div>
      )}

      {result && (
        <>
          {/* per-day load strip */}
          <div className="mb-4 grid grid-cols-7 gap-1.5">
            {result.days.map((d) => (
              <div key={d.dayISO} className="rounded-md border border-line bg-surface px-2 py-1.5 text-center">
                <div className="mono text-[9px] text-muted">
                  {d.label}
                  {d.context !== "normal" && <span className="ml-1 text-accent">{CONTEXT_META[d.context].glyph}</span>}
                </div>
                <div className="mono text-[11px]" style={{ color: d.placedMins > 0 ? "var(--accent)" : "var(--line)" }}>
                  {d.placedMins > 0 ? `${hrs(d.placedMins)}h` : "—"}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            {[...byDay.entries()].map(([dayISO, ps]) => (
              <div key={dayISO} className="rounded-md border border-line bg-surface">
                <div className="mono border-b border-line px-3 py-1.5 text-[10px] font-medium text-muted">
                  {format(parseDateISO(dayISO), "EEEE MMM d")}
                </div>
                <div className="px-3 py-1">
                  {ps.map((p) => (
                    <div key={p.task.id} className="group flex items-center gap-2.5 border-b border-line py-1.5 last:border-0">
                      <span className="mono w-[104px] shrink-0 text-[10px] text-muted">{fmtSlot(p)}</span>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: taskDomainColor(data, p.task) ?? "var(--line)" }} />
                      <span className="min-w-0 flex-1 truncate text-[12px]">{p.task.title}</span>
                      <span className="mono hidden shrink-0 truncate text-[9px] text-muted lg:inline" style={{ maxWidth: 240 }}>{p.reason}</span>
                      <button
                        onClick={() => setResult((r) => r && { ...r, placements: r.placements.filter((x) => x.task.id !== p.task.id) })}
                        className="fast shrink-0 text-[12px] text-muted opacity-0 hover:text-signal group-hover:opacity-100"
                        title="Leave in the week pool instead"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {result.unplaced.length > 0 && (
            <div className="mt-4 rounded-md border border-dashed border-line px-4 py-3">
              <div className="section-label mb-1.5">Left in the pool ({result.unplaced.length})</div>
              {result.unplaced.map(({ task, reason }) => (
                <div key={task.id} className="flex items-center gap-2 text-[11px] text-muted">
                  <span className="min-w-0 truncate">{task.title}</span>
                  <span className="mono shrink-0 text-[9px]">{reason}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4">
            {accepted ? (
              <span className="text-[12px]" style={{ color: "var(--accent)" }}>✓ {result.placements.length} blocks on the calendar — drag-tune them any time.</span>
            ) : (
              <Btn kind="primary" onClick={() => void accept()} disabled={applying || result.placements.length === 0}>
                {applying ? "placing…" : `accept ${result.placements.length} blocks → calendar`}
              </Btn>
            )}
          </div>
        </>
      )}

      {/* the goal + the commit */}
      <div className="mt-7 rounded-md border border-line bg-surface px-5 py-4">
        <div className="section-label mb-1">This week's goal</div>
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="One line — what does a good week look like?"
          className="w-full bg-transparent text-[15px] font-medium outline-none placeholder:text-muted/60"
        />
        <div className="mt-3">
          <Btn kind="primary" onClick={commit}>Commit the week →</Btn>
        </div>
      </div>
    </div>
  );
}

// ── done ─────────────────────────────────────────────────────────────────────
function DoneState({ onClose }: { onClose: () => void }) {
  const { data } = useVertical();
  const committed = sprintTasks(data).filter((t) => t.status !== "done");
  const totalMins = committed.reduce((s, t) => s + t.durationMins, 0);
  const split = sprintMinsByDomain(data);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="max-w-[460px] text-center">
        <div className="text-[22px] font-semibold tracking-tight">Your week is set.</div>
        {data.sprintGoal && <div className="mt-2 text-[14px] text-muted">“{data.sprintGoal}”</div>}
        <div className="mono mt-3 text-[11px] text-muted">
          {hrs(totalMins)}h committed · {committed.length} tasks · {split.length} domain{split.length === 1 ? "" : "s"} · ★ {data.focusInitiativeIds.length} lead bet{data.focusInitiativeIds.length === 1 ? "" : "s"}
        </div>
        {split.length > 0 && (
          <div className="mx-auto mt-4 flex h-2 max-w-[300px] overflow-hidden rounded-full bg-surface">
            {split.map((x) => (
              <div
                key={x.domain.id}
                title={`${x.domain.name} · ${hrs(x.mins)}h`}
                style={{ width: `${(x.mins / Math.max(1, split.reduce((s, y) => s + y.mins, 0))) * 100}%`, background: x.domain.color }}
              />
            ))}
          </div>
        )}
        <div className="mt-6">
          <Btn kind="primary" onClick={onClose}>Begin the week</Btn>
        </div>
      </div>
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
