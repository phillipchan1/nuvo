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

function Mark({
  icon,
  tone = "quiet",
}: {
  icon: IconName;
  tone?: "accent" | "quiet";
}) {
  return (
    <span
      aria-hidden
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
        tone === "accent" ? "bg-accent-soft text-accent" : "bg-surface-2 text-ink"
      }`}
    >
      <Icon name={icon} size={16} />
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
    <Btn kind={kind === "primary" ? "primary" : "ghost"} className="tap shrink-0" onClick={onClick}>
      <span className="inline-flex items-center gap-1.5">
        <Icon name="copy" size={13} />
        {children}
      </span>
    </Btn>
  );
}

function StepList({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((step, i) => (
        <li key={step} className="flex gap-2.5">
          <span
            aria-hidden
            className="mono mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-micro text-accent"
          >
            {i + 1}
          </span>
          <span className="text-caption leading-snug text-muted">{step}</span>
        </li>
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
      <PaneHeader
        title="Apps & devices"
        sub="A key for something you own — a teammate, a watch, a shortcut."
      />

      <div className="max-w-2xl space-y-5">
        {isLoading ? (
          <div className="text-caption text-muted">Loading…</div>
        ) : live.length === 0 ? (
          <div className="flex items-center gap-3 text-caption text-muted">
            <Mark icon="package" />
            <p>No keys yet. Mint one below.</p>
          </div>
        ) : (
          <div>
            <div className="section-label">Live keys</div>
            {live.map((c) => {
              const meta = kindMeta(c.scopes);
              const account = meta.id === "account";
              return (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center gap-3 border-b border-line py-3"
                >
                  <Mark icon={meta.icon} tone={account ? "accent" : "quiet"} />
                  <div className="min-w-0 flex-1">
                    <div className="text-caption font-medium text-ink">{c.name}</div>
                    <div className="text-label text-muted">
                      {meta.label}
                      {c.last_four && (
                        <>
                          {" · "}
                          <span className="mono">…{c.last_four}</span>
                        </>
                      )}
                    </div>
                    <div className="text-label text-muted">
                      Added {fmtDate(c.created_at)}
                      {" · "}
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
              );
            })}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row" role="radiogroup" aria-label="What this token can do">
          {KINDS.map((opt) => {
            const on = kind === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setKind(opt.id)}
                className={`tap flex min-h-[44px] flex-1 items-center gap-3 rounded-lg border px-3 py-2.5 text-left ${
                  on ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong"
                }`}
              >
                <Mark icon={opt.icon} tone={opt.id === "account" ? "accent" : "quiet"} />
                <div>
                  <div className="text-caption font-medium text-ink">{opt.label}</div>
                  <div className="text-label text-muted">{opt.hint}</div>
                </div>
              </button>
            );
          })}
        </div>

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
            <div className="flex items-center gap-3">
              <Mark
                icon={fresh.kind === "account" ? "user" : "package"}
                tone={fresh.kind === "account" ? "accent" : "quiet"}
              />
              <div className="text-caption font-medium">
                Token for {fresh.name} — copy it now
              </div>
            </div>
            <p className="text-label text-muted">
              Shown once. Treat it like a password; if you lose it, revoke and make another.
            </p>
            <div className="mono break-all rounded border border-line bg-bg p-3 text-label">
              {fresh.token}
            </div>
            <div className="flex flex-wrap gap-2">
              <CopyBtn kind="primary" onClick={() => void copyText(fresh.token, "Token copied")}>
                Copy token
              </CopyBtn>
              {fresh.kind === "account" && (
                <CopyBtn
                  onClick={() =>
                    void copyText(
                      `URL: ${mcpUrl}\nAuthorization: Bearer ${fresh.token}`,
                      "URL + token copied",
                    )
                  }
                >
                  Copy URL + token
                </CopyBtn>
              )}
              <Btn className="tap" onClick={() => setFresh(null)}>
                Done
              </Btn>
            </div>
          </div>
        )}

          <details ref={stepsRef} className="border-t border-line pt-1">
            <summary className="tap min-h-[44px] cursor-pointer py-2 text-caption font-medium text-ink">
              Next steps
            </summary>
          <div className="space-y-5 pb-2">
            <div className="flex gap-3">
              <Mark icon="user" tone="accent" />
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <div className="text-caption font-medium text-ink">Full account</div>
                  <p className="text-label leading-snug text-muted">
                    A teammate — Grok Bot, Cursor, anything that speaks MCP — uses the same tools as ⌘J.
                    Destructive acts still ask first. The token is this account; never drop it into a team-wide connector.
                  </p>
                </div>
                <StepList
                  steps={[
                    "Create a Full account token — shown once.",
                    "In that app, add a custom connector. Not a team one.",
                    "Paste the endpoint URL and Authorization: Bearer <token>.",
                    "Skip any login card. This is a Bearer token, not OAuth.",
                  ]}
                />
                <CopyBtn onClick={() => void copyText(mcpUrl, "Endpoint copied")}>
                  Copy URL
                </CopyBtn>
              </div>
            </div>

            <div className="flex gap-3">
              <Mark icon="package" />
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <div className="text-caption font-medium text-ink">Inbox</div>
                  <p className="text-label leading-snug text-muted">
                    A watch, shortcut, or app you own. It can add tasks. It cannot read your week.
                  </p>
                </div>
                <StepList
                  steps={[
                    "Create an Inbox token — shown once.",
                    "POST to the capture endpoint with Authorization: Bearer <token>.",
                  ]}
                />
                <CopyBtn onClick={() => void copyText(captureUrl, "Endpoint copied")}>
                  Copy URL
                </CopyBtn>
              </div>
            </div>
          </div>
        </details>

        {revoked.length > 0 && (
          <details className="text-label text-muted">
            <summary className="tap min-h-[44px] cursor-pointer py-2">
              {revoked.length} revoked
            </summary>
            <div className="mt-1">
              {revoked.map((c) => {
                const meta = kindMeta(c.scopes);
                return (
                  <div key={c.id} className="flex items-center gap-3 border-b border-line py-2">
                    <span className="opacity-40">
                      <Mark icon={meta.icon} />
                    </span>
                    <div>
                      <span className="text-ink/60">{c.name}</span>
                      {c.last_four && (
                        <>
                          {" "}
                          <span className="mono">…{c.last_four}</span>
                        </>
                      )}
                      {" · revoked "}
                      {fmtDate(c.revoked_at!)}
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
