// Planner "you are here" — the current week / quarter. Instrument spends
// `--signal` on NOW and only now (D-189), so the planners mark the present the
// way the Schedule marks today: the faintest ember down the column, an ember
// numeral in the header. The desktop decks draw it through styles/decks.css
// (`[data-now]`); the phone's deck reads these constants, so both shells agree.

/** The faint wash down the current week / quarter column. */
export const NOW_BAND = "color-mix(in srgb, var(--signal) 2.5%, transparent)";
/** The current column's top rule. */
export const NOW_BORDER = "1px solid color-mix(in srgb, var(--signal) 45%, transparent)";
/** The current column's title — ink, like its neighbours; the mark says now. */
export const NOW_INK = "var(--ink)";
/** The small mark beside "This week" / "This quarter". */
export const NOW_MARK = "var(--signal)";
