/** Memory's mark: Nuvo's spark inside a ring — something kept (docs/memory.md §4.1). */
export function MemoryIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <circle cx="8" cy="8" r="6.4" />
      <path d="M8 4.1l.95 3 3 .95-3 .95L8 12l-.95-3-3-.95 3-.95z" fill="currentColor" stroke="none" />
    </svg>
  );
}
