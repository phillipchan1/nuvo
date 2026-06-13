import { useEffect, useState } from "react";

/* ── FontPlayground ──────────────────────────────────────────────────────────
   A temporary play widget for auditioning typefaces live. It overrides the
   --font-sans token on <html>, so the whole app (body + .mono + the calendar
   labels, everything that reads var(--font-sans)) reflows instantly. The choice
   persists to localStorage. Remove this component once a typeface is chosen.
   ──────────────────────────────────────────────────────────────────────────── */

type Face = { id: string; label: string; note: string; stack: string };

const FONTS: Face[] = [
  { id: "jakarta", label: "Plus Jakarta Sans", note: "current — wide, rounded", stack: `"Plus Jakarta Sans", system-ui, sans-serif` },
  { id: "inter", label: "Inter", note: "the neutral workhorse", stack: `"Inter Variable", system-ui, sans-serif` },
  { id: "geist", label: "Geist", note: "modern, tool-y, tight", stack: `"Geist Variable", system-ui, sans-serif` },
  { id: "manrope", label: "Manrope", note: "geometric, a hair warm", stack: `"Manrope Variable", system-ui, sans-serif` },
  { id: "figtree", label: "Figtree", note: "friendly, gentle curves", stack: `"Figtree Variable", system-ui, sans-serif` },
];

const KEY = "nuvo-font";

/** Apply the saved typeface as early as possible (called from main.tsx too). */
export function applySavedFont() {
  const saved = localStorage.getItem(KEY);
  const face = FONTS.find((f) => f.id === saved);
  if (face) document.documentElement.style.setProperty("--font-sans", face.stack);
}

export default function FontPlayground() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(() => localStorage.getItem(KEY) ?? "jakarta");

  useEffect(() => {
    const face = FONTS.find((f) => f.id === current) ?? FONTS[0];
    document.documentElement.style.setProperty("--font-sans", face.stack);
    localStorage.setItem(KEY, face.id);
  }, [current]);

  const cur = FONTS.find((f) => f.id === current) ?? FONTS[0];

  return (
    <div className="fixed bottom-3 right-3 z-[60] flex flex-col items-end gap-1.5">
      {open && (
        <div className="rise elev-3 w-60 overflow-hidden rounded-lg border border-line bg-surface/95 p-1 backdrop-blur">
          <div className="section-label flex items-center justify-between !px-2 !pb-1 !pt-1.5">
            <span>Typeface</span>
            <span className="mono text-[9px] normal-case tracking-normal text-muted/70">temp</span>
          </div>
          {FONTS.map((f) => {
            const on = f.id === current;
            return (
              <button
                key={f.id}
                onClick={() => setCurrent(f.id)}
                style={{ fontFamily: f.stack }}
                className={`fast flex w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left ${
                  on ? "bg-accent-soft" : "hover:bg-surface-2"
                }`}
              >
                <span className={`text-[14px] leading-tight ${on ? "font-bold text-accent" : "font-semibold text-ink"}`}>
                  {f.label}
                </span>
                <span className="text-[10px] leading-tight text-muted">{f.note}</span>
              </button>
            );
          })}
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        title="Audition typefaces"
        className="fast elev-2 flex items-center gap-1.5 rounded-full border border-line bg-surface/95 px-3 py-1.5 text-[12px] backdrop-blur hover:border-line-strong"
      >
        <span className="text-[15px] font-bold leading-none">Aa</span>
        <span className="text-muted">{cur.label.split(" ")[0]}</span>
      </button>
    </div>
  );
}
