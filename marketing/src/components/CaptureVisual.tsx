/** Floating Mac ⌥Space capture — types itself, then parses into chips on view. */

import { useEffect, useState } from 'react'
import { prefersReducedMotion, useInView } from '../useInView'

const PHRASE = 'follow up with SCE deck Friday 90m #work'
const CHIPS = [
  { t: 'Inbox', accent: true },
  { t: 'Fri', accent: false },
  { t: '90m', accent: false },
  { t: '#work', accent: false },
]

export default function CaptureVisual() {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.5 })
  // Default to the FINISHED state so the panel is always correct even if the
  // observer never fires; replay the typing only when it scrolls into view.
  const [typed, setTyped] = useState(PHRASE)
  const [done, setDone] = useState(true)

  useEffect(() => {
    if (!inView || prefersReducedMotion()) return
    setTyped('')
    setDone(false)
    let i = 0
    const id = setInterval(() => {
      i += 1
      setTyped(PHRASE.slice(0, i))
      if (i >= PHRASE.length) {
        clearInterval(id)
        setTimeout(() => setDone(true), 350)
      }
    }, 42)
    return () => clearInterval(id)
  }, [inView])

  return (
    <div ref={ref} className="capture-visual relative" aria-hidden="true">
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
                {typed || ' '}
                {!done && (
                  <span className="caret ml-0.5 inline-block h-4 w-0.5 bg-[var(--accent)] align-middle" />
                )}
              </p>
            </div>
            <div
              className="grid transition-[grid-template-rows,opacity] duration-500 ease-out"
              style={{ gridTemplateRows: done ? '1fr' : '0fr', opacity: done ? 1 : 0 }}
            >
              <div className="overflow-hidden">
                <div className="space-y-2 px-4 py-3">
                  <p className="section-label text-[var(--muted)]">Lands as</p>
                  <div className="flex flex-wrap gap-2 text-[12px]">
                    {CHIPS.map((c, i) => (
                      <span
                        key={c.t}
                        className={
                          c.accent
                            ? 'chip-pop rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[var(--accent)]'
                            : 'chip-pop rounded-full border border-[var(--line)] px-2.5 py-1 text-[var(--muted)]'
                        }
                        style={{ animationDelay: `${0.09 * i}s` }}
                      >
                        {c.t}
                      </span>
                    ))}
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
      </div>
    </div>
  )
}
