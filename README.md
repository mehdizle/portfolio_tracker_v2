# Portfolio Tracker v2 (Casablanca / MAD)

A client-side Casablanca Stock Exchange portfolio tracker: positions with FIFO
cost basis, broker fees, capital-gains & dividend tax, a valuation/signal engine,
a fee-aware rebalance helper, a multi-year dividend calendar **and forecast**,
monthly expenses with savings pots, and a Moroccan salary calculator. It runs
**entirely in the browser** on `localStorage` — no server, no accounts. Your
transactions never leave the device. The only network calls are loading
Highcharts from its CDN and fetching two **same-origin, public-data** files the
site publishes (`prices.json`, `price-history.json`); price data is refreshed
by a scheduled GitHub Action, not by the browser.

Live site: https://mehdizle.github.io/portfolio_tracker_v2/

---

## Highlights

- **Tested, modular financial core** — all fee/tax/FIFO/forecast math lives in
  pure ES modules under `src/core/`, unit-tested with Vitest and gated in CI.
- **Integer-cents precision** — money is rounded to whole centimes at defined
  boundaries, eliminating floating-point drift.
- **CI test gate** — GitHub Actions runs the full test suite; a failing test
  blocks the build/deploy, so a financial-core regression can't reach production.
- **Optional encrypted backups** — AES-GCM (WebCrypto) with a password;
  plaintext stays the default.
- **Delegated event handling** — no inline `onclick`/`onerror`. Elements declare
  `data-act="fnName"` / `data-args="..."` and one document-level listener in
  `09-boot.js` dispatches them (CSP-friendly, CodeQL-clean).
- **Schema registries + consistency guards** — transaction / pending / master
  fields are declared once (`src/core/*-schema.js`) and drive CSV export/import,
  the forms, and the master-import mapping. A connection manifest
  (`src/core/connection-manifest.js`) + `test/connections.test.js` fail CI if a
  field loses its HTML input, a price-view isn't refreshed by `render()`, or a
  data-save doesn't refresh the KPI row — catching "added X but forgot to wire Y".
- **Signal engine** — a sector-weighted, missing-data-resilient composite score
  (valuation, quality, growth-blend, FCF yield, dividend, timing, peer-relative)
  with per-sector fair-value anchors and buy/sell targets, plus signal-outcome
  tracking that scores past Buy/Hold/Sell calls vs a same-date benchmark.
- **Automated daily prices (hands-off)** — a scheduled GitHub Action
  (`fetch-prices.yml` → `scripts/fetch-prices.mjs`) pulls Casablanca prices +
  fundamentals from TradingView's public scanner each weekday after close and
  commits two public files: `public/prices.json` (latest snapshot the "Fetch
  latest" button imports) and `public/price-history.json` (one dated row per
  trading day: every ticker's close + the MASI and MASI-20 index levels). No
  browser CORS wall (the fetch runs server-side in CI), no auth, no scraping.
- **Value-over-time curve + benchmark** — the "Portfolio Value Over Time" chart
  is **recomputed** in the browser from your LOCAL transaction ledger × the
  public daily price history (`src/core/value-history.js`), rebased to a 0%
  return axis so you can compare it against **MASI or MASI-20** (selectable). The
  curve is dense and gap-free regardless of when you last opened the app, and it
  needs no stored snapshots. Transactions stay local; only public prices live in
  the repo.
- **Value-vs-Diversification rebalance** — a persisted slider tilts the buy plan
  between sector-diversification and undervaluation; trims + greedy allocation
  are fee-aware and share the same cost engine as execution.
- **Per-order broker fees (split-aware)** — Attijari-style courtage has a
  per-order minimum. When one order fills in several executions, each fill is a
  separate transaction sharing an **Order ID**; the fee engine charges the
  courtage minimum once per order. Order ID is a real, persisted, CSV-round-tripped
  field (auto-assigned at pending creation).
- **Casablanca session tracker** — a "Market" button opens a live popup showing
  the current CSE phase (Group 1 continuous vs Group 3 fixing), what's passed and
  what's next, in Africa/Casablanca time regardless of the viewer's timezone.
- **Ticker logos (SVG + PNG, offline)** — every ticker shows a deterministic
  colored monogram; dropping a logo into `public/logos/` overrides it with a real
  one. No external calls.
- **Positions: group by sector + sector pie** — a Group/Ungroup toggle (sector
  header rows with per-sector totals) that persists, and a Dashboard sector pie.

---

## Dividends: calendar, smart import & forecast

The Dividends tab is the most feature-rich area.

- **Dividend calendar** (`casa_divcal_v1`) — per-event records:
  `ticker, issuer, amount (per share), ex_date, pay_date, div_type`.
- **Smart-merge import (upsert)** — importing the calendar **adds** new events,
  **updates** ones whose amount/date changed, and **never deletes** prior years.
  Identity is `ticker + ex-date + type`, so an **Ordinary and an Exceptional
  dividend on the same date are kept as two distinct events** (a common
  Casablanca pattern that the old identity silently dropped). Re-importing a
  corrected year is safe and idempotent — no duplicates. This replaced the old
  Replace/Append modes.
- **Multi-year forecast** (`src/core/dividend-forecast.js`) — a **reference
  estimate**, built per ticker from calendar history:
  - **Payment slots**: events are grouped by their ordinal position in the year
    (1st, 2nd, … payment), so a quarterly/semi-annual payer keeps each payment
    at its own month instead of collapsing into one blob.
  - **Level + gentle trend**: each slot projects the trailing-year average nudged
    by a trend clamped to ±10%/yr — robust to a one-off spike or dip on thin data.
  - **Only Ordinary dividends** feed the forecast (Exceptional = one-off).
  - **Current-year gap-fill**: for a past-paying ticker with no announced payment
    yet this year, the still-upcoming payments are forecast; already-passed or
    already-recorded payments are not re-injected.
  - **Split-inconsistency flag**: a ticker whose Ordinary/Exceptional split
    changes year-to-year (e.g. SALAFIN) gets a `⚠ split` badge, because its
    ordinary-only projection may look like a jump — an informational data hint.
  - The reference table shows history (recent years inline, older in a tooltip),
    projected per-share (with a per-slot calculation tooltip), method, a
    consistency chip, expected month(s), and **Est. Income net of dividend tax**
    on held shares (with a gross → fees → tax → net tooltip).
- **Dashboard KPIs** — "Income · next year" (next calendar year's total),
  "Received this year" (dynamic), "YTD Yield", and "Next-year Yield" feed off the
  same forecast; the Dashboard "Upcoming Dividends" card includes forecast
  fill-ins for the next 3 months.

---

## Architecture

```
index.html                 HTML shell. Loads Highcharts (CDN) + the Vite entry.
styles.css                 All styles (imported by the entry, fingerprinted by Vite).
public/                    Static files copied verbatim to the site root by Vite.
  logos/                   Optional per-ticker logos (SVG/PNG), by exchange or flat.
    CSEMA/                 Casablanca logos, e.g. CSEMA/ATW.svg.
  prices.json              Latest TradingView snapshot (public; committed by CI).
  price-history.json       Daily closes + MASI/MSI20 levels, one row/date (public; CI).
src/
  main.js                  Vite entry: imports css, core-bridge, then the UI bundle.
  core-bridge.js           Sets globalThis.__core BEFORE the UI bundle evaluates.
  core/                    *** PURE, TESTED CORE (ES modules, via __core) ***
    money.js               integer-cents rounding helpers
    fees.js                brokerage / PEA / OPCVM / VAT fee engine
    tax.js                 capital-gains + dividend tax, divRate
    fifo.js                computeRow + FIFO engine (uses money/fees/tax)
    config.js              fee/broker/tax default parameters
    backup-crypto.js       AES-GCM backup encryption (WebCrypto)
    txn-schema.js          transaction/pending field registry + CSV helpers
    master-schema.js       master-list import registry (TV + OPCVM) + calendar shape
    plan-apply.js          savings-pots recurring-cost -> log recompute (pure)
    connection-manifest.js declared field/render/save connections (CI-checked)
    sector-icon.js         sector -> icon mapping (distinct, tested)
    market-session.js      CSE trading-phase schedule/classify (pure logic)
    divcal-merge.js        dividend-calendar smart-merge (upsert) logic
    dividend-forecast.js   multi-year, slot-based dividend forecast
    value-history.js       recompute the value-over-time curve (ledger x price history)
  app-core.generated.js    UI bundle (git-ignored; produced by scripts/concat.mjs)
scripts/concat.mjs         Concatenates the js/ UI files into the UI bundle.
scripts/fetch-prices.mjs   CI price fetcher: TradingView -> prices.json + price-history.json
js/                        UI layer (rendering, forms, tabs). Delegates all
                           fee/tax/FIFO/forecast math to src/core via __core.
  01-core.js               globals, persistence, ticker badges, fee/tax wrappers
  02-compute.js            computeRow/runFIFO bridge to the core
  03-signals.js            valuation & signal engine (scores, fair value, targets)
  04-render.js             dashboard KPIs, positions (group-by-sector, badges), charts, sector pie
  05-rebalance.js          rebalance engine + stock detail panel
  06-features.js           signals render, dividends + forecast table, transactions
  06b-import.js            TradingView/OPCVM/CSV import, calendar smart-merge, fee panel
  06c-backup.js            backup/restore (APP_LS_KEYS), auto-dividends, value-over-time chart
  06d-pending.js           pending orders (Order IDs), indicators, range bar
  07-expenses.js           monthly expenses + savings pots (car/other planners)
  08-salary.js             salary calc, stock categories (import/export), cash ledger, tooltip engine
  09-boot.js               data-act delegator, ticker-logo fallback walk, market session, boot
test/                      Vitest suite (see "Tests" below)
  fixtures/synthetic.json  synthetic transactions/master/config for tests
.github/
  workflows/deploy.yml       test -> build -> deploy to GitHub Pages (self-healing lockfile)
  workflows/fetch-prices.yml weekday cron: fetch prices -> commit public JSON -> trigger deploy
  dependabot.yml             grouped weekly dependency PRs (npm + GitHub Actions)
```

### The core vs. UI split (why it's safe)

The financial math is implemented **once**, in `src/core/`, as pure functions
with no globals — so it is unit-testable. The large UI layer (`js/`) keeps its
original shared-scope structure, but its fee/tax/FIFO/forecast functions are thin
wrappers that call the core via `globalThis.__core` (populated by `core-bridge.js`
before the UI bundle runs). This gives a tested, single-source engine without
rewriting the UI's hundreds of call sites.

The `js/` files are concatenated into `src/app-core.generated.js` (git-ignored)
by `scripts/concat.mjs`, in the fixed order `01 → 09` (12 files including the
`06b/06c/06d` splits). **Edit the numbered source files, never the generated
bundle.**

---

## Automated price data (how it works)

Prices and the value-over-time curve are **hands-off** — you don't need to keep
the app open or paste anything.

1. **Fetch (server-side, weekdays).** `.github/workflows/fetch-prices.yml` runs
   on a cron (18:00 UTC, Mon–Fri, after the CSE close) and on demand from the
   Actions tab. It runs `scripts/fetch-prices.mjs`, which POSTs to TradingView's
   public scanner — the same request the `tradingview-screener` library makes,
   no auth, no scraping, and no browser CORS wall because it runs in CI.
2. **Commit two public files.** The script writes `public/prices.json` (the
   latest snapshot) and appends one dated row to `public/price-history.json`
   (every ticker's close + the MASI and MASI-20 levels, one row per trading day,
   capped at ~3 years). The workflow commits **both** and then dispatches
   `deploy.yml` (a `GITHUB_TOKEN` commit doesn't trigger other workflows'
   `push` events, so the deploy is triggered explicitly).
3. **The browser reads them.** The "Fetch latest" button in the Data tab imports
   `prices.json` through the **same** `applyTvRec` pipeline as a manual paste
   (so nulls are skipped and manual categories are never overwritten); manual
   paste remains the fallback if the file is missing/stale. The "Portfolio Value
   Over Time" chart reads `price-history.json` and recomputes your curve locally.

Because the curve is recomputed from the public daily history × your local
ledger, it is complete and gap-free no matter when you open the app, and it
starts collecting from the first day the fetch workflow ran (there is no
back-fill of dates before that). The benchmark line (MASI / MASI-20) needs **two
or more** dated rows before it can draw. GitHub pauses scheduled workflows after
~60 days of no repo activity, so a very long absence can stop collection until
the next push or manual run.

---

## Tests

Run with `npm test` (Vitest). A failing test blocks deploy.

```
core.test.js                 money, fees, tax, FIFO scenarios
reference.test.js            runs a backup through the core: consistency + totals snapshot
consistency.test.js          cross-path number locks (rebalance == execution, projected == recorded)
txn-roundtrip.test.js        transaction CSV export -> import preserves every field
pending-roundtrip.test.js    pending -> transaction carries every field
master-import.test.js        TradingView/OPCVM import field coverage
engine-improvements.test.js  FCF factor, growth blend, value-tilt, signal outcomes
plan-apply.test.js           savings-pots recurring-cost recompute (live core)
connections.test.js          connection-manifest checker + no-hardcoded-CSV-column guard
sector-icon.test.js          every sector maps to a distinct, non-default icon
market-session.test.js       CSE trading-phase boundary classification
divcal-merge.test.js         calendar upsert: add / update / keep old years / Ord+Exc same date
dividend-forecast.test.js    slots, level+trend, current-year gap-fill, split flag, tax-net income
value-history.test.js        holdings-as-of-date, value curve, carry-forward, rebased % vs benchmark
```

---

## Editing and deploying

You do **not** need Node locally — GitHub Actions builds and tests everything.

1. Edit a `js/0X-*.js` (UI) or `src/core/*.js` (math) file.
2. If you changed a `js/` file, regenerate the bundle (`npm run concat`) — or
   just let CI do it; the `build` step runs `concat` before Vite.
3. Commit / push to `main`.
4. Actions runs **tests first**; if they pass it builds and deploys to Pages.
   Watch the Actions tab, then hard-refresh (Ctrl+Shift+R).

### Dependencies & the self-healing lockfile

Dependencies are minimal: the app ships **zero runtime npm dependencies** (vanilla
JS + Highcharts via CDN). Dev tooling: **Vite** (build) and **Vitest** (tests).

- To bump a version, edit `package.json` and push. The CI install step runs
  `npm ci` (fast/strict) and, if the committed `package-lock.json` is out of sync
  with `package.json`, **falls back to `npm install` and commits the refreshed
  lockfile back**. So a version bump self-heals instead of failing the build.
- **Dependabot** opens one grouped PR per week for npm and one for GitHub Actions
  (majors included). CI runs on each PR, so you only merge if it stays green.

### Pinned versions

- Highcharts **13.0.2** (CDN, in `index.html`)
- Vite **8.3.x**, Vitest **5.0.x** (`package.json` devDependencies)
- Node **≥ 22.12.0** (required by Vitest 5; CI runs Node 22)

### One-time repo setup

- **Settings → Pages → Source = "GitHub Actions"**.
- If the web uploader hides the `.github/` dotfolder, use **Add file → Create new
  file** and type the full path (e.g. `.github/workflows/deploy.yml`).

---

## Local development (optional, needs Node ≥ 22.12)

```
npm install
npm test           # run the financial-core test suite (Vitest)
npm run test:watch
npm run dev        # concat + Vite dev server
npm run build      # concat + production build into dist/
```

---

## Encrypted backups

On **Backup**, leaving the password blank (or cancelling the prompt) produces a
normal unencrypted JSON backup. Entering a password produces an AES-GCM-encrypted
envelope; **restore** auto-detects it and asks for the password. There is no
password recovery — if you forget it, that backup cannot be restored. Encrypted
v2 backups are not readable by v1.

**What a backup contains (and doesn't).** A backup is deliberately kept to your
**private, non-reconstructable data**: transactions, pending orders, master list
(names/categories/ISIN and the _latest_ per-ticker price/fundamentals), dividend
calendar, fees/tax config, brokers, expenses, salary, cash, issuer aliases, and
theme. Two large, repo-derivable caches are **excluded** so the file stays small
and private-only:

- `casa_snapshots_v1` — the old value-over-time snapshot series. The value curve
  is now recomputed from the public daily price history, so it's redundant.
- `casa_signal_hist_v1` — the signal-call trail: one row per tracked ticker per
  day (engine rating + that day's public price), up to ~20k rows / a few MB. It's
  a computed cache of public data, reconstructable from the repo's daily price
  history going forward, so it doesn't belong in a personal backup.

Both stay in `localStorage` on your device (so on-device charts and signal
outcomes are unaffected); they're just not written into the export. On a fresh
device, the value curve and signal outcomes rebuild from the repo price history.
Restoring an **older** backup that still contains these keys simply repopulates
the caches — nothing breaks across versions.

---

## Ticker logos

Every ticker shows a small badge. By default it's a deterministic colored
monogram (initials on a stable per-ticker color) — always available, offline,
private. To show a real logo, drop a file into `public/logos/`:

- **SVG is preferred, PNG accepted.** For each ticker the badge tries, in order,
  the exchange subfolders in `LOGO_DIRS` (currently `CSEMA`) then the flat
  `logos/` root, **`.svg` before `.png`**. First match wins; if none exist, the
  monogram stays.
- File name = the ticker, uppercased, non-alphanumerics → `_`. Examples:
  `CSEMA/ATW.svg`, `CSEMA/ATJ_ACT.svg`, or flat `NKL.png`.
- Vite copies `public/` to the site root; served at
  `/portfolio_tracker_v2/logos/...`. There are **no external logo requests**.
- To add another market, add its folder name to `LOGO_DIRS` in `js/01-core.js`.

The fallback is delegated and CodeQL-safe: the `<img>` src is rebuilt from a
sanitized key + constant dir/extension tables (never from raw DOM text), and an
`error` listener walks the candidate list before revealing the monogram.

---

## Stock categories

Categories (sector / economic cycle / asset style) are entered manually, not from
TradingView, and feed the signal engine's peer sets and the rebalance
diversification. In **Data → Import Stock Categories** you can:

- **Export categories** — download your current categories as a CSV
  (`Ticker,Company Name,Category,Economic Cycle,Asset Style`), edit, and re-import.
  This doubles as the template.
- **Import** — a row updates that ticker's category/cycle/style; tickers not in
  the file keep their existing category.
- **Reset** — revert to the built-in default set.

---

## Data and privacy

All data is stored in the browser's `localStorage`. Unencrypted backups are plain
JSON — use encrypted backups if the file may leave your device.

**Nothing you enter is sent anywhere.** The app's only network calls are
outbound _reads_: Highcharts from its CDN, and two **same-origin, public** files
the site itself publishes (`prices.json`, `price-history.json`). It makes no
outbound request that carries your data. Those price files are produced by a
scheduled GitHub Action running server-side (`scripts/fetch-prices.mjs`) — the
browser only fetches the already-published result. The price history in the repo
is **public market data only** (closes + MASI/MSI20 index levels); it contains
no transactions and nothing personal. Your transactions exist solely in
`localStorage` and in backup files you download yourself.
