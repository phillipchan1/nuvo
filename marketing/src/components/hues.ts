/**
 * Domain identity hues — the one place on this site a raw hex is right.
 *
 * A domain's colour *is* its identity in the product, so it can't be a semantic
 * token (`--accent` means intent; a domain means "this part of your life").
 * These were redeclared as local consts in five separate visuals, which is how
 * two of them drifted into calling the same hue different things. One list, so
 * every screen on the page reads as one product.
 *
 * Named after the domain *kinds* in docs/product/personas.md §1, not after any
 * one operator's domains — Principle 16.
 */

/** The paid work — job · company · practice · clients. */
export const WORK = '#2563EB'

/** The committed community — church · nonprofit board · coaching · volunteering. */
export const COMMUNITY = '#7C3AED'

/** The discipline / the body — training · health · a craft kept up. */
export const HEALTH = '#0D9488'

/** The relational — family · marriage · friendship. The one that starves quietly. */
export const FAMILY = '#DB2777'

/** The discipline as output — writing · trading · study · a craft that ships. */
export const CRAFT = '#B45309'

/** The stewardship — finances · home · admin. Invisible until it's expensive. */
export const MONEY = '#64748B'
