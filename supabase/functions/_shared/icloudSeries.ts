/** PostgREST `.or()` clause matching a CalDAV UID and every `uid::RECURRENCE-ID`
 *  occurrence of that series.
 *
 *  Colons are reserved in the filter grammar. An unquoted `like.uid::*` is
 *  parsed as a broken operator chain, the query errors, `data` is null, and
 *  ALL-scope local rewrites silently no-op — the client then refetches the
 *  old times and the dragged block snaps back. */
export function icloudSeriesOrFilter(uidBase: string): string {
  const q = uidBase.replace(/"/g, '""');
  return `provider_event_id.eq."${q}",provider_event_id.like."${q}::*"`;
}
