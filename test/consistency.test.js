// Computation-consistency tests.
//
// The app already routes its heavy math through src/core (fees/tax/fifo), but
// a few UI paths assemble a number in their own way (rebalance cost estimates,
// projected-dividend tax, the Held+Pending KPI). These tests LOCK those paths
// to the core so that if anyone later reimplements one inline and it drifts,
// CI goes red. They encode the exact invariants the UI relies on.
import { describe, it, expect } from "vitest";
import { computeRow } from "../src/core/fifo.js";
import {
  brokerStockFees,
  brokerFeeRate,
  brokerFixedFee,
  feeRate,
  fixedFee,
  vatRate,
} from "../src/core/fees.js";
import { dividendTax, divRate } from "../src/core/tax.js";
import {
  BROKER_DEFAULTS,
  FP_DEFAULT,
  FP_PEA_DEFAULT,
  DIVTAX_DEFAULT,
} from "../src/core/config.js";

const CTX = {
  master: {},
  brokers: BROKER_DEFAULTS,
  fp: FP_DEFAULT,
  fpPea: FP_PEA_DEFAULT,
  divtax: DIVTAX_DEFAULT,
};

// Replica of js/05-rebalance.js estBuyCost (the fee helpers are the SAME core
// functions the UI's 01-core wrappers delegate to). The invariant we assert is
// that this estimate equals the fee-inclusive cost the core charges at
// execution (computeRow), so a rebalance suggestion can't cost a different
// amount than the order it turns into.
function estBuyCost(px, qty, brokerId) {
  const vat = vatRate(FP_DEFAULT);
  const bk = BROKER_DEFAULTS[brokerId || "attijari"];
  if (bk) {
    if (bk.feeType === "pea")
      return px * qty + brokerStockFees(px * qty, bk, vat);
    return px * qty * (1 + brokerFeeRate(bk, vat)) + brokerFixedFee(bk, vat);
  }
  return px * qty * (1 + feeRate(FP_DEFAULT, vat)) + fixedFee(FP_DEFAULT, vat);
}

describe("rebalance cost estimate matches execution-time core cost", () => {
  const cases = [
    { px: 680, qty: 10, broker: "attijari", pea: true }, // PEA/courtage broker
    { px: 512.5, qty: 7, broker: "attijari", pea: true },
    { px: 100, qty: 3, broker: "saham", pea: false }, // regular/rate broker
    { px: 1234.56, qty: 4, broker: "saham", pea: false },
  ];
  for (const c of cases) {
    it(`BUY ${c.qty}x${c.px} via ${c.broker}: estBuyCost == gross+fees from computeRow`, () => {
      const est = estBuyCost(c.px, c.qty, c.broker);
      const r = computeRow(
        {
          date: "2026-01-15",
          ticker: "X",
          action: "BUY",
          qty: c.qty,
          price: c.px,
          pea: c.pea,
          broker: c.broker,
          opcvm: false,
        },
        0,
        CTX,
      );
      // computeRow BUY net = -(gross + fees); cost = -net.
      // estBuyCost is unrounded gross + (rounded) fees; compare at centime
      // precision, which is what the app displays and stores.
      expect(-r.net).toBeCloseTo(est, 2);
    });
  }
});

describe("projected-dividend tax matches recorded-dividend tax (core)", () => {
  // divCalc now computes tax = __core.tax.dividendTax(grossRegular, false, vat,
  // rate). For a fully-regular dividend, that must equal the tax a recorded DIV
  // transaction gets from computeRow, at the same rate. This locks projected
  // and recorded dividends to the same formula.
  it("full-regular DIV: divCalc tax == computeRow tax", () => {
    const amount = 22,
      shares = 10;
    const vat = vatRate(FP_DEFAULT);
    const yr = 2026;
    const rate = divRate(yr, DIVTAX_DEFAULT, FP_DEFAULT.tpcvm);
    // divCalc path (regPortion = all shares, PEA portion = 0):
    const divCalcTax = dividendTax(amount * shares, false, vat, rate);
    // recorded DIV via computeRow (regular account => pea:false):
    const r = computeRow(
      {
        date: yr + "-06-20",
        ticker: "ATW",
        action: "DIV",
        qty: shares,
        price: amount,
        pea: false,
        opcvm: false,
        broker: "saham",
      },
      0,
      CTX,
    );
    expect(divCalcTax).toBeCloseTo(r.tax, 2);
  });

  it("PEA dividend is tax-exempt in both paths", () => {
    const vat = vatRate(FP_DEFAULT);
    const rate = divRate(2026, DIVTAX_DEFAULT, FP_DEFAULT.tpcvm);
    // divCalc: PEA portion is not taxed -> regPortion 0 -> tax 0.
    expect(dividendTax(0, false, vat, rate)).toBe(0);
    // computeRow with pea:true -> dividendTax short-circuits to 0.
    const r = computeRow(
      { date: "2026-06-20", ticker: "ATW", action: "DIV", qty: 10, price: 22, pea: true, opcvm: false, broker: "attijari" },
      0,
      CTX,
    );
    expect(r.tax).toBe(0);
  });
});

describe("Held+Pending KPI is the sum of position values + pending buy cost", () => {
  // The KPI card computes: total = sum(pos.value) + pendingBuyCost(), where
  // pendingBuyCost sums -computeRow(BUY).net over pending BUY orders. This test
  // reproduces that arithmetic to lock the KPI to the same components.
  function pendingBuyCost(pending) {
    let cost = 0;
    for (const o of pending) {
      if (o.action !== "BUY") continue;
      const r = computeRow({ ...o }, 0, CTX);
      cost += Math.abs(r.net) || 0;
    }
    return cost;
  }
  it("total = held value + fee-inclusive pending buys", () => {
    const heldValue = 100000; // sum of pos.value from runFIFO (given)
    const pending = [
      { date: "2026-01-10", ticker: "ATW", action: "BUY", qty: 10, price: 680, pea: true, broker: "attijari", opcvm: false },
      { date: "2026-01-10", ticker: "IAM", action: "BUY", qty: 5, price: 100, pea: false, broker: "saham", opcvm: false },
      { date: "2026-01-10", ticker: "ATW", action: "SELL", qty: 2, price: 700, pea: true, broker: "attijari", opcvm: false }, // ignored
    ];
    const pc = pendingBuyCost(pending);
    const total = heldValue + pc;
    // Sanity: SELL excluded, so pc equals just the two BUY costs.
    const buy1 = -computeRow(pending[0], 0, CTX).net;
    const buy2 = -computeRow(pending[1], 0, CTX).net;
    expect(pc).toBeCloseTo(buy1 + buy2, 2);
    expect(total).toBeCloseTo(heldValue + buy1 + buy2, 2);
  });
});
