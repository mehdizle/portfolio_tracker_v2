// ================= PORTFOLIO VALUE HISTORY (recompute) =================
// Pure, DOM-free. Rebuilds the daily portfolio-value-over-time curve by
// replaying the LOCAL transaction ledger against the CI-committed daily price
// history (public/price-history.json). Transactions never leave the browser;
// this module is what turns "prices per day" + "my trades" into a value curve.
//
// price-history.json shape (produced by scripts/fetch-prices.mjs):
//   { _kind, _updated, _count, rows: [ { date:"YYYY-MM-DD", masi, msi20,
//                                        closes: { TICKER: close, ... } } ] }
//
// Why recompute (vs stored snapshots): the curve is always COMPLETE and
// gap-free regardless of when the user opens the app - it's derived from the
// dense daily history times current holdings-as-of-each-date, not accumulated
// from visits. A stock contributes only from its purchase date forward because
// holdings are replayed from the dated ledger.

// Holdings (share count per ticker) as of a given date (inclusive). Only BUY
// and SELL change the count; DIV/other actions don't. Quantities are summed
// from every transaction whose date <= `asOf`.
export function holdingsAsOf(txns, asOf) {
  const held = {};
  for (const t of txns || []) {
    if (!t || !t.date || !t.ticker) continue;
    if (t.date > asOf) continue; // ISO dates compare lexically
    const act = String(t.action || "").toUpperCase();
    const qty = +t.qty;
    if (!isFinite(qty) || !qty) continue;
    const tk = String(t.ticker).toUpperCase();
    if (act === "BUY") held[tk] = (held[tk] || 0) + qty;
    else if (act === "SELL") held[tk] = (held[tk] || 0) - qty;
  }
  // Drop zeroed/negative-rounding positions.
  for (const tk in held) if (held[tk] <= 1e-9) delete held[tk];
  return held;
}

// Close price for a ticker on `date`, or the nearest trading day AT OR BEFORE it
// (carry-forward), scanning the history rows. Returns null if the ticker never
// appears up to that date. Used by the signal-outcome panel to look up the
// price on a past call date from the repo history (dense, hands-off) instead of
// the browser trail. `history` is the price-history.json doc.
export function closeOnOrBefore(history, ticker, date) {
  const rows = (history && history.rows) || [];
  const tk = String(ticker || "").toUpperCase();
  let found = null;
  for (const row of rows) {
    if (!row || !row.date || row.date > date) break; // rows are date-sorted asc
    const c = row.closes && row.closes[tk];
    if (c != null && isFinite(+c) && +c > 0) found = +c;
  }
  return found;
}

// Latest available close for a ticker (last row that has it). null if none.
export function latestClose(history, ticker) {
  const rows = (history && history.rows) || [];
  const tk = String(ticker || "").toUpperCase();
  for (let i = rows.length - 1; i >= 0; i--) {
    const c = rows[i] && rows[i].closes && rows[i].closes[tk];
    if (c != null && isFinite(+c) && +c > 0) return +c;
  }
  return null;
}

// The earliest transaction date (ISO) or null if none. Used to start the curve
// at the first day the portfolio existed rather than the history file's start.
export function firstTxnDate(txns) {
  let min = null;
  for (const t of txns || []) {
    if (t && t.date && (min == null || t.date < min)) min = t.date;
  }
  return min;
}

// Build the daily value series. Returns:
//   { points: [ { date, value, masi, msi20 } ], first, last }
// where `value` = sum(held[tk] * close[tk]) using each date's closes, carrying
// the LAST KNOWN close forward for a ticker that has no quote on a given day
// (a stock that didn't trade keeps its prior price - avoids false dips to 0).
// Points before the first transaction are skipped (empty portfolio).
export function buildValueSeries(txns, history, opts) {
  const o = opts || {};
  const rows = (history && history.rows) || [];
  const startDate = o.from || firstTxnDate(txns) || null;
  const lastClose = {}; // ticker -> last seen close (carry-forward)
  const points = [];

  for (const row of rows) {
    if (!row || !row.date) continue;
    const closes = row.closes || {};
    // Update carry-forward map with today's quotes.
    for (const tk in closes) {
      const c = +closes[tk];
      if (isFinite(c) && c > 0) lastClose[tk] = c;
    }
    if (startDate && row.date < startDate) continue; // portfolio not yet started

    const held = holdingsAsOf(txns, row.date);
    let value = 0;
    let hasAny = false;
    for (const tk in held) {
      const px = closes[tk] != null ? +closes[tk] : lastClose[tk];
      if (isFinite(px) && px > 0) {
        value += held[tk] * px;
        hasAny = true;
      }
    }
    // Skip leading rows where nothing is held/priced yet.
    if (!hasAny && !points.length) continue;
    points.push({
      date: row.date,
      value: Math.round(value * 100) / 100,
      masi: row.masi != null ? +row.masi : null,
      msi20: row.msi20 != null ? +row.msi20 : null,
    });
  }
  return {
    points,
    first: points.length ? points[0].date : null,
    last: points.length ? points[points.length - 1].date : null,
  };
}

// Rebase a numeric series to a 0% baseline at its first non-null value, so the
// portfolio and a benchmark index can be compared on the same %-return axis.
// Returns an array aligned to `points` of { date, pct } (pct in %, or null).
function rebasePct(points, pick) {
  let base = null;
  return points.map((p) => {
    const v = pick(p);
    if (v == null || !isFinite(v) || v <= 0) return { date: p.date, pct: null };
    if (base == null) base = v;
    return { date: p.date, pct: base > 0 ? (v / base - 1) * 100 : null };
  });
}

// Convenience: build the full comparison dataset for the chart.
//   { points, value:[{date,pct}], masi:[...], msi20:[...] }
// value/masi/msi20 are %-return series rebased to 0 at the first point, so the
// portfolio can be visually compared against either index. `benchmark` selects
// which index series is meaningful to show ("masi" | "msi20"), but both are
// always returned so the UI can switch without recompute.
export function valueVsBenchmark(txns, history, opts) {
  const series = buildValueSeries(txns, history, opts);
  const points = series.points;
  return {
    points,
    first: series.first,
    last: series.last,
    valuePct: rebasePct(points, (p) => p.value),
    masiPct: rebasePct(points, (p) => p.masi),
    msi20Pct: rebasePct(points, (p) => p.msi20),
  };
}
