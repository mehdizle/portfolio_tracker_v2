// ================= DIVIDEND FORECAST (reference estimate) =================
// Pure, DOM-free forecast built from the multi-year dividend calendar (DIVCAL).
//
// This is a REFERENCE estimate, not a guarantee. With only 2-3 years of history
// the projection is a rough guide. The math is deliberately transparent:
//
//   For each ticker, collect its per-year dividend-per-share (sum of ordinary
//   events in each calendar year, keyed by pay-date year; exceptional/one-off
//   events are excluded). Then, per ticker:
//
//     - method "flat":  only one year of history -> next year = that year.
//     - method "trend": >=2 years -> apply the average year-over-year growth
//                         (geometric mean of consecutive-year ratios), clamped
//                         to a sane band, to the most recent COMPLETE year.
//
//   A consistency score = (# years the ticker paid) / (# years in the window),
//   giving a quick reliability signal. Expected pay month = the modal month of
//   past pay-dates.
//
// The most recent year is often INCOMPLETE (the user is still entering it), so
// the trend base uses the last year whose events look complete; the incomplete
// current year is reported separately as "so far" and not used as the trend base.

const MAX_GROWTH = 0.5; // clamp YoY growth to +/-50% so thin data can't explode.
const MIN_GROWTH = -0.5;

function yearOf(iso) {
  const m = String(iso || "").match(/^(\d{4})/);
  return m ? +m[1] : null;
}
function monthOf(iso) {
  const m = String(iso || "").match(/^\d{4}-(\d{2})/);
  return m ? +m[1] : null;
}
function num(x) {
  const n = +x;
  return isFinite(n) ? n : 0;
}
function isExceptional(d) {
  return String((d && d.div_type) || "").toLowerCase() === "exceptional";
}

// Geometric mean of consecutive-year growth ratios. years = [{year, dps}] sorted asc.
function avgGrowth(years) {
  const ratios = [];
  for (let i = 1; i < years.length; i++) {
    const prev = years[i - 1].dps,
      cur = years[i].dps;
    if (prev > 0 && cur > 0) ratios.push(cur / prev);
  }
  if (!ratios.length) return 0;
  const logSum = ratios.reduce((s, r) => s + Math.log(r), 0);
  const g = Math.exp(logSum / ratios.length) - 1;
  return Math.max(MIN_GROWTH, Math.min(MAX_GROWTH, g));
}

// Modal (most common) pay-month across a ticker's events; ties -> latest month.
function expectedMonth(events) {
  const count = {};
  for (const d of events) {
    const m = monthOf(d.pay_date);
    if (m) count[m] = (count[m] || 0) + 1;
  }
  let best = null,
    bestN = 0;
  for (const m in count) {
    const mm = +m;
    if (count[m] > bestN || (count[m] === bestN && mm > best)) {
      best = mm;
      bestN = count[m];
    }
  }
  return best; // 1..12 or null
}

// Build a per-ticker forecast for `targetYear` from the calendar.
// Returns { targetYear, refYear, rows:[...], totalDps, method } summary + rows:
//   { ticker, issuer, byYear:{yr:dps}, years:[yr], baseYear, baseDps,
//     growth, projectedDps, method, consistency, yearsCounted, expectedMonth,
//     partialCurrentYear }
export function buildForecast(divcal, refYear, opts) {
  const o = opts || {};
  const windowYears = o.windowYears || 3; // how many recent years count toward consistency
  const cal = Array.isArray(divcal) ? divcal : [];
  const target = refYear + 1;

  // Group ordinary events by ticker.
  const byTicker = new Map();
  for (const d of cal) {
    if (d._projected) continue; // never fold synthetic rows back in
    if (isExceptional(d)) continue; // one-offs don't forecast
    const yr = yearOf(d.pay_date);
    if (!yr) continue;
    const tk = String(d.ticker || "")
      .trim()
      .toUpperCase();
    if (!tk) continue;
    if (!byTicker.has(tk))
      byTicker.set(tk, { issuer: d.issuer || "", events: [] });
    byTicker.get(tk).events.push(d);
    if (!byTicker.get(tk).issuer && d.issuer)
      byTicker.get(tk).issuer = d.issuer;
  }

  const rows = [];
  for (const [tk, g] of byTicker) {
    // Per-year DPS = sum of that year's ordinary events.
    const byYear = {};
    for (const d of g.events) {
      const yr = yearOf(d.pay_date);
      byYear[yr] = (byYear[yr] || 0) + num(d.amount);
    }
    const years = Object.keys(byYear)
      .map(Number)
      .sort((a, b) => a - b);
    if (!years.length) continue;

    // The current (ref) year may be incomplete - the user is still entering it.
    const partialCurrentYear = byYear[refYear] || 0;
    // Complete years available for trending = years strictly before refYear,
    // plus refYear only if it's the sole data we have.
    const completeYears = years.filter((y) => y < refYear);
    const trendYears = (completeYears.length ? completeYears : years).map(
      (y) => ({
        year: y,
        dps: byYear[y],
      }),
    );

    const baseYear = trendYears[trendYears.length - 1].year;
    const baseDps = trendYears[trendYears.length - 1].dps;
    const growth = avgGrowth(trendYears);
    const method = trendYears.length >= 2 ? "trend" : "flat";
    const projectedDps =
      method === "trend"
        ? Math.round(baseDps * (1 + growth) * 10000) / 10000
        : baseDps;

    // Consistency over the last `windowYears` ending at refYear.
    let paid = 0;
    for (let y = refYear - windowYears + 1; y <= refYear; y++) {
      if (byYear[y] > 0) paid++;
    }
    const consistency = Math.round((paid / windowYears) * 100) / 100;

    rows.push({
      ticker: tk,
      issuer: g.issuer,
      byYear,
      years,
      baseYear,
      baseDps: Math.round(baseDps * 10000) / 10000,
      growth,
      projectedDps,
      method,
      consistency,
      yearsCounted: paid,
      windowYears,
      expectedMonth: expectedMonth(g.events),
      partialCurrentYear: Math.round(partialCurrentYear * 10000) / 10000,
    });
  }

  rows.sort((a, b) => (b.projectedDps || 0) - (a.projectedDps || 0));
  const totalDps = rows.reduce((s, r) => s + (r.projectedDps || 0), 0);
  return {
    targetYear: target,
    refYear,
    rows,
    totalDps: Math.round(totalDps * 10000) / 10000,
  };
}

// Build synthetic DIVCAL-shaped events for `targetYear` from a forecast, so the
// existing eligibility/income machinery can value them. shares are resolved by
// the caller via the usual heldBefore path; here we just emit the events.
// Each carries _forecast:true and the expected month (day 15 as a placeholder).
export function forecastEvents(forecast) {
  const out = [];
  for (const r of forecast.rows || []) {
    if (!(r.projectedDps > 0)) continue;
    const mm = String(r.expectedMonth || 6).padStart(2, "0");
    const pay = forecast.targetYear + "-" + mm + "-15";
    out.push({
      ticker: r.ticker,
      issuer: r.issuer,
      amount: r.projectedDps,
      ex_date: forecast.targetYear + "-" + mm + "-01",
      pay_date: pay,
      div_type: "Ordinary",
      _forecast: true,
      _method: r.method,
      _consistency: r.consistency,
    });
  }
  return out;
}

// Build a set of "already real" (ticker|year) keys from the calendar so we
// never synthesize a forecast on top of an announced event.
function realKeys(cal) {
  const set = new Set();
  for (const d of cal || []) {
    if (d._projected || d._forecast) continue;
    if (isExceptional(d)) continue;
    const yr = yearOf(d.pay_date);
    const tk = String((d && d.ticker) || "")
      .trim()
      .toUpperCase();
    if (yr && tk) set.add(tk + "|" + yr);
  }
  return set;
}

// Produce synthetic forecast events to FILL GAPS in the calendar:
//   - the rest of the CURRENT year (refYear) for tickers that paid in prior
//     years but have no announced event for refYear yet, and
//   - the whole NEXT year (refYear + 1).
// Real announced events always win: a (ticker, year) that already exists in the
// calendar is skipped. Current-year fills use the ticker's most recent complete
// year as the amount (flat) or the trend value; next-year uses the trend/flat
// projection. Every emitted event carries _forecast:true so the UI can badge it.
//
// Returns a flat array of DIVCAL-shaped events. The caller concatenates these
// onto DIVCAL and runs them through the normal eligibility/income machinery.
export function projectedCalendar(divcal, refYear, opts) {
  const cal = Array.isArray(divcal) ? divcal : [];
  const fc = buildForecast(cal, refYear, opts);
  const real = realKeys(cal);
  const out = [];

  for (const r of fc.rows) {
    if (!(r.projectedDps > 0)) continue;
    const mm = String(r.expectedMonth || 6).padStart(2, "0");

    // NEXT YEAR: full projection (unless already announced).
    const nextYr = refYear + 1;
    if (!real.has(r.ticker + "|" + nextYr)) {
      out.push({
        ticker: r.ticker,
        issuer: r.issuer,
        amount: r.projectedDps,
        ex_date: nextYr + "-" + mm + "-01",
        pay_date: nextYr + "-" + mm + "-15",
        div_type: "Ordinary",
        _forecast: true,
        _forecastYear: nextYr,
        _method: r.method,
        _consistency: r.consistency,
      });
    }

    // CURRENT YEAR gap-fill: only if the ticker has NO announced refYear event
    // and it has paid in the past (baseDps > 0). Uses the projected DPS as the
    // best estimate for this year too.
    if (!real.has(r.ticker + "|" + refYear) && r.baseDps > 0) {
      out.push({
        ticker: r.ticker,
        issuer: r.issuer,
        amount: r.projectedDps,
        ex_date: refYear + "-" + mm + "-01",
        pay_date: refYear + "-" + mm + "-15",
        div_type: "Ordinary",
        _forecast: true,
        _forecastYear: refYear,
        _method: r.method,
        _consistency: r.consistency,
      });
    }
  }
  return out;
}
