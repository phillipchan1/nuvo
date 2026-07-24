const MOVES = [
  { k: '⌥Space', title: 'Capture from anywhere', body: 'Mac-wide. Mid-call, mid-Slack — get it out of your head.' },
  { k: '⌘J', title: 'Ask Nuvo', body: 'Scaffold, prepare, compose. Proposals stay quiet until you promote them.' },
  { k: 'Week', title: 'Commitment meter', body: 'Demand vs real capacity. See over-commit before Tuesday does.' },
  { k: '00:05', title: 'Midnight rollover', body: 'Unfinished day work returns to Today — time cleared, duration kept.' },
] as const

export default function OperatorVisual() {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-hidden="true">
      {MOVES.map((m, i) => (
        <div
          key={m.title}
          className="glass-card reveal rounded-xl border border-[var(--line)] px-4 py-4"
          style={{ animationDelay: `${0.06 * i}s` }}
        >
          <p className="mono text-[12px] font-medium text-[var(--accent)]">{m.k}</p>
          <p className="mt-2 text-[15px] font-medium text-[var(--text)]">{m.title}</p>
          <p className="mt-1.5 text-[13px] leading-snug text-[var(--muted)]">{m.body}</p>
        </div>
      ))}
    </div>
  )
}
