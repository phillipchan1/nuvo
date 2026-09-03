/**
 * Keep FullCalendar's event set in place.
 *
 * Passing a new `events` array runs `RESET_RAW_EVENTS`: FullCalendar re-parses
 * every block and rebuilds every `eventContent` portal. A drag should instead
 * mutate the one event that moved and leave the rest of the grid standing.
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
  textColor: string;
  display: string;
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
  /** FullCalendar's render-runner pause. Optional so tests can pass a plain stub. */
  batchRendering?: (fn: () => void) => void;
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
 * Returns what changed so tests can prove a drag uses `setDates` rather than
 * remove+add, which is the path that blanks or snaps back the block.
 */
export function syncCalendarEvents(
  api: CalendarGridApi,
  next: readonly CalendarBlockInput[],
): { added: string[]; removed: string[]; moved: string[]; patched: string[] } {
  // Every `addEvent` / `setDates` / `setProp` below is a separate FullCalendar
  // action, and each one re-renders and re-measures the whole grid. Paging one
  // week re-adds 71-84 events and mutates the rest, and measured on a real
  // account that cost 24,184 forced layouts and a single 1,467ms frame — a
  // visibly frozen app. `batchRendering` pauses the render runner for the whole
  // reconcile: same 80 events cost 284 layouts and 73ms. Optional, so a test
  // stub without it still gets identical (unbatched) semantics.
  const run = api.batchRendering ? api.batchRendering.bind(api) : (fn: () => void) => fn();
  let result!: { added: string[]; removed: string[]; moved: string[]; patched: string[] };
  run(() => {
    result = reconcile(api, next);
  });
  return result;
}

function reconcile(
  api: CalendarGridApi,
  next: readonly CalendarBlockInput[],
): { added: string[]; removed: string[]; moved: string[]; patched: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  const moved: string[] = [];
  const patched: string[] = [];

  const nextById = new Map(next.map((e) => [e.id, e]));
  for (const event of api.getEvents()) {
    if (!nextById.has(event.id)) {
      event.remove();
      removed.push(event.id);
    }
  }

  for (const input of next) {
    const existing = api.getEventById(input.id);
    if (!existing) {
      api.addEvent(input);
      added.push(input.id);
      continue;
    }

    const allDay = Boolean(input.allDay);
    const startChanged = !sameWhen(input.start, existing.start, allDay);
    const endChanged = input.end !== undefined && !sameWhen(input.end, existing.end, allDay);
    const allDayChanged = allDay !== existing.allDay;
    if (startChanged || endChanged || allDayChanged) {
      existing.setDates(input.start, input.end ?? null, { allDay });
      moved.push(input.id);
    }

    let touched = false;
    if (input.title !== existing.title) {
      existing.setProp("title", input.title);
      touched = true;
    }
    if (input.editable !== undefined && input.editable !== existing.startEditable) {
      existing.setProp("editable", input.editable);
      touched = true;
    }
    if (
      input.durationEditable !== undefined &&
      input.durationEditable !== existing.durationEditable
    ) {
      existing.setProp("durationEditable", input.durationEditable);
      touched = true;
    }
    if (input.display !== undefined && input.display !== existing.display) {
      existing.setProp("display", input.display);
      touched = true;
    }
    if (
      input.backgroundColor !== undefined &&
      input.backgroundColor !== existing.backgroundColor
    ) {
      existing.setProp("backgroundColor", input.backgroundColor);
      touched = true;
    }
    if (input.borderColor !== undefined && input.borderColor !== existing.borderColor) {
      existing.setProp("borderColor", input.borderColor);
      touched = true;
    }
    if (input.textColor !== undefined && input.textColor !== existing.textColor) {
      existing.setProp("textColor", input.textColor);
      touched = true;
    }
    if (input.classNames && classKey(input.classNames) !== classKey(existing.classNames)) {
      existing.setProp("classNames", input.classNames);
      touched = true;
    }
    if (input.extendedProps) {
      for (const [key, value] of Object.entries(input.extendedProps)) {
        if (extVal(existing.extendedProps[key]) === extVal(value)) continue;
        existing.setExtendedProp(key, value);
        touched = true;
      }
    }
    if (touched) patched.push(input.id);
  }

  return { added, removed, moved, patched };
}
