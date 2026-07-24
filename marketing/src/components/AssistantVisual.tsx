/**
 * Nuvo, the assistant — shown the way the app shows it: it doesn't describe what
 * it did, it renders live record cards you can keep or undo. Ask in plain
 * language → a short reply → real, dated, scheduled work as cards, each with an
 * Undo. Faithful nod to AgentMessageBubble + AgentRecordCards.
 */

const TINT = '#2563EB' // Meridian lives in Work

const CARDS = [
  { title: 'Draft the launch email', chips: ['Tue', '9:00 · 45m', 'Meridian'], verb: 'Scheduled' },
  { title: 'Dry-run with the team', chips: ['Wed', '2:00 · 30m', 'Meridian'], verb: 'Scheduled' },
  { title: 'Ship the announcement', chips: ['Fri', '10:00 · 60m', 'Meridian'], verb: 'Scheduled' },
]

function RecordCard({ c }: { c: (typeof CARDS)[number] }) {
  return (
    <div
      className="rounded-lg border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_75%,transparent)] px-3 py-2.5"
      style={{ borderLeft: `3px solid ${TINT}` }}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: TINT }} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-[var(--text)]">{c.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {c.chips.map((chip) => (
              <span
                key={chip}
                className="truncate rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--muted)]"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>
        <span className="section-label shrink-0 text-[9px] text-[var(--muted)]">{c.verb}</span>
      </div>
      <div className="mt-2 flex border-t border-[var(--line)] pt-1.5">
        <span className="ml-auto rounded-full border border-[var(--line)] px-2.5 py-1 text-[10px] text-[var(--muted)]">
          Undo
        </span>
      </div>
    </div>
  )
}

export default function AssistantVisual() {
  return (
    <div
      className="glass-card overflow-hidden rounded-2xl border border-[var(--line)] shadow-[var(--shadow-3)]"
      aria-hidden="true"
    >
      {/* header */}
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
        <span className="text-[var(--accent)]">✦</span>
        <span className="text-[13px] font-medium text-[var(--text)]">Nuvo</span>
      </div>

      <div className="space-y-3 px-4 py-4">
        {/* user ask */}
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--accent-soft)] px-3.5 py-2 text-[13px] text-[var(--text)]">
            Plan my Meridian launch this week
          </div>
        </div>

        {/* assistant reply + records */}
        <div className="flex justify-start">
          <div className="w-full">
            <p className="mb-2.5 max-w-[92%] text-[13px] leading-relaxed text-[var(--muted)]">
              Here’s a first pass — three blocks across your open mornings. Keep what works, undo
              the rest.
            </p>
            <div className="space-y-2">
              {CARDS.map((c) => (
                <RecordCard key={c.title} c={c} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* composer */}
      <div className="border-t border-[var(--line)] px-4 py-3">
        <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_70%,transparent)] px-3.5 py-2">
          <span className="text-[var(--accent)]">✦</span>
          <span className="flex-1 text-[13px] text-[var(--muted)]">Ask Nuvo to plan, draft, or prepare…</span>
        </div>
      </div>
    </div>
  )
}
