// The floor's two rooms: the interpretive Standing (front door) and the Board
// (the full working surface). A pill, not an accordion — two rooms, not one
// taller one — so each gets the whole floor. Mirrors the Collection view toolbar.

const TABS = [
  { id: "standing", label: "Standing" },
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
    <div className="mb-6 inline-flex rounded-md border border-line p-0.5">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className="fast mono rounded-[5px] px-3 py-1 text-label"
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
