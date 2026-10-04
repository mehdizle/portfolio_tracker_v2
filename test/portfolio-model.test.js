// Tests for the target-weight rebalance engine (src/core/portfolio-model.js):
// volatility (spacing-aware for weekly funds), attractiveness ordering, capped
// water-filling target weights, and trade planning (sell triggers, buy drift,
// DCA boost, deliberate cash-idle). Pure module - runs under vitest "node".
import { describe, it, expect } from "vitest";
import {
  annualizedVol,
  attractiveness,
  targetWeights,
  planTrades,
  allocSellLots,
} from "../src/core/portfolio-model.js";

// Deterministic fee-free helpers for exact trade assertions.
const H = {
  buyCost: (tk, q, p) => q * p,
  sellNet: (tk, q, p) => q * p,
  lotRound: (tk, q) => Math.floor(q),
};

// Build a dated close series with a fixed per-step log-return seed.
function series(startDate, stepDays, closes) {
  const out = [];
  let d = new Date(startDate);
  for (const c of closes) {
    out.push({ date: d.toISOString().slice(0, 10), close: c });
    d = new Date(d.getTime() + stepDays * 86400000);
  }
  return out;
}

describe("annualizedVol", () => {
  it("returns null when there are too few returns", () => {
    expect(annualizedVol(series("2025-01-01", 1, [100, 101, 102]))).toBe(null);
    expect(annualizedVol([])).toBe(null);
  });

  it("is spacing-aware: weekly series is NOT annualised as if daily", () => {
    // Same closes, once at 1-day spacing and once at 7-day spacing. A naive
    // sqrt(252) would make the weekly one look ~2.6x more volatile; the
    // spacing-aware factor keeps them comparable.
    const closes = [];
    let p = 100;
    for (let i = 0; i < 40; i++) {
      p = p * (1 + (i % 2 ? -0.01 : 0.011)); // deterministic wiggle
      closes.push(+p.toFixed(4));
    }
    const daily = annualizedVol(series("2025-01-01", 1, closes));
    const weekly = annualizedVol(series("2025-01-01", 7, closes));
    expect(daily).toBeGreaterThan(0);
    expect(weekly).toBeGreaterThan(0);
    // Spacing-aware annualisation: with the SAME per-observation stdev, daily
    // scales by sqrt(252) and weekly by sqrt(252/5) (median 7-cal-day gap ~=
    // 5 trading days), so weekly/daily = sqrt(1/5) ~= 0.447 - the weekly series
    // is NOT blown up as if its returns were daily. The whole point is the
    // weekly vol stays SMALLER (the key failure mode was it reading too HIGH):
    expect(weekly).toBeLessThan(daily);
    expect(weekly / daily).toBeCloseTo(Math.sqrt(1 / 5), 2); // ~0.447
  });

  it("a flat series has ~zero vol", () => {
    const flat = series("2025-01-01", 1, new Array(40).fill(100));
    expect(annualizedVol(flat)).toBeCloseTo(0, 6);
  });
});

describe("attractiveness", () => {
  const o = { valueTilt: 0.5, volRef: 0.25 };
  it("ranks a cheap, high-quality, high-conviction name above a rich, low-quality one", () => {
    const good = attractiveness(
      { base: 0.8, disc: 0.3, conviction: "High", vol: 0.2 },
      o,
    );
    const bad = attractiveness(
      { base: 0.4, disc: -0.2, conviction: "Low", vol: 0.4 },
      o,
    );
    expect(good).toBeGreaterThan(bad);
  });

  it("is 0 when base is missing/<=0 (nothing to size)", () => {
    expect(attractiveness({ base: 0, disc: 0.3 }, o)).toBe(0);
    expect(attractiveness({ disc: 0.3 }, o)).toBe(0);
  });

  it("higher volatility lowers attractiveness (risk-adjusted)", () => {
    const lowVol = attractiveness(
      { base: 0.7, disc: 0.1, conviction: "Medium", vol: 0.15 },
      o,
    );
    const hiVol = attractiveness(
      { base: 0.7, disc: 0.1, conviction: "Medium", vol: 0.5 },
      o,
    );
    expect(lowVol).toBeGreaterThan(hiVol);
  });

  it("risk-adjust can be turned off (vol ignored)", () => {
    const a = attractiveness(
      { base: 0.7, disc: 0.1, conviction: "Medium", vol: 0.15 },
      { valueTilt: 0.5, volRef: 0.25, riskAdjust: false },
    );
    const b = attractiveness(
      { base: 0.7, disc: 0.1, conviction: "Medium", vol: 0.5 },
      { valueTilt: 0.5, volRef: 0.25, riskAdjust: false },
    );
    expect(a).toBeCloseTo(b, 10);
  });
});

describe("targetWeights (capped water-filling)", () => {
  const cands = [
    {
      ticker: "A",
      cat: "Banks",
      base: 0.9,
      disc: 0.3,
      conviction: "High",
      vol: 0.2,
    },
    {
      ticker: "B",
      cat: "Banks",
      base: 0.8,
      disc: 0.2,
      conviction: "High",
      vol: 0.2,
    },
    {
      ticker: "C",
      cat: "Telecom",
      base: 0.7,
      disc: 0.1,
      conviction: "Medium",
      vol: 0.25,
    },
    {
      ticker: "D",
      cat: "Cement",
      base: 0.6,
      disc: 0.0,
      conviction: "Low",
      vol: 0.3,
    },
    {
      ticker: "E",
      cat: "Cement",
      base: 0.5,
      disc: -0.1,
      conviction: "Medium",
      vol: 0.35,
    },
  ];

  it("respects name and sector caps (never breaches to deploy more)", () => {
    const { weights } = targetWeights(
      cands,
      { nameCap: 0.2, sectorCap: 0.3, opcvmCap: 0.35 },
      { valueTilt: 0.5 },
    );
    for (const tk in weights)
      expect(weights[tk]).toBeLessThanOrEqual(0.2 + 1e-9);
    expect(weights.A + weights.B).toBeLessThanOrEqual(0.3 + 1e-9); // Banks
    expect(weights.D + weights.E).toBeLessThanOrEqual(0.3 + 1e-9); // Cement
  });

  it("leaves the infeasible remainder as cash rather than breaching caps", () => {
    // 3 sectors, caps 0.3/0.3 + a single Telecom name capped at 0.2 => at most
    // 0.8 can be placed; the remaining 0.2 is intentionally left unallocated.
    const { weights } = targetWeights(
      cands,
      { nameCap: 0.2, sectorCap: 0.3, opcvmCap: 0.35 },
      { valueTilt: 0.5 },
    );
    const total = Object.values(weights).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(0.8, 4);
  });

  it("honours a deliberate cash reserve (weights sum to 1 - reserve)", () => {
    const { weights } = targetWeights(
      cands,
      { nameCap: 0.5, sectorCap: 0.6, opcvmCap: 0.6 },
      { valueTilt: 0.5, reservePct: 0.2 },
    );
    const total = Object.values(weights).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(0.8, 4);
  });

  it("gives a Sell-rated name a 0 target", () => {
    const c = [
      {
        ticker: "A",
        cat: "Banks",
        base: 0.9,
        disc: 0.3,
        conviction: "High",
        vol: 0.2,
      },
      {
        ticker: "B",
        cat: "Banks",
        base: 0.8,
        disc: 0.2,
        conviction: "High",
        vol: 0.2,
        sellRated: true,
      },
    ];
    const { weights } = targetWeights(
      c,
      { nameCap: 1, sectorCap: 1, opcvmCap: 1 },
      { valueTilt: 0 },
    );
    expect(weights.B).toBe(0);
    expect(weights.A).toBeCloseTo(1, 6);
  });

  it("weights are higher for the more attractive name within a sector", () => {
    const { weights } = targetWeights(
      cands,
      { nameCap: 0.5, sectorCap: 0.6, opcvmCap: 0.6 },
      { valueTilt: 0.5 },
    );
    expect(weights.A).toBeGreaterThan(weights.B); // A cheaper + higher base
  });
});

describe("planTrades", () => {
  it("fully exits a Sell-rated holding", () => {
    const t = { weights: { A: 0.5, B: 0.5 }, attract: { A: 2, B: 0 } };
    const pos = [
      {
        ticker: "A",
        cat: "X",
        held: 10,
        price: 100,
        value: 1000,
        avg: 90,
        buyOrHold: true,
      },
      {
        ticker: "B",
        cat: "Y",
        held: 5,
        price: 50,
        value: 250,
        sellRated: true,
      },
    ];
    const r = planTrades(t, pos, 0, H, {});
    const b = r.sells.find((s) => s.ticker === "B");
    expect(b).toBeTruthy();
    expect(b.qty).toBe(5);
    expect(b.reason).toBe("Sell-rated");
  });

  it("trims a name trading above fair value toward its target", () => {
    const t = { weights: { A: 0.2 }, attract: { A: 1 } };
    const pos = [
      { ticker: "A", cat: "X", held: 10, price: 200, value: 2000, fv: 150 },
    ];
    const r = planTrades(t, pos, 0, H, {});
    const s = r.sells.find((x) => x.ticker === "A");
    expect(s.reason).toBe("above fair value");
    expect(s.qty).toBe(8); // sleeve 2000, target 400 -> trim 1600 = 8 @ 200
  });

  it("buys to close positive drift, whole shares, within cash", () => {
    const t = { weights: { A: 0.6, B: 0.4 }, attract: { A: 2, B: 1.5 } };
    const pos = [
      { ticker: "A", cat: "X", held: 0, price: 100, value: 0 },
      { ticker: "B", cat: "Y", held: 0, price: 50, value: 0 },
    ];
    const r = planTrades(t, pos, 1000, H, { maxBuys: 5 });
    const a = r.buys.find((b) => b.ticker === "A");
    const b = r.buys.find((b) => b.ticker === "B");
    expect(a.qty).toBe(6); // 0.6*1000 = 600 -> 6 @ 100
    expect(b.qty).toBe(8); // 0.4*1000 = 400 -> 8 @ 50
    expect(r.holdCash).toBeCloseTo(0, 6);
  });

  it("prices a NEW (non-held) buy candidate from the opts.prices map", () => {
    // Target wants NEW, but there's no position for it -> price must come from
    // the prices map, not a (missing) position. Previously this skipped with
    // "no price available".
    const t = { weights: { NEW: 1.0 }, attract: { NEW: 2 } };
    const pos = []; // nothing held
    const r = planTrades(t, pos, 1000, H, {
      maxBuys: 5,
      prices: { NEW: 100 },
    });
    const buy = r.buys.find((b) => b.ticker === "NEW");
    expect(buy).toBeTruthy();
    expect(buy.price).toBe(100);
    expect(buy.qty).toBe(10); // 1000 / 100
    expect(r.skipped.find((s) => s.ticker === "NEW")).toBeFalsy();
  });

  it("holds cash when nothing clears the min-attractiveness bar", () => {
    const t = { weights: { A: 1.0 }, attract: { A: 0.3 } };
    const pos = [{ ticker: "A", cat: "X", held: 0, price: 100, value: 0 }];
    const r = planTrades(t, pos, 1000, H, { minAttract: 0.5 });
    expect(r.buys).toHaveLength(0);
    expect(r.holdCash).toBe(1000);
    expect(r.notes.join(" ")).toMatch(/holding cash/i);
  });

  it("DCA boost ranks a held, below-cost, still-sound name first", () => {
    const t = { weights: { A: 0.5, B: 0.5 }, attract: { A: 1.0, B: 1.0 } };
    const pos = [
      // A is 20% below avg cost, buy-or-hold, decent quality -> DCA boost
      {
        ticker: "A",
        cat: "X",
        held: 10,
        price: 80,
        value: 800,
        avg: 100,
        buyOrHold: true,
        quality: 0.6,
      },
      {
        ticker: "B",
        cat: "Y",
        held: 10,
        price: 100,
        value: 1000,
        avg: 90,
        buyOrHold: true,
        quality: 0.6,
      },
    ];
    const r = planTrades(t, pos, 500, H, { dcaBoost: 1.0, maxBuys: 5 });
    expect(r.buys[0].ticker).toBe("A"); // boosted ahead of B
    expect(r.buys.find((b) => b.ticker === "A").dca).toBe(true);
  });

  it("does NOT DCA into a falling knife (low quality or sell-rated)", () => {
    const t = { weights: { A: 1.0 }, attract: { A: 1.0 } };
    const pos = [
      // below cost but low quality -> no DCA boost (dca flag false)
      {
        ticker: "A",
        cat: "X",
        held: 10,
        price: 80,
        value: 800,
        avg: 100,
        buyOrHold: true,
        quality: 0.2,
      },
    ];
    const r = planTrades(t, pos, 500, H, { dcaBoost: 1.0, maxBuys: 5 });
    const a = r.buys.find((b) => b.ticker === "A");
    if (a) expect(a.dca).toBe(false);
  });

  it("respects maxBuys for NEW names (held names can always be topped up)", () => {
    const t = {
      weights: { A: 0.25, B: 0.25, C: 0.25, D: 0.25 },
      attract: { A: 1, B: 1, C: 1, D: 1 },
    };
    const pos = [
      { ticker: "A", cat: "W", held: 0, price: 100, value: 0 },
      { ticker: "B", cat: "X", held: 0, price: 100, value: 0 },
      { ticker: "C", cat: "Y", held: 0, price: 100, value: 0 },
      { ticker: "D", cat: "Z", held: 0, price: 100, value: 0 },
    ];
    const r = planTrades(t, pos, 10000, H, { maxBuys: 2 });
    const newNames = new Set(r.buys.map((b) => b.ticker));
    expect(newNames.size).toBeLessThanOrEqual(2);
  });
});

describe("targetWeights: pinned overrides", () => {
  const cands = [
    {
      ticker: "A",
      cat: "Banks",
      base: 0.9,
      disc: 0.3,
      conviction: "High",
      vol: 0.2,
    },
    {
      ticker: "B",
      cat: "Telecom",
      base: 0.8,
      disc: 0.2,
      conviction: "High",
      vol: 0.2,
    },
    {
      ticker: "C",
      cat: "Cement",
      base: 0.7,
      disc: 0.1,
      conviction: "Medium",
      vol: 0.25,
    },
  ];

  it("pins a name at the given weight and water-fills the rest", () => {
    const { weights } = targetWeights(
      cands,
      { nameCap: 0.5, sectorCap: 0.6, opcvmCap: 0.6 },
      { valueTilt: 0.5, pinned: { A: 0.3 } },
    );
    expect(weights.A).toBeCloseTo(0.3, 6);
    expect(Object.values(weights).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 4);
    expect(weights.B + weights.C).toBeCloseTo(0.7, 4);
  });

  it("clamps a pin to the single-name cap", () => {
    const { weights } = targetWeights(
      cands,
      { nameCap: 0.2, sectorCap: 0.6, opcvmCap: 0.6 },
      { valueTilt: 0.5, pinned: { A: 0.9 } },
    );
    expect(weights.A).toBeCloseTo(0.2, 6);
  });

  it("a pin forces in a name the model would score 0 (Sell-rated)", () => {
    const c = [
      {
        ticker: "A",
        cat: "Banks",
        base: 0.9,
        disc: 0.3,
        conviction: "High",
        vol: 0.2,
        sellRated: true,
      },
      {
        ticker: "B",
        cat: "Telecom",
        base: 0.8,
        disc: 0.2,
        conviction: "High",
        vol: 0.2,
      },
    ];
    const { weights, pinned } = targetWeights(
      c,
      { nameCap: 0.5, sectorCap: 0.6, opcvmCap: 0.6 },
      { valueTilt: 0.5, pinned: { A: 0.15 } },
    );
    expect(weights.A).toBeCloseTo(0.15, 6);
    expect(pinned.A).toBeCloseTo(0.15, 6);
  });

  it("charges a pinned NON-candidate against its sector cap via pinnedCats", () => {
    // Pin ticker Z (not in `cands`) into the Banks sector at 0.15. Candidate A
    // is also a Bank. With a 0.2 Banks sector cap, the flex pass must only be
    // able to add 0.05 of Banks on top of the pin -> A caps at ~0.05, and the
    // total Banks exposure (pin + A) must not exceed the 0.2 sector cap.
    const { weights } = targetWeights(
      cands,
      { nameCap: 0.5, sectorCap: 0.2, opcvmCap: 0.6 },
      {
        valueTilt: 0.5,
        pinned: { Z: 0.15 },
        pinnedCats: { Z: "Banks" },
      },
    );
    expect(weights.Z).toBeCloseTo(0.15, 6);
    // A (Banks candidate) can take at most the remaining 0.05 of the sector cap.
    expect(weights.A).toBeLessThanOrEqual(0.05 + 1e-6);
    const banksTotal = weights.Z + weights.A;
    expect(banksTotal).toBeLessThanOrEqual(0.2 + 1e-6);
  });

  it("without pinnedCats a pinned non-candidate does NOT constrain its sector", () => {
    // Same setup but omit pinnedCats: the pin's category is unknown, so the
    // Banks candidate A is free to fill the full 0.2 sector cap on top of the
    // pin (documents the pre-fix behaviour, now opt-in).
    const { weights } = targetWeights(
      cands,
      { nameCap: 0.5, sectorCap: 0.2, opcvmCap: 0.6 },
      { valueTilt: 0.5, pinned: { Z: 0.15 } },
    );
    expect(weights.Z).toBeCloseTo(0.15, 6);
    expect(weights.A).toBeCloseTo(0.2, 4);
  });
});

describe("allocSellLots (tax-lot-aware trim order)", () => {
  it("sells PEA lots first, then Regular highest-cost first", () => {
    const lots = [
      { qty: 10, cost: 100, pea: false }, // Regular, cost 100
      { qty: 5, cost: 150, pea: false }, // Regular, cost 150 (higher)
      { qty: 8, cost: 90, pea: true }, // PEA
    ];
    const plan = allocSellLots(lots, 15, 200);
    expect(plan[0].account).toBe("PEA");
    expect(plan[0].qty).toBe(8);
    expect(plan[1].account).toBe("Regular");
    expect(plan[1].costPS).toBe(150); // higher cost before lower
    expect(plan[1].qty).toBe(5);
    expect(plan[2].costPS).toBe(100);
    expect(plan[2].qty).toBe(2);
  });

  it("falls back to a single undifferentiated slice without lot detail", () => {
    const plan = allocSellLots(null, 7, 100);
    expect(plan).toHaveLength(1);
    expect(plan[0].qty).toBe(7);
  });

  it("computes gain-per-share from price minus cost", () => {
    const plan = allocSellLots([{ qty: 4, cost: 80, pea: false }], 4, 100);
    expect(plan[0].gainPS).toBeCloseTo(20, 6);
  });
});

describe("planTrades: skipped reasons + sell lot plan + readout", () => {
  const H = {
    buyCost: (tk, q, p) => q * p,
    sellNet: (tk, q, p) => q * p,
    lotRound: (tk, q) => Math.floor(q),
  };

  it("records WHY a positive-target name got no buy (max new-names)", () => {
    const t = {
      weights: { A: 0.25, B: 0.25, C: 0.25, D: 0.25 },
      attract: { A: 1, B: 1, C: 0.9, D: 0.8 },
    };
    const pos = ["A", "B", "C", "D"].map((tk) => ({
      ticker: tk,
      cat: tk,
      held: 0,
      price: 100,
      value: 0,
    }));
    const r = planTrades(t, pos, 100000, H, { maxBuys: 2 });
    const skippedTks = r.skipped.map((s) => s.ticker);
    // 2 names bought, the other 2 skipped with a max-new-names reason
    expect(r.buys.length).toBe(2);
    expect(skippedTks.length).toBeGreaterThanOrEqual(1);
    expect(r.skipped.every((s) => /max new-names/.test(s.reason))).toBe(true);
  });

  it("records a below-attractiveness-bar skip", () => {
    const t = { weights: { A: 1.0 }, attract: { A: 0.3 } };
    const pos = [{ ticker: "A", cat: "X", held: 0, price: 100, value: 0 }];
    const r = planTrades(t, pos, 1000, H, { minAttract: 0.5 });
    expect(r.buys).toHaveLength(0);
    expect(r.skipped.find((s) => s.ticker === "A").reason).toMatch(
      /attractiveness bar/i,
    );
  });

  it("attaches a tax-lot sell plan to trims", () => {
    const t = { weights: { A: 0 }, attract: { A: 0 } }; // zero target -> exit
    const pos = [
      {
        ticker: "A",
        cat: "X",
        held: 15,
        price: 200,
        value: 3000,
        sellRated: true,
        lots: [
          { qty: 10, cost: 100, pea: false },
          { qty: 5, cost: 150, pea: true },
        ],
      },
    ];
    const r = planTrades(t, pos, 0, H, {});
    const sell = r.sells.find((s) => s.ticker === "A");
    expect(sell).toBeTruthy();
    expect(sell.lotPlan[0].account).toBe("PEA"); // PEA sold first
    expect(sell.account).toBe("Regular"); // dominant (10 vs 5)
  });

  it("suggestTrims:false suppresses ALL sells (even a Sell-rated holding)", () => {
    const t = { weights: { A: 0.5 }, attract: { A: 1 } };
    const pos = [
      {
        ticker: "A",
        cat: "X",
        held: 10,
        price: 200,
        value: 2000,
        fv: 100,
        sellRated: true,
      },
    ];
    const off = planTrades(t, pos, 0, H, { suggestTrims: false });
    expect(off.sells).toHaveLength(0);
    const on = planTrades(t, pos, 0, H, { suggestTrims: true });
    expect(on.sells.length).toBeGreaterThan(0); // same input, trims enabled
  });

  it("returns a portfolio readout (projected sector mix + cash %)", () => {
    const t = { weights: { A: 0.5, B: 0.5 }, attract: { A: 2, B: 2 } };
    const pos = [
      {
        ticker: "A",
        cat: "Banks",
        cyc: "Defensive",
        sty: "Value",
        vol: 0.2,
        held: 0,
        price: 100,
        value: 0,
      },
      {
        ticker: "B",
        cat: "Telecom",
        cyc: "Defensive",
        sty: "Yield",
        vol: 0.3,
        held: 0,
        price: 100,
        value: 0,
      },
    ];
    const r = planTrades(t, pos, 1000, H, { maxBuys: 5 });
    expect(r.readout).toBeTruthy();
    // both fully deployed -> cash ~0, two sectors ~50% each
    expect(r.readout.cashPct).toBeCloseTo(0, 2);
    const banks = r.readout.sectors.find((s) => s.name === "Banks");
    expect(banks.weight).toBeCloseTo(0.5, 1);
    // Defensive cycle should be ~100% (both names)
    const defensive = r.readout.cycles.find((c) => c.name === "Defensive");
    expect(defensive.weight).toBeCloseTo(1, 1);
    // weighted vol between the two inputs
    expect(r.readout.wVol).toBeGreaterThan(0.19);
    expect(r.readout.wVol).toBeLessThan(0.31);
  });

  it("groups NEW buy candidates (not in positions) by opts.meta, not Uncategorized", () => {
    // Reproduces the real app: a name the model wants to BUY but that the user
    // does NOT currently hold is absent from `positions`. Its category lives in
    // opts.meta (sourced from M / the candidate list). Before the fix the
    // readout grouped it as "Uncategorized"/"Unclassified".
    const t = { weights: { BCP: 1 }, attract: { BCP: 2 } };
    const pos = []; // nothing held
    const r = planTrades(t, pos, 1000, H, {
      maxBuys: 5,
      prices: { BCP: 100 },
      meta: {
        BCP: {
          cat: "Banking",
          cyc: "Cyclical",
          sty: "Compounder",
          name: "Banque Centrale Populaire",
        },
      },
    });
    expect(r.readout).toBeTruthy();
    // BCP got bought, so it carries value in the post-plan readout.
    const bank = r.readout.sectors.find((s) => s.name === "Banking");
    expect(bank).toBeTruthy();
    expect(bank.weight).toBeGreaterThan(0);
    // And it must NOT have fallen into the Uncategorized bucket.
    expect(
      r.readout.sectors.find((s) => s.name === "Uncategorized"),
    ).toBeFalsy();
    expect(r.readout.cycles.find((c) => c.name === "Cyclical")).toBeTruthy();
    expect(r.readout.cycles.find((c) => c.name === "Unclassified")).toBeFalsy();
    expect(r.readout.styles.find((s) => s.name === "Compounder")).toBeTruthy();
  });
});
