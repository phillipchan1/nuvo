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

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase, supabaseAnonKey, supabaseUrl } from "../lib/supabase";
import { randomUrlSafeToken as mintToken, sha256Hex } from "../lib/webcrypto";
import { PaneHeader, TextInput } from "./form";
import { Btn } from "./ui";

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

function kindOf(scopes: string[]): TokenKind {
  return scopes.includes("account") ? "account" : "inbox";
}

function kindLabel(scopes: string[]): string {
  return kindOf(scopes) === "account" ? "Full account" : "Inbox";
}


/** "lead_well" from "Lead Well" — the machine key the capture payload reports
 *  as a task's `source` when it doesn't name one itself. */
const machineKey = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "app";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

function mcpEndpoint(): string {
  const url = new URL(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/mcp`);
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

export function AppsDevicesPane() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TokenKind>("account");
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
  const placeholder = kind === "account" ? "e.g. Grok Bot" : "e.g. Apple Watch, iPhone shortcut";

  return (
    <div>
      <PaneHeader
        title="Apps & devices"
        sub="A key to this signed-in account. A shortcut can drop into your inbox. A teammate like Grok Bot can see your week and act on it — as you, never as Nuvo placing the day."
      />

      <div className="max-w-2xl space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row" role="radiogroup" aria-label="What this token can do">
          {([
            { id: "account" as const, label: "Full account", hint: "A teammate that can see and act on your funnel" },
            { id: "inbox" as const, label: "Inbox", hint: "Add tasks over HTTP — watch, shortcut, another app" },
          ]).map((opt) => {
            const on = kind === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setKind(opt.id)}
                className={`tap min-h-[44px] flex-1 rounded-lg border px-3 py-2.5 text-left ${
                  on ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong"
                }`}
              >
                <div className="text-caption font-medium text-ink">{opt.label}</div>
                <div className="text-label text-muted">{opt.hint}</div>
              </button>
            );
          })}
        </div>

        {kind === "account" ? (
          <div className="space-y-3">
            <p className="text-caption leading-snug text-ink">
              Grok Bot (or any MCP teammate) reads your domains, projects, week, and calendar,
              and writes through the same acts as ⌘J. Destructive calendar acts still ask first.
              It does not auto-schedule your day.
            </p>
            <p className="text-caption leading-snug text-muted">
              The URL is Nuvo. The token is <span className="text-ink">you</span> — this
              signed-in account only. Anyone who holds the token acts as you. Never drop it
              into a team-wide connector; every person mints their own.
            </p>
            <div className="section-label">Wire Grok Bot</div>
            <ol className="space-y-2 text-caption leading-snug text-muted">
              <li>1. Name it below and create the token — shown once.</li>
              <li>2. In Grok Bot, add a custom connector (not a team one).</li>
              <li>
                3. URL +{" "}
                <span className="mono text-ink">Authorization: Bearer &lt;token&gt;</span>
              </li>
              <li>4. Skip any login card. This is a Bearer token, not OAuth.</li>
            </ol>
            <div className="mono break-all text-label text-muted">{mcpEndpoint()}</div>
          </div>
        ) : (
          <p className="text-caption leading-snug text-muted">
            A key that can add to your inbox over HTTP — a watch, a shortcut, another app
            you own. It cannot read your week or change a project.
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholder}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate({ label: name, tokenKind: kind })}
            aria-label="Name this app or device"
          />
          <Btn
            kind="primary"
            className="tap shrink-0"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate({ label: name, tokenKind: kind })}
          >
            {create.isPending ? "Creating…" : "Create token"}
          </Btn>
        </div>

        {fresh && (
          <div className="space-y-3 rounded-lg border border-line bg-surface-2 p-4">
            <div className="text-caption font-medium">
              Token for {fresh.name} — copy it now
            </div>
            <p className="text-label text-muted">
              This is the only time it's shown. Nuvo stores a one-way hash, so it can't be
              displayed again. Treat it like a password; if you lose it, revoke and make another.
            </p>
            <div className="mono break-all rounded border border-line bg-bg p-3 text-label">
              {fresh.token}
            </div>
            <div className="flex flex-wrap gap-2">
              <Btn
                kind="primary"
                className="tap"
                onClick={() => void copyText(fresh.token, "Token copied")}
              >
                Copy token
              </Btn>
              {fresh.kind === "account" && (
                <Btn
                  className="tap"
                  onClick={() =>
                    void copyText(
                      `URL: ${mcpEndpoint()}\nAuthorization: Bearer ${fresh.token}`,
                      "URL + token copied",
                    )
                  }
                >
                  Copy URL + token
                </Btn>
              )}
              <Btn className="tap" onClick={() => setFresh(null)}>
                Done
              </Btn>
            </div>
            {fresh.kind === "account" && (
              <p className="text-label text-muted">
                Paste that block into Grok Bot as a custom connector. Skip the login card.
              </p>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="text-caption text-muted">Loading…</div>
        ) : live.length === 0 ? (
          <p className="text-caption text-muted">
            No tokens yet. Nothing can talk to this account over HTTP until you make one.
          </p>
        ) : (
          <div>
            <div className="section-label">Live keys</div>
            {live.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3"
              >
                <div className="min-w-0">
                  <div className="text-caption font-medium text-ink">{c.name}</div>
                  <div className="text-label text-muted">
                    {kindLabel(c.scopes)} · <span className="mono">…{c.last_four}</span> · added {fmtDate(c.created_at)} ·{" "}
                    {c.last_used_at ? `last used ${fmtDate(c.last_used_at)}` : "never used"}
                  </div>
                </div>
                <Btn
                  className="tap shrink-0"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(c.id)}
                >
                  Revoke
                </Btn>
              </div>
            ))}
          </div>
        )}

        {revoked.length > 0 && (
          <details className="text-label text-muted">
            <summary className="tap min-h-[44px] cursor-pointer py-2">
              {revoked.length} revoked
            </summary>
            <div className="mt-1">
              {revoked.map((c) => (
                <div key={c.id} className="border-b border-line py-2">
                  <span className="text-ink/60">{c.name}</span>{" "}
                  <span className="mono">…{c.last_four}</span> · revoked{" "}
                  {fmtDate(c.revoked_at!)}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
