// Domain — the anchor of faithfulness. A calm, full-width gallery of the
// fixtures of Phil's life (Family, Frontier, SCE, Trading, Personal…). Each
// card carries its standing intention, faithfulness lamp, the invested arc
// (Gain over the quarter), and its initiatives — all editable in place.

import { useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import {
  domainProgress,
  faithfulness,
  initiativesOf,
  initiativeProgress,
  looseTasksOfDomain,
  type Domain,
} from "../../lib/vertical";
import type { Focus } from "../AppShell";
import { Bar, DeleteBtn, FloorHeader, InlineNumber, InlineText, InlineTextarea } from "./parts";
import { Btn } from "../ui";

const SWATCHES = ["#DB2777", "#7C3AED", "#2563EB", "#0D9488", "#059669", "#D97706", "#4F46E5", "#DC2626", "#0891B2", "#65A30D"];
const ICONS = ["❤", "✝", "◈", "△", "✦", "◐", "⬡", "☼", "⚓", "♜", "✺", "❖"];

export default function DomainFloor({
  focus,
  onSwitchDomain,
  onOpenInitiative,
}: {
  focus: Focus;
  onSwitchDomain: (id: string) => void;
  onOpenInitiative: (id: string) => void;
}) {
  const { data, addDomain } = useVertical();
  const domains = [...data.domains].sort((a, b) => a.sort - b.sort);

  return (
    <div className="mx-auto max-w-[1280px]">
      <FloorHeader
        eyebrow="The anchor · areas that persist for years"
        actions={<Btn kind="primary" onClick={() => void addDomain().then((d) => onSwitchDomain(d.id))}>+ new domain</Btn>}
      >
        <h1 className="text-[24px] font-semibold tracking-tight">Domains</h1>
        <p className="mt-1 max-w-[640px] text-[13px] text-muted">
          The fixtures of your life. Measured by faithfulness over a long arc — not throughput. Are you still showing up here?
        </p>
      </FloorHeader>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {domains.map((d) => (
          <DomainCard
            key={d.id}
            domain={d}
            focused={d.id === focus.domainId}
            onFocus={() => onSwitchDomain(d.id)}
            onOpenInitiative={onOpenInitiative}
          />
        ))}
      </div>
    </div>
  );
}

function DomainCard({
  domain,
  focused,
  onFocus,
  onOpenInitiative,
}: {
  domain: Domain;
  focused: boolean;
  onFocus: () => void;
  onOpenInitiative: (id: string) => void;
}) {
  const { data, updateDomain, deleteDomain, addInitiative } = useVertical();
  const inits = initiativesOf(data, domain.id);
  const loose = looseTasksOfDomain(data, domain.id);
  const f = faithfulness(domain);
  const investedPct = domain.weeklyTargetHours ? Math.min(100, Math.round((domain.investedThisWeek / domain.weeklyTargetHours) * 100)) : 0;
  const rollup = domainProgress(data, domain.id);
  const [pickColor, setPickColor] = useState(false);
  const [pickIcon, setPickIcon] = useState(false);

  return (
    <div
      onClick={onFocus}
      className="fast group relative flex flex-col overflow-hidden rounded-lg border bg-surface p-5"
      style={{ borderColor: focused ? domain.color : "var(--line)", boxShadow: focused ? `0 0 0 1px ${domain.color}` : "none" }}
    >
      {/* color spine */}
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: domain.color }} />

      <div className="flex items-start gap-3">
        {/* icon / color editors */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setPickIcon((v) => !v); setPickColor(false); }}
            className="fast flex h-10 w-10 items-center justify-center rounded-md text-[18px]"
            style={{ background: `${domain.color}1a`, color: domain.color }}
            title="Change icon"
          >
            {domain.icon}
          </button>
          {pickIcon && (
            <Popover onClose={() => setPickIcon(false)}>
              <div className="grid grid-cols-6 gap-1">
                {ICONS.map((ic) => (
                  <button key={ic} onClick={(e) => { e.stopPropagation(); updateDomain(domain.id, { icon: ic }); setPickIcon(false); }}
                    className="fast flex h-7 w-7 items-center justify-center rounded-sm text-[15px] hover:bg-accent-soft">{ic}</button>
                ))}
              </div>
            </Popover>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <InlineText value={domain.name} onChange={(v) => updateDomain(domain.id, { name: v })} className="text-[17px] font-semibold" />
            <button
              onClick={(e) => { e.stopPropagation(); setPickColor((v) => !v); setPickIcon(false); }}
              className="fast h-3 w-3 shrink-0 rounded-full ring-1 ring-line"
              style={{ background: domain.color }}
              title="Change color"
            />
            {pickColor && (
              <Popover onClose={() => setPickColor(false)}>
                <div className="flex flex-wrap gap-1.5" style={{ width: 132 }}>
                  {SWATCHES.map((c) => (
                    <button key={c} onClick={(e) => { e.stopPropagation(); updateDomain(domain.id, { color: c }); setPickColor(false); }}
                      className="fast h-5 w-5 rounded-full ring-1 ring-line" style={{ background: c }} />
                  ))}
                </div>
              </Popover>
            )}
          </div>
          <div className="mono mt-0.5 text-[10px]" style={{ color: f.lit ? "var(--muted)" : "var(--signal)" }}>
            {f.lit ? "◉" : "○"} {f.note}
          </div>
        </div>

        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <DeleteBtn what="domain" onDelete={() => deleteDomain(domain.id)} />
        </div>
      </div>

      {/* intention — the standing vow */}
      <div className="mt-3 border-l-2 pl-3" style={{ borderColor: `${domain.color}55` }}>
        <InlineTextarea
          value={domain.intention}
          onChange={(v) => updateDomain(domain.id, { intention: v })}
          placeholder="State the standing intention for this domain…"
          className="text-[13px] italic text-muted"
        />
      </div>

      {/* invested this week vs target + the quarter Gain — derived from
          completed blocks (a task IS a block), only the target is editable */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="section-label">Invested this week</span>
          <span className="mono text-[10px] text-muted">
            {domain.investedThisWeek.toFixed(domain.investedThisWeek % 1 === 0 ? 0 : 1)} /{" "}
            <InlineNumber value={domain.weeklyTargetHours} onChange={(v) => updateDomain(domain.id, { weeklyTargetHours: v })} suffix="h" />
          </span>
        </div>
        <Bar pct={investedPct} color={domain.color} baseline={100} />
        <div className="mono text-[10px] text-muted">
          <span style={{ color: domain.color }}>{domain.quarterHours}h</span>{" "}
          this quarter · {rollup}% across initiatives
        </div>
      </div>

      {/* initiatives within the domain — the connective tissue */}
      <div className="mt-4 border-t border-line pt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="section-label">{inits.length} initiative{inits.length === 1 ? "" : "s"}</span>
          <button
            onClick={(e) => { e.stopPropagation(); void addInitiative(domain.id).then((i) => onOpenInitiative(i.id)); }}
            className="fast mono text-[10px] text-muted hover:text-ink"
          >
            + initiative
          </button>
        </div>
        <div className="space-y-1.5">
          {inits.map((i) => {
            const pct = initiativeProgress(data, i);
            return (
              <button
                key={i.id}
                onClick={(e) => { e.stopPropagation(); onOpenInitiative(i.id); }}
                className="fast block w-full text-left"
              >
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="truncate">{i.name}</span>
                  <span className="mono ml-auto shrink-0 text-[10px] text-muted">
                    {i.momentum === "up" ? "↑" : i.momentum === "down" ? "↓" : "→"} {pct}%
                  </span>
                </div>
                <Bar pct={pct} color={domain.color} h={1} />
              </button>
            );
          })}
          {inits.length === 0 && <div className="text-[11px] text-muted italic">No initiatives yet.</div>}
        </div>
        {loose.length > 0 && (
          <div className="mono mt-2 text-[10px] text-muted">+ {loose.length} loose task{loose.length === 1 ? "" : "s"} parked here</div>
        )}
      </div>
    </div>
  );
}

function Popover({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div className="rise elev-2 absolute left-0 top-full z-50 mt-1 rounded-md border border-line bg-surface p-2" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </>
  );
}
