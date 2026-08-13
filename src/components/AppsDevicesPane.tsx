// Apps & devices — the bearer tokens that let something you own push into your
// inbox over HTTP (the Capture API, `supabase/functions/capture`).
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
import { supabase } from "../lib/supabase";
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

/** URL-safe, 43 chars of entropy from the platform CSPRNG. */
function mintToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Must match `sha256Hex` in supabase/functions/capture/index.ts exactly. */
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** "lead_well" from "Lead Well" — the machine key the capture payload reports
 *  as a task's `source` when it doesn't name one itself. */
const machineKey = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "app";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

export function AppsDevicesPane() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  // Held in memory only, and only until the user dismisses it. Never persisted,
  // never re-derivable — this is the one moment the token exists outside a hash.
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);

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
    mutationFn: async (label: string) => {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) throw new Error("Not signed in");
      const token = mintToken();
      const { error } = await supabase.from("connections").insert({
        user_id: userId,
        app: machineKey(label),
        name: label.trim(),
        scopes: ["inbox:write"],
        token_hash: await sha256Hex(token),
        last_four: token.slice(-4),
      });
      if (error) throw error;
      return { name: label.trim(), token };
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

  return (
    <div>
      <PaneHeader
        title="Apps & devices"
        sub="Give something you own a token so it can add to your inbox over HTTP — a shortcut, a widget, another app. Each token is shown once and can be revoked at any time."
      />

      <div className="max-w-2xl space-y-5">
        {/* Free text in, structure out — a token is named, not configured. */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What's holding it? — e.g. Apple Watch, iPhone shortcut"
            onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate(name)}
            aria-label="Name this app or device"
          />
          <Btn
            kind="primary"
            className="tap shrink-0"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate(name)}
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
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(fresh.token);
                    toast.success("Token copied");
                  } catch {
                    toast.error("Couldn't copy — select the token and copy it by hand");
                  }
                }}
              >
                Copy token
              </Btn>
              <Btn className="tap" onClick={() => setFresh(null)}>
                Done
              </Btn>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-caption text-muted">Loading…</div>
        ) : live.length === 0 ? (
          <p className="text-caption text-muted">
            No tokens yet. Nothing can write to your inbox over HTTP until you make one.
          </p>
        ) : (
          <div>
            {live.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3"
              >
                <div className="min-w-0">
                  <div className="text-caption font-medium text-ink">{c.name}</div>
                  <div className="text-label text-muted">
                    <span className="mono">…{c.last_four}</span> · added {fmtDate(c.created_at)} ·{" "}
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
            <summary className="tap cursor-pointer py-2">
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
