import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { formatHourLabel } from "../lib/dates";
import { readRevealConfig, writeRevealConfig, type RevealConfig } from "../lib/weekReveal";
import type { CalendarAccount, UserSettings } from "../lib/types";
import { useLabels } from "../hooks/useCalendar";
import { useVertical } from "../hooks/useVertical";
import { Btn, Modal } from "./ui";
import { GitHubConnect } from "./GitHubConnect";
import type { SettingsSection } from "../lib/appNav";
import { useMaxPerWeek } from "../hooks/usePlannerPrefs";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { useIsMobile } from "../hooks/useIsMobile";
import { useSkin, useScheme, SKIN_LABELS, SCHEMES, SCHEME_GROUP, schemeModes, type Skin, type Scheme, type SchemeModes } from "../hooks/useSkin";
import { useUiScale, UI_SCALE_MIN, UI_SCALE_MAX } from "../hooks/useUiScale";

// ── Section registry ──────────────────────────────────────────────────────
type SectionId = "appearance" | "schedule" | "connections" | "integrations" | "labels" | "account";

const SECTIONS: { id: SectionId; label: string; icon: ReactNode }[] = [
  {
    id: "appearance",
    label: "Appearance",
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8 2.5a5.5 5.5 0 000 11z" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "schedule",
    label: "Schedule",
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8 4.8V8l2.2 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "connections",
    label: "Calendars",
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <rect x="2.3" y="3.3" width="11.4" height="10.4" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
        <path d="M2.3 6.3h11.4" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5.5 1.8v2.6M10.5 1.8v2.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "integrations",
    label: "Integrations",
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <path d="M6.2 2.5 3 5.7a2.4 2.4 0 0 0 0 3.4l3.7 3.7a2.4 2.4 0 0 0 3.4 0l3.2-3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9.8 13.5 13 10.3a2.4 2.4 0 0 0 0-3.4L9.3 3.2a2.4 2.4 0 0 0-3.4 0L2.7 6.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" opacity="0.45" />
      </svg>
    ),
  },
  {
    id: "labels",
    label: "Labels",
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <path d="M2.5 2.5h4.7l6.3 6.3a1 1 0 010 1.4l-3.3 3.3a1 1 0 01-1.4 0L2.5 7.2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <circle cx="5.4" cy="5.4" r="0.95" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "account",
    label: "Account",
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="5.5" r="2.6" stroke="currentColor" strokeWidth="1.3" />
        <path d="M3.2 13.4c0-2.5 2.1-4.1 4.8-4.1s4.8 1.6 4.8 4.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
];

// ── Shared layout atoms ───────────────────────────────────────────────────
function PaneHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-head font-semibold text-ink">{title}</h2>
      <p className="mt-0.5 text-caption leading-snug text-muted">{sub}</p>
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    // Stacks on a phone so the controls get full width and never collide with the
    // label; sm+ restores the desktop label-left / control-right row.
    <div className="flex flex-col items-start gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <div className="text-body font-medium text-ink">{title}</div>
        {desc && <div className="mt-0.5 text-caption leading-snug text-muted">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`fast rounded-md px-3 py-1 text-caption font-medium ${
            value === o.value
              ? "bg-surface text-ink shadow-sm"
              : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const toMinLabel = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// ── Appearance: live theme preview tiles ──────────────────────────────────
const PALETTES = {
  light: { bg: "#f3f2f7", surface: "#ffffff", line: "#e5e3ee", accent: "#5a4be2", text: "#1a1822", muted: "#6c6880" },
  dark: { bg: "#141320", surface: "#1c1a28", line: "#2d2b3d", accent: "#8b80ff", text: "#ecebf3", muted: "#95909f" },
} as const;
type Palette = (typeof PALETTES)[keyof typeof PALETTES];

function MiniBars({ p }: { p: Palette }) {
  return (
    <div className="flex h-full gap-1 p-1.5">
      <div className="flex w-[34%] flex-col gap-1 rounded-[3px] border p-1" style={{ background: p.surface, borderColor: p.line }}>
        <div className="h-1 w-3/4 rounded-full" style={{ background: p.accent }} />
        <div className="h-1 w-full rounded-full" style={{ background: p.line }} />
        <div className="h-1 w-1/2 rounded-full" style={{ background: p.line }} />
      </div>
      <div className="flex flex-1 flex-col gap-1 rounded-[3px] border p-1" style={{ background: p.surface, borderColor: p.line }}>
        <div className="h-1 w-1/2 rounded-full opacity-80" style={{ background: p.text }} />
        <div className="h-1 w-full rounded-full opacity-50" style={{ background: p.muted }} />
        <div className="h-1 w-2/3 rounded-full opacity-50" style={{ background: p.muted }} />
        <div className="mt-auto h-2 w-7 rounded-[2px]" style={{ background: p.accent }} />
      </div>
    </div>
  );
}

function ThemeCard({
  theme,
  active,
  disabled = false,
  onSelect,
}: {
  theme: "system" | "light" | "dark";
  active: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={`fast group overflow-hidden rounded-lg border text-left disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-line hover:border-line-strong"
      }`}
    >
      <div className="h-[58px]" style={{ background: theme === "dark" ? PALETTES.dark.bg : PALETTES.light.bg }}>
        {theme === "system" ? (
          <div className="flex h-full">
            <div className="w-1/2 overflow-hidden" style={{ background: PALETTES.light.bg }}>
              <MiniBars p={PALETTES.light} />
            </div>
            <div className="w-1/2 overflow-hidden border-l border-black/20" style={{ background: PALETTES.dark.bg }}>
              <MiniBars p={PALETTES.dark} />
            </div>
          </div>
        ) : (
          <MiniBars p={PALETTES[theme]} />
        )}
      </div>
      <div className="flex items-center justify-between border-t border-line bg-surface px-2.5 py-1.5">
        <span className="text-caption font-medium capitalize text-ink">{theme}</span>
        <span
          className={`fast flex h-3.5 w-3.5 items-center justify-center rounded-full border ${
            active ? "border-accent bg-accent text-white" : "border-line-strong"
          }`}
        >
          {active && (
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
              <path d="M2 5l2 2 4-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      </div>
    </button>
  );
}

// ── Appearance: a scheme swatch (one per colour scheme within a material) ──
// Rendered from the SCHEMES registry, so it works for every material's own set
// — warmth moods under Paper, editor themes under Terminal, and so on. `sharp`
// mirrors the material's corner language so the preview reads as the material.
function SchemeCard({
  scheme,
  active,
  dark,
  sharp,
  onSelect,
}: {
  scheme: Scheme;
  active: boolean;
  dark: boolean;
  sharp: boolean;
  onSelect: () => void;
}) {
  const sw = dark ? scheme.dark : scheme.light;
  const barR = sharp ? "0" : "9999px";
  return (
    <button
      onClick={onSelect}
      className={`fast group overflow-hidden rounded-lg border text-left ${
        active ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-line hover:border-line-strong"
      }`}
    >
      <div className="flex h-[46px] items-center gap-1.5 px-2.5" style={{ background: sw.bg }}>
        <div
          className="flex flex-1 flex-col gap-1 border p-1.5"
          style={{ background: sw.surface, borderColor: sw.line, borderRadius: sharp ? "1px" : "4px" }}
        >
          <div className="h-1 w-3/5" style={{ background: sw.accent, borderRadius: barR }} />
          <div className="h-1 w-full" style={{ background: sw.line, borderRadius: barR }} />
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-line bg-surface px-2.5 py-1.5">
        <span className="flex flex-col leading-tight">
          <span className="text-caption font-medium text-ink">{scheme.name}</span>
          <span className="mono text-micro text-muted">{scheme.hint}</span>
        </span>
        <span
          className={`fast flex h-3.5 w-3.5 items-center justify-center rounded-full border ${
            active ? "border-accent bg-accent text-white" : "border-line-strong"
          }`}
        >
          {active && (
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
              <path d="M2 5l2 2 4-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      </div>
    </button>
  );
}

// ── Appearance: the material axis (a swatch per skin) ─────────────────────
// The material preview reuses the skin's DEFAULT scheme (SCHEMES[skin][0]) as
// its swatch, so there's one source of truth for colours. `sharp` mirrors the
// skin's corner language so the preview reads as the material, not the palette.
const SKIN_SHARP: Record<Skin, boolean> = {
  paper: false, flat: false, terminal: true, blueprint: true, eink: false,
};

function SkinCard({
  skin,
  active,
  dark,
  onSelect,
}: {
  skin: Skin;
  active: boolean;
  dark: boolean;
  onSelect: () => void;
}) {
  const sharp = SKIN_SHARP[skin];
  const def = SCHEMES[skin][0];
  const sw = dark ? def.dark : def.light;
  const meta = SKIN_LABELS[skin];
  const barR = sharp ? "0" : "9999px";
  return (
    <button
      onClick={onSelect}
      className={`fast group overflow-hidden rounded-lg border text-left ${
        active ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-line hover:border-line-strong"
      }`}
    >
      <div className="flex h-[46px] items-center gap-1.5 px-2.5" style={{ background: sw.bg }}>
        <div
          className="flex flex-1 flex-col gap-1 border p-1.5"
          style={{ background: sw.surface, borderColor: sw.line, borderRadius: sharp ? "1px" : "4px" }}
        >
          <div className="h-1 w-3/5" style={{ background: sw.accent, borderRadius: barR }} />
          <div className="h-1 w-full" style={{ background: sw.line, borderRadius: barR }} />
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-line bg-surface px-2.5 py-1.5">
        <span className="flex flex-col leading-tight">
          <span className="text-caption font-medium text-ink">{meta.name}</span>
          <span className="mono text-micro text-muted">{meta.hint}</span>
        </span>
        <span
          className={`fast flex h-3.5 w-3.5 items-center justify-center rounded-full border ${
            active ? "border-accent bg-accent text-white" : "border-line-strong"
          }`}
        >
          {active && (
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
              <path d="M2 5l2 2 4-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      </div>
    </button>
  );
}

// ── Section panes ─────────────────────────────────────────────────────────
function AppearancePane({
  settings,
  updateSettings,
}: {
  settings: UserSettings | undefined;
  updateSettings: (patch: Partial<UserSettings>) => void;
}) {
  const theme = settings?.theme ?? "system";
  const [skin, setSkin] = useSkin();
  const { scheme, schemes, setScheme } = useScheme();
  const group = SCHEME_GROUP[skin];
  const { scale, zoomIn, zoomOut, zoomReset } = useUiScale();

  const sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const themeIsDark = theme === "dark" || (theme === "system" && sysDark);
  // A scheme that only comes in one mode forces it; a "both" scheme follows the
  // theme toggle. `effDark` gives the right swatch/preview for any scheme.
  const effDark = (m: SchemeModes) => (m === "dark" ? true : m === "light" ? false : themeIsDark);

  const activeScheme = schemes.find((s) => s.id === scheme);
  const forced = schemeModes(skin, scheme) === "both" ? null : schemeModes(skin, scheme);

  return (
    <div>
      <PaneHeader title="Appearance" sub="How Nuvo looks. System follows your device's light or dark mode." />
      <div className="grid grid-cols-3 gap-2.5">
        {(["system", "light", "dark"] as const).map((t) => (
          <ThemeCard
            key={t}
            theme={t}
            // When the scheme forces a mode, only that card is live + active, so
            // a dead "Light" toggle can't quietly do nothing.
            active={forced ? t === forced : theme === t}
            disabled={forced ? t !== forced : false}
            onSelect={() => updateSettings({ theme: t })}
          />
        ))}
      </div>
      {forced && (
        <p className="text-caption mt-2 text-muted">
          {activeScheme?.name} is a {forced} {group.label.toLowerCase()} — it sets its own light &amp; dark.
        </p>
      )}

      <div className="section-label mb-2 mt-6">Material</div>
      <p className="text-caption mb-2.5 text-muted">The feel of the surface. Each material brings its own look — and its own set of {group.label.toLowerCase()}s below.</p>
      <div className="grid grid-cols-3 gap-2.5">
        {(Object.keys(SKIN_LABELS) as Skin[]).map((s) => (
          <SkinCard
            key={s}
            skin={s}
            active={skin === s}
            dark={effDark(SCHEMES[s][0].modes ?? "both")}
            onSelect={() => setSkin(s)}
          />
        ))}
      </div>

      <div className="section-label mb-2 mt-6">{group.label}</div>
      <p className="text-caption mb-2.5 text-muted">{group.hint}</p>
      <div className="grid grid-cols-3 gap-2.5">
        {schemes.map((sc) => (
          <SchemeCard
            key={sc.id}
            scheme={sc}
            active={scheme === sc.id}
            dark={effDark(sc.modes ?? "both")}
            sharp={SKIN_SHARP[skin]}
            onSelect={() => setScheme(sc.id)}
          />
        ))}
      </div>

      <div className="section-label mb-2 mt-6">Zoom</div>
      <p className="text-caption mb-2.5 text-muted">Scale the whole interface — text, icons, and spacing together. Also ⌘+ / ⌘− / ⌘0.</p>
      <div className="flex items-center gap-2.5">
        <Btn onClick={zoomOut} disabled={scale <= UI_SCALE_MIN} title="Zoom out">−</Btn>
        <button
          type="button"
          onClick={zoomReset}
          className="text-caption min-w-14 rounded-md py-1.5 text-center text-muted hover:text-ink"
        >
          {Math.round(scale * 100)}%
        </button>
        <Btn onClick={zoomIn} disabled={scale >= UI_SCALE_MAX} title="Zoom in">+</Btn>
      </div>
    </div>
  );
}

function SchedulePane({
  settings,
  updateSettings,
}: {
  settings: UserSettings | undefined;
  updateSettings: (patch: Partial<UserSettings>) => void;
}) {
  const setWork = (key: "work_start_minutes" | "work_end_minutes") => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) return;
    const [h, mm] = e.target.value.split(":").map(Number);
    updateSettings({ [key]: h * 60 + mm });
  };

  const [maxPerWeek, setMaxPerWeekPref] = useMaxPerWeek();

  // The weekly Review reveal — a per-device nudge, so it lives in localStorage
  // (not the synced settings row). Default Friday 1pm.
  const [reveal, setRevealState] = useState<RevealConfig>(() => readRevealConfig());
  const patchReveal = (p: Partial<RevealConfig>) => {
    const next = { ...reveal, ...p };
    setRevealState(next);
    writeRevealConfig(next);
  };
  const selCls = "mono rounded-md border border-line bg-bg px-2 py-1 text-caption outline-none focus:border-accent";
  const timeCls = "mono rounded-md border border-line bg-bg px-2 py-1 text-caption outline-none focus:border-accent";

  const dayStart = settings?.day_start_hour ?? 6;
  const dayEnd = settings?.day_end_hour ?? 24;
  const viewStart = Math.max(0, dayStart - 1);
  const viewEnd = Math.min(24, dayEnd < 24 ? dayEnd + 1 : 24);
  const windowHours = Math.max(1, viewEnd - viewStart);
  const fitHours = settings?.calendar_fit_hours ?? 13;
  const fitClamped = Math.min(Math.max(6, fitHours), windowHours);

  return (
    <div>
      <PaneHeader title="Schedule" sub="The shape of your day — what the calendar shows and when Nuvo plans for you." />
      <div className="divide-y divide-line">
        <Row title="Day view window" desc="The span of hours shown in your calendar.">
          <div className="flex items-center gap-2">
            <select
              value={settings?.day_start_hour ?? 6}
              onChange={(e) => updateSettings({ day_start_hour: Number(e.target.value) })}
              className={selCls}
            >
              {Array.from({ length: 12 }, (_, h) => (
                <option key={h} value={h}>
                  {formatHourLabel(h)}
                </option>
              ))}
            </select>
            <span className="text-caption text-muted">to</span>
            <select
              value={settings?.day_end_hour ?? 24}
              onChange={(e) => updateSettings({ day_end_hour: Number(e.target.value) })}
              className={selCls}
            >
              {Array.from({ length: 12 }, (_, i) => i + 13).map((h) => (
                <option key={h} value={h}>
                  {formatHourLabel(h)}
                </option>
              ))}
            </select>
          </div>
        </Row>

        <Row title="Working hours" desc="The window Nuvo proposes focus blocks inside.">
          <div className="flex items-center gap-2">
            <input
              type="time"
              step={900}
              value={toMinLabel(settings?.work_start_minutes ?? 480)}
              onChange={setWork("work_start_minutes")}
              className={timeCls}
            />
            <span className="text-caption text-muted">to</span>
            <input
              type="time"
              step={900}
              value={toMinLabel(settings?.work_end_minutes ?? 990)}
              onChange={setWork("work_end_minutes")}
              className={timeCls}
            />
          </div>
        </Row>

        <Row
          title="Hours on screen"
          desc="How many hours of your day view fill the screen. More hours = less scrolling; fewer = taller rows."
        >
          <div className="flex items-center overflow-hidden rounded-md border border-line">
            <button
              onClick={() => updateSettings({ calendar_fit_hours: Math.max(6, fitClamped - 1) })}
              disabled={fitClamped <= 6}
              className="fast px-2 py-1 text-caption leading-none text-muted hover:bg-bg hover:text-ink disabled:opacity-30"
              title="Fewer hours (taller rows)"
            >
              −
            </button>
            <span className="mono w-9 select-none text-center text-caption tabular-nums text-text">{fitClamped}h</span>
            <button
              onClick={() => updateSettings({ calendar_fit_hours: Math.min(windowHours, fitClamped + 1) })}
              disabled={fitClamped >= windowHours}
              className="fast px-2 py-1 text-caption leading-none text-muted hover:bg-bg hover:text-ink disabled:opacity-30"
              title="More hours (less scrolling)"
            >
              +
            </button>
          </div>
        </Row>

        <Row title="Week starts on" desc="The first column of the week and month views.">
          <Segmented
            value={String(settings?.week_start ?? 1)}
            onChange={(v) => updateSettings({ week_start: Number(v) })}
            options={[
              { value: "0", label: "Sunday" },
              { value: "1", label: "Monday" },
            ]}
          />
        </Row>

        <Row title="Projects per week" desc="How many projects you'll commit to a single week before On Deck flags it as overloaded. Fewer = more focus.">
          <div className="flex items-center overflow-hidden rounded-md border border-line">
            <button
              onClick={() => setMaxPerWeekPref(Math.max(1, maxPerWeek - 1))}
              disabled={maxPerWeek <= 1}
              className="fast px-2 py-1 text-caption leading-none text-muted hover:bg-bg hover:text-ink disabled:opacity-30"
              title="Fewer per week"
            >
              −
            </button>
            <span className="mono w-9 select-none text-center text-caption tabular-nums text-text">{maxPerWeek}</span>
            <button
              onClick={() => setMaxPerWeekPref(Math.min(6, maxPerWeek + 1))}
              disabled={maxPerWeek >= 6}
              className="fast px-2 py-1 text-caption leading-none text-muted hover:bg-bg hover:text-ink disabled:opacity-30"
              title="More per week"
            >
              +
            </button>
          </div>
        </Row>

        <Row title="Weekly Review reveal" desc="When the week's Review quietly lights up as ready — an invitation, never forced.">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-caption text-muted">
              <input
                type="checkbox"
                checked={reveal.enabled}
                onChange={(e) => patchReveal({ enabled: e.target.checked })}
                className="accent-[var(--accent)]"
              />
              on
            </label>
            <select
              value={reveal.dow}
              onChange={(e) => patchReveal({ dow: Number(e.target.value) })}
              disabled={!reveal.enabled}
              className={`${selCls} disabled:opacity-40`}
            >
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => (
                <option key={i} value={i}>
                  {d}
                </option>
              ))}
            </select>
            <span className="text-caption text-muted">at</span>
            <input
              type="time"
              step={900}
              value={toMinLabel(reveal.minutes)}
              onChange={(e) => {
                if (!e.target.value) return;
                const [h, mm] = e.target.value.split(":").map(Number);
                patchReveal({ minutes: h * 60 + mm });
              }}
              disabled={!reveal.enabled}
              className={`${timeCls} disabled:opacity-40`}
            />
          </div>
        </Row>

        <Row title="Weather" desc="Show a weather icon and high temperature next to each day in the calendar. Requires location access.">
          <label className="flex items-center gap-1.5 text-caption text-muted">
            <input
              type="checkbox"
              checked={settings?.show_weather ?? false}
              onChange={(e) => updateSettings({ show_weather: e.target.checked })}
              className="accent-[var(--accent)]"
            />
            on
          </label>
        </Row>
      </div>
    </div>
  );
}

function ConnectionsPane({
  settings,
  updateSettings,
  accounts,
}: {
  settings: UserSettings | undefined;
  updateSettings: (patch: Partial<UserSettings>) => void;
  accounts: CalendarAccount[];
}) {
  const qc = useQueryClient();
  const connect = async (provider: "google" | "m365") => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const base = import.meta.env.VITE_SUPABASE_URL;
    const redirect = encodeURIComponent(window.location.origin);
    window.location.href = `${base}/functions/v1/${provider === "google" ? "google-oauth" : "m365-oauth"}?action=start&token=${token}&redirect=${redirect}`;
  };
  const disconnect = async (id: string) => {
    await supabase.from("calendar_accounts").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["calendar_accounts"] });
  };

  // ── ICS subscription (read-only, no OAuth) ──
  const [showIcs, setShowIcs] = useState(false);
  const [icsUrl, setIcsUrl] = useState("");
  const [icsLabel, setIcsLabel] = useState("");
  const [icsBusy, setIcsBusy] = useState(false);
  const [icsError, setIcsError] = useState<string | null>(null);

  const subscribeIcs = async () => {
    const url = icsUrl.trim().replace(/^webcal:\/\//i, "https://");
    if (!url || icsBusy) return;
    setIcsBusy(true);
    setIcsError(null);
    const { error } = await supabase.functions.invoke("ics-subscribe", {
      body: { url, label: icsLabel.trim() || undefined },
    });
    if (error) {
      let msg = error.message;
      // The function returns { error } with a 4xx — pull the real message out.
      // deno-lint-ignore no-explicit-any
      try {
        const body = await (error as any).context?.json?.();
        if (body?.error) msg = body.error;
      } catch { /* keep the generic message */ }
      setIcsError(msg);
      setIcsBusy(false);
      return;
    }
    setIcsBusy(false);
    setIcsUrl("");
    setIcsLabel("");
    setShowIcs(false);
    qc.invalidateQueries({ queryKey: ["calendar_accounts"] });
  };

  const providerMeta = (p: CalendarAccount["provider"]) =>
    p === "google"
      ? { letter: "G", name: "Google", color: "#4285F4" }
      : p === "m365"
        ? { letter: "M", name: "Microsoft 365", color: "#2563EB" }
        : { letter: "↻", name: "Subscribed calendar", color: "#0EA5E9" };

  const hidden = new Set(settings?.hidden_calendar_ids ?? []);
  const toggleCalendar = (calId: string) => {
    const next = new Set(hidden);
    next.has(calId) ? next.delete(calId) : next.add(calId);
    updateSettings({ hidden_calendar_ids: [...next] });
  };

  // Calendar → domain attribution. Every event from a mapped calendar counts
  // toward that domain's invested time; unmapped calendars fall to the AI router.
  const domains = useVertical().data.domains;
  const calMap = settings?.calendar_domain_map ?? {};
  // Composite key — every account's primary calendar shares the id "primary".
  const calKey = (accountId: string, calId: string) => `${accountId}:${calId}`;
  const setCalDomain = (key: string, domainId: string) => {
    const next = { ...calMap };
    if (domainId) next[key] = domainId;
    else delete next[key];
    updateSettings({ calendar_domain_map: next });
  };

  return (
    <div>
      <PaneHeader title="Calendars" sub="Calendars Nuvo reads from and writes to. Toggle which appear on your board, and set the domain each one's meetings count toward." />
      <div className="space-y-3">
        {accounts.map((a) => (
          <div key={a.id} className="overflow-hidden rounded-lg border border-line">
            <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
              <span
                className="flex h-6 w-6 items-center justify-center rounded-md text-label font-semibold text-white"
                style={{ background: providerMeta(a.provider).color }}
              >
                {providerMeta(a.provider).letter}
              </span>
              <div className="min-w-0">
                <div className="text-body font-medium leading-tight">
                  {providerMeta(a.provider).name}
                </div>
                <div className="mono truncate text-label text-muted">{a.email}</div>
              </div>
              <span
                className={`mono ml-1 rounded-full px-1.5 py-0.5 text-meta ${
                  a.sync_direction === "two_way"
                    ? "bg-accent-soft text-accent"
                    : "border border-line text-muted"
                }`}
              >
                {a.sync_direction === "two_way" ? "two-way" : "read-only"}
              </span>
              <div className="flex-1" />
              {a.provider === "google" && a.sync_direction === "two_way" && (
                settings?.default_calendar_account_id === a.id ? (
                  <span className="mono rounded-full bg-accent-soft px-2 py-0.5 text-meta text-accent">
                    default
                  </span>
                ) : (
                  <Btn onClick={() => updateSettings({ default_calendar_account_id: a.id })}>
                    Set as default
                  </Btn>
                )
              )}
              {a.needs_reconnect && a.provider !== "ics" && (
                <Btn kind="signal" onClick={() => connect(a.provider as "google" | "m365")}>
                  Reconnect
                </Btn>
              )}
              {a.needs_reconnect && a.provider === "ics" && (
                <Btn
                  kind="signal"
                  onClick={() => {
                    setIcsLabel(a.email);
                    setShowIcs(true);
                  }}
                >
                  Update link
                </Btn>
              )}
              <Btn onClick={() => disconnect(a.id)}>Disconnect</Btn>
            </div>
            <div className="space-y-0.5 p-1.5">
              {(a.calendars ?? []).map((c) => {
                const on = !hidden.has(c.id);
                return (
                  <div
                    key={c.id}
                    className="fast flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-caption hover:bg-surface-2"
                  >
                    <button
                      onClick={() => toggleCalendar(c.id)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                        style={{ background: on ? (c.color ?? "var(--muted)") : "transparent", boxShadow: on ? "none" : "inset 0 0 0 1.5px var(--line-strong)" }}
                      />
                      <span className={`min-w-0 flex-1 truncate ${on ? "text-ink" : "text-muted line-through decoration-line-strong"}`}>
                        {c.summary}
                      </span>
                    </button>
                    <select
                      value={calMap[calKey(a.id, c.id)] ?? ""}
                      onChange={(e) => setCalDomain(calKey(a.id, c.id), e.target.value)}
                      title="Attribute this calendar's meetings to a domain"
                      className="fast max-w-[8rem] shrink-0 truncate rounded-md border border-line bg-surface px-1.5 py-1 text-meta text-muted hover:text-ink"
                    >
                      <option value="">Auto · domain</option>
                      {domains.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => toggleCalendar(c.id)}
                      className={`fast relative h-4 w-7 shrink-0 rounded-full ${on ? "bg-accent" : "bg-line-strong"}`}
                      title={on ? "Shown on your board" : "Hidden"}
                    >
                      <span
                        className="fast absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm"
                        style={{ left: on ? "14px" : "2px" }}
                      />
                    </button>
                  </div>
                );
              })}
              {(a.calendars ?? []).length === 0 && (
                <div className="px-2 py-1.5 text-caption text-muted">No calendars synced yet.</div>
              )}
            </div>
          </div>
        ))}

        {/* Individually hidden events — the cross-shell place to bring one back
            (the desktop calendar also has an inline eye toggle). */}
        {(settings?.hidden_events ?? []).length > 0 && (
          <div className="overflow-hidden rounded-lg border border-line">
            <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
              <span className="text-body font-medium leading-tight">Hidden events</span>
              <span className="mono ml-auto rounded-full border border-line px-1.5 py-0.5 text-meta text-muted">
                {(settings?.hidden_events ?? []).length}
              </span>
            </div>
            <div className="space-y-0.5 p-1.5">
              {(settings?.hidden_events ?? []).map((h) => (
                <div
                  key={h.key}
                  className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-caption hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1 truncate text-muted line-through decoration-line-strong">
                    {h.title || "Untitled event"}
                  </span>
                  {h.key.includes(":series:") && (
                    <span className="mono shrink-0 rounded-full border border-line px-1.5 py-0.5 text-meta text-muted">series</span>
                  )}
                  <Btn
                    onClick={() =>
                      updateSettings({ hidden_events: (settings?.hidden_events ?? []).filter((x) => x.key !== h.key) })
                    }
                  >
                    Show
                  </Btn>
                </div>
              ))}
            </div>
            <p className="px-3 pb-2.5 pt-0.5 text-label text-muted">
              Hidden events stay on the server — they're just kept off your board and out of time-blocking.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Btn kind="primary" onClick={() => connect("google")}>
            {accounts.some((a) => a.provider === "google") ? "+ Add Google account" : "Connect Google"}
          </Btn>
          {!accounts.some((a) => a.provider === "m365") && (
            <Btn onClick={() => connect("m365")}>Connect Microsoft 365</Btn>
          )}
          {!showIcs && (
            <Btn onClick={() => setShowIcs(true)}>Subscribe via calendar link</Btn>
          )}
        </div>

        {showIcs && (
          <div className="space-y-2 rounded-lg border border-line bg-surface-2 p-3">
            <div className="text-caption font-medium">Subscribe via calendar link</div>
            <p className="text-label text-muted">
              Paste a published <span className="mono">.ics</span> URL (e.g. Outlook → Settings → Calendar →
              Shared calendars → Publish). Read-only, refreshes every ~15 min. The link grants full read
              access to that calendar, so treat it like a password — it's stored encrypted.
            </p>
            <input
              value={icsUrl}
              onChange={(e) => setIcsUrl(e.target.value)}
              placeholder="https://outlook.office365.com/owa/calendar/…/calendar.ics"
              className="mono w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-label outline-none focus:border-accent"
              autoFocus
            />
            <input
              value={icsLabel}
              onChange={(e) => setIcsLabel(e.target.value)}
              placeholder="Label (optional) — e.g. Work calendar"
              className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-label outline-none focus:border-accent"
              onKeyDown={(e) => e.key === "Enter" && subscribeIcs()}
            />
            {icsError && <div className="text-label text-signal">{icsError}</div>}
            <div className="flex gap-2">
              <Btn kind="primary" disabled={icsBusy || !icsUrl.trim()} onClick={subscribeIcs}>
                {icsBusy ? "Subscribing…" : "Subscribe"}
              </Btn>
              <Btn
                disabled={icsBusy}
                onClick={() => {
                  setShowIcs(false);
                  setIcsError(null);
                }}
              >
                Cancel
              </Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IntegrationsPane() {
  return (
    <div>
      <PaneHeader
        title="Integrations"
        sub="Feeds of completed work that flow into your projects as actuals — what you shipped, not what's scheduled."
      />
      <GitHubConnect />
    </div>
  );
}

function LabelsPane() {
  const { labels, createLabel, updateLabel, deleteLabel } = useLabels();
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#2563EB");

  return (
    <div>
      <PaneHeader title="Labels" sub="Color-coded tags you can attach to any task across the board." />
      <div className="space-y-1.5">
        {labels.map((l) => (
          <div key={l.id} className="group flex items-center gap-2 rounded-md border border-transparent px-1 py-0.5 hover:border-line hover:bg-surface-2">
            <input
              type="color"
              value={l.color}
              onChange={(e) => updateLabel({ id: l.id, color: e.target.value })}
              className="h-7 w-8 cursor-pointer rounded-md border border-line bg-surface"
            />
            <input
              defaultValue={l.name}
              onBlur={(e) =>
                e.target.value.trim() &&
                e.target.value !== l.name &&
                updateLabel({ id: l.id, name: e.target.value.trim() })
              }
              className="flex-1 rounded-md border border-line bg-bg px-2 py-1 text-body outline-none focus:border-accent"
            />
            <button
              onClick={() => deleteLabel(l.id)}
              title="Delete label"
              className="fast flex h-7 w-7 items-center justify-center rounded-md text-muted opacity-0 hover:bg-signal-soft hover:text-signal group-hover:opacity-100"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 4h8M5.5 4V3h3v1M4 4l.5 7h5L10 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        ))}
        {labels.length === 0 && <div className="px-1 py-2 text-caption text-muted">No labels yet — add one below.</div>}

        <form
          className="mt-2 flex items-center gap-2 border-t border-line pt-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newLabel.trim()) return;
            await createLabel({ name: newLabel.trim(), color: newColor });
            setNewLabel("");
          }}
        >
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="h-7 w-8 cursor-pointer rounded-md border border-line bg-surface"
          />
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="New label…"
            className="flex-1 rounded-md border border-line bg-bg px-2 py-1 text-body outline-none focus:border-accent"
          />
          <Btn kind="primary">Add</Btn>
        </form>
      </div>
    </div>
  );
}

function AccountPane() {
  const [email, setEmail] = useState("");
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  return (
    <div>
      <PaneHeader title="Account" sub="You're signed in to Nuvo." />
      <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 p-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-head font-semibold uppercase text-accent">
          {email ? email[0] : "?"}
        </span>
        <div className="min-w-0">
          <div className="text-label uppercase tracking-wider text-muted">Signed in as</div>
          <div className="mono truncate text-body text-ink">{email || "…"}</div>
        </div>
        <div className="flex-1" />
        <Btn kind="signal" onClick={() => supabase.auth.signOut()}>
          Sign out
        </Btn>
      </div>
    </div>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────
export default function SettingsModal({
  settings,
  updateSettings,
  accounts,
  section,
  onClose,
}: {
  settings: UserSettings | undefined;
  updateSettings: (patch: Partial<UserSettings>) => void;
  accounts: CalendarAccount[];
  section: SettingsSection;
  onClose: () => void;
}) {
  const { setSettingsSection } = useAppNavigation();
  const isMobile = useIsMobile();

  // The active section is owned here so it works in both shells. Desktop seeds it
  // from the nav (deep-links / URL), the mobile shell mounts at the section list.
  // (The mobile shell can't drive `section` through global nav, so relying on the
  // prop alone left tapping a section a no-op — hence local state.)
  const [active, setActive] = useState<SectionId>(section as SectionId);
  useEffect(() => setActive(section as SectionId), [section]);
  // On a phone, start at the index list rather than dropped inside a pane.
  const [drilled, setDrilled] = useState(!isMobile);

  const select = (id: SectionId) => {
    setActive(id);
    setSettingsSection(id); // keep desktop nav / URL in sync
    setDrilled(true);
  };

  const pane = (
    <>
      {active === "appearance" && <AppearancePane settings={settings} updateSettings={updateSettings} />}
      {active === "schedule" && <SchedulePane settings={settings} updateSettings={updateSettings} />}
      {active === "connections" && (
        <ConnectionsPane settings={settings} updateSettings={updateSettings} accounts={accounts} />
      )}
      {active === "integrations" && <IntegrationsPane />}
      {active === "labels" && <LabelsPane />}
      {active === "account" && <AccountPane />}
    </>
  );

  // ── Mobile: full-height master-detail (iOS-style list → drill into pane) ──
  if (isMobile) {
    return (
      <Modal onClose={onClose} width="max-w-md">
        <div className="flex h-[85vh] flex-col">
          <div className="flex items-center gap-1 border-b border-line px-2 py-2.5">
            {drilled ? (
              <button onClick={() => setDrilled(false)} className="tap flex items-center gap-1 pr-2 text-body font-medium text-accent">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M11 4l-5 5 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Settings
              </button>
            ) : (
              <div className="px-1 text-head font-semibold">Settings</div>
            )}
            <div className="flex-1" />
            <button
              onClick={onClose}
              aria-label="Close settings"
              className="tap flex h-10 w-10 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M5 5l8 8M13 5l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {drilled ? (
            <div key={active} className="floor-enter flex-1 overflow-y-auto px-4 pb-safe pt-4">
              {pane}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-2 pb-safe">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => select(s.id)}
                  className="tap fast flex w-full items-center gap-3 rounded-lg px-3 text-left text-body font-medium text-ink hover:bg-surface-2"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted">
                    {s.icon}
                  </span>
                  <span className="flex-1">{s.label}</span>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-muted">
                    <path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>
    );
  }

  // ── Desktop: side-by-side nav + pane (unchanged) ──
  return (
    <Modal onClose={onClose} width="max-w-4xl">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="text-head font-semibold">Settings</div>
        <button onClick={onClose} className="keycap">
          esc
        </button>
      </div>

      <div className="flex h-[min(84vh,680px)]">
        {/* Section nav */}
        <nav className="w-[188px] shrink-0 space-y-0.5 overflow-y-auto border-r border-line bg-surface-2/40 p-2.5">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => select(s.id)}
              className={`fast flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-body font-medium ${
                active === s.id
                  ? "bg-accent-soft text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-ink"
              }`}
            >
              <span className={active === s.id ? "text-accent" : "text-muted"}>{s.icon}</span>
              {s.label}
            </button>
          ))}
        </nav>

        {/* Active pane */}
        <div key={active} className="floor-enter flex-1 overflow-y-auto p-5">
          {pane}
        </div>
      </div>
    </Modal>
  );
}
