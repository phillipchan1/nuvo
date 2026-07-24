/** Faithful Schedule recreation — rail + week grid, Warm Paper glass blocks. */

type Block = {
  day: number
  start: number
  end: number
  title: string
  color: string
  kind?: 'task' | 'event'
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DATES = [19, 20, 21, 22, 23, 24, 25]
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16]

const BLOCKS: Block[] = [
  { day: 1, start: 9, end: 11, title: 'Deep work — Meridian', color: '#2563EB', kind: 'task' },
  { day: 1, start: 13, end: 14, title: 'Staff sync', color: '#64748B', kind: 'event' },
  { day: 2, start: 9.5, end: 11, title: 'Write Sunday compose', color: '#7C3AED', kind: 'task' },
  { day: 2, start: 14, end: 15.5, title: 'Client call', color: '#64748B', kind: 'event' },
  { day: 3, start: 10, end: 12, title: 'Ship deck v3', color: '#2563EB', kind: 'task' },
  { day: 4, start: 9, end: 10.5, title: 'Family morning', color: '#DB2777', kind: 'task' },
  { day: 4, start: 13, end: 14.5, title: 'Groom projects', color: '#0D9488', kind: 'task' },
  { day: 5, start: 9, end: 11.5, title: 'Protect mornings', color: '#92568a', kind: 'task' },
  { day: 5, start: 15, end: 16, title: '1:1', color: '#64748B', kind: 'event' },
]

const RAIL = [
  { title: 'Protect mornings', meta: '1h · today', accent: '#92568a' },
  { title: 'Ship deck v3', meta: 'Work · 90m', accent: '#2563EB' },
  { title: 'Groom next week', meta: 'Projects · 45m', accent: '#0D9488' },
  { title: 'Call David', meta: 'Inbox · 30m', accent: '#847b6b' },
]

// Blocks land in reading order — day, then time — so the week assembles itself.
const LAND_ORDER = [...BLOCKS].sort((a, b) => a.day - b.day || a.start - b.start)
const landDelay = (b: Block) => 0.18 + LAND_ORDER.indexOf(b) * 0.07

function fmtHour(h: number) {
  const hour = Math.floor(h)
  const suffix = hour >= 12 ? 'pm' : 'am'
  const n = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour
  return `${n}${suffix}`
}

function blockStyle(b: Block) {
  const top = ((b.start - 9) / 8) * 100
  const height = ((b.end - b.start) / 8) * 100
  const fill = `color-mix(in srgb, color-mix(in srgb, ${b.color} 80%, var(--muted)) 24%, transparent)`
  return {
    top: `${top}%`,
    height: `${height}%`,
    backgroundColor: fill,
    borderLeft: `3px solid ${b.color}`,
  } as const
}

export default function ScheduleVisual() {
  return (
    <div
      className="schedule-visual glass-card relative overflow-hidden rounded-2xl border border-[var(--line)] shadow-[var(--shadow-3)]"
      aria-hidden="true"
    >
      {/* Spine */}
      <aside className="schedule-spine hidden border-r border-[var(--line)] md:flex md:flex-col">
        <div className="px-3 pt-4">
          <span className="wordmark text-[15px] text-[var(--text)]">Nuvo</span>
        </div>
        <div className="mt-6 space-y-4 px-3">
          <div>
            <p className="section-label text-[var(--muted)]">Execute</p>
            <p className="mt-2 text-[13px] font-medium text-[var(--accent)]">Schedule</p>
            <p className="text-[11px] text-[var(--muted)]">plan the week</p>
          </div>
          <div>
            <p className="section-label text-[var(--muted)]">Build</p>
            <ul className="mt-2 space-y-1.5 text-[12px] text-[var(--muted)]">
              <li>Projects</li>
              <li>Initiatives</li>
              <li>Domains</li>
            </ul>
          </div>
        </div>
      </aside>

      {/* Rail */}
      <aside className="schedule-rail flex flex-col border-r border-[var(--line)]">
        <div className="border-b border-[var(--line)] px-3 py-3">
          <p className="section-label text-[var(--muted)]">This week</p>
          <p className="mt-1 text-[12px] text-[var(--text)]">
            <span className="mono">2</span> of <span className="mono">5</span> landed
          </p>
          <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-[var(--line)]">
            <div className="h-full w-[40%] rounded-full bg-[var(--accent)]" />
          </div>
        </div>
        <div className="flex gap-3 border-b border-[var(--line)] px-3 py-2 text-[12px]">
          <span className="font-medium text-[var(--text)]">Today</span>
          <span className="text-[var(--muted)]">Inbox</span>
        </div>
        <div className="flex-1 space-y-2 overflow-hidden px-2 py-2">
          <p className="section-label px-1 text-[var(--muted)]">Needs you</p>
          {RAIL.map((row) => (
            <div
              key={row.title}
              className="glass-card rounded-lg border border-[var(--line)] px-2.5 py-2"
              style={{ borderLeftWidth: 2, borderLeftColor: row.accent }}
            >
              <p className="truncate text-[12px] leading-snug text-[var(--text)]">{row.title}</p>
              <p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">{row.meta}</p>
            </div>
          ))}
        </div>
        <div className="m-2 rounded-full border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_70%,transparent)] px-3 py-2 text-[11px] text-[var(--muted)]">
          Capture anything…
        </div>
      </aside>

      {/* Calendar */}
      <div className="schedule-cal min-w-0 flex-1">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2.5">
          <p className="masthead text-[15px] text-[var(--text)]">Jul 19 – 25</p>
          <div className="hidden gap-1 text-[10px] text-[var(--muted)] sm:flex">
            <span className="rounded-md bg-[var(--accent-soft)] px-2 py-1 text-[var(--accent)]">Week</span>
            <span className="px-2 py-1">Day</span>
            <span className="px-2 py-1">Month</span>
          </div>
        </div>

        <div className="grid grid-cols-[28px_repeat(7,minmax(0,1fr))] border-b border-[var(--line)]">
          <div />
          {DAYS.map((d, i) => (
            <div
              key={d}
              className={`border-l border-[var(--line)] py-2 text-center ${i === 5 ? 'bg-[var(--accent-soft)]' : ''}`}
            >
              <p className="section-label text-[9px] text-[var(--muted)]">{d}</p>
              <p className={`mono mt-0.5 text-[13px] ${i === 5 ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>
                {DATES[i]}
              </p>
            </div>
          ))}
        </div>

        <div className="relative grid grid-cols-[28px_repeat(7,minmax(0,1fr))]" style={{ height: 280 }}>
          <div className="relative">
            {HOURS.map((h) => (
              <div
                key={h}
                className="absolute right-1 -translate-y-1/2 text-[9px] text-[var(--muted)] mono"
                style={{ top: `${((h - 9) / 8) * 100}%` }}
              >
                {fmtHour(h)}
              </div>
            ))}
          </div>
          {DAYS.map((_, day) => (
            <div key={day} className="relative border-l border-[var(--line)]">
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute inset-x-0 border-t border-[var(--line)]"
                  style={{ top: `${((h - 9) / 8) * 100}%` }}
                />
              ))}
              {BLOCKS.filter((b) => b.day === day).map((b) => (
                <div
                  key={`${b.day}-${b.title}`}
                  className="schedule-block sch-land absolute inset-x-0.5 overflow-hidden rounded-md px-1 py-0.5"
                  style={{ ...blockStyle(b), animationDelay: `${landDelay(b)}s` }}
                >
                  <p className="truncate text-[10px] font-medium leading-tight text-[var(--text)]">{b.title}</p>
                </div>
              ))}
              {day === 5 && (
                <div
                  className="absolute inset-x-0 z-10 border-t border-[var(--signal)]"
                  style={{ top: `${((12.1 - 9) / 8) * 100}%` }}
                >
                  <span className="absolute -top-2 left-0 rounded bg-[var(--signal)] px-1 text-[8px] text-white mono">
                    now
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
