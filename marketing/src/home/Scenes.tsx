/**
 * The page's drawn scenes. Each renders its FINAL state as plain markup — that
 * is what the prerenderer ships, what a no-JS reviewer reads, and what
 * reduced-motion users see. motion.ts animates *toward* this state; it never
 * owns a position the markup doesn't already hold.
 */
import type { CSSProperties } from 'react'
import { CRAFT, WORK } from '../components/hues'
import {
  CASCADE_GRID,
  CASCADE_INITIATIVE,
  CASCADE_MEETINGS,
  CASCADE_PROJECTS,
  CASCADE_TASKS,
  DATES,
  DAYS,
  DAY_MOMENTS,
  FRIDAY_HOURS,
  FRIDAY_MOVED,
  H0,
  H1,
  HERO_CARRIES,
  HERO_MEETINGS,
  HERO_TASKS,
  MEMORY_NOTICED,
  MEMORY_TABS,
  WEEK_DRAFT,
  WEEK_MEETINGS,
  place,
  type Block,
} from './data'

const pct = (n: number) => `${n}%`
const hourLabel = (h: number) => (h === 12 ? '12pm' : h > 12 ? `${h - 12}pm` : `${h}am`)

/* ── shared: a five-day grid ──────────────────────────────────────────────── */

function WeekGrid({
  children,
  today = -1,
  hours = [H0, H1],
  className = '',
}: {
  children: React.ReactNode
  today?: number
  hours?: [number, number]
  className?: string
}) {
  const rows = Array.from({ length: hours[1] - hours[0] }, (_, i) => hours[0] + i)
  return (
    <div className={`wk ${className}`}>
      <div className="wk-head">
        <span />
        {DAYS.map((d, i) => (
          <span key={d} className={i === today ? 'is-today' : ''}>
            <em>{d}</em>
            <b>{DATES[i]}</b>
          </span>
        ))}
      </div>
      <div className="wk-body">
        <div className="wk-gutter">
          {rows.map((h) => (
            <span key={h}>{hourLabel(h)}</span>
          ))}
        </div>
        <div className="wk-canvas" style={{ '--rows': rows.length } as CSSProperties}>
          {children}
        </div>
      </div>
    </div>
  )
}

function Meeting({ b }: { b: Block }) {
  return (
    <div className="ev ev-meet" style={place(b)}>
      <span>{b.title}</span>
    </div>
  )
}

function TaskBlock({ b, i = 0, className = '', ...rest }: { b: Block; i?: number; className?: string; [k: string]: unknown }) {
  return (
    <div className={`ev ev-task ${className}`} style={{ ...place(b), '--hue': b.hue, '--i': i } as CSSProperties} {...rest}>
      <span className="ev-t">{b.title}</span>
      {b.sub && <span className="ev-s">{b.sub}</span>}
    </div>
  )
}

/* ── Hero: the Schedule, lived in ─────────────────────────────────────────── */

/* the sidebar's icons — Lucide's shapes, as the app uses (D-189: Lucide only) */
const ICONS = {
  schedule: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  projects: 'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z',
  initiatives: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  domains: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
} as const

function NavIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}

export function HeroSchedule({ mark }: { mark?: React.ReactNode }) {
  return (
    <div className="mock" aria-label="The Nuvo Schedule: a week of meetings and project work on one calendar" role="img">
      <div className="mock-body">
        <aside className="mock-rail">
          <span className="mock-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="mock-ws">
            {mark}
            Nuvo
          </span>
          <span className="mock-nav is-on">
            <NavIcon d={ICONS.schedule} />
            Schedule
          </span>
          <p className="mock-sec">Build</p>
          <span className="mock-nav">
            <NavIcon d={ICONS.projects} />
            Projects
          </span>
          <span className="mock-nav">
            <NavIcon d={ICONS.initiatives} />
            Initiatives
          </span>
          <span className="mock-nav">
            <NavIcon d={ICONS.domains} />
            Domains
          </span>
          <p className="mock-sec">This week</p>
          <ul>
            {HERO_CARRIES.map((p) => (
              <li key={p.name} style={{ '--hue': p.hue } as CSSProperties}>
                <span className="pip" />
                <span className="nm">{p.name}</span>
                <span className="ct mono">
                  {p.done}/{p.of}
                </span>
                <span className="trk">
                  <span style={{ width: pct((p.done / p.of) * 100) }} />
                </span>
              </li>
            ))}
          </ul>
          <div className="mock-fit">
            <span className="mono big">86%</span>
            <span className="note">Committed. Room for one more.</span>
          </div>
        </aside>
        <div className="mock-panel">
          <div className="mock-bar">
            <span className="mock-crumb">
              Schedule <span aria-hidden>/</span> <b>Nov 16 – 20</b>
            </span>
            <span className="mock-tabs" aria-hidden>
              <span>Day</span>
              <span className="on">Week</span>
              <span>Month</span>
            </span>
            <span className="mock-acts" aria-hidden>
              <span className="mock-btn">Today</span>
              <span className="mock-btn is-primary">Plan the week</span>
            </span>
          </div>
          <WeekGrid today={2} className="mock-week">
            {HERO_MEETINGS.map((b, i) => (
              <Meeting key={i} b={b} />
            ))}
            {HERO_TASKS.map((b, i) => (
              <TaskBlock key={i} i={i} b={b} className="hero-ev" />
            ))}
            <div className="now" style={{ top: pct(((13.4 - H0) / (H1 - H0)) * 100), left: '40%', width: '20%' }} />
          </WeekGrid>
        </div>
      </div>
    </div>
  )
}

/* ── The cascade ──────────────────────────────────────────────────────────── */

export function CascadeCanvas() {
  const g = CASCADE_GRID
  const colW = (100 - g.left) / 5
  const headPct = (5 / (g.bottom - g.top)) * 100
  return (
    <div className="cas" role="img" aria-label="One initiative breaks into three projects, each project into tasks, and every task lands at a time on the week">
      {/* connectors: initiative → projects → tasks */}
      <svg className="cas-lines" viewBox="0 0 100 110" preserveAspectRatio="none" aria-hidden>
        <path data-line="p" d="M50 13.2 C50 17, 16.5 15.5, 16.5 18.7" />
        <path data-line="p" d="M50 13.2 L50 18.7" />
        <path data-line="p" d="M50 13.2 C50 17, 83.5 15.5, 83.5 18.7" />
      </svg>

      <div className="cas-init" style={{ '--hue': CASCADE_INITIATIVE.hue } as CSSProperties}>
        <span className="cas-ring" aria-hidden>
          <svg viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" />
            <circle data-ring cx="18" cy="18" r="15" pathLength={100} />
          </svg>
        </span>
        <span>
          <b>{CASCADE_INITIATIVE.name}</b>
          <em>{CASCADE_INITIATIVE.meta}</em>
        </span>
      </div>

      {CASCADE_PROJECTS.map((p) => (
        <div
          key={p.name}
          className={`cas-proj ${p.behind ? 'is-behind' : ''}`}
          style={{ left: pct(p.x), '--hue': p.hue } as CSSProperties}
        >
          <b>{p.name}</b>
          <em>{p.meta}</em>
        </div>
      ))}

      <div className="cas-grid" style={{ top: pct(g.top), height: pct(g.bottom - g.top) }}>
        <div className="cas-grid-head" style={{ paddingLeft: pct(g.left), height: pct(headPct) }}>
          {DAYS.map((d) => (
            <span key={d} style={{ width: pct(colW) }}>
              {d}
            </span>
          ))}
        </div>
        {Array.from({ length: g.h1 - g.h0 }, (_, i) => (
          <span key={i} className="cas-hr" style={{ top: pct((i / (g.h1 - g.h0)) * (100 - headPct) + headPct) }}>
            {hourLabel(g.h0 + i)}
          </span>
        ))}
      </div>

      {CASCADE_MEETINGS.map((m) => (
        <div
          key={m.name}
          className="cas-meet"
          style={{ left: pct(m.left), top: pct(m.top), width: pct(m.width), height: pct(m.height) }}
        >
          {m.name}
        </div>
      ))}

      {CASCADE_TASKS.map((t, i) => (
        <div
          key={t.name}
          className="cas-task"
          data-task={i}
          style={
            {
              left: pct(t.cal.left),
              top: pct(t.cal.top),
              width: pct(t.cal.width),
              height: pct(t.cal.height),
              '--hue': CASCADE_PROJECTS[i === 3 ? 2 : i === 2 ? 1 : 0].hue,
            } as CSSProperties
          }
        >
          <b>{t.name}</b>
          <em className="cas-size mono">{t.size}</em>
          <em className="cas-when">{t.when}</em>
        </div>
      ))}
    </div>
  )
}

/* ── Capture ──────────────────────────────────────────────────────────────── */

export const CAPTURE_TEXT = 'Draft investor update fri 9am 45m #work !high'

export function CaptureScene() {
  return (
    <div className="cap" aria-label={`Typing “${CAPTURE_TEXT}” becomes a task on Friday at 9am, 45 minutes, Work, high priority`} role="img">
      <div className="cap-bar">
        <span className="cap-key mono" aria-hidden>
          ⌥ Space
        </span>
        <span className="cap-input">
          <span data-cap-typed>{CAPTURE_TEXT}</span>
          <i className="cap-caret" aria-hidden />
        </span>
      </div>
      <div className="cap-chips" aria-hidden>
        <span data-chip>
          <i>When</i>Fri · 9:00am
        </span>
        <span data-chip>
          <i>Length</i>45m
        </span>
        <span data-chip className="hue-work">
          <i>Domain</i>Work
        </span>
        <span data-chip className="hi">
          <i>Priority</i>High
        </span>
      </div>
      <div className="cap-land" aria-hidden>
        <span className="cap-day">Fri 20</span>
        <div className="cap-slot">
          <span className="cap-hr">9am</span>
          <div data-cap-block className="cap-block">
            <b>Draft investor update</b>
            <em>9–9:45am · Work</em>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Plan the week ────────────────────────────────────────────────────────── */

export function WeekScene() {
  const total = WEEK_DRAFT.reduce((s, b) => s + (b.end - b.start), 0)
  return (
    <div className="pw" role="img" aria-label="Plan the week: six blocks of project work drafted into the open hours around this week's meetings, then accepted one at a time">
      <aside className="pw-rail">
        <p className="k-label">To place</p>
        <ul>
          {WEEK_DRAFT.map((b, i) => (
            <li key={i} data-pw-item={i} style={{ '--hue': b.hue } as CSSProperties}>
              <span className="pip" />
              <span className="nm">
                <b>{b.project}</b>
                <em>{b.title}</em>
              </span>
              <span className="mono sz">{b.size}</span>
              <span className="ok" data-pw-ok={i} aria-hidden>
                ✓
              </span>
            </li>
          ))}
        </ul>
        <div className="pw-meter">
          <div className="pw-meter-row">
            <span className="k-label">Commitment</span>
            <span className="mono" data-pw-pct>
              74%
            </span>
          </div>
          <div className="trk">
            <span data-pw-fill style={{ width: '74%' }} />
          </div>
          <p className="note">
            <span data-pw-verdict>Fits.</span> {total}h of project work · 26h open
          </p>
        </div>
      </aside>
      <WeekGrid className="pw-week">
        {WEEK_MEETINGS.map((b, i) => (
          <Meeting key={i} b={b} />
        ))}
        {WEEK_DRAFT.flatMap((b, i) =>
          (b.alts ?? []).map((a, k) => (
            <div key={`a${i}${k}`} className="pw-alt" data-pw-alt={k} style={place(a)}>
              <span className="mono">{k + 1}</span>
            </div>
          )),
        )}
        {WEEK_DRAFT.map((b, i) => (
          <TaskBlock key={i} b={b} className="pw-block" data-pw-block={i} />
        ))}
        <div className="pw-cursor" data-pw-cursor aria-hidden>
          <span className="mono">↵</span>
        </div>
      </WeekGrid>
    </div>
  )
}

/* ── The day (dark) ───────────────────────────────────────────────────────── */

export function DayMoments() {
  return (
    <ol className="day-list">
      {DAY_MOMENTS.map((m) => (
        <li key={m.time} className={`moment moment-${m.kind}`} data-moment>
          <span className="moment-dot" aria-hidden />
          <p className="moment-time mono">
            {m.time} <span>· {m.label}</span>
          </p>
          <h3 className="moment-title">{m.title}</h3>
          {m.kind === 'ask' ? (
            <div className="chat">
              <p className="chat-me">Board call ran long. Push the rest of my afternoon.</p>
              <div className="chat-nuvo">
                <p>Moved two blocks to tomorrow, both before your 11am. The Chapter 4 draft keeps its slot.</p>
                <ul>
                  <li>
                    <span>Onboarding · Step 2</span>
                    <span className="mono">Thu 9–10:30am</span>
                  </li>
                  <li>
                    <span>Pricing page · FAQ</span>
                    <span className="mono">Thu 10:30–11am</span>
                  </li>
                </ul>
                <span className="undo">Undo</span>
              </div>
              <p className="moment-body">It proposes and shows its work. Every change carries an undo.</p>
            </div>
          ) : (
            <p className="moment-body">{m.body}</p>
          )}
          {m.kind === 'block' && (
            <div className="moment-chip" style={{ '--hue': WORK } as CSSProperties}>
              <span className="pip" />
              <b>Draft tier copy</b>
              <span className="mono">9–9:45am</span>
              <span className="tag">Pricing page · 4h left</span>
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

/* ── Friday ───────────────────────────────────────────────────────────────── */

export function FridayScene() {
  return (
    <div className="fri">
      <div className="fri-card">
        <p className="k-label">Where the week went</p>
        <ul className="fri-bars">
          {FRIDAY_HOURS.map((d) => (
            <li key={d.name} style={{ '--hue': d.hue } as CSSProperties}>
              <span className="nm">{d.name}</span>
              <span className="trk">
                <span data-bar style={{ width: pct((d.h / d.max) * 100) }} />
              </span>
              <span className="mono h">
                <span data-count={d.h}>{d.h}</span>h
              </span>
            </li>
          ))}
        </ul>
        <p className="k-label mt">What moved</p>
        <ul className="fri-moved">
          {FRIDAY_MOVED.map((m) => (
            <li key={m} data-moved>
              <span aria-hidden>✓</span>
              {m}
            </li>
          ))}
        </ul>
        <p className="fri-foot">Meetings you attended and blocks you finished, counted for you. No timesheet.</p>
      </div>
    </div>
  )
}

/* ── Memory + the chat ────────────────────────────────────────────────────
   The Inspector the app opens over the page (docs/memory.md §4.3), and the
   chat answering from what you kept (§7). The chat reads Memory; it never
   keeps or forgets one — that act lives in the panel. */

export function MemoryScene() {
  return (
    <div className="mem-stage">
      <div
        className="mem-panel"
        role="img"
        aria-label="Nuvo's Memory panel: three patterns it noticed in your calendar and finished work, each with its evidence, how sure it is, and what keeping it would change"
      >
        <div className="mem-head">
          <span className="mem-icon" aria-hidden>
            ✦
          </span>
          <b>Memory</b>
          <span className="mem-x" aria-hidden>
            ✕
          </span>
        </div>
        <div className="mem-tabs" aria-hidden>
          {MEMORY_TABS.map((t, i) => (
            <span key={t} className={i === 0 ? 'on' : ''}>
              {t}
            </span>
          ))}
        </div>
        <ul className="mem-list">
          {MEMORY_NOTICED.map((m, i) => (
            <li key={m.statement} className={`mem-item ${i === 0 ? 'is-on' : ''}`} data-mem style={{ '--hue': m.hue } as CSSProperties}>
              <p className="mem-meta">
                <span>{m.area}</span>
                <span className={`mem-conf ${m.confidence === 'Sure' ? 'is-sure' : ''}`}>{m.confidence}</span>
              </p>
              <p className="mem-stmt">{m.statement}</p>
              <p className="mem-ev">
                <span className="mem-pips" aria-hidden>
                  {m.pips.map((on, k) => (
                    <i key={k} className={on ? 'on' : ''} />
                  ))}
                </span>
                <span className="mono">{m.evidence}</span>
                <span className="mem-src">· {m.source}</span>
              </p>
              <p className="mem-keep">
                <span>Keep:</span> {m.keep}
              </p>
              {i === 0 && (
                <div className="mem-acts" aria-hidden>
                  <span className="mem-btn is-primary">
                    Keep <kbd>↵</kbd>
                  </span>
                  <span className="mem-btn">Not true</span>
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="mem-foot">Only you can see it. It never leaves your account.</p>
      </div>

      <div className="mem-chat" data-mem-chat>
        <p className="mem-me">Find time for Chapter 4 this week.</p>
        <div className="mem-nuvo">
          <p>Two sittings in your Deep work afternoons, Tuesday and Thursday.</p>
          <ul>
            <li style={{ '--hue': CRAFT } as CSSProperties}>
              <span>Chapter 4 · Draft</span>
              <span className="mono">Tue 1–2:30pm</span>
            </li>
            <li style={{ '--hue': CRAFT } as CSSProperties}>
              <span>Chapter 4 · Revise</span>
              <span className="mono">Thu 1–2:30pm</span>
            </li>
          </ul>
          <p className="mem-trace">
            <span aria-hidden>✦</span> In Deep work · from Memory
          </p>
        </div>
      </div>
    </div>
  )
}
