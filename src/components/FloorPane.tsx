import { useMemo, useState } from "react";
import {
  SEED,
  domainById,
  faithfulness,
  initiativeById,
  initiativesOf,
  projectById,
  projectsOf,
  tasksOf,
  type Domain,
  type KeyResult,
  type VerticalData,
} from "../lib/vertical";
import { ENERGY_META } from "../lib/energy";
import { nowContext, rankNow } from "../lib/now";
import { Btn } from "./ui";
import type { Focus, Rung } from "./AppShell";

const data: VerticalData = SEED;

export default function FloorPane({
  rung,
  focus,
  focusDomain,
  focusInitiative,
  focusProject,
  goRung,
}: {
  rung: Rung;
  focus: Focus;
  focusDomain: (id: string) => void;
  focusInitiative: (id: string) => void;
  focusProject: (id: string) => void;
  goRung: (r: Rung) => void;
}) {
  const domain = domainById(data, focus.domainId);
  const accent = domain?.color ?? "var(--accent)";

  const crumbs: { rung: Rung; label: string }[] = [
    { rung: "domain", label: domain?.name ?? "Domain" },
    { rung: "initiative", label: initiativeById(data, focus.initiativeId)?.name ?? "Initiative" },
    { rung: "project", label: projectById(data, focus.projectId)?.name ?? "Project" },
  ];

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-5">
        {crumbs.map((c, i) => (
          <span key={c.rung} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted">›</span>}
            <button
              onClick={() => goRung(c.rung)}
              className="fast mono text-[11px] hover:text-ink"
              style={{ color: c.rung === rung ? accent : "var(--muted)", fontWeight: c.rung === rung ? 500 : 400 }}
            >
              {c.label}
            </button>
          </span>
        ))}
        <div className="flex-1" />
        <button onClick={() => goRung("day")} className="mono text-[11px] text-muted hover:text-ink">day ↓</button>
      </div>

      <div key={rung} className="floor-enter min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {rung === "now" && <NowFloor onOpenDay={() => goRung("day")} />}
        {rung === "project" && <ProjectFloor focus={focus} accent={accent} onUp={() => goRung("initiative")} />}
        {rung === "initiative" && (
          <InitiativeFloor
            focus={focus}
            accent={accent}
            onUp={() => goRung("domain")}
            onProject={(id) => { focusProject(id); goRung("project"); }}
          />
        )}
        {rung === "domain" && (
          <DomainFloor focus={focus} onSwitchDomain={focusDomain} onInitiative={(id) => { focusInitiative(id); goRung("initiative"); }} />
        )}
      </div>
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────
function Bar({ pct, color, baseline }: { pct: number; color: string; baseline?: number }) {
  return (
    <div className="relative my-1.5 h-1.5 rounded-full bg-bg">
      <div className="absolute left-0 top-0 bottom-0 rounded-full" style={{ width: `${pct}%`, background: color }} />
      {baseline != null && (
        <div className="absolute top-[-2px] bottom-[-2px] w-px bg-muted" style={{ left: `${baseline}%` }} />
      )}
    </div>
  );
}

function Hook({ dir, label, onClick }: { dir: "up" | "down"; label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} className="fast mono text-[10px] text-muted hover:text-ink disabled:cursor-default">
      {dir === "up" ? "↑" : "↓"} {label}
    </button>
  );
}

// ── Now — the intelligent recommendation ─────────────────────────────────────
function NowFloor({ onOpenDay }: { onOpenDay: () => void }) {
  const ctx = useMemo(() => nowContext(new Date()), []);
  const suggestions = useMemo(() => rankNow(data, ctx), [ctx]);
  const [idx, setIdx] = useState(0);
  const [state, setState] = useState<"choose" | "focus" | "done">("choose");
  const top = suggestions[idx];
  if (!top) return <div className="text-[13px] text-muted">Nothing ready — inbox zero.</div>;

  return (
    <div className="mx-auto max-w-[560px]">
      <div className="mb-5 flex flex-wrap gap-x-5 gap-y-2 border-b border-line pb-4">
        {data.domains.map((d) => {
          const f = faithfulness(d);
          return (
            <div key={d.id} className="flex items-center gap-2" style={{ opacity: f.lit ? 1 : 0.45 }}>
              <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
              <div className="leading-tight">
                <div className="text-[11px]">{d.name}</div>
                <div className="mono text-[9px] text-muted">{f.note}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mono mb-1 text-[10px] text-muted">{ctx.clockLabel} · {ctx.gapLabel}</div>

      {state === "choose" && (
        <>
          <div className="border p-4" style={{ borderColor: top.domain?.color, borderWidth: 1.5 }}>
            <div className="section-label mb-1.5">Right now</div>
            <div className="text-[18px] font-medium">{top.task.title}</div>
            {top.initiative && (
              <div className="mono mt-0.5 text-[11px]" style={{ color: top.domain?.color }}>
                {top.domain?.name} · {top.initiative.name}
              </div>
            )}
            <div className="mt-3 space-y-1">
              {top.reasons.map((r, i) => (
                <div key={i} className="flex items-center gap-2.5 text-[12px] text-muted">
                  <span style={{ color: top.domain?.color }}>{r.glyph}</span>
                  {r.text}
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <Btn kind="primary" onClick={() => setState("focus")}>▶ start · {top.task.durationMins}m</Btn>
              <Btn onClick={() => setIdx((i) => (i + 1) % suggestions.length)}>not now</Btn>
              <Btn onClick={onOpenDay}>open day planner</Btn>
            </div>
          </div>
          <div className="mt-3 space-y-1">
            {suggestions.map((s, i) =>
              i === idx ? null : (
                <button key={s.task.id} onClick={() => setIdx(i)} className="fast block text-left text-[12px] text-muted hover:text-ink">
                  or · {s.task.title} <span className="mono text-[10px] text-line">· {s.task.durationMins}m</span>
                </button>
              ),
            )}
          </div>
        </>
      )}

      {state === "focus" && (
        <div className="border p-6 text-center" style={{ borderColor: top.domain?.color, borderWidth: 1.5 }}>
          <div className="section-label">Focusing</div>
          <div className="mt-1.5 text-[18px] font-medium">{top.task.title}</div>
          <div className="mono mt-1 text-[11px] text-muted">{top.task.durationMins}m · everything else is quiet</div>
          <div className="mt-4"><Btn kind="primary" onClick={() => setState("done")}>✓ done</Btn></div>
        </div>
      )}

      {state === "done" && (
        <div className="border border-line p-5" style={{ borderColor: top.domain?.color }}>
          <div className="text-[14px] font-medium" style={{ color: top.domain?.color }}>✓ logged as a gain</div>
          <div className="mt-2 space-y-0.5 text-[12px] text-muted">
            {top.initiative && <div>+1 → {top.initiative.name} {top.initiative.progress}% → {top.initiative.progress + 3}%</div>}
            {top.domain && <div>{top.domain.name} tended · faithful again today</div>}
          </div>
          <div className="mt-3">
            <Btn onClick={() => { setState("choose"); setIdx((i) => (i + 1) % suggestions.length); }}>what's next →</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Project — the planner + timeline ─────────────────────────────────────────
function ProjectFloor({ focus, accent, onUp }: { focus: Focus; accent: string; onUp: () => void }) {
  const project = projectById(data, focus.projectId);
  const initiative = initiativeById(data, focus.initiativeId);
  const tasks = project ? tasksOf(data, project.id) : [];
  const [note, setNote] = useState<string | null>(null);
  if (!project) return <div className="text-[13px] text-muted">No project selected.</div>;

  const barColor = (status: string) =>
    status === "done" ? "var(--muted)" : status === "blocked" ? "var(--signal)" : accent;

  return (
    <div className="mx-auto max-w-[680px]">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[17px] font-medium">{project.name}</h2>
        <div className="ml-auto flex gap-3">
          <Hook dir="up" label={initiative?.name ?? "initiative"} onClick={onUp} />
          <span className="mono text-[10px] text-muted">↓ {tasks.length} tasks</span>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-1.5 flex pl-[120px]">
          {["W1", "W2", "W3", "W4"].map((w) => <div key={w} className="mono flex-1 text-[9px] text-muted">{w}</div>)}
        </div>
        {tasks.map((t) => (
          <div key={t.id} className="mb-1 flex items-center">
            <span className="w-[116px] truncate pr-2 text-[11px]">{t.title}</span>
            <div className="relative h-3.5 flex-1 rounded-sm bg-bg">
              {[25, 50, 75].map((g) => <div key={g} className="absolute top-0 bottom-0 w-px bg-line" style={{ left: `${g}%` }} />)}
              {t.tl && (
                <div
                  className="absolute top-0.5 bottom-0.5 rounded-sm"
                  style={{ left: `${t.tl.start * 100}%`, width: `${t.tl.span * 100}%`, background: barColor(t.status), opacity: t.status === "done" ? 0.5 : 1 }}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 border-t border-line">
        {tasks.map((t) => (
          <div key={t.id} className="flex items-center gap-3 border-b border-line py-2 text-[12px]">
            <span title={t.energy ?? ""} style={{ color: accent }}>{t.energy ? ENERGY_META[t.energy].icon : "·"}</span>
            <span className={t.status === "done" ? "text-muted line-through" : ""}>{t.title}</span>
            <span className="mono ml-auto text-[10px] text-muted">{t.durationMins}m</span>
            <span className="mono w-16 text-right text-[10px]" style={{ color: t.status === "blocked" ? "var(--signal)" : "var(--muted)" }}>{t.status}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Btn kind="signal" onClick={() => setNote("AI would scaffold ~3 more tasks here, sequenced on the timeline — wired to the agent next.")}>✦ scaffold with AI</Btn>
        <Btn onClick={() => setNote("Sent 2 ready tasks to your Day backlog — they'll show under 'ready to schedule'.")}>→ send ready to Day</Btn>
        {note && <span className="text-[11px] text-muted">{note}</span>}
      </div>
    </div>
  );
}

// ── Initiative — the OKRs ────────────────────────────────────────────────────
function krPct(kr: KeyResult) {
  if (kr.target === kr.baseline) return kr.current >= kr.target ? 100 : 0;
  const p = (kr.current - kr.baseline) / (kr.target - kr.baseline);
  return Math.max(0, Math.min(100, Math.round(p * 100)));
}

function InitiativeFloor({ focus, accent, onUp, onProject }: { focus: Focus; accent: string; onUp: () => void; onProject: (id: string) => void }) {
  const initiative = initiativeById(data, focus.initiativeId);
  const domain = domainById(data, focus.domainId);
  const projects = initiative ? projectsOf(data, initiative.id) : [];
  if (!initiative) return <div className="text-[13px] text-muted">No initiative selected.</div>;

  return (
    <div className="mx-auto max-w-[640px]">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[17px] font-medium">{initiative.name}</h2>
        <div className="ml-auto flex gap-3">
          <Hook dir="up" label={domain?.name ?? "domain"} onClick={onUp} />
          <span className="mono text-[10px] text-muted">↓ {projects.length} projects</span>
        </div>
      </div>
      <div className="mono mt-1 text-[11px] text-muted">
        {initiative.outcome}{initiative.targetDate ? ` · by ${initiative.targetDate}` : ""}
      </div>

      {initiative.keyResults.length > 0 && (
        <div className="mt-5">
          <div className="section-label mb-2">Key results</div>
          {initiative.keyResults.map((kr) => (
            <div key={kr.id} className="mb-3">
              <div className="flex text-[12px]">
                <span>{kr.name}</span>
                <span className="mono ml-auto text-[10px] text-muted">{kr.current}{kr.unit} / {kr.target}{kr.unit}</span>
              </div>
              <Bar pct={krPct(kr)} color={accent} />
            </div>
          ))}
        </div>
      )}

      <div className="mt-5">
        <div className="section-label mb-2">Projects feeding it</div>
        <div className="flex flex-wrap gap-2">
          {projects.map((p) => (
            <button key={p.id} onClick={() => onProject(p.id)} className="fast border border-line px-3 py-2 text-left hover:border-muted">
              <div className="text-[12px]">{p.name}</div>
              <div className="mono text-[10px]" style={{ color: p.status === "blocked" ? "var(--signal)" : "var(--muted)" }}>
                {p.status === "done" ? "done" : p.status === "blocked" ? "blocked" : `${p.progress}%`}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Domain — the anchor of faithfulness ──────────────────────────────────────
function DomainFloor({ focus, onSwitchDomain, onInitiative }: { focus: Focus; onSwitchDomain: (id: string) => void; onInitiative: (id: string) => void }) {
  const domain = domainById(data, focus.domainId) as Domain;
  const inits = initiativesOf(data, domain.id);
  const f = faithfulness(domain);
  const investedPct = Math.min(100, Math.round((domain.investedThisWeek / domain.weeklyTargetHours) * 100));

  return (
    <div className="mx-auto max-w-[600px]">
      <div className="mb-6 flex flex-wrap gap-2">
        {data.domains.map((d) => (
          <button key={d.id} onClick={() => onSwitchDomain(d.id)} className="fast flex items-center gap-1.5 border px-2.5 py-1 text-[11px]"
            style={{ borderColor: d.id === domain.id ? d.color : "var(--line)" }}>
            <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
            {d.name}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2.5">
        <span className="h-3 w-3 rounded-full" style={{ background: domain.color }} />
        <h2 className="text-[20px] font-medium">{domain.name}</h2>
        <span className="mono ml-auto text-[10px]" style={{ color: f.lit ? "var(--muted)" : "var(--signal)" }}>{f.note}</span>
      </div>
      <p className="mt-2 max-w-[460px] text-[14px] leading-relaxed text-muted" style={{ fontStyle: "italic" }}>
        “{domain.intention}”
      </p>

      <div className="mt-5">
        <div className="section-label mb-1">Invested this week</div>
        <Bar pct={investedPct} color={domain.color} baseline={100} />
        <div className="mono text-[11px] text-muted">
          {domain.investedThisWeek} of {domain.weeklyTargetHours}h · <span style={{ color: "var(--accent)" }}>{domain.quarterHours}h this quarter</span>
        </div>
      </div>

      <div className="mt-6">
        <div className="section-label mb-2">Initiatives</div>
        {inits.map((i) => (
          <button key={i.id} onClick={() => onInitiative(i.id)} className="fast mb-3 block w-full text-left">
            <div className="flex text-[12px]">
              <span>{i.name}</span>
              <span className="mono ml-auto text-[10px] text-muted">
                {i.momentum === "up" ? "↑" : i.momentum === "down" ? "↓ stalled" : "→"} {i.progress}%
              </span>
            </div>
            <Bar pct={i.progress} color={domain.color} />
          </button>
        ))}
        {inits.length === 0 && <div className="text-[12px] text-muted">No initiatives yet in {domain.name}.</div>}
      </div>
    </div>
  );
}
