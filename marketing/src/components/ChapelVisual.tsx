/**
 * The Domain floor — recreated from the real screen, driven 2026-07-27.
 *
 * On screen: the domain's name in Fraunces under its sigil, the vow beneath it in
 * italic, a status line ("GROOMED TODAY — 0.3H KEPT THIS WEEK"), then THE LAST
 * QUARTER with its question *are you still showing up?*, thirteen weekly bars,
 * and the app's own sentence — *Kept faith 5 of the last 13 weeks. Longest quiet
 * stretch: 7 weeks.* Then THE GAIN: what this domain has actually cost you.
 *
 * Nothing here is dramatized. The most damning line on the page is a sentence the
 * product already writes about you, which is the whole reason it belongs here.
 */

const CRAFT = '#B45309'

/** Thirteen weeks. 0 = a week you didn't show up. */
const PULSE = [0, 0, 0, 0, 0, 0, 0, 34, 12, 0, 22, 0, 8]

export default function ChapelVisual() {
  return (
    <div
      className="glass-card overflow-hidden rounded-2xl border border-[var(--line)] shadow-[var(--shadow-3)]"
      aria-hidden="true"
    >
      {/* the crown */}
      <div className="border-b border-[var(--line)] px-5 py-8 text-center sm:py-10">
        <span
          className="mx-auto block h-7 w-7 rounded-full border-2"
          style={{ borderColor: CRAFT, background: `color-mix(in srgb, ${CRAFT} 18%, transparent)` }}
        />
        <p className="masthead mt-4 text-[2rem] leading-none text-[var(--text)]">Craft</p>
        <p className="serif mx-auto mt-3 max-w-sm text-[1rem] italic leading-snug text-[var(--muted)]">
          Become the kind of builder people trust with the hard thing.
        </p>
        <p className="section-label mt-4 text-[10px] text-[var(--muted)]">
          Groomed today — 1.5h kept this week
        </p>
      </div>

      {/* the quarter */}
      <div className="border-b border-[var(--line)] px-5 py-5">
        <p className="section-label text-[var(--muted)]">The last quarter</p>
        <p className="serif text-[13px] italic text-[var(--muted)]">are you still showing up?</p>

        <div className="mt-4 flex h-14 items-end justify-between">
          {PULSE.map((v, i) => (
            <span
              key={i}
              className="w-3 rounded-full"
              style={{
                height: v === 0 ? 4 : `${Math.max(26, (v / 34) * 100)}%`,
                background: v === 0 ? 'var(--line-strong)' : CRAFT,
              }}
            />
          ))}
        </div>

        <p className="mt-3 text-[13px] leading-snug">
          <span style={{ color: CRAFT }}>Kept faith 5 of the last 13 weeks.</span>{' '}
          <span className="text-[var(--muted)]">Longest quiet stretch: 7 weeks.</span>
        </p>
      </div>

      {/* the gain */}
      <div className="px-5 py-5">
        <p className="section-label text-[var(--muted)]">The gain</p>
        <p className="serif text-[13px] italic text-[var(--muted)]">what this domain has cost you</p>
        <dl className="mt-4 grid grid-cols-2 gap-y-4 sm:grid-cols-4">
          {[
            ['10', 'h', 'this quarter'],
            ['1.5', 'h', 'this week'],
            ['3', 'wk', 'current streak'],
            ['17', '', 'blocks done'],
          ].map(([n, unit, label]) => (
            <div key={label}>
              <dd className="mono text-[1.5rem] leading-none text-[var(--text)]">
                {n}
                <span className="text-[0.875rem] text-[var(--muted)]">{unit}</span>
              </dd>
              <dt className="section-label mt-1 text-[9px] text-[var(--muted)]">{label}</dt>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
