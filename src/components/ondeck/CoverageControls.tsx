// The deck's own controls, over the grid (`.dk-tools`, styles/decks.css):
//
//   · Coverage — a kit section header with its count. Packed, it is a disclosure
//     that folds the strip away (the deck is the primary surface). By domain the
//     lanes below ARE the strip, so there is nothing to fold: it is the read alone.
//   · By domain — a kit Button that stays pressed. A toggle, not a two-option
//     switch: the off state needs no name of its own (every candidate — "All",
//     "Mixed" — collides with one already in use, P11). Pressed = the accent wash:
//     intent, not status.
//   · Domains — a kit Button opening a kit Picker (multi): which domains the strip
//     watches / get a lane. Persisted as the HIDDEN set (usePlannerPrefs), so a new
//     domain is watched by default.

import { useState } from "react";
import type { Domain } from "../../lib/vertical";
import { Icon } from "../Icon";
import { Button, Dot, Picker, SectionHeader } from "../kit";

export default function CoverageControls({
  collapsed,
  setCollapsed,
  covered,
  tracked,
  domains,
  hidden,
  toggleHidden,
  open,
  setOpen,
  byDomain,
  setByDomain,
  itemNoun = "project",
}: {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  /** domains with work in the window / total tracked — the strip's count. */
  covered: number;
  tracked: number;
  domains: Domain[];
  hidden: Set<string>;
  toggleHidden: (id: string) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  /** lane mode — omit both to hide the toggle (the deck has no lane layout). */
  byDomain?: boolean;
  setByDomain?: (v: boolean) => void;
  /** what the deck holds — "project" / "initiative" — for the accessible names. */
  itemNoun?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const shown = domains.filter((d) => !hidden.has(d.id));
  const count = `${covered}/${tracked}`;

  return (
    <div className="dk-tools">
      {byDomain ? (
        <SectionHeader title="Coverage" count={<span title={`${covered} of ${tracked} domains with ${/^[aeiou]/i.test(itemNoun) ? "an" : "a"} ${itemNoun}`}>{count}</span>} />
      ) : (
        <SectionHeader
          title="Coverage"
          count={count}
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
        />
      )}

      <span className="dk-grow" />

      {setByDomain && (
        <Button
          kind="ghost"
          active={!!byDomain}
          aria-pressed={!!byDomain}
          icon={<LanesGlyph />}
          title={byDomain ? "One deck, packed together" : "One row per domain, so a gap shows as an empty cell"}
          onClick={() => setByDomain(!byDomain)}
        >
          By domain
        </Button>
      )}

      <Button
        ref={setAnchor}
        kind="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        trailing={<Icon name="chevron-down" size={12} />}
        title={byDomain ? "Which domains get a row" : "Which domains coverage tracks"}
        onClick={() => setOpen(!open)}
      >
        Domains
        <span className="k-count">
          {shown.length}/{domains.length}
        </span>
      </Button>
      <Picker
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        placement="bottom-end"
        label={byDomain ? "Domains with a row" : "Domains in coverage"}
        multiple
        options={domains.map((d) => ({ value: d.id, label: d.name, icon: <Dot color={d.color} /> }))}
        value={shown.map((d) => d.id)}
        onChange={toggleHidden}
      />
    </div>
  );
}

/** Three stacked rows, each led by a dot — the lane layout drawn small. */
function LanesGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 13 13" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="2" cy="2.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="2" cy="6.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="2" cy="10.5" r="1" fill="currentColor" stroke="none" />
      <path d="M5 2.5h7M5 6.5h4.5M5 10.5h6" />
    </svg>
  );
}
