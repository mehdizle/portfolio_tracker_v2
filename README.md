# Portfolio Tracker v2 (Casablanca / MAD)

Version 2 of the client-side Casablanca Stock Exchange portfolio tracker. Same
features as v1 (positions, FIFO cost basis, tax, valuation signals, rebalancing,
dividends, expenses, salary) plus the Tier-3 upgrades:

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

Live site: https://mehdizle.github.io/portfolio_tracker_v2/

---

## Architecture

```
index.html                 HTML shell. Loads Highcharts (CDN) + the Vite entry.
styles.css                 All styles (imported by the entry, fingerprinted by Vite).
src/
  main.js                  Vite entry: imports css, core-bridge, then the UI bundle.
  core-bridge.js           Sets globalThis.__core BEFORE the UI bundle evaluates.
  core/                    *** PURE, TESTED FINANCIAL CORE (ES modules) ***
    money.js               integer-cents rounding helpers
    fees.js                brokerage / PEA / OPCVM / VAT fee engine
    tax.js                 capital-gains + dividend tax, divRate
    fifo.js                computeRow + FIFO engine (uses money/fees/tax)
    config.js              fee/broker/tax default parameters
    backup-crypto.js       AES-GCM backup encryption (WebCrypto)
  app-core.generated.js    UI bundle (git-ignored; produced by scripts/concat.mjs)
scripts/concat.mjs         Concatenates js/01..09 into the UI bundle.
js/01..09-*.js             UI layer (rendering, forms, tabs). Delegates all
                           fee/tax/FIFO math to src/core via globalThis.__core.
test/
  core.test.js             unit tests (money, fees, tax, FIFO scenarios)
  reference.test.js        runs the real backup through the core; consistency +
                           snapshot of portfolio totals
  fixtures/backup-real.json  transactions/master/config extracted from a real backup
.github/workflows/deploy.yml  test -> build -> deploy to GitHub Pages
```

### The core vs. UI split (why it's safe)

The financial math (fees, tax, FIFO) is implemented **once**, in `src/core/`, as
pure functions with no globals - so it is unit-testable. The large UI layer
(`js/01..09`) keeps its original structure but its fee/tax/FIFO functions are now
thin wrappers that call the core via `globalThis.__core` (set by `core-bridge.js`
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

## Data and privacy

All data is stored in the browser's localStorage. Unencrypted backups are plain
JSON. Use encrypted backups if the file may leave your device.
