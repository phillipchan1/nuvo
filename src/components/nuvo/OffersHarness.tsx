/**
 * ?offers — the Nuvo panel's offers (D-198) over a stranger's account (a
 * teacher), no auth, no network. The REAL cards and the REAL collect motion:
 * Keep flies a memory into the Memory row; Draft the path flies into the page
 * and the drafted steps appear in its list. `?offers&phone` draws the phone's
 * chat at touch size.
 */

import { useState } from "react";
import { Toaster } from "sonner";
import { NuvoOffersView, type OfferActs } from "./NuvoOffers";
import NuvoSheet from "../mobile/NuvoSheet";
import type { NuvoOffersState } from "./useNuvoOffers";
import { MemoryIcon } from "../memory/MemoryIcon";
import { composeOffers, type Offer } from "../../lib/nuvoOffers";
import { collectInto, landingTarget } from "../../lib/motion";
import type { ThinPath } from "../../lib/thinPath";

const THIN: ThinPath[] = [
  {
    projectId: "trip",
    name: "Spring field trip",
    domainId: "school",
    heldMins: 180,
    workMins: 20,
    openSteps: 2,
    first: { dateISO: "2026-11-17", startISO: "2026-11-17T13:00:00", durationMins: 180 },
  },
];
const MEMORY = [
  {
    key: "window:0:930-1050",
    statement: "Monday, 3:30–5:30pm stays open, and your marking lands there.",
    evidence: "Open on 7 of 8 Mondays.",
    keep: "Protects it as a Marking slot. Plan the week puts marking there first.",
  },
  {
    key: "habit:swim:1,3",
    statement: "Swim: Tuesdays and Thursdays, 6:30–7:30pm.",
    evidence: "7 of 8 Tuesdays and 7 of 8 Thursdays.",
    keep: "Adds a standing Swim slot. Plan the week won't place work there.",
  },
];
const DRAFTED = ["Write the permission letter", "Send letters home", "Collect consent forms"];

export default function OffersHarness() {
  const phone = new URLSearchParams(location.search).has("phone");
  const [gone, setGone] = useState<string[]>([]);
  const [steps, setSteps] = useState<string[]>(["Confirm the date with the museum", "Book the coach"]);
  const [memDot, setMemDot] = useState(false);
  const offers = composeOffers({ thin: THIN, memory: MEMORY }).filter((o) => !gone.includes(o.key));

  const acts: OfferActs = {
    primary: (o: Offer, card) => {
      const to = o.kind === "memory" ? landingTarget("memory") : landingTarget("page");
      void collectInto(card, to).then(() => {
        if (o.kind === "path") setSteps((s) => [...s, ...DRAFTED.map((t) => `${t} (drafted)`)]);
        else setMemDot(true);
      });
      setGone((g) => [...g, o.key]);
    },
    refuse: (o) => setGone((g) => [...g, o.key]),
    notNow: (o) => setGone((g) => [...g, o.key]),
  };

  const reset = () => {
    setGone([]);
    setSteps(["Confirm the date with the museum", "Book the coach"]);
    setMemDot(false);
  };

  if (new URLSearchParams(location.search).has("sheet")) {
    // The phone's ✦ sheet — the real NuvoSheet over the fixture offers.
    const state = { offers, unseen: false, markSeen: () => {}, memoryItem: () => null } as unknown as NuvoOffersState;
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
        <NuvoSheet offers={state} memory={null} onClose={reset} onMemory={() => {}} onOpenProject={() => {}} onConnect={() => {}} />
        <Toaster />
      </div>
    );
  }

  if (phone) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", padding: 16, display: "grid", gap: 16, alignContent: "start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <b style={{ flex: 1 }}>Nuvo</b>
          <span data-land="memory" style={{ display: "inline-grid", width: 44, height: 44, placeItems: "center" }} className={memDot ? "sb-icon-dot" : undefined}>
            <MemoryIcon size={18} />
          </span>
        </div>
        <NuvoOffersView offers={offers} acts={acts} phone />
        <p className="text-caption" style={{ color: "var(--muted)", textAlign: "center" }}>Ask Nuvo about your week…</p>
        <button className="text-caption" style={{ color: "var(--accent)" }} onClick={reset}>Reset</button>
        <div data-land="page" style={{ height: 1 }} />
        <Toaster />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--ground)", padding: 12, display: "grid", gridTemplateColumns: "180px minmax(0,1fr) 380px", gap: 8 }}>
      <nav style={{ display: "flex", flexDirection: "column", gap: 4, padding: 8 }}>
        <span className="text-caption" style={{ color: "var(--muted)" }}>?offers — fixture teacher</span>
        <div style={{ flex: 1 }} />
        <div className="sb-item" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className={`sb-icon${memDot ? " sb-icon-dot" : ""}`} data-land="memory"><MemoryIcon /></span>
          <span className="sb-label">Memory</span>
        </div>
      </nav>
      <main data-land="page" style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 12, padding: 28 }}>
        <h1 className="text-display masthead" style={{ margin: "0 0 16px" }}>Spring field trip</h1>
        <div style={{ display: "grid", borderTop: "1px solid var(--line)" }}>
          {steps.map((s) => (
            <div key={s} style={{ padding: "10px 4px", borderBottom: "1px solid var(--line)", color: s.endsWith("(drafted)") ? "var(--ink-2)" : "var(--text)" }}>{s}</div>
          ))}
        </div>
        <button className="text-caption" style={{ color: "var(--accent)", marginTop: 16 }} onClick={reset}>Reset</button>
      </main>
      <aside className="chat agent-rail" style={{ display: "flex", flexDirection: "column" }}>
        <header className="chat-head"><span className="chat-title">Nuvo</span></header>
        <div className="chat-log">
          <div className="chat-empty">
            <NuvoOffersView offers={offers} acts={acts} />
            <p>Ask about this project.</p>
          </div>
        </div>
      </aside>
      <Toaster />
    </div>
  );
}
