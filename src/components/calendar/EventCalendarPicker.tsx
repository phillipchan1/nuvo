// Which calendar a NEW event goes on — one list for every place an event is
// made: the grid's drag-to-create card (`DraftComposer`), the capture door's
// Event face (`mobile/EventComposer`, behind ⌘K, ⌥Space and the phone's ＋),
// and Task → Event (the Schedule's right-click menu and the task card's footer).
//
// The composers used to offer a chip per ACCOUNT ("Google · me@…", "Apple ·
// me@…") and then quietly land on that account's own calendar. Someone with
// Work, Family and a church calendar under one Google login could not put an
// event on any of them but the first — and with a single account there was no
// picker at all. The unit you choose is the calendar; the account is only its
// heading (D-152).
//
// What's offered is `createTargetGroups` — writable, and not hidden from the
// board (D-047). An untouched choice lands where an unnamed create always has
// (`pickCreateTarget`: the Settings default calendar, never a hidden one), and
// that calendar wears a "default" mark in the list. It opens in place rather
// than as a popover, so it reads the same inside the desktop card, a context
// menu and the phone's bottom Sheet.

import { useMemo, useState } from "react";
import { Icon } from "../Icon";
import { Dot } from "../kit";
import { useCalendarAccounts } from "../../hooks/useCalendar";
import { useSettings } from "../../hooks/useSettings";
import {
  createDefaults,
  createTargetGroups,
  pickCreateTarget,
  providerLabel,
  type CreateTarget,
  type MoveTargetGroup,
} from "../../lib/calendarWrite";
import type { CalendarProvider } from "../../lib/types";

const sameTarget = (a?: CreateTarget | null, b?: CreateTarget | null) =>
  Boolean(a && b && a.accountId === b.accountId && a.calendarId === b.calendarId);

/** Everywhere a new event may go, and where it goes if nobody says. `choosable`
 *  is whether there is more than one calendar — i.e. whether to ask at all. */
export function useCreateTargets(): {
  groups: MoveTargetGroup[];
  defaultTarget: CreateTarget | null;
  choosable: boolean;
} {
  const { data: accounts = [] } = useCalendarAccounts();
  const { settings } = useSettings();
  const { hiddenIds, defaultAccountId, defaultCalendarId } = createDefaults(settings);

  const groups = useMemo(() => createTargetGroups(accounts, hiddenIds), [accounts, hiddenIds]);
  const defaultTarget = useMemo(
    () => pickCreateTarget(accounts, { hiddenIds, defaultAccountId, defaultCalendarId }),
    [accounts, hiddenIds, defaultAccountId, defaultCalendarId],
  );
  // One calendar is not a choice.
  const choosable = groups.reduce((n, g) => n + g.calendars.length, 0) > 1;
  return { groups, defaultTarget, choosable };
}

/** The calendar a composer will create on, and how to change it. `target` is
 *  null only when there is nowhere visible to write at all. */
export function useEventCalendar(): {
  groups: MoveTargetGroup[];
  target: CreateTarget | null;
  defaultTarget: CreateTarget | null;
  provider: CalendarProvider | null;
  choosable: boolean;
  pick: (target: CreateTarget) => void;
} {
  const { groups, defaultTarget, choosable } = useCreateTargets();
  // null = untouched → follow the default, which can still arrive after mount
  // (accounts and settings are both async). A pick that is no longer offered
  // (hidden meanwhile) quietly yields to the default too.
  const [picked, setPicked] = useState<CreateTarget | null>(null);
  const stillOffered =
    picked &&
    groups.some(
      (g) => g.accountId === picked.accountId && g.calendars.some((c) => c.id === picked.calendarId),
    );
  const target = stillOffered ? picked : defaultTarget;
  const provider = target
    ? (groups.find((g) => g.accountId === target.accountId)?.provider ?? null)
    : null;
  return { groups, target, defaultTarget, provider, choosable, pick: setPicked };
}

/** The grouped list itself. `field` sits inside a form (the composers, the task
 *  card); `menu` sits inside a right-click menu. Both wear the kit's menu rows;
 *  on a phone the rows grow to a thumb. */
export function CalendarTargetList({
  groups,
  value,
  defaultTarget,
  onPick,
  variant = "field",
  label = "Calendar",
}: {
  groups: MoveTargetGroup[];
  /** The current choice, ticked. Null in a menu where nothing is chosen yet. */
  value: CreateTarget | null;
  defaultTarget?: CreateTarget | null;
  onPick: (target: CreateTarget) => void;
  variant?: "field" | "menu";
  label?: string;
}) {
  // Account headings only earn their line when there is more than one account —
  // then they're what tells two calendars both called "Work" apart.
  const manyAccounts = groups.length > 1;
  const menu = variant === "menu";

  return (
    // Capped and scrolled only on the desktop. On the phone the list grows
    // inline and the Sheet scrolls — a nested scroller there fights the Sheet's
    // own drag-to-dismiss.
    <div
      role="radiogroup"
      aria-label={label}
      className={`flex flex-col ${
        menu ? "max-h-[220px] overflow-y-auto" : "md:max-h-[240px] md:overflow-y-auto md:overscroll-contain"
      }`}
    >
      {groups.map((g) => (
        <div key={g.accountId} className="flex flex-col">
          {manyAccounts && (
            <div className="k-pick-group">
              {g.accountLabel} · {providerLabel(g.provider)}
            </div>
          )}
          {g.calendars.map((c) => {
            const target = { accountId: g.accountId, calendarId: c.id };
            const on = sameTarget(value, target);
            const isDefault = sameTarget(defaultTarget, target);
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onPick(target)}
                className="k-mi k-pick-row"
              >
                <Dot color={c.color ?? "var(--faint)"} />
                <span className="k-mi-label">{c.summary}</span>
                {isDefault && <span className="k-pick-default">default</span>}
                {on && <Icon name="check" size={14} className="k-mi-check" />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** A composer's Calendar field: the current calendar, opening in place into
 *  the list. `field` is a kit field (a form); `value` reads like the other
 *  values in an inspector row. */
export function EventCalendarPicker({
  groups,
  value,
  defaultTarget,
  onChange,
  variant = "field",
}: {
  groups: MoveTargetGroup[];
  value: CreateTarget | null;
  defaultTarget?: CreateTarget | null;
  onChange: (target: CreateTarget) => void;
  variant?: "field" | "value";
}) {
  const [open, setOpen] = useState(false);
  const manyAccounts = groups.length > 1;
  const group = value ? groups.find((g) => g.accountId === value.accountId) : undefined;
  const current = group?.calendars.find((c) => c.id === value?.calendarId);
  const asValue = variant === "value";

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={asValue ? "insp-v self-start" : "k-field k-select tap-h w-full"}
      >
        <span className={asValue ? "flex min-w-0 items-center gap-1.5" : "k-select-val"}>
          <Dot color={current?.color ?? "var(--faint)"} />
          <span className="truncate">{current?.summary ?? "Calendar"}</span>
          {manyAccounts && group && (
            <span className="k-pick-default truncate">
              {group.accountLabel} · {providerLabel(group.provider)}
            </span>
          )}
        </span>
        <Icon name="chevron-down" size={12} className={`fast shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <CalendarTargetList
          groups={groups}
          value={value}
          defaultTarget={defaultTarget}
          onPick={(t) => {
            onChange(t);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
