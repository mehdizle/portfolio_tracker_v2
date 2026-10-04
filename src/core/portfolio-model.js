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

// Allocate a sell of `qty` shares across tax lots to MINIMISE the capital-gains
// hit. `lots` = [{ qty, cost (per-share), pea }]. Preference: PEA lots first
// (gains tax-exempt), then Regular lots HIGHEST cost-basis first (smallest gain
// per share / realise losses before gains). Returns an array of
// { account, qty, costPS, gainPS } slices totalling `qty`. If `lots` is absent,
// returns a single undifferentiated slice so callers still work.
export function allocSellLots(lots, qty, price) {
  if (!Array.isArray(lots) || !lots.length) {
    return [{ account: "", qty, costPS: null, gainPS: null }];
  }
  const norm = lots
    .filter((l) => l && _num(l.qty) && l.qty > 0)
    .map((l) => ({
      qty: l.qty,
      costPS: _num(l.cost) ? l.cost : 0,
      pea: !!l.pea,
    }));
  // Sort: PEA before Regular; within each, highest cost-basis first.
  norm.sort((a, b) => {
    if (a.pea !== b.pea) return a.pea ? -1 : 1;
    return b.costPS - a.costPS;
  });
  const out = [];
  let rem = qty;
  for (const l of norm) {
    if (rem <= EPS) break;
    const take = Math.min(rem, l.qty);
    if (take <= EPS) continue;
    out.push({
      account: l.pea ? "PEA" : "Regular",
      qty: take,
      costPS: l.costPS,
      gainPS: _num(price) ? price - l.costPS : null,
    });
    rem -= take;
  }
  if (rem > EPS)
    out.push({ account: "", qty: rem, costPS: null, gainPS: null });
  return out;
}

// The account that holds the biggest slice of a lot plan (for the row label).
function _dominantAccount(lotPlan) {
  if (!Array.isArray(lotPlan) || !lotPlan.length) return "";
  const byAcct = {};
  for (const s of lotPlan) byAcct[s.account] = (byAcct[s.account] || 0) + s.qty;
  let best = "",
    bestQ = -1;
  for (const a in byAcct)
    if (byAcct[a] > bestQ) {
      bestQ = byAcct[a];
      best = a;
    }
  return best;
}

// ---- Target weights --------------------------------------------------------
// candidates: [{ ticker, cat, base, disc, conviction, vol, sellRated }]
// caps: { nameCap (0..1), sectorCap (0..1), opcvmCap (0..1), opcvmCats:Set|arr }
// opts: { valueTilt, riskAdjust, volFloor, reservePct (0..1),
//         pinned:{ticker: weight 0..1} }
// `pinned` lets the user MANUALLY fix a name's target weight (override the
// model). Each pin is clamped to nameCap and the sleeve budget; pinned names are
// then held fixed and the REMAINING budget is water-filled across the rest
// (respecting caps). This is how the UI's per-name "pin" control works.
// Returns { weights: {ticker:w}, attract: {ticker:A}, volRef, pinned:{...} }
// where weights sum to (1 - reservePct) of the sleeve (minus any infeasible
// remainder). Sell-rated / zero-base names get weight 0.
export function targetWeights(candidates, caps, opts) {
  const o = opts || {};
  const c = caps || {};
  const nameCap = c.nameCap != null ? c.nameCap : 0.2;
  const sectorCap = c.sectorCap != null ? c.sectorCap : 0.2;
  const opcvmCap = c.opcvmCap != null ? c.opcvmCap : 0.35;
  const opcvmSet = new Set(c.opcvmCats || ["OPCVM"]);
  const reservePct = clamp(o.reservePct != null ? o.reservePct : 0, 0, 0.95);
  const budget = 1 - reservePct;
  const pinsIn = o.pinned || {};

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
  const weights = {};
  for (const cand of candidates || [])
    if (cand && cand.ticker) weights[cand.ticker] = 0;

  // ---- Pinned overrides: fix these names, hold out their budget ----
  // A pin applies even to a name the model would score 0 (the user is forcing
  // it in). Each pin is clamped to [0, nameCap] and the running pin total is
  // clamped to the sleeve budget (earlier pins win if they'd overflow).
  const pinned = {};
  let pinnedTotal = 0;
  for (const tk of Object.keys(pinsIn)) {
    let pw = +pinsIn[tk];
    if (!_num(pw) || pw < 0) continue;
    pw = Math.min(pw, nameCap);
    pw = Math.min(pw, Math.max(0, budget - pinnedTotal));
    pinned[tk] = pw;
    pinnedTotal += pw;
    weights[tk] = pw; // record even if not in `list`
  }
  const flexList = list.filter((x) => !(x.ticker in pinned));
  const flexBudget = Math.max(0, budget - pinnedTotal);
  const totalA = flexList.reduce((s, x) => s + x.A, 0);
  if (totalA <= EPS || flexBudget <= EPS)
    return { weights, attract, volRef, pinned, dropped: [] };

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
  // Sector usage seeded with PINNED weights so pins count against their sector
  // cap (a pin can leave little/no room for the model's own picks in that sector).
  // A pin on a name that is NOT in the candidate universe still consumes
  // sleeve budget, so it must also consume its sector's headroom or the flex
  // picks could fill that sector up to cap ON TOP of the pin (bounded over-
  // concentration). The candidate list is the first source of a ticker's
  // category; when the pinned name isn't a candidate we fall back to the
  // caller-supplied `pinnedCats` map (ticker -> cat). Unknown-category pins
  // (neither source resolves) still can't be charged to any sector.
  const pinnedCats = o.pinnedCats || {};
  const pinnedSecUsed = {};
  for (const tk of Object.keys(pinned)) {
    const cand = list.find((x) => x.ticker === tk);
    const cat = cand ? cand.cat : pinnedCats[tk] || null;
    if (cat) pinnedSecUsed[cat] = (pinnedSecUsed[cat] || 0) + pinned[tk];
  }
  for (const x of flexList) x.w = 0;
  let toPlace = flexBudget;
  for (let iter = 0; iter < 200 && toPlace > 1e-7; iter++) {
    // Names with remaining headroom: below their name cap AND their sector has
    // remaining room below its sector cap (pinned usage counts against it).
    const secUsed = {};
    for (const x of flexList) secUsed[x.cat] = (secUsed[x.cat] || 0) + x.w;
    const secTotal = (cat) => (secUsed[cat] || 0) + (pinnedSecUsed[cat] || 0);
    const open = flexList.filter((x) => {
      const nameRoom = nameCap - x.w;
      const secRoom = sectorCapOf(x.cat) - secTotal(x.cat);
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
      const secRoom = sectorCapOf(x.cat) - secTotal(x.cat);
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

  for (const x of flexList) weights[x.ticker] = x.w;
  return { weights, attract, volRef, pinned, dropped: [] };
}

// ---- Trade planning --------------------------------------------------------
// Turn target weights + current positions + cash into concrete trades.
// targets: { weights, attract } from targetWeights.
// positions: [{ ticker, cat, held, price, value, avg, sellRated, buyOrHold,
//               quality, fv, isFund }]  (value = current MAD value)
// cash: new cash to invest (MAD). sleeve = cash + sum(current value).
// helpers: { buyCost(ticker,qty,price), sellNet(ticker,qty,price), lotRound(ticker,qty) }
// opts: { minAttract, suggestTrims, trimWinners, trimTolerance, overvaluedBand,
//         dcaBoost, recycleTrims, maxBuys, prices:{ticker:price} }
// `prices` supplies a price for NON-held buy candidates (new names have no
// position to read one from); held names use their position price.
// positions may also carry: cat, cyc, sty, vol (for the readout), and lots:[{qty,
//   cost, pea}] (for tax-lot-aware trim ordering - prefer PEA then highest-cost).
// Returns { buys, sells, holdCash, sleeve, rows, notes,
//           skipped:[{ticker, reason}],          // positive target, no buy (why)
//           readout:{ sectors, cycles, styles, wAttract, wVol, cashPct } }
export function planTrades(targets, positions, cash, helpers, opts) {
  const o = opts || {};
  const h = helpers || {};
  const buyCost = h.buyCost || ((tk, q, p) => q * p);
  const sellNet = h.sellNet || ((tk, q, p) => q * p);
  const lotRound = h.lotRound || ((tk, q) => Math.floor(q));
  const minAttract = o.minAttract != null ? o.minAttract : 0;
  // suggestTrims gates the ENTIRE sell pass. Default true (back-compat); when
  // false the engine proposes buys only and never recommends selling anything.
  const suggestTrims = o.suggestTrims !== false;
  const trimWinners = !!o.trimWinners;
  const trimTol = o.trimTolerance != null ? o.trimTolerance : 0.25; // +/- band
  const overBand = o.overvaluedBand != null ? o.overvaluedBand : 1.1; // price>fv*band
  const dcaBoost = o.dcaBoost != null ? o.dcaBoost : 0;
  const maxBuys = o.maxBuys != null ? o.maxBuys : 8;
  // Price lookup for NON-held buy candidates (a new name has no position to read
  // a price from). The UI supplies { ticker: price } for every model candidate.
  const prices = o.prices || {};
  // Category metadata for candidates not currently held, so the post-plan
  // readout can group a newly-bought name by its real sector/cycle/style
  // instead of "Uncategorized". Shape: { ticker: { cat, cyc, sty, name } }.
  const candMeta = o.meta || {};

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
  // Entire sell pass is skipped when suggestTrims is off: the plan then only
  // proposes buys and never recommends trimming/exiting any holding.
  for (const tk of suggestTrims ? names : []) {
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
          // TAX-LOT-AWARE allocation: decide WHICH shares to sell to minimise
          // the capital-gains hit. Order of preference:
          //   1. PEA lots (capital gains are tax-exempt in a PEA);
          //   2. then Regular lots, HIGHEST cost-basis first (smallest taxable
          //      gain per share, and realises losses before gains).
          // `p.lots` is [{qty, cost(perShare), pea}]. Falls back to a single
          // undifferentiated lot when lot detail isn't supplied.
          const lotPlan = allocSellLots(p.lots, qty, p.price);
          sells.push({
            ticker: tk,
            qty,
            price: p.price,
            net,
            reason,
            curWt,
            tgtWt,
            lotPlan, // [{ account:"PEA"/"Regular", qty, costPS, gainPS }]
            account: _dominantAccount(lotPlan),
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
  // the cash they'd absorb is intentionally left idle. `skip` records WHY a
  // positive-target name didn't get bought (surfaced in the UI's "why not").
  const skip = {}; // ticker -> reason
  const buyCands = [];
  for (const tk of names) {
    const p = posByTk[tk];
    const tgtWt = w[tk] || 0;
    if (tgtWt <= EPS) continue;
    const A = attract[tk] || 0;
    if (A < minAttract) {
      skip[tk] =
        "below the attractiveness bar (" +
        A.toFixed(2) +
        " < " +
        minAttract +
        ")";
      continue;
    }
    const curVal = p && _num(p.value) ? p.value : 0;
    const targetVal = tgtWt * sleeve;
    const gap = targetVal - curVal;
    if (gap <= EPS) continue; // already at/above target - nothing to buy
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
    const alreadyHeld = bc.p && bc.p.held > EPS;
    if (remaining <= EPS) {
      skip[bc.tk] = "cash ran out before reaching this name";
      continue;
    }
    if (!alreadyHeld && distinct.size >= maxBuys) {
      skip[bc.tk] = "max new-names limit (" + maxBuys + ") reached";
      continue;
    }
    // Price source: the held position, else the UI-supplied prices map (new
    // names aren't in `positions`, so their price must come from `prices`).
    const px =
      bc.p && _num(bc.p.price)
        ? bc.p.price
        : _num(prices[bc.tk])
          ? prices[bc.tk]
          : null;
    if (!_num(px) || px <= 0) {
      skip[bc.tk] = "no price available";
      continue;
    }
    // Buy as close to the gap as cash + whole-share lots allow.
    let qty = lotRound(bc.tk, bc.gap / px);
    while (qty > 0 && buyCost(bc.tk, qty, px) > remaining)
      qty = lotRound(bc.tk, qty - 1);
    if (qty <= EPS) {
      // can't even afford a minimal whole-share lot; cash may stay idle.
      skip[bc.tk] = "can't afford a whole-share lot with remaining cash";
      continue;
    }
    const cost = buyCost(bc.tk, qty, px);
    if (cost > remaining + EPS) {
      skip[bc.tk] = "can't afford a whole-share lot with remaining cash";
      continue;
    }
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

  // ---- "why not bought" list: positive-target names that got no buy ----
  const skipped = Object.keys(skip)
    .filter((tk) => !buys.find((b) => b.ticker === tk))
    .map((tk) => ({ ticker: tk, reason: skip[tk] }));

  // ---- portfolio readout: the PROJECTED portfolio shape after the plan ----
  // Post-trade value per name = current value + buys - sells, then aggregate by
  // sector/cycle/style, plus value-weighted attractiveness & volatility and the
  // cash %. Uses position metadata (cat/cyc/sty/vol) when present.
  const postVal = {};
  for (const p of positions || [])
    if (p && p.ticker) postVal[p.ticker] = _num(p.value) ? p.value : 0;
  for (const b of buys)
    postVal[b.ticker] = (postVal[b.ticker] || 0) + b.qty * b.price;
  for (const s of sells)
    postVal[s.ticker] = Math.max(0, (postVal[s.ticker] || 0) - s.qty * s.price);
  const investedPost = Object.values(postVal).reduce((s, v) => s + v, 0);
  const totalPost = investedPost + holdCash;
  // Prefer the held position's metadata; fall back to the candidate metadata
  // for names bought this run that weren't previously held (so they group by
  // their real cat/cyc/sty rather than defaulting to "Uncategorized").
  const metaOf = (tk) => posByTk[tk] || candMeta[tk] || {};
  const groupBy = (key, fallback) => {
    const g = {};
    const members = {}; // group name -> [{ ticker, name, weight }]
    for (const tk in postVal) {
      if (postVal[tk] <= EPS) continue;
      const meta = metaOf(tk);
      const k = meta[key] || fallback;
      g[k] = (g[k] || 0) + postVal[tk];
      (members[k] = members[k] || []).push({
        ticker: tk,
        name: meta.name || tk,
        weight: totalPost > 0 ? postVal[tk] / totalPost : 0,
      });
    }
    // -> [{ name, weight, members:[{ticker,name,weight}] }] of the TOTAL (incl
    // cash), each sorted desc. `members` lets the UI show exactly which holdings
    // make up a sector/cycle/style group on hover (incl. what "Uncategorized"
    // actually contains).
    return Object.keys(g)
      .map((k) => ({
        name: k,
        weight: totalPost > 0 ? g[k] / totalPost : 0,
        members: (members[k] || []).sort((a, b) => b.weight - a.weight),
      }))
      .sort((a, b) => b.weight - a.weight);
  };
  // Value-weight attractiveness and volatility. Each metric uses its OWN base
  // (sum of value over names that actually carry that metric) so a name missing
  // an attractiveness score does not silently drag the average toward zero, and
  // the two readouts stay comparable (both are true value-weighted means over
  // the names they cover).
  let wA = 0,
    wABase = 0,
    wV = 0,
    wVBase = 0;
  for (const tk in postVal) {
    const v = postVal[tk];
    if (v <= EPS) continue;
    const A = attract[tk];
    const vol = metaOf(tk).vol;
    if (_num(A)) {
      wA += A * v;
      wABase += v;
    }
    if (_num(vol)) {
      wV += vol * v;
      wVBase += v;
    }
  }
  const readout = {
    sectors: groupBy("cat", "Uncategorized"),
    cycles: groupBy("cyc", "Unclassified"),
    styles: groupBy("sty", "Unclassified"),
    wAttract: wABase > 0 ? wA / wABase : null,
    wVol: wVBase > 0 ? wV / wVBase : null,
    cashPct: totalPost > 0 ? holdCash / totalPost : 0,
    investedPost,
    totalPost,
  };

  return { buys, sells, holdCash, sleeve, rows, notes, skipped, readout };
}
