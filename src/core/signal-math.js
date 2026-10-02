// ============================================================
// signal-math.js - pure, testable scoring primitives for the signal engine
// and the rebalance greedy picker.
//
// WHY THIS MODULE EXISTS: the signal engine (js/03-signals.js) and rebalance
// helper (js/05-rebalance.js) live in the shared-scope UI bundle as plain
// top-level functions, which Vitest cannot import. Previously these scoring
// primitives were duplicated verbatim inside a test file, so a regression in
// the real engine would NOT fail CI (the test tested its own copy). Moving the
// canonical math here - a real ES module imported by the bridge (__core) AND by
// the test - means the test exercises the SAME code the app runs.
//
// Pure: no DOM, no globals, no state. Every function tolerates missing/NaN
// inputs by returning null (so the factor normaliser can drop that factor and
// re-weight), never throwing.
// ============================================================

/** Finite-number guard used throughout the engine. */
export function num(v) {
  return typeof v === "number" && isFinite(v);
}

/**
 * soft(v, best, worst): map a raw metric to a 0..1 desirability score via a
 * logistic curve anchored so that `worst` -> ~0 and `best` -> ~1. Works in both
 * directions (best may be greater OR less than worst, e.g. P/E where lower is
 * better). The input is clamped to t in [-0.5, 1.5], so the output is bounded to
 * roughly [0.018, 0.982] and never saturates to exactly 0/1. Returns null for a
 * non-finite input (so the factor is skipped and the score re-weighted), and
 * 0.5 when best === worst (no information).
 */
export function soft(v, best, worst) {
  if (!(typeof v === "number" && isFinite(v))) return null;
  if (best === worst) return 0.5;
  let t = (v - worst) / (best - worst);
  if (t < -0.5) t = -0.5;
  else if (t > 1.5) t = 1.5;
  return 1 / (1 + Math.exp(-4 * (t - 0.5)));
}

/**
 * growthScore(m): continuous growth factor blending PEG (valuation-of-growth)
 * with the raw EPS-growth rate, so a fast grower scores high and a shrinking-EPS
 * name scores low CONTINUOUSLY (no binary cliff). Each half is dropped if its
 * input is missing; if BOTH are missing returns null. A hard negative-EPS floor
 * (cap at 0.2) keeps a deeply-shrinking name from being rescued by a low PEG.
 */
export function growthScore(m) {
  const _pegS = soft(m.peg, 0.7, 2.0); // null if peg missing
  const _egS = m.epsGrowth != null ? soft(m.epsGrowth, 0.2, -0.05) : null;
  let g;
  if (_pegS == null && _egS == null) g = null;
  else if (_pegS == null) g = _egS;
  else if (_egS == null)
    g = m.epsGrowth != null && m.epsGrowth <= 0 ? 0.15 : _pegS;
  else g = 0.5 * _pegS + 0.5 * _egS;
  if (g != null && m.epsGrowth != null && m.epsGrowth <= 0)
    g = Math.min(g, 0.2); // negative-EPS floor (cap upside)
  return g;
}

/**
 * fcfyScore(m, best, worst): free-cash-flow-yield factor = FCF per share / price,
 * scored via soft() against per-sector bounds. Returns null when FCF or price is
 * missing/non-positive (factor skipped, score re-normalised).
 */
export function fcfyScore(m, best, worst) {
  const y = num(m.fcf) && num(m.price) && m.price > 0 ? m.fcf / m.price : null;
  return y == null ? null : soft(y, best, worst);
}

/**
 * rbScore(ctx, vTilt): the rebalance greedy picker's per-candidate score at a
 * given value-vs-diversification tilt (vTilt in 0..1). Blends sector need, value
 * tilt (discount-to-fair, only rewarded above fair when vTilt lifts it),
 * cycle/style diversification need, a Buy-signal bump, and the factor score -
 * with weights that shift from diversification-led (vTilt=0) to value-led
 * (vTilt=1). An overweight sector is penalised. Pure arithmetic.
 *
 * ctx = { secW, cap, disc, cycleNeed, styleNeed, isBuy, fscore }
 */
export function rbScore(ctx, vTilt) {
  const { secW, cap, disc, cycleNeed, styleNeed, isBuy, fscore } = ctx;
  const sectorNeed = 1 - secW / cap;
  const valueTilt = disc >= 0 ? disc : disc * vTilt;
  const overPen = Math.max(0, (secW - cap) / cap);
  const wSector = 1.0 - 0.5 * vTilt; // 1.0 -> 0.5
  const wValue = 0.6 + 0.6 * vTilt; // 0.6 -> 1.2
  const wFactor = 0.5 * vTilt; // 0   -> 0.5
  return (
    sectorNeed * wSector +
    valueTilt * wValue +
    cycleNeed * 0.35 +
    styleNeed * 0.35 +
    (isBuy ? 0.15 : 0) +
    (fscore || 0) * wFactor -
    overPen * 1.2 * vTilt
  );
}
