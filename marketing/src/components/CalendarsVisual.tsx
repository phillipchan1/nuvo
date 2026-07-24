import type { ReactNode } from 'react'
import { AppleLogo, GoogleLogo, IcsLogo, MicrosoftLogo } from './logos'

type CalCard = {
  name: string
  mode: string
  line: string
  Logo: (props: { size?: number }) => ReactNode
}

const CALENDARS: CalCard[] = [
  {
    name: 'Google Calendar',
    mode: 'Two-way',
    line: 'Sync in. Write back. A “Nuvo” mirror calendar for your blocks.',
    Logo: GoogleLogo,
  },
  {
    name: 'Apple Calendar',
    mode: 'Two-way',
    line: 'iCloud CalDAV with an app-specific password. Drag, resize, create.',
    Logo: AppleLogo,
  },
  {
    name: 'Microsoft 365',
    mode: 'Read-only',
    line: 'Work and personal Graph calendars on the same grid — no write risk.',
    Logo: MicrosoftLogo,
  },
  {
    name: 'ICS feeds',
    mode: 'Subscribe',
    line: 'School, sports, church feeds. Read-only beside your commitments.',
    Logo: IcsLogo,
  },
]

export default function CalendarsVisual() {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-hidden="true">
      {CALENDARS.map((c, i) => (
        <div
          key={c.name}
          className="glass-card reveal flex gap-3 rounded-xl border border-[var(--line)] p-4"
          style={{ animationDelay: `${0.06 * i}s` }}
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_92%,white)] shadow-[var(--shadow-1)]">
            <c.Logo size={22} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <p className="text-[15px] font-medium text-[var(--text)]">{c.name}</p>
              <span className="section-label text-[var(--accent)]">{c.mode}</span>
            </div>
            <p className="mt-1.5 text-[13px] leading-snug text-[var(--muted)]">{c.line}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
