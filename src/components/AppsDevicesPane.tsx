// Apps & devices — the bearer tokens that let something you own talk to Nuvo
// over HTTP: the Capture API (`inbox:write`) and MCP (`account`).
//
// Deliberately NOT called "connections" in the UI even though the table is
// `connections`: the Settings section already uses that word for calendar
// accounts, and one word must not mean two things (Principle 11).
//
// The token is shown exactly once. We store `sha256(token)` and the last four
// characters — never the token — so a leaked database row cannot be replayed
// and this screen can never show a token again. That is the same reason
// revoking is a timestamp, not a delete: a revoked row still explains where a
// task came from.
//
// This pane is an inventory, not a tutorial. Wiring steps live behind
// Next steps so a specific teammate (Grok Bot, Cursor, …) is not the page.
// The forwarding address is Settings → Inbox address, not here.

import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase, supabaseAnonKey, supabaseUrl } from "../lib/supabase";
import { randomUrlSafeToken as mintToken, sha256Hex } from "../lib/webcrypto";
import { Icon, type IconName } from "./Icon";
import { PaneHeader, TextInput } from "./form";
import { Button, SectionHeader, Segmented } from "./kit";

interface Connection {
  id: string;
  app: string;
  name: string;
  scopes: string[];
  last_four: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const QK = ["connections"] as const;

type TokenKind = "inbox" | "account";

const KIND_SCOPES: Record<TokenKind, string[]> = {
  inbox: ["inbox:write"],
  account: ["account"],
};

const KINDS: {
  id: TokenKind;
  icon: IconName;
  label: string;
  hint: string;
}[] = [
  { id: "account", icon: "user", label: "Full account", hint: "A teammate that sees and acts" },
  { id: "inbox", icon: "package", label: "Inbox", hint: "A watch, shortcut, or app" },
];

function kindOf(scopes: string[]): TokenKind {
  return scopes.includes("account") ? "account" : "inbox";
}

function kindMeta(scopes: string[]) {
  return KINDS.find((k) => k.id === kindOf(scopes)) ?? KINDS[1];
}

/** "lead_well" from "Lead Well" — the machine key the capture payload reports
 *  as a task's `source` when it doesn't name one itself. */
const machineKey = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "app";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

function edgeEndpoint(fn: "mcp" | "capture"): string {
  const url = new URL(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/${fn}`);
  url.searchParams.set("apikey", supabaseAnonKey);
  return url.toString();
}

async function copyText(text: string, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(ok);
  } catch {
    toast.error("Couldn't copy — select it and copy it by hand");
  }
}

function Mark({ icon }: { icon: IconName; tone?: "accent" | "quiet" }) {
  return (
    <span aria-hidden className="set-acct-mark">
      <Icon name={icon} size={14} />
    </span>
  );
}

function CopyBtn({
  onClick,
  children,
  kind = "ghost",
}: {
  onClick: () => void;
  children: ReactNode;
  kind?: "primary" | "ghost";
}) {
  return (
    <Button kind={kind === "primary" ? "primary" : "secondary"} className="tap shrink-0" icon={<Icon name="copy" size={13} />} onClick={onClick}>
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

export function AppsDevicesPane() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TokenKind>("account");
  const stepsRef = useRef<HTMLDetailsElement>(null);
  // Held in memory only, and only until the user dismisses it. Never persisted,
  // never re-derivable — this is the one moment the token exists outside a hash.
  const [fresh, setFresh] = useState<{ name: string; token: string; kind: TokenKind } | null>(null);

  const { data: connections = [], isLoading } = useQuery({
    queryKey: QK,
    queryFn: async (): Promise<Connection[]> => {
      const { data, error } = await supabase
        .from("connections")
        .select("id, app, name, scopes, last_four, created_at, last_used_at, revoked_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Connection[];
    },
  });

  const create = useMutation({
    mutationFn: async ({ label, tokenKind }: { label: string; tokenKind: TokenKind }) => {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) throw new Error("Not signed in");
      const token = mintToken();
      const { error } = await supabase.from("connections").insert({
        user_id: userId,
        app: machineKey(label),
        name: label.trim(),
        scopes: KIND_SCOPES[tokenKind],
        token_hash: await sha256Hex(token),
        last_four: token.slice(-4),
      });
      if (error) throw error;
      return { name: label.trim(), token, kind: tokenKind };
    },
    onSuccess: (t) => {
      setFresh(t);
      setName("");
      if (stepsRef.current) stepsRef.current.open = true;
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("connections")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Token revoked");
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const live = connections.filter((c) => !c.revoked_at);
  const revoked = connections.filter((c) => c.revoked_at);
  const placeholder = kind === "account" ? "e.g. Cursor, Grok Bot" : "e.g. Apple Watch, shortcut";
  const mcpUrl = edgeEndpoint("mcp");
  const captureUrl = edgeEndpoint("capture");

  return (
    <div>
      <PaneHeader title="Apps & devices" />

      {isLoading ? (
        <p className="set-note">Loading…</p>
      ) : live.length === 0 ? (
        <div className="set-row">
          <Mark icon="package" />
          <span className="set-note flex-1">No keys yet</span>
        </div>
      ) : (
        <div className="set-list">
          {live.map((c) => {
            const meta = kindMeta(c.scopes);
            return (
              <div key={c.id} className="set-row">
                <Mark icon={meta.icon} />
                <div className="set-row-label">
                  <span className="set-row-title">{c.name}</span>
                  <div className="set-row-desc">
                    {meta.label}
                    {c.last_four && <> · …{c.last_four}</>}
                    {" · "}added {fmtDate(c.created_at)} · {c.last_used_at ? `used ${fmtDate(c.last_used_at)}` : "never used"}
                  </div>
                </div>
                <div className="set-row-ctl">
                  <Button kind="danger" className="tap" disabled={revoke.isPending} onClick={() => revoke.mutate(c.id)}>
                    Revoke
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SectionHeader title="New key" className="set-group" />
      <div className="grid gap-3">
        <Segmented
          label="What this token can do"
          value={kind}
          onChange={setKind}
          className="fm-seg self-start"
          options={KINDS.map((k) => ({ value: k.id, label: k.label, icon: <Icon name={k.icon} size={12} />, title: k.hint }))}
        />
        <p className="set-note">{KINDS.find((k) => k.id === kind)?.hint}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholder}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate({ label: name, tokenKind: kind })}
            aria-label="Name this app or device"
          />
          <Button
            kind="primary"
            size="md"
            className="tap shrink-0"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate({ label: name, tokenKind: kind })}
          >
            {create.isPending ? "Creating…" : "Create token"}
          </Button>
        </div>
      </div>

      {fresh && (
        <div className="set-well">
          <div className="set-well-title">Token for {fresh.name} — copy it now</div>
          <p className="set-note">Shown once. Treat it like a password; lose it and you revoke and mint another.</p>
          <code className="block break-all rounded-[var(--r-ctl)] bg-[var(--raised)] p-3 text-caption shadow-[0_0_0_1px_var(--line-1)]" data-selectable>
            {fresh.token}
          </code>
          <div className="flex flex-wrap gap-2">
            <CopyBtn kind="primary" onClick={() => void copyText(fresh.token, "Token copied")}>
              Copy token
            </CopyBtn>
            {fresh.kind === "account" && (
              <CopyBtn
                onClick={() =>
                  void copyText(`URL: ${mcpUrl}\nAuthorization: Bearer ${fresh.token}`, "URL + token copied")
                }
              >
                Copy URL + token
              </CopyBtn>
            )}
            <Button kind="ghost" className="tap" onClick={() => setFresh(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      <details ref={stepsRef} className="mt-4 border-t border-[var(--line-1)]">
        <summary className="tap-h flex min-h-[44px] items-center text-body font-medium text-ink">Next steps</summary>
        <div className="grid gap-5 pb-2">
          <div className="grid gap-2">
            <div className="set-row-title">Full account</div>
            <p className="set-note">
              A teammate — Grok Bot, Cursor, anything that speaks MCP — uses the same tools as ⌘J. Destructive acts still
              ask first. The token is this account; never drop it into a team-wide connector.
            </p>
            <StepList
              steps={[
                "Create a Full account token — shown once.",
                "In that app, add a custom connector. Not a team one.",
                "Paste the endpoint URL and Authorization: Bearer <token>.",
                "Skip any login card. This is a Bearer token, not OAuth.",
              ]}
            />
            <div>
              <CopyBtn onClick={() => void copyText(mcpUrl, "Endpoint copied")}>Copy URL</CopyBtn>
            </div>
          </div>

          <div className="grid gap-2">
            <div className="set-row-title">Inbox</div>
            <p className="set-note">A watch, shortcut, or app you own. It can add tasks. It cannot read your week.</p>
            <StepList
              steps={[
                "Create an Inbox token — shown once.",
                "POST to the capture endpoint with Authorization: Bearer <token>.",
              ]}
            />
            <div>
              <CopyBtn onClick={() => void copyText(captureUrl, "Endpoint copied")}>Copy URL</CopyBtn>
            </div>
          </div>
        </div>
      </details>

      {revoked.length > 0 && (
        <details className="border-t border-[var(--line-1)]">
          <summary className="tap-h flex min-h-[44px] items-center text-caption text-muted">{revoked.length} revoked</summary>
          <div className="set-list">
            {revoked.map((c) => {
              const meta = kindMeta(c.scopes);
              return (
                <div key={c.id} className="set-list-row" data-off="">
                  <span className="opacity-50">
                    <Mark icon={meta.icon} />
                  </span>
                  <span className="set-list-main">
                    <span className="set-list-title">
                      {c.name}
                      {c.last_four && <> …{c.last_four}</>}
                    </span>
                    <span className="set-list-meta">Revoked {fmtDate(c.revoked_at!)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
