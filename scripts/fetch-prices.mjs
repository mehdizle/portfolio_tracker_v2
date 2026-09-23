// fetch-prices.mjs - fetch latest Casablanca (CSE) prices + fundamentals from
// TradingView's public scanner endpoint and write public/prices.json, and
// append a daily row (stock closes + MASI/MSI20 index levels + OPCVM fund NAVs
// from ASFIM) to public/price-history.json for the value-over-time curve.
//
// Runs in GitHub Actions (Node >= 22), NOT in the browser: the browser can't
// call TradingView directly (CORS), but a server/CI request has no such limit.
// This is the same JSON POST the `tradingview-screener` Python library makes -
// no library, no auth, no scraping.
//
// Output shape is exactly what the app's TradingView importer consumes
// (src/core/master-schema.js -> applyTvRec / TV_METRICS): a list of records with
// keys price, low, high, pe, pb, peg, divy, ev, netdebt, roe, eps, bvps, dps,
// fcf, revenue, epsGrowth. divy/roe/epsGrowth are stored as DECIMALS (%/100),
// matching how the paste parser scales them. CATEGORY IS DELIBERATELY OMITTED so
// the app's manual categories are never overwritten.
//
// The app never trusts this file blindly: the "Fetch latest" button imports it
// through the SAME applyTvRec pipeline as a manual paste (null/NaN skipped), and
// falls back to manual paste if the file is missing/stale/unreadable.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "prices.json");
const HISTORY_OUT = join(ROOT, "public", "price-history.json");
const ENDPOINT = "https://scanner.tradingview.com/morocco/scan";

// Casablanca indices for the benchmark line (validated: CSEMA:MASI, CSEMA:MSI20).
const INDEX_SYMBOLS = { masi: "CSEMA:MASI", msi20: "CSEMA:MSI20" };
// Keep ~3 years of daily rows in the history file (weekdays only ~= 260/yr).
const HISTORY_MAX_ROWS = 820;

// ---- OPCVM funds (ASFIM) ----
// TradingView only lists exchange-traded equities, NOT OPCVM mutual funds, so
// fund NAVs come from ASFIM's public API (fundshare.asfim.ma) instead - the
// authoritative source (Moroccan fund-managers' association). We fetch each
// fund's latest NAV (`vl`) by its ISIN and merge it into the same daily history
// row as the stock closes, so the value-over-time curve prices held funds too.
//
// This is PUBLIC fund data (ISINs + published NAVs), nothing personal. The map
// is app-ticker -> ISIN; add a fund here to have its NAV tracked. NOTE: many
// funds are WEEKLY-priced (periodicite HEBDOMADAIRE), so their NAV only changes
// once a week - the app carries the last NAV forward between pricing days.
const ASFIM_API = "https://fundshare.asfim.ma/api";
const FUND_ISINS = {
  "ATJ ACT": "MA0000036063",
  "ATJ DIV": "MA0000041477",
  "ATJ MOU": "MA0000040156",
  "ATJ VAL": "MA0000042137",
  "FCP A": "MA0000042590",
  "FCP B": "MA0000041568",
  "FCP C": "MA0000041956",
  "SG E": "MA0000041709",
};

// TradingView symbol -> app master ticker, when they differ. Mirrors
// TV_TICKER_ALIAS in js/06b-import.js. On TradingView, SSOT is listed as SOT.
const TV_TICKER_ALIAS = { SOT: "SSOT" };

// app record key -> TradingView scanner field (validated against the Morocco
// screener). `scale100: true` converts a percentage to a decimal (3% -> 0.03).
const FIELD_MAP = [
  { key: "price", tv: "close" },
  { key: "low", tv: "Low.All" },
  { key: "high", tv: "High.All" },
  { key: "pe", tv: "price_earnings_ttm" },
  { key: "pb", tv: "price_book_ratio" },
  { key: "peg", tv: "price_earnings_growth_ttm" },
  { key: "divy", tv: "dividends_yield_current", scale100: true },
  { key: "ev", tv: "enterprise_value_ebitda_ttm" },
  { key: "netdebt", tv: "total_debt_to_ebitda_fq" },
  { key: "roe", tv: "return_on_equity", scale100: true },
  { key: "eps", tv: "earnings_per_share_basic_ttm" },
  { key: "bvps", tv: "book_value_per_share_fq" },
  { key: "dps", tv: "dps_common_stock_prim_issue_fy" },
  { key: "fcf", tv: "free_cash_flow_per_share_ttm" },
  { key: "revenue", tv: "total_revenue" },
  {
    key: "epsGrowth",
    tv: "earnings_per_share_diluted_yoy_growth_ttm",
    scale100: true,
  },
];

// `name` first (the symbol/company), then every mapped TV field in order.
const COLUMNS = ["name", ...FIELD_MAP.map((f) => f.tv)];

async function fetchScan() {
  const body = {
    columns: COLUMNS,
    range: [0, 500],
    markets: ["morocco"],
    sort: { sortBy: "name", sortOrder: "asc" },
  };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "portfolio-tracker-v2 (github actions price refresh)",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`scanner HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function toRecords(payload) {
  const rows = (payload && payload.data) || [];
  const idx = {};
  COLUMNS.forEach((c, i) => (idx[c] = i));
  const out = [];
  for (const row of rows) {
    const sym = String(row.s || "")
      .split(":")
      .pop()
      .toUpperCase(); // "CSEMA:ATW" -> "ATW"
    if (!sym) continue;
    const ticker = TV_TICKER_ALIAS[sym] || sym;
    const d = row.d || [];
    const rec = { ticker };
    for (const f of FIELD_MAP) {
      let v = d[idx[f.tv]];
      if (v == null || (typeof v === "number" && !isFinite(v))) continue; // skip null/NaN
      if (typeof v === "number" && f.scale100) v = v / 100;
      rec[f.key] = v;
    }
    // Only keep a record if it has at least a price (nothing else is useful
    // without it, and it keeps the file tight).
    if (rec.price != null) out.push(rec);
  }
  return out;
}

// Fetch the two index levels (MASI, MSI20) via the explicit-symbols scan.
// Returns { masi, msi20 } with numbers or null. Never throws - a failed index
// fetch just yields nulls (the value curve still works; benchmark point skipped).
async function fetchIndices() {
  const out = { masi: null, msi20: null };
  try {
    const body = {
      symbols: { tickers: Object.values(INDEX_SYMBOLS) },
      columns: ["close"],
    };
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "portfolio-tracker-v2 (github actions price refresh)",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return out;
    const payload = await res.json();
    for (const row of payload.data || []) {
      const close = (row.d || [])[0];
      if (row.s === INDEX_SYMBOLS.masi && typeof close === "number")
        out.masi = close;
      if (row.s === INDEX_SYMBOLS.msi20 && typeof close === "number")
        out.msi20 = close;
    }
  } catch (_e) {
    /* leave nulls */
  }
  return out;
}

// Fetch the latest NAV for each configured OPCVM fund from ASFIM, keyed by ISIN.
// Returns { "ATJ ACT": 921.01, ... } (app-ticker -> latest NAV). Best-effort and
// per-fund isolated: one fund failing (or ASFIM being down) never throws and
// never blocks the stock closes - that fund is simply omitted from today's row,
// and the app carries its previous NAV forward. Only NAVs dated within the last
// few days are accepted, so a stale/dormant fund can't inject an old number.
async function fetchFundNavs() {
  const out = {};
  const MAX_STALE_DAYS = 10; // reject a "latest" NAV older than this
  const cutoff = new Date(Date.now() - MAX_STALE_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);
  const entries = Object.entries(FUND_ISINS);
  await Promise.all(
    entries.map(async ([ticker, isin]) => {
      try {
        // Latest performance row for this ISIN (ordering=-date, one item).
        const url =
          `${ASFIM_API}/performances/?opcvm__code_isin=${encodeURIComponent(isin)}` +
          `&ordering=-date&page_size=1`;
        const res = await fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "portfolio-tracker-v2 (github actions fund refresh)",
          },
        });
        if (!res.ok) return;
        const payload = await res.json();
        const row = (payload.results || [])[0];
        if (!row || !row.date || row.date < cutoff) return; // missing/stale
        const vl = row.vl;
        if (typeof vl === "number" && isFinite(vl) && vl > 0) {
          out[ticker] = Math.round(vl * 10000) / 10000;
        }
      } catch (_e) {
        /* skip this fund; leave it to carry-forward */
      }
    }),
  );
  return out;
}

// Append today's closes + index levels to public/price-history.json as ONE row
// per date (latest wins), pruned to HISTORY_MAX_ROWS. Public data only - no
// transactions, nothing personal. This is what the app replays against the
// (local) transaction ledger to draw the value-over-time curve + benchmark.
function appendHistory(records, indices, fundNavs) {
  const now = new Date();
  // The CSE is closed on weekends, so never record a weekend row - it would only
  // duplicate Friday's close and put a flat blip in the value-over-time chart.
  // (The scheduled cron is Mon-Fri, but a manual/weekend dispatch could hit this.)
  const dow = now.getUTCDay(); // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) {
    console.log(
      "fetch-prices: weekend - skipping history row (market closed).",
    );
    return;
  }
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const closes = {};
  for (const r of records) if (r.price != null) closes[r.ticker] = r.price;
  // Merge OPCVM fund NAVs (from ASFIM) into the same day's closes, alongside the
  // stock closes. Funds without a fresh NAV today are simply absent and the app
  // carries their previous NAV forward.
  for (const [tk, vl] of Object.entries(fundNavs || {})) {
    if (typeof vl === "number" && isFinite(vl) && vl > 0) closes[tk] = vl;
  }

  let hist = { _kind: "casa_price_history", rows: [] };
  if (existsSync(HISTORY_OUT)) {
    try {
      const prev = JSON.parse(readFileSync(HISTORY_OUT, "utf8"));
      if (prev && Array.isArray(prev.rows)) hist = prev;
    } catch (_e) {
      /* unreadable -> start fresh */
    }
  }
  // One row per date: drop any existing same-day row, then append the fresh one.
  hist.rows = hist.rows.filter((r) => r && r.date !== today);
  hist.rows.push({
    date: today,
    masi: indices.masi,
    msi20: indices.msi20,
    closes,
  });
  hist.rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  if (hist.rows.length > HISTORY_MAX_ROWS)
    hist.rows = hist.rows.slice(hist.rows.length - HISTORY_MAX_ROWS);
  hist._updated = new Date().toISOString();
  hist._count = hist.rows.length;

  mkdirSync(dirname(HISTORY_OUT), { recursive: true });
  writeFileSync(HISTORY_OUT, JSON.stringify(hist) + "\n", "utf8");
  const fundCount = Object.keys(fundNavs || {}).length;
  console.log(
    `fetch-prices: history now ${hist.rows.length} daily rows ` +
      `(masi=${indices.masi}, msi20=${indices.msi20}, ${fundCount} fund NAVs).`,
  );
}

async function main() {
  let payload;
  try {
    payload = await fetchScan();
  } catch (e) {
    console.error("fetch-prices: request failed -", e.message);
    process.exit(1); // fail the CI step; the app keeps its previous prices.json
  }
  const records = toRecords(payload);
  if (!records.length) {
    console.error(
      "fetch-prices: no records parsed - aborting (not overwriting)",
    );
    process.exit(1);
  }

  // Always append today's daily history row (stock closes + index levels +
  // OPCVM fund NAVs). Runs even when prices.json is unchanged, since a new DATE
  // is a new curve point. Index and fund fetches are best-effort (a failure
  // just omits those values; the value curve still works and carries forward).
  const [indices, fundNavs] = await Promise.all([
    fetchIndices(),
    fetchFundNavs(),
  ]);
  appendHistory(records, indices, fundNavs);

  const doc = {
    _source: "tradingview:morocco",
    _fetched: new Date().toISOString(),
    _count: records.length,
    records,
  };
  const json = JSON.stringify(doc, null, 1) + "\n";

  // Skip writing when only the timestamp would change, so CI doesn't create an
  // empty-diff commit. Compare the `records` payload, ignoring _fetched.
  if (existsSync(OUT)) {
    try {
      const prev = JSON.parse(readFileSync(OUT, "utf8"));
      const same = JSON.stringify(prev.records) === JSON.stringify(records);
      if (same) {
        console.log(
          `fetch-prices: ${records.length} records, unchanged - not rewriting.`,
        );
        return;
      }
    } catch (_e) {
      /* unreadable previous file -> just overwrite */
    }
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json, "utf8");
  console.log(
    `fetch-prices: wrote ${records.length} records to public/prices.json`,
  );
}

main();
