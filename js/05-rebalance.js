// ============================================================
// 05-rebalance.js
// rebalance: est costs, computeRebalance, rebalance render, rbDraft*, company-detail overlay
// Part of the Portfolio Tracker app. Loaded as an ordered plain
// <script> (shared global scope) - order matters, see index.html.
// ============================================================
// ============ REBALANCE / SECTOR-DIVERSIFY OPTIMIZER ============
// Default sector-concentration caps (%), the fallback when the rbCap/rbCapOpcvm
// inputs are empty. Single source for these two literals, which were otherwise
// repeated here and in the Sector-Headroom widget (03b-signals-ui.js). Each
// consumer still applies its own clamp range + unit (fraction vs percent).
const RB_CAP_DEFAULTS = { cap: 20, opcvm: 35 };
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
// Thin alias to the shared isOpcvm() (01-core) - kept because this file calls it
// in many lot-rounding spots; the actual OPCVM test lives in one place now.
function isOpcvmTk(tk) {
  return isOpcvm(tk);
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
        parseFloat((document.getElementById("rbCap") || {}).value) ||
          RB_CAP_DEFAULTS.cap,
      ),
    ) / 100;
  const capOpcvm =
    Math.min(
      100,
      Math.max(
        5,
        parseFloat((document.getElementById("rbCapOpcvm") || {}).value) ||
          RB_CAP_DEFAULTS.opcvm,
      ),
    ) / 100;
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
  // ---- target-model options (new controls; safe defaults when absent) ----
  // Risk-adjust targets by volatility (ON by default).
  const _riskEl = document.getElementById("rbRiskAdj");
  const riskAdjust = _riskEl ? !!_riskEl.checked : true;
  // Deliberate cash reserve: hold back this % of the sleeve as cash (0..95).
  const reservePct =
    Math.min(
      95,
      Math.max(
        0,
        parseFloat((document.getElementById("rbReserve") || {}).value) || 0,
      ),
    ) / 100;
  // Minimum attractiveness a name must reach before cash is deployed into it;
  // below this the engine leaves cash idle (waiting is valid). 0 = deploy freely.
  const minAttract = Math.max(
    0,
    parseFloat((document.getElementById("rbMinAttract") || {}).value) || 0,
  );
  // Trim winners that drift above target (OFF by default = let winners run).
  const _twEl = document.getElementById("rbTrimWinners");
  const wantTrimWinners = _twEl ? !!_twEl.checked : false;
  // Tolerance band before an over-target winner is trimmed (default 25%).
  const trimTol =
    Math.max(
      0,
      parseFloat((document.getElementById("rbTrimTol") || {}).value) || 25,
    ) / 100;
  // Recycle trim proceeds into the buy budget (follows the Suggest-trims toggle).
  const recycleTrims = wantTrims;
  // Value-vs-Diversification tilt (0..1). 0 = pure diversification-led (the
  // original behaviour: sector caps are HARD and diversification dominates the
  // buy score). 1 = value-led (undervalued names can be bought slightly past a
  // full sector cap, and valuation/quality lead the ranking). Defaults to 0 so
  // an absent slider reproduces today's output exactly. Persisted in
  // casa_rebalance_v1, so it rides the existing backup.
  const valueTiltRaw = parseFloat(
    (document.getElementById("rbValueTilt") || {}).value,
  );
  const vTilt = Math.min(
    1,
    Math.max(0, (isFinite(valueTiltRaw) ? valueTiltRaw : 0) / 100),
  );
  // Dollar-cost-average into existing winners (ON by default). When on, the
  // engine biases a slice of the buy budget toward names already held so you
  // average down/up rather than only opening new positions. Off = 0 boost.
  const _dcaEl = document.getElementById("rbDca");
  const wantDca = _dcaEl ? !!_dcaEl.checked : true;

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
          // Blend the average cost so the projected lot carries a realistic
          // post-pending basis. Leaving p.avg at the pre-pending average made
          // the trim gain/share and the DCA trigger (price < avg) fire off a
          // stale cost. Weighted mean of old basis and the pending fill price.
          const prevAvg = p.avg != null && p.avg > 0 ? p.avg : o.price;
          const prevQty = p.held > 0 ? p.held : 0;
          const newQty = prevQty + o.qty;
          if (newQty > 0)
            p.avg = (prevAvg * prevQty + o.price * o.qty) / newQty;
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

  // ============================================================
  // TARGET-WEIGHT MODEL (src/core/portfolio-model.js via __core).
  // Everything from here builds the model inputs, calls the engine, and shapes
  // the result for renderRebalance(). The old greedy loop is retired.
  // ============================================================
  const PM =
    typeof __core !== "undefined" && __core.portfolioModel
      ? __core.portfolioModel
      : null;

  // candidate universe: priced names; stocks need a fair value, funds included
  // only when the OPCVMs toggle is on. Buy-signal-only filter optional.
  let cands = computeSignalsRows().filter(
    (r) =>
      r.m &&
      (includeOpcvm || r.m.cat !== "OPCVM") &&
      r.price != null &&
      r.price > 0 &&
      (r.m.cat === "OPCVM" ? true : fairValue(r.m) != null),
  );
  if (buyOnly) cands = cands.filter((r) => r.sig && r.sig.c === "b-buy");
  // ---- per-ticker annualised volatility from the daily repo history ----
  // Spacing-aware (weekly funds aren't overstated). Missing/thin history -> null
  // -> the model treats it as neutral risk. Reused across candidates+positions.
  const _ph = typeof getPriceHistory === "function" ? getPriceHistory() : null;
  const _volCache = {};
  const volOf = (tk) => {
    if (tk in _volCache) return _volCache[tk];
    let v = null;
    if (_ph && _ph.rows && PM) {
      const ser = [];
      for (const row of _ph.rows) {
        const c = row.closes && row.closes[tk];
        if (row.date && c != null && isFinite(+c) && +c > 0)
          ser.push({ date: row.date, close: +c });
      }
      v = PM.annualizedVol(ser);
    }
    _volCache[tk] = v;
    return v;
  };

  // ---- build model candidates ----
  // base = factor score (0..1); disc = discount to fair value; conviction from
  // the signal engine; vol from history; sellRated flags a full-exit target.
  const modelCands = cands.map((r) => {
    const fv = fairValue(r.m);
    const cat = r.m.cat || "Uncategorized";
    const isFund = cat === "OPCVM";
    const _fs = isFund ? null : factorScores(r.m);
    const base =
      _fs && typeof _fs.score === "number" ? _fs.score : isFund ? 0.5 : 0; // funds have no factor score; give a neutral base so they can be sized by under-weight when included
    const disc = fv != null && fv > 0 ? (fv - r.price) / fv : 0;
    return {
      ticker: r.ticker,
      cat,
      base,
      disc,
      conviction: r.conviction || (_fs && _fs.conviction) || "Medium",
      vol: volOf(r.ticker),
      sellRated: !!(r.sig && (r.sig.c === "b-sell" || r.sig.c === "b-trim")),
      // carried through for display / trade shaping
      _fv: fv,
      _price: r.price,
      _name: r.m.name || r.ticker,
      _isFund: isFund,
      _sig: r.sig,
      _cyc: r.m.cycle || "OPCVM / Funds",
      _sty: r.m.style || "OPCVM / Funds",
    };
  });

  // ---- target weights (capped water-filling) ----
  const caps = {
    nameCap: Math.min(0.25, Math.max(0.1, capPct)),
    sectorCap: capPct,
    opcvmCap: capOpcvm,
    opcvmCats: ["OPCVM"],
  };
  // Manual per-name pins (user override of the model), persisted locally.
  const pinned = loadRbPins();
  // Category for each pinned ticker, so a pin on a name that is NOT a model
  // candidate still charges against its sector cap in the engine (otherwise the
  // flex picks could fill that sector up to cap on top of the pin). Resolved
  // from the global metadata map M; unknown names simply stay uncharged.
  const pinnedCats = {};
  Object.keys(pinned).forEach((tk) => {
    const meta = M[tk];
    if (meta && meta.cat) pinnedCats[tk] = meta.cat;
  });
  const targets = PM
    ? PM.targetWeights(modelCands, caps, {
        valueTilt: vTilt,
        riskAdjust,
        reservePct,
        pinned,
        pinnedCats,
      })
    : { weights: {}, attract: {}, volRef: 0.25, pinned: {} };

  // ---- positions snapshot for the trade planner (merge PEA/Regular per ticker) ----
  // Each held account-level position (ticker||PEA / ticker||REG) becomes a tax
  // LOT { qty, cost(per-share avg), pea } so the planner can trim tax-efficiently
  // (PEA first, then highest-cost Regular). cat/cyc/sty/vol ride along for the
  // portfolio readout.
  const byTicker = {};
  held.forEach((p) => {
    const tk = p.ticker;
    const m = M[tk] || {};
    // When OPCVMs are NOT included, funds are entirely hands-off: keep them out
    // of the planner's position set so they're never trimmed (nor bought). The
    // candidate list already excludes them; this makes the sell side match, so
    // a held fund isn't flagged "not in model -> exit".
    if (!includeOpcvm && m.cat === "OPCVM") return;
    if (!byTicker[tk])
      byTicker[tk] = {
        ticker: tk,
        cat: m.cat || "Uncategorized",
        cyc: m.cycle || "OPCVM / Funds",
        sty: m.style || "OPCVM / Funds",
        held: 0,
        value: 0,
        costSum: 0,
        price: p.price,
        isFund: m.cat === "OPCVM",
        name: m.name || tk,
        lots: [],
      };
    const b = byTicker[tk];
    b.held += p.held;
    b.value += p.value;
    b.costSum += (p.avg != null ? p.avg : p.price) * p.held;
    // Carry the broker from the largest account-level lot so trade cost/net is
    // estimated at the RIGHT fee schedule (not the default). runFIFO exposes it.
    if (p.broker && (b._brokerQty == null || p.held > b._brokerQty)) {
      b.broker = p.broker;
      b._brokerQty = p.held;
    }
    if (p.held > 0)
      b.lots.push({
        qty: p.held,
        cost: p.avg != null ? p.avg : p.price,
        pea: !!p.isPea,
      });
  });
  const mcByTk = {};
  modelCands.forEach((c) => (mcByTk[c.ticker] = c));
  const positions = Object.values(byTicker).map((b) => {
    const mc = mcByTk[b.ticker];
    const avg = b.held > 0 ? b.costSum / b.held : null;
    const fs = b.isFund ? null : factorScores(M[b.ticker] || {});
    const sig = mc ? mc._sig : null;
    return {
      ticker: b.ticker,
      cat: b.cat,
      cyc: b.cyc,
      sty: b.sty,
      vol: volOf(b.ticker),
      held: b.held,
      price: b.price,
      value: b.value,
      avg,
      broker: b.broker || null,
      lots: b.lots,
      isFund: b.isFund,
      fv: mc ? mc._fv : fairValue(M[b.ticker] || {}),
      sellRated: !!(sig && (sig.c === "b-sell" || sig.c === "b-trim")),
      buyOrHold: !!(
        sig &&
        (sig.c === "b-buy" || sig.c === "b-hold" || sig.c === "b-wait")
      ),
      quality: fs && typeof fs.quality === "number" ? fs.quality : null,
      name: b.name,
    };
  });

  // Position lookup (by ticker) - used by the fee helpers below AND when
  // shaping buys/trims further down.
  const posByTk2 = {};
  positions.forEach((p) => (posByTk2[p.ticker] = p));

  // ---- plan the trades ----
  // Fee helpers price each trade at the HOLDING's broker when known (sells and
  // top-ups of held names), else the default broker (new buys). planTrades
  // passes (ticker, qty, price); we resolve the broker from the position map.
  const _brokerOf = (tk) => {
    const pp = posByTk2[tk];
    return pp && pp.broker ? pp.broker : undefined;
  };
  const helpers = {
    buyCost: (tk, q, px) => estBuyCost(px, q, _brokerOf(tk)),
    sellNet: (tk, q, px) => estSellNet(px, q, _brokerOf(tk)),
    lotRound: (tk, q) => lotRound(q, isOpcvmTk(tk)),
  };
  // Price lookup for every model candidate (held OR not) so the planner can
  // size buys for NEW names that have no position to read a price from.
  const rbPrices = {};
  modelCands.forEach((c) => {
    if (c && c.ticker && c._price != null) rbPrices[c.ticker] = c._price;
  });
  // Category/cycle/style metadata for EVERY model candidate (held OR not). The
  // post-plan readout groups post-trade value by cat/cyc/sty, and that value
  // set includes NEW buys that aren't in `positions`. Without this map the
  // engine's metaOf() finds nothing for a freshly-bought name and dumps it into
  // "Uncategorized"/"Unclassified" even though M has its category. Pass the
  // candidate metadata (falling back to M) so buys group correctly too.
  const rbMeta = {};
  modelCands.forEach((c) => {
    if (!c || !c.ticker) return;
    rbMeta[c.ticker] = {
      cat: c.cat,
      cyc: c._cyc,
      sty: c._sty,
      name: c._name,
    };
  });
  // Backstop straight from M for anything the candidate list didn't cover.
  Object.keys(targets.weights || {}).forEach((tk) => {
    if (rbMeta[tk] || !M[tk]) return;
    rbMeta[tk] = {
      cat: M[tk].cat,
      cyc: M[tk].cycle,
      sty: M[tk].style,
      name: M[tk].name,
    };
  });
  const planResult = PM
    ? PM.planTrades(targets, positions, cash, helpers, {
        minAttract,
        suggestTrims: wantTrims,
        trimWinners: wantTrimWinners,
        trimTolerance: trimTol,
        dcaBoost: wantDca ? 0.5 : 0,
        recycleTrims,
        maxBuys,
        prices: rbPrices,
        meta: rbMeta,
      })
    : {
        buys: [],
        sells: [],
        holdCash: cash,
        sleeve: totalNow + cash,
        rows: [],
        notes: [],
      };

  // ---- shape buys/trims for the renderer (and the rbDraft* actions) ----
  const plan = planResult.buys.map((b) => {
    const mc = mcByTk[b.ticker];
    const p = posByTk2[b.ticker];
    return {
      ticker: b.ticker,
      name: mc ? mc._name : b.ticker,
      cat: mc ? mc.cat : "Uncategorized",
      cyc: mc ? mc._cyc : "OPCVM / Funds",
      sty: mc ? mc._sty : "OPCVM / Funds",
      px: b.price,
      qty: b.qty,
      gross: b.qty * b.price,
      cost: b.cost,
      disc: mc ? mc.disc : 0,
      fv: mc ? mc._fv : null,
      attract: b.attract,
      vol: mc ? mc.vol : null,
      targetWt: targets.weights[b.ticker] || 0,
      curWt: p && planResult.sleeve > 0 ? p.value / planResult.sleeve : 0,
      sig: mc ? mc._sig : null,
      held: !!(p && p.held > 0),
      opcvm: mc ? mc._isFund : false,
      dca: !!b.dca,
      why: _rbBuyWhy(b, mc, p, targets, planResult.sleeve),
    };
  });
  const trims = planResult.sells.map((s) => {
    const mc = mcByTk[s.ticker];
    const p = posByTk2[s.ticker];
    return {
      ticker: s.ticker,
      name: (p && p.name) || (mc && mc._name) || s.ticker,
      cat: (p && p.cat) || (mc && mc.cat) || "Uncategorized",
      px: s.price,
      qty: s.qty,
      net: s.net,
      gross: s.qty * s.price,
      disc: mc ? mc.disc : 0,
      fv: mc ? mc._fv : null,
      reason: s.reason,
      account: s.account || "",
      lotPlan: s.lotPlan || [],
      opcvm: !!(p && p.isFund),
      targetWt: targets.weights[s.ticker] || 0,
      curWt: s.curWt,
      why: _rbSellWhy(s, mc),
    };
  });
  // "Why not bought" rows: resolve ticker -> name/cat + its target weight.
  const skipped = (planResult.skipped || []).map((s) => {
    const mc = mcByTk[s.ticker];
    return {
      ticker: s.ticker,
      name: mc ? mc._name : s.ticker,
      cat: mc ? mc.cat : "",
      targetWt: targets.weights[s.ticker] || 0,
      attract: targets.attract[s.ticker] || 0,
      reason: s.reason,
    };
  });

  const spent = plan.reduce((a, x) => a + x.cost, 0);
  const trimProceeds = trims.reduce((a, t) => a + (t.net || 0), 0);
  return {
    cash,
    capPct,
    capOpcvm,
    maxBuys,
    buyOnly,
    wantTrims,
    includeOpcvm,
    totalNow,
    plan,
    trims,
    trimProceeds,
    // Spendable budget = new cash + recycled trim net (the planner spends out of
    // this same pool). Do NOT add trimProceeds on top of a separately-counted
    // budget - that double-counts. spent/holdCash come straight from the planner.
    buyBudget: cash + (recycleTrims ? trimProceeds : 0),
    spent,
    remaining: planResult.holdCash,
    holdCash: planResult.holdCash,
    rows: planResult.rows,
    notes: planResult.notes,
    skipped,
    readout: planResult.readout || null,
    targets,
    pinned: targets.pinned || {},
    sleeve: planResult.sleeve,
    valueTilt: vTilt,
    riskAdjust,
    reservePct,
    pendingAccounted: _rbPending,
    pendingCount: _rbPending ? (PENDING || []).length : 0,
  };
}

// ---- Manual target pins (user overrides of the model) ----
// Persisted as casa_rb_pins_v1 = { TICKER: weightPct 0..100 }. Stored as a
// percentage for a friendly UI; converted to a 0..1 fraction for the engine.
const RB_PINS_LS = "casa_rb_pins_v1";
function loadRbPinsRaw() {
  try {
    const raw = localStorage.getItem(RB_PINS_LS);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" ? v : {};
  } catch (e) {
    return {};
  }
}
// Engine form: { ticker: fraction 0..1 }.
function loadRbPins() {
  const raw = loadRbPinsRaw();
  const out = {};
  for (const tk in raw) {
    const pct = +raw[tk];
    if (isFinite(pct) && pct > 0) out[tk] = Math.min(1, pct / 100);
  }
  return out;
}
// Set/clear a pin from the UI (pct 0..100; <=0 or blank clears it), then re-run.
window.rbSetPin = function (tk) {
  if (!tk) return;
  const cur = loadRbPinsRaw();
  const existing = cur[tk] != null ? cur[tk] : "";
  const ans = window.prompt(
    "Pin " +
      tk +
      " to a target weight % of the portfolio (blank or 0 to remove the pin):",
    String(existing),
  );
  if (ans == null) return; // cancelled
  const pct = parseFloat(ans);
  if (!isFinite(pct) || pct <= 0) delete cur[tk];
  else cur[tk] = Math.min(100, pct);
  try {
    safeSetItem(RB_PINS_LS, JSON.stringify(cur));
  } catch (e) {}
  renderRebalance();
};
// Clear ALL pins and re-run.
window.rbClearPins = function () {
  try {
    localStorage.removeItem(RB_PINS_LS);
  } catch (e) {}
  renderRebalance();
};

// Build the per-buy "why" string from the model result. Explains, in plain
// language, why the TARGET-WEIGHT model picked this name: the weight gap it's
// closing, the inputs that drove its attractiveness score (valuation,
// conviction, signal rating, volatility, DCA), and whether a manual pin is
// overriding the model here. This is what shows under the ticker AND in the
// row's tooltip, so it needs to stand on its own without the reader having
// to know the engine's internals.
function _rbBuyWhy(b, mc, p, targets, sleeve) {
  const parts = [];
  const tgtWt = targets.weights[b.ticker] || 0;
  const curWt = p && sleeve > 0 ? p.value / sleeve : 0;
  const isPinned = targets.pinned && targets.pinned[b.ticker] != null;
  if (isPinned) {
    parts.push(
      "manually pinned to " +
        (targets.pinned[b.ticker] * 100).toFixed(0) +
        "% (overrides the model)",
    );
  } else if (tgtWt > 0) {
    parts.push(
      "model wants " +
        (tgtWt * 100).toFixed(0) +
        "% of the portfolio here, you're at " +
        (curWt * 100).toFixed(0) +
        "% \u2014 this buy closes part of that gap",
    );
  }
  if (mc && mc.disc > 0.02)
    parts.push(
      (mc.disc * 100).toFixed(0) +
        "% below fair value (raises its attractiveness score)",
    );
  if (b.dca)
    parts.push(
      "averaging down: price is below your average cost and the name is still sound, so the ranking gives it a boost",
    );
  if (mc && mc.conviction === "High")
    parts.push(
      "high-conviction name (ranked above similar lower-conviction picks)",
    );
  if (mc && mc._sig && mc._sig.c === "b-buy")
    parts.push("rated Buy by the signal engine");
  if (mc && mc.vol != null && mc.vol > 0.3)
    parts.push(
      "higher volatility (" +
        (mc.vol * 100).toFixed(0) +
        "% ann.) trims its target weight a bit when risk-adjust is on",
    );
  return parts.length
    ? "Buy: " + parts.slice(0, 4).join(" \u00B7 ")
    : "Buy: moves the portfolio toward its model target for this name";
}
// Build the per-sell/trim "why" string. The engine only hands back a short
// category (`reason`): Sell-rated / not in model / above fair value / over
// target. This expands that into the actual numbers that justified it, so the
// reader doesn't have to guess what "over target" or "above fair value" mean
// in their specific case.
function _rbSellWhy(s, mc) {
  const r = s.reason || "";
  const curPct = ((s.curWt || 0) * 100).toFixed(0);
  const tgtPct = ((s.tgtWt || 0) * 100).toFixed(0);
  if (r === "Sell-rated")
    return "Trim: the signal engine rates this a Sell \u2014 full exit recommended regardless of target weight.";
  if (r === "not in model")
    return "Trim: this name has no target weight in the current model (filtered out or zero attractiveness) \u2014 full exit recommended.";
  if (r === "above fair value") {
    const fv = mc ? mc._fv : null;
    const px = s.price;
    const overPct =
      fv != null && fv > 0 && px != null
        ? (((px - fv) / fv) * 100).toFixed(0)
        : null;
    return (
      "Trim: price is" +
      (overPct != null ? " " + overPct + "% above" : " above") +
      " fair value \u2014 trimming back toward its " +
      tgtPct +
      "% target (currently " +
      curPct +
      "%)."
    );
  }
  if (r === "over target")
    return (
      "Trim: this holding has drifted to " +
      curPct +
      "% of the portfolio, above its " +
      tgtPct +
      "% target by more than the trim band \u2014 trimming the excess back toward target."
    );
  return r
    ? "Trim: " + r
    : "Trim: moves the portfolio toward its model target for this name";
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
      valueTilt: (g("rbValueTilt") || {}).value,
      riskAdj: g("rbRiskAdj") ? !!g("rbRiskAdj").checked : true,
      reserve: (g("rbReserve") || {}).value,
      minAttract: (g("rbMinAttract") || {}).value,
      trimWinners: !!(g("rbTrimWinners") || {}).checked,
      trimTol: (g("rbTrimTol") || {}).value,
      dca: g("rbDca") ? !!g("rbDca").checked : true,
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
    if (s.valueTilt != null && g("rbValueTilt")) {
      g("rbValueTilt").value = s.valueTilt;
      const _lbl = g("rbValueTiltVal");
      if (_lbl) _lbl.textContent = _rbTiltLabel(s.valueTilt);
    }
    if (s.riskAdj != null && g("rbRiskAdj"))
      g("rbRiskAdj").checked = !!s.riskAdj;
    if (s.reserve != null && g("rbReserve")) g("rbReserve").value = s.reserve;
    if (s.minAttract != null && g("rbMinAttract"))
      g("rbMinAttract").value = s.minAttract;
    if (s.trimWinners != null && g("rbTrimWinners"))
      g("rbTrimWinners").checked = !!s.trimWinners;
    if (s.trimTol != null && g("rbTrimTol")) g("rbTrimTol").value = s.trimTol;
    if (s.dca != null && g("rbDca")) g("rbDca").checked = !!s.dca;
  } catch (e) {}
}
// Human label for the value-vs-diversification slider position. Shows the exact
// numeric position AND a word, e.g. "50 - Balanced", so you always know where
// it's set.
function _rbTiltLabel(v) {
  const n = Math.round(Math.min(100, Math.max(0, parseFloat(v) || 0)));
  let word;
  if (n <= 10) word = "Diversification";
  else if (n >= 90) word = "Value";
  else if (n < 45) word = "Lean diversification";
  else if (n > 55) word = "Lean value";
  else word = "Balanced";
  return n + " - " + word;
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
  if (hint) hint.textContent = "";

  const pct0 = (x) => (x * 100).toFixed(0) + "%";
  const pct1 = (x) => (x * 100).toFixed(1) + "%";
  const sleeve = R.sleeve || R.totalNow + R.cash;
  const pins = loadRbPinsRaw(); // { TICKER: pct } for the pin badges/buttons

  // Sell row: compact account label (e.g. "PEA 8 / Reg 2") from the lot plan.
  const _sellAccountCell = (x) => {
    const lp = x.lotPlan || [];
    if (!lp.length) return x.account ? escapeHtml(x.account) : "\u2014";
    return lp
      .map(
        (s) =>
          escapeHtml(s.account === "Regular" ? "Reg" : s.account || "?") +
          " " +
          money(s.qty, s.qty % 1 ? 4 : 0),
      )
      .join(" / ");
  };
  // Sell tooltip: per-lot breakdown with gain/share, flagging the tax-free PEA
  // slice and realised-loss (negative-gain) lots.
  const _lotPlanTip = (x) => {
    const lp = x.lotPlan || [];
    if (!lp.length) return "";
    let s = tipRule ? tipRule() : "";
    s += tipRow("<b>Tax lots sold</b>", "");
    for (const l of lp) {
      const g =
        l.gainPS == null
          ? ""
          : " (" +
            (l.gainPS >= 0 ? "+" : "") +
            money(l.gainPS) +
            "/sh " +
            (l.account === "PEA"
              ? "tax-free"
              : l.gainPS < 0
                ? "loss"
                : "taxable") +
            ")";
      s += tipRow(
        escapeHtml(l.account || "?") +
          " \u00D7 " +
          money(l.qty, l.qty % 1 ? 4 : 0),
        g || "\u2014",
      );
    }
    s += tipNote(
      "Trimmed PEA first (gains tax-exempt), then Regular highest-cost first to minimise the capital-gains tax.",
    );
    return s;
  };

  // ---- Trade list (buys + sells), the actionable output ----
  const buyRows = (R.plan || [])
    .slice()
    .sort((a, b) => b.cost - a.cost)
    .map((x) => {
      const tip =
        tipHead("Buy \u00B7 " + escapeHtml(x.ticker)) +
        tipRow("Target weight", pct1(x.targetWt)) +
        tipRow("Current weight", pct1(x.curWt || 0)) +
        tipRow("Price", money(x.px)) +
        tipRow("Qty (whole lots)", money(x.qty, x.opcvm && x.qty % 1 ? 4 : 0)) +
        tipRow("Cost (net fees)", money(x.cost, 0) + " MAD") +
        (x.fv != null ? tipRow("Fair value", money(x.fv)) : "") +
        (x.disc != null ? tipRow("Disc. to FV", pct0(x.disc)) : "") +
        (x.vol != null ? tipRow("Volatility (ann.)", pct0(x.vol)) : "") +
        tipRow("Attractiveness", (x.attract || 0).toFixed(2)) +
        tipNote(escapeHtml(x.why || ""));
      return (
        '<tr class="nis-cell" style="cursor:help" data-tip="' +
        tipRef(tip) +
        '"><td class="l"><b>' +
        escapeHtml(x.ticker) +
        "</b> " +
        (x.held
          ? '<span class="tag-in" style="font-size:9px">held</span>'
          : '<span class="badge b-buy" style="font-size:9px">new</span>') +
        (x.dca
          ? ' <span class="badge b-buy" style="font-size:9px" data-tip="Averaging down: this name is below your average cost and still rated sound, so the buy ranking gave it a boost.">DCA</span>'
          : "") +
        ' <span class="mini" style="color:var(--text2)">' +
        escapeHtml(x.name) +
        "</span>" +
        (x.why
          ? '<div class="mini" style="color:var(--muted);margin-top:2px;white-space:normal;max-width:340px">' +
            escapeHtml(x.why) +
            "</div>"
          : "") +
        '</td><td class="l mini" style="color:var(--text2)">' +
        escapeHtml(x.cat) +
        '</td><td style="text-align:right;font-family:var(--mono)">' +
        money(x.px) +
        '</td><td style="text-align:right;font-family:var(--mono)">' +
        money(x.qty, x.opcvm && x.qty % 1 ? 4 : 0) +
        '</td><td style="text-align:right;font-family:var(--mono)">' +
        money(x.cost, 0) +
        '</td><td style="text-align:right;font-family:var(--mono)">' +
        pct0(x.curWt || 0) +
        " \u2192 " +
        pct0(x.targetWt || 0) +
        '</td><td style="text-align:right"><button class="btn sec2" style="font-size:10px;padding:3px 8px" data-act="rbDraftOne" data-args="' +
        x.ticker +
        "," +
        x.px +
        "," +
        x.qty +
        '">Draft</button></td></tr>'
      );
    })
    .join("");

  const sellRows = (R.trims || [])
    .map((x) => {
      const tip =
        tipHead("Sell / trim \u00B7 " + escapeHtml(x.ticker)) +
        tipRow("Reason", escapeHtml(x.reason || "")) +
        tipRow("Current weight", pct1(x.curWt || 0)) +
        tipRow("Target weight", pct1(x.targetWt || 0)) +
        tipRow("Price", money(x.px)) +
        tipRow("Qty", money(x.qty, x.opcvm && x.qty % 1 ? 4 : 0)) +
        tipRow("Net proceeds", money(x.net, 0) + " MAD") +
        (x.fv != null ? tipRow("Fair value", money(x.fv)) : "") +
        tipNote(escapeHtml(x.why || "")) +
        _lotPlanTip(x);
      return (
        '<tr class="nis-cell" style="cursor:help" data-tip="' +
        tipRef(tip) +
        '"><td class="l"><b>' +
        escapeHtml(x.ticker) +
        '</b> <span class="mini" style="color:var(--text2)">' +
        escapeHtml(x.name) +
        "</span>" +
        '<div class="mini" style="color:var(--muted);margin-top:2px">' +
        escapeHtml(x.why || "") +
        "</div>" +
        '</td><td class="l mini" style="color:var(--text2)">' +
        escapeHtml(x.cat) +
        '</td><td style="text-align:right;font-family:var(--mono)">' +
        money(x.px) +
        '</td><td style="text-align:right;font-family:var(--mono)">' +
        money(x.qty, x.opcvm && x.qty % 1 ? 4 : 0) +
        '</td><td style="text-align:right;font-family:var(--mono)">' +
        money(x.net, 0) +
        '</td><td class="l mini" style="color:var(--text2)">' +
        _sellAccountCell(x) +
        '</td><td style="text-align:right;font-family:var(--mono)">' +
        pct0(x.curWt || 0) +
        " \u2192 " +
        pct0(x.targetWt || 0) +
        "</td></tr>"
      );
    })
    .join("");

  // ---- Model vs Actual table (every name with a target or a holding) ----
  const modelRows = (R.rows || [])
    .map((r) => {
      const drift = (r.tgtWt || 0) - (r.curWt || 0);
      const driftCls = drift > 0.005 ? "pos" : drift < -0.005 ? "neg" : "";
      const act = r.action || "-";
      const actCls =
        act.indexOf("Buy") === 0
          ? "pos"
          : act.indexOf("Trim") === 0 || act.indexOf("Exit") === 0
            ? "neg"
            : "";
      const isPinned = pins[r.ticker] != null;
      return (
        '<tr><td class="l">' +
        tickerBadge(r.ticker) +
        '<b style="cursor:pointer;color:var(--primary2)" data-tip="Click for full company details" data-act="showCompanyDetail" data-args="' +
        escapeHtml(r.ticker) +
        '" data-stop="true">' +
        escapeHtml(r.ticker) +
        "</b>" +
        (isPinned
          ? ' <span class="badge b-wait" style="font-size:9px" data-tip="Manually pinned to ' +
            pins[r.ticker] +
            '% \u2014 this overrides the model\u2019s own target weight for this name.">\uD83D\uDCCC ' +
            pins[r.ticker] +
            "%</span>"
          : "") +
        '</td><td style="text-align:right;font-family:var(--mono)">' +
        pct1(r.curWt || 0) +
        '</td><td style="text-align:right;font-family:var(--mono)' +
        (isPinned ? ";color:var(--primary2);font-weight:600" : "") +
        '">' +
        pct1(r.tgtWt || 0) +
        '</td><td style="text-align:right;font-family:var(--mono)" class="' +
        driftCls +
        '">' +
        (drift >= 0 ? "+" : "") +
        pct1(drift) +
        '</td><td style="text-align:right;font-family:var(--mono)">' +
        (r.attract || 0).toFixed(2) +
        '</td><td style="text-align:right" class="' +
        actCls +
        '">' +
        escapeHtml(act) +
        '</td><td style="text-align:center"><button class="btn sec2" style="font-size:10px;padding:2px 7px" data-act="rbSetPin" data-args="' +
        escapeHtml(r.ticker) +
        '" data-tip="Pin this name to a fixed target weight (override the model)">' +
        (isPinned ? "\uD83D\uDCCC" : "pin") +
        "</button></td></tr>"
      );
    })
    .join("");

  const notesHtml = (R.notes || [])
    .map(
      (n) =>
        '<div class="mini" style="color:var(--text2);margin-top:4px">\u2139\uFE0F ' +
        escapeHtml(n) +
        "</div>",
    )
    .join("");

  // ---- (A) Portfolio readout: the SHAPE of the portfolio after the plan ----
  const ro = R.readout;
  let readoutHtml = "";
  if (ro) {
    const kpi = (label, val, tip) =>
      '<div class="card nis-cell" style="cursor:help" data-tip="' +
      tipRef(tip) +
      '"><div class="label">' +
      label +
      '</div><div class="value">' +
      val +
      "</div></div>";
    readoutHtml =
      '<div class="sec"><h3 style="margin:0 0 8px">\uD83E\uDDEE Projected portfolio (after this plan)</h3>' +
      '<div class="grid kpis" style="margin-bottom:4px">' +
      kpi(
        "Invested",
        money(ro.investedPost, 0) + " MAD",
        "Total market value deployed in holdings after the plan executes.",
      ) +
      kpi(
        "Cash",
        pct0(ro.cashPct),
        "Share of the portfolio left in cash after the plan \u2014 deliberately held when caps / the attractiveness bar / whole-share lots leave money undeployed.",
      ) +
      kpi(
        "Weighted attractiveness",
        ro.wAttract != null ? ro.wAttract.toFixed(2) : "\u2014",
        "Value-weighted average attractiveness of your holdings after the plan (quality \u00D7 value \u00D7 conviction, risk-adjusted). Higher = a stronger overall book.",
      ) +
      kpi(
        "Weighted volatility",
        ro.wVol != null ? pct0(ro.wVol) : "\u2014",
        "Value-weighted average annualised volatility of your holdings after the plan \u2014 a rough gauge of portfolio risk.",
      ) +
      "</div></div>";
  }

  // ---- (B) Projected mix bars: sector / cycle / style (target vs would-be) ----
  const _mixBars = (title, arr, capLine, note) => {
    if (!arr || !arr.length) return "";
    const bars = arr
      .map((s) => {
        const over = capLine != null && s.weight > capLine + 1e-9;
        // Per-holding breakdown: list each ticker in this group with its own
        // weight, so hovering (e.g.) "Banks" or "Uncategorized" shows exactly
        // which names make it up.
        const mem = (s.members || []).slice();
        const memRows = mem.length
          ? tipRule() +
            tipRow("<b>Holdings (" + mem.length + ")</b>", "") +
            mem
              .map((m) =>
                tipRow(
                  escapeHtml(
                    m.name && m.name !== m.ticker
                      ? m.name + " (" + m.ticker + ")"
                      : m.ticker,
                  ),
                  pct1(m.weight),
                ),
              )
              .join("")
          : "";
        const barTip =
          tipHead(escapeHtml(s.name)) +
          tipRow("Projected weight", pct1(s.weight)) +
          (capLine != null ? tipRow("Cap", pct0(capLine)) : "") +
          memRows +
          tipNote(
            over
              ? "This would land above your cap after the plan \u2014 reduce new buys here or add trims."
              : s.name === "Uncategorized" || s.name === "Unclassified"
                ? "These holdings have no sector/cycle/style set in your master data \u2014 add one so they're grouped correctly."
                : "Share of the whole portfolio (holdings + cash) this group would hold after the plan executes.",
          );
        return (
          '<div class="nis-cell" style="cursor:help" data-tip="' +
          tipRef(barTip) +
          '"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px">' +
          "<span>" +
          escapeHtml(s.name) +
          (over ? ' <span class="neg">\u26A0</span>' : "") +
          '</span><span class="mini" style="color:var(--text2);font-family:var(--mono)">' +
          pct0(s.weight) +
          "</span></div>" +
          '<div style="height:8px;background:var(--panel2);border-radius:5px;overflow:hidden;position:relative">' +
          '<div style="position:absolute;left:0;top:0;bottom:0;width:' +
          Math.min(100, s.weight * 100) +
          "%;background:" +
          (over ? "var(--error)" : "var(--accent,#4c8bf5)") +
          ';opacity:.85"></div>' +
          (capLine != null
            ? '<div style="position:absolute;top:0;bottom:0;left:' +
              Math.min(100, capLine * 100) +
              '%;width:2px;background:var(--warn)"></div>'
            : "") +
          "</div></div>"
        );
      })
      .join("");
    return (
      '<div class="sec"><h3 style="margin:0 0 8px">' +
      title +
      '</h3><div style="display:flex;flex-direction:column;gap:6px">' +
      bars +
      "</div>" +
      (note
        ? '<div class="mini" style="color:var(--text2);margin-top:8px">' +
          note +
          "</div>"
        : "") +
      "</div>"
    );
  };
  let mixHtml = "";
  if (ro) {
    mixHtml =
      _mixBars(
        "\uD83C\uDFE2 Sector mix (projected)",
        ro.sectors,
        R.capPct,
        "Projected % of the whole portfolio by sector after the plan. Yellow line = your sector cap; red = over it.",
      ) +
      _mixBars(
        "\u267B\uFE0F Economic-cycle mix (projected)",
        ro.cycles,
        null,
        "Spread across Cyclical / Sensitive / Defensive so you\u2019re not over-exposed to one phase of the cycle.",
      ) +
      _mixBars(
        "\uD83C\uDFF7\uFE0F Asset-style mix (projected)",
        ro.styles,
        null,
        "Balance of Yield / Growth / Compounder / Value / Defensive styles.",
      );
  }

  // ---- (D) "Why not bought": positive-target names that got no buy ----
  let whyNotHtml = "";
  if ((R.skipped || []).length) {
    const rows = R.skipped
      .map((s) => {
        const tip =
          tipHead("Not bought \u00B7 " + escapeHtml(s.ticker)) +
          tipRow("Target weight", pct1(s.targetWt || 0)) +
          tipRow("Attractiveness", (s.attract || 0).toFixed(2)) +
          tipNote(escapeHtml(s.reason || ""));
        return (
          '<tr class="nis-cell" style="cursor:help" data-tip="' +
          tipRef(tip) +
          '"><td class="l"><b>' +
          escapeHtml(s.ticker) +
          '</b> <span class="mini" style="color:var(--text2)">' +
          escapeHtml(s.name || "") +
          '</span></td><td style="text-align:right;font-family:var(--mono)">' +
          pct1(s.targetWt || 0) +
          '</td><td style="text-align:right;font-family:var(--mono)">' +
          (s.attract || 0).toFixed(2) +
          '</td><td class="l mini" style="color:var(--text2)">' +
          escapeHtml(s.reason || "") +
          "</td></tr>"
        );
      })
      .join("");
    whyNotHtml =
      '<div class="sec"><h3 style="margin:0 0 6px">\u2139\uFE0F Wanted but not bought <span class="mini" style="font-weight:400;color:var(--text2)">\u2014 names with a model target that got no buy this run, and why</span></h3>' +
      '<div class="tbl-wrap"><table><thead><tr><th class="l" data-tip="A name the model has a positive target weight for, but that this run did not buy (see Reason).">Ticker</th><th style="text-align:right" data-tip="The weight the model wants for this name, which went unfilled this run.">Target</th><th style="text-align:right" data-tip="Quality x value x conviction, risk-adjusted by volatility">Attract.</th><th class="l" data-tip="Why this run skipped it: below the attractiveness bar, cash ran out, the max new-names limit was reached, or no price/lot was affordable.">Reason</th></tr></thead><tbody>' +
      rows +
      "</tbody></table></div></div>";
  }

  // Pins banner (shown when any manual pin is active).
  let pinsHtml = "";
  if (Object.keys(pins).length) {
    pinsHtml =
      '<div class="mini" style="color:var(--text2);margin:2px 0 8px">\uD83D\uDCCC Manual pins active: ' +
      Object.keys(pins)
        .map((tk) => escapeHtml(tk) + " " + pins[tk] + "%")
        .join(", ") +
      ' \u00B7 <a href="#" data-act="rbClearPins" data-stop="true" style="color:var(--primary2)">clear all</a></div>';
  }

  wrap.innerHTML =
    pinsHtml +
    readoutHtml +
    '<div class="sec">' +
    '<h3 style="margin:0 0 6px">\uD83D\uDCCB Trades to reach your model' +
    '<span class="mini nis-cell" style="font-weight:400;color:var(--text2);cursor:help" data-tip="' +
    tipRef(
      tipHead("How this run was spent") +
        tipRow("Cash to invest", money(R.cash, 0) + " MAD") +
        (R.wantTrims
          ? tipRow(
              "+ recycled trim proceeds",
              money(R.trimProceeds, 0) + " MAD",
            )
          : "") +
        tipRow("= buy budget", money(R.buyBudget, 0) + " MAD") +
        tipRow("Spent on buys", money(R.spent, 0) + " MAD") +
        tipRow("Left as cash", money(R.holdCash, 0) + " MAD") +
        tipNote(
          "Cash is left over when caps, the attractiveness bar, or whole-share lot sizes make the rest of the budget impossible to deploy \u2014 it is not lost, just held until the next run.",
        ),
    ) +
    '"> \u2014 ' +
    (R.plan || []).length +
    " buy" +
    ((R.plan || []).length === 1 ? "" : "s") +
    " \u00B7 " +
    (R.trims || []).length +
    " sell" +
    ((R.trims || []).length === 1 ? "" : "s") +
    " \u00B7 " +
    money(R.spent, 0) +
    " MAD deployed \u00B7 " +
    money(R.holdCash, 0) +
    " MAD held as cash</span>" +
    (R.pendingAccounted
      ? '<span class="badge b-wait" style="font-size:10px;margin-left:8px" data-tip="Your pending BUY/SELL orders were folded into current holdings before this plan was computed, so weights and suggestions reflect where the portfolio will be once those orders execute.">\u23F3 +pending</span>'
      : "") +
    "</h3>" +
    notesHtml +
    ((R.plan || []).length
      ? '<div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th class="l" data-tip="The name the model wants to buy. Hover any row for the full reasoning (target vs current weight, valuation, conviction, DCA).">Buy</th><th class="l" data-tip="The sector/category used for the sector-cap math.">Sector</th><th style="text-align:right" data-tip="Last known price per share/unit, used to size the order.">Price</th><th style="text-align:right" data-tip="Whole shares for stocks; up to 4 decimals for OPCVM funds (fractional units allowed).">Qty</th><th style="text-align:right" data-tip="Cost of this buy including estimated broker commission (and PEA/account fees where applicable).">Cost</th><th style="text-align:right" data-tip="Current weight of this name in your portfolio, and the model\u2019s target weight for it after the plan.">Now \u2192 Target</th><th data-tip="Add this exact buy to your Pending orders list.">Draft</th></tr></thead><tbody>' +
        buyRows +
        "</tbody></table></div>" +
        '<div style="margin-top:10px;text-align:right"><button class="btn" data-act="rbDraftAll" data-tip="Add every suggested buy above to your Pending orders list in one go, at the planned price and quantity.">\u2795 Draft all buys to Pending</button></div>'
      : '<div class="mini" style="color:var(--text2);margin-top:6px">No buys \u2014 either nothing clears the attractiveness bar (cash held to wait) or the model is already matched. Adjust the slider, caps, or "Min attractiveness".</div>') +
    "</div>" +
    '<div class="sec"><h3 style="margin:0 0 6px">\u2702\uFE0F Suggested sells / trims <span class="mini" style="font-weight:400;color:var(--text2)">\u2014 Sell-rated, above fair value, or over target</span></h3>' +
    ((R.trims || []).length
      ? '<div class="tbl-wrap"><table><thead><tr><th class="l" data-tip="The holding the model wants to trim or exit. Hover any row for why: Sell-rated, not in the model, above fair value, or over target.">Sell</th><th class="l" data-tip="The sector/category used for the sector-cap math.">Sector</th><th style="text-align:right" data-tip="Last known price per share/unit, used to size the order.">Price</th><th style="text-align:right" data-tip="Whole shares for stocks; up to 4 decimals for OPCVM funds (fractional units allowed).">Qty</th><th style="text-align:right" data-tip="Proceeds after estimated broker commission (and tax, where applicable). This is what actually lands as cash.">Net</th><th class="l" data-tip="Which tax lots to sell: PEA first (gains tax-free), then Regular highest-cost first, to minimise capital-gains tax.">From (tax lot)</th><th style="text-align:right" data-tip="Current weight of this holding in your portfolio, and the model\u2019s target weight for it after the plan.">Now \u2192 Target</th></tr></thead><tbody>' +
        sellRows +
        "</tbody></table></div>"
      : '<div class="mini pos">Nothing to sell \u2014 no Sell-rated, overvalued, or over-target holdings. \uD83C\uDF89</div>') +
    "</div>" +
    '<div class="sec"><h3 style="margin:0 0 6px">\uD83C\uDFAF Model vs actual <span class="mini" style="font-weight:400;color:var(--text2)">\u2014 target weight the engine wants vs where you are now</span></h3>' +
    '<div class="tbl-wrap"><table><thead><tr><th class="l" data-tip="Every name that is either held now or has a target weight in the model (or both).">Ticker</th><th style="text-align:right" data-tip="This name\u2019s current weight: its market value divided by your total investable sleeve (holdings + cash).">Now</th><th style="text-align:right" data-tip="The model\u2019s target weight for this name: its attractiveness score water-filled against your cash, capped by the sector and single-name limits.">Target</th><th style="text-align:right" data-tip="Target minus Now. Positive (green) = underweight, the model wants more. Negative (red) = overweight, the model wants less.">Drift</th><th style="text-align:right" data-tip="Quality x value x conviction, risk-adjusted by volatility">Attract.</th><th style="text-align:right" data-tip="What this run suggests: Buy (close an underweight), Trim/Exit (close an overweight or a Sell-rated/above-fair-value holding), or - (no action needed).">Action</th><th style="text-align:center" data-tip="Pin a name to a fixed target weight to override the model.">Pin</th></tr></thead><tbody>' +
    modelRows +
    "</tbody></table></div>" +
    '<div class="mini" style="color:var(--text2);margin-top:8px">Target weights come from each name\u2019s attractiveness (factor score \u00D7 valuation discount \u00D7 conviction, divided by volatility), capped at ' +
    pct0(R.capPct) +
    " per sector / " +
    pct0(Math.min(0.25, Math.max(0.1, R.capPct))) +
    " per name, then compared to your actual weights. Caps are hard \u2014 if they make full investment impossible, the remainder stays as cash." +
    (R.reservePct > 0
      ? " You also set a " + pct0(R.reservePct) + " cash reserve."
      : "") +
    " Use <b>Pin</b> to force a name to a weight you choose (the rest re-fit around it)." +
    "</div></div>" +
    mixHtml +
    whyNotHtml;

  // stash for draft-all
  window.__rbPlan = R.plan;
  try {
    if (typeof renderTopSector === "function") renderTopSector();
    if (typeof renderTopHeadroom === "function") renderTopHeadroom();
  } catch (e) {}
}
// Tooltip builders (tipHead/tipRow/tipNote/tipRule) moved to js/01b-tooltip.js.

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
// Extracted from showCompanyDetail: Key Metrics column (byte-identical block).
function _cdKeyMetrics(m, pir, trow) {
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
    // Revenue-per-share needs shares outstanding. `m.revenue` from the feed is
    // TOTAL revenue (TTM), so dividing by `m.shares` (total_shares_outstanding)
    // gives the per-share figure. When shares aren't available (e.g. a manual
    // paste, or data fetched before `shares` was added), we DON'T fake a
    // per-share number - we show Total Revenue with an honest label instead, so
    // the row is never misleading (the old code labelled total revenue
    // "Revenue/Sh", showing e.g. 1.6B "per share").
    const _revPS =
      m.revenue != null && m.revenue > 0 && m.shares != null && m.shares > 0
        ? m.revenue / m.shares
        : null;
    // P/S (Price / Sales) = price / revenue-per-share, a fallback valuation
    // anchor for loss-making names where P/E is meaningless.
    const _ps =
      _revPS != null && m.price != null && _revPS > 0 ? m.price / _revPS : null;
    if (_revPS != null) {
      m1 += trow(
        "Revenue/Sh",
        money(_revPS) + " MAD",
        "",
        "Revenue Per Share = Total Revenue (TTM) \u00F7 shares outstanding = " +
          money(m.revenue) +
          " \u00F7 " +
          Math.round(m.shares).toLocaleString() +
          " shares." +
          (_ps != null
            ? "\n\nP/S (Price/Sales) \u2248 " +
              _ps.toFixed(2) +
              "x \u2014 a fallback valuation anchor for loss-making companies where P/E is meaningless."
            : "") +
          "\n\nNo color coding \u2014 revenue alone doesn\u2019t indicate cheap or expensive; compare with margins and sector peers.",
      );
    } else {
      m1 += trow(
        "Revenue (TTM)",
        m.revenue != null ? money(m.revenue) + " MAD" : "\u2014",
        "",
        "Total Revenue (trailing twelve months) \u2014 the company\u2019s whole top line, NOT per share (shares-outstanding data isn\u2019t available for this ticker yet, so a per-share figure can\u2019t be computed). It will switch to Revenue/Sh automatically once the next automated price refresh adds the share count.\n\nNo color coding \u2014 revenue alone doesn\u2019t indicate cheap or expensive.",
      );
    }
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
  return m1;
}

// Extracted from showCompanyDetail: Valuation & Signal column (byte-identical block).
function _cdValuationSignal(m, sc, fv, fvParts, tb, ts, trow) {
  let m2 = "";
  m2 += trow(
    "<b>Fair Value</b>",
    fv != null ? "<b>" + money(fv) + " MAD</b>" : "\u2014",
    "",
    "Fair Value = The intrinsic worth of the stock based on fundamentals (not market price). Blends multiple valuation anchors: Graham formula, Earnings Power, Dividend Discount Model, Free Cash Flow power (non-financial sectors), and 52-wk midpoint. Outlier anchors are trimmed before averaging. If price < fair value \u2192 potentially undervalued.",
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
      "Signal Score = Weighted average of 10 factors (valuation, safety, quality, growth, yield, book value, FCF yield, timing, momentum, peer-relative), adjusted for correlation between similar factors.\n\nGrowth blends PEG with EPS-growth. FCF yield applies to non-financial sectors. Weights vary by sector profile. Score is 0\u2013100%.\n\nGreen (>65%): strong multi-factor signal.\nRed (<40%): weak/unfavorable.\nNeutral (40\u201365%): mixed.",
    );
  }
  {
    const _convTip =
      "Conviction = How much to TRUST the signal score.\n\nBased on:\n1) Factor coverage: what % of scoring factors have data (by weight).\n2) Core data depth: how many of 6 key fundamentals are present (EPS, Book, ROE, Dividends, Balance sheet / cash, 52w range).\n\nHigh (\u226580%): strong data \u2192 score is reliable.\nMedium (55\u201380%): partial \u2192 directionally useful but has gaps.\nLow (<55%): sparse \u2192 treat as speculative.";
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
  return m2;
}

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
    '<div><h2 style="margin:0;display:flex;align-items:center;gap:2px">' +
    tickerBadge(tk, 36) +
    "<span>" +
    escapeHtml(tk) +
    " \u2014 " +
    escapeHtml(m.name || "") +
    "</span></h2>";
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
    (tip ? 'data-tip="' + tipRef(tip) + '"' : "") +
    "><span>" +
    l +
    '</span><span class="' +
    (cl || "") +
    '" style="font-family:var(--mono)">' +
    v +
    "</span></div>";
  const m1 = _cdKeyMetrics(m, pir, trow);
  h += sec("\ud83d\udcca Key Metrics", m1);

  // Col 2: Valuation + Signal (with educational tooltips)
  const m2 = _cdValuationSignal(m, sc, fv, fvParts, tb, ts, trow);
  h += sec("\ud83c\udfaf Valuation & Signal", m2);

  h += "</div>"; // close grid

  // Full-width sections
  // Factor scores
  if (sc && sc.parts) {
    const names = {
      valuation: "Valuation (EV/EBITDA)",
      safety: "Safety (Net Debt)",
      quality: "Quality (ROE)",
      growth: "Growth (PEG + EPS growth)",
      yield: "Yield (Div %)",
      book: "Book (P/B)",
      fcfy: "FCF Yield (FCF/Price)",
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
      fcfy:
        m.fcf != null && m.price != null && m.price > 0
          ? ((m.fcf / m.price) * 100).toFixed(1) + "%"
          : null,
      timing: pir != null ? (pir * 100).toFixed(0) + "%" : null,
      momentum: pir != null ? (pir * 100).toFixed(0) + "%" : null,
      peerrel: _pr && _pr.n ? _pr.n + " peers" : null,
    };
    let fb =
      '<table style="width:100%;font-size:12px"><thead><tr>' +
      '<th class="l" style="cursor:help" data-tip="' +
      tipRef(
        "The 10 scoring factors. Each is normalised to 0-100%, weighted by the sector profile, then blended into the Signal Score.",
      ) +
      '">Factor</th>' +
      '<th style="cursor:help" data-tip="' +
      tipRef(
        "The underlying raw metric value fed into this factor (e.g. EV/EBITDA for Valuation, ROE for Quality).",
      ) +
      '">Raw</th>' +
      '<th style="cursor:help" data-tip="' +
      tipRef(
        "How much this factor counts toward the Signal Score for this sector. Weights differ per sector profile (e.g. banks lean on Book & ROE; FCF yield is 0 for financials).",
      ) +
      '">Weight</th>' +
      '<th style="cursor:help" data-tip="' +
      tipRef(
        "This factor's own 0-100% score. Green >65% favourable, red <35% unfavourable. Blank = no data for this factor (it is skipped and the score re-normalised).",
      ) +
      '">Score</th>' +
      '<th style="cursor:help" data-tip="' +
      tipRef(
        "Score x Weight = how many points this factor adds to the composite. The row that contributes most is driving the signal.",
      ) +
      '">Contribution</th></tr></thead><tbody>';
    for (const k in sc.parts) {
      const f = sc.parts[k];
      // Skip zero-weight factors (e.g. FCF yield for financials/REITs) - they
      // contribute nothing and would show a noisy "0% / -" row.
      if (!f.w) continue;
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
    pb += trow(
      "Comparison basis",
      _pr.basis === "category"
        ? (m.cat || "\u2014") + " (same category)"
        : "Broad sector (" + (prof ? prof.label : "\u2014") + ")",
      "",
      "Which peer set this name is compared against. Same-category peers are preferred when at least 4 exist (most apples-to-apples); otherwise it falls back to the broader sector profile.",
    );
    pb += trow(
      "Comparable count",
      String(_pr.n) + (_pr.n < 4 ? ' <span class="neg">(thin)</span>' : ""),
      "",
      "How many peers the comparison is based on. Fewer than 4 is flagged 'thin' \u2014 the peer-relative factor is down-weighted (3 peers \u2248 0.4x weight, 10+ \u2248 full weight) because a small sample is unreliable.",
    );
    const st = typeof sectorStats === "function" ? sectorStats() : null;
    const ref = st
      ? _pr.basis === "category"
        ? st.cat && st.cat[m.cat || ""]
        : st.prof && st.prof[prof ? prof.key : ""]
      : null;
    if (ref) {
      if (ref.pe != null)
        pb += trow(
          "Peer median P/E",
          ref.pe.toFixed(1) +
            (m.pe
              ? ' <span class="mini">(you: ' + m.pe.toFixed(1) + ")</span>"
              : ""),
          "",
          "The median P/E across the peer set, with this stock's own P/E in brackets. Your P/E below the peer median = cheaper than peers on earnings.",
        );
      if (ref.pb != null)
        pb += trow(
          "Peer median P/B",
          ref.pb.toFixed(2) +
            (m.pb
              ? ' <span class="mini">(you: ' + m.pb.toFixed(2) + ")</span>"
              : ""),
          "",
          "The median P/B across the peer set, with this stock's own P/B in brackets. Your P/B below the peer median = cheaper than peers on book value.",
        );
      if (ref.divy != null)
        pb += trow(
          "Peer median Div Y",
          (ref.divy * 100).toFixed(1) +
            "%" +
            (m.divy
              ? ' <span class="mini">(you: ' +
                (m.divy * 100).toFixed(1) +
                "%)</span>"
              : ""),
          "",
          "The median dividend yield across the peer set, with this stock's own yield in brackets. Your yield above the peer median = more income than peers.",
        );
    }
    pb += trow(
      "Peer score",
      (_pr.score * 100).toFixed(0) +
        "% \u2014 " +
        (_pr.score >= 0.6
          ? "cheaper than peers"
          : _pr.score <= 0.4
            ? "pricier than peers"
            : "in line"),
      _pr.score >= 0.6 ? "pos" : _pr.score <= 0.4 ? "neg" : "",
      "Peer-relative valuation score (0-100%), blending this stock's P/E, P/B and yield vs the peer medians. \u2705 \u226560%: cheaper than peers. \u274c \u226440%: pricier than peers. This feeds the composite as the 'peer-relative' factor, down-weighted when the peer set is thin.",
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
    dsb += trow(
      "Level",
      '<span class="' +
        (ds.level === "ok" ? "pos" : ds.level === "danger" ? "neg" : "") +
        '">' +
        ds.level +
        "</span>",
      "",
      "Dividend sustainability from the payout ratio (dividend \u00f7 earnings). \u2705 ok: comfortably covered by earnings. \u26a0 stretched: payout near or slightly above 100% \u2014 limited cushion. \u274c danger: payout well above earnings \u2014 the dividend may be cut. 'unknown' = not enough data (missing EPS or DPS).",
    );
    if (ds.note)
      dsb += trow(
        "Note",
        ds.note,
        "",
        "The specific payout figure behind the level above.",
      );
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

// ============================================================
// Rebalance "why" tooltips + above-target entry badge (moved from
// 04-render.js: these explain the rebalance plan's buy/trim rows).
// ============================================================
// ---- rebalance "why" tooltips ----
// Live price vs target buy: flag entries trading materially above their ideal entry.
const ABOVE_TGT_THRESH = 0.1; // >10% above target buy = not an ideal entry yet
function aboveTgtPct(px, tbuy) {
  return tbuy != null && isFinite(tbuy) && tbuy > 0 && px != null
    ? (px - tbuy) / tbuy
    : null;
}
function aboveTgtBadge(px, tbuy) {
  const a = aboveTgtPct(px, tbuy);
  if (a == null || a <= ABOVE_TGT_THRESH) return "";
  return (
    ' <span class="badge b-abovetgt" data-tip="' +
    tipRef(
      "Live price is " +
        (a * 100).toFixed(0) +
        "% above target buy (" +
        money(tbuy) +
        " MAD). It qualifies as undervalued vs fair value, but you'd be paying above the ideal entry \u2014 consider waiting for a dip.",
    ) +
    '" style="cursor:help">\u26A0 +' +
    (a * 100).toFixed(0) +
    "% vs tgt</span>"
  );
}
