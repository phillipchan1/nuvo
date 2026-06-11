// The user's LOCAL calendar date (YYYY-MM-DD). Everything that reasons about
// "today" must use this — the server runs in UTC, and comparing Notion date
// strings against a UTC "today" skews the day boundary by the timezone offset.
export function localToday(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
