// Your Reviews — the wall of weeks. Every sealed week is stored forever
// (weekly-review.md's "the archive is the product"); this is the one place you
// can actually browse them, rather than walking ‹ › one week at a time. Opens
// from inside the Week's Plan / Review door — deliberately not a nav
// destination (docs/weekly-review.md's 70/30 doctrine, revised D-070): the
// emblem gallery lives *behind* the one door, not beside it.

import { weekName, weekSpan } from "../../lib/week";
import { Icon } from "../Icon";
import { useWeekReviewList } from "../../hooks/useWeekReview";
import WeekEmblem from "./WeekEmblem";

export interface WeekArchiveGalleryProps {
  onSelectWeek: (weekISO: string) => void;
  onClose: () => void;
}

/** The grid, usable standalone inside either shell's own overlay chrome. */
export default function WeekArchiveGallery({ onSelectWeek, onClose }: WeekArchiveGalleryProps) {
  const { data: rows = [], isLoading } = useWeekReviewList();

  return (
    <div
      className="atmosphere fixed inset-0 z-[70] overflow-y-auto"
      style={{
        background: "color-mix(in srgb, var(--bg) 96%, transparent)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      <div className="mx-auto w-full max-w-3xl px-6 py-10 pb-28 md:px-10">
        <div className="mb-8 flex items-start gap-4 pt-safe">
          <div className="min-w-0 flex-1">
            <div className="section-label mb-1">The archive</div>
            <h1 className="masthead text-display leading-tight text-ink">Your Reviews</h1>
          </div>
          <button
            onClick={onClose}
            className="tap fast flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
            aria-label="Close"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        {isLoading ? null : rows.length === 0 ? (
          <p className="text-body text-muted">
            Your Reviews will collect here once a week ends — every one, stored for good.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
            {rows.map((row) => {
              const total = row.report.priorityTotal ?? 0;
              return (
                <button
                  key={row.id}
                  onClick={() => onSelectWeek(row.week_start)}
                  className="tap fast glass-lift flex min-h-[44px] flex-col items-center gap-2 rounded-2xl border border-line px-3 py-4 text-center hover:border-line-strong"
                >
                  <WeekEmblem spec={row.report.emblem} state="sealed" size={72} hideAmbient />
                  <div className="min-w-0 w-full">
                    <div className="truncate text-caption font-medium text-ink">{weekName(row.week_start)}</div>
                    <div className="truncate text-micro text-muted">{weekSpan(row.week_start)}</div>
                    {total > 0 && (
                      <div className="mt-0.5 truncate text-micro text-muted">
                        {row.report.landedCount} of {total} landed
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
