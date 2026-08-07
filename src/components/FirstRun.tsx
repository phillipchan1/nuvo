// First run — the domain picker.
//
// Signup no longer seeds domains (migration 42), so a brand-new account arrives
// here with nothing. This is the one natural moment to teach what a domain *is*,
// so we teach by asking rather than by asserting: the account picks the kinds it
// carries and names them itself.
//
// Kinds come from docs/product/personas.md §1 — the five shapes a standing
// domain takes. The names vary per operator; the kinds don't. Nothing here is
// prescriptive: every row is optional, every name is an editable plain <input>
// (so iOS dictation works), and "add your own" is always available.
import { useState } from "react";
import { useVertical } from "../hooks/useVertical";

type Kind = {
  key: string;
  kind: string;
  prompt: string;
  examples: string;
  suggested: string;
  color: string;
  /** A worked example of a charter — the line Nuvo's routing is built on. */
  charterHint: string;
};

// Colors are data (a domain's identity tint), not theme tokens — same hexes the
// domain swatch picker offers in DomainFloor.
//
// Each row leads with a plain question, not an abstract category noun — "Work" or
// "Discipline" reads as Nuvo's vocabulary, not yours. `kind` survives only as an
// internal id (color mapping, key prop); it is never rendered.
const KINDS: Kind[] = [
  {
    key: "work",
    charterHint: "e.g. \"My day job at SCE — Obi, the Enterprise rollout\"",
    kind: "Work",
    prompt: "What pays the bills?",
    examples: "Work · Company · Clients · Practice",
    suggested: "Work",
    color: "#2563EB",
  },
  {
    key: "community",
    charterHint: "e.g. \"Frontier — Sunday services, the volunteer teams\"",
    kind: "Community",
    prompt: "Who's counting on you to show up?",
    examples: "Church · Board · Coaching · Volunteering",
    suggested: "Community",
    color: "#7C3AED",
  },
  {
    key: "discipline",
    charterHint: "e.g. \"Trading — my setups, the backtester, the journal\"",
    kind: "Discipline",
    prompt: "What craft do you protect time for?",
    examples: "Trading · Training · Writing · Study",
    suggested: "Discipline",
    color: "#0D9488",
  },
  {
    key: "people",
    charterHint: "e.g. \"Home — Sarah, the kids, school runs, family admin\"",
    kind: "People",
    prompt: "Who do you love that never files a ticket?",
    examples: "Family · Marriage · Friends",
    suggested: "Family",
    color: "#DB2777",
  },
  {
    key: "stewardship",
    charterHint: "e.g. \"Money and body — the books, Dext, the gym\"",
    kind: "Stewardship",
    prompt: "What costs you later if you ignore it now?",
    examples: "Finances · Health · Home",
    suggested: "Health",
    color: "#059669",
  },
];

const EXTRA_COLORS = ["#D97706", "#4F46E5", "#0891B2", "#65A30D", "#DC2626"];

export default function FirstRun({ onSkip }: { onSkip: () => void }) {
  const { seedDomains } = useVertical();
  const [picked, setPicked] = useState<Record<string, string>>({});
  // What each domain IS, in the person's own words. Optional by design — every
  // field can stay blank and the account is fully usable — but it is the one
  // input the routers are built on, and asking for it once here is far cheaper
  // than discovering months later that everything files into the wrong place.
  const [charters, setCharters] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (k: Kind) =>
    setPicked((p) => {
      const next = { ...p };
      if (k.key in next) delete next[k.key];
      else next[k.key] = "";
      return next;
    });

  const chosen = [
    ...KINDS.filter((k) => k.key in picked).map((k) => ({
      name: picked[k.key].trim() || k.suggested,
      color: k.color,
      charter: charters[k.key] ?? "",
    })),
    ...extras.map((name, i) => ({
      name: name.trim(),
      color: EXTRA_COLORS[i % EXTRA_COLORS.length],
      charter: charters[`extra-${i}`] ?? "",
    })),
  ].filter((d) => d.name.length > 0);

  const create = async () => {
    if (!chosen.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      await seedDomains(chosen);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create those. Try again.");
      setBusy(false);
    }
  };

  return (
    <div className="atmosphere h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-5 pb-24 pt-safe sm:px-8">
        <header className="pt-10 sm:pt-16">
          <h1 className="masthead text-display text-ink">What are you carrying?</h1>
          <p className="mt-4 max-w-lg text-body text-muted">
            A <span className="text-ink">domain</span> is an area you're responsible for over the
            long run — not a project and not a list. <span className="text-ink">Work</span> is a
            domain; <span className="italic">shipping the new site</span> is a project inside it.
          </p>
          <p className="mt-3 max-w-lg text-caption text-muted">
            Pick the ones you carry and name them the way you'd say them out loud. A line about
            who and what belongs in each is optional — but it's what lets Nuvo file a stray note or
            a meeting into the right one without asking. You can rename, add, or remove any of this
            later.
          </p>
        </header>

        <ul className="mt-8 border-t border-line">
          {KINDS.map((k) => {
            const on = k.key in picked;
            return (
              <li key={k.key} className="border-b border-line">
                <div className="flex items-start gap-3 py-3">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(k)}
                    className="tap fast -ml-1 flex min-h-[44px] flex-1 items-start gap-3 rounded-md px-1 text-left"
                  >
                    <span
                      aria-hidden
                      className="mt-[3px] h-4 w-4 shrink-0 rounded-full border"
                      style={{
                        borderColor: on ? k.color : "var(--line-strong)",
                        background: on ? k.color : "transparent",
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block text-body text-ink">{k.prompt}</span>
                      {!on && (
                        <span className="mt-1 block text-caption text-muted">{k.examples}</span>
                      )}
                    </span>
                  </button>
                </div>

                {on && (
                  <div className="-mt-1 pb-3 pl-7">
                    <label className="section-label block text-muted" htmlFor={`d-${k.key}`}>
                      Call it
                    </label>
                    <input
                      id={`d-${k.key}`}
                      type="text"
                      value={picked[k.key]}
                      autoComplete="off"
                      onChange={(e) => setPicked((p) => ({ ...p, [k.key]: e.target.value }))}
                      placeholder={k.suggested}
                      className="tap mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink placeholder:text-muted"
                    />
                    <label className="section-label mt-3 block text-muted" htmlFor={`c-${k.key}`}>
                      Who and what belongs here <span className="normal-case tracking-normal">(optional)</span>
                    </label>
                    <input
                      id={`c-${k.key}`}
                      type="text"
                      value={charters[k.key] ?? ""}
                      autoComplete="off"
                      onChange={(e) => setCharters((c) => ({ ...c, [k.key]: e.target.value }))}
                      placeholder={k.charterHint}
                      className="tap mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink placeholder:text-muted"
                    />
                  </div>
                )}
              </li>
            );
          })}

          {extras.map((name, i) => (
            <li key={`extra-${i}`} className="border-b border-line py-3">
              <label className="section-label block text-muted" htmlFor={`x-${i}`}>
                Your own
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id={`x-${i}`}
                  type="text"
                  value={name}
                  autoFocus
                  autoComplete="off"
                  onChange={(e) => setExtras((x) => x.map((v, j) => (j === i ? e.target.value : v)))}
                  placeholder="Name it"
                  className="tap w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink placeholder:text-muted"
                />
                <button
                  type="button"
                  onClick={() => setExtras((x) => x.filter((_, j) => j !== i))}
                  className="tap fast shrink-0 rounded-md px-3 py-2 text-caption text-muted hover:text-ink"
                >
                  Remove
                </button>
              </div>
              <input
                type="text"
                value={charters[`extra-${i}`] ?? ""}
                autoComplete="off"
                onChange={(e) => setCharters((c) => ({ ...c, [`extra-${i}`]: e.target.value }))}
                placeholder="Who and what belongs here? (optional)"
                className="tap mt-2 w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink placeholder:text-muted"
              />
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => setExtras((x) => [...x, ""])}
          className="tap fast mt-3 min-h-[44px] text-caption text-accent"
        >
          + Add one of your own
        </button>

        {error && <p className="mt-4 text-caption text-signal">{error}</p>}

        <div className="mt-8 flex flex-wrap items-center gap-3 pb-safe">
          <button
            type="button"
            disabled={!chosen.length || busy}
            onClick={create}
            className="tap fast min-h-[44px] rounded-md bg-accent px-4 py-2.5 text-body font-medium text-on-accent disabled:bg-surface-2 disabled:text-muted disabled:shadow-none"
          >
            {busy
              ? "Setting up…"
              : chosen.length
                ? `Create ${chosen.length} domain${chosen.length === 1 ? "" : "s"}`
                : "Pick at least one"}
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="tap fast min-h-[44px] px-2 text-caption text-muted hover:text-ink"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
