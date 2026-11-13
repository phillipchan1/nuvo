// The list's Filter (D-190) — narrows the projects / initiatives Table to one
// domain. A ghost Filter button in the filter row opens the domains as a kit
// menu; an active filter shows as one chip beside it, which clears it.

import { useRef, useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { Icon } from "../Icon";
import { Button, ChipButton, Dot, Menu, MenuItem, MenuSeparator } from "../kit";

export function DomainFilter({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { data } = useVertical();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const domains = [...data.domains].sort((a, b) => a.sort - b.sort);
  const current = value ? domains.find((d) => d.id === value) ?? null : null;

  return (
    <>
      <Button
        ref={btn}
        kind="ghost"
        size="sm"
        icon={<Icon name="filter" size={14} />}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Filter
      </Button>
      <Menu anchor={btn.current} open={open} onClose={() => setOpen(false)} label="Filter by domain">
        <MenuItem checked={value === null} onSelect={() => onChange(null)}>
          All domains
        </MenuItem>
        {domains.length > 0 && <MenuSeparator />}
        {domains.map((d) => (
          <MenuItem key={d.id} icon={<Dot color={d.color} />} checked={value === d.id} onSelect={() => onChange(d.id)}>
            {d.name}
          </MenuItem>
        ))}
      </Menu>
      {current && (
        <ChipButton dot={current.color} onClick={() => onChange(null)} title="Clear the filter" aria-label={`Clear the ${current.name} filter`}>
          {current.name}
          <Icon name="close" size={12} style={{ marginLeft: 2, color: "var(--faint)" }} />
        </ChipButton>
      )}
    </>
  );
}
