// The Domain surface's shared parts — the marks and controls the desktop floor
// (`floors/DomainFloor.tsx`) and the phone (`mobile/MobileDomains.tsx` + the
// domain detail) BOTH wear.
//
// A domain reads the same on a laptop and a phone or it isn't the same domain:
// the faithfulness pulse, the "routes clean" mark, the week's shape, the sigil's
// form, the domain's light, and the grooming workbench all live here so neither
// shell can quietly grow its own version. Layout is the shell's business; these
// are the pieces it lays out. `phone` only bumps control sizing to 44px targets —
// it never changes what a mark means.

import { useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useVertical } from "../../hooks/useVertical";
import {
  clarityOf,
  DAY_LABELS,
  fmtH,
  readWeekShape,
  type WeekShapeRead,
} from "../../lib/domainRead";
import {
  domainSigilSpec,
  SIGIL_FORMS,
  SIGIL_FORM_BLURB,
  SIGIL_FORM_LABEL,
  type SigilForm,
} from "../../lib/domainSigil";
import type { Domain, DomainContext } from "../../lib/vertical";
import DomainSigil from "../floors/DomainSigil";
import { RefinedTick } from "../floors/parts";
import { AltitudeIcon } from "../icons";

/** The domain's light — the ten identities a fixture can take. */
export const SWATCHES = [
  "#DB2777", "#7C3AED", "#2563EB", "#0D9488", "#059669",
  "#D97706", "#4F46E5", "#DC2626", "#0891B2", "#65A30D",
];

// ── The faithfulness pulse — 13 weeks of showing-up, an EKG, not a bar ────────
// The dashed line marks your weekly intent, so a glance reads over/under.
export function FaithPulse({
  weeks,
  color,
  target,
  height = 54,
}: {
  weeks: number[];
  color: string;
  target: number;
  height?: number;
}) {
  const W = 320, H = 54, n = weeks.length, gap = 5;
  const bw = (W - (n - 1) * gap) / n;
  const norm = target > 0 ? target : Math.max(...weeks, 1);
  const ty = 48 - (5 + 42); // the bar height at exactly one target's worth
  return (
    // `meet`, not `none`: the bars are pill-capped, so a non-uniform scale bends
    // them into lozenges at any width but 320.
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} preserveAspectRatio="xMidYMid meet" aria-hidden style={{ display: "block" }}>
      {target > 0 && <line x1={0} y1={ty} x2={W} y2={ty} stroke={color} strokeWidth={1} strokeDasharray="3 4" opacity={0.35} /> }
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

// ── A domain's flourish — the rule under its name ─────────────────────────────
export function Flourish({ color, width = 124 }: { color: string; width?: number }) {
  return (
    <svg width={width} height={12} viewBox="0 0 124 12" aria-hidden style={{ color }}>
      <g stroke="currentColor" fill="none" strokeWidth={1} opacity={0.5}>
        <line x1="6" y1="6" x2="50" y2="6" /><line x1="74" y1="6" x2="118" y2="6" />
      </g>
      <rect x="58" y="2" width="8" height="8" transform="rotate(45 62 6)" fill="currentColor" opacity={0.75} />
    </svg>
  );
}

// ── Can Nuvo file things here? ───────────────────────────────────────────────
export function ClarityMark({ domain }: { domain: Domain }) {
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

// ── This week's shape — seven days, stacked by the domains that got the hours ──
//
// The old read was a 100%-stacked share bar, which hides the two things you
// actually ask of it: how much, and *when*. Columns are on an absolute scale
// (floor of an 8h day) so a light week reads light; today carries `--signal`,
// days still ahead sit as open `--slot` track.
export function WeekShape({
  domains,
  now,
  height = 64,
  legend = true,
}: {
  domains: Domain[];
  now?: Date;
  height?: number;
  legend?: boolean;
}) {
  const shape: WeekShapeRead = useMemo(() => readWeekShape(domains, now ?? new Date()), [domains, now]);
  const { active, dayTotals, scale, todayIdx, total } = shape;

  return (
    <div
      className="rounded-xl border border-line px-4 py-3.5"
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
                  height,
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

      {legend && (
        <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1 border-t border-line pt-2.5">
          {active.map((d) => (
            <span key={d.id} className="flex items-center gap-1.5 text-meta text-muted">
              <i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: d.color }} />
              {d.name} <span className="mono">{fmtH(d.investedThisWeek)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── The sigil's form — the one configurable knob ──────────────────────────────
/** The four forms, each drawn live from THIS domain's real data. The chooser
 *  itself is the shell's (desktop hangs it in a popover, the phone lays it flat),
 *  but the tiles are one thing. */
export function SigilFormGrid({
  domain,
  form,
  onPick,
  size = 48,
  phone = false,
}: {
  domain: Domain;
  form: SigilForm;
  onPick: (f: SigilForm) => void;
  size?: number;
  phone?: boolean;
}) {
  return (
    <div className={`grid gap-1.5 ${phone ? "grid-cols-4" : "grid-cols-2"}`}>
      {SIGIL_FORMS.map((f) => (
        <button
          key={f}
          onClick={() => onPick(f)}
          className={`fast flex flex-col items-center gap-1 rounded-md p-2 text-center ${phone ? "tap active:bg-surface-2" : "hover:bg-surface-2"}`}
          style={f === form ? { background: "var(--accent-soft)", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent)" } : undefined}
          title={SIGIL_FORM_BLURB[f]}
          aria-pressed={f === form}
        >
          <DomainSigil spec={domainSigilSpec(domain, f)} size={size} />
          <span className="text-micro" style={{ color: f === form ? "var(--accent)" : "var(--muted)", fontWeight: f === form ? 600 : 400 }}>
            {SIGIL_FORM_LABEL[f]}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The domain's light. Same ten swatches on both shells. */
export function SwatchGrid({
  value,
  onPick,
  phone = false,
}: {
  value: string;
  onPick: (c: string) => void;
  phone?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SWATCHES.map((c) => (
        <button
          key={c}
          onClick={() => onPick(c)}
          aria-label={`Set the domain's light to ${c}`}
          aria-pressed={c === value}
          // ten 44px circles don't fit a 375px row, so the drawn swatch stays
          // 32px and `.tap-bloom` grows the hit area past 44 invisibly.
          className={`fast rounded-full ring-1 ring-line ${phone ? "tap-bloom h-8 w-8 active:scale-95" : "h-5 w-5"}`}
          style={{ background: c, ...(c === value ? { boxShadow: `0 0 0 2px var(--bg), 0 0 0 4px ${c}` } : {}) }}
        />
      ))}
    </div>
  );
}

// ══ The routing-context workbench ════════════════════════════════════════════
// Machine-facing, not ceremony: a one-line charter (the source of truth for
// filing) that Nuvo expands into entities/boundary so passive grooming can route
// captures here, and a mis-file catcher that re-homes work the charter says
// doesn't belong. One component, both shells — a domain that routes differently
// depending on which screen you groomed it from is the drift this file exists to
// stop.
type Misfiled = { kind: "initiative" | "project" | "task"; id: string; name: string; suggestDomain: string; suggestDomainId: string | null };
type Refinement = { context: DomainContext; misfiled: Misfiled[] };

export function DomainGroom({ domain, phone = false, open: openProp }: { domain: Domain; phone?: boolean; open?: boolean }) {
  const { data, updateDomain, updateInitiative, updateProject, routeTask } = useVertical();
  const [open, setOpen] = useState(Boolean(openProp));
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
    <div className={`w-full text-left ${phone ? "" : "mt-8 border-t pt-4"}`} style={phone ? undefined : { borderColor: "var(--line)" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`fast flex w-full items-center justify-between text-meta uppercase text-muted ${phone ? "tap active:text-ink" : "hover:text-ink"}`}
        style={{ letterSpacing: "0.18em" }}
        aria-expanded={open}
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
            rows={phone ? 3 : 2}
            className="w-full resize-none rounded-md border border-line bg-surface/40 px-2.5 py-2 text-body placeholder:text-muted focus:border-line-strong focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
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
                  <button onClick={accept} className={`fast rounded px-1.5 text-micro font-medium text-accent ${phone ? "tap py-1 active:bg-accent-soft" : "py-px hover:bg-accent-soft"}`}>Accept</button>
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
              <div className={`flex flex-col ${phone ? "gap-2.5" : "gap-1.5"}`}>
                {pendingMis.map((m) => (
                  // On a phone the name gets its own line — a truncated title, a
                  // <select> and a Move button never share 375px legibly.
                  <div key={m.id} className={phone ? "flex flex-col gap-1.5" : "flex items-center gap-1.5 text-meta"}>
                    <span className={`min-w-0 flex-1 truncate ${phone ? "text-body" : ""}`}>
                      <span className="mr-1 inline-flex align-[-2px] text-muted">
                        <AltitudeIcon kind={m.kind} size={13} />
                      </span>
                      {m.name}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={targets[m.id] ?? m.suggestDomainId ?? ""}
                        onChange={(e) => setTargets((t) => ({ ...t, [m.id]: e.target.value }))}
                        aria-label={`Move ${m.name} to…`}
                        className={
                          phone
                            ? "tap min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-2 text-body"
                            : "max-w-[110px] rounded border border-line bg-surface px-1 py-px text-meta"
                        }
                      >
                        <option value="">move to…</option>
                        {others.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                      <button
                        onClick={() => rehome(m)}
                        disabled={!(targets[m.id] ?? m.suggestDomainId)}
                        className={`fast rounded font-medium text-accent disabled:opacity-40 ${
                          phone ? "tap shrink-0 px-3 py-2 text-body active:bg-accent-soft" : "px-1.5 py-px text-micro hover:bg-accent-soft"
                        }`}
                      >
                        Move
                      </button>
                    </div>
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
