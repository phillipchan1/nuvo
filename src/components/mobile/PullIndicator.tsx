// The pull-to-refresh spinner — a small floating pill that fades/rotates in as
// the pull arms and spins while the refetch runs. Render inside a `relative`
// container at the top of the pulled surface.
export default function PullIndicator({
  pulling,
  refreshing,
}: {
  pulling: number;
  refreshing: boolean;
}) {
  if (!refreshing && pulling <= 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center" aria-hidden>
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-head text-muted shadow-sm ${
          refreshing ? "animate-spin" : ""
        }`}
        style={
          refreshing
            ? undefined
            : { transform: `rotate(${pulling * 270}deg)`, opacity: 0.3 + pulling * 0.7 }
        }
      >
        ↻
      </span>
    </div>
  );
}
