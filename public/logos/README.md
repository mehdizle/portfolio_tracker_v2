# Ticker logos

Each ticker shows a real logo when one is present here, otherwise a
deterministic colored monogram (the ticker's initials on a stable color). The
logos in `CSEMA/` are **kept up to date automatically** by a monthly GitHub
Action; you can also drop in your own file to override.

## Automated refresh (hands-off, monthly)

`.github/workflows/fetch-logos.yml` runs `scripts/fetch-logos.mjs` on a monthly
cron (03:17 UTC on the 1st, and on demand from the Actions tab). It:

1. POSTs to TradingView's public scanner for the Casablanca market, reading each
   ticker's `logoid` (the same no-auth request `scripts/fetch-prices.mjs` uses —
   it runs **server-side in CI**, so there is no browser CORS wall).
2. Downloads each vector logo from TradingView's public CDN
   (`https://s3-symbol-logo.tradingview.com/<logoid>.svg`) and writes
   `public/logos/CSEMA/<KEY>.svg`.
3. **Overwrites only when the SVG content changed** (so a brand refresh or a
   corrected logo is picked up, with no empty-diff commit churn), and **never
   deletes** a logo it couldn't refresh (the last good file is kept). If any
   logos changed it commits them and dispatches `deploy.yml` to republish.

`KEY` is the ticker uppercased with non-alphanumerics collapsed to `_`
(identical to `_tickerLogoKey` in `js/01-core.js`), e.g. `ATW.svg`,
`ATJ_ACT.svg`. TradingView lists SSOT as `SOT`, so the fetcher maps it back via
`TV_TICKER_ALIAS = { SOT: "SSOT" }` (mirroring the importer). Only `.svg` is
fetched — TradingView serves `.svg` publicly (`.png` is 403), and SVG is what
the badge prefers anyway. OPCVM funds are not on TradingView, so their logos are
never auto-fetched; add those manually (see below).

**Nothing in the browser calls TradingView.** The refresh is entirely a CI job;
the app only ever loads the already-committed, same-origin files under
`public/logos/`.

## Adding or overriding a logo manually

Drop an **SVG (preferred) or PNG** here named after the ticker; it overrides the
auto-fetched file. Logos can be organized by **exchange subfolder** or dropped
**flat**:

- `logos/CSEMA/ATW.svg` — sorted by exchange (Casablanca), or
- `logos/ATW.svg` — flat at the root

For each ticker the badge searches, in order: the exchange subfolders listed in
`LOGO_DIRS` (currently `CSEMA`), then the flat `logos/` root — trying **`.svg`
before `.png`** in each. The first match wins; if none exist, the monogram is
used. To add another market, add its folder name to `LOGO_DIRS` in
`js/01-core.js`.

The badge tries, per ticker: `CSEMA/<KEY>.svg` → `CSEMA/<KEY>.png` →
flat `<KEY>.svg` → flat `<KEY>.png`, first match wins. So a `CSEMA/<KEY>.svg`
always takes precedence. Note the monthly fetcher **owns `CSEMA/<KEY>.svg`** for
every ticker it can resolve on TradingView: if you edit one of those by hand, the
next run will overwrite it whenever TradingView's SVG differs. It only ever
writes `CSEMA/<KEY>.svg`, so files it never manages are safe to hand-maintain:
OPCVM **funds** (not listed on TradingView), any **flat-root** or **`.png`**
drop-in, and tickers on markets other than CSEMA.

## Naming

The file name is the ticker, uppercased, with any non-alphanumeric character
replaced by `_`. Examples:

- `NKL` → `CSEMA/NKL.svg` (or `NKL.png`, or flat `NKL.svg`)
- `ATJ ACT` → `CSEMA/ATJ_ACT.svg`
- `FCP B` → `CSEMA/FCP_B.svg`

Recommendation: a square-ish, self-contained SVG, or a ~64×64 to 128×128 PNG
with a transparent or white background. It is displayed inside a small rounded
badge (contain-fit on white).

If no file is present for a ticker, the app falls back to a deterministic
colored monogram (the ticker's initials on a stable color) — so every holding
always has a badge, with zero external calls from the browser and full offline
support.

This folder lives under Vite's `public/` dir, so its contents are copied to the
site root at build time and served at `/portfolio_tracker_v2/logos/...`.

The fallback is delegated and CodeQL-safe: the `<img>` src is rebuilt from a
sanitized key + constant dir/extension tables (never from raw DOM text), and an
`error` listener walks the candidate list before revealing the monogram.
