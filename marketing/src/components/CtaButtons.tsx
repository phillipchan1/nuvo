import { useCallback, useState } from 'react'
import { APP_URL, DOWNLOAD_MAC_URL, RELEASES_REPO } from '../config'
import { appUrlWithCode } from '../referral'
import { AppStoreBadge } from './AppStoreBadge'

// "Download for Mac" resolves to the exact latest DMG on hover/focus (the GitHub
// Releases API is CORS-enabled), rewriting href to the asset's direct URL for an
// instant download. The static releases/latest/download/Nuvo.dmg link is the
// safety net when JS is off or the API is unreachable.
export function DownloadMacButton({ className = '' }: { className?: string }) {
  const [href, setHref] = useState(DOWNLOAD_MAC_URL)
  const [resolved, setResolved] = useState(false)

  const resolve = useCallback(() => {
    if (resolved) return
    setResolved(true)
    fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const assets: { name?: string; browser_download_url?: string }[] = data?.assets ?? []
        const dmg = assets.find((a) => /\.dmg$/i.test(a.name ?? ''))
        if (dmg?.browser_download_url) setHref(dmg.browser_download_url)
      })
      .catch(() => {
        /* keep the static href */
      })
  }, [resolved])

  return (
    <a
      href={href}
      onPointerEnter={resolve}
      onFocus={resolve}
      className={`btn-ghost tap cta-mac-download inline-flex items-center gap-2 ${className}`}
    >
      <svg width="15" height="15" viewBox="0 0 384 512" fill="currentColor" aria-hidden="true">
        <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
      </svg>
      Download for Mac
    </a>
  )
}

/** Start free is primary on desktop; App Store leads on iOS (see index.css + data-ios). */
export function CtaGroup({ className = '' }: { className?: string }) {
  return (
    <div className={`cta-row flex flex-wrap items-center gap-3 ${className}`}>
      <a
        href={appUrlWithCode(APP_URL)}
        className="btn-primary tap cta-start-free"
        rel="noopener noreferrer"
      >
        Start free
      </a>
      <DownloadMacButton />
      <AppStoreBadge />
    </div>
  )
}

export function NavOpenAppCtas() {
  return (
    <div className="nav-cta-row flex shrink-0 items-center gap-3">
      <AppStoreBadge />
      <a
        href={appUrlWithCode(APP_URL)}
        className="btn-ghost tap cta-open-app max-sm:hidden text-[13px] sm:inline-flex"
        rel="noopener noreferrer"
      >
        Open app
      </a>
    </div>
  )
}
