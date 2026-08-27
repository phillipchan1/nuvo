import { isSameDay, startOfDay } from "date-fns";

// Month-grid tap meaning (D-121). First tap on a day selects it so the list
// under the grid can answer; a tap on the already-selected day opens Day.
// Extracted so the rule can be tested without mounting the calendar.

export function clampDayToMonth(day: Date, month: Date): Date {
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return startOfDay(new Date(month.getFullYear(), month.getMonth(), Math.min(day.getDate(), last)));
}

export function monthDayIntent(selected: Date, tapped: Date): "select" | "open" {
  return isSameDay(startOfDay(selected), startOfDay(tapped)) ? "open" : "select";
}
