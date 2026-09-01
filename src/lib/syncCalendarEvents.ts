/**
 * Keep FullCalendar's event set in place.
 *
 * Passing a new `events` array (the React default) runs `RESET_RAW_EVENTS`:
 * FullCalendar re-parses every block and the React wrapper rebuilds every
 * `eventContent` portal. KeepAlive already measured that on a lived-in week
 * as **a full second** — which is why a drag's mirror vanished and the block
 * took a beat to reappear. A desktop calendar mutates the one event that
 * moved (`setDates` / `addEvent` / `remove`) and leaves the rest alone.
 *
 * The `events` *prop* must stay referentially stable so FullCalendar's
 * `isMaybeArraysEqual` does not treat the next render as a new source.
 * This helper is what actually moves, adds, and drops blocks after that.
 */

export type CalendarBlockInput = {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  editable?: boolean;
  durationEditable?: boolean;
  classNames?: string[];
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
  display?: string;
  extendedProps?: Record<string, unknown>;
};

/** The slice of FullCalendar's EventApi this sync actually touches. */
export type CalendarBlockApi = {
  id: string;
  title: string;
  start: Date | null;
  end: Date | null;
  allDay: boolean;
  classNames: string[];
  backgroundColor: string;
  borderColor: string;
  startEditable?: boolean;
  durationEditable?: boolean;
  extendedProps: Record<string, unknown>;
  setDates: (
    start: string | Date,
    end: string | Date | null,
    options?: { allDay?: boolean },
  ) => void;
  setProp: (name: string, value: unknown) => void;
  setExtendedProp: (name: string, value: unknown) => void;
  remove: () => void;
};

export type CalendarGridApi = {
  getEvents: () => CalendarBlockApi[];
  getEventById: (id: string) => CalendarBlockApi | null;
  addEvent: (event: CalendarBlockInput) => unknown;
};

function sameWhen(input: string | undefined, date: Date | null, allDay: boolean): boolean {
  if (!input && !date) return true;
  if (!input || !date) return false;
  if (allDay) {
    const [y, m, d] = input.slice(0, 10).split("-").map(Number);
    return date.getFullYear() === y && date.getMonth() + 1 === m && date.getDate() === d;
  }
  return date.getTime() === new Date(input).getTime();
}

function classKey(names: string[] | undefined): string {
  return (names ?? []).filter(Boolean).join("\0");
}

function extVal(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Make the grid match `next` without rebuilding events that already exist.
 *
 * Returns what it did, so a test can prove a drag is `setDates` rather than
 * remove+add (the path that blanks the block).
 */
export function syncCalendarEvents(
  api: CalendarGridApi,
  next: readonly CalendarBlockInput[],
): { added: string[]; removed: string[]; moved: string[]; patched: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  const moved: string[] = [];
  const patched: string[] = [];

  const nextById = new Map(next.map((e) => [e.id, e]));
  for (const ev of api.getEvents()) {
    if (!nextById.has(ev.id)) {
      ev.remove();
      removed.push(ev.id);
    }
  }

  for (const e of next) {
    const existing = api.getEventById(e.id);
    if (!existing) {
      api.addEvent(e);
      added.push(e.id);
      continue;
    }

    const allDay = Boolean(e.allDay);
    const startChanged = !sameWhen(e.start, existing.start, allDay);
    const endChanged = e.end !== undefined && !sameWhen(e.end, existing.end, allDay);
    const allDayChanged = allDay !== existing.allDay;
    if (startChanged || endChanged || allDayChanged) {
      existing.setDates(e.start, e.end ?? null, { allDay });
      moved.push(e.id);
    }

    let touched = false;
    if (e.title !== existing.title) {
      existing.setProp("title", e.title);
      touched = true;
    }
    if (e.editable !== undefined && e.editable !== existing.startEditable) {
      existing.setProp("editable", e.editable);
      touched = true;
    }
    if (e.durationEditable !== undefined && e.durationEditable !== existing.durationEditable) {
      existing.setProp("durationEditable", e.durationEditable);
      touched = true;
    }
    if (e.display !== undefined) {
      existing.setProp("display", e.display);
      touched = true;
    }
    if (e.backgroundColor !== undefined && e.backgroundColor !== existing.backgroundColor) {
      existing.setProp("backgroundColor", e.backgroundColor);
      touched = true;
    }
    if (e.borderColor !== undefined && e.borderColor !== existing.borderColor) {
      existing.setProp("borderColor", e.borderColor);
      touched = true;
    }
    if (e.textColor !== undefined) {
      existing.setProp("textColor", e.textColor);
      touched = true;
    }
    if (e.classNames && classKey(e.classNames) !== classKey(existing.classNames)) {
      existing.setProp("classNames", e.classNames);
      touched = true;
    }
    if (e.extendedProps) {
      for (const [key, value] of Object.entries(e.extendedProps)) {
        if (extVal(existing.extendedProps[key]) === extVal(value)) continue;
        existing.setExtendedProp(key, value);
        touched = true;
      }
    }
    if (touched) patched.push(e.id);
  }

  return { added, removed, moved, patched };
}
