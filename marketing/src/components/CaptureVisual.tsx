/** Floating Mac ⌥Space capture — the always-available front door. */

export default function CaptureVisual() {
  return (
    <div className="capture-visual relative" aria-hidden="true">
      {/* Soft desk behind the panel */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[color-mix(in_srgb,var(--text)_4%,transparent)]" />
      <div className="relative flex min-h-[220px] items-center justify-center px-4 py-10 sm:min-h-[260px] sm:px-8">
        <div className="reveal w-full max-w-md">
          <div className="mb-3 flex items-center justify-center gap-2">
            <span className="rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1 mono text-[11px] text-[var(--muted)] shadow-[var(--shadow-1)]">
              ⌥
            </span>
            <span className="rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1 mono text-[11px] text-[var(--muted)] shadow-[var(--shadow-1)]">
              Space
            </span>
            <span className="text-[12px] text-[var(--muted)]">anywhere on Mac</span>
          </div>

          <div className="glass-card overflow-hidden rounded-2xl border border-[var(--line)] shadow-[var(--shadow-lift)]">
            <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3.5">
              <span className="text-[var(--accent)]">✦</span>
              <p className="flex-1 text-[15px] text-[var(--text)]">
                follow up with SCE deck Friday 90m #work
                <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-[var(--accent)] align-middle" />
              </p>
            </div>
            <div className="space-y-2 px-4 py-3">
              <p className="section-label text-[var(--muted)]">Lands as</p>
              <div className="flex flex-wrap gap-2 text-[12px]">
                <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[var(--accent)]">
                  Inbox
                </span>
                <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[var(--muted)]">
                  Fri
                </span>
                <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[var(--muted)]">
                  90m
                </span>
                <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[var(--muted)]">
                  #work
                </span>
              </div>
              <p className="pt-1 text-[12px] leading-snug text-[var(--muted)]">
                Loose now. Route to a project, pull into the Week, or block the day — later.
                Nothing evaporates.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
