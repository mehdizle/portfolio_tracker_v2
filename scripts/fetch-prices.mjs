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
const FUND_ISINS_FILE = join(ROOT, "public", "fund-isins.json");

// ---- Dividend calendar (Bourse de Casablanca) ----
// The official financial-calendar page embeds the FULL dividend calendar in its
// HTML as drupalSettings.boursenova.dividendesData (keyed by year). We fetch the
// page, parse that JSON, map each issuer NAME to an app ticker via the committed
// public/issuer-map.json, normalize, and write public/dividends.json. The app
// then upserts those rows into its dividend calendar (never deleting manual
// entries). Public data only; issuers we can't map are skipped (listed for the
// in-app matcher). All best-effort - a failure never blocks the price refresh.
const CAL_URL =
  "https://www.casablanca-bourse.com/en/emetteurs/calendrier-financier";
const ISSUER_MAP_FILE = join(ROOT, "public", "issuer-map.json");
const DIVIDENDS_OUT = join(ROOT, "public", "dividends.json");

// Built-in fallback fund list (app-ticker -> ISIN). This is a SAFETY DEFAULT:
// the source of truth is public/fund-isins.json, which the app's "Match Funds
// to ASFIM" UI generates for you to commit. If that file is present it REPLACES
// this map (so newly-matched funds are tracked hands-off); if it's missing or
// unreadable, we fall back to this list so the workflow never breaks.
const FUND_ISINS_DEFAULT = {
  "ATJ ACT": "MA0000036063",
  "ATJ DIV": "MA0000041477",
  "ATJ MOU": "MA0000040156",
  "ATJ VAL": "MA0000042137",
  "FCP A": "MA0000042590",
  "FCP B": "MA0000041568",
  "FCP C": "MA0000041956",
  "SG E": "MA0000041709",
};

// Load the committed fund map (public/fund-isins.json = { ticker: isin }); fall
// back to the built-in default. Ignores non-string/empty ISINs defensively.
function loadFundIsins() {
  if (existsSync(FUND_ISINS_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(FUND_ISINS_FILE, "utf8"));
      const clean = {};
      for (const [tk, isin] of Object.entries(parsed || {})) {
        if (tk && typeof isin === "string" && isin.trim())
          clean[tk] = isin.trim();
      }
      if (Object.keys(clean).length) {
        console.log(
          `fetch-prices: fund list from public/fund-isins.json (${Object.keys(clean).length} funds).`,
        );
        return clean;
      }
    } catch (_e) {
      console.warn(
        "fetch-prices: public/fund-isins.json unreadable - using built-in fund list.",
      );
    }
  }
  return FUND_ISINS_DEFAULT;
}

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
  const entries = Object.entries(loadFundIsins());
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

// Load the committed issuer-name -> ticker map (public/issuer-map.json). Keys
// are uppercased for case-insensitive matching. Returns {} if missing/unreadable.
function loadIssuerMap() {
  if (!existsSync(ISSUER_MAP_FILE)) return {};
  try {
    const parsed = JSON.parse(readFileSync(ISSUER_MAP_FILE, "utf8"));
    const out = {};
    for (const [name, tk] of Object.entries(parsed || {})) {
      if (name && typeof tk === "string" && tk.trim())
        out[name.trim().toUpperCase()] = tk.trim().toUpperCase();
    }
    return out;
  } catch (_e) {
    console.warn(
      "fetch-prices: issuer-map.json unreadable - dividends skipped.",
    );
    return {};
  }
}

// Parse "1 234,50 MAD" / "14,00 MAD" -> 14.0 (French decimal comma, spaces as
// thousands sep). Returns null if not a positive finite number.
function parseAmount(s) {
  const t = String(s == null ? "" : s)
    .replace(/mad/i, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s/g, "")
    .replace(",", ".");
  const n = parseFloat(t);
  return isFinite(n) && n > 0 ? n : null;
}

// Fetch the Bourse de Casablanca dividend calendar and return app-shaped rows:
//   [{ ticker, issuer, amount, ex_date, pay_date, div_type }]
// Issuers absent from issuer-map.json are skipped and returned in `unmapped`.
// Best-effort: returns { rows: [], unmapped: [] } on any failure.
async function fetchDividends() {
  const empty = { rows: [], unmapped: [] };
  const map = loadIssuerMap();
  if (!Object.keys(map).length) return empty;
  let html;
  try {
    const res = await fetch(CAL_URL, {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "portfolio-tracker-v2 (github actions dividend calendar refresh)",
      },
    });
    if (!res.ok) return empty;
    html = await res.text();
  } catch (_e) {
    return empty;
  }
  // The calendar lives in the Drupal settings JSON island.
  const m = html.match(
    /data-drupal-selector="drupal-settings-json"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!m) return empty;
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch (_e) {
    return empty;
  }
  const byYear =
    (data && data.boursenova && data.boursenova.dividendesData) || {};
  const rows = [];
  const unmapped = new Set();
  const iso = (s) => String(s == null ? "" : s).slice(0, 10); // "...T00:00:00" -> date
  for (const yr of Object.keys(byYear)) {
    for (const r of byYear[yr] || []) {
      const issuer = String((r && r.emetteur) || "").trim();
      if (!issuer) continue;
      const ticker = map[issuer.toUpperCase()];
      if (!ticker) {
        unmapped.add(issuer);
        continue;
      }
      const amount = parseAmount(r.dividende);
      const ex_date = iso(r.dateDetachement);
      const pay_date = iso(r.datePaiement);
      // Default a blank/missing type to "Ordinary" (older calendar rows sometimes
      // omit it). Trim FIRST so "  " also defaults, not just "".
      const div_type =
        String((r && r.typeDividende) || "").trim() || "Ordinary";
      if (!ex_date && !pay_date) continue; // need at least one date
      if (amount == null) continue; // skip 0,00 / unparseable amounts (not a real payout)
      rows.push({ ticker, issuer, amount, ex_date, pay_date, div_type });
    }
  }
  return { rows, unmapped: [...unmapped].sort() };
}

// Write public/dividends.json from the fetched rows. Skips writing when the
// row set is unchanged (avoids empty-diff commits). Returns true if written.
function writeDividends(result) {
  if (!result || !result.rows.length) {
    console.log("fetch-prices: no mapped dividends parsed - leaving as-is.");
    return false;
  }
  const doc = {
    _kind: "casa_dividends",
    _source: "casablanca-bourse:calendrier-financier",
    _updated: new Date().toISOString(),
    _count: result.rows.length,
    _unmapped: result.unmapped, // issuers with no ticker (for the in-app matcher)
    rows: result.rows,
  };
  const json = JSON.stringify(doc) + "\n";
  if (existsSync(DIVIDENDS_OUT)) {
    try {
      const prev = JSON.parse(readFileSync(DIVIDENDS_OUT, "utf8"));
      if (
        JSON.stringify(prev.rows) === JSON.stringify(result.rows) &&
        JSON.stringify(prev._unmapped || []) === JSON.stringify(result.unmapped)
      ) {
        console.log(
          `fetch-prices: dividends unchanged (${result.rows.length} rows) - not rewriting.`,
        );
        return false;
      }
    } catch (_e) {
      /* unreadable -> overwrite */
    }
  }
  mkdirSync(dirname(DIVIDENDS_OUT), { recursive: true });
  writeFileSync(DIVIDENDS_OUT, json, "utf8");
  console.log(
    `fetch-prices: wrote ${result.rows.length} dividends (${result.unmapped.length} unmapped issuers) to public/dividends.json`,
  );
  return true;
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
  const [indices, fundNavs, dividends] = await Promise.all([
    fetchIndices(),
    fetchFundNavs(),
    fetchDividends(),
  ]);
  appendHistory(records, indices, fundNavs);
  // Refresh the dividend calendar (public/dividends.json) in the same run. The
  // app upserts it into its calendar on load; best-effort, never blocks prices.
  try {
    writeDividends(dividends);
  } catch (e) {
    console.warn("fetch-prices: writeDividends failed -", e && e.message);
  }

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
