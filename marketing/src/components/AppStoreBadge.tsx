import { APP_STORE_URL } from '../config'

type AppStoreBadgeProps = {
  className?: string
}

/** Official black US badge — do not alter artwork; padding is Apple's clear space. */
export function AppStoreBadge({ className = '' }: AppStoreBadgeProps) {
  return (
    <a
      href={APP_STORE_URL}
      className={`app-store-badge tap cta-app-store inline-flex shrink-0 items-center ${className}`}
    >
      <img
        src="/download-on-the-app-store.svg"
        alt="Download on the App Store"
        width={120}
        height={40}
        decoding="async"
      />
    </a>
  )
}
