// The floor's two rooms: the interpretive Standing (front door) and the Board
// (the full working surface). A pill, not an accordion — two rooms, not one
// taller one — so each gets the whole floor. Mirrors the Collection view toolbar.

const TABS = [
  { id: "standing", label: "Readiness" },
  { id: "board", label: "Work" },
] as const;

export function StandingToggle({
  value,
  onChange,
}: {
  value: "standing" | "board";
  onChange: (v: "standing" | "board") => void;
}) {
  return (
    <div className="mb-6 inline-flex rounded-lg border border-line p-1">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className="fast rounded-md px-5 py-2 text-caption font-medium"
          style={{
            background: value === t.id ? "var(--accent)" : "transparent",
            color: value === t.id ? "#fff" : "var(--muted)",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
