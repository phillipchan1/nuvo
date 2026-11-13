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
import { Button, Checkbox, Dot, FormField, Input } from "./kit";
import { Icon } from "./Icon";
import { StatementPage } from "./statement/StatementPage";

type Kind = {
  key: string;
  kind: string;
  prompt: string;
  examples: string;
  suggested: string;
  color: string;
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
    kind: "Work",
    prompt: "What pays the bills?",
    examples: "Work · Company · Clients · Practice",
    suggested: "Work",
    color: "#2563EB",
  },
  {
    key: "community",
    kind: "Community",
    prompt: "Who's counting on you to show up?",
    examples: "Church · Board · Coaching · Volunteering",
    suggested: "Community",
    color: "#7C3AED",
  },
  {
    key: "discipline",
    kind: "Discipline",
    prompt: "What craft do you protect time for?",
    examples: "Trading · Training · Writing · Study",
    suggested: "Discipline",
    color: "#0D9488",
  },
  {
    key: "people",
    kind: "People",
    prompt: "Who do you love that never files a ticket?",
    examples: "Family · Marriage · Friends",
    suggested: "Family",
    color: "#DB2777",
  },
  {
    key: "stewardship",
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
    })),
    ...extras.map((name, i) => ({ name: name.trim(), color: EXTRA_COLORS[i % EXTRA_COLORS.length] })),
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
    // A statement page (D-192): the stage asks the question, the door holds
    // the kinds as kit rows and the act bottom-right. One page on a phone.
    <div className="h-full overflow-y-auto">
      <StatementPage
        wide
        kicker="Set up Nuvo"
        hero={
          <>
            Name what
            <br />
            you&rsquo;re carrying
          </>
        }
      >
          <p className="st-lead">A domain is an area you're responsible for over the long run — not a project, not a list. Name them the way you'd say them out loud.</p>

          <ul className="grid" style={{ boxShadow: "inset 0 1px 0 var(--line-1), inset 0 -1px 0 var(--line-1)" }}>
            {KINDS.map((k) => {
              const on = k.key in picked;
              return (
                <li key={k.key} style={{ boxShadow: "inset 0 -1px 0 var(--line-1)" }}>
                  {/* The checkbox is the control (its name is the question); the
                      whole row is its label, so the row is its hit area and the
                      keyboard reaches it through the checkbox itself. */}
                  <label className="f-kind flex min-h-[52px] items-start gap-3 rounded-[var(--r-ctl)] px-1 py-3">
                    <span className="flex h-5 items-center">
                      <Checkbox checked={on} onChange={() => toggle(k)} label={k.prompt} />
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="text-body font-medium text-[var(--ink)]">{k.prompt}</span>
                      {!on && <span className="text-caption text-muted">{k.examples}</span>}
                    </span>
                    <span className="flex h-5 items-center">
                      <Dot color={k.color} />
                    </span>
                  </label>

                  {on && (
                    <div className="pb-3 pl-8 pr-1">
                      <FormField label="Call it">
                        {(id) => (
                          <Input
                            id={id}
                            type="text"
                            value={picked[k.key]}
                            autoComplete="off"
                            onChange={(e) => setPicked((p) => ({ ...p, [k.key]: e.target.value }))}
                            placeholder={k.suggested}
                          />
                        )}
                      </FormField>
                    </div>
                  )}
                </li>
              );
            })}

            {extras.map((name, i) => (
              <li key={`extra-${i}`} className="py-3 pl-8 pr-1" style={{ boxShadow: "inset 0 -1px 0 var(--line-1)" }}>
                <FormField label="Your own">
                  {(id) => (
                    <span className="flex items-center gap-2">
                      <Input
                        id={id}
                        type="text"
                        value={name}
                        autoFocus
                        autoComplete="off"
                        onChange={(e) => setExtras((x) => x.map((v, j) => (j === i ? e.target.value : v)))}
                        placeholder="Name it"
                        frameClassName="flex-1"
                      />
                      <Button kind="ghost" size="md" onClick={() => setExtras((x) => x.filter((_, j) => j !== i))}>
                        Remove
                      </Button>
                    </span>
                  )}
                </FormField>
              </li>
            ))}
          </ul>

          <div className="mt-3">
            <Button kind="ghost" icon={<Icon name="plus" size={14} />} onClick={() => setExtras((x) => [...x, ""])}>
              Add one of your own
            </Button>
          </div>

          {error && <p className="f-error mt-3">{error}</p>}

          <div className="f-card-foot">
            <span className="f-sum">Change any of this later.</span>
            <Button kind="ghost" size="md" onClick={onSkip}>
              Skip for now
            </Button>
            <Button kind="primary" size="md" disabled={!chosen.length || busy} onClick={create}>
              {busy
                ? "Setting up…"
                : chosen.length
                  ? `Create ${chosen.length} domain${chosen.length === 1 ? "" : "s"}`
                  : "Pick at least one"}
            </Button>
          </div>
      </StatementPage>
    </div>
  );
}
