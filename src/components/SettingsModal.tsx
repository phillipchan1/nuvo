import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { signOut } from "../lib/authActions";
import { supabase } from "../lib/supabase";
import { linkGoogleIdentity } from "../lib/googleAuth";
import { appleLinkAvailable, linkAppleIdentity } from "../lib/appleAuth";
import { readSignInMethods, type SignInMethod } from "../lib/authProviders";
import {
  canPromptInstall,
  isIOS,
  isStandaloneDisplay,
  onInstallAvailabilityChange,
  promptInstall,
} from "../lib/installPrompt";
import { formatHourLabel, fmtDuration } from "../lib/dates";
import { readRevealConfig, writeRevealConfig, type RevealConfig } from "../lib/weekReveal";
import { DURATION_PRESETS, type CalendarAccount, type UserSettings } from "../lib/types";
import {
  createDefaults,
  createTargetGroups,
  pickCreateTarget,
  providerLabel,
  providerMeta,
  type CreateTarget,
} from "../lib/calendarWrite";
import { firstDayOfWeek } from "../hooks/useSettings";
import { useLabels } from "../hooks/useCalendar";
import { useVertical } from "../hooks/useVertical";
import { Modal } from "./ui";
import Sheet from "./mobile/Sheet";
import { Field, PaneHeader, TextInput, TimeInput, Select, Toggle, Stepper, Segmented } from "./form";
import { Avatar, Button, Chip, IconButton, NuvoMark, SectionHeader } from "./kit";
import { AppsDevicesPane } from "./AppsDevicesPane";
import { InboxAddressPane } from "./InboxAddress";
import { BillingPane } from "./billing/BillingPane";
import { DeleteAccount } from "./account/DeleteAccount";
import { useSubscription } from "../hooks/useSubscription";
import SyncPanel from "./SyncPanel";
import type { SettingsSection } from "../lib/appNav";
import { useMaxPerWeek, useMaxPerQuarter } from "../hooks/usePlannerPrefs";
import { DIAL_NOTE, useDial } from "../lib/planDial";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { useOrientation } from "../hooks/useOrientation";
import { useIsMobile } from "../hooks/useIsMobile";
import { useUiScale, UI_SCALE_MIN, UI_SCALE_MAX } from "../hooks/useUiScale";
import { useHomeTimezone } from "../hooks/useHomeTimezone";
import { useNotifyPermission, usePushRegistration } from "../hooks/useReminders";
import { hasPushSubscription, pushConfigured, pushSupported } from "../lib/push";
import { DEFAULT_REMINDER_PREFS } from "../../supabase/functions/_shared/reminderRules.ts";
import { ReminderList } from "./ReminderSelect";
import { detectDeviceTz, supportedTimeZones, tzAbbrev, tzCity, tzStatus } from "../lib/timezone";
import { useUpdater } from "../hooks/useUpdater";
import { isDesktopTauri, offerMacDownload } from "../lib/platform";
import { openDevTools, useDeveloperMode } from "../lib/devtools";
import { clearErrorLog, formatErrorLog, useErrorLog } from "../lib/appError";
import { loadChangelog, isMinor, notableNotes, type ChangelogEntry } from "../lib/changelog";

// Settings — the two-pane dialog (D-190, the Dialog layout). A section list on
// a well, and each pane a column of 52px label-left / control-right rows on
// hairlines, built from form.tsx's kit parts. On a phone it is the bottom
// Sheet: the section list, then the pane, drilled into.

/** Stable-named universal DMG on the public releases repo. */
const DOWNLOAD_MAC_URL =
  "https://github.com/phillipchan1/nuvo-releases/releases/latest/download/Nuvo.dmg";

// ── Section registry ──────────────────────────────────────────────────────
type SectionId = "appearance" | "schedule" | "reminders" | "connections" | "inbound" | "apps" | "labels" | "account" | "billing" | "about";

const SECTIONS: { id: SectionId; label: string; icon: ReactNode }[] = [
  { id: "appearance", label: "Appearance", icon: <Icon name="sun" size={16} /> },
  { id: "schedule", label: "Schedule", icon: <Icon name="clock" size={16} /> },
  { id: "reminders", label: "Reminders", icon: <Icon name="bell" size={16} /> },
  { id: "connections", label: "Calendars", icon: <Icon name="calendar" size={16} /> },
  // Its own row rather than a block under Apps & devices: nobody looks for
  // a forwarding address under a heading about HTTP tokens. Same reason
  // Apps isn't under Calendars.
  { id: "inbound", label: "Inbox address", icon: <Icon name="mail" size={16} /> },
  // Its own row rather than a block under Calendars: nobody looks for a
  // watch's token under a heading about calendars.
  { id: "apps", label: "Apps & devices", icon: <Icon name="package" size={16} /> },
  { id: "labels", label: "Labels", icon: <Icon name="tag" size={16} /> },
  { id: "account", label: "Account", icon: <Icon name="user" size={16} /> },
  { id: "billing", label: "Billing", icon: <Icon name="card" size={16} /> },
  { id: "about", label: "About", icon: <Icon name="info" size={16} /> },
];

// `Row` is the settings field unit — Field from the form primitives (a 52px
// label-left / control-right row that wraps under on a narrow pane).
const Row = Field;

// ── Appearance ────────────────────────────────────────────────────────────
/** A theme, drawn by the theme itself: the tile sets `data-theme`, so the
 *  ground, panel and accent inside it are that theme's own tokens. */
function ThemeMini({ theme }: { theme: "light" | "dark" }) {
  return (
    <span className="set-theme-mini" data-theme={theme}>
      <i />
      <span />
    </span>
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
    <button type="button" onClick={onSelect} aria-pressed={active} disabled={disabled} className="set-theme">
      <span className="set-theme-tile">
        {theme === "system" ? (
          <>
            <ThemeMini theme="light" />
            <ThemeMini theme="dark" />
          </>
        ) : (
          <ThemeMini theme={theme} />
        )}
      </span>
      <span className="capitalize">{theme}</span>
    </button>
  );
}

function AppearancePane({
  settings,
  updateSettings,
}: {
  settings: UserSettings | undefined;
  updateSettings: (patch: Partial<UserSettings>) => void;
}) {
  const theme = settings?.theme ?? "system";
  const { scale, zoomIn, zoomOut, zoomReset } = useUiScale();

  return (
    <div>
      <PaneHeader title="Appearance" />
      <Row title="Theme">
        <div className="set-themes">
          {(["light", "dark", "system"] as const).map((t) => (
            <ThemeCard key={t} theme={t} active={theme === t} onSelect={() => updateSettings({ theme: t })} />
          ))}
        </div>
      </Row>
      <Row title="Zoom" desc="⌘+ · ⌘− · ⌘0">
        <span className="fm-stepper">
          <IconButton
            size="xs"
            label="Zoom out"
            icon={<span aria-hidden>−</span>}
            onClick={zoomOut}
            disabled={scale <= UI_SCALE_MIN}
          />
          <Button kind="ghost" size="xs" onClick={zoomReset} title="Reset zoom" className="tabular-nums">
            {Math.round(scale * 100)}%
          </Button>
          <IconButton
            size="xs"
            label="Zoom in"
            icon={<Icon name="plus" size={12} />}
            onClick={zoomIn}
            disabled={scale >= UI_SCALE_MAX}
          />
        </span>
      </Row>
    </div>
  );
}

// ── Time zone ──────────────────────────────────────────────────────────────
// Home is the stable zone travel is measured against; the device zone is set by
// the OS and only shown. Nuvo renders schedule times in wherever you are now, so
// this is really "what counts as home" plus a live readout of any current shift.
function TimeZoneRow() {
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
    <Row
      title="Time zone"
      desc={
        s.traveling ? (
          <>
            Now in <span className="text-ink">{tzCity(deviceTz)}</span> ({s.deviceAbbr}) · {s.deltaLabel} of home
          </>
        ) : (
          `Matches where you are now (${s.deviceAbbr}).`
        )
      }
    >
      {s.traveling && (
        <Button size="sm" onClick={() => setHomeTz(deviceTz)} title={`Make ${tzCity(deviceTz)} your home zone`}>
          Set as home
        </Button>
      )}
      <Select value={homeTz} onChange={(e) => setHomeTz(e.target.value)} className="w-full sm:w-[15rem]" aria-label="Home time zone">
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
    </Row>
  );
}

function SchedulePane({
  settings,
  updateSettings,
  onOpenUpkeep,
}: {
  settings: UserSettings | undefined;
  updateSettings: (patch: Partial<UserSettings>) => void;
  /** Supplied by the mobile shell, whose Calendar has no ⋯ to hold it. */
  onOpenUpkeep?: () => void;
}) {
  const [maxPerWeek, setMaxPerWeekPref] = useMaxPerWeek();
  const [maxPerQuarter, setMaxPerQuarterPref] = useMaxPerQuarter();
  // How much Nuvo moves when the week breaks (docs/plan-the-week-v2.md §7).
  // Its one home (D-204): not in the walk, not in the repair rail. Q-14 is
  // open, so this only moves the control — what each setting does is unchanged.
  const [dial, setDial] = useDial();

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
      <PaneHeader title="Schedule" />
      <TimeZoneRow />

      <Row title="Day view">
        <Select
          value={settings?.day_start_hour ?? 6}
          onChange={(e) => updateSettings({ day_start_hour: Number(e.target.value) })}
          className="w-28"
          aria-label="Day view starts"
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
          className="w-28"
          aria-label="Day view ends"
        >
          {Array.from({ length: 12 }, (_, i) => i + 13).map((h) => (
            <option key={h} value={h}>
              {formatHourLabel(h)}
            </option>
          ))}
        </Select>
      </Row>

      <Row title="Working hours" desc="Where Nuvo proposes focus blocks.">
        <TimeInput
          step={900}
          minutes={settings?.work_start_minutes ?? 480}
          onCommit={(m) => updateSettings({ work_start_minutes: m })}
          className="!w-32"
          aria-label="Working hours start"
        />
        <span className="text-caption text-muted">to</span>
        <TimeInput
          step={900}
          minutes={settings?.work_end_minutes ?? 990}
          onCommit={(m) => updateSettings({ work_end_minutes: m })}
          className="!w-32"
          aria-label="Working hours end"
        />
      </Row>

      <Row title="Default task length" desc="For a new task or series that names none.">
        <Select
          value={settings?.default_task_duration_minutes ?? 30}
          onChange={(e) => updateSettings({ default_task_duration_minutes: Number(e.target.value) })}
          className="w-28"
          aria-label="Default task length"
        >
          {DURATION_PRESETS.map((m) => (
            <option key={m} value={m}>
              {fmtDuration(m)}
            </option>
          ))}
        </Select>
      </Row>

      <Row title="Hours on screen" desc="Fewer hours, taller rows.">
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

      <Row title="Week starts on">
        <Segmented
          value={String(firstDayOfWeek(settings))}
          onChange={(v) => updateSettings({ week_start: Number(v) })}
          label="Week starts on"
          options={[
            { value: "0", label: "Sunday" },
            { value: "1", label: "Monday" },
          ]}
        />
      </Row>

      <Row title="Projects per week" desc="Past this, On Deck flags the week.">
        <Stepper value={maxPerWeek} min={1} max={6} onChange={setMaxPerWeekPref} decHint="Fewer per week" incHint="More per week" />
      </Row>

      <Row title="Initiatives per quarter" desc="Past this, On Deck flags the quarter.">
        <Stepper value={maxPerQuarter} min={1} max={6} onChange={setMaxPerQuarterPref} decHint="Fewer per quarter" incHint="More per quarter" />
      </Row>

      <Row title="Weekly Review" desc="When the week's Review lights up as ready.">
        <Select
          value={reveal.dow}
          onChange={(e) => patchReveal({ dow: Number(e.target.value) })}
          disabled={!reveal.enabled}
          className="w-32"
          aria-label="Review day"
        >
          {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => (
            <option key={i} value={i}>
              {d}
            </option>
          ))}
        </Select>
        <TimeInput
          step={900}
          minutes={reveal.minutes}
          onCommit={(m) => patchReveal({ minutes: m })}
          disabled={!reveal.enabled}
          className="!w-32"
          aria-label="Review time"
        />
        <Toggle checked={reveal.enabled} onChange={(v) => patchReveal({ enabled: v })} label="Weekly Review reveal" />
      </Row>

      <Row title="When the week breaks" desc={DIAL_NOTE[dial]}>
        <Segmented
          value={dial}
          onChange={setDial}
          label="How much Nuvo moves"
          options={(["ask", "suggest", "handle"] as const).map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))}
        />
      </Row>

      <Row title="Weather" desc="Beside each day. Needs your location.">
        <Toggle
          checked={settings?.show_weather ?? false}
          onChange={(v) => updateSettings({ show_weather: v })}
          label="Weather"
        />
      </Row>

      {/* The way back from Hide (D-176). A hidden event is filtered off every
          calendar Nuvo draws, so on the phone — which has no "Show N hidden"
          in a ⋯ — hiding one was a door that only opened inward. Listed here
          on both shells: the desktop's toggle reveals them in place, this
          names them. */}
      {(settings?.hidden_events?.length ?? 0) > 0 && (
        <Row layout="stack" title="Hidden events" desc="Hidden from Nuvo, not from your calendar.">
          <div className="set-list">
            {(settings?.hidden_events ?? []).map((h) => (
              <div key={h.key} className="set-list-row">
                <span className="set-list-main">
                  <span className="set-list-title">{h.title || "Untitled event"}</span>
                  {h.key.includes(":series:") && <span className="set-list-meta">Every event in the series</span>}
                </span>
                <Button
                  size="sm"
                  className="tap"
                  onClick={() =>
                    updateSettings({ hidden_events: (settings?.hidden_events ?? []).filter((x) => x.key !== h.key) })
                  }
                >
                  Show
                </Button>
              </div>
            ))}
          </div>
        </Row>
      )}

      {/* The phone's door to recurring upkeep. On the desktop this lives in
          the calendar's ⋯ overflow; on the phone it had been promoted to a
          permanent icon in the Calendar's busiest row, which is a lot of
          standing rent for something you edit a few times a year. Here it
          costs nothing and is still a real path — not a hidden gesture. */}
      {onOpenUpkeep && (
        <Row title="Recurring upkeep" desc="The chores that repeat.">
          <Button size="sm" className="tap" onClick={onOpenUpkeep}>
            Open
          </Button>
        </Row>
      )}
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
  const connect = async (provider: "google") => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const base = import.meta.env.VITE_SUPABASE_URL;
    const redirect = encodeURIComponent(window.location.origin);
    window.location.href = `${base}/functions/v1/${provider}-oauth?action=start&token=${token}&redirect=${redirect}`;
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

  // ── Default calendar for new events (D-152) ──
  // One control for the default — it used to be a "Set as default" button per
  // Google account, which could only ever mean that account's own calendar.
  // Offered: every calendar a new event may go on (writable, on the board).
  //
  // `default_calendar_id` arrives with migration 87. Until the row carries the
  // key, writing it would park the whole settings op, so the choice stays at
  // account grain — one option per account, its own calendar — and widens to
  // every calendar the moment the column exists.
  const calendarDefaultReady = Boolean(settings && "default_calendar_id" in settings);
  const defaultTarget = pickCreateTarget(accounts, createDefaults(settings));
  const defaultChoices = createTargetGroups(accounts, settings?.hidden_calendar_ids)
    .map((g) =>
      calendarDefaultReady
        ? g
        : {
            ...g,
            calendars: g.calendars.filter(
              (c) =>
                c.id ===
                pickCreateTarget(accounts, { hiddenIds: settings?.hidden_calendar_ids, accountId: g.accountId })
                  ?.calendarId,
            ),
          },
    )
    .filter((g) => g.calendars.length > 0);
  const defaultFlat: CreateTarget[] = defaultChoices.flatMap((g) =>
    g.calendars.map((c) => ({ accountId: g.accountId, calendarId: c.id })),
  );
  const isDefaultCal = (accountId: string, calendarId: string) =>
    defaultTarget?.accountId === accountId && defaultTarget?.calendarId === calendarId;
  const defaultIndex = defaultFlat.findIndex((t) => isDefaultCal(t.accountId, t.calendarId));
  const setDefaultCalendar = (t: CreateTarget | undefined) => {
    if (!t) return;
    updateSettings({
      default_calendar_account_id: t.accountId,
      ...(calendarDefaultReady ? { default_calendar_id: t.calendarId } : {}),
    });
  };

  // One calendar's row — colour + name, its domain attribution, and the on/off
  // switch. Hidden calendars render the same row, dimmed and without the
  // domain picker (nothing to attribute while it's off the board).
  const calRow = (a: CalendarAccount, c: NonNullable<CalendarAccount["calendars"]>[number], on: boolean) => (
    <div key={c.id} className="set-list-row" data-off={on ? undefined : ""}>
      <span
        className="set-cal-dot"
        data-off={on ? undefined : ""}
        style={on ? { ["--c" as string]: c.color ?? "var(--muted)" } : undefined}
        aria-hidden
      />
      <button type="button" onClick={() => toggleCalendar(c.id)} className="tap-h set-list-main flex min-w-0 items-center gap-2 text-left">
        <span className="set-list-title">{c.summary}</span>
        {on && isDefaultCal(a.id, c.id) && (
          <Chip tone="accent" title="New events go here unless you pick another calendar">
            Default
          </Chip>
        )}
      </button>
      {on && (
        <Select
          value={calMap[calKey(a.id, c.id)] ?? ""}
          onChange={(e) => setCalDomain(calKey(a.id, c.id), e.target.value)}
          title="Attribute this calendar's meetings to a domain"
          aria-label={`Domain for ${c.summary}`}
          className="w-36 shrink-0"
        >
          <option value="">Auto domain</option>
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
        <PaneHeader title="Calendars" />
      </div>

      {defaultFlat.length > 1 && (
        <Row title="New events go to" desc="Every composer, Task → Event and Nuvo start here.">
          <Select
            value={defaultIndex >= 0 ? String(defaultIndex) : ""}
            onChange={(e) => setDefaultCalendar(defaultFlat[Number(e.target.value)])}
            aria-label="Default calendar for new events"
            className="w-full sm:w-64"
          >
            {defaultIndex < 0 && <option value="">Choose a calendar…</option>}
            {(() => {
              let i = 0;
              return defaultChoices.map((g) => (
                <optgroup key={g.accountId} label={`${g.accountLabel} · ${providerLabel(g.provider)}`}>
                  {g.calendars.map((c) => {
                    const idx = i++;
                    return (
                      <option key={c.id} value={String(idx)}>
                        {c.summary}
                      </option>
                    );
                  })}
                </optgroup>
              ));
            })()}
          </Select>
        </Row>
      )}

      {/* Google's own "add video conferencing automatically" preference only
          applies to events created in *their* web UI — it never reaches an
          event booked through the API, so this is the only thing deciding
          whether a meeting Nuvo makes has a way to meet digitally. */}
      {accounts.some((a) => a.provider === "google" && a.sync_direction === "two_way") && (
        <Row title="Add Google Meet" desc="Google only adds one in its own app. The composer can override.">
          <Segmented
            value={settings?.auto_add_meet ?? "guests"}
            onChange={(v) => updateSettings({ auto_add_meet: v as UserSettings["auto_add_meet"] })}
            label="Add Google Meet to new events"
            options={[
              { value: "guests", label: "With guests" },
              { value: "always", label: "Always" },
              { value: "never", label: "Never" },
            ]}
          />
        </Row>
      )}

      {accounts.map((a) => {
        const cals = a.calendars ?? [];
        const shown = cals.filter((c) => !hidden.has(c.id));
        const hiddenCals = cals.filter((c) => hidden.has(c.id));
        const drawerOpen = showHiddenCals.has(a.id);
        const meta = providerMeta(a.provider);
        return (
          <section key={a.id} className="set-acct">
            <div className="set-acct-head">
              <span className="set-acct-mark" aria-hidden>
                {meta.letter}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium text-ink">{meta.name}</span>
                <span className="block truncate text-caption text-muted">{a.email}</span>
              </span>
              <Chip tone={a.sync_direction === "two_way" ? "accent" : "neutral"}>
                {a.sync_direction === "two_way" ? "Two-way" : "Read-only"}
              </Chip>
              {/* Microsoft 365 is no longer offered: a leftover account can only be disconnected. */}
              {a.needs_reconnect && a.provider === "google" && (
                <Button size="sm" kind="danger" className="tap" onClick={() => connect("google")}>
                  Reconnect
                </Button>
              )}
              {a.needs_reconnect && a.provider === "ics" && (
                <Button
                  size="sm"
                  kind="danger"
                  className="tap"
                  onClick={() => {
                    setIcsLabel(a.email);
                    setShowIcs(true);
                  }}
                >
                  Update link
                </Button>
              )}
              {a.needs_reconnect && a.provider === "icloud" && (
                <Button
                  size="sm"
                  kind="danger"
                  className="tap"
                  onClick={() => {
                    setAppleId(a.email);
                    setShowIcloud(true);
                  }}
                >
                  Reconnect
                </Button>
              )}
              <Button size="sm" className="tap" onClick={() => disconnect(a.id)}>
                Disconnect
              </Button>
            </div>

            {/* The mirror, named. It is deliberately absent from the list
                below — Nuvo writes it, so syncing it back would count every
                block twice — which means this line is the only place in the
                app that says it exists. And mirroring is one-directional by
                decision (D-107 · Q-13): the app's version wins. That is
                allowed to be true and is not allowed to be a surprise, so
                it is stated here as well as on every block Nuvo writes. */}
            {a.mirror_calendar_id && a.sync_direction === "two_way" && (
              <p className="set-note mb-2">
                <b>Nuvo</b> keeps a calendar of your time blocks here, so they show wherever you read this
                account. <b>Move a block in {meta.name} and Nuvo puts it back</b> — change it in Nuvo.
              </p>
            )}

            <div className="set-list">
              {shown.map((c) => calRow(a, c, true))}
              {shown.length === 0 && (
                <div className="set-list-row">
                  <span className="set-note">{hiddenCals.length > 0 ? "All hidden" : "No calendars yet"}</span>
                </div>
              )}
            </div>

            {hiddenCals.length > 0 && (
              <>
                <SectionHeader
                  title={`${hiddenCals.length} hidden`}
                  collapsed={!drawerOpen}
                  onToggle={() => toggleHiddenDrawer(a.id)}
                  className="set-group !pt-2"
                />
                {drawerOpen && <div className="set-list">{hiddenCals.map((c) => calRow(a, c, false))}</div>}
              </>
            )}
          </section>
        );
      })}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button kind="primary" size="md" className="tap" onClick={() => connect("google")}>
          {accounts.some((a) => a.provider === "google") ? "Add Google account" : "Connect Google"}
        </Button>
        {!accounts.some((a) => a.provider === "icloud") && !showIcloud && (
          <Button size="md" className="tap" onClick={() => setShowIcloud(true)}>
            Connect Apple Calendar
          </Button>
        )}
        {!showIcs && (
          <Button size="md" className="tap" onClick={() => setShowIcs(true)}>
            Subscribe to a link
          </Button>
        )}
      </div>

      {showIcloud && (
        <div className="set-well">
          <div className="set-well-title">Apple Calendar</div>
          <p className="set-note">
            Apple uses an <b>app-specific password</b> for calendars. It is stored encrypted; revoke it any
            time from your Apple account.
          </p>
          <ol className="set-steps">
            <li>
              Sign in at{" "}
              <a href="https://account.apple.com/account/manage" target="_blank" rel="noreferrer">
                account.apple.com
              </a>
              .
            </li>
            <li>Sign-In and Security → App-Specific Passwords.</li>
            <li>Generate one named “Nuvo” and paste it below.</li>
          </ol>
          <TextInput
            value={appleId}
            onChange={(e) => setAppleId(e.target.value)}
            placeholder="Apple ID email"
            aria-label="Apple ID email"
            autoComplete="username"
            autoFocus
          />
          <TextInput
            value={applePw}
            onChange={(e) => setApplePw(e.target.value)}
            placeholder="abcd-efgh-ijkl-mnop"
            aria-label="App-specific password"
            type="password"
            autoComplete="off"
            onKeyDown={(e) => e.key === "Enter" && connectIcloud()}
          />
          {icloudError && <div className="text-caption text-danger">{icloudError}</div>}
          <div className="flex gap-2">
            <Button kind="primary" className="tap" disabled={icloudBusy || !appleId.trim() || !applePw.trim()} onClick={connectIcloud}>
              {icloudBusy ? "Connecting…" : "Connect"}
            </Button>
            <Button
              kind="ghost"
              className="tap"
              disabled={icloudBusy}
              onClick={() => {
                setShowIcloud(false);
                setIcloudError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {showIcs && (
        <div className="set-well">
          <div className="set-well-title">A calendar link</div>
          <p className="set-note">
            A published <b>.ics</b> link. Read-only, refreshed every 15 minutes. The link is a password to
            that calendar; it is stored encrypted.
          </p>
          <TextInput
            value={icsUrl}
            onChange={(e) => setIcsUrl(e.target.value)}
            placeholder="https://…/calendar.ics"
            aria-label="Calendar link"
            autoFocus
          />
          <TextInput
            value={icsLabel}
            onChange={(e) => setIcsLabel(e.target.value)}
            placeholder="Label (optional)"
            aria-label="Label"
            onKeyDown={(e) => e.key === "Enter" && subscribeIcs()}
          />
          {icsError && <div className="text-caption text-danger">{icsError}</div>}
          <div className="flex gap-2">
            <Button kind="primary" className="tap" disabled={icsBusy || !icsUrl.trim()} onClick={subscribeIcs}>
              {icsBusy ? "Subscribing…" : "Subscribe"}
            </Button>
            <Button
              kind="ghost"
              className="tap"
              disabled={icsBusy}
              onClick={() => {
                setShowIcs(false);
                setIcsError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Desktop-only: manually check for an update and, when one is staged, restart
// into it. Shares state with the bottom-right toast via the update store, so the
// two never disagree.
function UpdateControls() {
  const { state, check, restart } = useUpdater();
  const busy = state.status === "checking" || state.status === "downloading";
  const readyNotes = state.status === "ready" ? notableNotes(state.notes) : null;

  const message = {
    idle: "Checked in the background.",
    checking: "Checking…",
    "up-to-date": "You're on the latest version.",
    downloading: `Downloading v${state.version ?? ""}… ${state.progress}%`,
    ready: `Version ${state.version ?? ""} is ready.`,
    // A failed check is harmless — the current build keeps working — so keep it
    // gentle and never surface the raw request error / URL to the user.
    error: "Couldn't check right now. Try again later.",
  }[state.status];

  return (
    <>
      <Row title="Updates" desc={<span data-status={state.status}>{message}</span>}>
        {state.status === "ready" ? (
          <Button kind="primary" onClick={restart}>
            Restart to update
          </Button>
        ) : (
          <Button onClick={check} disabled={busy}>
            {busy ? "Checking…" : "Check for updates"}
          </Button>
        )}
      </Row>
      {readyNotes && (
        <details className="set-note border-b border-[var(--line-1)] py-2">
          <summary className="tap-h select-none">What's new in v{state.version}</summary>
          <p className="mt-1 whitespace-pre-line">{readyNotes}</p>
        </details>
      )}
    </>
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
    <div>
      <SectionHeader title="What's new" className="set-group" />
      <ul className="set-list">
        {rows.map((row, i) =>
          row.kind === "release" ? (
            <li key={row.entry.version} className="border-b border-[var(--line-1)] py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-body font-medium text-ink">
                  v{row.entry.version}
                  {row.entry.version === __APP_VERSION__ && <span className="ml-1.5 text-caption font-normal text-accent">Current</span>}
                </span>
                <span className="text-caption tabular-nums text-muted">{formatReleaseDate(row.entry.date)}</span>
              </div>
              <p className="set-note mt-0.5 whitespace-pre-line">{notableNotes(row.entry.notes)}</p>
            </li>
          ) : (
            <li key={`minor-${i}`} className="set-note border-b border-[var(--line-1)] py-2.5">
              {row.count} smaller update{row.count > 1 ? "s" : ""}
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

/**
 * Reminders — the opt-in, and the leads that are allowed to exist.
 *
 * The copy here is load-bearing. N-07 refused notifications and Principle 9
 * refuses notification theater; what shipped is the narrow thing N-07's own
 * escape clause allows, and this pane has to be honest about that rather than
 * selling a feature. Hence: off by default, named commitments only, and a line
 * saying plainly what Nuvo will never do with the permission.
 */
function RemindersPane({
  settings,
  updateSettings,
}: {
  settings: UserSettings | undefined;
  updateSettings: (patch: Partial<UserSettings>) => void;
}) {
  const prefs = settings?.reminder_prefs ?? DEFAULT_REMINDER_PREFS;
  const { permission, request } = useNotifyPermission();
  // Subscribing this device to background delivery follows the toggle; the row
  // it writes is what the dispatcher pushes to.
  usePushRegistration(prefs.enabled, permission);
  const [pushState, setPushState] = useState<"unknown" | "on" | "off">("unknown");
  useEffect(() => {
    let cancelled = false;
    void hasPushSubscription().then((on) => {
      if (!cancelled) setPushState(on ? "on" : "off");
    });
    return () => {
      cancelled = true;
    };
  }, [prefs.enabled, permission]);

  const patch = (p: Partial<typeof prefs>) => updateSettings({ reminder_prefs: { ...prefs, ...p } });

  const setEnabled = async (on: boolean) => {
    patch({ enabled: on });
    // Ask the OS at the moment of consent, never on a cold open.
    if (on && permission === "default") await request();
  };

  const leadList = (
    key: "event_leads" | "block_leads" | "deadline_leads" | "all_day_leads",
  ) => (
    <ReminderList
      leads={prefs[key]}
      defaultLeads={[]}
      source="override"
      enabled={prefs.enabled}
      block
      prefsMode
      onChange={(next) => patch({ [key]: next === "default" ? [] : next } as Partial<typeof prefs>)}
    />
  );

  return (
    <div>
      <PaneHeader title="Reminders" />
      <Row
        title="Remind me"
        desc="Off until you ask. Only about a commitment coming up — never planning, streaks or a backlog."
      >
        <Toggle checked={prefs.enabled} onChange={(v) => void setEnabled(v)} label="Reminders" />
      </Row>

      {prefs.enabled && permission === "denied" && (
        <Row
          title="Notifications are blocked"
          desc="Reminders still show while Nuvo is open. Allow notifications in your system settings to hear them when it isn't."
        >
          {null}
        </Row>
      )}
      {prefs.enabled && permission === "default" && (
        <Row title="Allow notifications" desc="Without it, reminders only show while Nuvo is open.">
          <Button className="tap" onClick={() => void request()}>
            Allow
          </Button>
        </Row>
      )}

      {/* Where reminders can reach you. Deliberately states the limit rather
          than implying background delivery works everywhere: on iOS it needs
          the app installed to the home screen, and the desktop app has no
          service worker by design. */}
      {prefs.enabled && permission === "granted" && (
        <Row
          title="When Nuvo is closed"
          desc={
            !pushConfigured()
              ? "Not set up on this deployment — reminders show only while Nuvo is open."
              : !pushSupported()
                ? isDesktopTauri()
                  ? "The desktop app reminds you while it runs. Install Nuvo on your phone to hear the rest."
                  : "This browser can't. On iPhone, add Nuvo to your Home Screen first."
                : pushState === "on"
                  ? "This device hears them even when Nuvo is closed."
                  : "Setting this device up…"
          }
        >
          <span className="text-caption text-muted">
            {pushState === "on" && pushConfigured() && pushSupported() ? "On" : "Foreground only"}
          </span>
        </Row>
      )}

      <Row layout="stack" title="Before a meeting">
        {leadList("event_leads")}
      </Row>

      <Row layout="stack" title="All-day events" desc="Speaks at the time of day below.">
        {leadList("all_day_leads")}
      </Row>

      <Row layout="stack" title="Before a block you scheduled">
        {leadList("block_leads")}
      </Row>

      <Row layout="stack" title="When a deadline lands" desc="Measured from the time of day below.">
        {leadList("deadline_leads")}
      </Row>

      <Row title="On the day, at" desc="For deadlines, all-day events and untimed tasks.">
        <TimeInput
          step={900}
          disabled={!prefs.enabled}
          minutes={prefs.deadline_time_minutes}
          onCommit={(m) => patch({ deadline_time_minutes: m })}
          className="!w-32"
          aria-label="On the day, at"
        />
      </Row>
    </div>
  );
}

function LabelsPane() {
  const { labels, createLabel, updateLabel, deleteLabel } = useLabels();
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#2563EB");

  return (
    <div>
      <PaneHeader title="Labels" />
      <div className="set-list">
        {labels.map((l) => (
          <div key={l.id} className="set-list-row">
            <input
              type="color"
              value={l.color}
              onChange={(e) => updateLabel({ id: l.id, color: e.target.value })}
              aria-label={`Colour of ${l.name}`}
              className="set-swatch"
            />
            <TextInput
              defaultValue={l.name}
              aria-label="Label name"
              className="flex-1"
              onBlur={(e) =>
                e.target.value.trim() &&
                e.target.value !== l.name &&
                updateLabel({ id: l.id, name: e.target.value.trim() })
              }
            />
            <IconButton
              label="Delete label"
              kind="danger"
              icon={<Icon name="trash" size={14} />}
              className="tap"
              onClick={() => deleteLabel(l.id)}
            />
          </div>
        ))}
        {labels.length === 0 && (
          <div className="set-list-row">
            <span className="set-note">No labels</span>
          </div>
        )}
      </div>

      <form
        className="mt-4 flex items-center gap-2"
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
          aria-label="New label colour"
          className="set-swatch"
        />
        <TextInput value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="New label" aria-label="New label" className="flex-1" />
        <Button type="submit" kind="primary" size="md" className="tap">
          Add
        </Button>
      </form>
    </div>
  );
}

function AccountPane() {
  const { subscription } = useSubscription();
  const [email, setEmail] = useState("");
  const [methods, setMethods] = useState<SignInMethod[]>([]);
  // Which provider is mid-redirect, if any — not a bare boolean, so two rows
  // can coexist without both showing "Redirecting…".
  const [linking, setLinking] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const refresh = () => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? "");
      // `app_metadata.provider` is the provider of the MOST RECENT sign-in —
      // the honest answer to "which one did I use?". `identities` is everything
      // attached to this one auth UUID.
      setMethods(
        readSignInMethods(data.user?.identities, data.user?.app_metadata?.provider, {
          apple: appleLinkAvailable(),
        }),
      );
    });
  };

  useEffect(() => {
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange(() => refresh());
    return () => sub.subscription.unsubscribe();
  }, []);

  // Linking — rather than a second sign-in — is what keeps the same auth UUID.
  // Supabase folds two identities onto one account only when they share a
  // VERIFIED email; Apple's "Hide My Email" asserts a relay address that
  // matches nothing, so signing in with an unlinked provider can quietly open a
  // second, empty account instead. Nothing can pair them up afterwards, which
  // is why this pane shows every method and its state, not just the gaps.
  const linkFor: Record<string, () => Promise<{ error: unknown }>> = {
    google: linkGoogleIdentity,
    apple: linkAppleIdentity,
  };

  const linkWith = async (provider: string, start: () => Promise<{ error: unknown }>) => {
    setLinking(provider);
    setLinkError(null);
    const { error } = await start();
    if (error) {
      setLinkError(error instanceof Error ? error.message : String(error));
      setLinking(null);
    }
    // On success the browser redirects to the provider.
  };

  return (
    <div>
      <PaneHeader title="Account" />
      <div className="set-row">
        <Avatar name={email || "?"} size="lg" />
        <span className="min-w-0 flex-1 truncate text-body text-ink">{email || "…"}</span>
        <Button kind="danger" className="tap" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>

      {methods.length > 0 && (
        <>
          <SectionHeader title="Sign-in methods" className="set-group" />
          <div className="set-list">
            {methods.map((m) => (
              <div key={m.provider} className="set-row">
                <div className="set-row-label">
                  <span className="set-row-title inline-flex items-center gap-2">
                    {m.label}
                    {m.current && <Chip tone="accent">Signed in with this</Chip>}
                  </span>
                  <div className="set-row-desc">
                    {m.linked
                      ? m.relay
                        ? `Linked. Apple is hiding your address behind ${m.email} — mail from Nuvo still reaches you.`
                        : m.email
                          ? `Linked as ${m.email}.`
                          : "Linked to this account."
                      : `Link it to reach this account — unlinked, it starts a separate, empty one.`}
                  </div>
                </div>
                <div className="set-row-ctl">
                  {m.linked || !linkFor[m.provider] ? (
                    <span className="text-caption text-muted">{m.linked ? "Linked" : "—"}</span>
                  ) : (
                    <Button
                      kind="primary"
                      className="tap"
                      disabled={linking !== null}
                      onClick={() => void linkWith(m.provider, linkFor[m.provider])}
                    >
                      {linking === m.provider ? "Redirecting…" : `Link ${m.label}`}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {linkError && <div className="mt-2 text-caption text-danger">{linkError}</div>}
        </>
      )}

      <DeleteAccount planSource={subscription?.plan_source ?? null} />
    </div>
  );
}

// ── About ─────────────────────────────────────────────────────────────────
// "Install Nuvo" — discoverable install from inside the app. Android/desktop
// Chrome gets the captured beforeinstallprompt; iOS Safari (no such event) gets
// the Share → Add to Home Screen instructions. Hidden once already installed.
function InstallRow() {
  const [, forceRender] = useState(0);
  useEffect(() => onInstallAvailabilityChange(() => forceRender((n) => n + 1)), []);
  if (isStandaloneDisplay()) return null;

  if (canPromptInstall()) {
    return (
      <Row title="Install Nuvo" desc="Full screen, its own icon, works offline.">
        <Button kind="primary" className="tap" onClick={() => void promptInstall()}>
          Install
        </Button>
      </Row>
    );
  }
  if (isIOS()) {
    return (
      <Row
        title="Install on this iPhone"
        desc={
          <>
            In Safari: <span className="text-ink">Share</span> → <span className="text-ink">Add to Home Screen</span>.
          </>
        }
      >
        {null}
      </Row>
    );
  }
  return null;
}

function DeveloperControls() {
  const [on, setOn] = useDeveloperMode();
  const notes = useErrorLog();
  const desktop = isDesktopTauri();
  const [copied, setCopied] = useState(false);

  const copyLog = async () => {
    try {
      await navigator.clipboard.writeText(formatErrorLog(notes));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <>
      <Row
        title="Developer mode"
        desc={desktop ? "The web inspector and a recent-error log." : "A recent-error log on this device, so a failure can be copied."}
      >
        <Toggle checked={on} onChange={setOn} label="Developer mode" />
      </Row>
      {on && desktop && (
        <Row title="Web inspector" desc="⌘⌥I">
          <Button className="tap" onClick={() => void openDevTools()}>
            Open DevTools
          </Button>
        </Row>
      )}
      {on && (
        <Row layout="stack" title="Recent errors" desc="Kept on this device. Nothing is sent.">
          <div className="flex gap-2">
            <Button size="sm" className="tap" disabled={!notes.length} onClick={() => void copyLog()}>
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button size="sm" kind="ghost" className="tap" disabled={!notes.length} onClick={() => clearErrorLog()}>
              Clear
            </Button>
          </div>
          {notes.length === 0 ? (
            <p className="set-note mt-2">Nothing recorded</p>
          ) : (
            <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto" data-selectable>
              {notes.slice(0, 8).map((n) => (
                <li key={n.at}>
                  <div className="text-caption tabular-nums text-muted">
                    {new Date(n.at).toLocaleString()}
                    {n.source ? ` · ${n.source}` : ""}
                  </div>
                  <div className="text-body text-ink">{n.message}</div>
                  {n.detail && <div className="text-caption text-muted">{n.detail}</div>}
                </li>
              ))}
            </ul>
          )}
        </Row>
      )}
    </>
  );
}

function AboutPane({ onClose }: { onClose: () => void }) {
  const { open: openOrientation } = useOrientation();
  const desktop = isDesktopTauri();
  const mobile = useIsMobile();
  const showMacDownload = offerMacDownload({ desktopTauri: desktop, mobile });
  return (
    <div>
      <PaneHeader title="About" />
      <div className="set-row">
        <NuvoMark size={20} />
        <span className="flex-1 text-body font-semibold text-ink">Nuvo</span>
        <span className="text-caption tabular-nums text-muted">v{__APP_VERSION__}</span>
      </div>

      {/* Auto-update controls in the native Mac app; a download link on a
          desktop browser. Hidden on the phone — a DMG is not a phone act
          (D-124). The marketing site already offers it. */}
      {desktop ? (
        <UpdateControls />
      ) : showMacDownload ? (
        <Row title="Download for Mac" desc="Apple Silicon and Intel. Updates itself.">
          <a href={DOWNLOAD_MAC_URL} className="k-btn" data-kind="primary">
            Download
          </a>
        </Row>
      ) : null}

      <DeveloperControls />

      {!desktop && <InstallRow />}

      <Row title="Welcome tour" desc="Calendars, domains, projects, capture, and Nuvo.">
        <Button
          className="tap"
          onClick={() => {
            onClose();
            openOrientation();
          }}
        >
          Replay
        </Button>
      </Row>

      {/* The sync queue's home. It reports nothing in the app itself — a queue
          that is draining normally is not news, and the strip that used to say
          so shifted the whole layout on every write (D-095). Sits above the
          changelog because a refused write is the one thing here someone is
          sent to act on; it shouldn't be below a screen of release notes. */}
      <SyncPanel />

      <ReleaseHistory />
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
  onOpenUpkeep,
}: {
  settings: UserSettings | undefined;
  updateSettings: (patch: Partial<UserSettings>) => void;
  accounts: CalendarAccount[];
  section: SettingsSection;
  onClose: () => void;
  /** Mobile only — the phone's Calendar has no ⋯ overflow to hold this, so
   *  Schedule carries the door instead of the Calendar's busiest row. */
  onOpenUpkeep?: () => void;
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
      {active === "schedule" && (
        <SchedulePane
          settings={settings}
          updateSettings={updateSettings}
          onOpenUpkeep={onOpenUpkeep}
        />
      )}
      {active === "reminders" && <RemindersPane settings={settings} updateSettings={updateSettings} />}
      {active === "connections" && (
        <ConnectionsPane settings={settings} updateSettings={updateSettings} accounts={accounts} />
      )}
      {active === "inbound" && <InboxAddressPane />}
      {/* Calendars are what Nuvo reads; these tokens are what writes into it.
          Named apart so "connection" never means two things (P11). */}
      {active === "apps" && <AppsDevicesPane />}
      {active === "labels" && <LabelsPane />}
      {active === "account" && <AccountPane />}
      {active === "billing" && <BillingPane />}
      {active === "about" && <AboutPane onClose={onClose} />}
    </>
  );

  // ── Mobile: a bottom Sheet (the house overlay — CLAUDE.md's golden rule),
  //    iOS-style list → drill into pane, swipe-down dismissible. ──
  if (isMobile) {
    const titleNode = drilled ? (
      <div className="flex min-w-0 items-center gap-1">
        <IconButton
          label="Back to settings sections"
          icon={<Icon name="chevron-left" size={18} />}
          onClick={() => setDrilled(false)}
          onPointerDown={(e) => e.stopPropagation()}
          className="tap -ml-2"
        />
        <span className="min-w-0 flex-1 truncate">
          {SECTIONS.find((s) => s.id === active)?.label ?? "Settings"}
        </span>
      </div>
    ) : (
      "Settings"
    );
    return (
      <Sheet tall title={titleNode} onClose={onClose} contentClassName="mobile-scroll overflow-y-auto">
        {drilled ? (
          <div key={active} className="set-main floor-enter">
            {pane}
          </div>
        ) : (
          <nav className="set-index" aria-label="Settings sections">
            {SECTIONS.map((s) => (
              <button key={s.id} type="button" onClick={() => select(s.id)} className="set-index-item">
                {s.icon}
                <span>{s.label}</span>
                <Icon name="chevron-right" size={16} />
              </button>
            ))}
          </nav>
        )}
      </Sheet>
    );
  }

  // ── Desktop: the two-pane dialog ──
  // Centered and bounded, so a tall pane keeps even margins and the section
  // list never moves; each pane owns its own scroll.
  return (
    <Modal onClose={onClose} width="max-w-[880px]" align="center">
      <div className="set">
        <nav className="set-nav" aria-label="Settings sections">
          <div className="set-nav-h">Settings</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => select(s.id)}
              aria-current={active === s.id ? "page" : undefined}
              className="set-item"
            >
              {s.icon}
              <span className="set-item-label">{s.label}</span>
            </button>
          ))}
        </nav>

        <div key={active} className="set-main floor-enter">
          {pane}
        </div>

        <span className="set-close">
          <IconButton label="Close settings" shortcut="Esc" icon={<Icon name="close" size={14} />} onClick={onClose} />
        </span>
      </div>
    </Modal>
  );
}
