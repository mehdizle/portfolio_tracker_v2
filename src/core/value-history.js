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

// Cost basis of the shares STILL HELD as of `asOf` - i.e. what you actually paid
// (average cost) for the position you currently own. Replays BUY/SELL per ticker
// with an average-cost pool: a BUY adds qty*price to the pool and qty to the
// count; a SELL removes shares AT AVERAGE COST (so it reduces the pool
// proportionally, never creating a phantom gain/loss here - realized P&L is a
// separate concept). DIV is ignored. Returns MAD (gross of fees).
//
// This is the denominator for the portfolio PERFORMANCE line: value / cost - 1.
// Because a BUY adds equally to value and to cost at purchase time, injecting
// capital does NOT jump the percentage - unlike rebasing raw market value, which
// wrongly counted "I bought more" as "I gained". Prices paid come from your local
// transactions; no market history needed.
export function costBasisAsOf(txns, asOf) {
  const pool = {}; // ticker -> { qty, cost }
  const ordered = (txns || [])
    .filter((t) => t && t.date && t.ticker && t.date <= asOf)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const t of ordered) {
    const act = String(t.action || "").toUpperCase();
    const qty = +t.qty;
    if (!isFinite(qty) || !qty) continue;
    const tk = String(t.ticker).toUpperCase();
    const p = pool[tk] || (pool[tk] = { qty: 0, cost: 0 });
    if (act === "BUY") {
      const px = +t.price;
      p.qty += qty;
      if (isFinite(px) && px > 0) p.cost += qty * px;
    } else if (act === "SELL") {
      const avg = p.qty > 1e-9 ? p.cost / p.qty : 0;
      p.qty -= qty;
      p.cost -= qty * avg; // remove sold shares at average cost
      if (p.qty <= 1e-9) {
        p.qty = 0;
        p.cost = 0;
      }
    }
  }
  let total = 0;
  for (const tk in pool) if (pool[tk].qty > 1e-9) total += pool[tk].cost;
  return total;
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
      cost: Math.round(costBasisAsOf(txns, row.date) * 100) / 100,
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

// Rebase a numeric series to a 0% baseline at its first non-null value, so a
// benchmark index can be compared on the same %-return axis as the portfolio.
// Returns an array aligned to `points` of { date, pct } (pct in %, or null).
// NOTE: this is correct for an INDEX (no cash flows), but NOT for the portfolio
// value - see costReturnPct for why.
function rebasePct(points, pick) {
  let base = null;
  return points.map((p) => {
    const v = pick(p);
    if (v == null || !isFinite(v) || v <= 0) return { date: p.date, pct: null };
    if (base == null) base = v;
    return { date: p.date, pct: base > 0 ? (v / base - 1) * 100 : null };
  });
}

// Portfolio performance per day as COST-BASIS return: value / cost - 1 (%).
// `cost` is what you paid for the shares held that day (costBasisAsOf). This is
// the "spent 100, worth 110 -> +10%" number the user wants, and it is immune to
// cash flows: buying more adds equally to value and cost, so the line reflects
// PRICE performance, not how much capital you added. (Rebasing raw market value
// against day one wrongly showed a later BUY as a huge "gain".) Returns null on
// a day with no cost basis (nothing held / all prices missing).
function costReturnPct(points) {
  return points.map((p) => {
    if (
      p.cost == null ||
      !isFinite(p.cost) ||
      p.cost <= 0 ||
      p.value == null ||
      !isFinite(p.value)
    )
      return { date: p.date, pct: null };
    return { date: p.date, pct: (p.value / p.cost - 1) * 100 };
  });
}

// Shift a rebased benchmark series so it STARTS at `offsetPct` instead of 0%.
// The portfolio line is an absolute cost-basis return (it may start at, say,
// +2.8% because you're already up on what you paid). To compare fairly, we lift
// the benchmark to meet the portfolio at the first plotted point, so both lines
// share a starting value and you read the DIVERGENCE (did MASI outpace you?).
function shiftSeries(series, offsetPct) {
  if (!isFinite(offsetPct)) return series;
  return series.map((x) =>
    x.pct == null ? x : { date: x.date, pct: x.pct + offsetPct },
  );
}

// Convenience: build the full comparison dataset for the chart.
//   { points, valuePct:[{date,pct}], masiPct:[...], msi20Pct:[...] }
// - valuePct is the portfolio's COST-BASIS return (value/cost - 1), which is
//   cash-flow-immune (adding capital doesn't move it; only price does).
// - masiPct/msi20Pct are the index's rebased return, SHIFTED to start at the
//   portfolio's first return so all three lines meet at the left edge and the
//   comparison is about slope/divergence, not absolute level.
export function valueVsBenchmark(txns, history, opts) {
  const series = buildValueSeries(txns, history, opts);
  const points = series.points;
  const valuePct = costReturnPct(points);
  // The portfolio's return at the first plotted point (0 if unavailable).
  const firstRet = valuePct.find((x) => x.pct != null);
  const anchor = firstRet ? firstRet.pct : 0;
  return {
    points,
    first: series.first,
    last: series.last,
    valuePct,
    masiPct: shiftSeries(
      rebasePct(points, (p) => p.masi),
      anchor,
    ),
    msi20Pct: shiftSeries(
      rebasePct(points, (p) => p.msi20),
      anchor,
    ),
  };
}
