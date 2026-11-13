// Loading placeholder rows — the answer to "Inbox zero" flashing before the
// inbox has actually loaded. A pending query renders these; the empty-state
// copy is only ever shown once the query has resolved with zero rows.
export default function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden className="px-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex min-h-12 items-center gap-3 border-b border-[var(--line-1)]">
          <span className="shimmer h-5 w-5 shrink-0 rounded-full bg-[var(--sunk)]" />
          <span
            className="shimmer h-3.5 rounded-[var(--r-chip)] bg-[var(--sunk)]"
            style={{ width: `${[72, 55, 64][i % 3]}%` }}
          />
        </div>
      ))}
    </div>
  );
}
