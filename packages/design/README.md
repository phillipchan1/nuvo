# `@nuvo/design`

Shared visual skin for the **app** and **marketing** site.

## Status

Stub. Tokens and grammar still live in the product today:

- Tokens / atmosphere / type: [`../../src/index.css`](../../src/index.css)
- Grammar: [`../../docs/design-language.md`](../../docs/design-language.md)

## Intent

When marketing needs the same CSS variables (or a trimmed subset), extract them here and import from both apps — do not copy-paste hex values into the marketing site.

Suggested eventual shape:

```text
packages/design/
  tokens.css      # :root / data-theme / data-palette variables
  atmosphere.css  # .atmosphere and related surfaces
  fonts.ts        # Fraunces + Jakarta imports (or CSS)
  index.css       # public entry
```

Until that extraction, marketing may temporarily `@import` a curated subset from the app, or duplicate **only** the Daybreak light palette with a comment pointing back here.
