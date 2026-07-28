import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { SKIN_LABELS, useSkin, type Skin } from "../hooks/useSkin";
import { Btn, Keycap, Modal, PriorityDot, RollBadge, SectionLabel } from "../components/ui";
import {
  Checkbox,
  Field,
  FieldGroup,
  Segmented,
  Select,
  Stepper,
  TextInput,
  Toggle,
} from "../components/form";

/* ── The gallery ───────────────────────────────────────────────────────────
   Every token and every primitive, in every state, in both themes, in any
   material — on one page, reached at `?gallery` (dev only, no auth, no shell,
   following the ?emblem / ?planweek harness convention in main.tsx).

   This exists because the app had 126 components, 40,711 lines of TSX and no
   single place to LOOK at the system. Without that, "is this consistent" was
   unanswerable and every new surface re-invented its own spacing. The rule
   this page enforces: a primitive that isn't here isn't finished, and anything
   arriving from outside (a Dribbble shot, a 21st.dev component, an Untitled UI
   import) enters HERE first — with all of its states — before it touches a
   screen. If it can't survive the state matrix, it was a picture.

   Dogfooding note: this file uses the ratified spacing scale (`p-s4`, `gap-s3`)
   exclusively. If something can't be built from those seven steps, that's a
   finding about the scale, not a licence to reach for `gap-1.5`.            */

const SKINS = Object.keys(SKIN_LABELS) as Skin[];

// ── Page scaffolding ───────────────────────────────────────────────────────

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-s5">
      <h2 className="text-head font-semibold text-ink">{title}</h2>
      {note && <p className="mt-s1 max-w-prose text-caption leading-relaxed text-muted">{note}</p>}
      <div className="mt-s4">{children}</div>
    </section>
  );
}

/** A labelled specimen. The label is part of the spec — an unnamed swatch
 *  can't be referenced in a review, which is how drift starts. */
function Spec({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-s2">
      <div className="text-micro uppercase tracking-wider text-muted">{label}</div>
      <div className="flex flex-wrap items-center gap-s2">{children}</div>
    </div>
  );
}

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-s2">
      <span
        className="h-8 w-8 shrink-0 rounded border border-line"
        style={{ background: `var(${value})` }}
      />
      <span className="min-w-0">
        <span className="block truncate text-caption text-ink">{name}</span>
        <span className="mono block truncate text-micro text-muted">{value}</span>
      </span>
    </div>
  );
}

// ── Sections ───────────────────────────────────────────────────────────────

const ROLE_TOKENS: [string, string][] = [
  ["Canvas", "--bg"],
  ["Surface", "--surface"],
  ["Surface 2", "--surface-2"],
  ["Line", "--line"],
  ["Line strong", "--line-strong"],
  ["Ink", "--text"],
  ["Muted", "--muted"],
  ["Accent — intent", "--accent"],
  ["Accent 2", "--accent-2"],
];

const TIME_TOKENS: [string, string][] = [
  ["Now", "--now"],
  ["Now soft", "--now-soft"],
  ["Slot — claimable", "--slot"],
  ["Slot soft", "--slot-soft"],
  ["Busy — not yours", "--busy"],
  ["Span", "--span"],
];

const HUES = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];

const SPACE_STEPS: [string, string, string][] = [
  ["s1", "4px", "hairline gaps — icon↔label"],
  ["s2", "8px", "default gap in a row"],
  ["s3", "12px", "padding inside a card"],
  ["s4", "16px", "between distinct elements"],
  ["s5", "24px", "between groups"],
  ["s6", "32px", "section separation"],
  ["s7", "48px", "major region separation"],
];

const TYPE_STEPS = [
  "text-display",
  "text-lead",
  "text-head",
  "text-body",
  "text-caption",
  "text-label",
  "text-meta",
  "text-micro",
];

function Tokens({ skin }: { skin: Skin }) {
  return (
    <>
      <Section
        title="Colour — roles"
        note="Every colour names a role. If you can't say what a colour means, it doesn't belong on the page."
      >
        <div className="grid grid-cols-2 gap-s3 sm:grid-cols-3 lg:grid-cols-4">
          {ROLE_TOKENS.map(([name, value]) => (
            <Swatch key={value} name={name} value={value} />
          ))}
        </div>
      </Section>

      <Section
        title="Colour — time"
        note="Net-new. Notion is a document tool and has no vocabulary for time, so these four roles are derived from Notion's own palette logic — overdue orange for now, its blue for claimable, its grey for occupied, neutral for span."
      >
        <div className="grid grid-cols-2 gap-s3 sm:grid-cols-3 lg:grid-cols-4">
          {TIME_TOKENS.map(([name, value]) => (
            <Swatch key={value} name={name} value={value} />
          ))}
        </div>
      </Section>

      {skin === "notion" && (
        <Section
          title="Colour — identity palette"
          note="Notion's nine text colours and their matched background fills, verbatim. A domain picks one and every initiative, project and task beneath it inherits. Text and fill are a pair — never mix across rows."
        >
          <div className="grid grid-cols-1 gap-s2 sm:grid-cols-2 lg:grid-cols-3">
            {HUES.map((h) => (
              <div
                key={h}
                className="flex items-center justify-between gap-s3 rounded px-s3 py-s2"
                style={{ background: `var(--hue-${h}-bg)` }}
              >
                <span className="text-body font-medium" style={{ color: `var(--hue-${h})` }}>
                  {h}
                </span>
                <span className="mono text-micro" style={{ color: `var(--hue-${h})` }}>
                  --hue-{h}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Spacing — the ratified scale"
        note="Seven steps on a strict 4px unit, and nothing between them. Measured before this existed: 32% of the app's 3,053 spacing utilities sat off the grid, across 20 distinct values. Type had zero drift over the same code — because type had names and spacing didn't."
      >
        <div className="flex flex-col gap-s2">
          {SPACE_STEPS.map(([name, px, use]) => (
            <div key={name} className="flex items-center gap-s3">
              <span className="mono w-8 shrink-0 text-caption text-ink">{name}</span>
              <span className="mono w-12 shrink-0 text-micro text-muted">{px}</span>
              <span
                className="h-4 shrink-0 rounded-sm"
                style={{ width: px, background: "var(--accent)" }}
              />
              <span className="min-w-0 truncate text-caption text-muted">{use}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type" note="One ladder. Zero raw Tailwind sizes anywhere in the app — keep it that way.">
        <div className="flex flex-col gap-s3">
          {TYPE_STEPS.map((t) => (
            <div key={t} className="flex flex-wrap items-baseline gap-s3">
              <span className="mono w-24 shrink-0 text-micro text-muted">{t}</span>
              <span className={`${t} text-ink`}>The week is the unit of intent</span>
            </div>
          ))}
          <div className="flex flex-wrap items-baseline gap-s3">
            <span className="mono w-24 shrink-0 text-micro text-muted">.masthead</span>
            <span className="text-display masthead text-ink">The week is the unit of intent</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-s3">
            <span className="mono w-24 shrink-0 text-micro text-muted">.mono</span>
            <span className="mono text-body text-ink">09:30 · 4 of 7 · 82%</span>
          </div>
        </div>
      </Section>

      <Section
        title="Radius & elevation"
        note="In the Notion material a resting thing has a border and no shadow; only a floating thing casts. shadow-1 is deliberately none."
      >
        <div className="flex flex-col gap-s5">
          <Spec label="radius">
            {["sm", "", "lg"].map((r) => (
              <span
                key={r || "base"}
                className="flex h-16 w-16 items-center justify-center border border-line bg-surface text-micro text-muted"
                style={{ borderRadius: `var(--radius${r ? `-${r}` : ""})` }}
              >
                {r || "base"}
              </span>
            ))}
          </Spec>
          <Spec label="elevation">
            {["--shadow-1", "--shadow-2", "--shadow-3", "--shadow-lift"].map((s) => (
              <span
                key={s}
                className="flex h-16 w-28 items-center justify-center rounded bg-surface text-micro text-muted"
                style={{ boxShadow: `var(${s})` }}
              >
                {s.replace("--shadow-", "")}
              </span>
            ))}
          </Spec>
        </div>
      </Section>
    </>
  );
}

function Primitives() {
  const [modal, setModal] = useState(false);
  const [toggle, setToggle] = useState(true);
  const [check, setCheck] = useState(true);
  const [step, setStep] = useState(3);
  const [seg, setSeg] = useState<"today" | "week" | "inbox">("week");

  return (
    <>
      <Section
        title="Buttons"
        note="Three kinds × four states. This is the whole matrix — if a state isn't drawn here, it isn't specified."
      >
        <div className="flex flex-col gap-s4">
          {(["primary", "ghost", "signal"] as const).map((kind) => (
            <Spec key={kind} label={kind}>
              <Btn kind={kind}>Default</Btn>
              <Btn kind={kind} disabled>
                Disabled
              </Btn>
              <Btn kind={kind} title="Has a tooltip">
                With title
              </Btn>
              <Btn kind={kind} className="w-full sm:w-auto">
                Full-width ≤sm
              </Btn>
            </Spec>
          ))}
        </div>
      </Section>

      <Section title="Form primitives" note="Every field surface comes from `.field` — 40px desktop, 44px on a phone.">
        <div className="max-w-xl rounded-lg border border-line bg-surface px-s4">
          <FieldGroup>
            <Field title="Text" desc="Plain input so iOS dictation works out of the box." htmlFor="g-text">
              <TextInput id="g-text" defaultValue="Call David tomorrow 9am 30m" className="sm:w-72" />
            </Field>
            <Field title="Select" desc="Native select, our chevron." htmlFor="g-select">
              <Select id="g-select" className="w-full sm:w-40" defaultValue="week">
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </Select>
            </Field>
            <Field title="Toggle" desc="The app's on/off switch.">
              <Toggle checked={toggle} onChange={setToggle} label="Demo toggle" />
            </Field>
            <Field title="Checkbox" desc="When a switch would be too heavy.">
              {/* NOTE: Toggle names its accessible label `label`, Checkbox uses
                  `children`. Two words for one idea — the gallery surfaced this
                  the first time both were drawn side by side. Logged as an API
                  fix in docs/design-system.md rather than patched silently. */}
              <Checkbox checked={check} onChange={setCheck}>
                Include weekends
              </Checkbox>
            </Field>
            <Field title="Stepper" desc="Bounded numbers.">
              <Stepper value={step} onChange={setStep} min={0} max={10} />
            </Field>
            <Field title="Segmented" desc="Two to four exclusive choices.">
              <Segmented
                value={seg}
                onChange={setSeg}
                options={[
                  { value: "today", label: "Today" },
                  { value: "week", label: "Week" },
                  { value: "inbox", label: "Inbox" },
                ]}
              />
            </Field>
          </FieldGroup>
        </div>
      </Section>

      <Section title="Marks & labels">
        <div className="flex flex-col gap-s5">
          <Spec label="section label">
            <div className="w-48 border border-line bg-surface">
              <SectionLabel>Needs you</SectionLabel>
            </div>
            <div className="w-48 border border-line bg-surface">
              <SectionLabel open={false} onToggle={() => {}} count={4}>
                Loose ends
              </SectionLabel>
            </div>
          </Spec>
          <Spec label="priority dot">
            {["high", "medium", "low"].map((p) => (
              <span key={p} className="flex items-center gap-s1 text-caption text-muted">
                <PriorityDot priority={p} />
                {p}
              </span>
            ))}
          </Spec>
          <Spec label="roll badge">
            <RollBadge count={2} />
            <RollBadge count={14} />
          </Spec>
          <Spec label="keycap">
            <Keycap>⌘</Keycap>
            <Keycap>K</Keycap>
            <Keycap>Esc</Keycap>
          </Spec>
        </div>
      </Section>

      <Section
        title="Surfaces"
        note="Resting glass vs the focal state. In the Notion material focus does NOT lift — it takes a tinted fill and stays flat. That is the one place Notion actively contradicts Warm Paper."
      >
        <div className="flex flex-wrap gap-s3">
          <div className="glass-card w-56 rounded-lg p-s3">
            <div className="text-body font-medium text-ink">Resting card</div>
            <div className="mt-s1 text-caption text-muted">.glass-card</div>
          </div>
          <div className="glass-card glass-lift w-56 rounded-lg p-s3">
            <div className="text-body font-medium text-ink">Focal card</div>
            <div className="mt-s1 text-caption text-muted">.glass-lift</div>
          </div>
          <div className="glass-card glass-grab w-56 rounded-lg p-s3">
            <div className="text-body font-medium text-ink">Held card</div>
            <div className="mt-s1 text-caption text-muted">.glass-grab</div>
          </div>
        </div>
      </Section>

      <Section title="Overlay">
        <Btn kind="primary" onClick={() => setModal(true)}>
          Open modal
        </Btn>
        {modal && (
          <Modal onClose={() => setModal(false)}>
            <div className="p-s5">
              <h3 className="text-lead masthead text-ink">A modal</h3>
              <p className="mt-s2 text-body text-muted">
                Mobile-first base, desktop restored at <span className="mono">sm:</span>. Escape closes it.
              </p>
              <div className="mt-s4 flex justify-end gap-s2">
                <Btn onClick={() => setModal(false)}>Cancel</Btn>
                <Btn kind="primary" onClick={() => setModal(false)}>
                  Done
                </Btn>
              </div>
            </div>
          </Modal>
        )}
      </Section>
    </>
  );
}

// ── The harness ────────────────────────────────────────────────────────────

export default function Gallery() {
  const [skin, setSkin] = useSkin();
  const [dark, setDark] = useState(false);
  const [width, setWidth] = useState(window.innerWidth);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="atmosphere min-h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-s4 pb-s7 pt-s5">
        <header className="flex flex-col gap-s3 border-b border-line pb-s4">
          <div className="flex flex-wrap items-baseline justify-between gap-s2">
            <h1 className="text-display masthead text-ink">Gallery</h1>
            <span className="mono text-micro text-muted">
              {width}px · {width < 768 ? "mobile shell" : "desktop"}
            </span>
          </div>
          <p className="max-w-prose text-caption leading-relaxed text-muted">
            Every token and primitive, every state, both themes, any material. A primitive that isn't
            on this page isn't finished — and anything from outside enters here, with its full state
            matrix, before it touches a screen.
          </p>
          <div className="flex flex-wrap items-center gap-s2">
            {SKINS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSkin(s)}
                aria-pressed={skin === s}
                className={`tap rounded-full border px-s3 py-s1 text-caption ${
                  skin === s
                    ? "border-accent bg-accent-soft text-ink"
                    : "border-line text-muted hover:border-line-strong hover:text-ink"
                }`}
              >
                {SKIN_LABELS[s].name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setDark((d) => !d)}
              className="tap ml-auto rounded-full border border-line px-s3 py-s1 text-caption text-muted hover:border-line-strong hover:text-ink"
            >
              {dark ? "Dark" : "Light"}
            </button>
          </div>
        </header>

        <div className="flex flex-col gap-s6 pt-s5">
          <Tokens skin={skin} />
          <Primitives />
        </div>
      </div>
    </div>
  );
}
