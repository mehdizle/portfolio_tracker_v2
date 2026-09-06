# Ticker logos (optional)

Drop an **SVG or PNG** here named after the ticker to show a real logo instead
of the auto-generated colored monogram. The file name is the ticker, uppercased,
with any non-alphanumeric character replaced by `_`.

## Where to put them

Logos can be organized by **exchange subfolder** or dropped **flat**:

- `logos/CSEMA/ATW.svg` — sorted by exchange (Casablanca), or
- `logos/ATW.svg` — flat at the root

For each ticker the badge searches, in order: the exchange subfolders listed in
`LOGO_DIRS` (currently `CSEMA`), then the flat `logos/` root — trying **`.svg`
before `.png`** in each. The first match wins; if none exist, the monogram is
used. To add another market, add its folder name to `LOGO_DIRS` in
`js/01-core.js`.

## Naming

Examples:

- `NKL` → `CSEMA/NKL.svg` (or `NKL.png`, or flat `NKL.svg`)
- `ATJ ACT` → `CSEMA/ATJ_ACT.svg`
- `FCP B` → `CSEMA/FCP_B.svg`

Recommendation: a square-ish, self-contained SVG, or a ~64×64 to 128×128 PNG
with a transparent or white background. It is displayed inside a small rounded
badge (contain-fit on white).

If no file is present for a ticker, the app falls back to a deterministic
colored monogram (the ticker's initials on a stable color) — so every holding
always has a badge, with zero external calls and full offline support.

This folder lives under Vite's `public/` dir, so its contents are copied to the
site root at build time and served at `/portfolio_tracker_v2/logos/...`.
