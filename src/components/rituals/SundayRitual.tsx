// Sunday — the weekly ritual. Five steps, ~15 minutes, ends with a committed
// week. Always opens looking backward at measured progress (the Gain), never
// forward at the mountain. Floors are for looking; this is for deciding.

import { useMemo, useState } from "react";
import { addDays, differenceInCalendarDays, format, parseISO, subDays } from "date-fns";
import { useVertical, currentWeekStartISO } from "../../hooks/useVertical";
import {
  domainById,
  faithfulness,
  inboxTasks,
  initiativeProgress,
  initiativeProgressAt,
  sprintMinsByDomain,
  sprintTasks,
  type Initiative,
  type VerticalData,
  type VTask,
} from "../../lib/vertical";
import { parseDateISO, todayISO } from "../../lib/dates";
import { ENERGY_META, ENERGY_ORDER } from "../../lib/energy";
import { SprintFunnel } from "../floors/SprintFloor";
import { MomentumChip } from "../floors/parts";
import { Btn } from "../ui";

const STEPS = ["The Gain", "The Sweep", "The Bets", "The Pull", "The Anchor"];

const hrs = (mins: number) => (mins / 60).toFixed(mins % 60 === 0 ? 0 : 1);

export default function SundayRitual({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [committed, setCommitted] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      {/* header: title + stepper + leave */}
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-surface px-5">
        <span className="text-[14px] font-semibold tracking-tight">Sunday</span>
        <span className="mono text-[11px] text-muted">
          week of {format(parseISO(currentWeekStartISO()), "MMM d")}
        </span>
        <div className="flex flex-1 items-center justify-center gap-5">
          {STEPS.map((s, i) => (
            <button key={s} onClick={() => !committed && setStep(i)} className="flex items-center gap-1.5">
              <span
                className="fast h-2 w-2 rounded-full"
                style={{
                  background: i === step && !committed ? "var(--accent)" : i < step || committed ? "var(--accent)" : "var(--line)",
                  opacity: i === step && !committed ? 1 : i < step || committed ? 0.45 : 1,
                  boxShadow: i === step && !committed ? "0 0 0 3px var(--accent-soft)" : "none",
                }}
              />
              <span
                className="mono hidden text-[10px] md:inline"
                style={{ color: i === step && !committed ? "var(--text)" : "var(--muted)" }}
              >
                {s}
              </span>
            </button>
          ))}
        </div>
        <button onClick={onClose} className="keycap">esc — resumes later</button>
      </header>

      {/* body */}
      <div className="floor-enter min-h-0 flex-1 overflow-y-auto px-8 py-7" key={committed ? "done" : step}>
        <div className="mx-auto max-w-[1100px]">
          {committed ? (
            <DoneState onClose={onClose} />
          ) : (
            <>
              {step === 0 && <GainStep />}
              {step === 1 && <SweepStep />}
              {step === 2 && <BetsStep />}
              {step === 3 && <SprintFunnel />}
              {step === 4 && <AnchorStep onCommit={() => setCommitted(true)} />}
            </>
          )}
        </div>
      </div>

      {/* footer nav */}
      {!committed && (
        <footer className="flex h-12 shrink-0 items-center justify-between border-t border-line bg-surface px-5">
          <Btn onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            ‹ back
          </Btn>
          <span className="mono text-[10px] text-muted">{step + 1} / {STEPS.length} · {STEPS[step]}</span>
          {step < STEPS.length - 1 ? (
            <Btn kind="primary" onClick={() => setStep((s) => s + 1)}>next ›</Btn>
          ) : (
            <span className="mono text-[10px] text-muted">commit above ↑</span>
          )}
        </footer>
      )}
    </div>
  );
}

// ── Step 1 · The Gain — the last 7 days, measured from where you started ────
function GainStep() {
  const { data } = useVertical();
  const gain = useMemo(() => computeGain(data), [data]);

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
        {gain.narrator && <div className="mt-1 text-[13px] text-muted">{gain.narrator}</div>}
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

// ── Step 5 · The Anchor — place the rocks on days, set the goal, commit ──────
function AnchorStep({ onCommit }: { onCommit: () => void }) {
  const { data, planTaskFor, unplanTask, setSprintGoal, markSprintReviewed } = useVertical();
  const [goal, setGoal] = useState(data.sprintGoal ?? "");

  const weekStart = parseISO(currentWeekStartISO());
  const today = todayISO();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const committed = sprintTasks(data)
    .filter((t) => t.status !== "done")
    .sort(
      (a, b) =>
        ENERGY_ORDER.indexOf(a.energy ?? "quick") - ENERGY_ORDER.indexOf(b.energy ?? "quick") ||
        b.durationMins - a.durationMins,
    );

  const minsOn = (iso: string) =>
    committed.filter((t) => t.doDate === iso).reduce((s, t) => s + t.durationMins, 0);

  const totalMins = committed.reduce((s, t) => s + t.durationMins, 0);
  const split = sprintMinsByDomain(data);

  const commit = () => {
    if (goal.trim() !== (data.sprintGoal ?? "")) setSprintGoal(goal.trim());
    markSprintReviewed();
    onCommit();
  };

  return (
    <div>
      <StepTitle
        title="The Anchor"
        sub="Place the big rocks on days — deep work first. The rest stays in the Week pool for daily pulling. Time-block on the calendar tomorrow morning."
      />

      {/* per-day load */}
      <div className="mb-4 grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const iso = format(d, "yyyy-MM-dd");
          const mins = minsOn(iso);
          return (
            <div key={iso} className="rounded-md border border-line bg-surface px-2 py-1.5 text-center">
              <div className="mono text-[9px] text-muted">{format(d, "EEE d")}</div>
              <div className="mono text-[11px]" style={{ color: mins > 0 ? "var(--accent)" : "var(--line)" }}>
                {mins > 0 ? `${hrs(mins)}h` : "—"}
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-1">
        {committed.map((t) => (
          <AnchorRow
            key={t.id}
            task={t}
            data={data}
            days={days}
            today={today}
            onPlace={(iso) => (t.doDate === iso ? unplanTask(t.id) : planTaskFor(t.id, iso))}
          />
        ))}
        {committed.length === 0 && (
          <div className="rounded-md border border-dashed border-line p-8 text-center text-[12px] text-muted">
            Nothing committed yet — go back to the Pull.
          </div>
        )}
      </div>

      {/* the goal + the commit */}
      <div className="mt-7 rounded-md border border-line bg-surface px-5 py-4">
        <div className="section-label mb-1">This week's goal</div>
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="One line — what does a good week look like?"
          className="w-full bg-transparent text-[15px] font-medium outline-none placeholder:text-muted/60"
        />
        <div className="mono mt-2 text-[10px] text-muted">
          {hrs(totalMins)}h committed · {committed.length} tasks · {split.length} domain{split.length === 1 ? "" : "s"} · ★ {data.focusInitiativeIds.length} lead bet{data.focusInitiativeIds.length === 1 ? "" : "s"}
        </div>
        <div className="mt-3">
          <Btn kind="primary" onClick={commit}>Commit the week →</Btn>
        </div>
      </div>
    </div>
  );
}

function AnchorRow({
  task,
  data,
  days,
  today,
  onPlace,
}: {
  task: VTask;
  data: VerticalData;
  days: Date[];
  today: string;
  onPlace: (iso: string) => void;
}) {
  const domain = domainById(data, task.domainId);
  const accent = domain?.color ?? "var(--muted)";
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-1.5">
      <span className="shrink-0 text-[11px]" style={{ color: accent }} title={task.energy ?? ""}>
        {task.energy ? ENERGY_META[task.energy].icon : "·"}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px]">{task.title || "untitled"}</span>
      <span className="mono shrink-0 text-[10px] text-muted">{task.durationMins}m</span>
      <div className="flex shrink-0 gap-0.5">
        {days.map((d) => {
          const iso = format(d, "yyyy-MM-dd");
          const on = task.doDate === iso;
          const past = iso < today;
          return (
            <button
              key={iso}
              disabled={past && !on}
              onClick={() => onPlace(iso)}
              title={format(d, "EEE MMM d")}
              className="fast mono h-6 w-6 rounded-sm border text-[9px] disabled:opacity-25"
              style={{
                borderColor: on ? accent : "var(--line)",
                background: on ? accent : "transparent",
                color: on ? "#fff" : "var(--muted)",
              }}
            >
              {format(d, "EEEEE")}
            </button>
          );
        })}
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
