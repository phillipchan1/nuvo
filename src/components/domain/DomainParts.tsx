// The Domain surface's shared parts — the marks and controls the desktop floor
// (`floors/DomainFloor.tsx`) and the phone (`mobile/MobileDomains.tsx` + the
// domain detail) BOTH wear.
//
// A domain reads the same on a laptop and a phone or it isn't the same domain:
// the presence pulse, the "routes clean" mark, the week's shape, the domain's
// identity controls, and the grooming workbench all live here so neither
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
  normalizeDomainSymbol,
  searchDomainSymbols,
  suggestDomainSymbol,
} from "../../lib/domainSymbols";
import type { Domain, DomainContext } from "../../lib/vertical";
import DomainSymbol from "./DomainSymbol";
import { Icon } from "../Icon";
import { Button, Chip, Dot, Readiness } from "../kit";
import { AltitudeIcon } from "../icons";

/** The domain's light — twenty identities, one step around the wheel.
 *  Deep enough to read as text and as a 12% wash in both themes. Near-duplicates (rose/magenta/fuchsia) culled so each swatch
 *  earns its slot — mustard holds "company yellow" without dying on cream. */
export const SWATCHES = [
  "#DC2626", // red
  "#E11D48", // rose
  "#DB2777", // pink
  "#C2410C", // terracotta
  "#EA580C", // orange
  "#D97706", // amber
  "#CA8A04", // mustard — company yellow that still holds as text
  "#65A30D", // lime
  "#4D7C0F", // olive
  "#059669", // emerald
  "#0D9488", // teal
  "#0891B2", // cyan
  "#0284C7", // sky
  "#2563EB", // blue
  "#1D4ED8", // navy
  "#4F46E5", // indigo
  "#7C3AED", // violet
  "#9333EA", // purple
  "#B45309", // bronze
  "#57534E", // stone
];

// ── The presence pulse — 13 weeks of showing-up, an EKG, not a bar ────────
// The dashed line marks your weekly intent, so a glance reads over/under.
export function PresencePulse({
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
// Drawn as a check on the kit's readiness pie: full when the domain routes
// clean, a part-filled pie with its next step (faint) while it's partway, the
// dashed raw ring when Nuvo files here by name alone. Why rides the tooltip.
const CLARITY_STEP = { clear: 3, partial: 1, unrefined: 0 } as const;

export function ClarityMark({ domain }: { domain: Domain }) {
  const c = clarityOf(domain);
  const clear = c.level === "clear";
  const label = clear ? "Routes clean" : c.label.charAt(0).toUpperCase() + c.label.slice(1);
  return (
    <span className="fl-clarity" data-missing={clear ? undefined : ""} title={c.why}>
      <Readiness step={c.level === "partial" && c.pct >= 0.5 ? 2 : CLARITY_STEP[c.level]} title={c.why} />
      <span>{label}</span>
    </span>
  );
}

// ── This week's shape — seven days, stacked by the domains that got the hours ──
//
// The old read was a 100%-stacked share bar, which hides the two things you
// actually ask of it: how much, and *when*. Columns are on an absolute scale
// (floor of an 8h day) so a light week reads light; today's label is set in
// ink at 700, days still ahead sit as open `--slot` track.
export function WeekShape({
  domains,
  now,
  height = 64,
  legend = true,
  head = true,
}: {
  domains: Domain[];
  now?: Date;
  height?: number;
  legend?: boolean;
  /** the "N h across M domains" line — off where a hero already says it */
  head?: boolean;
}) {
  const shape: WeekShapeRead = useMemo(() => readWeekShape(domains, now ?? new Date()), [domains, now]);
  const { active, dayTotals, scale, todayIdx, total } = shape;

  return (
    <div className="fl-shape">
      {head && (
        <div className="fl-shape-head">
          <span className="fl-label">This week's shape</span>
          <span className="fl-meta-fact">
            {fmtH(total)} across {active.length} {active.length === 1 ? "domain" : "domains"}
          </span>
        </div>
      )}

      <div className="fl-shape-days">
        {DAY_LABELS.map((label, i) => {
          const dayTotal = dayTotals[i];
          const ahead = i > todayIdx;
          const isToday = i === todayIdx;
          return (
            <div key={label} className="fl-shape-day">
              <div className="fl-shape-col" data-ahead={ahead ? "" : undefined} style={{ height }}>
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
              <span className="fl-shape-dow" data-today={isToday ? "" : undefined}>
                {label}
              </span>
              <span className="fl-shape-h" data-none={dayTotal > 0 ? undefined : ""}>
                {dayTotal > 0 ? fmtH(dayTotal) : "—"}
              </span>
            </div>
          );
        })}
      </div>

      {legend && active.length > 0 && (
        <div className="fl-legend" style={{ paddingTop: 10, borderTop: "1px solid var(--line-1)" }}>
          {active.map((d) => (
            <span key={d.id}>
              <Dot color={d.color} />
              {d.name} <span style={{ color: "var(--faint)" }}>{fmtH(d.investedThisWeek)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The domain's light. Same swatches on both shells. */
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
    <div className="grid grid-cols-5 gap-1.5">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onPick(c)}
          aria-label={`Set the domain's light to ${c}`}
          aria-pressed={c === value}
          // Twenty 44px swatches don't fit a 375px row, so the drawn swatch stays
          // 32px and `.tap-bloom` grows the hit area past 44 invisibly.
          className={`justify-self-center ${phone ? "tap-bloom h-8 w-8" : "h-5 w-5"}`}
          style={{
            background: c,
            border: 0,
            borderRadius: "var(--r-chip)",
            boxShadow: c === value ? `0 0 0 2px var(--raised), 0 0 0 4px ${c}` : "inset 0 0 0 1px var(--line-1)",
          }}
        />
      ))}
    </div>
  );
}

/** The domain's symbol — a curated, searchable vector vocabulary, with a fast
 * local guess from the domain's own words. Same picker on both shells. */
export function DomainSymbolPicker({
  value,
  domainName,
  domainContext,
  onPick,
  phone = false,
}: {
  value: string;
  domainName: string;
  domainContext?: string | null;
  onPick: (icon: string) => void;
  phone?: boolean;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchDomainSymbols(query), [query]);
  const normalizedValue = normalizeDomainSymbol(value);
  const suggestion = useMemo(
    () => suggestDomainSymbol(`${domainName} ${domainContext ?? ""}`),
    [domainName, domainContext],
  );

  return (
    <div className="flex flex-col gap-2" style={{ width: phone ? undefined : 240 }}>
      <div className="flex items-center gap-1.5">
        <div className="k-field min-w-0 flex-1" data-size={phone ? undefined : "sm"}>
          <Icon name="search" size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search domain symbols"
          />
        </div>
        {suggestion && suggestion !== normalizedValue && (
          <button
            type="button"
            onClick={() => onPick(suggestion)}
            title={`Suggested from “${domainName}”`}
            aria-label={`Use the suggested symbol for “${domainName}”`}
            className={`k-chip ${phone ? "tap-bloom" : ""}`}
            data-tone="accent"
          >
            <Icon name="sparkles" size={12} />
            <DomainSymbol value={suggestion} size={14} />
          </button>
        )}
      </div>
      <div className={`grid gap-1 overflow-y-auto pr-0.5 ${phone ? "max-h-[240px] grid-cols-7" : "max-h-[200px] grid-cols-8"}`}>
        {results.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => onPick(entry.key)}
            aria-label={`Set the domain symbol to ${entry.label}`}
            aria-pressed={entry.key === normalizedValue}
            title={entry.label}
            className={`k-btn ${phone ? "tap-bloom" : ""}`}
            data-kind="ghost"
            data-icon=""
            style={phone ? { width: 32, height: 32 } : undefined}
          >
            <DomainSymbol value={entry.key} size={phone ? 19 : 16} />
          </button>
        ))}
        {results.length === 0 && <div className="col-span-full py-3 text-center text-caption text-muted">No matches</div>}
      </div>
    </div>
  );
}

// ══ The routing-context workbench ════════════════════════════════════════════
// Machine-facing, not ceremony: a one-line charter (the source of truth for
// filing) that Nuvo expands into entities/boundary so passive grooming can route
// captures here, and a mis-file catcher that re-homes work the charter says
// doesn't belong. One component, both shells — a domain that routes differently
// depending on which screen you groomed it from is the drift this file exists to
// stop. A disclosure under a kit section header.
type Misfiled = { kind: "initiative" | "project" | "task"; id: string; name: string; suggestDomain: string; suggestDomainId: string | null };
type Refinement = { context: DomainContext; misfiled: Misfiled[]; routingNote?: string };

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

  const size = phone ? "md" : "xs";

  return (
    <section className="fl-sec w-full text-left">
      <div className="k-section" data-collapsed={open ? undefined : ""} style={phone ? { height: 44 } : undefined}>
        <button type="button" className={`k-section-toggle ${phone ? "tap-h" : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span>How Nuvo files things here</span>
          <Icon name="chevron-down" size={12} className="k-chev" />
        </button>
        <span className="k-grow" />
        {domain.context && !open && <ClarityMark domain={domain} />}
      </div>

      {open && (
        <div className="grid gap-3 pt-2">
          <div className="k-field" data-multiline="">
            <textarea
              value={charter}
              onChange={(e) => setCharter(e.target.value)}
              onBlur={() => charter.trim() !== domain.charter && updateDomain(domain.id, { charter: charter.trim() })}
              placeholder="In a line — what is this domain? Who and what belongs here? (e.g. “My day job at SCE — Obi, the Enterprise rollout, Super Leader.”)"
              rows={phone ? 3 : 2}
              aria-label="What belongs in this domain"
              style={{ minHeight: 0 }}
            />
          </div>
          <div className="fl-work-row">
            <Button
              kind="primary"
              size={size}
              className={phone ? "tap" : undefined}
              icon={<Icon name="sparkles" size={13} />}
              onClick={refine}
              disabled={busy}
            >
              {busy ? "Grooming…" : shown ? "Re-groom" : "Groom with Nuvo"}
            </Button>
            {err && <span className="text-caption" style={{ color: "var(--danger)" }}>{err}</span>}
          </div>

          {prop?.routingNote && <p className="fl-note">{prop.routingNote}</p>}

          {shown && (
            <div className="fl-propose" data-dashed="">
              {prop && !accepted && (
                <div className="fl-work-row">
                  <span className="fl-label">Nuvo proposes</span>
                  <span className="k-grow" />
                  <Button kind="secondary" size={size} className={phone ? "tap" : undefined} onClick={accept}>
                    Accept
                  </Button>
                </div>
              )}
              {accepted && <span className="fl-label" style={{ color: "var(--ok)" }}>Saved</span>}
              {shown.scope && <p className="m-0 text-body" style={{ color: "var(--ink-2)" }}>{shown.scope}</p>}
              {shown.entities.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {shown.entities.map((e) => (
                    <Chip key={e} dot={domain.color}>{e}</Chip>
                  ))}
                </div>
              )}
              {shown.keywords.length > 0 && (
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  {shown.keywords.map((k) => <span key={k} className="fl-meta-fact">{k}</span>)}
                </div>
              )}
              {shown.boundary && <p className="fl-note">Not here: {shown.boundary}</p>}
              {shown.entities.length === 0 && shown.keywords.length === 0 && (
                <p className="fl-note">No names of its own yet — routes by the line above.</p>
              )}
            </div>
          )}

          {pendingMis.length > 0 && (
            <div className="grid gap-1.5">
              <div className="fl-work-row">
                <span className="fl-label" style={{ color: "var(--ink)" }}>Looks mis-filed here</span>
                <span className="fl-meta-fact">{pendingMis.length}</span>
              </div>
              <div className={`grid ${phone ? "gap-2.5" : "gap-1"}`}>
                {pendingMis.map((m) => (
                  // On a phone the name gets its own line — a truncated title, a
                  // <select> and a Move button never share 375px legibly.
                  <div key={m.id} className={phone ? "flex flex-col gap-1.5" : "flex items-center gap-1.5 text-body"}>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                      <span className="inline-flex shrink-0 text-muted">
                        <AltitudeIcon kind={m.kind} size={13} />
                      </span>
                      <span className="truncate">{m.name}</span>
                    </span>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={targets[m.id] ?? m.suggestDomainId ?? ""}
                        onChange={(e) => setTargets((t) => ({ ...t, [m.id]: e.target.value }))}
                        aria-label={`Move ${m.name} to…`}
                        className={`k-field ${phone ? "tap min-w-0 flex-1" : "max-w-[132px]"}`}
                        data-size={phone ? undefined : "sm"}
                      >
                        <option value="">Move to…</option>
                        {others.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                      <Button
                        kind="secondary"
                        size={size}
                        className={phone ? "tap shrink-0" : undefined}
                        onClick={() => rehome(m)}
                        disabled={!(targets[m.id] ?? m.suggestDomainId)}
                      >
                        Move
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
