import { useState } from "react";
import { toast } from "sonner";
import { Btn } from "./ui";
import { useActivitySource, useActivityActions } from "../hooks/useActivity";

// Guided fine-grained PAT — pre-fill the name/description GitHub *will* take via
// query params; the two it won't (repo access, permissions) become the checklist.
const PAT_URL =
  "https://github.com/settings/personal-access-tokens/new" +
  "?name=Nuvo&description=" +
  encodeURIComponent("Lets Nuvo read your merged pull requests as shipped work.");

export function GitHubConnect() {
  const { data: source, isLoading } = useActivitySource();
  const { connect, disconnect, refreshRepos } = useActivityActions();
  const [showForm, setShowForm] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const busy = connect.isPending;
  const privateCount = source?.repos.filter((r) => r.private).length ?? 0;

  const refresh = async () => {
    try {
      const { repos } = await refreshRepos.mutateAsync();
      toast.success(`${repos.length} repos visible`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't refresh.");
    }
  };

  const submit = async () => {
    const pat = token.trim();
    if (!pat || busy) return;
    setError(null);
    try {
      const { source: s } = await connect.mutateAsync(pat);
      setToken("");
      setShowForm(false);
      toast.success(`Connected as @${s.login}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect.");
    }
  };

  const remove = async () => {
    if (!source) return;
    try {
      await disconnect.mutateAsync(source.id);
      toast.success("GitHub disconnected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't disconnect.");
    }
  };

  void isLoading; // the card always shows; only the connected row depends on data

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink text-label font-semibold text-white">G</span>
        <span className="text-body font-medium">GitHub</span>
        <span className="text-label text-muted">merged pull requests → a project's shipped work</span>
      </div>

      {/* Connected ─────────────────────────────────────────── */}
      {source && (
        <div className="overflow-hidden rounded-lg border border-line">
          <div className="flex items-center gap-2 bg-surface-2 px-3 py-2">
            {source.avatar_url ? (
              <img src={source.avatar_url} alt="" className="h-6 w-6 shrink-0 rounded-md" />
            ) : (
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink text-label font-semibold text-white">
                G
              </span>
            )}
            <div className="min-w-0">
              <div className="text-body font-medium leading-tight">GitHub</div>
              <div className="mono truncate text-label text-muted">
                {source.login ? `@${source.login}` : "connected"}
              </div>
            </div>
            <span className="mono ml-1 rounded-full bg-accent-soft px-1.5 py-0.5 text-meta text-accent">
              {source.repos.length} repos · {privateCount} private
            </span>
            <div className="flex-1" />
            <Btn onClick={refresh} disabled={refreshRepos.isPending}>
              {refreshRepos.isPending ? "Refreshing…" : "Refresh"}
            </Btn>
            {source.needs_reconnect && (
              <Btn kind="signal" onClick={() => setShowForm(true)}>
                Reconnect
              </Btn>
            )}
            <Btn onClick={remove} disabled={disconnect.isPending}>
              Disconnect
            </Btn>
          </div>
          {privateCount === 0 ? (
            <p className="px-3 py-2 text-label text-signal">
              No private repos visible — your token has public-only access. To track a private repo, edit the
              token on GitHub (Repository access → All / Only select), then hit Refresh.
            </p>
          ) : (
            <p className="px-3 py-2 text-label text-muted">
              Bind a repo to a project from the project's screen — “Track activity from…”. Re-scoped the token?
              hit Refresh.
            </p>
          )}
        </div>
      )}

      {/* Connect button ───────────────────────────────────── */}
      {!source && !showForm && (
        <Btn kind="primary" onClick={() => setShowForm(true)}>
          Connect GitHub
        </Btn>
      )}

      {/* Guided token ─────────────────────────────────────── */}
      {showForm && (
        <div className="space-y-2.5 rounded-lg border border-line bg-surface-2 p-3">
          <div className="text-caption font-medium">Create a token</div>
          <ol className="space-y-1.5 text-label text-muted">
            <li className="flex gap-2">
              <span className="mono text-muted">1</span>
              <span>
                <a
                  href={PAT_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent underline-offset-2 hover:underline"
                >
                  Open GitHub ↗
                </a>{" "}
                — name &amp; description are pre-filled.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mono text-muted">2</span>
              <span>
                Repository access → <span className="text-ink">All repositories</span> (or Only select — and add
                the ones you want, <span className="text-ink">including private</span>). Not “Public
                repositories” — that hides private repos.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mono text-muted">3</span>
              <span>
                Permissions → <span className="text-ink">Pull requests: Read-only</span>.
              </span>
            </li>
          </ol>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="github_pat_…"
            className="mono w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-label outline-none focus:border-accent"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          {error && <div className="text-label text-signal">{error}</div>}
          <div className="flex gap-2">
            <Btn kind="primary" disabled={busy || !token.trim()} onClick={submit}>
              {busy ? "Connecting…" : "Connect"}
            </Btn>
            <Btn
              disabled={busy}
              onClick={() => {
                setShowForm(false);
                setError(null);
                setToken("");
              }}
            >
              Cancel
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}
