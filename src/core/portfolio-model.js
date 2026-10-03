// ============================================================
// portfolio-model.js - the target-weight REBALANCE engine (pure, tested).
//
// Replaces the old greedy "fill the cheapest underweight sector" loop with a
// model-portfolio approach used in modern long-only management:
//   1. score every eligible name's ATTRACTIVENESS (quality x value x conviction,
//      risk-adjusted by volatility);
//   2. turn scores into TARGET WEIGHTS, clamped by sector + single-name caps and
//      renormalised to the investable sleeve (minus any deliberate cash reserve);
//   3. compare targets to ACTUAL holdings -> the drift -> the concrete BUY/SELL
//      trades that close the gap (fee + whole-share aware, via injected helpers);
//   4. it may leave cash IDLE on purpose when nothing clears the attractiveness
//      bar (holding cash to wait is a valid choice, not a failure).
//
// DELIBERATE SCOPE: per-asset volatility is estimated and used to risk-adjust
// each target. Full mean-variance / covariance optimisation is NOT done - with
// ~20 thin Casablanca names + weekly-priced funds the covariance matrix is
// unstable and yields confident nonsense, so we stop at per-name risk-adjustment.
//
// Pure module: no DOM, no globals. All fee/tax/whole-share math is INJECTED as
// callbacks (buyCost, sellNet, lotRound) so this stays environment-free and the
// UI keeps owning the broker specifics. Everything tolerates missing inputs.
// ============================================================

const EPS = 1e-9;
const TRADING_DAYS = 252;

function _num(v) {
  return typeof v === "number" && isFinite(v);
}
function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

// ---- Volatility ------------------------------------------------------------
// Annualised volatility from a dated close series. `series` is an array of
// { date:"YYYY-MM-DD", close:number } (or [date, close] pairs), ascending.
// SPACING-AWARE: weekly-priced funds have ~7-day gaps; annualising their
// per-observation stdev with sqrt(252) would massively overstate vol (a weekly
// fund looked like ~40% vs its true ~18%). We annualise by the MEDIAN spacing:
// factor = sqrt(TRADING_DAYS / medianGapTradingDays). Returns null when there
// are too few returns to be meaningful (caller treats null as neutral risk).
export function annualizedVol(series, opts) {
  const o = opts || {};
  const minReturns = o.minReturns != null ? o.minReturns : 20;
  const rows = (series || [])
    .map((r) => (Array.isArray(r) ? { date: r[0], close: +r[1] } : r))
    .filter((r) => r && r.date && _num(+r.close) && +r.close > 0)
    .map((r) => ({ date: r.date, close: +r.close }));
  if (rows.length < minReturns + 1) return null;

  const rets = [];
  const gaps = []; // calendar days between consecutive observations
  for (let i = 1; i < rows.length; i++) {
    const p0 = rows[i - 1].close;
    const p1 = rows[i].close;
    if (p0 > 0 && p1 > 0) {
      rets.push(Math.log(p1 / p0));
      const d =
        (new Date(rows[i].date) - new Date(rows[i - 1].date)) / 86400000;
      if (d > 0) gaps.push(d);
    }
  }
  if (rets.length < minReturns) return null;

  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const variance =
    rets.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (rets.length - 1);
  const perObsStd = Math.sqrt(variance);

  // Median calendar gap -> trading-day gap (~5/7 of calendar). periodsPerYear
  // is how many such observations fit in a trading year.
  gaps.sort((a, b) => a - b);
  const medGapCal = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1;
  const medGapTrading = Math.max(1, medGapCal * (5 / 7));
  const periodsPerYear = TRADING_DAYS / medGapTrading;
  return perObsStd * Math.sqrt(periodsPerYear);
}

// ---- Attractiveness --------------------------------------------------------
// Per-name attractiveness A = base x valueMult x convMult / riskAdj.
//  - base:   factorScores().score in 0..1 (quality/growth/value/yield/safety).
//  - value:  two-sided discount to fair value, 1 + kV*disc, clamped. kV scales
//            with the value/diversification slider (valueTilt in 0..1).
//  - conv:   High 1.15 / Medium 1.0 / Low 0.85.
//  - riskAdj: relative vol = max(vol, volFloor)/volRef; higher vol -> smaller
//            target. Missing vol -> 1 (neutral, flagged by caller).
// Returns a non-negative number (0 if base is missing or <=0). A Sell-rated or
// zero-base name should be given target 0 upstream.
export function attractiveness(c, opts) {
  const o = opts || {};
  const valueTilt = clamp(o.valueTilt != null ? o.valueTilt : 0, 0, 1);
  const base = _num(c.base) ? Math.max(0, c.base) : 0;
  if (base <= 0) return 0;

  // Value multiplier: discount>0 (cheap) lifts, discount<0 (rich) cuts. The
  // sensitivity kV grows from 0.6 (diversification) to 1.6 (value-led).
  const kV = 0.6 + 1.0 * valueTilt;
  const disc = _num(c.disc) ? c.disc : 0;
  const valueMult = clamp(1 + kV * disc, 0.4, 1.8);

  const convMult =
    c.conviction === "High" ? 1.15 : c.conviction === "Low" ? 0.85 : 1.0;

  let riskAdj = 1;
  if (o.riskAdjust !== false && _num(c.vol) && _num(o.volRef) && o.volRef > 0) {
    const volFloor = o.volFloor != null ? o.volFloor : 0.08;
    riskAdj = Math.max(c.vol, volFloor) / o.volRef;
    riskAdj = clamp(riskAdj, 0.5, 2.5); // never let one vol dominate/erase a name
  }
  return (base * valueMult * convMult) / riskAdj;
}

// Median helper (true median, average of middles on even counts).
function median(xs) {
  const a = xs
    .filter(_num)
    .slice()
    .sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// ---- Target weights --------------------------------------------------------
// candidates: [{ ticker, cat, base, disc, conviction, vol, sellRated }]
// caps: { nameCap (0..1), sectorCap (0..1), opcvmCap (0..1), opcvmCats:Set|arr }
// opts: { valueTilt, riskAdjust, volFloor, reservePct (0..1) }
// Returns { weights: {ticker:w}, attract: {ticker:A}, volRef, dropped:[...] }
// where weights sum to (1 - reservePct) of the sleeve. Sell-rated / zero-base
// names get weight 0. Capped-renormalisation runs to convergence so no name
// exceeds nameCap and no sector exceeds its cap.
export function targetWeights(candidates, caps, opts) {
  const o = opts || {};
  const c = caps || {};
  const nameCap = c.nameCap != null ? c.nameCap : 0.2;
  const sectorCap = c.sectorCap != null ? c.sectorCap : 0.2;
  const opcvmCap = c.opcvmCap != null ? c.opcvmCap : 0.35;
  const opcvmSet = new Set(c.opcvmCats || ["OPCVM"]);
  const reservePct = clamp(o.reservePct != null ? o.reservePct : 0, 0, 0.95);
  const budget = 1 - reservePct;

  const vols = candidates.map((x) => x.vol).filter(_num);
  const volRef = median(vols) || 0.25;

  const attract = {};
  const list = [];
  for (const cand of candidates || []) {
    if (!cand || !cand.ticker) continue;
    const A = cand.sellRated
      ? 0
      : attractiveness({ ...cand }, { ...o, volRef });
    attract[cand.ticker] = A;
    if (A > EPS) list.push({ ...cand, A });
  }
  const totalA = list.reduce((s, x) => s + x.A, 0);
  const weights = {};
  for (const cand of candidates || [])
    if (cand && cand.ticker) weights[cand.ticker] = 0;
  if (totalA <= EPS) return { weights, attract, volRef, dropped: [] };

  // ---- Capped water-filling ----
  // Caps are HARD constraints; the budget is a target we approach but never
  // breach a cap to reach. Allocate the budget across names in proportion to
  // attractiveness, but no name may exceed nameCap and no sector may exceed its
  // cap. We "fill" iteratively: distribute the remaining budget over names that
  // still have headroom (vs BOTH their own name cap and their sector's remaining
  // room), pinning any that hit a ceiling, until the budget is placed or no
  // headroom remains. If caps make the full budget infeasible, the leftover is
  // simply not allocated (it becomes implicit cash - a valid outcome, since
  // forcing a cap breach to deploy every MAD would wreck diversification).
  const sectorCapOf = (cat) => (opcvmSet.has(cat) ? opcvmCap : sectorCap);
  for (const x of list) x.w = 0;
  let toPlace = budget;
  for (let iter = 0; iter < 200 && toPlace > 1e-7; iter++) {
    // Names with remaining headroom: below their name cap AND their sector has
    // remaining room below its sector cap.
    const secUsed = {};
    for (const x of list) secUsed[x.cat] = (secUsed[x.cat] || 0) + x.w;
    const open = list.filter((x) => {
      const nameRoom = nameCap - x.w;
      const secRoom = sectorCapOf(x.cat) - (secUsed[x.cat] || 0);
      return nameRoom > 1e-9 && secRoom > 1e-9;
    });
    if (!open.length) break; // fully capped out -> remainder stays as cash
    const openA = open.reduce((s, x) => s + x.A, 0);
    if (openA <= EPS) break;
    let placedThisPass = 0;
    // Tentatively allocate toPlace across open names by attractiveness, but clip
    // each to its binding headroom (min of name room and its share of sector room).
    for (const x of open) {
      const want = toPlace * (x.A / openA);
      const nameRoom = nameCap - x.w;
      // Sector room is shared; approximate per-name cap by the whole sector's
      // remaining room (the loop re-checks sector totals next pass, so over-
      // allocation self-corrects on the following iteration).
      const secRoom = sectorCapOf(x.cat) - (secUsed[x.cat] || 0);
      const add = Math.min(want, nameRoom, Math.max(0, secRoom));
      if (add > 0) {
        x.w += add;
        secUsed[x.cat] = (secUsed[x.cat] || 0) + add;
        placedThisPass += add;
      }
    }
    toPlace -= placedThisPass;
    if (placedThisPass <= 1e-9) break; // no progress -> infeasible, stop
  }

  for (const x of list) weights[x.ticker] = x.w;
  return { weights, attract, volRef, dropped: [] };
}

// ---- Trade planning --------------------------------------------------------
// Turn target weights + current positions + cash into concrete trades.
// targets: { weights, attract } from targetWeights.
// positions: [{ ticker, cat, held, price, value, avg, sellRated, buyOrHold,
//               quality, fv, isFund }]  (value = current MAD value)
// cash: new cash to invest (MAD). sleeve = cash + sum(current value).
// helpers: { buyCost(ticker,qty,price), sellNet(ticker,qty,price), lotRound(ticker,qty) }
// opts: { minAttract, trimWinners, trimTolerance, overvaluedBand, dcaBoost,
//         recycleTrims, maxBuys }
// Returns { buys:[], sells:[], holdCash, rows:[per-name model-vs-actual], notes:[] }
export function planTrades(targets, positions, cash, helpers, opts) {
  const o = opts || {};
  const h = helpers || {};
  const buyCost = h.buyCost || ((tk, q, p) => q * p);
  const sellNet = h.sellNet || ((tk, q, p) => q * p);
  const lotRound = h.lotRound || ((tk, q) => Math.floor(q));
  const minAttract = o.minAttract != null ? o.minAttract : 0;
  const trimWinners = !!o.trimWinners;
  const trimTol = o.trimTolerance != null ? o.trimTolerance : 0.25; // +/- band
  const overBand = o.overvaluedBand != null ? o.overvaluedBand : 1.1; // price>fv*band
  const dcaBoost = o.dcaBoost != null ? o.dcaBoost : 0;
  const maxBuys = o.maxBuys != null ? o.maxBuys : 8;

  const w = targets.weights || {};
  const attract = targets.attract || {};
  const posByTk = {};
  for (const p of positions || []) if (p && p.ticker) posByTk[p.ticker] = p;

  const curValue = (positions || []).reduce(
    (s, p) => s + (_num(p.value) ? p.value : 0),
    0,
  );
  const sleeve = curValue + Math.max(0, _num(cash) ? cash : 0);

  // Union of held names + names with a positive target.
  const names = new Set();
  for (const p of positions || []) if (p && p.ticker) names.add(p.ticker);
  for (const tk in w) if (w[tk] > EPS) names.add(tk);

  const rows = [];
  const sells = [];
  const buys = [];
  const notes = [];

  // ---- SELLS first (free up cash + reflect post-trim state) ----
  for (const tk of names) {
    const p = posByTk[tk];
    if (!p || !(p.held > EPS) || !_num(p.price)) continue;
    const targetVal = (w[tk] || 0) * sleeve;
    const curVal = p.value;
    const curWt = sleeve > EPS ? curVal / sleeve : 0;
    const tgtWt = w[tk] || 0;

    let reason = null;
    let toSellVal = 0;
    const overvalued = _num(p.fv) && p.fv > 0 && p.price > p.fv * overBand;
    if (p.sellRated || (w[tk] || 0) <= EPS) {
      // Full exit: engine wants nothing here (Sell-rated or zero target).
      reason = p.sellRated ? "Sell-rated" : "not in model";
      toSellVal = curVal;
    } else if (overvalued) {
      reason = "above fair value";
      toSellVal = Math.max(0, curVal - targetVal); // trim toward target
    } else if (trimWinners && curWt > tgtWt * (1 + trimTol) + EPS) {
      reason = "over target";
      toSellVal = curVal - targetVal;
    }
    if (reason && toSellVal > EPS) {
      let qty = lotRound(tk, toSellVal / p.price);
      if (qty > p.held) qty = p.held;
      if (qty > EPS) {
        const net = sellNet(tk, qty, p.price);
        if (net > EPS) {
          sells.push({
            ticker: tk,
            qty,
            price: p.price,
            net,
            reason,
            curWt,
            tgtWt,
          });
        }
      }
    }
  }

  // Cash available for buys = new cash (+ recycled trim proceeds if enabled).
  let remaining = Math.max(0, _num(cash) ? cash : 0);
  if (o.recycleTrims) remaining += sells.reduce((s, x) => s + x.net, 0);

  // ---- BUYS: close positive drift, ranked by (drift x attractiveness) ----
  // Only names that clear the min-attractiveness bar are eligible; otherwise
  // the cash they'd absorb is intentionally left idle.
  const buyCands = [];
  for (const tk of names) {
    const p = posByTk[tk];
    const tgtWt = w[tk] || 0;
    if (tgtWt <= EPS) continue;
    const A = attract[tk] || 0;
    if (A < minAttract) continue;
    const curVal = p && _num(p.value) ? p.value : 0;
    const targetVal = tgtWt * sleeve;
    const gap = targetVal - curVal;
    if (gap <= EPS) continue;
    // DCA: a held name below the user's avg cost, still sound, gets a boost.
    let dca = 0;
    if (
      p &&
      p.held > EPS &&
      _num(p.avg) &&
      _num(p.price) &&
      p.price < p.avg &&
      p.buyOrHold &&
      (!_num(p.quality) || p.quality >= 0.45)
    ) {
      dca = dcaBoost * ((p.avg - p.price) / p.avg);
    }
    buyCands.push({ tk, p, gap, A, rank: gap * A * (1 + dca), dca });
  }
  buyCands.sort((a, b) => b.rank - a.rank);

  const distinct = new Set();
  for (const bc of buyCands) {
    if (remaining <= EPS) break;
    const alreadyHeld = bc.p && bc.p.held > EPS;
    if (!alreadyHeld && distinct.size >= maxBuys) continue;
    const price = bc.p && _num(bc.p.price) ? bc.p.price : null;
    // price must come from the position OR the candidate; UI supplies it.
    const px = price != null ? price : bc.price;
    if (!_num(px) || px <= 0) continue;
    // Buy as close to the gap as cash + whole-share lots allow.
    let qty = lotRound(bc.tk, bc.gap / px);
    while (qty > 0 && buyCost(bc.tk, qty, px) > remaining)
      qty = lotRound(bc.tk, qty - 1);
    if (qty <= EPS) {
      // can't even afford a minimal lot; skip (cash may stay idle)
      continue;
    }
    const cost = buyCost(bc.tk, qty, px);
    if (cost > remaining + EPS) continue;
    remaining -= cost;
    distinct.add(bc.tk);
    buys.push({
      ticker: bc.tk,
      qty,
      price: px,
      cost,
      gap: bc.gap,
      attract: bc.A,
      dca: bc.dca > 0,
    });
  }

  // ---- model-vs-actual rows (for the table) ----
  for (const tk of names) {
    const p = posByTk[tk];
    const curVal = p && _num(p.value) ? p.value : 0;
    const tgtWt = w[tk] || 0;
    const buy = buys.find((b) => b.ticker === tk);
    const sell = sells.find((s) => s.ticker === tk);
    rows.push({
      ticker: tk,
      curWt: sleeve > EPS ? curVal / sleeve : 0,
      tgtWt,
      curVal,
      targetVal: tgtWt * sleeve,
      attract: attract[tk] || 0,
      action: buy
        ? "Buy " + buy.qty
        : sell
          ? (sell.reason === "Sell-rated" || sell.reason === "not in model"
              ? "Exit "
              : "Trim ") + sell.qty
          : p && p.held > EPS
            ? "Hold"
            : "-",
    });
  }
  rows.sort((a, b) => b.tgtWt - a.tgtWt);

  const deployed = buys.reduce((s, b) => s + b.cost, 0);
  const holdCash = Math.max(0, (_num(cash) ? cash : 0) - deployed);
  if (holdCash > EPS && buyCands.length === 0)
    notes.push(
      "No name clears the attractiveness bar - holding cash to wait for a better entry.",
    );
  else if (holdCash > EPS)
    notes.push(
      "Partially deployed; remaining cash held (whole-share lots / cap limits / attractiveness bar).",
    );

  return { buys, sells, holdCash, sleeve, rows, notes };
}
