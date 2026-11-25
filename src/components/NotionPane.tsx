// Settings → Notion (D-257). One rule, no rules engine: a database you switch
// on sends what's **assigned to you and still open** to the inbox, once, as
// your task. Which pages Nuvo can see is chosen on Notion's own screen; the
// only choice here is which of those databases count — and, when a database
// has more than one person field, which one means "assigned to".

import { toast } from "sonner";
import { Icon } from "./Icon";
import { PaneHeader, Select, Toggle } from "./form";
import { Button, Chip, SectionHeader } from "./kit";
import { startNotionConnect, useNotionActions, useNotionSource, type NotionFeed } from "../hooks/useNotion";

function syncedAgo(iso: string | null): string {
  if (!iso) return "Not synced yet";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "Synced just now";
  if (mins < 60) return `Synced ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `Synced ${hrs}h ago` : `Synced ${Math.round(hrs / 24)}d ago`;
}

export function NotionPane() {
  const { data: source, isLoading } = useNotionSource();
  const { setFeed, refresh, disconnect } = useNotionActions();

  if (isLoading) return <PaneHeader title="Notion" />;

  if (!source) {
    return (
      <div>
        <PaneHeader title="Notion" />
        <div className="set-row">
          <span className="set-acct-mark" aria-hidden>
            N
          </span>
          <div className="set-row-label">
            <span className="set-row-title">Notion</span>
            <div className="set-row-desc">What's assigned to you lands in your inbox.</div>
          </div>
          <div className="set-row-ctl">
            <Button kind="primary" className="tap" onClick={() => void startNotionConnect()}>
              Connect
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const toggle = (f: NotionFeed, on: boolean) =>
    setFeed.mutate(
      { sourceId: source.id, feedId: f.id, on },
      {
        onSuccess: (r) => {
          if (r.added > 0) toast.success(`${r.added} from ${f.title} in your inbox`);
        },
        onError: (e) => toast.error(e.message),
      },
    );

  const feedRow = (f: NotionFeed) => {
    const usable = Boolean(f.assignee);
    return (
      <div key={f.id} className="set-list-row" data-off={f.on ? undefined : ""}>
        <div className="set-list-main min-w-0">
          <span className="set-list-title">{f.title}</span>
          {!usable && <span className="set-list-meta">No person field to read "assigned to you" from</span>}
        </div>
        {f.on && f.people.length > 1 && (
          <Select
            value={f.assignee ?? ""}
            onChange={(e) =>
              setFeed.mutate(
                { sourceId: source.id, feedId: f.id, assignee: e.target.value },
                { onError: (err) => toast.error(err.message) },
              )
            }
            aria-label={`Which field means assigned to you in ${f.title}`}
            title="The person field that means it's yours"
            className="w-36 shrink-0"
          >
            {f.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
        <Toggle
          checked={f.on}
          disabled={!usable}
          onChange={(v) => toggle(f, v)}
          label={`Send ${f.title} to the inbox`}
        />
      </div>
    );
  };

  return (
    <div>
      <PaneHeader title="Notion" />
      <section className="set-acct">
        <div className="set-acct-head">
          <span className="set-acct-mark" aria-hidden>
            N
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-body font-medium text-ink">{source.account_name || "Notion"}</span>
            <span className="block truncate text-caption text-muted">
              {source.needs_reconnect ? "Paused" : syncedAgo(source.last_synced_at)}
            </span>
          </span>
          {source.needs_reconnect ? (
            <Button size="sm" kind="danger" className="tap" onClick={() => void startNotionConnect()}>
              Reconnect
            </Button>
          ) : (
            <Chip>One-way</Chip>
          )}
          <Button
            size="sm"
            className="tap"
            disabled={disconnect.isPending}
            onClick={() => disconnect.mutate(source.id, { onError: (e) => toast.error(e.message) })}
          >
            Disconnect
          </Button>
        </div>

        <p className="set-note mb-2">
          Open work assigned to you arrives once, as your task. Finishing it here doesn't change Notion.
        </p>

        <SectionHeader title="Databases" className="!px-0" />
        <div className="set-list">
          {source.feeds.map(feedRow)}
          {source.feeds.length === 0 && (
            <div className="set-list-row">
              <span className="set-note">No databases shared with Nuvo</span>
            </div>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {/* Notion's own picker is the only place page access changes. */}
          <Button kind="ghost" className="tap -ml-2" onClick={() => void startNotionConnect()}>
            Choose pages in Notion
          </Button>
          <Button
            kind="ghost"
            className="tap"
            icon={<Icon name="refresh" size={13} />}
            disabled={refresh.isPending}
            onClick={() => refresh.mutate(source.id, { onError: (e) => toast.error(e.message) })}
          >
            {refresh.isPending ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </section>
    </div>
  );
}
