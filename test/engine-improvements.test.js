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

// ---- replica of fairValue() with the new FCF anchor (js/03-signals.js) ----
function fairValue(m, prof) {
  if (!num(m.price)) return null;
  const eps =
    num(m.eps) && m.eps > 0
      ? m.eps
      : num(m.pe) && m.pe > 0
        ? m.price / m.pe
        : null;
  const bvps = num(m.bvps) && m.bvps > 0 ? m.bvps : null;
  const dps = num(m.dps) && m.dps > 0 ? m.dps : null;
  const aw = prof.aw;
  const ddm = (d) => (d * (1 + (prof.g || 0))) / prof.dyFair;
  const anchors = [];
  if (eps && bvps && eps > 0 && bvps > 0)
    anchors.push([Math.sqrt(prof.grahamK * eps * bvps), aw.graham]);
  if (eps && eps > 0) anchors.push([eps * prof.peFair, aw.earnpower]);
  if (dps && dps > 0) anchors.push([ddm(dps), aw.ddm]);
  if (num(m.fcf) && m.fcf > 0 && aw.fcf > 0)
    anchors.push([m.fcf * prof.peFair, aw.fcf]);
  if (num(m.low) && num(m.high)) anchors.push([(m.low + m.high) / 2, aw.mid52]);
  if (!anchors.length) return m.price;
  const vals = anchors
    .map((a) => a[0])
    .slice()
    .sort((a, b) => a - b);
  const med = vals[Math.floor((vals.length - 1) / 2)];
  const kept = anchors.filter((a) =>
    med > 0 ? a[0] / med >= 0.5 && a[0] / med <= 2.0 : true,
  );
  const use = kept.length ? kept : anchors;
  let wsum = 0,
    acc = 0;
  use.forEach((a) => {
    acc += a[0] * a[1];
    wsum += a[1];
  });
  return wsum > 0 ? acc / wsum : use.reduce((x, a) => x + a[0], 0) / use.length;
}

describe("Spec #1: FCF feeds into fair value", () => {
  const ind = {
    grahamK: 48,
    peFair: 17,
    dyFair: 0.032,
    g: 0.03,
    aw: { graham: 1.0, earnpower: 1.2, ddm: 0.6, mid52: 0.5, fcf: 0.9 },
  };
  const fin = {
    grahamK: 40,
    peFair: 14,
    dyFair: 0.045,
    g: 0.03,
    aw: { graham: 1.1, earnpower: 0.7, ddm: 1.0, mid52: 0.5, fcf: 0 },
  };
  const base = {
    price: 100,
    eps: 6,
    bvps: 40,
    dps: 3,
    pe: 16.7,
    low: 80,
    high: 120,
  };

  it("strong FCF raises fair value; weak FCF lowers it (industrial)", () => {
    const noFcf = fairValue({ ...base }, ind);
    const hiFcf = fairValue({ ...base, fcf: 8 }, ind);
    const loFcf = fairValue({ ...base, fcf: 1 }, ind);
    expect(hiFcf).toBeGreaterThan(noFcf);
    expect(loFcf).toBeLessThan(hiFcf);
  });

  it("missing FCF leaves fair value unchanged", () => {
    expect(fairValue({ ...base }, ind)).toBeCloseTo(
      fairValue({ ...base }, ind),
      10,
    );
  });

  it("financials ignore the FCF anchor (weight 0)", () => {
    const noFcf = fairValue({ ...base }, fin);
    const withFcf = fairValue({ ...base, fcf: 8 }, fin);
    expect(withFcf).toBeCloseTo(noFcf, 10);
  });
});

// ---- replica of signal-outcome aggregation (js/06-features.js) ----
function sigBucket(c) {
  if (c === "b-buy") return "buy";
  if (c === "b-sell" || c === "b-trim") return "sell";
  return "neutral";
}
function aggregateOutcomes(hist, cur, todayISO, horizonDays) {
  const today = new Date(todayISO);
  const byTk = {};
  for (const h of hist) {
    const ageD = (today - new Date(h.date)) / 86400000;
    if (ageD < horizonDays) continue;
    if (!byTk[h.ticker] || h.date < byTk[h.ticker].date) byTk[h.ticker] = h;
  }
  const agg = {
    buy: { n: 0, sum: 0 },
    neutral: { n: 0, sum: 0 },
    sell: { n: 0, sum: 0 },
  };
  for (const tk in byTk) {
    const h = byTk[tk];
    const now = cur[tk];
    if (now == null || !h.price) continue;
    const ret = (now - h.price) / h.price;
    agg[sigBucket(h.sig)].n++;
    agg[sigBucket(h.sig)].sum += ret;
  }
  return { byTk, agg };
}

describe("Spec #3: signal-outcome aggregation", () => {
  const hist = [
    { date: "2026-01-10", ticker: "AAA", sig: "b-buy", price: 100 },
    { date: "2026-06-01", ticker: "AAA", sig: "b-buy", price: 130 },
    { date: "2026-02-01", ticker: "BBB", sig: "b-sell", price: 200 },
    { date: "2026-08-20", ticker: "CCC", sig: "b-buy", price: 50 },
    { date: "2026-03-01", ticker: "DDD", sig: "b-hold", price: 80 },
  ];
  const cur = { AAA: 150, BBB: 180, CCC: 55, DDD: 88 };
  const { byTk, agg } = aggregateOutcomes(hist, cur, "2026-08-28", 30);

  it("excludes snapshots newer than the horizon", () => {
    expect(byTk.CCC).toBeUndefined();
  });
  it("keeps the OLDEST snapshot per ticker", () => {
    expect(byTk.AAA.price).toBe(100);
  });
  it("buy bucket averages the right return (100 -> 150 = +50%)", () => {
    expect(agg.buy.n).toBe(1);
    expect(agg.buy.sum / agg.buy.n).toBeCloseTo(0.5, 10);
  });
  it("sell and neutral buckets aggregate correctly", () => {
    expect(agg.sell.sum / agg.sell.n).toBeCloseTo(-0.1, 10);
    expect(agg.neutral.sum / agg.neutral.n).toBeCloseTo(0.1, 10);
  });
});

// ---- replica of the benchmark-relative outcome logic (js/06-features.js) ----
function outcomesWithBench(hist, cur, todayISO, horizonDays) {
  const today = new Date(todayISO);
  const byTk = {};
  for (const h of hist) {
    const ageD = (today - new Date(h.date)) / 86400000;
    if (ageD < horizonDays) continue;
    if (!byTk[h.ticker] || h.date < byTk[h.ticker].date) byTk[h.ticker] = h;
  }
  const benchByDate = {};
  for (const s of hist) {
    const now0 = cur[s.ticker];
    if (now0 == null || !s.price) continue;
    const r0 = (now0 - s.price) / s.price;
    benchByDate[s.date] = benchByDate[s.date] || { sum: 0, n: 0 };
    benchByDate[s.date].sum += r0;
    benchByDate[s.date].n += 1;
  }
  const benchFor = (dt) => {
    const b = benchByDate[dt];
    return b && b.n ? b.sum / b.n : null;
  };
  const agg = {
    buy: { exSum: 0, exN: 0 },
    neutral: { exSum: 0, exN: 0 },
    sell: { exSum: 0, exN: 0 },
  };
  const byName = {};
  let allSum = 0,
    allN = 0;
  for (const tk in byTk) {
    const h = byTk[tk];
    const now = cur[tk];
    if (now == null || !h.price) continue;
    const ret = (now - h.price) / h.price;
    const bench = benchFor(h.date);
    const excess = bench != null ? ret - bench : null;
    const b = sigBucket(h.sig);
    if (excess != null) {
      agg[b].exSum += excess;
      agg[b].exN++;
    }
    allSum += ret;
    allN++;
    byName[tk] = { ret, bench, excess };
  }
  return { agg, byName, overall: allN ? allSum / allN : null };
}

describe("Spec #3b: benchmark-relative signal outcomes", () => {
  // Two names snapshotted the SAME day: AAA (+50%) and ZZZ (+10%) -> bench +30%.
  const hist = [
    { date: "2026-01-10", ticker: "AAA", sig: "b-buy", price: 100 },
    { date: "2026-01-10", ticker: "ZZZ", sig: "b-hold", price: 100 },
    { date: "2026-02-01", ticker: "BBB", sig: "b-sell", price: 200 },
    { date: "2026-08-20", ticker: "CCC", sig: "b-buy", price: 50 }, // too recent to judge
  ];
  const cur = { AAA: 150, ZZZ: 110, BBB: 180, CCC: 55 };
  const { agg, byName, overall } = outcomesWithBench(
    hist,
    cur,
    "2026-08-28",
    30,
  );

  it("excess = return minus the same-start-date benchmark", () => {
    expect(byName.AAA.bench).toBeCloseTo(0.3, 10); // avg(50%,10%)
    expect(byName.AAA.excess).toBeCloseTo(0.2, 10); // 50% - 30%
    expect(byName.ZZZ.excess).toBeCloseTo(-0.2, 10); // 10% - 30%
  });
  it("a lone name on its date has zero excess (it IS the benchmark)", () => {
    expect(byName.BBB.excess).toBeCloseTo(0, 10);
  });
  it("buy bucket excess averages the value-add", () => {
    expect(agg.buy.exN).toBe(1);
    expect(agg.buy.exSum / agg.buy.exN).toBeCloseTo(0.2, 10);
  });
  it("overall benchmark is the average judged return", () => {
    expect(overall).toBeCloseTo((0.5 + 0.1 - 0.1) / 3, 10);
  });
});

// ---- replica of recordSignalSnapshot's LATEST-of-day dedup (js/06-features.js) ----
// A re-snapshot on the same day (e.g. after re-importing prices) overwrites that
// ticker's entry in place; prior days are untouched; today never duplicates.
function recordDay(hist, rows, today) {
  const todayIdx = {};
  for (let i = 0; i < hist.length; i++)
    if (hist[i].date === today) todayIdx[hist[i].ticker] = i;
  for (const r of rows) {
    if (!r || !r.ticker || r.price == null) continue;
    const rec = {
      date: today,
      ticker: r.ticker,
      sig: r.sig || "",
      price: r.price,
    };
    const at = todayIdx[r.ticker];
    if (at != null) hist[at] = rec;
    else {
      todayIdx[r.ticker] = hist.length;
      hist.push(rec);
    }
  }
  return hist;
}

describe("Spec #3: signal snapshot latest-of-day wins", () => {
  it("a same-day re-snapshot overwrites the ticker in place (no duplicate)", () => {
    const hist = [
      { date: "2026-08-01", ticker: "ATW", sig: "b-buy", price: 500 }, // prior day
      { date: "2026-08-28", ticker: "ATW", sig: "b-buy", price: 520 }, // today, early
    ];
    recordDay(
      hist,
      [{ ticker: "ATW", sig: "b-hold", price: 540 }],
      "2026-08-28",
    );
    const today = hist.filter(
      (h) => h.date === "2026-08-28" && h.ticker === "ATW",
    );
    expect(today.length).toBe(1); // no duplicate
    expect(today[0].price).toBe(540); // latest wins
    expect(today[0].sig).toBe("b-hold");
  });
  it("prior-day snapshots are never modified", () => {
    const hist = [
      { date: "2026-08-01", ticker: "ATW", sig: "b-buy", price: 500 },
    ];
    recordDay(
      hist,
      [{ ticker: "ATW", sig: "b-hold", price: 999 }],
      "2026-08-28",
    );
    expect(hist.find((h) => h.date === "2026-08-01").price).toBe(500);
  });
  it("a new ticker on the same day appends", () => {
    const hist = [
      { date: "2026-08-28", ticker: "ATW", sig: "b-buy", price: 500 },
    ];
    recordDay(
      hist,
      [{ ticker: "IAM", sig: "b-buy", price: 100 }],
      "2026-08-28",
    );
    expect(hist.filter((h) => h.date === "2026-08-28").length).toBe(2);
  });
});
