# Portfolio Tracker v2 (Casablanca / MAD)

Client-side Casablanca Stock Exchange portfolio tracker (positions, FIFO cost
basis, tax, valuation signals, rebalancing, dividends, expenses, salary). Runs
entirely in the browser on localStorage. Beyond the original feature set it adds:

- **Tested, modular financial core** - fee/tax/FIFO math lives in pure ES modules
  under `src/core/`, unit-tested with Vitest in CI.
- **Integer-cents precision** - money is rounded to whole centimes at defined
  boundaries, eliminating floating-point drift.
- **CI test gate** - GitHub Actions runs the test suite; a failing test blocks the
  deploy, so a financial-core regression can't reach production.
- **Optional encrypted backups** - AES-GCM (WebCrypto) with a password; plaintext
  stays the default.
- **Delegated event handling** - all UI interactions use a single `data-act`
  event delegator (modern, CSP-friendly). There are no inline `onclick`
  handlers; elements declare `data-act="fnName"` / `data-args="..."` and one
  document-level listener in `09-boot.js` dispatches them.
- **Schema registries + consistency guards** - transaction / pending / master
  fields are declared once (`src/core/*-schema.js`) and drive CSV export/import,
  the pending form, and the master-import mapping. A connection manifest
  (`src/core/connection-manifest.js`) + `test/connections.test.js` fail CI if a
  field loses its HTML input, a price-view isn't refreshed by `render()`, or a
  data-save doesn't refresh the KPI row - so "added X but forgot to wire Y" bugs
  are caught before deploy.
- **Signal engine** - a sector-weighted, missing-data-resilient composite score
  (valuation, quality, growth-blend, FCF yield, dividend, timing, peer-relative)
  with per-sector fair-value anchors and buy/sell targets, plus signal-outcome
  tracking that scores past Buy/Hold/Sell calls vs a same-date benchmark.
- **Value-vs-Diversification rebalance** - a persisted slider tilts the buy plan
  between sector-diversification and undervaluation; trims + greedy allocation
  are fee-aware and delegate cost estimation to the same core as execution.
- **Per-order broker fees (split-aware)** - Attijari-style courtage has a
  per-order minimum. When one order fills in several executions, each fill is a
  separate transaction sharing an **Order ID**; the fee engine charges the
  courtage minimum once per order (largest fill absorbs the remainder), matching
  the broker statement. Order ID is a real, persisted, CSV-round-tripped field
  (auto-assigned at pending creation, e.g. `ID1`, `ID2`), and orders can also be
  grouped by a date window for legacy fills that predate it.
- **Casablanca session tracker** - a far-right "Market" button opens a live
  popup showing the current CSE phase (pre-open / opening auction / continuous /
  closing auction / trading-at-last for Group 1; accumulation / fixing /
  post-fixing for Group 3), what's passed and what's next, in Africa/Casablanca
  time regardless of the viewer's timezone.
- **Ticker badges** - every ticker shows a deterministic colored monogram
  (initials on a stable per-ticker color); dropping a PNG into `public/logos/`
  (named by ticker) overrides it with a real logo. No external calls - offline
  and private; a delegated load listener swaps the logo in only if it loads.
- **Positions: group by sector + sector pie** - the Positions tab has a
  Group/Ungroup toggle (sector header rows with per-sector totals + icons), and
  the Dashboard sector allocation is a pie.
- **Schema-drift guards** - the transaction CSV surfaces (export, import, the
  downloadable template, the import error message) all derive their columns from
  the schema; a CI test scans the UI source and fails if any hardcoded column
  list reappears, so a new field can't silently drift out of one surface.

Live site: https://mehdizle.github.io/portfolio_tracker_v2/

---

## Architecture

```
index.html                 HTML shell. Loads Highcharts (CDN) + the Vite entry.
styles.css                 All styles (imported by the entry, fingerprinted by Vite).
public/                    Static files copied verbatim to the site root by Vite.
  logos/                   Optional per-ticker logos (<TICKER>.png); monogram fallback.
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
    master-schema.js       master-list import field registry (TV + OPCVM) + calendar shape
    plan-apply.js          savings-pots recurring-cost -> log recompute (pure)
    connection-manifest.js declared field/render/save connections (CI-checked)
  app-core.generated.js    UI bundle (git-ignored; produced by scripts/concat.mjs)
scripts/concat.mjs         Concatenates the js/ UI files into the UI bundle.
js/                        UI layer (rendering, forms, tabs). Delegates all
                           fee/tax/FIFO math to src/core via globalThis.__core.
  01-core.js               globals, persistence, fee/tax wrappers -> __core
  02-compute.js            computeRow/runFIFO bridge to the core
  03-signals.js            valuation & signal engine (scores, fair value, targets)
  04-render.js             dashboard KPIs, positions (group-by-sector, badges), charts, sector pie
  05-rebalance.js          rebalance engine + stock detail panel
  06-features.js           signals render, dividends, transactions, interactions
  06b-import.js            TradingView/OPCVM/CSV import + templates, fee panel, theme, calendar
  06c-backup.js            backup/restore (APP_LS_KEYS), auto-dividends, snapshots
  06d-pending.js           pending orders (Order IDs), indicators, tooltips, range bar
  07-expenses.js           monthly expenses + savings pots (car/other planners)
  08-salary.js             salary calc, categories, cash ledger, quick-tooltip engine
  09-boot.js               data-act delegator, ticker-logo load-swap, market session, boot
test/
  core.test.js             unit tests (money, fees, tax, FIFO scenarios)
  reference.test.js        runs the real backup through the core; consistency +
                           snapshot of portfolio totals
  consistency.test.js      cross-path number locks (rebalance == execution, etc.)
  txn-roundtrip.test.js    transaction CSV export -> import preserves every field
  pending-roundtrip.test.js pending -> transaction carries every field
  master-import.test.js    TradingView/OPCVM import field coverage
  engine-improvements.test.js  FCF factor, growth blend, value-tilt, outcomes
  plan-apply.test.js       savings-pots recurring-cost recompute (live core)
  connections.test.js      connection-manifest checker (fields/render/save wired)
  fixtures/backup-real.json  synthetic transactions/master/config for tests
.github/workflows/deploy.yml  test -> build -> deploy to GitHub Pages
```

### The core vs. UI split (why it's safe)

The financial math (fees, tax, FIFO) is implemented **once**, in `src/core/`, as
pure functions with no globals - so it is unit-testable. The large UI layer
(the `js/` files) keeps its original structure but its fee/tax/FIFO functions are
now thin wrappers that call the core via `globalThis.__core` (set by `core-bridge.js`
before the UI bundle runs). This gives a tested, single-source money engine
without rewriting the UI's hundreds of call sites.

---

## Editing and deploying

You do **not** need Node locally. GitHub Actions builds and tests everything.

1. Edit a `js/0X-*.js` (UI) or `src/core/*.js` (math) file.
2. Commit / push to `main`.
3. Actions runs **tests first**; if they pass it builds (concat + Vite) and
   deploys to Pages. Watch the Actions tab; hard-refresh (Ctrl+Shift+R) after.

### One-time repo setup (v2 repo)

- **Settings -> Pages -> Source = "GitHub Actions"**.
- The `.github/` folder is a dotfolder; if the web uploader hides it, use
  **Add file -> Create new file** and type `.github/workflows/deploy.yml`.

---

## Local development (optional, needs Node 22+)

```
npm install
npm test          # run the financial-core test suite (Vitest)
npm run test:watch
npm run dev        # concat + Vite dev server
npm run build      # concat + production build into dist/
```

## Encrypted backups

On **Backup**, leaving the password blank produces a normal (unencrypted) JSON
backup. Entering a password produces an AES-GCM-encrypted envelope; **restore**
auto-detects it and asks for the password. There is no password recovery - if you
forget it, that backup cannot be restored. Encrypted v2 backups are not readable
by v1.

## Ticker logos

Every ticker shows a small badge. By default it's a deterministic colored
monogram (the ticker's initials on a stable color) - always available, offline,
and private. To show a real logo instead, drop a PNG into `public/logos/` named
after the ticker: uppercased, non-alphanumeric characters replaced by `_`, e.g.
`NKL.png`, `ATJ_ACT.png`, `FCP_B.png`. Vite copies `public/` to the site root, so
the file is served at `/portfolio_tracker_v2/logos/<TICKER>.png`. If the file is
missing the monogram is used - there are no external logo requests.

## Data and privacy

All data is stored in the browser's localStorage. Unencrypted backups are plain
JSON. Use encrypted backups if the file may leave your device. The app makes no
outbound requests except loading Highcharts from its CDN; it never sends your
portfolio anywhere.
