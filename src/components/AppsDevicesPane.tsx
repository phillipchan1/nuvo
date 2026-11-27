// Apps & devices — everything outside Nuvo that is connected to it, except
// calendars (D-258). One list, grouped by what a thing can do:
//
//   Inbox         — it can only add to your inbox: the Inbox address, Notion,
//                   and Inbox keys (a watch, a shortcut).
//   Full account  — it sees and acts as you, over MCP (Grok Bot, Cursor), and
//                   may take hand-offs.
//
// Each row is one line and opens a page of its own; the agent's switches, its
// doorbell and its setup steps live on that page, not on the list. There was a
// pane for each door (Inbox address, Notion, Apps & devices) and the list
// expanded every agent's doorbell inline — three sections that all meant
// "something connected", and a page that answered three questions at once.
//
// The keys are bearer tokens in the `connections` table — deliberately NOT
// called "connections" in the UI: that word is the calendar accounts' (P11).
// A token is shown exactly once. We store `sha256(token)` and the last four
// characters — never the token — so a leaked row cannot be replayed and this
// screen can never show it again. Revoking is a timestamp, not a delete: a
// revoked row still explains where a task came from.

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { inboundAddress } from "../../supabase/functions/_shared/inboundEmail.ts";
import { supabase } from "../lib/supabase";
import { edgeFunctionUrl } from "../lib/backend";
import { liveInboundMailDomain } from "../lib/maintenance";
import { randomUrlSafeToken as mintToken, sha256Hex } from "../lib/webcrypto";
import { useSettings } from "../hooks/useSettings";
import { useNotionSource } from "../hooks/useNotion";
import { Icon, type IconName } from "./Icon";
import { LinkRow, PaneHeader, TextInput } from "./form";
import { Button, SectionHeader, Switch } from "./kit";
import { InboxAddressPane } from "./InboxAddress";
import { NotionPane, syncedAgo } from "./NotionPane";
import { HANDOFF_AGENTS_QK, ringDoorbell, setDoorbell } from "../hooks/useHandoff";
import { at as clockAt } from "./mobile/dayPlan";

interface Connection {
  id: string;
  app: string;
  name: string;
  scopes: string[];
  last_four: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  /** hand-off (D-250) — absent until migration 96 reaches the database */
  takes_handoffs?: boolean;
  doorbell_url?: string | null;
  doorbell_key_version?: number | null;
}

const QK = ["connections"] as const;

type TokenKind = "inbox" | "account";

const KIND_SCOPES: Record<TokenKind, string[]> = {
  inbox: ["inbox:write"],
  account: ["account"],
};

/** The two kinds of key, as the Add page offers them. The kind's name rides
 *  as the line under — the thing a person is adding is the title. */
const KINDS: Record<TokenKind, { icon: IconName; label: string; offer: string; can: string; placeholder: string }> = {
  account: {
    icon: "user",
    label: "Full account",
    offer: "An agent or app",
    can: "Sees and acts as you, over MCP",
    placeholder: "Cursor, Grok Bot",
  },
  inbox: {
    icon: "package",
    label: "Inbox",
    offer: "A device or shortcut",
    can: "Adds tasks; can't read your week",
    placeholder: "Apple Watch, shortcut",
  },
};

function kindOf(scopes: string[]): TokenKind {
  return scopes.includes("account") ? "account" : "inbox";
}

/** "lead_well" from "Lead Well" — the machine key the capture payload reports
 *  as a task's `source` when it doesn't name one itself. */
const machineKey = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "app";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

const usedLine = (c: Connection) => (c.last_used_at ? `used ${fmtDate(c.last_used_at)}` : "never used");

async function copyText(text: string, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(ok);
  } catch {
    toast.error("Couldn't copy — select it and copy it by hand");
  }
}

function Mark({ icon, children }: { icon?: IconName; children?: ReactNode }) {
  return (
    <span aria-hidden className="set-acct-mark">
      {icon ? <Icon name={icon} size={14} /> : children}
    </span>
  );
}

function CopyBtn({ onClick, children, primary }: { onClick: () => void; children: ReactNode; primary?: boolean }) {
  return (
    <Button kind={primary ? "primary" : "secondary"} className="tap shrink-0" icon={<Icon name="copy" size={13} />} onClick={onClick}>
      {children}
    </Button>
  );
}

function StepList({ steps }: { steps: string[] }) {
  return (
    <ol className="set-steps">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}

function Back({ to, onBack }: { to: string; onBack: () => void }) {
  return (
    <Button kind="ghost" size="sm" className="tap set-back" icon={<Icon name="chevron-left" size={14} />} onClick={onBack}>
      {to}
    </Button>
  );
}

function useConnections() {
  return useQuery({
    queryKey: QK,
    queryFn: async (): Promise<Connection[]> => {
      const base = "id, app, name, scopes, last_four, created_at, last_used_at, revoked_at";
      const withHandoff = await supabase
        .from("connections")
        .select(`${base}, takes_handoffs, doorbell_url, doorbell_key_version`)
        .order("created_at", { ascending: false });
      if (!withHandoff.error) return (withHandoff.data ?? []) as Connection[];
      // A database migration 96 hasn't reached: the list without hand-off.
      const { data, error } = await supabase.from("connections").select(base).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Connection[];
    },
  });
}

/** Where the pane opens. Settings' old Inbox address and Notion sections are
 *  deep links into it now (the empty inbox, the return from Notion). */
export type AppsStart = "list" | "address" | "notion";

type Page =
  | { kind: "list" }
  | { kind: "address" }
  | { kind: "notion" }
  | { kind: "add" }
  | { kind: "new"; tokenKind: TokenKind }
  | { kind: "key"; id: string };

/** A page inside the pane, as the phone's Sheet header wants it: its name, and
 *  the way up one level. The phone hides the page's own back and title and
 *  says both in the Sheet's header — one back, one name (D-258). */
export type AppsNav = { title: string; back: () => void } | null;

export function AppsDevicesPane({ start = "list", onNav }: { start?: AppsStart; onNav?: (nav: AppsNav) => void }) {
  const [page, setPage] = useState<Page>({ kind: start });
  useEffect(() => setPage({ kind: start }), [start]);
  const { data: connections } = useConnections();
  const keyName = page.kind === "key" ? connections?.find((c) => c.id === page.id)?.name : undefined;
  // Held in memory only, and only until the page is left. Never persisted,
  // never re-derivable — this is the one moment the token exists outside a hash.
  const [fresh, setFresh] = useState<{ id: string; token: string } | null>(null);
  const go = (p: Page) => {
    if (p.kind !== "key") setFresh(null);
    setPage(p);
  };
  const toList = () => go({ kind: "list" });

  useEffect(() => {
    if (!onNav) return;
    const up = (p: Page) => () => go(p);
    switch (page.kind) {
      case "list":
        return onNav(null);
      case "address":
        return onNav({ title: "Inbox address", back: up({ kind: "list" }) });
      case "notion":
        return onNav({ title: "Notion", back: up({ kind: "list" }) });
      case "add":
        return onNav({ title: "Add", back: up({ kind: "list" }) });
      case "new":
        return onNav({ title: KINDS[page.tokenKind].offer, back: up({ kind: "add" }) });
      case "key":
        return onNav({ title: keyName ?? "Apps & devices", back: up({ kind: "list" }) });
    }
  }, [page, keyName, onNav]);
  const back = <Back to="Apps & devices" onBack={toList} />;

  let body: ReactNode;
  switch (page.kind) {
    case "list":
      body = <AppsList go={go} />;
      break;
    case "address":
      body = (
        <>
          {back}
          <InboxAddressPane />
        </>
      );
      break;
    case "notion":
      body = (
        <>
          {back}
          <NotionPane />
        </>
      );
      break;
    case "add":
      body = <AddPage back={back} go={go} />;
      break;
    case "new":
      body = (
        <NewKeyPage
          tokenKind={page.tokenKind}
          onBack={() => go({ kind: "add" })}
          onCreated={(id, token) => {
            setFresh({ id, token });
            setPage({ kind: "key", id });
          }}
        />
      );
      break;
    case "key":
      body = <KeyPage id={page.id} back={back} fresh={fresh?.id === page.id ? fresh.token : null} onGone={toList} />;
      break;
  }
  // Each page is its own scroll position and its own entrance.
  return (
    <div key={page.kind === "key" ? page.id : page.kind} className="floor-enter">
      {body}
    </div>
  );
}

// ── The list ───────────────────────────────────────────────────────────────

function AppsList({ go }: { go: (p: Page) => void }) {
  const { data: connections = [], isLoading } = useConnections();
  const { data: notion } = useNotionSource();
  const { settings } = useSettings();
  const [showRevoked, setShowRevoked] = useState(false);

  const address = settings?.inbound_token
    ? inboundAddress(settings.inbound_token, liveInboundMailDomain() ?? import.meta.env.VITE_INBOUND_MAIL_DOMAIN)
    : null;
  const live = connections.filter((c) => !c.revoked_at);
  const revoked = connections.filter((c) => c.revoked_at);
  const inboxKeys = live.filter((c) => kindOf(c.scopes) === "inbox");
  const accountKeys = live.filter((c) => kindOf(c.scopes) === "account");
  const notionOn = notion ? notion.feeds.filter((f) => f.on).length : 0;

  const keyRow = (c: Connection) => {
    const account = kindOf(c.scopes) === "account";
    return (
      <LinkRow
        key={c.id}
        mark={<Mark icon={account ? "user" : "package"} />}
        title={c.name}
        desc={account && c.takes_handoffs ? `Takes hand-offs · ${usedLine(c)}` : `…${c.last_four ?? "····"} · ${usedLine(c)}`}
        onOpen={() => go({ kind: "key", id: c.id })}
      />
    );
  };

  return (
    <div>
      <PaneHeader title="Apps & devices" />

      <SectionHeader title="Inbox" className="set-group" />
      <div className="set-list">
        <LinkRow
          mark={<Mark icon="mail" />}
          title="Inbox address"
          desc={address ?? "Forward a mail; the subject becomes a task"}
          trailing={
            address ? (
              <Button kind="secondary" size="sm" className="tap" icon={<Icon name="copy" size={13} />} onClick={() => void copyText(address, "Address copied")}>
                Copy
              </Button>
            ) : undefined
          }
          onOpen={() => go({ kind: "address" })}
        />
        {notion && (
          <LinkRow
            mark={<Mark>N</Mark>}
            title="Notion"
            desc={[
              notion.account_name,
              notion.needs_reconnect
                ? "Paused — reconnect"
                : `${notionOn === 1 ? "1 database" : `${notionOn} databases`} · ${syncedAgo(notion.last_synced_at).toLowerCase()}`,
            ]
              .filter(Boolean)
              .join(" · ")}
            onOpen={() => go({ kind: "notion" })}
          />
        )}
        {inboxKeys.map(keyRow)}
      </div>

      {accountKeys.length > 0 && (
        <>
          <SectionHeader title="Full account" className="set-group" />
          <div className="set-list">{accountKeys.map(keyRow)}</div>
        </>
      )}

      <div className="set-list mt-6">
        <LinkRow mark={<Mark icon="plus" />} title="Add" desc={isLoading ? undefined : "An agent, a device, or Notion"} onOpen={() => go({ kind: "add" })} />
      </div>

      {revoked.length > 0 && (
        <>
          <SectionHeader
            title={`${revoked.length} revoked`}
            collapsed={!showRevoked}
            onToggle={() => setShowRevoked((v) => !v)}
            className="set-group"
          />
          {showRevoked && (
            <div className="set-list">
              {revoked.map((c) => (
                <div key={c.id} className="set-list-row" data-off="">
                  <span className="opacity-50">
                    <Mark icon={kindOf(c.scopes) === "account" ? "user" : "package"} />
                  </span>
                  <span className="set-list-main">
                    <span className="set-list-title">
                      {c.name}
                      {c.last_four && <> …{c.last_four}</>}
                    </span>
                    <span className="set-list-meta">Revoked {fmtDate(c.revoked_at!)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Add ────────────────────────────────────────────────────────────────────

function AddPage({ back, go }: { back: ReactNode; go: (p: Page) => void }) {
  const { data: notion } = useNotionSource();
  return (
    <div>
      {back}
      <PaneHeader title="Add" />
      <div className="set-list">
        {(["account", "inbox"] as const).map((k) => (
          <LinkRow
            key={k}
            mark={<Mark icon={KINDS[k].icon} />}
            title={KINDS[k].offer}
            desc={`${KINDS[k].label} · ${KINDS[k].can}`}
            onOpen={() => go({ kind: "new", tokenKind: k })}
          />
        ))}
        {!notion && (
          <LinkRow
            mark={<Mark>N</Mark>}
            title="Notion"
            desc="What's assigned to you lands in your inbox"
            onOpen={() => go({ kind: "notion" })}
          />
        )}
      </div>
    </div>
  );
}

function NewKeyPage({
  tokenKind,
  onBack,
  onCreated,
}: {
  tokenKind: TokenKind;
  onBack: () => void;
  onCreated: (id: string, token: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const meta = KINDS[tokenKind];

  const create = useMutation({
    mutationFn: async (label: string) => {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) throw new Error("Not signed in");
      const id = crypto.randomUUID();
      const token = mintToken();
      const { error } = await supabase.from("connections").insert({
        id,
        user_id: userId,
        app: machineKey(label),
        name: label.trim(),
        scopes: KIND_SCOPES[tokenKind],
        token_hash: await sha256Hex(token),
        last_four: token.slice(-4),
      });
      if (error) throw error;
      return { id, token };
    },
    onSuccess: async ({ id, token }) => {
      await qc.invalidateQueries({ queryKey: QK });
      onCreated(id, token);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = () => name.trim() && !create.isPending && create.mutate(name);

  return (
    <div>
      <Back to="Add" onBack={onBack} />
      <PaneHeader title={meta.offer} sub={`${meta.label} · ${meta.can}`} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={meta.placeholder}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          aria-label="Name this app or device"
          autoFocus
        />
        <Button kind="primary" size="md" className="tap shrink-0" disabled={!name.trim() || create.isPending} onClick={submit}>
          {create.isPending ? "Creating…" : "Create key"}
        </Button>
      </div>
    </div>
  );
}

// ── One key ────────────────────────────────────────────────────────────────

const SETUP: Record<TokenKind, string[]> = {
  account: [
    "In that app, add a custom connector. Not a team one.",
    "Paste the endpoint URL and Authorization: Bearer <key>.",
    "Skip any login card. This is a Bearer key, not OAuth.",
  ],
  inbox: ["POST to the capture endpoint with Authorization: Bearer <key>."],
};

function KeyPage({ id, back, fresh, onGone }: { id: string; back: ReactNode; fresh: string | null; onGone: () => void }) {
  const qc = useQueryClient();
  const { data: connections, isLoading } = useConnections();
  const c = connections?.find((x) => x.id === id);
  const [setupOpen, setSetupOpen] = useState(Boolean(fresh));

  const revoke = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("connections").update({ revoked_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`${c?.name ?? "Key"} revoked`);
      qc.invalidateQueries({ queryKey: QK });
      qc.invalidateQueries({ queryKey: HANDOFF_AGENTS_QK });
      onGone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!c) {
    return (
      <div>
        {back}
        {!isLoading && <p className="set-note">This key is gone</p>}
      </div>
    );
  }

  const kind = kindOf(c.scopes);
  const endpoint = edgeFunctionUrl(kind === "account" ? "mcp" : "capture");

  return (
    <div>
      {back}
      <PaneHeader
        title={c.name}
        sub={`${KINDS[kind].label} · …${c.last_four ?? "····"} · added ${fmtDate(c.created_at)} · ${usedLine(c)}`}
      />

      {fresh && (
        <div className="set-well">
          <div className="set-well-title">Copy the key now</div>
          <p className="set-note">Shown once. Treat it like a password; lose it and you revoke and add another.</p>
          <code className="block break-all rounded-[var(--r-ctl)] bg-[var(--raised)] p-3 text-caption shadow-[0_0_0_1px_var(--line-1)]" data-selectable>
            {fresh}
          </code>
          <div className="flex flex-wrap gap-2">
            <CopyBtn primary onClick={() => void copyText(fresh, "Key copied")}>
              Copy key
            </CopyBtn>
            {kind === "account" && (
              <CopyBtn onClick={() => void copyText(`URL: ${endpoint}\nAuthorization: Bearer ${fresh}`, "URL + key copied")}>
                Copy URL + key
              </CopyBtn>
            )}
          </div>
        </div>
      )}

      {kind === "account" && c.takes_handoffs !== undefined && <HandoffControls c={c} />}

      <SectionHeader title="Set up" collapsed={!setupOpen} onToggle={() => setSetupOpen((v) => !v)} className="set-group" />
      {setupOpen && (
        <div className="grid gap-2 pb-2">
          {kind === "account" && (
            <p className="set-note">
              Uses the same tools Nuvo does; destructive acts still ask first. The key is this account — never drop it into a
              team-wide connector.
            </p>
          )}
          <StepList steps={SETUP[kind]} />
          <div>
            <CopyBtn onClick={() => void copyText(endpoint, "Endpoint copied")}>Copy URL</CopyBtn>
          </div>
        </div>
      )}

      <div className="set-foot border-t border-[var(--line-1)] mt-4">
        <Button kind="danger" className="tap" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
          {revoke.isPending ? "Revoking…" : `Revoke ${c.name}`}
        </Button>
      </div>
    </div>
  );
}

/** A Full account token can be an agent you hand tasks to (D-250): the switch,
 *  and an optional doorbell that wakes it — a URL and a key (sealed on the
 *  server; never shown again). */
const hostOf = (raw: string) => {
  try {
    return new URL(raw).host;
  } catch {
    return raw;
  }
};

/** "6:39am" today, "Nov 18, 6:39am" before — said once, in the clock vocabulary. */
const whenShort = (d: Date) => {
  const t = clockAt(d);
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${t}`;
};

function HandoffControls({ c }: { c: Connection }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState(c.doorbell_url ?? "");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  // what the Ring button just heard, ahead of any real hand-off
  const [tested, setTested] = useState<{ at: Date; error: string | null } | null>(null);
  const hasKey = c.doorbell_key_version != null;
  const savedUrl = c.doorbell_url ?? "";
  const dirty = url.trim() !== savedUrl || key.trim() !== "";
  // The last real ring, from the hand-offs (rang_at · ring_error) — proof the doorbell works.
  const { data: lastRing } = useQuery({
    queryKey: ["doorbell-last", c.id],
    enabled: Boolean(c.takes_handoffs && savedUrl),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("handoffs")
        .select("rang_at, ring_error, created_at")
        .eq("connection_id", c.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) return null;
      const rows = (data ?? []) as { rang_at: string | null; ring_error: string | null; created_at: string }[];
      const r = rows.find((x) => x.rang_at || x.ring_error);
      return r ? { at: new Date(r.rang_at ?? r.created_at), error: r.rang_at ? null : r.ring_error } : null;
    },
  });
  const heard = tested && (!lastRing || tested.at > lastRing.at) ? tested : lastRing ?? null;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: QK });
    qc.invalidateQueries({ queryKey: HANDOFF_AGENTS_QK });
  };
  const toggle = async (next: boolean) => {
    const { error } = await supabase.from("connections").update({ takes_handoffs: next }).eq("id", c.id);
    if (error) toast.error(error.message);
    else toast.success(next ? `You can hand tasks to ${c.name}` : `${c.name} no longer takes hand-offs`);
    refresh();
  };
  const save = async () => {
    setBusy(true);
    try {
      await setDoorbell(c.id, url.trim(), key.trim() ? key.trim() : url.trim() ? null : "");
      setKey("");
      toast.success(url.trim() ? "Doorbell saved" : "Doorbell removed");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const ring = async () => {
    setBusy(true);
    try {
      const out = await ringDoorbell(c.id);
      setTested({ at: new Date(), error: out.rang ? null : String(out.error ?? "no answer") });
      if (out.rang) toast.success(`Rang ${c.name}`);
      else toast.error(`Didn't ring: ${String(out.error ?? "no answer")}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2 pt-2">
      <label className="flex min-h-[44px] items-center justify-between gap-3">
        <span className="text-body">Takes hand-offs</span>
        <Switch checked={Boolean(c.takes_handoffs)} onChange={(v) => void toggle(v)} label={`${c.name} takes hand-offs`} />
      </label>
      {c.takes_handoffs && (
        <>
          <p className="set-note">
            A doorbell wakes {c.name} the moment you hand it a task. Without one, it finds the work on its next check.
          </p>
          <TextInput
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Doorbell URL (optional) — https://…"
            aria-label={`${c.name} doorbell URL`}
          />
          <TextInput
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={hasKey ? "Key saved — paste a new one to replace it" : "Doorbell key (the Bearer value)"}
            aria-label={`${c.name} doorbell key`}
            type="password"
            autoComplete="off"
          />
          {savedUrl && !dirty && (
            <p className="set-note flex items-center gap-1.5" data-doorbell-state={heard?.error ? "failed" : heard ? "rang" : "set"}>
              <Icon name="check" size={14} />
              <span>
                {!hasKey
                  ? `Doorbell set for ${hostOf(savedUrl)} — no key`
                  : heard?.error
                    ? `Doorbell set — last ring failed ${whenShort(heard.at)}: ${heard.error}`
                    : heard
                      ? `Doorbell set — last rang ${whenShort(heard.at)}`
                      : `Doorbell set — not rung yet`}
              </span>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button kind="secondary" className="tap" disabled={busy || !dirty} onClick={() => void save()}>
              {savedUrl && !dirty ? "Saved" : "Save doorbell"}
            </Button>
            {c.doorbell_url && (
              <Button kind="ghost" className="tap" disabled={busy} onClick={() => void ring()}>
                Ring
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
