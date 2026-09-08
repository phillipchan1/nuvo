// A shared domain filter chip row — used by the projects and initiatives
// collections to narrow the set to one fixture.

import { type ReactNode } from "react";
import { useVertical } from "../../hooks/useVertical";
import DomainSymbol from "../domain/DomainSymbol";

export function DomainFilter({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { data } = useVertical();
  return (
    <div className="mb-5 flex flex-wrap items-center gap-1.5">
      <Chip active={value === null} onClick={() => onChange(null)} color="var(--muted)" label="All" />
      {[...data.domains].sort((a, b) => a.sort - b.sort).map((d) => (
        <Chip
          key={d.id}
          active={value === d.id}
          onClick={() => onChange(d.id)}
          color={d.color}
          label={<><DomainSymbol value={d.icon} size={14} /> {d.name}</>}
        />
      ))}
    </div>
  );
}

function Chip({ active, onClick, color, label }: { active: boolean; onClick: () => void; color: string; label: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="fast flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-label"
      style={{ borderColor: active ? color : "var(--line)", color: active ? "var(--text)" : "var(--muted)", background: active ? `${color}14` : "transparent" }}
    >
      {label}
    </button>
  );
}
