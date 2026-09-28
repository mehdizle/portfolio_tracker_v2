// fetch-logos.mjs - refresh the per-ticker logo SVGs from TradingView.
//
// Runs MONTHLY in GitHub Actions (logos change rarely). For every Casablanca
// ticker the scanner returns a `logoid`; TradingView serves the matching vector
// logo at https://s3-symbol-logo.tradingview.com/<logoid>.svg (public, no auth).
// We download each and write public/logos/CSEMA/<KEY>.svg, overwriting only when
// the SVG content actually changed - so a stale/wrong logo self-corrects and a
// brand refresh is picked up, while unchanged logos produce no commit churn.
//
// Same posture as fetch-prices.mjs: server-side (the browser can't reach the
// scanner - CORS), best-effort per logo (one failure never aborts the rest),
// and it never deletes a logo it can't refresh (keeps the last good one).
//
// KEY convention mirrors js/01-core.js _tickerLogoKey exactly:
//   ticker -> trim -> UPPERCASE -> [^A-Z0-9]+ => "_" -> strip leading/trailing _
// so "ATJ ACT" -> "ATJ_ACT", matching the files the app looks up.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOGO_DIR = join(ROOT, "public", "logos", "CSEMA");
const SCAN = "https://scanner.tradingview.com/morocco/scan";
const LOGO_CDN = "https://s3-symbol-logo.tradingview.com";
const UA = "portfolio-tracker-v2 (github actions logo refresh)";

// TradingView symbol -> app ticker, when they differ (mirrors TV_TICKER_ALIAS
// in js/06b-import.js: on TradingView, SSOT is listed as SOT).
const TV_TICKER_ALIAS = { SOT: "SSOT" };

// Filesystem-safe logo key - identical rule to js/01-core.js _tickerLogoKey.
function logoKey(ticker) {
  return String(ticker || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Scan the Morocco market for name + logoid (one row per listed ticker).
async function fetchLogoIds() {
  const body = {
    columns: ["name", "logoid"],
    range: [0, 500],
    markets: ["morocco"],
    sort: { sortBy: "name", sortOrder: "asc" },
  };
  const res = await fetch(SCAN, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`scanner HTTP ${res.status} ${res.statusText}`);
  const payload = await res.json();
  const out = []; // [{ ticker, logoid }]
  for (const row of (payload && payload.data) || []) {
    const sym = String(row.s || "")
      .split(":")
      .pop()
      .toUpperCase(); // "CSEMA:ATW" -> "ATW"
    const logoid = (row.d || [])[1];
    if (!sym || !logoid || typeof logoid !== "string") continue;
    const ticker = TV_TICKER_ALIAS[sym] || sym;
    out.push({ ticker, logoid });
  }
  return out;
}

// Download one logo SVG. Returns the SVG text, or null on any failure.
async function fetchSvg(logoid) {
  try {
    const res = await fetch(`${LOGO_CDN}/${encodeURIComponent(logoid)}.svg`, {
      headers: { Accept: "image/svg+xml", "User-Agent": UA },
    });
    if (!res.ok) return null;
    const txt = await res.text();
    // Sanity: must look like an SVG (guards against an error page slipping in).
    if (!/^\s*<(\?xml|!--|svg)/i.test(txt) || !/<svg[\s>]/i.test(txt))
      return null;
    return txt;
  } catch (_e) {
    return null;
  }
}

async function main() {
  let list;
  try {
    list = await fetchLogoIds();
  } catch (e) {
    console.error("fetch-logos: scan failed -", e.message);
    process.exit(1); // no logoids -> nothing to do; fail the step loudly
  }
  if (!list.length) {
    console.error("fetch-logos: scan returned no logoids - aborting.");
    process.exit(1);
  }

  mkdirSync(LOGO_DIR, { recursive: true });
  let written = 0;
  let unchanged = 0;
  let failed = 0;
  const failedTickers = [];

  // Sequential-ish but parallel-limited: fire all, they're tiny SVGs.
  await Promise.all(
    list.map(async ({ ticker, logoid }) => {
      const svg = await fetchSvg(logoid);
      if (svg == null) {
        failed++;
        failedTickers.push(ticker);
        return; // keep the existing logo (never delete on failure)
      }
      const key = logoKey(ticker);
      if (!key) return;
      const path = join(LOGO_DIR, `${key}.svg`);
      // Overwrite only when content changed, to avoid commit churn.
      let prev = null;
      if (existsSync(path)) {
        try {
          prev = readFileSync(path, "utf8");
        } catch (_e) {
          /* unreadable -> treat as changed */
        }
      }
      if (prev === svg) {
        unchanged++;
        return;
      }
      writeFileSync(path, svg, "utf8");
      written++;
    }),
  );

  console.log(
    `fetch-logos: ${list.length} tickers scanned - ${written} logos written/updated, ` +
      `${unchanged} unchanged, ${failed} unavailable` +
      (failedTickers.length ? ` (${failedTickers.sort().join(", ")})` : "") +
      ".",
  );
}

main();
