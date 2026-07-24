const SKINS = [
  {
    name: 'Aurora',
    hint: 'Warm glass',
    swatches: [
      { bg: '#f4f1ea', accent: '#92568a' },
      { bg: '#17130e', accent: '#c692bf' },
      { bg: '#16151c', accent: '#9a86f0' },
    ],
  },
  {
    name: 'Flat',
    hint: 'Crisp UI',
    swatches: [
      { bg: '#ffffff', accent: '#92568a' },
      { bg: '#f6f8fc', accent: '#4f46e5' },
      { bg: '#fdfbf6', accent: '#b06a3c' },
    ],
  },
  {
    name: 'Terminal',
    hint: 'Editor nights',
    swatches: [
      { bg: '#0b0e0a', accent: '#8fef5a' },
      { bg: '#282a36', accent: '#bd93f9' },
      { bg: '#2e3440', accent: '#88c0d0' },
    ],
  },
  {
    name: 'Blueprint',
    hint: 'Drafting print',
    swatches: [
      { bg: '#0b1f3a', accent: '#5cc8ff' },
      { bg: '#f4f7fb', accent: '#1d4ed8' },
      { bg: '#2a2118', accent: '#d4a574' },
    ],
  },
  {
    name: 'E-Ink',
    hint: 'Restful paper',
    swatches: [
      { bg: '#f2f0ea', accent: '#3d3a34' },
      { bg: '#ebe4d4', accent: '#5c4a32' },
      { bg: '#e8ecef', accent: '#2f3a44' },
    ],
  },
] as const

export default function ThemesVisual() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-hidden="true">
      {SKINS.map((skin, i) => (
        <div
          key={skin.name}
          className="glass-card reveal overflow-hidden rounded-xl border border-[var(--line)]"
          style={{ animationDelay: `${0.05 * i}s` }}
        >
          <div className="flex h-16">
            {skin.swatches.map((s, j) => (
              <div key={j} className="relative flex-1" style={{ background: s.bg }}>
                <span
                  className="absolute bottom-2 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full"
                  style={{ background: s.accent }}
                />
              </div>
            ))}
          </div>
          <div className="border-t border-[var(--line)] px-3 py-2.5">
            <p className="text-[13px] font-medium text-[var(--text)]">{skin.name}</p>
            <p className="text-[11px] text-[var(--muted)]">{skin.hint}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
