// Reads the cumulative changelog for the Settings → Desktop app "What's new"
// history. Primary source: public/changelog.json bundled at build time by
// scripts/assemble-changelog.mjs. Fallback: the public GitHub Releases API —
// works on localhost dev and any build where the bundled file is absent or
// empty. In-memory cache so the API is hit at most once per page session.

export interface ChangelogEntry {
  version: string;
  date: string;
  notes: string;
}

// Entries we render compactly (collapsed into a count) rather than calling out:
// the generic "nothing user-facing" line and empties.
const GENERIC = /^(✨\s*)?(minor improvements|a little polish|automated build from)/i;

export function isMinor(notes: string): boolean {
  const t = notes.trim();
  return !t || GENERIC.test(t);
}

const RELEASES_REPO = "phillipchan1/nuvo-releases";

let cache: ChangelogEntry[] | null = null;

/** Map a GitHub release object to a ChangelogEntry. */
function fromGitHubRelease(r: {
  tag_name: string;
  published_at?: string;
  created_at?: string;
  body?: string;
  draft?: boolean;
}): ChangelogEntry {
  return {
    version: (r.tag_name || "").replace(/^v/, ""),
    date: r.published_at || r.created_at || "",
    notes: (r.body || "").trim(),
  };
}

/** Fetch release history directly from the public GitHub Releases API. */
async function fetchFromGitHub(): Promise<ChangelogEntry[]> {
  const res = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=50`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "nuvo-web" },
  });
  if (!res.ok) return [];
  const arr = (await res.json()) as Parameters<typeof fromGitHubRelease>[0][];
  return arr.filter((r) => !r.draft).map(fromGitHubRelease);
}

export async function loadChangelog(): Promise<ChangelogEntry[]> {
  if (cache) return cache;

  // 1. Try the bundled JSON (desktop builds; web builds once GH_TOKEN is set).
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}changelog.json`, { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { versions?: ChangelogEntry[] };
      const versions = Array.isArray(data?.versions) ? data.versions : [];
      if (versions.length > 0) {
        return (cache = versions);
      }
      // Empty bundle — fall through to GitHub API below.
    }
  } catch {
    // fetch error — fall through
  }

  // 2. Fallback: live GitHub Releases API. Public repo, no auth required.
  try {
    cache = await fetchFromGitHub();
  } catch {
    cache = [];
  }
  return cache;
}
