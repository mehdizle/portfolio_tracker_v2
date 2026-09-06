// ================= DIVIDEND FORECAST (reference estimate) =================
// Pure, DOM-free forecast built from the multi-year dividend calendar (DIVCAL).
//
// This is a REFERENCE estimate, not a guarantee. With only 2-3 years of history
// the projection is a rough guide. The math is deliberately transparent.
//
// SLOT MODEL (handles tickers that pay MORE THAN ONCE a year):
//   A ticker that historically paid, say, in June and December is treated as
//   TWO recurring payment "slots". Each slot is forecast separately - its own
//   month and its own amount trend - so the projection reproduces the real
//   payment cadence (e.g. an interim + a final dividend), not a single blob.
//
//   For each ticker we:
//     1. Drop exceptional/one-off events (they never recur -> never forecast).
//     2. Cluster the ordinary events by pay-MONTH into slots (nearby months
//        merge; the slot's month is the modal month of its members).
//     3. For each slot, build a per-year amount series and project next year:
//          - method "flat":  only one year -> repeat that amount.
//          - method "trend": >=2 years -> apply avg year-over-year growth
//            (geometric mean of ratios), clamped to a sane band.
//     4. The ticker's annual projected DPS = sum of its slots' projections.
//
//   The current (ref) year is usually INCOMPLETE (still being entered), so
//   trends use complete prior years as the base; the current year is reported
//   separately and is gap-filled per slot.
//
//   Consistency = (# years the ticker paid) / (# years in the window).

const MAX_GROWTH = 0.5; // clamp YoY growth to +/-50% so thin data can't explode.
const MIN_GROWTH = -0.5;
const REAL_MATCH_MONTHS = 1; // a real/recorded event within +/-1 month of a slot
// counts as "that slot already happened" (allows for a payment date drifting a
// few weeks year to year) without cross-suppressing an adjacent slot.

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
function tickerOf(d) {
  return String((d && d.ticker) || "")
    .trim()
    .toUpperCase();
}

// Geometric mean of consecutive growth ratios. series = [{year, amt}] asc.
function avgGrowth(series) {
  const ratios = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].amt,
      cur = series[i].amt;
    if (prev > 0 && cur > 0) ratios.push(cur / prev);
  }
  if (!ratios.length) return 0;
  const logSum = ratios.reduce((s, r) => s + Math.log(r), 0);
  const g = Math.exp(logSum / ratios.length) - 1;
  return Math.max(MIN_GROWTH, Math.min(MAX_GROWTH, g));
}

// Modal month of a list of {month} members; ties -> latest month.
function modalMonth(months) {
  const count = {};
  for (const m of months) if (m) count[m] = (count[m] || 0) + 1;
  let best = null,
    bestN = 0;
  for (const m in count) {
    const mm = +m;
    if (count[m] > bestN || (count[m] === bestN && mm > best)) {
      best = mm;
      bestN = count[m];
    }
  }
  return best;
}

// Most common value in a list of numbers (ties -> larger value).
function mode(nums) {
  const c = {};
  for (const n of nums) c[n] = (c[n] || 0) + 1;
  let best = null,
    bn = 0;
  for (const k in c) {
    const v = +k;
    if (c[k] > bn || (c[k] === bn && v > best)) {
      best = v;
      bn = c[k];
    }
  }
  return best;
}

// Cluster a ticker's ordinary events into recurring payment slots by their
// ORDINAL POSITION within the year (1st payment, 2nd payment, ...), NOT by
// absolute month proximity. This correctly handles quarterly / semi-annual
// payers (e.g. a REIT paying 4x a year in Apr/Jun/Sep/Dec) without collapsing
// nearby months, and is robust to a payment date drifting a few weeks.
//
// slotCount = the typical number of payments per year (mode of complete-year
// counts). Each event is assigned to slot = min(ordinal-in-year, slotCount-1).
// A slot's representative month is the modal pay-month of its members.
// Returns [{ month, events:[...] }] sorted by month.
function clusterSlots(events, refYear) {
  // Group by year, each year's events sorted by pay-date.
  const byYear = new Map();
  for (const d of events) {
    const yr = yearOf(d.pay_date);
    if (!yr) continue;
    if (!byYear.has(yr)) byYear.set(yr, []);
    byYear.get(yr).push(d);
  }
  for (const [, arr] of byYear)
    arr.sort((a, b) => (a.pay_date < b.pay_date ? -1 : 1));

  // Typical payments per year from COMPLETE years (before refYear); fall back
  // to all years, then to 1.
  const complete = [...byYear.keys()].filter(
    (y) => refYear == null || y < refYear,
  );
  const countYears = (complete.length ? complete : [...byYear.keys()]).map(
    (y) => byYear.get(y).length,
  );
  const slotCount = Math.max(1, mode(countYears) || 1);

  // Assign each event to its ordinal slot (capped at slotCount-1).
  const slots = Array.from({ length: slotCount }, () => ({
    months: [],
    events: [],
  }));
  for (const [, arr] of byYear) {
    arr.forEach((d, i) => {
      const idx = Math.min(i, slotCount - 1);
      slots[idx].events.push(d);
      const m = monthOf(d.pay_date);
      if (m) slots[idx].months.push(m);
    });
  }
  return slots
    .filter((s) => s.events.length)
    .map((s) => ({ month: modalMonth(s.months), events: s.events }))
    .sort((a, b) => a.month - b.month);
}

// Project one slot forward. Returns { month, byYear, years, baseYear, baseAmt,
// growth, method, projectedAmt }.
function projectSlot(slot, refYear) {
  const byYear = {};
  for (const d of slot.events) {
    const yr = yearOf(d.pay_date);
    byYear[yr] = (byYear[yr] || 0) + num(d.amount);
  }
  const years = Object.keys(byYear)
    .map(Number)
    .sort((a, b) => a - b);
  const complete = years.filter((y) => y < refYear);
  const trendYears = (complete.length ? complete : years).map((y) => ({
    year: y,
    amt: byYear[y],
  }));
  const baseYear = trendYears[trendYears.length - 1].year;
  const baseAmt = trendYears[trendYears.length - 1].amt;
  const growth = avgGrowth(trendYears);
  const method = trendYears.length >= 2 ? "trend" : "flat";
  const projectedAmt =
    method === "trend"
      ? Math.round(baseAmt * (1 + growth) * 10000) / 10000
      : Math.round(baseAmt * 10000) / 10000;
  return {
    month: slot.month,
    byYear,
    years,
    baseYear,
    baseAmt: Math.round(baseAmt * 10000) / 10000,
    growth,
    method,
    projectedAmt,
  };
}

// Build a per-ticker forecast for `targetYear` from the calendar.
// Returns { targetYear, refYear, rows:[...], totalDps } where each row is:
//   { ticker, issuer, byYear:{yr:annualDps}, years:[yr], baseYear, baseDps,
//     projectedDps, method, consistency, yearsCounted, windowYears,
//     paymentsPerYear, expectedMonth, partialCurrentYear, slots:[...] }
// slots[] carry the per-payment detail used by projectedCalendar.
export function buildForecast(divcal, refYear, opts) {
  const o = opts || {};
  const windowYears = o.windowYears || 3;
  const cal = Array.isArray(divcal) ? divcal : [];
  const target = refYear + 1;

  const byTicker = new Map();
  for (const d of cal) {
    if (d._projected || d._forecast) continue; // never fold synthetic rows back in
    if (isExceptional(d)) continue; // one-offs don't forecast
    if (!yearOf(d.pay_date)) continue;
    const tk = tickerOf(d);
    if (!tk) continue;
    if (!byTicker.has(tk))
      byTicker.set(tk, { issuer: d.issuer || "", events: [] });
    const g = byTicker.get(tk);
    g.events.push(d);
    if (!g.issuer && d.issuer) g.issuer = d.issuer;
  }

  const rows = [];
  for (const [tk, g] of byTicker) {
    const slots = clusterSlots(g.events, refYear).map((s) =>
      projectSlot(s, refYear),
    );
    if (!slots.length) continue;

    // Annual roll-up across slots.
    const byYear = {};
    for (const s of slots) {
      for (const y in s.byYear) byYear[y] = (byYear[y] || 0) + s.byYear[y];
    }
    const years = Object.keys(byYear)
      .map(Number)
      .sort((a, b) => a - b);
    const projectedDps =
      Math.round(slots.reduce((sum, s) => sum + s.projectedAmt, 0) * 10000) /
      10000;
    // Base year/DPS for display = most recent complete year (or only year).
    const complete = years.filter((y) => y < refYear);
    const baseYear = (complete.length ? complete : years).slice(-1)[0];
    const baseDps = Math.round((byYear[baseYear] || 0) * 10000) / 10000;
    // Row-level (annual) growth for display = how the projected annual DPS
    // compares to the base year's annual DPS. This is a single, meaningful
    // number even for multi-slot tickers (each slot has its own growth).
    const annualGrowth =
      baseDps > 0
        ? Math.round((projectedDps / baseDps - 1) * 10000) / 10000
        : 0;

    let paid = 0;
    for (let y = refYear - windowYears + 1; y <= refYear; y++)
      if (byYear[y] > 0) paid++;
    const consistency = Math.round((paid / windowYears) * 100) / 100;

    // Typical payments per year = max slot-count observed in a complete year,
    // falling back to the number of distinct slots.
    const perYearCount = {};
    for (const s of slots)
      for (const y in s.byYear) perYearCount[y] = (perYearCount[y] || 0) + 1;
    const completeCounts = years
      .filter((y) => y < refYear)
      .map((y) => perYearCount[y] || 0);
    const paymentsPerYear = completeCounts.length
      ? Math.max(...completeCounts)
      : slots.length;

    rows.push({
      ticker: tk,
      issuer: g.issuer,
      byYear,
      years,
      baseYear,
      baseDps,
      projectedDps,
      growth: annualGrowth,
      method: slots.some((s) => s.method === "trend") ? "trend" : "flat",
      consistency,
      yearsCounted: paid,
      windowYears,
      paymentsPerYear,
      expectedMonth: slots.length ? slots[0].month : null,
      partialCurrentYear: Math.round((byYear[refYear] || 0) * 10000) / 10000,
      slots,
    });
  }

  rows.sort((a, b) => (b.projectedDps || 0) - (a.projectedDps || 0));
  const totalDps =
    Math.round(rows.reduce((s, r) => s + (r.projectedDps || 0), 0) * 10000) /
    10000;
  return { targetYear: target, refYear, rows, totalDps };
}

// Emit one synthetic DIVCAL-shaped event PER SLOT for the forecast's targetYear.
// Preserves multiple-payments-per-year cadence. Each carries _forecast:true.
export function forecastEvents(forecast) {
  const out = [];
  for (const r of forecast.rows || []) {
    for (const s of r.slots || []) {
      if (!(s.projectedAmt > 0)) continue;
      const mm = String(s.month || 6).padStart(2, "0");
      out.push({
        ticker: r.ticker,
        issuer: r.issuer,
        amount: s.projectedAmt,
        ex_date: forecast.targetYear + "-" + mm + "-01",
        pay_date: forecast.targetYear + "-" + mm + "-15",
        div_type: "Ordinary",
        _forecast: true,
        _forecastYear: forecast.targetYear,
        _method: s.method,
        _consistency: r.consistency,
      });
    }
  }
  return out;
}

// Set of "already real" (ticker|year|month-slot) keys so we never synthesize a
// forecast on top of an announced payment. We key by ticker+year+slot-month
// (rounded to the slot) so a ticker with a real June event still gets its
// forecast December event filled if December isn't announced yet.
function realSlotKeys(cal) {
  const set = new Set();
  for (const d of cal || []) {
    if (d._projected || d._forecast) continue;
    if (isExceptional(d)) continue;
    const yr = yearOf(d.pay_date);
    const mo = monthOf(d.pay_date);
    const tk = tickerOf(d);
    if (yr && mo && tk) set.add(tk + "|" + yr + "|" + mo);
  }
  return set;
}
// Does the calendar already have a real event for this ticker+year near `month`?
// Uses a tight +/-1 month tolerance so an adjacent slot (which can be as close
// as ~2 months for a quarterly payer) is never wrongly suppressed.
function hasRealNear(realSet, tk, year, month) {
  for (let dm = -REAL_MATCH_MONTHS; dm <= REAL_MATCH_MONTHS; dm++) {
    const m = month + dm;
    if (m >= 1 && m <= 12 && realSet.has(tk + "|" + year + "|" + m))
      return true;
  }
  return false;
}

// Produce synthetic forecast events to FILL GAPS in the calendar, PER SLOT:
//   - the rest of the CURRENT year (refYear): for each recurring slot a ticker
//     historically paid, emit it if that slot isn't already announced this year
//     (so a ticker that pays twice a year gets BOTH payments forecast, and a
//     ticker that already announced its June payment still gets December), and
//   - the whole NEXT year (refYear + 1), one event per slot.
// Real announced payments always win (a slot already present is skipped).
// Returns a flat array of DIVCAL-shaped events, each tagged _forecast:true.
export function projectedCalendar(divcal, refYear, opts) {
  const o = opts || {};
  const cal = Array.isArray(divcal) ? divcal : [];
  const fc = buildForecast(cal, refYear, o);
  const real = realSlotKeys(cal);
  // Fold in recorded DIV payments (opts.recorded = [{ticker, year, month}])
  // so an already-received payment that lives only in the transaction ledger
  // (not the calendar) is treated as "real" and never re-forecast.
  for (const rec of o.recorded || []) {
    const tk = String((rec && rec.ticker) || "")
      .trim()
      .toUpperCase();
    if (tk && rec.year && rec.month)
      real.add(tk + "|" + rec.year + "|" + rec.month);
  }
  // Guard: don't forecast a CURRENT-year payment whose month has already
  // passed (opts.currentMonth = 1..12). A month that's already gone either paid
  // (and should be a real/recorded event) or was skipped - re-injecting it as
  // "upcoming" income is wrong. Only applies to refYear; next year is unaffected.
  const curMonth = o.currentMonth || 0;
  const out = [];

  const emit = (r, s, year) => {
    if (!(s.projectedAmt > 0)) return;
    if (hasRealNear(real, r.ticker, year, s.month)) return;
    if (year === refYear && curMonth && s.month < curMonth) return;
    const mm = String(s.month || 6).padStart(2, "0");
    out.push({
      ticker: r.ticker,
      issuer: r.issuer,
      amount: s.projectedAmt,
      ex_date: year + "-" + mm + "-01",
      pay_date: year + "-" + mm + "-15",
      div_type: "Ordinary",
      _forecast: true,
      _forecastYear: year,
      _method: s.method,
      _consistency: r.consistency,
    });
  };

  const nextYr = refYear + 1;
  for (const r of fc.rows) {
    for (const s of r.slots || []) {
      emit(r, s, nextYr); // next year: full per-slot projection
      if (s.baseAmt > 0) emit(r, s, refYear); // current year: gap-fill per slot
    }
  }
  return out;
}
