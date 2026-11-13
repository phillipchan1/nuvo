// Your Reviews — the archive of weeks, on the List layout (D-190). Every sealed
// week is stored forever (weekly-review.md's "the archive is the product"); this
// is the one place you can browse them, rather than walking ‹ › one week at a
// time. Opens from inside the Week's Plan / Review door — deliberately not a nav
// destination (docs/weekly-review.md's 70/30 doctrine, revised D-070): the
// archive lives *behind* the one door, not beside it.
//
// No hero: the bar names it. Weeks are rows grouped by year on --sunk — the
// week's sealed emblem leading, its name, its span, what landed — newest first.

import { weekName, weekSpan } from "../../lib/week";
import { Icon } from "../Icon";
import { useWeekReviewList } from "../../hooks/useWeekReview";
import WeekEmblem from "./WeekEmblem";
import { EmptyState, IconButton, PageBar } from "../kit";

export interface WeekArchiveGalleryProps {
  onSelectWeek: (weekISO: string) => void;
  onClose: () => void;
}

/** The list, usable standalone inside either shell's own overlay chrome. */
export default function WeekArchiveGallery({ onSelectWeek, onClose }: WeekArchiveGalleryProps) {
  const { data: rows = [], isLoading } = useWeekReviewList();

  // newest first, grouped by the year the week starts in
  const years: { year: string; rows: typeof rows }[] = [];
  for (const row of rows) {
    const y = row.week_start.slice(0, 4);
    const g = years.find((x) => x.year === y);
    if (g) g.rows.push(row);
    else years.push({ year: y, rows: [row] });
  }

  return (
    <div className="fl-archive" role="dialog" aria-label="Your Reviews">
      <div className="pt-safe">
        <PageBar
          icon={<Icon name="calendar" size={16} />}
          trail={["Your Reviews"]}
          actions={<IconButton className="tap" label="Close" icon={<Icon name="close" size={14} />} onClick={onClose} />}
        />
      </div>

      <div className="fl-archive-body pb-safe">
        {isLoading ? null : rows.length === 0 ? (
          <EmptyState>No reviews yet</EmptyState>
        ) : (
          years.map((g) => (
            <div key={g.year} role="group" aria-label={g.year}>
              <div className="fl-grp">
                <span>{g.year}</span>
                <span className="k-count">{g.rows.length}</span>
              </div>
              {g.rows.map((row) => {
                const total = row.report.priorityTotal ?? 0;
                return (
                  <button key={row.id} type="button" className="fl-archive-row" onClick={() => onSelectWeek(row.week_start)}>
                    <WeekEmblem spec={row.report.emblem} state="sealed" size={28} hideAmbient />
                    <span className="min-w-0 flex-1 truncate">{weekName(row.week_start)}</span>
                    <span className="fl-cell">{weekSpan(row.week_start)}</span>
                    <span className="fl-cell hidden sm:block" style={{ width: 96, textAlign: "right" }}>
                      {total > 0 ? `${row.report.landedCount} of ${total} landed` : "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
