/** Domain strip — the areas you keep showing up in. */

const DOMAINS = [
  { name: 'Work', color: '#2563EB', vow: 'Produce what you promised.' },
  { name: 'Community', color: '#7C3AED', vow: 'Show up with presence.' },
  { name: 'Family', color: '#DB2777', vow: 'Be home when it counts.' },
  { name: 'Craft', color: '#0D9488', vow: 'Keep the practice alive.' },
]

export default function DomainVisual() {
  return (
    <div className="domain-visual grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
      {DOMAINS.map((d, i) => (
        <div
          key={d.name}
          className="glass-card reveal rounded-xl border border-[var(--line)] px-4 py-4"
          style={{ animationDelay: `${0.08 * i}s`, borderTop: `2px solid ${d.color}` }}
        >
          <p className="section-label" style={{ color: d.color }}>
            {d.name}
          </p>
          <p className="serif mt-3 text-[15px] leading-snug text-[var(--text)]">{d.vow}</p>
        </div>
      ))}
    </div>
  )
}
