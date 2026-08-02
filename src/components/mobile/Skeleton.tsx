// Loading placeholder rows — the answer to "Inbox zero" flashing before the
// inbox has actually loaded. A pending query renders these; the empty-state
// copy is only ever shown once the query has resolved with zero rows.
export default function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden className="px-4 py-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-3">
          <span className="shimmer h-4 w-4 shrink-0 rounded bg-surface-2" />
          <span
            className="shimmer h-4 rounded bg-surface-2"
            style={{ width: `${[72, 55, 64][i % 3]}%` }}
          />
        </div>
      ))}
    </div>
  );
}
