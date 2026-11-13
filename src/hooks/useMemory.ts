// Memory (docs/memory.md) — what Nuvo has learned about you, read from what you
// already do and offered back. One read model for every surface that shows it.
//
// Reads: eight full weeks of your own calendar (never a Nuvo mirror, an ICS
// subscription, a hidden calendar, or one you didn't create — §5.1), tasks you
// wrote by hand, and what you've answered. Writes only on your answer, and each
// answer writes something that already exists: working hours, a standing slot,
// a repeating task. The answers themselves live in `user_settings.memory`.

import { useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import { useSettings } from "./useSettings";
import { useAllTasks } from "./useTasks";
import { useCalendarAccounts, useExternalEvents } from "./useCalendar";
import { useEventRouting } from "./useEventRouting";
import { useRecurrenceMutations, useRecurrences } from "./useRecurrence";
import { useVertical } from "./useVertical";
import { todayISO } from "../lib/dates";
import { eventCountsAsActual, eventDomainId } from "../lib/eventActuals";
import { loadMemory, saveMemory } from "../lib/planMemory";
import {
  addDaysISO,
  describe,
  mainHours,
  sectionOf,
  type Described,
  type MemoryAnswer,
  type MemoryState,
  type MemoryWrite,
  type Section,
} from "../lib/memory";
import { readRhythm, windowOf, type Observation, type RhythmEvent } from "../../supabase/functions/_shared/memory/rhythm";
import type { CalendarAccount, ExternalEvent } from "../lib/types";

export interface MemoryItem {
  key: string;
  section: Section;
  area: "Time";
  described: Described;
  observation: Observation | null;
  answer: MemoryAnswer | null;
}

const REFUSE_DAYS = 56;

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** Only calendars that are the person's own (§5.1, settled 2026-11-13). The
 *  providers don't tell us who owns a shared Google calendar, so only the
 *  primary counts there; iCloud calendars belong to the signed-in account; an
 *  ICS feed is always somebody else's. A missed pattern costs nothing. */
function ownedCalendar(accounts: CalendarAccount[]) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return (e: ExternalEvent) => {
    const a = byId.get(e.account_id);
    if (!a) return false;
    if (a.mirror_calendar_id && e.calendar_id === a.mirror_calendar_id) return false;
    if (a.provider === "ics") return false;
    if (a.provider === "google") return e.calendar_id === "primary" || e.calendar_id.toLowerCase() === a.email.toLowerCase();
    return true;
  };
}

export function useMemory() {
  const { settings, update } = useSettings();
  const { data: accounts = [] } = useCalendarAccounts();
  const { data: tasks = [] } = useAllTasks();
  const { data: series = [] } = useRecurrences();
  const recurrence = useRecurrenceMutations();
  const routing = useEventRouting();
  const store = useVertical();
  const vertical = store.data;

  const today = todayISO();
  const win = windowOf(today);
  const startISO = useMemo(() => new Date(`${win.start}T00:00:00`).toISOString(), [win.start]);
  const endISO = useMemo(() => new Date(`${win.end}T00:00:00`).toISOString(), [win.end]);
  const { data: events = [] } = useExternalEvents(startISO, endISO);

  // The column's absence on the row means migration 94 hasn't run: Memory can
  // read, but must not write `memory` (a write to a missing column parks the op).
  const available = Boolean(settings && "memory" in settings);
  const state: MemoryState = (settings as { memory?: MemoryState } | undefined)?.memory ?? {};
  const learning = state.learning !== false;
  const answers = useMemo(() => state.answers ?? [], [state.answers]);

  const currentHours = useMemo(
    () => ({ startMin: settings?.work_start_minutes ?? 480, endMin: settings?.work_end_minutes ?? 990 }),
    [settings?.work_start_minutes, settings?.work_end_minutes],
  );
  const domainName = useCallback((id: string | null) => vertical.domains.find((d) => d.id === id)?.name ?? null, [vertical.domains]);
  const workDomainIds = useMemo(() => vertical.domains.filter((d) => d.kind === "work").map((d) => d.id), [vertical.domains]);

  // Your own calendar, as the detectors read it — also what the page draws.
  const rhythmEvents = useMemo((): RhythmEvent[] => {
    if (!settings) return [];
    const owned = ownedCalendar(accounts);
    const hiddenCalendarIds = new Set(settings.hidden_calendar_ids ?? []);
    const hiddenEventKeys = new Set((settings.hidden_events ?? []).map((h) => h.key));
    const now = new Date();
    return events
      .filter((e) => owned(e) && eventCountsAsActual(e, now, { hiddenCalendarIds, hiddenEventKeys }))
      .map((e) => {
        const s = new Date(e.start_at);
        const en = new Date(e.end_at);
        return {
          title: e.title ?? "",
          day: localDay(s),
          startMin: minutesOf(s),
          // An event that runs past midnight is cut at the day's end.
          endMin: localDay(en) === localDay(s) ? minutesOf(en) : 24 * 60,
          domainId: eventDomainId(e, settings.calendar_domain_map ?? {}, routing),
          seriesId: e.recurring_event_id ?? null,
        };
      });
  }, [settings, accounts, events, routing]);

  const observations = useMemo(() => {
    if (!learning || !settings) return [];
    const handTasks = tasks
      .filter((t) => !t.recurrence_id && t.created_at)
      .map((t) => ({ title: t.title, createdDay: localDay(new Date(t.created_at)) }));
    const obs = readRhythm({
      today,
      events: rhythmEvents,
      tasks: handTasks,
      workDomainIds,
      repeatingTitles: series.map((r) => r.title),
      fallbackHours: currentHours,
    });
    // Hours you already have are not news.
    return obs.filter((o) => {
      if (o.kind !== "hours") return true;
      const main = mainHours(o.days);
      const early = o.days.some((d) => main.endMin - d.endMin >= 30);
      return early || main.startMin !== currentHours.startMin || main.endMin !== currentHours.endMin;
    });
  }, [learning, settings, rhythmEvents, tasks, series, today, workDomainIds, currentHours]);

  /** The eight weeks drawn as one week: for each weekday and hour, in how many
   *  of the weeks something of yours was there (0–8). The page's portrait. */
  const heat = useMemo(() => {
    const seen = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => new Set<number>()));
    for (const e of rhythmEvents) {
      const w = win.weekIndex(e.day);
      if (w < 0) continue;
      const wd = (new Date(`${e.day}T00:00:00Z`).getUTCDay() + 6) % 7;
      for (let h = Math.floor(e.startMin / 60); h < Math.ceil(e.endMin / 60) && h < 24; h++) seen[wd][h].add(w);
    }
    return seen.map((row) => row.map((s) => s.size));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rhythmEvents, win.start]);
  const reading = useMemo(
    () => ({ weeks: 8, events: rhythmEvents.filter((e) => win.weekIndex(e.day) >= 0).length, written: tasks.filter((t) => !t.recurrence_id).length }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rhythmEvents, tasks, win.start],
  );

  const items: MemoryItem[] = useMemo(() => {
    const fromObs: MemoryItem[] = observations.flatMap((o) => {
      const section = sectionOf(o, answers, today);
      return section
        ? [{ key: o.key, section, area: "Time" as const, described: describe(o, { domainName, currentHours }), observation: o, answer: null }]
        : [];
    });
    const fromAnswers: MemoryItem[] = answers
      .filter((a) => a.answer === "kept" || !a.until || a.until > today)
      .map((a) => ({
        key: a.key,
        section: a.answer === "kept" ? ("kept" as const) : ("no" as const),
        area: a.area,
        described: {
          title: a.statement,
          statement: a.statement,
          evidence: a.evidence,
          confidence: "sure" as const,
          source: a.source,
          uses: a.uses,
          keep: "",
          no: "",
          forget: a.forget ?? "Nuvo forgets it.",
        },
        observation: null,
        answer: a,
      }));
    return [...fromObs, ...fromAnswers];
  }, [observations, answers, today, domainName, currentHours]);

  const seenKeys = useMemo(() => new Set(state.seenKeys ?? []), [state.seenKeys]);
  const fresh = items.filter((i) => i.section === "new" && !seenKeys.has(i.key));

  // Saves read the latest state, not this render's: several answers can be
  // given before the settings cache re-renders (Use these keeps them in a row).
  const latest = useRef(state);
  latest.current = state;
  const save = useCallback(
    (next: MemoryState) => {
      if (!available) return false;
      latest.current = next;
      update({ memory: next });
      return true;
    },
    [available, update],
  );

  const current = () => latest.current.answers ?? [];
  const withAnswers = (list: MemoryAnswer[]): MemoryState => ({ ...latest.current, answers: list });

  /** Take back what a Keep wrote. */
  const unwrite = useCallback(
    async (w: MemoryWrite | undefined) => {
      if (!w) return;
      if (w.kind === "hours" && w.before) {
        update({ work_start_minutes: w.before.work_start_minutes, work_end_minutes: w.before.work_end_minutes });
        if (w.before.dayEnds) {
          const m = loadMemory();
          const dayEnds = { ...m.rules.dayEnds };
          for (const [k, v] of Object.entries(w.before.dayEnds)) {
            if (v == null) delete dayEnds[+k];
            else dayEnds[+k] = v;
          }
          saveMemory({ ...m, rules: { ...m.rules, dayEnds } });
        }
      }
      if ((w.kind === "slot-series" || w.kind === "task-series") && w.seriesId) {
        const rec = series.find((r) => r.id === w.seriesId);
        if (rec) await recurrence.stopSeries(rec, today);
      }
    },
    [update, series, recurrence, today],
  );

  const keep = useCallback(
    async (item: MemoryItem, opts?: { quiet?: boolean }) => {
      const o = item.observation;
      if (!o || !available) return;
      let wrote: MemoryWrite = { kind: "none" };
      try {
        if (o.kind === "hours") {
          const main = mainHours(o.days);
          const m = loadMemory();
          const beforeEnds: Record<number, number | null> = {};
          const dayEnds = { ...m.rules.dayEnds };
          o.days
            .filter((d) => main.endMin - d.endMin >= 30)
            .forEach((d) => {
              const sun0 = (d.weekday + 1) % 7; // planMemory counts from Sunday
              beforeEnds[sun0] = dayEnds[sun0] ?? null;
              dayEnds[sun0] = d.endMin;
            });
          wrote = {
            kind: "hours",
            before: { work_start_minutes: currentHours.startMin, work_end_minutes: currentHours.endMin, dayEnds: beforeEnds },
          };
          update({ work_start_minutes: main.startMin, work_end_minutes: main.endMin });
          if (Object.keys(beforeEnds).length) saveMemory({ ...m, rules: { ...m.rules, dayEnds } });
        } else if ((o.kind === "habit" && !o.fromSeries) || o.kind === "window") {
          const title = o.kind === "habit" ? o.title : "Deep work";
          const domainId = o.kind === "habit" ? o.domainId : (workDomainIds[0] ?? null);
          const rec = await recurrence.createSeries({
            kind: "slot",
            rule: { freq: "weekly", interval: 1, byweekday: o.weekdays.map((d) => (d + 1) % 7) },
            anchorISO: nextOn(today, o.weekdays),
            template: { title, duration_minutes: o.endMin - o.startMin, time_of_day_minutes: o.startMin, domain_id: domainId },
          });
          wrote = { kind: "slot-series", seriesId: rec.id };
        } else if (o.kind === "repeat") {
          const rule =
            o.cadence === "weekly"
              ? { freq: "weekly" as const, interval: 1, byweekday: [((o.weekday ?? 0) + 1) % 7] }
              : { freq: "monthly" as const, interval: 1, bymonthday: o.cadence === "monthly-last-weekday" ? 31 : o.monthDay ?? 1 };
          const anchorISO = o.cadence === "weekly" ? nextOn(today, [o.weekday ?? 0]) : today;
          const rec = await recurrence.createSeries({
            kind: "task",
            rule,
            anchorISO,
            template: { title: o.title, duration_minutes: settings?.default_task_duration_minutes ?? 30, time_of_day_minutes: null },
          });
          wrote = { kind: "task-series", seriesId: rec.id };
        }
      } catch {
        toast.error("Nuvo couldn't make that just now. Nothing was kept.");
        return;
      }
      const d = item.described;
      const answer: MemoryAnswer = {
        key: o.key,
        answer: "kept",
        at: new Date().toISOString(),
        area: "Time",
        statement: d.statement,
        evidence: d.evidence,
        source: `${d.source} · kept ${shortDate(today)}`,
        uses: d.uses,
        forget: d.forget,
        wrote,
      };
      save(withAnswers([...current().filter((a) => a.key !== o.key), answer]));
      if (!opts?.quiet) toast("Kept. Nuvo plans with it from now.", {
        action: { label: "Undo", onClick: () => void unwrite(wrote).then(() => save(withAnswers(current().filter((a) => a.key !== o.key)))) },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [available, currentHours, workDomainIds, recurrence, today, settings, update, answers, save, unwrite],
  );

  const refuse = useCallback(
    (item: MemoryItem, opts?: { quiet?: boolean }) => {
      if (!available) return;
      const d = item.described;
      const answer: MemoryAnswer = {
        key: item.key,
        answer: "refused",
        at: new Date().toISOString(),
        until: addDaysISO(today, REFUSE_DAYS),
        area: "Time",
        statement: d.statement,
        evidence: d.evidence,
        source: `You said not true on ${shortDate(today)}`,
        uses: [],
      };
      save(withAnswers([...current().filter((a) => a.key !== item.key), answer]));
      if (!opts?.quiet) toast("Got it. Nuvo stopped looking for that.", {
        action: { label: "Undo", onClick: () => save(withAnswers(current().filter((a) => a.key !== item.key))) },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [available, today, answers, save],
  );

  /** Forget something kept: take back what it wrote, and don't ask again for 8 weeks. */
  const forget = useCallback(
    async (item: MemoryItem) => {
      const a = item.answer;
      if (!a || !available) return;
      await unwrite(a.wrote);
      const refused: MemoryAnswer = { ...a, answer: "refused", until: addDaysISO(today, REFUSE_DAYS), source: `Forgotten on ${shortDate(today)}`, wrote: undefined };
      save(withAnswers([...current().filter((x) => x.key !== a.key), refused]));
      toast("Forgotten.");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [available, unwrite, today, answers, save],
  );

  const askAgain = useCallback(
    (item: MemoryItem) => {
      save(withAnswers(current().filter((a) => a.key !== item.key)));
      toast("Nuvo will watch for it again.");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [answers, save],
  );

  const setLearning = useCallback(
    (on: boolean) => {
      save({ ...latest.current, learning: on });
    },
    [state, save],
  );

  /** Opening Memory spends the dot, whether or not you answer (§4.1). */
  const markSeen = useCallback(() => {
    if (!fresh.length) return;
    save({ ...latest.current, seenKeys: [...new Set([...(latest.current.seenKeys ?? []), ...fresh.map((i) => i.key)])].slice(-200) });
  }, [fresh, state, save]);

  /** First run (§5.3): shown once, the first time there's something sure to say. */
  const introduced = Boolean(state.introducedAt);
  const markIntroduced = useCallback(() => {
    save({ ...latest.current, introducedAt: new Date().toISOString() });
  }, [state, save]);
  /** Use these: keep each in turn, quietly, then say it once. */
  const keepMany = useCallback(
    async (list: MemoryItem[]) => {
      for (const it of list) await keep(it, { quiet: true });
      if (list.length) toast(`${list.length} kept. Nuvo plans with ${list.length === 1 ? "it" : "them"} from now.`);
    },
    [keep],
  );

  /** Forget everything: every memory and refusal goes; what a Keep wrote stays as yours. */
  const forgetAll = useCallback(() => {
    save({ learning: state.learning, answers: [], seenKeys: [] });
    toast("Memory cleared. What you kept stays in your settings.");
  }, [state.learning, save]);

  const needsWorkDomain = workDomainIds.length === 0 && vertical.domains.some((d) => d.kindStored);
  const hasNew = learning && fresh.length > 0;
  const newCount = fresh.length;
  const { updateDomain } = store;
  /** Mark a domain as paid work, or take that back. Several can be work. */
  const setWorkDomain = useCallback(
    (id: string, on = true) => {
      const d = vertical.domains.find((x) => x.id === id);
      if (d?.kindStored) updateDomain(id, { kind: on ? "work" : null });
    },
    [vertical.domains, updateDomain],
  );

  // One stable object: the Schedule (a memo'd 5,000-line surface) and the rail
  // take it as a prop, so a fresh object every render would re-render them both.
  return useMemo(
    () => ({
      available,
      introduced,
      markIntroduced,
      keepMany,
      learning,
      items,
      hasNew,
      newCount,
      keep,
      refuse,
      forget,
      askAgain,
      setLearning,
      markSeen,
      forgetAll,
      /** For a domain without a kind, the one question Memory needs answered. */
      needsWorkDomain,
      domains: vertical.domains,
      workDomainIds,
      heat,
      reading,
      setWorkDomain,
    }),
    [available, introduced, markIntroduced, keepMany, learning, items, hasNew, newCount, keep, refuse, forget, askAgain, setLearning, markSeen, forgetAll, needsWorkDomain, vertical.domains, workDomainIds, heat, reading, setWorkDomain],
  );
}

/** The next date, from today on, that falls on one of these weekdays (Monday = 0). */
function nextOn(today: string, weekdays: number[]): string {
  for (let i = 0; i < 7; i++) {
    const d = addDaysISO(today, i);
    const wd = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
    if (weekdays.includes(wd)) return d;
  }
  return today;
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
