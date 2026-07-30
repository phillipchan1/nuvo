import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { linkGoogleIdentity } from "../lib/googleAuth";
import { formatHourLabel } from "../lib/dates";
import { readRevealConfig, writeRevealConfig, type RevealConfig } from "../lib/weekReveal";
import type { CalendarAccount, UserSettings } from "../lib/types";
import { firstDayOfWeek } from "../hooks/useSettings";
import { useLabels } from "../hooks/useCalendar";
import { useVertical } from "../hooks/useVertical";
import { Btn, Modal } from "./ui";
import { Field, TextInput, Select, Toggle, Stepper, Segmented } from "./form";
import { GitHubConnect } from "./GitHubConnect";
import { BillingPane } from "./billing/BillingPane";
import type { SettingsSection } from "../lib/appNav";
import { useMaxPerWeek, useMaxPerQuarter } from "../hooks/usePlannerPrefs";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { useOrientation } from "../hooks/useOrientation";
import { useIsMobile } from "../hooks/useIsMobile";
import { useSkin, useScheme, SKIN_LABELS, SCHEMES, SCHEME_GROUP, schemeModes, type Skin, type Scheme, type SchemeModes } from "../hooks/useSkin";
import { useUiScale, UI_SCALE_MIN, UI_SCALE_MAX } from "../hooks/useUiScale";
import { useHomeTimezone } from "../hooks/useHomeTimezone";
import { detectDeviceTz, supportedTimeZones, tzAbbrev, tzCity, tzStatus } from "../lib/timezone";
import { useUpdater } from "../hooks/useUpdater";
import { isDesktopTauri } from "../lib/platform";
import { loadChangelog, isMinor, type ChangelogEntry } from "../lib/changelog";

/** Stable-named universal DMG on the public releases repo. */
const DOWNLOAD_MAC_URL =
  "https://github.com/phillipchan1/nuvo-releases/releases/latest/download/Nuvo.dmg";

// ── Section registry ──────────────────────────────────────────────────────
type SectionId = "appearance" | "schedule" | "connections" | "integrations" | "labels" | "account" | "billing" | "about";

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
  {
    id: "billing",
    label: "Billing",
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <rect x="1.8" y="3.8" width="12.4" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M1.8 6.6h12.4" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4 10h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "about",
    label: "About",
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="5.8" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8 7.2v3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="8" cy="5.2" r="0.9" fill="currentColor" />
      </svg>
    ),
  },
];

// ── Shared layout atoms ───────────────────────────────────────────────────
// `Row` is the settings field unit — Field from the form primitives (label-left
// / control-right, stacking full-width on a phone).
const Row = Field;

function PaneHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-lead font-semibold text-ink">{title}</h2>
      <p className="mt-1 text-caption leading-snug text-muted">{sub}</p>
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
    <div className="max-w-4xl">
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

// ── Time zone ──────────────────────────────────────────────────────────────
// Home is the stable zone travel is measured against; the device zone is set by
// the OS and only shown. Nuvo renders schedule times in wherever you are now, so
// this is really "what counts as home" plus a live readout of any current shift.
function TimeZonePicker() {
  const [homeTz, setHomeTz] = useHomeTimezone();
  const deviceTz = detectDeviceTz();
  const now = new Date();
  const s = tzStatus(homeTz, deviceTz, now);

  // Group the IANA list by region (America / Europe / …) for a scannable select.
  const groups = useMemo(() => {
    const by = new Map<string, string[]>();
    for (const z of supportedTimeZones()) {
      const region = z.includes("/") ? z.split("/")[0] : "Other";
      (by.get(region) ?? by.set(region, []).get(region)!).push(z);
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, []);

  return (
    <div className="flex flex-col items-stretch gap-2">
      <Select
        value={homeTz}
        onChange={(e) => setHomeTz(e.target.value)}
        className="mono w-full sm:w-[20rem]"
      >
        {/* Keep the current value selectable even if the runtime omits it. */}
        {!supportedTimeZones().includes(homeTz) && <option value={homeTz}>{tzCity(homeTz)}</option>}
        {groups.map(([region, zones]) => (
          <optgroup key={region} label={region}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {tzCity(z)} ({tzAbbrev(z, now)})
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      {s.traveling ? (
        <div className="flex items-center gap-2 text-meta text-muted">
          <span>
            Now in <span className="text-ink">{tzCity(deviceTz)}</span> ({s.deviceAbbr}) · {s.deltaLabel} of home
          </span>
          <button
            onClick={() => setHomeTz(deviceTz)}
            className="fast rounded-full border border-line px-2 py-0.5 font-medium text-muted hover:border-line-strong hover:text-ink"
            title={`Make ${tzCity(deviceTz)} your home zone`}
          >
            Set as home
          </button>
        </div>
      ) : (
        <span className="text-meta text-muted">Matches where you are now ({s.deviceAbbr}).</span>
      )}
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
  const [maxPerQuarter, setMaxPerQuarterPref] = useMaxPerQuarter();

  // The weekly Review reveal — a per-device nudge, so it lives in localStorage
  // (not the synced settings row). Default Friday 1pm.
  const [reveal, setRevealState] = useState<RevealConfig>(() => readRevealConfig());
  const patchReveal = (p: Partial<RevealConfig>) => {
    const next = { ...reveal, ...p };
    setRevealState(next);
    writeRevealConfig(next);
  };

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
      {/* A form grid: stacked cells (label over control) tile into two columns on
          a wide modal and fall back to one column on a phone. */}
      <div className="grid grid-cols-1 gap-x-12 gap-y-7 lg:grid-cols-2">
        <Row
          layout="stack"
          title="Time zone"
          desc="Your home zone. Nuvo shows schedule times wherever you are now, and flags on the schedule when that differs from home."
        >
          <TimeZonePicker />
        </Row>

        <Row layout="stack" title="Day view window" desc="The span of hours shown in your calendar.">
          <div className="flex items-center gap-2.5">
            <Select
              value={settings?.day_start_hour ?? 6}
              onChange={(e) => updateSettings({ day_start_hour: Number(e.target.value) })}
              className="mono w-full sm:w-32"
            >
              {Array.from({ length: 12 }, (_, h) => (
                <option key={h} value={h}>
                  {formatHourLabel(h)}
                </option>
              ))}
            </Select>
            <span className="text-caption text-muted">to</span>
            <Select
              value={settings?.day_end_hour ?? 24}
              onChange={(e) => updateSettings({ day_end_hour: Number(e.target.value) })}
              className="mono w-full sm:w-32"
            >
              {Array.from({ length: 12 }, (_, i) => i + 13).map((h) => (
                <option key={h} value={h}>
                  {formatHourLabel(h)}
                </option>
              ))}
            </Select>
          </div>
        </Row>

        <Row layout="stack" title="Working hours" desc="The window Nuvo proposes focus blocks inside.">
          <div className="flex items-center gap-2.5">
            <TextInput
              type="time"
              step={900}
              value={toMinLabel(settings?.work_start_minutes ?? 480)}
              onChange={setWork("work_start_minutes")}
              className="mono w-full sm:w-36"
            />
            <span className="text-caption text-muted">to</span>
            <TextInput
              type="time"
              step={900}
              value={toMinLabel(settings?.work_end_minutes ?? 990)}
              onChange={setWork("work_end_minutes")}
              className="mono w-full sm:w-36"
            />
          </div>
        </Row>

        <Row
          layout="stack"
          title="Hours on screen"
          desc="How many hours of your day view fill the screen. More hours = less scrolling; fewer = taller rows."
        >
          <Stepper
            value={fitClamped}
            min={6}
            max={windowHours}
            onChange={(v) => updateSettings({ calendar_fit_hours: v })}
            format={(v) => `${v}h`}
            decHint="Fewer hours (taller rows)"
            incHint="More hours (less scrolling)"
          />
        </Row>

        <Row layout="stack" title="Week starts on" desc="The first column of the week and month views.">
          <Segmented
            value={String(firstDayOfWeek(settings))}
            onChange={(v) => updateSettings({ week_start: Number(v) })}
            options={[
              { value: "0", label: "Sunday" },
              { value: "1", label: "Monday" },
            ]}
          />
        </Row>

        <Row layout="stack" title="Projects per week" desc="How many projects you'll commit to a single week before On Deck flags it as overloaded. Fewer = more focus.">
          <Stepper value={maxPerWeek} min={1} max={6} onChange={setMaxPerWeekPref} decHint="Fewer per week" incHint="More per week" />
        </Row>

        <Row layout="stack" title="Initiatives per quarter" desc="How many initiatives you'll commit to a single quarter before On Deck flags it as overloaded. Fewer = more focus.">
          <Stepper value={maxPerQuarter} min={1} max={6} onChange={setMaxPerQuarterPref} decHint="Fewer per quarter" incHint="More per quarter" />
        </Row>

        <Row layout="stack" title="Weekly Review reveal" desc="When the week's Review quietly lights up as ready — an invitation, never forced.">
          <div className="flex flex-wrap items-center gap-2.5">
            <Toggle checked={reveal.enabled} onChange={(v) => patchReveal({ enabled: v })} label="Weekly Review reveal" />
            <Select
              value={reveal.dow}
              onChange={(e) => patchReveal({ dow: Number(e.target.value) })}
              disabled={!reveal.enabled}
              className="w-36"
            >
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => (
                <option key={i} value={i}>
                  {d}
                </option>
              ))}
            </Select>
            <span className="text-caption text-muted">at</span>
            <TextInput
              type="time"
              step={900}
              value={toMinLabel(reveal.minutes)}
              onChange={(e) => {
                if (!e.target.value) return;
                const [h, mm] = e.target.value.split(":").map(Number);
                patchReveal({ minutes: h * 60 + mm });
              }}
              disabled={!reveal.enabled}
              className="mono w-32"
            />
          </div>
        </Row>

        <Row layout="stack" title="Weather" desc="Show a weather icon and high temperature next to each day in the calendar. Requires location access.">
          <Toggle
            checked={settings?.show_weather ?? false}
            onChange={(v) => updateSettings({ show_weather: v })}
            label="Weather"
          />
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

  // ── iCloud / Apple Calendar (CalDAV, app-specific password) ──
  const [showIcloud, setShowIcloud] = useState(false);
  const [appleId, setAppleId] = useState("");
  const [applePw, setApplePw] = useState("");
  const [icloudBusy, setIcloudBusy] = useState(false);
  const [icloudError, setIcloudError] = useState<string | null>(null);

  const connectIcloud = async () => {
    if (!appleId.trim() || !applePw.trim() || icloudBusy) return;
    setIcloudBusy(true);
    setIcloudError(null);
    const { error } = await supabase.functions.invoke("icloud-connect", {
      body: { appleId: appleId.trim(), appPassword: applePw.trim() },
    });
    if (error) {
      let msg = error.message;
      // deno-lint-ignore no-explicit-any
      try {
        const body = await (error as any).context?.json?.();
        if (body?.error) msg = body.error;
      } catch { /* keep the generic message */ }
      setIcloudError(msg);
      setIcloudBusy(false);
      return;
    }
    setIcloudBusy(false);
    setAppleId("");
    setApplePw("");
    setShowIcloud(false);
    qc.invalidateQueries({ queryKey: ["calendar_accounts"] });
  };

  const providerMeta = (p: CalendarAccount["provider"]) =>
    p === "google"
      ? { letter: "G", name: "Google", color: "#4285F4" }
      : p === "m365"
        ? { letter: "M", name: "Microsoft 365", color: "#2563EB" }
        : p === "icloud"
          ? { letter: "", name: "Apple Calendar", color: "#111111" }
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

  // Which accounts have their "hidden calendars" drawer expanded. Turned-off
  // calendars collapse away by default so a busy account (a dozen shared
  // calendars) reads as just the few you actually watch.
  const [showHiddenCals, setShowHiddenCals] = useState<Set<string>>(new Set());
  const toggleHiddenDrawer = (accountId: string) =>
    setShowHiddenCals((prev) => {
      const next = new Set(prev);
      next.has(accountId) ? next.delete(accountId) : next.add(accountId);
      return next;
    });

  // One calendar's row — color dot + name, its domain attribution, and the on/off
  // switch. Hidden calendars render the same row, just dimmed and without the
  // domain picker (nothing to attribute while it's off the board).
  const calRow = (a: CalendarAccount, c: NonNullable<CalendarAccount["calendars"]>[number], on: boolean) => (
    <div
      key={c.id}
      className="fast flex w-full items-center gap-3 rounded-[var(--radius)] px-2.5 py-2 hover:bg-surface-2"
    >
      <button onClick={() => toggleCalendar(c.id)} className="tap flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span
          className="h-3 w-3 shrink-0 rounded-[4px]"
          style={{
            background: on ? (c.color ?? "var(--muted)") : "transparent",
            boxShadow: on ? "none" : "inset 0 0 0 1.5px var(--line-strong)",
          }}
        />
        <span className={`min-w-0 flex-1 truncate text-body ${on ? "text-ink" : "text-muted"}`}>{c.summary}</span>
      </button>
      {on && (
        <Select
          value={calMap[calKey(a.id, c.id)] ?? ""}
          onChange={(e) => setCalDomain(calKey(a.id, c.id), e.target.value)}
          title="Attribute this calendar's meetings to a domain"
          className="w-36 shrink-0 text-caption text-muted"
        >
          <option value="">Auto · domain</option>
          {domains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      )}
      <Toggle checked={on} onChange={() => toggleCalendar(c.id)} label={`Show ${c.summary}`} />
    </div>
  );

  return (
    <div>
      {/* The walkthrough opens Settings here and lights this pane's header, so the
          last step lands on the thing it's asking for instead of the whole modal. */}
      <div data-teach="calendars">
        <PaneHeader title="Calendars" sub="Calendars Nuvo reads from and writes to. Toggle which appear on your board, and set the domain each one's meetings count toward." />
      </div>
      <div className="space-y-5">
        {/* Google's own "add video conferencing automatically" preference only
            applies to events created in *their* web UI — it never reaches an
            event booked through the API, so this is the only thing deciding
            whether a meeting Nuvo makes has a way to meet digitally. */}
        {accounts.some((a) => a.provider === "google" && a.sync_direction === "two_way") && (
          <Row
            layout="stack"
            title="Add Google Meet to new events"
            desc="Google never adds a Meet link to events created outside its own web app, so Nuvo asks for one. The composer can still override it per event."
          >
            <Segmented
              value={settings?.auto_add_meet ?? "guests"}
              onChange={(v) => updateSettings({ auto_add_meet: v as UserSettings["auto_add_meet"] })}
              options={[
                { value: "guests", label: "With guests" },
                { value: "always", label: "Always" },
                { value: "never", label: "Never" },
              ]}
            />
          </Row>
        )}

        {/* Account cards flow into two columns on a wide modal — a busy calendar
            setup (several accounts) fills the space instead of a long scroll. */}
        <div className="columns-1 gap-5 xl:columns-2 [&>*]:mb-5 [&>*]:break-inside-avoid">
          {accounts.map((a) => {
            const cals = a.calendars ?? [];
            const shown = cals.filter((c) => !hidden.has(c.id));
            const hiddenCals = cals.filter((c) => hidden.has(c.id));
            const drawerOpen = showHiddenCals.has(a.id);
            return (
              <div key={a.id} className="overflow-hidden rounded-lg border border-line bg-surface">
                <div className="flex items-center gap-2.5 border-b border-line bg-surface-2 px-4 py-3">
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-md text-label font-semibold text-white"
                    style={{ background: providerMeta(a.provider).color }}
                  >
                    {providerMeta(a.provider).letter}
                  </span>
                  <div className="min-w-0">
                    <div className="text-body font-medium leading-tight">{providerMeta(a.provider).name}</div>
                    <div className="mono truncate text-label text-muted">{a.email}</div>
                  </div>
                  <span
                    className={`mono ml-1 rounded-full px-2 py-0.5 text-meta ${
                      a.sync_direction === "two_way" ? "bg-accent-soft text-accent" : "border border-line text-muted"
                    }`}
                  >
                    {a.sync_direction === "two_way" ? "two-way" : "read-only"}
                  </span>
                  <div className="flex-1" />
                  {a.provider === "google" && a.sync_direction === "two_way" && (
                    settings?.default_calendar_account_id === a.id ? (
                      <span className="mono rounded-full bg-accent-soft px-2 py-0.5 text-meta text-accent">default</span>
                    ) : (
                      <Btn onClick={() => updateSettings({ default_calendar_account_id: a.id })}>Set as default</Btn>
                    )
                  )}
                  {a.needs_reconnect && a.provider !== "ics" && a.provider !== "icloud" && (
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
                  {a.needs_reconnect && a.provider === "icloud" && (
                    <Btn
                      kind="signal"
                      onClick={() => {
                        setAppleId(a.email);
                        setShowIcloud(true);
                      }}
                    >
                      Reconnect
                    </Btn>
                  )}
                  <Btn onClick={() => disconnect(a.id)}>Disconnect</Btn>
                </div>
                <div className="space-y-0.5 p-2">
                  {shown.map((c) => calRow(a, c, true))}
                  {shown.length === 0 && hiddenCals.length === 0 && (
                    <div className="px-2.5 py-2 text-caption text-muted">No calendars synced yet.</div>
                  )}
                  {shown.length === 0 && hiddenCals.length > 0 && (
                    <div className="px-2.5 py-2 text-caption text-muted">Every calendar here is hidden.</div>
                  )}

                  {hiddenCals.length > 0 && (
                    <div className="pt-0.5">
                      <button
                        onClick={() => toggleHiddenDrawer(a.id)}
                        className="fast tap flex w-full items-center gap-2 rounded-[var(--radius)] px-2.5 py-2 text-left text-caption text-muted hover:bg-surface-2 hover:text-ink"
                      >
                        <svg
                          viewBox="0 0 16 16"
                          className={`h-3.5 w-3.5 shrink-0 transition-transform ${drawerOpen ? "rotate-90" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M6 4l4 4-4 4" />
                        </svg>
                        <span>
                          {hiddenCals.length} hidden calendar{hiddenCals.length > 1 ? "s" : ""}
                        </span>
                      </button>
                      {drawerOpen && <div className="mt-0.5 space-y-0.5 opacity-70">{hiddenCals.map((c) => calRow(a, c, false))}</div>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2">
          <Btn kind="primary" onClick={() => connect("google")}>
            {accounts.some((a) => a.provider === "google") ? "+ Add Google account" : "Connect Google"}
          </Btn>
          {!accounts.some((a) => a.provider === "m365") && (
            <Btn onClick={() => connect("m365")}>Connect Microsoft 365</Btn>
          )}
          {!accounts.some((a) => a.provider === "icloud") && !showIcloud && (
            <Btn onClick={() => setShowIcloud(true)}>Connect Apple Calendar</Btn>
          )}
          {!showIcs && (
            <Btn onClick={() => setShowIcs(true)}>Subscribe via calendar link</Btn>
          )}
        </div>

        {showIcloud && (
          <div className="max-w-2xl space-y-3 rounded-lg border border-line bg-surface-2 p-4">
            <div className="text-caption font-medium">Connect Apple Calendar (iCloud)</div>
            <p className="text-label text-muted">
              Apple has no “Sign in” button for calendars — instead you generate a one-off{" "}
              <span className="font-medium">app-specific password</span> that grants Nuvo two-way access over
              CalDAV. It’s stored encrypted and you can revoke it anytime from your Apple account.
            </p>
            <ol className="ml-4 list-decimal space-y-1 text-label text-muted">
              <li>
                Go to{" "}
                <a
                  href="https://account.apple.com/account/manage"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent underline"
                >
                  account.apple.com
                </a>{" "}
                and sign in.
              </li>
              <li>Under <span className="font-medium">Sign-In and Security</span>, choose <span className="font-medium">App-Specific Passwords</span>.</li>
              <li>Select <span className="font-medium">＋ Generate an app-specific password</span>, name it “Nuvo”, and confirm.</li>
              <li>Copy the password Apple shows (format <span className="mono">abcd-efgh-ijkl-mnop</span>) and paste it below.</li>
            </ol>
            <TextInput
              value={appleId}
              onChange={(e) => setAppleId(e.target.value)}
              placeholder="Apple ID email — e.g. you@icloud.com"
              autoComplete="username"
              autoFocus
            />
            <TextInput
              value={applePw}
              onChange={(e) => setApplePw(e.target.value)}
              placeholder="App-specific password — abcd-efgh-ijkl-mnop"
              type="password"
              autoComplete="off"
              className="mono"
              onKeyDown={(e) => e.key === "Enter" && connectIcloud()}
            />
            {icloudError && <div className="text-label text-signal">{icloudError}</div>}
            <div className="flex gap-2">
              <Btn kind="primary" disabled={icloudBusy || !appleId.trim() || !applePw.trim()} onClick={connectIcloud}>
                {icloudBusy ? "Connecting…" : "Connect"}
              </Btn>
              <Btn
                disabled={icloudBusy}
                onClick={() => {
                  setShowIcloud(false);
                  setIcloudError(null);
                }}
              >
                Cancel
              </Btn>
            </div>
          </div>
        )}

        {showIcs && (
          <div className="max-w-2xl space-y-3 rounded-lg border border-line bg-surface-2 p-4">
            <div className="text-caption font-medium">Subscribe via calendar link</div>
            <p className="text-label text-muted">
              Paste a published <span className="mono">.ics</span> URL (e.g. Outlook → Settings → Calendar →
              Shared calendars → Publish). Read-only, refreshes every ~15 min. The link grants full read
              access to that calendar, so treat it like a password — it's stored encrypted.
            </p>
            <TextInput
              value={icsUrl}
              onChange={(e) => setIcsUrl(e.target.value)}
              placeholder="https://outlook.office365.com/owa/calendar/…/calendar.ics"
              className="mono"
              autoFocus
            />
            <TextInput
              value={icsLabel}
              onChange={(e) => setIcsLabel(e.target.value)}
              placeholder="Label (optional) — e.g. Work calendar"
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
    <div className="max-w-2xl">
      <PaneHeader
        title="Integrations"
        sub="Feeds of completed work that flow into your projects as actuals — what you shipped, not what's scheduled."
      />
      <GitHubConnect />
    </div>
  );
}

// Desktop-only: manually check for an update and, when one is staged, restart
// into it. Shares state with the bottom-right toast via the update store, so the
// two never disagree.
function UpdateControls() {
  const { state, check, restart } = useUpdater();
  const busy = state.status === "checking" || state.status === "downloading";

  const message = {
    idle: "Checked automatically in the background.",
    checking: "Checking…",
    "up-to-date": "You're on the latest version.",
    downloading: `Downloading v${state.version ?? ""}… ${state.progress}%`,
    ready: `Version ${state.version ?? ""} is ready.`,
    // A failed check is harmless — the current build keeps working — so keep it
    // gentle and never surface the raw request error / URL to the user.
    error: "Couldn't check for updates right now. Try again later.",
  }[state.status];

  return (
    <div className="py-3.5">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="text-body font-medium text-ink">Updates</div>
          <div className="mt-0.5 text-caption leading-snug text-muted" data-status={state.status}>
            {message}
          </div>
        </div>
        <div className="shrink-0">
          {state.status === "ready" ? (
            <button
              onClick={restart}
              className="fast rounded-md border border-accent bg-accent px-3 py-1.5 text-caption font-medium text-white shadow-sm hover:brightness-110 active:translate-y-px"
            >
              Restart to update
            </button>
          ) : (
            <Btn onClick={check} disabled={busy}>
              {busy ? "Checking…" : "Check for updates"}
            </Btn>
          )}
        </div>
      </div>
      {state.status === "ready" && state.notes && (
        <details className="mt-2 text-caption text-muted">
          <summary className="cursor-pointer select-none hover:text-ink fast">
            What's new in v{state.version}
          </summary>
          <p className="mt-1 whitespace-pre-line leading-snug">{state.notes}</p>
        </details>
      )}
    </div>
  );
}

// The cumulative version history bundled into the app by CI (falls back to the
// public GitHub Releases API on web/dev). Lets someone who's been away catch up
// on everything that changed, not just the last hop they auto-updated through.
// Notable releases are listed individually; runs of minor/internal builds fold
// into a count. Hides itself when there's no history to show.
function ReleaseHistory() {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  useEffect(() => {
    void loadChangelog().then(setEntries);
  }, []);

  if (!entries || entries.length === 0) return null;

  type RowKind = { kind: "release"; entry: ChangelogEntry } | { kind: "minor"; count: number };
  const rows: RowKind[] = [];
  let minorRun = 0;
  for (const entry of entries) {
    if (isMinor(entry.notes)) {
      minorRun += 1;
      continue;
    }
    if (minorRun) {
      rows.push({ kind: "minor", count: minorRun });
      minorRun = 0;
    }
    rows.push({ kind: "release", entry });
  }
  if (minorRun) rows.push({ kind: "minor", count: minorRun });

  return (
    <div className="mt-6 border-t border-line pt-4">
      <div className="section-label mb-2">What's new</div>
      <ul className="space-y-3">
        {rows.map((row, i) =>
          row.kind === "release" ? (
            <li key={row.entry.version}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-body font-medium text-ink">
                  v{row.entry.version}
                  {row.entry.version === __APP_VERSION__ && (
                    <span className="ml-1 text-caption font-normal text-accent">· current</span>
                  )}
                </span>
                <span className="text-meta text-muted">{formatReleaseDate(row.entry.date)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-line text-caption leading-snug text-muted">
                {row.entry.notes}
              </p>
            </li>
          ) : (
            <li key={`minor-${i}`} className="text-caption text-muted">
              + {row.count} smaller update{row.count > 1 ? "s" : ""}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function formatReleaseDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function LabelsPane() {
  const { labels, createLabel, updateLabel, deleteLabel } = useLabels();
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#2563EB");

  return (
    <div className="max-w-2xl">
      <PaneHeader title="Labels" sub="Color-coded tags you can attach to any task across the board." />
      <div className="space-y-1">
        {labels.map((l) => (
          <div key={l.id} className="group flex items-center gap-2.5 rounded-[var(--radius)] border border-transparent px-1.5 py-1 hover:border-line hover:bg-surface-2">
            <input
              type="color"
              value={l.color}
              onChange={(e) => updateLabel({ id: l.id, color: e.target.value })}
              className="h-9 w-10 shrink-0 cursor-pointer rounded-[var(--radius)] border border-line bg-surface"
            />
            <TextInput
              defaultValue={l.name}
              onBlur={(e) =>
                e.target.value.trim() &&
                e.target.value !== l.name &&
                updateLabel({ id: l.id, name: e.target.value.trim() })
              }
            />
            <button
              onClick={() => deleteLabel(l.id)}
              title="Delete label"
              className="fast tap flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius)] text-muted hover:bg-signal-soft hover:text-signal sm:opacity-0 sm:group-hover:opacity-100"
            >
              <svg width="15" height="15" viewBox="0 0 14 14" fill="none">
                <path d="M3 4h8M5.5 4V3h3v1M4 4l.5 7h5L10 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        ))}
        {labels.length === 0 && <div className="px-1.5 py-2 text-caption text-muted">No labels yet — add one below.</div>}

        <form
          className="mt-3 flex items-center gap-2.5 border-t border-line pt-4"
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
            className="h-9 w-10 shrink-0 cursor-pointer rounded-[var(--radius)] border border-line bg-surface"
          />
          <TextInput
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="New label…"
          />
          <Btn kind="primary">Add</Btn>
        </form>
      </div>
    </div>
  );
}

function AccountPane() {
  const [email, setEmail] = useState("");
  const [providers, setProviders] = useState<string[]>([]);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const refresh = () => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? "");
      setProviders((data.user?.identities ?? []).map((i) => i.provider));
    });
  };

  useEffect(() => {
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange(() => refresh());
    return () => sub.subscription.unsubscribe();
  }, []);

  const googleLinked = providers.includes("google");

  const linkGoogle = async () => {
    setLinking(true);
    setLinkError(null);
    const { error } = await linkGoogleIdentity();
    if (error) {
      setLinkError(error.message);
      setLinking(false);
    }
    // On success the browser redirects to Google.
  };

  return (
    <div className="max-w-2xl">
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

      {!googleLinked && (
        <div className="mt-5">
          <div className="section-label mb-2">Sign-in methods</div>
          <div className="rounded-lg border border-line bg-surface-2 px-3 py-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-body text-ink">Google</div>
                <div className="text-caption text-muted">
                  Link Google to keep this account and all your data.
                </div>
              </div>
              <Btn kind="primary" disabled={linking} onClick={linkGoogle}>
                {linking ? "Redirecting…" : "Link Google"}
              </Btn>
            </div>
            {linkError && <div className="mt-2 text-caption text-signal">{linkError}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── About: what Nuvo is + replay the welcome tour ─────────────────────────
function AboutPane({ onClose }: { onClose: () => void }) {
  const { open: openOrientation } = useOrientation();
  const desktop = isDesktopTauri();
  return (
    <div className="max-w-2xl">
      <PaneHeader title="About" sub="Your version, what's new, and how to get reacquainted." />

      <div className="mb-2 flex flex-col items-center gap-1 rounded-xl border border-line bg-surface-2/40 px-4 py-7 text-center">
        <div className="wordmark text-lead text-ink">Nuvo</div>
        <p className="max-w-xs text-caption leading-snug text-muted">
          Your whole life — work, family, faith, health — held in one calm place.
        </p>
        <span className="mono mt-1 text-micro text-muted">v{__APP_VERSION__}</span>
      </div>

      {/* Auto-update controls in the native app; a download link on web/iOS. */}
      {desktop ? (
        <UpdateControls />
      ) : (
        <Row title="Download for Mac" desc="Native app — Apple Silicon & Intel, updates itself in the background.">
          <a
            href={DOWNLOAD_MAC_URL}
            className="fast inline-block rounded-md border border-accent bg-accent px-3 py-1.5 text-caption font-medium text-white shadow-sm hover:brightness-110 active:translate-y-px"
          >
            Download
          </a>
        </Row>
      )}

      <ReleaseHistory />

      <div className="section-label mb-2 mt-6">Getting started</div>
      <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2/40 px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-body text-ink">Welcome tour</div>
          <p className="text-caption text-muted">
            A quick walkthrough of calendars, domains, projects, capture, timeblocking, and Nuvo.
          </p>
        </div>
        <Btn kind="primary" onClick={() => { onClose(); openOrientation(); }}>Replay</Btn>
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
      {active === "billing" && (
        <div className="max-w-2xl">
          <BillingPane />
        </div>
      )}
      {active === "about" && <AboutPane onClose={onClose} />}
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
            <div key={active} className="floor-enter flex-1 overflow-y-auto px-5 pb-safe pt-5">
              {pane}
            </div>
          ) : (
            <div className="flex-1 space-y-0.5 overflow-y-auto p-3 pb-safe">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => select(s.id)}
                  className="tap fast flex w-full items-center gap-3 rounded-[var(--radius)] px-3 py-2 text-left text-body font-medium text-ink hover:bg-surface-2"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted">
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

  // ── Desktop: side-by-side nav + pane ──
  // A generous canvas — near-full-height, wide enough for the multi-column panes
  // (Schedule's form grid, the Calendars account columns) to breathe. Capped at
  // ~6xl because past that a two-column layout just goes sparse. Centered so a
  // tall sheet keeps even margins and never spills off the bottom.
  return (
    <Modal onClose={onClose} width="max-w-6xl" align="center">
      <div className="flex items-center justify-between border-b border-line px-6 py-3.5">
        <div className="text-head font-semibold">Settings</div>
        <button onClick={onClose} className="keycap">
          esc
        </button>
      </div>

      {/* Header (~52px) + this body must fit inside the modal's 92vh cap, so the
          body tops out a touch below full height — no bottom clip. */}
      <div className="flex h-[min(82vh,820px)]">
        {/* Section nav */}
        <nav className="w-[204px] shrink-0 space-y-1 overflow-y-auto border-r border-line bg-surface-2/40 p-3">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => select(s.id)}
              className={`fast flex w-full items-center gap-3 rounded-[var(--radius)] px-3 py-2.5 text-body font-medium ${
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
        <div key={active} className="floor-enter flex-1 overflow-y-auto px-8 py-7">
          {pane}
        </div>
      </div>
    </Modal>
  );
}
