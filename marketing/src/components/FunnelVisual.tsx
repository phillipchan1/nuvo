/** The vertical as one funnel — domain → day, nothing stranded. */

const STEPS = [
  { label: 'Domain', hint: 'what you carry', color: '#2563EB' },
  { label: 'Initiative', hint: 'the bet', color: '#7C3AED' },
  { label: 'Project', hint: 'the body of work', color: '#0D9488' },
  { label: 'Task', hint: 'the next move', color: '#92568a' },
  { label: 'Block', hint: 'on the calendar', color: '#e0620f' },
] as const

export default function FunnelVisual() {
  return (
    <div className="glass-card reveal rounded-2xl border border-[var(--line)] px-5 py-6 sm:px-7" aria-hidden="true">
      <p className="section-label text-[var(--muted)]">One funnel</p>
      <p className="masthead mt-2 text-[1.35rem] text-[var(--text)]">The whole vertical. One system.</p>
      <ol className="mt-6 space-y-0">
        {STEPS.map((s, i) => (
          <li key={s.label} className="relative flex gap-4 pb-5 last:pb-0">
            {i < STEPS.length - 1 && (
              <span
                className="absolute left-[11px] top-6 bottom-0 w-px bg-[var(--line-strong)]"
                aria-hidden
              />
            )}
            <span
              className="relative z-[1] mt-1 h-[22px] w-[22px] shrink-0 rounded-full border-2 bg-[var(--surface)]"
              style={{ borderColor: s.color }}
            />
            <div className="min-w-0 pt-0.5">
              <p className="text-[15px] font-medium text-[var(--text)]">{s.label}</p>
              <p className="text-[13px] text-[var(--muted)]">{s.hint}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-2 border-t border-[var(--line)] pt-4 text-[13px] leading-snug text-[var(--muted)]">
        A project can’t get stranded in another tool while your day lives somewhere else.
        Capture → backlog → Week → block — same rows, same truth.
      </p>
    </div>
  )
}
