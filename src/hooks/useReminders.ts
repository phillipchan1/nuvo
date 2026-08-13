/**
 * Reminders — the read, the write, and the one timer that speaks.
 *
 * Read the header of `_shared/reminderRules.ts` first: it explains why this
 * exists at all against N-07 and Principle 9, and what it is forbidden to say.
 *
 * Shape of the delivery loop, because "butter smooth" is a constraint here:
 *
 *   • No polling. One `setTimeout`, armed for the single next fire instant.
 *   • No new fetch for the common case. Anchors are built from `["tasks","all"]`
 *     (already the vertical store's cache) plus a *day-quantized* 3-day window
 *     of events and slots — quantized so the query key is stable and the clock
 *     ticking cannot invalidate it.
 *   • Nothing on the render path. The plan is a `useMemo` over data that only
 *     changes when the day actually changes.
 *   • A woken laptop stays quiet: `dueNow` drops anything past its grace
 *     window rather than emptying the morning into the notification centre.
 *
 * ── Reconciliation: claim, then show ────────────────────────────────────────
 *
 * Since background delivery landed (D-105), this is no longer the only voice.
 * A Mac app, a phone, a stray browser tab and a cron dispatcher could all decide
 * to announce the same standup, and being told four times is not four times as
 * useful — it is the theater Principle 9 refuses, arriving by accident.
 *
 * So nothing here shows a reminder it has not CLAIMED. `claim_reminder` is an
 * atomic insert against a unique key of (user, reminder, fire instant), so
 * exactly one channel wins and the rest find out immediately. The unit is the
 * PERSON, not the device — which is the whole point.
 *
 * An open app reliably wins, because the dispatcher deliberately ignores
 * anything less than `DISPATCH_LAG_MS` past due. And if the claim can't be
 * reached at all (offline), we show anyway: a duplicate is a smaller failure
 * than silence about a meeting starting in ten minutes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { invalidateWhenSafe, makeOp, queueWrite } from "../lib/sync";
import type { Reminder, Task } from "../lib/types";
import {
  DEFAULT_REMINDER_PREFS,
  defaultLeadFor,
  dueNow,
  nextFireAt,
  planReminders,
  reminderKey,
  type LeadMinutes,
  type PlannedReminder,
  type ReminderAnchor,
  type ReminderAnchorKind,
  type ReminderTargetKind,
} from "../../supabase/functions/_shared/reminderRules.ts";
import { buildReminderAnchors, keyOfOverride, REMINDER_WINDOW_MS } from "../lib/reminders";
import { subscribeToPush, unsubscribeFromPush } from "../lib/push";
import { detectDeviceTz } from "../lib/timezone";
import { useSettings } from "./useSettings";
import { useAllTasks } from "./useTasks";
import { useSlots } from "./useSlots";
import { useExternalEvents, useHiddenEvents } from "./useCalendar";

const KEY = ["reminders"];

/** The override rows. Tens, not thousands — see the table's migration header. */
export function useReminderOverrides() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Reminder[]> => {
      const { data, error } = await supabase
        .from("reminders")
        .select("id, user_id, created_at, updated_at, target_kind, anchor, target_id, event_key, lead_minutes, fire_at");
      if (error) throw error;
      return (data ?? []) as Reminder[];
    },
    staleTime: 60_000,
  });
}

export interface ReminderTargetRef {
  targetKind: ReminderTargetKind;
  /** tasks.id / slots.id. Omit for an event. */
  targetId?: string | null;
  /** `account_id:provider_event_id`. Required for an event. */
  eventKey?: string | null;
  anchor?: ReminderAnchorKind;
}

function stableIdOf(ref: ReminderTargetRef): string {
  return ref.targetKind === "event" ? (ref.eventKey ?? "") : (ref.targetId ?? "");
}

export function useReminderMutations() {
  const qc = useQueryClient();
  const { data: overrides } = useReminderOverrides();

  const findRow = useCallback(
    (ref: ReminderTargetRef): Reminder | undefined => {
      const key = reminderKey(ref.targetKind, stableIdOf(ref), ref.anchor ?? "start");
      return (qc.getQueryData<Reminder[]>(KEY) ?? overrides ?? []).find((r) => keyOfOverride(r) === key);
    },
    [qc, overrides],
  );

  /**
   * Say something specific about one item: a different lead, or `null` to
   * silence just this one. Upsert by (item, anchor) — setting a reminder twice
   * must not leave two rows, which is what the unique index enforces server-side
   * and what this looks up locally.
   */
  const setReminder = useCallback(
    async (ref: ReminderTargetRef, lead: LeadMinutes) => {
      const anchor = ref.anchor ?? "start";
      const existing = findRow(ref);
      if (existing) {
        qc.setQueryData<Reminder[]>(KEY, (old) =>
          old?.map((r) => (r.id === existing.id ? { ...r, lead_minutes: lead } : r)),
        );
        await queueWrite(makeOp("reminders", "update", existing.id, { lead_minutes: lead }));
      } else {
        const id = crypto.randomUUID();
        const row = {
          target_kind: ref.targetKind,
          anchor,
          target_id: ref.targetKind === "event" ? null : (ref.targetId ?? null),
          event_key: ref.targetKind === "event" ? (ref.eventKey ?? null) : null,
          lead_minutes: lead,
        };
        const now = new Date().toISOString();
        qc.setQueryData<Reminder[]>(KEY, (old) => [
          ...(old ?? []),
          { id, user_id: "", created_at: now, updated_at: now, fire_at: null, ...row } as Reminder,
        ]);
        await queueWrite(makeOp("reminders", "insert", id, row));
      }
      invalidateWhenSafe(qc, "reminders", KEY);
    },
    [qc, findRow],
  );

  /** Drop the override — this item goes back to whatever the defaults say. A
   *  different act from silencing it, and the UI names both. */
  const clearReminder = useCallback(
    async (ref: ReminderTargetRef) => {
      const existing = findRow(ref);
      if (!existing) return;
      qc.setQueryData<Reminder[]>(KEY, (old) => old?.filter((r) => r.id !== existing.id));
      await queueWrite(makeOp("reminders", "delete", existing.id));
      invalidateWhenSafe(qc, "reminders", KEY);
    },
    [qc, findRow],
  );

  return { setReminder, clearReminder, findRow };
}

/**
 * The lead in force for one item, and where it came from — what the detail row
 * renders. `source: "default"` is what lets the row say "10m before (default)"
 * instead of pretending the user chose it.
 */
export function useReminderFor(ref: ReminderTargetRef | null): {
  lead: LeadMinutes;
  /** What the defaults would say — so the picker's "Default" option can name
   *  the value it falls back to, even while an override is in force. */
  defaultLead: LeadMinutes;
  source: "override" | "default";
  enabled: boolean;
} {
  const { settings } = useSettings();
  const { data: overrides } = useReminderOverrides();
  const prefs = settings?.reminder_prefs ?? DEFAULT_REMINDER_PREFS;

  return useMemo(() => {
    if (!ref) {
      return { lead: null, defaultLead: null, source: "default" as const, enabled: prefs.enabled };
    }
    const anchor = ref.anchor ?? "start";
    const defaultLead = defaultLeadFor({ targetKind: ref.targetKind, anchor }, prefs);
    const key = reminderKey(ref.targetKind, stableIdOf(ref), anchor);
    const hit = (overrides ?? []).find((r) => keyOfOverride(r) === key);
    if (hit) {
      return { lead: hit.lead_minutes, defaultLead, source: "override" as const, enabled: prefs.enabled };
    }
    return { lead: defaultLead, defaultLead, source: "default" as const, enabled: prefs.enabled };
  }, [ref, overrides, prefs]);
}

// ── Permission ──────────────────────────────────────────────────────────────

export type NotifyPermission = "unsupported" | "default" | "granted" | "denied";

export function notifyPermission(): NotifyPermission {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission as NotifyPermission;
}

/**
 * Keep this device subscribed to background reminders — or not.
 *
 * Driven by the two facts that decide it: reminders are on, and the OS said
 * yes. Re-runs cheaply on every launch, which is also what keeps the stored
 * timezone fresh when someone travels (a deadline has to speak at 9am somewhere,
 * and the server needs to know where).
 */
export function usePushRegistration(enabled: boolean, permission: NotifyPermission) {
  const { settings, update } = useSettings();
  const storedTz = settings?.time_zone ?? null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!enabled || permission !== "granted") {
        // Turning reminders off should stop the pushes, not merely stop showing
        // them — otherwise a phone in a drawer keeps buzzing.
        if (!enabled) await unsubscribeFromPush();
        return;
      }
      if (cancelled) return;
      await subscribeToPush();
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, permission]);

  // One zone per person, for the dispatcher's deadline math. Written through
  // only when it actually changes — this runs on every launch.
  useEffect(() => {
    if (!enabled || !settings) return;
    const deviceTz = detectDeviceTz();
    if (deviceTz && deviceTz !== storedTz) update({ time_zone: deviceTz });
  }, [enabled, settings, storedTz, update]);
}

export function useNotifyPermission() {
  const [permission, setPermission] = useState<NotifyPermission>(notifyPermission);
  const request = useCallback(async () => {
    if (typeof Notification === "undefined") return "unsupported" as const;
    const result = await Notification.requestPermission();
    setPermission(result as NotifyPermission);
    return result as NotifyPermission;
  }, []);
  return { permission, request, refresh: () => setPermission(notifyPermission()) };
}

// ── Delivery ────────────────────────────────────────────────────────────────

const FIRED_KEY = "nuvo.reminders.fired";
/** Fired keys older than this are forgotten — the set must not grow forever. */
const FIRED_TTL_MS = 36 * 60 * 60 * 1000;

type FiredMap = Record<string, number>;

function readFired(): FiredMap {
  try {
    const raw = localStorage.getItem(FIRED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as FiredMap;
    const cutoff = Date.now() - FIRED_TTL_MS;
    const out: FiredMap = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "number" && v > cutoff) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function writeFired(map: FiredMap) {
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(map));
  } catch {
    /* private mode — reminders still fire, they just may repeat after a reload */
  }
}

/**
 * Claim a reminder before speaking. True = ours to show.
 *
 * The failure mode is chosen deliberately. If the RPC can't be reached — offline,
 * a blip, or a deployment where the migration hasn't landed — we return true and
 * show it. Silence about a meeting that starts in ten minutes is a worse failure
 * than the same meeting announced twice on two devices.
 */
async function claimReminder(r: PlannedReminder): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("claim_reminder", {
      p_key: r.key,
      p_fire_at: new Date(r.fireAtMs).toISOString(),
      p_channel: "foreground",
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

/** Local midnight, so the anchor window's query keys don't change every second. */
function dayStartISO(nowMs: number, dayOffset = 0): string {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString();
}

export interface ReminderDeliveryOptions {
  /** Where a reminder click should land. Mounted shells pass their navigation. */
  onOpen?: (r: PlannedReminder) => void;
}

/**
 * Mount ONCE per shell. Arms a single timer for the next fire, delivers, re-arms.
 */
export function useReminderDelivery(options: ReminderDeliveryOptions = {}) {
  const { settings } = useSettings();
  const prefs = settings?.reminder_prefs ?? DEFAULT_REMINDER_PREFS;
  const enabled = prefs.enabled;

  const { data: overrides } = useReminderOverrides();
  const { data: allTasks } = useAllTasks();
  const { keys: hiddenKeys } = useHiddenEvents();

  // Day-quantized so the clock ticking cannot invalidate these keys. Three days
  // covers the 48h anchor window from any moment inside today.
  const nowDay = useMemo(() => (enabled ? dayStartISO(Date.now()) : ""), [enabled]);
  const endDay = useMemo(() => (enabled ? dayStartISO(Date.now(), 3) : ""), [enabled]);
  const { data: events } = useExternalEvents(nowDay || endDay, endDay);
  const { data: slots } = useSlots(nowDay || endDay, endDay);

  const onOpenRef = useRef(options.onOpen);
  onOpenRef.current = options.onOpen;

  const firedRef = useRef<FiredMap | null>(null);
  if (firedRef.current === null) firedRef.current = readFired();

  // The plan only changes when the day does — not on every render, and never
  // on a keystroke. `nowBucket` re-derives on a coarse tick so a task scheduled
  // for later today enters the window without a page reload.
  const [nowBucket, setNowBucket] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNowBucket(Math.floor(Date.now() / 60_000)), 60_000);
    return () => window.clearInterval(id);
  }, [enabled]);

  const plan = useMemo<PlannedReminder[]>(() => {
    if (!enabled) return [];
    const nowMs = nowBucket * 60_000;
    const anchors: ReminderAnchor[] = buildReminderAnchors({
      tasks: (allTasks ?? []) as Task[],
      slots: slots ?? [],
      events: events ?? [],
      hiddenKeys,
      deadlineTimeMinutes: prefs.deadline_time_minutes,
      nowMs,
      windowMs: REMINDER_WINDOW_MS,
    });
    return planReminders(
      anchors,
      prefs,
      (overrides ?? []).map((r) => ({ key: keyOfOverride(r), lead_minutes: r.lead_minutes })),
    );
  }, [enabled, nowBucket, allTasks, slots, events, hiddenKeys, prefs, overrides]);

  const deliver = useCallback(async (r: PlannedReminder) => {
    // Mark locally FIRST, before the await. Two ticks of this loop must not both
    // reach the claim for one reminder, and the local set is the cheap guard.
    const fired = firedRef.current ?? {};
    fired[r.key] = Date.now();
    firedRef.current = fired;
    writeFired(fired);

    // Claim it across every channel this person has. `false` means another
    // device (or the dispatcher) already told them.
    if (!(await claimReminder(r))) return;

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        const n = new Notification(r.title, {
          body: r.body,
          tag: r.key, // one notification per anchor, never a stack of duplicates
          silent: false,
        });
        n.onclick = () => {
          window.focus();
          onOpenRef.current?.(r);
          n.close();
        };
        return;
      } catch {
        /* fall through to the in-app toast */
      }
    }

    // No permission (or an OS that refused): the app is open, so say it here.
    toast(r.title, {
      description: r.body,
      duration: 12_000,
      action: onOpenRef.current ? { label: "Open", onClick: () => onOpenRef.current?.(r) } : undefined,
    });
  }, []);

  useEffect(() => {
    if (!enabled || plan.length === 0) return;
    let timer: number | undefined;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const now = Date.now();
      const firedKeys = new Set(Object.keys(firedRef.current ?? {}));
      for (const r of dueNow(plan, now, firedKeys)) void deliver(r);

      const next = nextFireAt(plan, now, new Set(Object.keys(firedRef.current ?? {})));
      if (next == null) return;
      // setTimeout saturates past ~24.8 days and would fire immediately; the
      // window is 48h so this never bites, but the clamp is free.
      const delay = Math.min(Math.max(next - Date.now(), 250), 6 * 60 * 60 * 1000);
      timer = window.setTimeout(tick, delay);
    };

    tick();

    // A sleeping tab's timers drift badly. Re-check on wake rather than trusting
    // the timer to have survived — `dueNow`'s grace window keeps it honest.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) window.clearTimeout(timer);
      tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, plan, deliver]);

  return { plan, enabled };
}
