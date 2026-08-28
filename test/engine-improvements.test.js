// Tests for the Signals (Spec A) and Rebalance (Spec B) engine improvements.
//
// IMPORTANT SCOPE NOTE: the signals + rebalance engines live in the shared-scope
// bundle (js/03-signals.js, js/05-rebalance.js) as plain top-level functions, NOT
// importable ES modules, so Vitest cannot import them directly. These tests
// therefore replicate the EXACT scoring math that was added and assert the
// design invariants against the replica. They lock the math (FCF direction,
// missing-FCF no-op, graded epsGrowth, rebalance slider extremes); they do NOT
// prove the bundle wired them - that's covered by the brace/ASCII checks and the
// browser smoke test. The replicas below are copied verbatim from the engine.
import { describe, it, expect } from "vitest";

// ---- verbatim replica of soft() from js/03-signals.js ----
function soft(v, best, worst) {
  if (!(typeof v === "number" && isFinite(v))) return null;
  if (best === worst) return 0.5;
  let t = (v - worst) / (best - worst);
  if (t < -0.5) t = -0.5;
  else if (t > 1.5) t = 1.5;
  return 1 / (1 + Math.exp(-4 * (t - 0.5)));
}

// ---- replica of the new continuous growth term ----
function growthScore(m) {
  const _pegS = soft(m.peg, 0.7, 2.0);
  const _egS = m.epsGrowth != null ? soft(m.epsGrowth, 0.2, -0.05) : null;
  let g;
  if (_pegS == null && _egS == null) g = null;
  else if (_pegS == null) g = _egS;
  else if (_egS == null)
    g = m.epsGrowth != null && m.epsGrowth <= 0 ? 0.15 : _pegS;
  else g = 0.5 * _pegS + 0.5 * _egS;
  if (g != null && m.epsGrowth != null && m.epsGrowth <= 0)
    g = Math.min(g, 0.2);
  return g;
}

// ---- replica of the new FCF-yield factor score ----
function fcfyScore(m, best, worst) {
  const y = num(m.fcf) && num(m.price) && m.price > 0 ? m.fcf / m.price : null;
  return y == null ? null : soft(y, best, worst);
}
const num = (v) => typeof v === "number" && isFinite(v);

// ---- replica of the rebalance greedy score (js/05-rebalance.js) ----
// score at vTilt for one candidate given its context weights.
function rbScore(
  { secW, cap, disc, cycleNeed, styleNeed, isBuy, fscore },
  vTilt,
) {
  const sectorNeed = 1 - secW / cap;
  const valueTilt = disc >= 0 ? disc : disc * vTilt;
  const overPen = Math.max(0, (secW - cap) / cap);
  const wSector = 1.0 - 0.5 * vTilt;
  const wValue = 0.6 + 0.6 * vTilt;
  const wFactor = 0.5 * vTilt;
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
// The soft ceiling that replaced the hard `if (secW >= cap) continue`.
const rbCeiling = (cap, vTilt) => cap * (1 + 0.5 * vTilt);

describe("Spec A: FCF-yield factor", () => {
  it("higher FCF yield scores higher (default sector bounds 0.07/0.0)", () => {
    const lo = fcfyScore({ fcf: 1, price: 100 }, 0.07, 0.0); // 1% yield
    const hi = fcfyScore({ fcf: 8, price: 100 }, 0.07, 0.0); // 8% yield
    expect(hi).toBeGreaterThan(lo);
  });

  it("missing FCF -> null (factor is skipped, score unchanged)", () => {
    expect(fcfyScore({ price: 100 }, 0.07, 0.0)).toBeNull();
    expect(fcfyScore({ fcf: 5 }, 0.07, 0.0)).toBeNull(); // no price
    expect(fcfyScore({ fcf: 5, price: 0 }, 0.07, 0.0)).toBeNull(); // price 0
  });

  it("negative FCF (cash-burning) scores below the midpoint", () => {
    const s = fcfyScore({ fcf: -3, price: 100 }, 0.07, 0.0);
    expect(s).not.toBeNull();
    expect(s).toBeLessThan(0.5);
  });
});

describe("Spec A: continuous epsGrowth growth factor", () => {
  it("faster EPS growth scores higher (same PEG)", () => {
    const slow = growthScore({ peg: 1.2, epsGrowth: 0.02 });
    const fast = growthScore({ peg: 1.2, epsGrowth: 0.25 });
    expect(fast).toBeGreaterThan(slow);
  });

  it("negative EPS growth is capped at 0.2 (floor guard)", () => {
    const g = growthScore({ peg: 0.6, epsGrowth: -0.1 }); // low PEG would look cheap
    expect(g).toBeLessThanOrEqual(0.2);
  });

  it("PEG-only (no epsGrowth) still scores via PEG", () => {
    const g = growthScore({ peg: 0.8 });
    expect(g).not.toBeNull();
    expect(g).toBeGreaterThan(0.5); // low PEG is good
  });

  it("no growth inputs at all -> null (factor skipped)", () => {
    expect(growthScore({})).toBeNull();
  });
});

describe("Spec B: rebalance slider - vTilt=0 reproduces today", () => {
  const ctx = {
    secW: 0.1,
    cap: 0.2,
    disc: 0.15,
    cycleNeed: 0.3,
    styleNeed: 0.2,
    isBuy: true,
    fscore: 0.7,
  };
  it("at vTilt=0 the score equals the ORIGINAL formula", () => {
    const sectorNeed = 1 - ctx.secW / ctx.cap;
    const original =
      sectorNeed * 1.0 +
      Math.max(0, ctx.disc) * 0.6 +
      ctx.cycleNeed * 0.35 +
      ctx.styleNeed * 0.35 +
      (ctx.isBuy ? 0.15 : 0);
    expect(rbScore(ctx, 0)).toBeCloseTo(original, 10);
  });

  it("at vTilt=0 the ceiling equals the hard cap (today's hard skip)", () => {
    expect(rbCeiling(0.2, 0)).toBeCloseTo(0.2, 10);
  });
});

describe("Spec B: value-led mode lets an undervalued name in a full sector through", () => {
  it("a full sector (secW=cap) is skipped at vTilt=0 but allowed under the ceiling at vTilt=1", () => {
    const cap = 0.2;
    const secW = 0.2; // exactly at cap
    // vTilt=0: ceiling == cap == secW -> skipped (secW >= ceil)
    expect(secW >= rbCeiling(cap, 0)).toBe(true);
    // vTilt=1: ceiling == cap*1.5 = 0.30 -> NOT skipped
    expect(secW >= rbCeiling(cap, 1)).toBe(false);
  });

  it("hard ceiling is respected: beyond cap*1.5 is always skipped", () => {
    const cap = 0.2;
    const secW = 0.31; // past the 1.5x ceiling
    expect(secW >= rbCeiling(cap, 1)).toBe(true); // skipped even fully value-led
  });

  it("value-led mode boosts a deeply-undervalued full-sector name (the core fix)", () => {
    // Deep value, sector slightly over cap (only reachable because the ceiling
    // expanded at vTilt=1; at vTilt=0 it would have been hard-skipped entirely).
    const deepValueFull = {
      secW: 0.22,
      cap: 0.2,
      disc: 0.4,
      cycleNeed: 0,
      styleNeed: 0,
      isBuy: true,
      fscore: 0.85,
    };
    // The essential guarantee: value-led mode scores this undervalued name
    // strictly HIGHER than diversification mode would - so a great buy is no
    // longer invisible just because its sector is full.
    expect(rbScore(deepValueFull, 1)).toBeGreaterThan(
      rbScore(deepValueFull, 0),
    );
  });

  it("value-led mode flips the ranking vs a marginally-cheaper diversifier", () => {
    // Two comparable candidates: one deep value in a nearly-full sector, one
    // slightly cheap filling one diversification gap. Value-led should rerank
    // toward the deep-value name relative to diversification-led.
    const deepValue = {
      secW: 0.16,
      cap: 0.2,
      disc: 0.4,
      cycleNeed: 0,
      styleNeed: 0,
      isBuy: true,
      fscore: 0.85,
    };
    const mildDiversifier = {
      secW: 0.02,
      cap: 0.2,
      disc: 0.05,
      cycleNeed: 0.2,
      styleNeed: 0,
      isBuy: false,
      fscore: 0.45,
    };
    const gap0 = rbScore(mildDiversifier, 0) - rbScore(deepValue, 0);
    const gap1 = rbScore(mildDiversifier, 1) - rbScore(deepValue, 1);
    // The diversifier's advantage shrinks (or reverses) as we move to value-led.
    expect(gap1).toBeLessThan(gap0);
  });

  it("two-sided value: an OVERVALUED name is penalised only as vTilt rises", () => {
    const over = {
      secW: 0.1,
      cap: 0.2,
      disc: -0.3,
      cycleNeed: 0,
      styleNeed: 0,
      isBuy: false,
      fscore: 0.5,
    };
    // At vTilt=0 the overvalued disc is clamped to 0 (no penalty, == today).
    const sectorNeed = 1 - over.secW / over.cap;
    const today = sectorNeed * 1.0 + 0 * 0.6;
    expect(rbScore(over, 0)).toBeCloseTo(today, 10);
    // At vTilt=1 the negative disc drags the score below the vTilt=0 value.
    expect(rbScore(over, 1)).toBeLessThan(rbScore(over, 0));
  });
});
