// ============================================================
// 02-compute.js  (v2)
// compute: delegates the fee/tax/FIFO MATH to the tested core in
// src/core/ (money.js, fees.js, tax.js, fifo.js) via globalThis.__core.
//
// Why a bridge: the core is pure, integer-cents-precise, and unit-tested in
// CI. The UI still calls computeRow(t, avg) and runFIFO() by the same names
// and signatures as before, so none of the ~350 UI call sites change - they
// now transparently use the tested core. Memoization stays here (render calls
// runFIFO ~8-10x per pass).
// ============================================================

// Build the core "context" from the live app globals each call. These globals
// (M, BROKERS, FP, FP_PEA, DIVTAX) are defined in 01-core.js and mutated by the
// UI; reading them fresh keeps behaviour identical to v1.
function _coreCtx() {
  return {
    master: M,
    brokers:
      typeof BROKERS !== "undefined" && BROKERS
        ? BROKERS
        : __core.defaults.BROKER_DEFAULTS,
    fp: FP,
    fpPea: FP_PEA,
    divtax: DIVTAX,
  };
}

// Per-transaction fee/tax/net. Same signature as v1.
function computeRow(t, avgCostForSell) {
  return __core.fifo.computeRow(t, avgCostForSell, _coreCtx());
}

// ---------- FIFO engine (memoized wrapper over the core) ----------
let _fifoSig = null,
  _fifoCache = null;
function _fifoSignature() {
  let s = "";
  try {
    s +=
      "cfg" +
      JSON.stringify(FP) +
      JSON.stringify(FP_PEA) +
      JSON.stringify(DIVTAX) +
      JSON.stringify(typeof BROKERS !== "undefined" ? BROKERS : null) +
      "#";
  } catch (err) {
    console.warn("FIFO signature: config serialize failed.", err);
    s += "cfgERR#";
  }
  s += TXNS.length + "#";
  for (let i = 0; i < TXNS.length; i++) {
    const t = TXNS[i];
    s +=
      t.date +
      "|" +
      t.ticker +
      "|" +
      t.action +
      "|" +
      t.qty +
      "|" +
      t.price +
      "|" +
      (t.pea ? 1 : 0) +
      "|" +
      (t.opcvm ? 1 : 0) +
      "|" +
      (t.total == null ? "" : t.total) +
      "|" +
      (t.broker || "") +
      ";";
  }
  s += "~M";
  for (const tk in M) {
    const m = M[tk];
    if (!m) continue;
    if (
      m.price != null ||
      m.cat != null ||
      m.buyFee != null ||
      m.sellFee != null
    )
      s +=
        tk +
        ":" +
        (m.price == null ? "" : m.price) +
        ":" +
        (m.cat || "") +
        ":" +
        (m.buyFee == null ? "" : m.buyFee) +
        ":" +
        (m.sellFee == null ? "" : m.sellFee) +
        ",";
  }
  return s;
}
function runFIFO() {
  const sig = _fifoSignature();
  if (_fifoCache && _fifoSig === sig) return _fifoCache;
  _fifoSig = sig;
  _fifoCache = __core.fifo.runFIFO(TXNS, _coreCtx());
  return _fifoCache;
}

// Total shares held for a ticker across all FIFO position buckets (PEA+Reg).
// A general position helper used by signals, rebalance and dividends.
function heldSharesOf(pos, tk) {
  let q = 0;
  for (const k in pos) {
    if (pos[k].ticker === tk) q += pos[k].held;
  }
  return q;
}

// Sum held-position VALUE grouped by a master-metadata field (cat / cycle /
// style), returning { groupKey: totalValue }. Single source for the "bucket my
// holdings by sector/field and sum value" aggregation that the dashboard
// allocation pie and the Signals "Your Mix" donuts both need. Each caller maps
// the returned map into its own chart/row shape and sorts as it likes. `held`
// is the array of position rows (already filtered to held>0, value>0 by the
// caller); `fallback` is the bucket name for a missing/blank field value.
function sumValueByField(held, field, fallback) {
  const by = {};
  (held || []).forEach((p) => {
    const m = M[p.ticker] || {};
    const raw = m[field];
    const k = raw != null && ("" + raw).trim() ? ("" + raw).trim() : fallback;
    by[k] = (by[k] || 0) + (p.value || 0);
  });
  return by;
}
