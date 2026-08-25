// ============================================================
// 05-rebalance.js
// rebalance: est costs, computeRebalance, rebalance render, rbDraft*, company-detail overlay
// Part of the Portfolio Tracker app. Loaded as an ordered plain
// <script> (shared global scope) - order matters, see index.html.
// ============================================================
// ============ REBALANCE / SECTOR-DIVERSIFY OPTIMIZER ============
function estBuyCost(px, qty, brokerId) {
  const bk = BROKERS[brokerId || "attijari"];
  if (bk) {
    if (bk.feeType === "pea") return px * qty + brokerStockFees(px * qty, bk);
    return px * qty * (1 + brokerFeeRate(bk)) + brokerFixedFee(bk);
  }
  return px * qty * (1 + feeRate()) + fixedFee();
}
function estSellNet(px, qty, brokerId) {
  const bk = BROKERS[brokerId || "attijari"];
  if (bk) {
    if (bk.feeType === "pea") return px * qty - brokerStockFees(px * qty, bk);
    return px * qty * (1 - brokerFeeRate(bk)) - brokerFixedFee(bk);
  }
  return px * qty * (1 - feeRate()) - fixedFee();
}
// ---- Moroccan market lot rule: stocks trade in WHOLE shares only; OPCVM funds allow fractions ----
function isOpcvmTk(tk) {
  const m = M[tk];
  return !!(m && m.cat === "OPCVM");
}
// Max buyable quantity for a given cash amount at price px. Stocks floor to integer; OPCVM keep 4-dp fraction.
function buyableQty(px, amount, opcvm) {
  if (!(px > 0) || !(amount > 0)) return 0;
  const raw = amount / px;
  return opcvm ? +raw.toFixed(4) : Math.floor(raw);
}
// Round an arbitrary quantity to what the market permits for this asset.
function lotRound(qty, opcvm) {
  if (!(qty > 0)) return 0;
  return opcvm ? +qty.toFixed(4) : Math.floor(qty + 1e-9);
}

function computeRebalance() {
  const cash = Math.max(
    0,
    parseFloat((document.getElementById("rbCash") || {}).value) || 0,
  );
  const capPct =
    Math.min(
      100,
      Math.max(
        5,
        parseFloat((document.getElementById("rbCap") || {}).value) || 20,
      ),
    ) / 100;
  const capOpcvm =
    Math.min(
      100,
      Math.max(
        5,
        parseFloat((document.getElementById("rbCapOpcvm") || {}).value) || 35,
      ),
    ) / 100;
  // Per-sector cap: OPCVM funds (a single combined "OPCVM" bucket) get their own higher cap.
  const capFor = (cat) => (cat === "OPCVM" ? capOpcvm : capPct);
  const maxBuys = Math.min(
    12,
    Math.max(
      1,
      parseInt((document.getElementById("rbMaxBuys") || {}).value) || 5,
    ),
  );
  const buyOnly = !!(document.getElementById("rbBuyOnly") || {}).checked;
  const wantTrims = !!(document.getElementById("rbTrims") || {}).checked;
  const includeOpcvm = !!(document.getElementById("rbOpcvm") || {}).checked; // when true, funds are buyable too

  const { pos } = runFIFO();
  const _rbPending = !!(document.getElementById("rbPending") || {}).checked;
  // When "Account for pending" is on, project pending BUY/SELL orders into the position snapshot.
  // This gives sector weights and buy suggestions that reflect the post-pending portfolio.
  const _projPos = {};
  Object.keys(pos).forEach((k) => {
    _projPos[k] = Object.assign({}, pos[k]);
  });
  if (_rbPending) {
    (PENDING || []).forEach((o) => {
      if (o.action !== "BUY" && o.action !== "SELL") return;
      if (o.price == null || o.qty == null || !(o.qty > 0)) return;
      const m = M[o.ticker];
      if (!m) return;
      const px = m.price != null && m.price > 0 ? m.price : o.price; // use live price for value; fall back to order price
      // key: match runFIFO() key format \u2014 combine PEA/Regular under the ticker
      // runFIFO pos keys are `ticker||PEA` / `ticker||Regular` ; we work at the merged ticker level
      // Find any existing pos entry for this ticker, or seed one.
      const existKey = Object.keys(_projPos).find(
        (k) => _projPos[k].ticker === o.ticker,
      );
      if (existKey) {
        const p = _projPos[existKey];
        if (o.action === "BUY") {
          p.held += o.qty;
          p.value = p.held * px;
        } else {
          p.held = Math.max(0, p.held - o.qty);
          p.value = p.held * px;
        }
      } else if (o.action === "BUY") {
        // new position that doesn't exist yet
        const cat = m.cat || "Uncategorized";
        _projPos["__pend__" + o.ticker] = {
          ticker: o.ticker,
          held: o.qty,
          value: o.qty * px,
          price: px,
          avg: o.price,
          cat,
          name: m.name || o.ticker,
          account: o.pea ? "PEA" : "Regular",
          isPea: !!o.pea,
        };
      }
    });
  }
  const held = Object.values(_projPos).filter((p) => p.held > 0 && p.value > 0);
  const totalNow = held.reduce((a, p) => a + p.value, 0);

  // current sector weights
  const secVal = {};
  held.forEach((p) => {
    const c = (M[p.ticker] && M[p.ticker].cat) || "Uncategorized";
    secVal[c] = (secVal[c] || 0) + p.value;
  });
  const heldQtyByTk = {};
  held.forEach((p) => {
    heldQtyByTk[p.ticker] = (heldQtyByTk[p.ticker] || 0) + p.held;
  });

  // candidate universe: all non-OPCVM stocks with a price & fair value
  let cands = computeSignalsRows().filter(
    (r) =>
      r.m &&
      (includeOpcvm || r.m.cat !== "OPCVM") &&
      r.price != null &&
      r.price > 0 &&
      (r.m.cat === "OPCVM" ? true : fairValue(r.m) != null),
  );
  if (buyOnly) cands = cands.filter((r) => r.sig && r.sig.c === "b-buy");
  // annotate discount-to-fair (value tilt) and buy price
  cands.forEach((r) => {
    const fv = fairValue(r.m);
    r._fv = fv;
    // fv is null for OPCVM funds (no intrinsic value) \u2014 treat as neutral
    // (disc 0, no value tilt) instead of letting (null-price)/null = NaN
    // corrupt the greedy score. Funds are then picked only by under-weight.
    r._disc = fv != null && fv > 0 ? (fv - r.price) / fv : 0;
    r._px = r.price;
    r._tbuyRef = r.tbuy != null && isFinite(r.tbuy) ? r.tbuy : null;
    r._cat = r.m.cat || "Uncategorized";
    r._cyc = r.m.cycle || "OPCVM / Funds";
    r._sty = r.m.style || "OPCVM / Funds";
  });

  // ---- #5 DYNAMIC denominator: invested base grows as cash is deployed and shrinks as
  // we trim. projTotal() reflects the CURRENT projected invested total so sector-weight
  // caps bind against the right base at every greedy step (not a static totalNow+cash).
  let investedBase = totalNow; // running invested MAD (updated on each buy/trim)
  const projTotal = () => investedBase;
  // running projected sector values as we allocate
  const runSec = Object.assign({}, secVal);
  // \u2500\u2500 SINGLE-NAME CONCENTRATION CAP \u2500\u2500
  // Sector caps alone don't stop the greedy loop piling many lots into ONE cheap,
  // underweight-sector name. Cap any single position at nameCap of the projected total
  // (mirrors the 20% single-position concentration warning used on the Dashboard). This
  // is the data-appropriate diversification control we CAN enforce without price history.
  const nameCap = Math.min(0.25, Math.max(0.1, capPct)); // \u2264 sector cap, floored 10%, ceiled 25%
  const runTk = {};
  held.forEach((p) => {
    runTk[p.ticker] = (runTk[p.ticker] || 0) + p.value;
  });
  // Economic-cycle & asset-style diversification: track running MAD by cycle/style so the
  // greedy allocator spreads across cycles (Cyclical/Sensitives/Defensive) and styles
  // (Yield King/Growth/Compounder/...). These are SOFT nudges (no hard cap) steering variety.
  const cycVal = {},
    styVal = {};
  held.forEach((p) => {
    const m = M[p.ticker] || {};
    const cy = m.cycle || "OPCVM / Funds",
      st = m.style || "OPCVM / Funds";
    cycVal[cy] = (cycVal[cy] || 0) + p.value;
    styVal[st] = (styVal[st] || 0) + p.value;
  });
  const runCyc = Object.assign({}, cycVal),
    runSty = Object.assign({}, styVal);
  const cycTarget = 1 / Math.max(1, new Set(cands.map((r) => r._cyc)).size);
  const styTarget = 1 / Math.max(1, new Set(cands.map((r) => r._sty)).size);
  const needBelow = (runMap, key, target) => {
    const w = projTotal() > 0 ? (runMap[key] || 0) / projTotal() : 0;
    return Math.max(0, (target - w) / target);
  };
  const plan = [];
  let remaining = cash;

  // ---- #8 TRUE REBALANCE: compute trims FIRST, recycle their net proceeds into the buy budget.
  // Trimming an overweight sector frees cash that is redeployed into under-cap sectors in the
  // SAME plan, and the trimmed value is removed from the running sector map + invested base so
  // caps are measured against the post-trim portfolio.
  const trims = [];
  if (wantTrims) {
    Object.keys(secVal).forEach((c) => {
      // OPCVM funds are hands-off unless "Include OPCVM" is ticked. They have no
      // fair-value data (price + fees only), so trimming them on a valuation
      // ranking is meaningless \u2014 and the checkbox is meant to keep funds untouched.
      if (c === "OPCVM" && !includeOpcvm) return;
      const w = totalNow > 0 ? secVal[c] / totalNow : 0;
      const _cap = capFor(c);
      if (w > _cap) {
        // holdings in this sector, ranked by MOST overvalued (lowest discount / negative)
        const inSec = held
          .filter(
            (p) => ((M[p.ticker] && M[p.ticker].cat) || "Uncategorized") === c,
          )
          .map((p) => {
            const fv = fairValue(M[p.ticker]);
            const disc = fv != null ? (fv - p.price) / fv : 0;
            return { p, disc, fv };
          })
          .sort((a, b) => a.disc - b.disc);
        const excessVal = (w - _cap) * totalNow;
        let toTrim = excessVal;
        for (const { p, disc, fv } of inSec) {
          if (toTrim <= 0) break;
          const _fund = isOpcvmTk(p.ticker);
          const rawQty = toTrim / p.price;
          let qty = _fund
            ? Math.min(p.held, +rawQty.toFixed(4))
            : Math.min(p.held, Math.ceil(rawQty));
          qty = lotRound(qty, _fund);
          if (qty <= 0) continue;
          // After-tax net proceeds: fees + TPCVM cap-gains tax on the gain (0 for PEA),
          // using the SAME engine as everywhere else so the recycled budget is accurate.
          const net = computeRow(
            {
              action: "SELL",
              ticker: p.ticker,
              qty: qty,
              price: p.price,
              pea: p.isPea,
            },
            p.avg,
          ).net;
          // Skip dust trims whose net proceeds don't clear fees/tax.
          if (net <= 0) {
            toTrim -= qty * p.price;
            continue;
          }
          const gross = qty * p.price;
          const _why = (function () {
            const parts = [
              "sector " +
                (w * 100).toFixed(0) +
                "% > " +
                (_cap * 100).toFixed(0) +
                "% cap",
            ];
            if (disc != null && disc < 0)
              parts.push(
                (Math.abs(disc) * 100).toFixed(0) + "% above fair value",
              );
            else if (disc != null && disc < 0.05) parts.push("near fair value");
            return "Trimmed: " + parts.join(" \u00B7 ");
          })();
          trims.push({
            ticker: p.ticker,
            name: p.name,
            cat: c,
            px: p.price,
            qty,
            net,
            gross,
            disc,
            fv: fv != null ? fv : null,
            account: p.account,
            opcvm: _fund,
            why: _why,
          });
          // recycle: proceeds boost the buy budget; portfolio shrinks by the trimmed value
          remaining += net;
          investedBase = Math.max(0, investedBase - gross);
          runSec[c] = Math.max(0, (runSec[c] || 0) - gross);
          const _cy = (M[p.ticker] && M[p.ticker].cycle) || "OPCVM / Funds",
            _st = (M[p.ticker] && M[p.ticker].style) || "OPCVM / Funds";
          if (!_fund) {
            runCyc[_cy] = Math.max(0, (runCyc[_cy] || 0) - gross);
            runSty[_st] = Math.max(0, (runSty[_st] || 0) - gross);
          }
          toTrim -= gross;
        }
      }
    });
  }

  // (Candidate selection is done inline in the greedy while-loop below, which also
  //  enforces the single-name concentration cap. No separate pickNext() needed.)

  // \u2500\u2500 CONVICTION \u00D7 RANGE-WIDTH POSITION SIZING \u2500\u2500
  // NOTE: This is a heuristic, NOT true Kelly (which needs win/loss probabilities and edge)
  // and NOT return volatility (which needs a price time-series we don't store).
  // Risk proxy per candidate = (52w high - low) / price \u2014 the trading-range WIDTH.
  // Wider range = treated as riskier, so it gets down-sized. Narrower = steadier.
  // Conviction base: High\u21923 shares/step, Medium\u21922, Low\u21921.
  const _volArr = cands
    .filter((r) => num(r.m.low) && num(r.m.high) && r._px > 0)
    .map((r) => (r.m.high - r.m.low) / r._px);
  const _medVol =
    _volArr.length > 2
      ? _volArr.sort((a, b) => a - b)[Math.floor(_volArr.length / 2)]
      : 0.3;
  function _lotSize(r) {
    // Conviction base (see note above \u2014 heuristic, not literal Kelly)
    const sc = r.sig ? factorScores(r.m) : null;
    const conv = sc ? sc.convScore : 0.5;
    const kellyBase = conv >= 0.8 ? 3 : conv >= 0.55 ? 2 : 1;
    // Range-width scale: dampen wide-range (riskier) stocks
    const vol =
      num(r.m.low) && num(r.m.high) && r._px > 0
        ? (r.m.high - r.m.low) / r._px
        : _medVol;
    const volRatio = _medVol > 0 ? vol / _medVol : 1;
    const volScale = 1 / Math.max(1, volRatio); // <=1 for above-median vol; 1 for below
    const lot = Math.max(1, Math.round(kellyBase * volScale));
    // For OPCVM funds, keep lot=1 (fractional units handled differently)
    return r._cat === "OPCVM" ? 1 : lot;
  }

  let guard = 0;
  while (remaining > 0 && plan.length <= maxBuys * 3 && guard++ < 500) {
    // stop opening NEW names once we hit maxBuys distinct tickers (still allow topping up existing picks)
    const distinct = new Set(plan.map((x) => x.ticker));
    let cand = null,
      candScore = -1e9;
    for (const r of cands) {
      if (r._dust) continue; // fee overhead too large \u2014 permanently skip
      const px = r._px,
        costOne = estBuyCost(px, 1);
      if (costOne > remaining) continue;
      const curSec = runSec[r._cat] || 0,
        secW = projTotal() > 0 ? curSec / projTotal() : 0;
      const _cap = capFor(r._cat);
      if (secW >= _cap) continue;
      // Single-name concentration guard (skip funds \u2014 the OPCVM sector cap governs them)
      if (r._cat !== "OPCVM") {
        const tkW = projTotal() > 0 ? (runTk[r.ticker] || 0) / projTotal() : 0;
        if (tkW >= nameCap) continue;
      }
      if (!distinct.has(r.ticker) && distinct.size >= maxBuys) continue; // no new names beyond cap
      const sectorNeed = 1 - secW / _cap,
        valueTilt = Math.max(0, r._disc);
      const cycleNeed = needBelow(runCyc, r._cyc, cycTarget),
        styleNeed = needBelow(runSty, r._sty, styTarget);
      const score =
        sectorNeed * 1.0 +
        valueTilt * 0.6 +
        cycleNeed * 0.35 +
        styleNeed * 0.35 +
        (r.sig && r.sig.c === "b-buy" ? 0.15 : 0);
      if (score > candScore) {
        candScore = score;
        cand = r;
      }
    }
    if (!cand) break;
    // Build the "why" explanation for the CHOSEN candidate from its live score components.
    (function () {
      const r = cand,
        curSec = runSec[r._cat] || 0,
        secW = projTotal() > 0 ? curSec / projTotal() : 0,
        _cap = capFor(r._cat);
      const sectorNeed = Math.max(0, 1 - secW / _cap),
        valueTilt = Math.max(0, r._disc || 0);
      const cycleNeed = needBelow(runCyc, r._cyc, cycTarget),
        styleNeed = needBelow(runSty, r._sty, styTarget);
      const parts = [];
      if (sectorNeed > 0.05)
        parts.push(
          r._cat +
            " underweight (" +
            (secW * 100).toFixed(0) +
            "% vs " +
            (_cap * 100).toFixed(0) +
            "% cap)",
        );
      if (valueTilt > 0.02)
        parts.push((valueTilt * 100).toFixed(0) + "% below fair value");
      if (cycleNeed > 0.05) parts.push("adds " + r._cyc + " exposure");
      if (styleNeed > 0.05 && r._sty !== r._cyc) parts.push(r._sty + " style");
      if (r.sig && r.sig.c === "b-buy") parts.push("rated Buy");
      cand._why = parts.length
        ? "Picked: " + parts.slice(0, 3).join(" \u00B7 ")
        : "Picked: fills remaining budget within caps";
    })();
    // Dynamic lot per greedy step: conviction \u00D7 range-width-scaled.
    const _candFund = cand._cat === "OPCVM";
    const _lot = _lotSize(cand);
    const px = cand._px,
      cost = estBuyCost(px, _lot);
    if (cost > remaining) {
      // Can't afford the full lot \u2014 try 1 share as fallback
      const cost1 = estBuyCost(px, 1);
      if (cost1 > remaining) break;
      // Fall back to single share
      const _feeOverhead1 = cost1 - px;
      if (px > 0 && _feeOverhead1 / px > 0.05) {
        cand._dust = true;
        continue;
      }
      remaining -= cost1;
      investedBase += px;
      runSec[cand._cat] = (runSec[cand._cat] || 0) + px;
      runTk[cand.ticker] = (runTk[cand.ticker] || 0) + px;
      runCyc[cand._cyc] = (runCyc[cand._cyc] || 0) + px;
      runSty[cand._sty] = (runSty[cand._sty] || 0) + px;
      const ex = plan.find((x) => x.ticker === cand.ticker);
      if (ex) {
        ex.qty += 1;
        ex.gross += px;
        ex.cost += cost1;
      } else
        plan.push({
          ticker: cand.ticker,
          name: cand.m.name || cand.ticker,
          cat: cand._cat,
          cyc: cand._cyc,
          sty: cand._sty,
          px,
          qty: 1,
          gross: px,
          cost: cost1,
          disc: cand._disc,
          fv: cand._fv,
          tbuy: cand._tbuyRef,
          sig: cand.sig,
          held: (heldQtyByTk[cand.ticker] || 0) > 0,
          opcvm: _candFund,
          why: cand._why,
        });
    } else {
      // Full lot affordable
      const lotGross = px * _lot;
      const _feeOverhead = cost - lotGross;
      if (lotGross > 0 && _feeOverhead / lotGross > 0.05) {
        cand._dust = true;
        continue;
      }
      remaining -= cost;
      investedBase += lotGross;
      runSec[cand._cat] = (runSec[cand._cat] || 0) + lotGross;
      runTk[cand.ticker] = (runTk[cand.ticker] || 0) + lotGross;
      runCyc[cand._cyc] = (runCyc[cand._cyc] || 0) + lotGross;
      runSty[cand._sty] = (runSty[cand._sty] || 0) + lotGross;
      const ex = plan.find((x) => x.ticker === cand.ticker);
      if (ex) {
        ex.qty += _lot;
        ex.gross += lotGross;
        ex.cost += cost;
      } else
        plan.push({
          ticker: cand.ticker,
          name: cand.m.name || cand.ticker,
          cat: cand._cat,
          cyc: cand._cyc,
          sty: cand._sty,
          px,
          qty: _lot,
          gross: lotGross,
          cost,
          disc: cand._disc,
          fv: cand._fv,
          tbuy: cand._tbuyRef,
          sig: cand.sig,
          held: (heldQtyByTk[cand.ticker] || 0) > 0,
          opcvm: _candFund,
          why: cand._why,
        });
    }
  }

  const trimProceeds = trims.reduce((a, t) => a + (t.net || 0), 0);
  const buyBudget = cash + trimProceeds; // total cash available to deploy (new cash + recycled trims)
  return {
    cash,
    capPct,
    capOpcvm,
    maxBuys,
    buyOnly,
    wantTrims,
    includeOpcvm,
    totalNow,
    secVal,
    cycVal,
    styVal,
    plan,
    trims,
    trimProceeds,
    buyBudget,
    spent: buyBudget - remaining,
    remaining,
  };
}

const RB_LS = "casa_rebalance_v1";
function saveRbSettings() {
  try {
    const g = (id) => document.getElementById(id);
    const s = {
      cash: (g("rbCash") || {}).value,
      cap: (g("rbCap") || {}).value,
      capOpcvm: (g("rbCapOpcvm") || {}).value,
      maxBuys: (g("rbMaxBuys") || {}).value,
      buyOnly: !!(g("rbBuyOnly") || {}).checked,
      trims: !!(g("rbTrims") || {}).checked,
      opcvm: !!(g("rbOpcvm") || {}).checked,
      pending: !!(g("rbPending") || {}).checked,
    };
    safeSetItem(RB_LS, JSON.stringify(s));
  } catch (e) {}
}
function loadRbSettings() {
  try {
    const raw = localStorage.getItem(RB_LS);
    if (!raw) return;
    const s = JSON.parse(raw);
    const g = (id) => document.getElementById(id);
    if (s.cash != null && g("rbCash")) g("rbCash").value = s.cash;
    if (s.cap != null && g("rbCap")) g("rbCap").value = s.cap;
    if (s.capOpcvm != null && g("rbCapOpcvm"))
      g("rbCapOpcvm").value = s.capOpcvm;
    if (s.maxBuys != null && g("rbMaxBuys")) g("rbMaxBuys").value = s.maxBuys;
    if (s.buyOnly != null && g("rbBuyOnly"))
      g("rbBuyOnly").checked = !!s.buyOnly;
    if (s.trims != null && g("rbTrims")) g("rbTrims").checked = !!s.trims;
    if (s.opcvm != null && g("rbOpcvm")) g("rbOpcvm").checked = !!s.opcvm;
    if (s.pending != null && g("rbPending"))
      g("rbPending").checked = !!s.pending;
  } catch (e) {}
}
function renderRebalance() {
  const wrap = document.getElementById("rbResult");
  if (!wrap) return;
  saveRbSettings();
  const R = computeRebalance();
  const hint = document.getElementById("rbHint");
  if (R.totalNow <= 0 && R.cash <= 0) {
    wrap.innerHTML = "";
    if (hint) hint.textContent = "Add some holdings or cash to compute a plan.";
    return;
  }

  // projected sector weights after plan (trims reduce, buys add)
  const proj = Object.assign({}, R.secVal);
  R.trims.forEach((t) => {
    proj[t.cat] = Math.max(
      0,
      (proj[t.cat] || 0) - (t.gross || t.qty * t.px || 0),
    );
  });
  R.plan.forEach((x) => {
    proj[x.cat] = (proj[x.cat] || 0) + x.gross;
  });
  const trimGross = R.trims.reduce(
    (a, t) => a + (t.gross || t.qty * t.px || 0),
    0,
  );
  const buyGross = R.plan.reduce((a, x) => a + x.gross, 0);
  const projTot = Math.max(0, R.totalNow - trimGross) + buyGross;
  const secRows = Object.keys(proj)
    .map((c) => ({
      c,
      before: R.totalNow > 0 ? (R.secVal[c] || 0) / R.totalNow : 0,
      after: projTot > 0 ? proj[c] / projTot : 0,
    }))
    .sort((a, b) => b.after - a.after);

  const _secBefore = {},
    _secAfter = {};
  Object.keys(proj).forEach((c) => {
    _secBefore[c] = R.totalNow > 0 ? (R.secVal[c] || 0) / R.totalNow : 0;
    _secAfter[c] = projTot > 0 ? proj[c] / projTot : 0;
  });
  const _ctx = (c) => ({
    capPct: R.capPct,
    secWBefore: _secBefore[c],
    secWAfter: _secAfter[c],
  });
  const buyRows = R.plan
    .sort((a, b) => b.cost - a.cost)
    .map(
      (
        x,
      ) => `<tr class="nis-cell" style="cursor:help" data-tip="${encodeURIComponent(rbBuyTipHTML(x, _ctx(x.cat)))}">
    <td class="l"><div><b>${x.ticker}</b> ${x.held ? '<span class="tag-in" style="font-size:9px">held</span>' : '<span class="badge b-buy" style="font-size:9px">new</span>'}${aboveTgtBadge(x.px, x.tbuy)} <span class="mini" style="color:var(--text2)">${escapeHtml(x.name)}</span></div>${x.why ? '<div class="mini" style="color:var(--muted);margin-top:2px;white-space:normal;max-width:340px">' + escapeHtml(x.why) + "</div>" : ""}</td>
    <td class="l mini" style="color:var(--text2)">${escapeHtml(x.cat)}</td>
    <td style="text-align:right;font-family:var(--mono)">${money(x.px)}</td>
    <td style="text-align:right;font-family:var(--mono)">${money(x.qty, x.opcvm && x.qty % 1 ? 4 : 0)}${x.opcvm ? '<span class="mini" style="color:var(--text2)"> u</span>' : ""}</td>
    <td style="text-align:right;font-family:var(--mono)">${money(x.cost, 0)}</td>
    <td style="text-align:right;font-family:var(--mono)" class="${x.disc > 0 ? "pos" : "neg"}">${(x.disc * 100).toFixed(0)}%</td>
    ${(function () {
      const _m = M[x.ticker];
      const _dy = _m && _m.divy != null ? _m.divy : null;
      return (
        '<td style="text-align:right;font-family:var(--mono)" class="' +
        (_dy > 0 ? "pos" : "") +
        '">' +
        (_dy != null
          ? pct(_dy)
          : "<span style='color:var(--muted)'>\u2014</span>") +
        "</td>"
      );
    })()}
    <td style="text-align:right"><button class="btn sec2" style="font-size:10px;padding:3px 8px" data-act="rbDraftOne" data-args="${x.ticker},${x.px},${x.qty}">Draft</button></td>
  </tr>`,
    )
    .join("");

  const trimRows = R.trims
    .map(
      (
        x,
      ) => `<tr class="nis-cell" style="cursor:help" data-tip="${encodeURIComponent(rbTrimTipHTML(x, { capPct: R.capPct, secWBefore: R.totalNow > 0 ? (R.secVal[x.cat] || 0) / R.totalNow : 0 }))}">
    <td class="l"><div><b>${x.ticker}</b> <span class="mini" style="color:var(--text2)">${escapeHtml(x.name)}</span></div>${x.why ? '<div class="mini" style="color:var(--muted);margin-top:2px;white-space:normal;max-width:340px">' + escapeHtml(x.why) + "</div>" : ""}</td>
    <td class="l mini" style="color:var(--text2)">${escapeHtml(x.cat)} \u00B7 ${x.account}</td>
    <td style="text-align:right;font-family:var(--mono)">${money(x.px)}</td>
    <td style="text-align:right;font-family:var(--mono)">${money(x.qty, x.opcvm && x.qty % 1 ? 4 : 0)}${x.opcvm ? '<span class="mini" style="color:var(--text2)"> u</span>' : ""}</td>
    <td style="text-align:right;font-family:var(--mono)">${money(x.net, 0)}</td>
    <td style="text-align:right;font-family:var(--mono)" class="${x.disc < 0 ? "neg" : "pos"}">${(x.disc * 100).toFixed(0)}%</td>
    ${(function () {
      const _m = M[x.ticker];
      const _dy = _m && _m.divy != null ? _m.divy : null;
      return (
        '<td style="text-align:right;font-family:var(--mono)" class="' +
        (_dy > 0 ? "pos" : "") +
        '">' +
        (_dy != null
          ? pct(_dy)
          : "<span style='color:var(--muted)'>\u2014</span>") +
        "</td>"
      );
    })()}
  </tr>`,
    )
    .join("");

  if (hint) hint.textContent = "";
  wrap.innerHTML = `
  <div class="sec">
    <h3 style="margin:0 0 6px" data-tip="Casablanca stocks are bought in whole shares only, so each suggested buy is a whole number of shares. OPCVM funds (not suggested here) allow fractions.">\uD83D\uDCCB Suggested buys <span class="mini" style="font-weight:400;color:var(--text2)">\u2014 ${R.plan.length} name${R.plan.length === 1 ? "" : "s"} \u00B7 ${money(R.spent, 0)} MAD deployed \u00B7 ${money(R.remaining, 0)} MAD left (fees incl.)${R.trimProceeds > 0 ? ' \u00B7 <span class="pos">' + money(R.trimProceeds, 0) + " MAD recycled from trims</span>" : ""}</span>${R.pendingAccounted ? '<span class="badge b-wait" style="font-size:10px;margin-left:8px" title="Sector weights and suggestions include your ' + R.pendingCount + ' pending order(s)">\u23F3 +pending</span>' : ""}</h3>
    ${
      R.plan.length
        ? `<div class="tbl-wrap"><table><thead><tr>
      <th scope="col" class="l">Name</th><th scope="col" class="l">Sector</th><th scope="col" style="text-align:right">Price</th><th scope="col" style="text-align:right">Qty</th><th scope="col" style="text-align:right">Cost (net fees)</th><th scope="col" style="text-align:right" data-tip="Discount to Fair Value. Positive = trading below intrinsic (cheap). Negative = trading above (premium).">Disc. to FV</th><th scope="col" style="text-align:right" data-tip="Dividend yield (same as Signals tab)">Div Y</th><th scope="col"></th>
    </tr></thead><tbody>${buyRows}</tbody></table></div>
    <div style="margin-top:10px;text-align:right"><button class="btn" data-act="rbDraftAll">\u2795 Draft all these buys to Pending</button></div>`
        : '<div class="mini" style="color:var(--text2)">No buys fit the constraints \u2014 try raising the sector cap, disabling "Buy-signal only", or adding more cash.</div>'
    }
  </div>
  ${
    R.wantTrims
      ? `<div class="sec">
    <h3 style="margin:0 0 6px">\u2702\uFE0F Suggested trims <span class="mini" style="font-weight:400;color:var(--text2)">\u2014 overweight sectors (> ${(R.capPct * 100).toFixed(0)}%), most overvalued first \u00B7 net of fees</span></h3>
    ${
      R.trims.length
        ? `<div class="tbl-wrap"><table><thead><tr>
      <th scope="col" class="l">Name</th><th scope="col" class="l">Sector \u00B7 account</th><th scope="col" style="text-align:right">Price</th><th scope="col" style="text-align:right">Qty</th><th scope="col" style="text-align:right">Net proceeds</th><th scope="col" style="text-align:right">Disc. to FV</th><th scope="col" style="text-align:right" data-tip="Dividend yield (same as Signals tab)">Div Y</th>
    </tr></thead><tbody>${trimRows}</tbody></table></div>`
        : '<div class="mini pos">No sector exceeds the cap \u2014 nothing to trim. \uD83C\uDF89</div>'
    }
  </div>`
      : ""
  }
  <div class="sec">
    <h3 style="margin:0 0 8px">\uD83C\uDFAF Sector weights \u2014 before \u2192 after</h3>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${secRows
        .map((s) => {
          const rowCap = s.c === "OPCVM" ? R.capOpcvm || R.capPct : R.capPct;
          const overAfter = s.after > rowCap;
          return `<div>
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px">
            <span>${s.c}${overAfter ? ' <span class="neg">\u26A0</span>' : ""}</span>
            <span class="mini" style="color:var(--text2);font-family:var(--mono)">${(s.before * 100).toFixed(0)}% \u2192 <b style="color:var(--text)">${(s.after * 100).toFixed(0)}%</b></span>
          </div>
          <div style="height:8px;background:var(--panel2);border-radius:5px;overflow:hidden;position:relative">
            <div style="position:absolute;left:0;top:0;bottom:0;width:${Math.min(100, s.before * 100)}%;background:var(--muted);opacity:.4"></div>
            <div style="position:absolute;left:0;top:0;bottom:0;width:${Math.min(100, s.after * 100)}%;background:${overAfter ? "var(--error)" : "var(--accent,#4c8bf5)"};opacity:.85"></div>
            <div style="position:absolute;top:0;bottom:0;left:${Math.min(100, rowCap * 100)}%;width:2px;background:var(--warn)"></div>
          </div>
        </div>`;
        })
        .join("")}
    </div>
    <div class="mini" style="color:var(--text2);margin-top:8px">Faded bar = current weight \u00B7 solid bar = after plan \u00B7 yellow line = your sector cap (${(R.capPct * 100).toFixed(0)}% stocks \u00B7 ${((R.capOpcvm || R.capPct) * 100).toFixed(0)}% OPCVM). Red = still over that sector\u2019s cap after buys (consider trims or a lower target elsewhere). No single stock is taken above ${(Math.min(0.25, Math.max(0.1, R.capPct)) * 100).toFixed(0)}% of the projected portfolio (single-name concentration cap).</div>
  </div>`;
  // ---- Economic-cycle & asset-style diversification (soft nudge shown for transparency) ----
  (function () {
    const projTot = R.totalNow + R.spent;
    const mk = (baseVal, planKey, title, note) => {
      const after = Object.assign({}, baseVal);
      R.plan.forEach((x) => {
        const k = x[planKey] || "OPCVM / Funds";
        after[k] = (after[k] || 0) + x.gross;
      });
      const keys = Object.keys(after).sort(
        (a, b) => (after[b] || 0) - (after[a] || 0),
      );
      if (!keys.length) return "";
      const rows = keys
        .map((k) => {
          const b = R.totalNow > 0 ? (baseVal[k] || 0) / R.totalNow : 0;
          const a = projTot > 0 ? (after[k] || 0) / projTot : 0;
          return (
            '<div><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px"><span>' +
            k +
            "</span>" +
            '<span class="mini" style="color:var(--text2);font-family:var(--mono)">' +
            (b * 100).toFixed(0) +
            '% \u2192 <b style="color:var(--text)">' +
            (a * 100).toFixed(0) +
            "%</b></span></div>" +
            '<div style="height:8px;background:var(--panel2);border-radius:5px;overflow:hidden;position:relative">' +
            '<div style="position:absolute;left:0;top:0;bottom:0;width:' +
            Math.min(100, b * 100) +
            '%;background:var(--muted);opacity:.4"></div>' +
            '<div style="position:absolute;left:0;top:0;bottom:0;width:' +
            Math.min(100, a * 100) +
            '%;background:var(--accent,#4c8bf5);opacity:.85"></div></div></div>'
          );
        })
        .join("");
      return (
        '<div class="sec"><h3 style="margin:0 0 8px">' +
        title +
        '</h3><div style="display:flex;flex-direction:column;gap:6px">' +
        rows +
        "</div>" +
        '<div class="mini" style="color:var(--text2);margin-top:8px">' +
        note +
        "</div></div>"
      );
    };
    wrap.innerHTML += mk(
      R.cycVal,
      "cyc",
      "\u267b\ufe0f Economic-cycle mix \u2014 before \u2192 after",
      "Spreads new buys across Cyclical / Sensitives / Defensive so the portfolio isn\u2019t over-exposed to one phase of the cycle.",
    );
    wrap.innerHTML += mk(
      R.styVal,
      "sty",
      "\ud83c\udff7\ufe0f Asset-style mix \u2014 before \u2192 after",
      "Balances Yield King / Growth / Compounder / Recovery / Value / Defensive for a mix of income, growth and quality.",
    );
  })();
  // stash for draft-all
  window.__rbPlan = R.plan;
  // keep the Signals-tab sector-headroom bars in sync with the cap set here
  try {
    if (typeof renderTopSector === "function") renderTopSector();
    if (typeof renderTopHeadroom === "function") renderTopHeadroom();
  } catch (e) {}
}

function rbDraftOne(tk, px, qty) {
  const today = new Date().toISOString().slice(0, 10);
  const m = M[tk];
  const isOpcvm = !!(m && m.cat === "OPCVM");
  PENDING.push({
    date: today,
    ticker: tk,
    action: "BUY",
    qty: qty,
    price: px,
    pea: true,
    opcvm: isOpcvm,
    broker: "attijari",
  });
  savePending();
  const hint = document.getElementById("rbHint");
  if (hint) {
    hint.style.color = "var(--info)";
    hint.textContent = "Drafted " + qty + " \u00D7 " + tk + " to Pending.";
  }
}
function rbDraftAll() {
  const plan = window.__rbPlan || [];
  if (!plan.length) {
    toast("No buys to draft.", "warn");
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  let n = 0;
  plan.forEach((x) => {
    const m = M[x.ticker];
    PENDING.push({
      date: today,
      ticker: x.ticker,
      action: "BUY",
      qty: x.qty,
      price: x.px,
      pea: true,
      opcvm: !!(m && m.cat === "OPCVM"),
      broker: "attijari",
    });
    n++;
  });
  savePending();
  gotoTab("pending");
  if (typeof renderPending === "function") renderPending();
  const hint = document.getElementById("pendHint");
  if (hint) {
    hint.style.color = "var(--info)";
    hint.textContent =
      "Drafted " +
      n +
      " rebalance buy" +
      (n === 1 ? "" : "s") +
      " to Pending. Review before confirming.";
  }
}

// \u2500\u2500 Company Detail Page (full overlay, triggered from Signals tab name click) \u2500\u2500
window.showCompanyDetail = function (tk) {
  const m = M[tk];
  if (!m) return;
  const sc = typeof factorScores === "function" ? factorScores(m) : null;
  const fv = typeof fairValue === "function" ? fairValue(m) : null;
  const fvParts = typeof fairValueParts === "function" ? fairValueParts(m) : [];
  const tb = typeof targetBuy === "function" ? targetBuy(m, sc) : null;
  const ts = typeof targetSell === "function" ? targetSell(m, sc) : null;
  const sig =
    typeof signal === "function"
      ? signal(m, sc, heldSharesOf(runFIFO().pos, tk) > 0)
      : null;
  const eq =
    typeof earningsQuality === "function"
      ? earningsQuality(m)
      : { ok: true, flags: [] };
  const _pr = typeof peerRelScore === "function" ? peerRelScore(m) : null;
  const ds = typeof divSafety === "function" ? divSafety(m) : null;
  const pir = typeof posInRange === "function" ? posInRange(m) : null;
  const prof =
    typeof sectorProfile === "function" ? sectorProfile(m.cat) : null;
  const row = (l, v, cl) =>
    '<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0"><span>' +
    l +
    '</span><span class="' +
    (cl || "") +
    '" style="font-family:var(--mono)">' +
    v +
    "</span></div>";
  const sec = (title, body) =>
    '<div style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px"><div style="font-weight:700;margin-bottom:8px;font-size:13px">' +
    title +
    "</div>" +
    body +
    "</div>";

  let h = "";
  // Header
  h +=
    '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px">';
  h +=
    '<div><h2 style="margin:0">' +
    escapeHtml(tk) +
    " \u2014 " +
    escapeHtml(m.name || "") +
    "</h2>";
  h +=
    '<div class="mini" style="margin-top:4px;color:var(--text2)">' +
    (m.cat || "\u2014") +
    " \u00B7 " +
    (m.cycle || "\u2014") +
    " \u00B7 " +
    (m.style || "\u2014") +
    " \u00B7 Profile: " +
    (prof ? prof.label : "\u2014") +
    "</div></div>";
  h +=
    '<button class="btn sec2" data-act="closeCompanyDetail" style="padding:4px 12px">\u2715 Close</button></div>';
  // Signal badge
  if (sig)
    h +=
      '<div style="margin-bottom:12px"><span class="badge ' +
      sig.c +
      '">' +
      sig.t +
      "</span></div>";

  // Grid: 2 columns
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';

  // Col 1: Metrics (color-coded with educational tooltip: what it means + why the color)
  // trow = row with a data-tip explaining the metric definition, threshold logic, and color reason
  const trow = (l, v, cl, tip) =>
    '<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0' +
    (tip ? ";cursor:help" : "") +
    '" ' +
    (tip ? 'data-tip="' + encodeURIComponent(tip) + '"' : "") +
    "><span>" +
    l +
    '</span><span class="' +
    (cl || "") +
    '" style="font-family:var(--mono)">' +
    v +
    "</span></div>";
  let m1 = "";
  m1 += trow(
    "Live Price",
    m.price != null ? money(m.price) + " MAD" : "\u2014",
    "",
    "The current market price per share. No color coding \u2014 it\u2019s context-neutral on its own.",
  );
  m1 += trow(
    "52-week Low",
    m.low != null ? money(m.low) + " MAD" : "\u2014",
    "",
    "The lowest price this stock traded at over the past 52 weeks. Used as the floor of the price range.",
  );
  m1 += trow(
    "52-week High",
    m.high != null ? money(m.high) + " MAD" : "\u2014",
    "",
    "The highest price this stock traded at over the past 52 weeks. Used as the ceiling of the price range.",
  );
  {
    const _c =
      pir != null ? (pir < 0.35 ? "pos" : pir > 0.75 ? "neg" : "") : "";
    const _t =
      pir != null
        ? "Position in Range = (Price \u2212 Low) / (High \u2212 Low). Shows where the stock sits within its 52-week band.\n\n" +
          (_c === "pos"
            ? "\u2705 Green (\u226435%): Near the bottom of its range \u2014 historically cheap territory, good potential entry."
            : _c === "neg"
              ? "\u274c Red (>75%): Near its 52-week high \u2014 expensive entry, limited upside unless it breaks out."
              : "\u2796 Neutral (35\u201375%): Mid-range. Neither particularly cheap nor expensive.")
        : "";
    m1 += trow(
      "Position in Range",
      pir != null ? (pir * 100).toFixed(0) + "%" : "\u2014",
      _c,
      _t,
    );
  }
  m1 += '<div style="border-top:1px solid var(--border);margin:6px 0"></div>';
  {
    const _c = m.pe != null ? (m.pe < 15 ? "pos" : m.pe > 25 ? "neg" : "") : "";
    const _t =
      m.pe != null
        ? "P/E (Price-to-Earnings) = Share price / EPS. Measures how many years of earnings you pay for.\n\n" +
          (_c === "pos"
            ? "\u2705 Green (<15): You\u2019re paying less than 15 years of earnings \u2014 typically considered cheap. The market either doesn\u2019t expect growth or has a temporary concern (opportunity if fundamentals are solid)."
            : _c === "neg"
              ? "\u274c Red (>25): You\u2019re paying 25+ years of earnings \u2014 expensive. Only justified if the company grows fast enough to \u201cgrow into\u201d its valuation. Otherwise risky."
              : "\u2796 Neutral (15\u201325): Fairly valued relative to earnings. Neither cheap nor overly expensive for the Casablanca market.")
        : "";
    m1 += trow("P/E", m.pe != null ? m.pe.toFixed(1) : "\u2014", _c, _t);
  }
  {
    const _c =
      m.pb != null ? (m.pb < 1.5 ? "pos" : m.pb > 3.5 ? "neg" : "") : "";
    const _t =
      m.pb != null
        ? "P/B (Price-to-Book) = Share price / Book Value per share. Compares market price to the net asset value on the balance sheet.\n\n" +
          (_c === "pos"
            ? "\u2705 Green (<1.5): Trading near or below book value \u2014 you\u2019re buying the company\u2019s assets at a discount. Classic value signal (especially for financials/industrials)."
            : _c === "neg"
              ? "\u274c Red (>3.5): Significant premium over book \u2014 the market prices in strong intangibles (brand, tech, growth) that may or may not materialize."
              : "\u2796 Neutral (1.5\u20133.5): Reasonable premium. The market values some intangible growth beyond balance-sheet assets.")
        : "";
    m1 += trow("P/B", m.pb != null ? m.pb.toFixed(2) : "\u2014", _c, _t);
  }
  {
    const _c =
      m.peg != null ? (m.peg < 1.0 ? "pos" : m.peg > 2.5 ? "neg" : "") : "";
    const _t =
      m.peg != null
        ? "PEG (P/E \u00f7 Earnings Growth %) = How much you pay per unit of growth. A growth-adjusted valuation.\n\n" +
          (_c === "pos"
            ? "\u2705 Green (<1.0): You\u2019re paying less than the growth rate warrants \u2014 \u201cgrowth at a reasonable price\u201d (GARP). A PEG of 0.5 means you\u2019re getting twice the growth per unit of valuation."
            : _c === "neg"
              ? "\u274c Red (>2.5): You\u2019re paying a big premium even accounting for growth. Either growth expectations are unrealistic, or the market is too optimistic."
              : "\u2796 Neutral (1.0\u20132.5): Growth and valuation are roughly in balance. Neither a bargain nor overpriced for the growth delivered.")
        : "";
    m1 += trow("PEG", m.peg != null ? m.peg.toFixed(2) : "\u2014", _c, _t);
  }
  {
    const _c = m.ev != null ? (m.ev < 10 ? "pos" : m.ev > 18 ? "neg" : "") : "";
    const _t =
      m.ev != null
        ? "EV/EBITDA = Enterprise Value / Operating Profit. Measures how expensive the whole business is (debt + equity) relative to cash earnings. Debt-neutral (unlike P/E).\n\n" +
          (_c === "pos"
            ? "\u2705 Green (<10): Cheap enterprise valuation \u2014 you\u2019re buying the business for less than 10 years of operating cash flow. Often a sign of undervaluation or mature stability."
            : _c === "neg"
              ? "\u274c Red (>18): Expensive \u2014 the enterprise is priced at 18+ years of operating cash flow. Needs strong growth or asset revaluation to justify."
              : "\u2796 Neutral (10\u201318): Reasonable. Mid-range for most Casablanca equities.")
        : "";
    m1 += trow("EV/EBITDA", m.ev != null ? m.ev.toFixed(1) : "\u2014", _c, _t);
  }
  {
    const _c =
      m.netdebt != null
        ? m.netdebt < 1.5
          ? "pos"
          : m.netdebt > 4
            ? "neg"
            : ""
        : "";
    const _t =
      m.netdebt != null
        ? "Net Debt/EBITDA = Total debt minus cash, divided by operating profit. Measures how many years it would take to pay off all debt from earnings alone.\n\n" +
          (_c === "pos"
            ? "\u2705 Green (<1.5): Low leverage \u2014 the company could clear its debt in under 1.5 years. Safe balance sheet, low risk of distress."
            : _c === "neg"
              ? "\u274c Red (>4): Heavy leverage \u2014 4+ years of earnings just to service debt. Vulnerable to rate hikes, margin compression, or downturns. Higher bankruptcy risk."
              : "\u2796 Neutral (1.5\u20134): Moderate leverage. Manageable but keep an eye on interest-rate sensitivity and cash-flow stability.")
        : "";
    m1 += trow(
      "Net Debt/EBITDA",
      m.netdebt != null ? m.netdebt.toFixed(2) : "\u2014",
      _c,
      _t,
    );
  }
  {
    const _c =
      m.roe != null ? (m.roe > 0.15 ? "pos" : m.roe < 0.08 ? "neg" : "") : "";
    const _t =
      m.roe != null
        ? "ROE (Return on Equity) = Net Income / Shareholders\u2019 Equity. Measures how efficiently the company turns your invested capital into profit.\n\n" +
          (_c === "pos"
            ? "\u2705 Green (>15%): Strong profitability \u2014 the company generates 15+ cents of profit for every dirham of equity. Sign of competitive advantage, pricing power, or efficient operations."
            : _c === "neg"
              ? "\u274c Red (<8%): Weak profitability \u2014 the company struggles to generate returns above the cost of capital. May indicate poor management, structural decline, or capital-intensive low-margin business."
              : "\u2796 Neutral (8\u201315%): Adequate. The company earns a decent return but doesn\u2019t have exceptional competitive positioning.")
        : "";
    m1 += trow(
      "ROE",
      m.roe != null ? (m.roe * 100).toFixed(1) + "%" : "\u2014",
      _c,
      _t,
    );
  }
  {
    const _c =
      m.divy != null
        ? m.divy > 0.04
          ? "pos"
          : m.divy < 0.015
            ? "neg"
            : ""
        : "";
    const _t =
      m.divy != null
        ? "Dividend Yield = Annual dividend / Share price. The cash income you earn just by holding the stock (before tax).\n\n" +
          (_c === "pos"
            ? "\u2705 Green (>4%): Generous yield \u2014 above the Casablanca market average. Attractive for income investors (but check payout sustainability via DPS/EPS)."
            : _c === "neg"
              ? "\u274c Red (<1.5%): Thin yield \u2014 the stock pays very little income. Either it reinvests heavily (growth), or the price is too high relative to the dividend."
              : "\u2796 Neutral (1.5\u20134%): Reasonable yield. Not outstanding but contributes meaningful income alongside capital gains.")
        : "";
    m1 += trow(
      "Dividend Yield",
      m.divy != null ? (m.divy * 100).toFixed(2) + "%" : "\u2014",
      _c,
      _t,
    );
  }
  m1 += trow(
    "DPS",
    m.dps != null ? money(m.dps) + " MAD" : "\u2014",
    "",
    "DPS (Dividend Per Share) = The actual MAD amount paid per share annually. No color \u2014 compare with EPS to assess sustainability (DPS/EPS = payout ratio).",
  );
  {
    const _c = m.eps != null ? (m.eps > 0 ? "pos" : "neg") : "";
    const _t =
      m.eps != null
        ? "EPS (Earnings Per Share) = Net profit / Number of shares. The fundamental measure of profitability per share.\n\n" +
          (_c === "pos"
            ? "\u2705 Green (>0): The company is profitable \u2014 it earns money for shareholders."
            : "\u274c Red (\u22640): Loss-making \u2014 the company is burning cash. Dividends from a loss-making company come from reserves (unsustainable).")
        : "";
    m1 += trow("EPS", m.eps != null ? money(m.eps) + " MAD" : "\u2014", _c, _t);
  }
  m1 += trow(
    "BVPS",
    m.bvps != null ? money(m.bvps) + " MAD" : "\u2014",
    "",
    "BVPS (Book Value Per Share) = Total equity / Number of shares. What you\u2019d theoretically receive per share if the company liquidated at book value. Compare with Price to get P/B.",
  );
  m1 += '<div style="border-top:1px solid var(--border);margin:6px 0"></div>';
  {
    const _fcfCl =
      m.fcf != null
        ? m.fcf > 0
          ? m.eps != null && m.eps > 0 && m.fcf / m.eps > 0.7
            ? "pos"
            : m.fcf / m.eps < 0.4
              ? "neg"
              : ""
          : "neg"
        : "";
    m1 += trow(
      "FCF/Share",
      m.fcf != null ? money(m.fcf) + " MAD" : "\u2014",
      _fcfCl,
      "FCF (Free Cash Flow Per Share) = Operating cash flow minus capital expenditures, per share. The actual cash the business generates after reinvesting.\n\nGreen: FCF > 70% of EPS \u2014 strong cash conversion, earnings are real.\nRed: FCF < 40% of EPS or negative \u2014 earnings may be inflated by accounting (accruals) rather than actual cash generation.\n\nFCF is the truest measure of shareholder value \u2014 dividends and buybacks come from FCF, not reported EPS.",
    );
  }
  {
    const _revPS =
      m.revenue != null && m.price != null && m.revenue > 0
        ? m.price / m.revenue
        : null; // crude P/S (price/revenue-per-share-ish)
    m1 += trow(
      "Revenue/Sh",
      m.revenue != null ? money(m.revenue) + " MAD" : "\u2014",
      "",
      "Revenue Per Share (from Total Revenue TTM / Shares). Useful for loss-making companies where P/E is meaningless \u2014 the P/S (Price/Sales) ratio is a fallback valuation anchor.\n\nNo color coding \u2014 revenue alone doesn\u2019t indicate cheap or expensive; compare with margins and sector peers.",
    );
  }
  {
    const _grCl =
      m.epsGrowth != null
        ? m.epsGrowth > 0.15
          ? "pos"
          : m.epsGrowth < 0
            ? "neg"
            : ""
        : "";
    m1 += trow(
      "EPS Growth (YoY)",
      m.epsGrowth != null
        ? (m.epsGrowth >= 0 ? "+" : "") + (m.epsGrowth * 100).toFixed(1) + "%"
        : "\u2014",
      _grCl,
      "EPS Diluted Growth (TTM, Year-over-Year) = How fast earnings are growing vs last year.\n\n" +
        (m.epsGrowth != null
          ? _grCl === "pos"
            ? "\u2705 Green (>15%): Strong earnings momentum \u2014 the business is expanding."
            : _grCl === "neg"
              ? "\u274c Red (<0%): Earnings are shrinking \u2014 declining profitability or one-time hits."
              : "\u2796 Neutral (0\u201315%): Modest growth."
          : "") +
        "\n\nAlso validates PEG: PEG = P/E \u00f7 Growth. If growth is negative, PEG is misleading.",
    );
  }
  h += sec("\ud83d\udcca Key Metrics", m1);

  // Col 2: Valuation + Signal (with educational tooltips)
  let m2 = "";
  m2 += trow(
    "<b>Fair Value</b>",
    fv != null ? "<b>" + money(fv) + " MAD</b>" : "\u2014",
    "",
    "Fair Value = The intrinsic worth of the stock based on fundamentals (not market price). Blends multiple valuation anchors: Graham formula, Earnings Power, Dividend Discount Model, and 52-wk midpoint. Outlier anchors are trimmed before averaging. If price < fair value \u2192 potentially undervalued.",
  );
  if (fvParts.length) {
    fvParts.forEach((a) => {
      m2 += trow(
        '<span class="mini">' + a[0] + "</span>",
        money(a[1]),
        "",
        "One of the valuation anchors contributing to fair value. Each uses a different methodology; they are weighted by sector and averaged after outlier trimming.",
      );
    });
  }
  m2 += '<div style="border-top:1px solid var(--border);margin:6px 0"></div>';
  m2 += trow(
    "Target Buy",
    tb != null ? money(tb) + " MAD" : "\u2014",
    "pos",
    "Target Buy = Fair value minus a margin of safety. The ideal entry price \u2014 buying below this means you have a cushion.\n\nMargin scales with conviction: High \u2192 small margin (+0%), Medium \u2192 +4%, Low \u2192 +10%. Total discount from fair capped at 45%.",
  );
  m2 += trow(
    "Target Sell",
    ts != null ? money(ts) + " MAD" : "\u2014",
    "neg",
    "Target Sell = Price at which the stock is fully valued.\n\nComputed as max(Fair Value, Buy Target \u00d7 1.18), capped ~10% above 52-week high. Ensures sell is always meaningfully above buy (18%+ spread).",
  );
  if (m.price != null && fv != null) {
    const disc = (fv - m.price) / fv;
    m2 += trow(
      "Discount to Fair",
      (disc * 100).toFixed(0) + "%",
      disc > 0 ? "pos" : "neg",
      "Discount = (Fair Value \u2212 Price) / Fair Value.\n\n" +
        (disc > 0
          ? "Positive: stock trades below intrinsic value \u2192 potential upside."
          : "Negative: stock trades above fair value \u2192 premium over fundamentals."),
    );
  }
  m2 += '<div style="border-top:1px solid var(--border);margin:6px 0"></div>';
  {
    const _sScr = sc && sc.score != null ? sc.score : null;
    const _sCl =
      _sScr != null ? (_sScr > 0.65 ? "pos" : _sScr < 0.4 ? "neg" : "") : "";
    m2 += trow(
      "<b>Signal Score</b>",
      _sScr != null ? "<b>" + (_sScr * 100).toFixed(0) + "%</b>" : "\u2014",
      _sCl,
      "Signal Score = Weighted average of 9 factors (valuation, safety, quality, growth, yield, book value, timing, momentum, peer-relative), adjusted for correlation between similar factors.\n\nWeights vary by sector profile. Score is 0\u2013100%.\n\nGreen (>65%): strong multi-factor signal.\nRed (<40%): weak/unfavorable.\nNeutral (40\u201365%): mixed.",
    );
  }
  {
    const _convTip =
      "Conviction = How much to TRUST the signal score.\n\nBased on:\n1) Factor coverage: what % of scoring factors have data (by weight).\n2) Core data depth: how many of 6 key fundamentals are present (EPS, Book, ROE, Dividends, Balance sheet, 52w range).\n\nHigh (\u226580%): strong data \u2192 score is reliable.\nMedium (55\u201380%): partial \u2192 directionally useful but has gaps.\nLow (<55%): sparse \u2192 treat as speculative.";
    m2 += trow(
      "Conviction",
      sc
        ? '<span class="chip" style="font-size:10px;background:' +
            (sc.conviction === "High"
              ? "rgba(34,197,94,.15);color:var(--success)"
              : sc.conviction === "Low"
                ? "rgba(239,68,68,.15);color:var(--error)"
                : "rgba(245,158,11,.15);color:var(--warn)") +
            '">' +
            sc.conviction +
            "</span>"
        : "\u2014",
      "",
      _convTip,
    );
  }
  {
    const _q = sc && sc.quality != null ? sc.quality : null;
    const _qCl = _q != null ? (_q > 0.6 ? "pos" : _q < 0.35 ? "neg" : "") : "";
    m2 += trow(
      "Quality sub-score",
      _q != null ? (_q * 100).toFixed(0) + "%" : "\u2014",
      _qCl,
      'Quality = Weighted blend of ROE + Safety + Growth, penalized by earnings-quality red flags.\n\nIsolates "is this a good business?" from "is it cheap?" A cheap stock with low quality = value trap.\n\nGreen (>60%): strong business.\nRed (<35%): weak \u2192 may block BUY.\nNeutral: adequate.',
    );
  }
  h += sec("\ud83c\udfaf Valuation & Signal", m2);

  h += "</div>"; // close grid

  // Full-width sections
  // Factor scores
  if (sc && sc.parts) {
    const names = {
      valuation: "Valuation (EV/EBITDA)",
      safety: "Safety (Net Debt)",
      quality: "Quality (ROE)",
      growth: "Growth (PEG)",
      yield: "Yield (Div %)",
      book: "Book (P/B)",
      timing: "Timing",
      momentum: "Range Position",
      peerrel: "Peer-relative",
    };
    const rawVals = {
      valuation: m.ev != null ? m.ev.toFixed(1) + "x" : null,
      safety: m.netdebt != null ? m.netdebt.toFixed(1) + "x" : null,
      quality: m.roe != null ? (m.roe * 100).toFixed(1) + "%" : null,
      growth: m.peg != null ? m.peg.toFixed(1) : null,
      yield: m.divy != null ? (m.divy * 100).toFixed(2) + "%" : null,
      book: m.pb != null ? m.pb.toFixed(2) + "x" : null,
      timing: pir != null ? (pir * 100).toFixed(0) + "%" : null,
      momentum: pir != null ? (pir * 100).toFixed(0) + "%" : null,
      peerrel: _pr && _pr.n ? _pr.n + " peers" : null,
    };
    let fb =
      '<table style="width:100%;font-size:12px"><thead><tr><th class="l">Factor</th><th>Raw</th><th>Weight</th><th>Score</th><th>Contribution</th></tr></thead><tbody>';
    for (const k in sc.parts) {
      const f = sc.parts[k];
      const rv = rawVals[k] || "\u2014";
      const _fCl =
        f.s != null ? (f.s > 0.65 ? "pos" : f.s < 0.35 ? "neg" : "") : "";
      fb +=
        '<tr><td class="l">' +
        (names[k] || k) +
        "</td><td>" +
        rv +
        "</td><td>" +
        (f.w * 100).toFixed(0) +
        '%</td><td class="' +
        _fCl +
        '">' +
        (f.s != null ? (f.s * 100).toFixed(0) + "%" : "\u2014") +
        '</td><td class="' +
        _fCl +
        '">' +
        (f.s != null ? (f.s * f.w * 100).toFixed(0) + "%" : "\u2014") +
        "</td></tr>";
    }
    fb += "</tbody></table>";
    fb +=
      '<div class="mini" style="margin-top:6px;color:var(--muted)">Score is correlation-adjusted (cheapness cluster capped at 1.5\u00d7 max single factor weight).</div>';
    h += sec("\ud83e\udde0 Factor Breakdown", fb);
  }

  // Peer comparison
  if (_pr) {
    let pb = "";
    pb += row(
      "Comparison basis",
      _pr.basis === "category"
        ? (m.cat || "\u2014") + " (same category)"
        : "Broad sector (" + (prof ? prof.label : "\u2014") + ")",
    );
    pb += row(
      "Comparable count",
      String(_pr.n) + (_pr.n < 4 ? ' <span class="neg">(thin)</span>' : ""),
    );
    const st = typeof sectorStats === "function" ? sectorStats() : null;
    const ref = st
      ? _pr.basis === "category"
        ? st.cat && st.cat[m.cat || ""]
        : st.prof && st.prof[prof ? prof.key : ""]
      : null;
    if (ref) {
      if (ref.pe != null)
        pb += row(
          "Peer median P/E",
          ref.pe.toFixed(1) +
            (m.pe
              ? ' <span class="mini">(you: ' + m.pe.toFixed(1) + ")</span>"
              : ""),
        );
      if (ref.pb != null)
        pb += row(
          "Peer median P/B",
          ref.pb.toFixed(2) +
            (m.pb
              ? ' <span class="mini">(you: ' + m.pb.toFixed(2) + ")</span>"
              : ""),
        );
      if (ref.divy != null)
        pb += row(
          "Peer median Div Y",
          (ref.divy * 100).toFixed(1) +
            "%" +
            (m.divy
              ? ' <span class="mini">(you: ' +
                (m.divy * 100).toFixed(1) +
                "%)</span>"
              : ""),
        );
    }
    pb += row(
      "Peer score",
      (_pr.score * 100).toFixed(0) +
        "% \u2014 " +
        (_pr.score >= 0.6
          ? "cheaper than peers"
          : _pr.score <= 0.4
            ? "pricier than peers"
            : "in line"),
      _pr.score >= 0.6 ? "pos" : _pr.score <= 0.4 ? "neg" : "",
    );
    h += sec("\ud83d\udc65 Peer Comparison", pb);
  }

  // Earnings quality
  if (!eq.ok) {
    let eqb = '<ul style="margin:0;padding-left:16px;color:var(--warn)">';
    eq.flags.forEach((f) => {
      eqb += "<li>" + escapeHtml(f) + "</li>";
    });
    eqb += "</ul>";
    h += sec("\u26a0\ufe0f Earnings Quality Concerns", eqb);
  }

  // Dividend safety
  if (ds) {
    let dsb = "";
    dsb += row(
      "Level",
      '<span class="' +
        (ds.level === "ok" ? "pos" : ds.level === "danger" ? "neg" : "") +
        '">' +
        ds.level +
        "</span>",
    );
    if (ds.note) dsb += row("Note", ds.note);
    h += sec("\ud83d\udcb0 Dividend Safety", dsb);
  }

  // Signal reasons
  if (sig && sig.reasons && sig.reasons.length) {
    h += sec(
      "\ud83d\udca1 Signal Reasons",
      '<ul style="margin:0;padding-left:16px">' +
        sig.reasons.map((x) => "<li>" + x + "</li>").join("") +
        "</ul>",
    );
  }

  // Action: draft pending
  h +=
    '<div style="text-align:center;margin-top:14px"><button class="btn" data-act="draftPendingFromDetail" data-args="' +
    tk +
    '">\u2795 Draft pending order for ' +
    escapeHtml(tk) +
    "</button></div>";

  // Overlay
  let ov = document.getElementById("compDetailOverlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "compDetailOverlay";
    ov.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9998;display:flex;align-items:flex-start;justify-content:center;padding:30px 20px;overflow:auto";
    ov.onclick = (e) => {
      if (e.target === ov) closeCompanyDetail();
    };
    document.body.appendChild(ov);
  }
  ov.innerHTML =
    '<div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:22px 26px;max-width:860px;width:100%;box-shadow:var(--shadow);max-height:90vh;overflow:auto">' +
    h +
    "</div>";
  ov.style.display = "flex";
};
window.closeCompanyDetail = function () {
  const ov = document.getElementById("compDetailOverlay");
  if (ov) ov.style.display = "none";
};
// Named handler for the detail-overlay "Draft pending order" button
// (replaces a compound inline onclick so it can use data-act delegation).
window.draftPendingFromDetail = function (tk) {
  closeCompanyDetail();
  if (typeof prefillPending === "function") prefillPending(tk);
};
