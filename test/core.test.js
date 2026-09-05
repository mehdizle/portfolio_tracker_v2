// Unit tests for the pure financial core. Run with `npm test` (Vitest).
import { describe, it, expect } from "vitest";
import {
  roundMoney,
  toCents,
  fromCents,
  sumMoney,
  amount,
} from "../src/core/money.js";
import {
  peaStockFees,
  peaDivFees,
  calcBrokerFees,
  opcvmFee,
  opcvmSurcharge,
  feeRate,
  fixedFee,
} from "../src/core/fees.js";
import { divRate, capitalGainsTax, dividendTax } from "../src/core/tax.js";
import {
  computeRow,
  runFIFO,
  txnBroker,
  annotateOrderCourtage,
} from "../src/core/fifo.js";
import {
  FP_DEFAULT,
  FP_PEA_DEFAULT,
  BROKER_DEFAULTS,
  DIVTAX_DEFAULT,
} from "../src/core/config.js";

const VAT = 0.1;
const CTX = {
  master: {
    ATW: { name: "Attijariwafa", cat: "Banking", price: 706.1 },
    "FCP A": {
      name: "Fund A",
      cat: "OPCVM",
      price: 826.32,
      buyFee: 0.02,
      sellFee: 0.015,
    },
  },
  brokers: BROKER_DEFAULTS,
  fp: FP_DEFAULT,
  fpPea: FP_PEA_DEFAULT,
  divtax: DIVTAX_DEFAULT,
};

describe("money", () => {
  it("rounds to centimes without float drift", () => {
    // The real job: kill binary-float drift so accumulated money stays exact.
    expect(roundMoney(0.1 + 0.2)).toBe(0.3); // 0.30000000000000004 -> 0.3
    expect(roundMoney(245.5)).toBe(245.5);
    expect(roundMoney(457.0 / 1)).toBe(457);
    expect(roundMoney(496.9306)).toBe(496.93); // trims sub-centime noise
    expect(roundMoney(-250.675999)).toBe(-250.68);
    // Note: literals like 1.005 are NOT exactly representable in IEEE-754
    // (stored as 1.00499...), so we do not assert a fixed half-up result for
    // them - that would test the float format, not our rounding.
  });
  it("cents round-trip is exact", () => {
    expect(toCents(19.99)).toBe(1999);
    expect(fromCents(1999)).toBe(19.99);
  });
  it("sums money without accumulation drift", () => {
    const vals = Array(10).fill(0.1);
    expect(sumMoney(vals)).toBe(1.0);
  });
  it("amount() multiplies qty*price then rounds once", () => {
    expect(amount(4, 114.25)).toBe(457);
    expect(amount(0.582, 853.83)).toBe(496.93);
  });
});

describe("fees", () => {
  it("regular broker stock fee (Saham): gross*rate + fixed, VAT incl", () => {
    // CFG BUY 1@245.5 -> 5.18 (from reference computation)
    const f = calcBrokerFees(
      245.5,
      "BUY",
      BROKER_DEFAULTS.saham,
      false,
      VAT,
      FP_DEFAULT,
    );
    expect(f).toBe(5.18);
  });
  it("regular broker stock fee: IAM 4@114.25 -> 7.27", () => {
    const f = calcBrokerFees(
      457,
      "BUY",
      BROKER_DEFAULTS.saham,
      false,
      VAT,
      FP_DEFAULT,
    );
    expect(f).toBe(7.27);
  });
  it("PEA stock fee with courtage floor", () => {
    expect(peaStockFees(1000, FP_PEA_DEFAULT, VAT)).toBe(14.3);
    // Small trade hits the 10 MAD courtage floor:
    // court=max(100*0.01,10)=10; +100*0.002 +100*0.001 =10.3; *1.1 = 11.33
    expect(peaStockFees(100, FP_PEA_DEFAULT, VAT)).toBe(11.33);
  });
  it("OPCVM flat surcharge = 11 (10 + VAT)", () => {
    expect(opcvmSurcharge(BROKER_DEFAULTS, VAT)).toBe(11);
  });
  it("OPCVM fee includes fund pct when requested", () => {
    // gross 1000, buyFee 2% => 20 + 11 surcharge = 31
    const meta = { buyFee: 0.02, sellFee: 0.015 };
    expect(opcvmFee(1000, "BUY", meta, true, BROKER_DEFAULTS, VAT)).toBe(31);
    // without fund pct (manual total path) => just surcharge
    expect(opcvmFee(1000, "BUY", meta, false, BROKER_DEFAULTS, VAT)).toBe(11);
  });
  it("legacy fallback fee (no broker)", () => {
    const f = calcBrokerFees(1000, "BUY", null, false, VAT, FP_DEFAULT);
    // 1000*(0.009*1.1) + 2.5*1.1 = 9.9 + 2.75 = 12.65
    expect(f).toBe(12.65);
  });
});

describe("tax", () => {
  it("divRate exact + forward-fill", () => {
    expect(divRate(2025, DIVTAX_DEFAULT, 0.15)).toBe(0.125);
    expect(divRate(2026, DIVTAX_DEFAULT, 0.15)).toBe(0.1125);
    expect(divRate(2027, DIVTAX_DEFAULT, 0.15)).toBe(0.1);
    expect(divRate(2030, DIVTAX_DEFAULT, 0.15)).toBe(0.1); // carry forward last
    expect(divRate(2020, DIVTAX_DEFAULT, 0.15)).toBe(0.125); // before earliest
    expect(divRate(2025, {}, 0.15)).toBeCloseTo(0.1125); // empty -> tpcvm*0.75
  });
  it("capital gains: PEA exempt, regular = max(gain,0)*tpcvm", () => {
    expect(capitalGainsTax(1000, 10, 800, true, 0.15)).toBe(0); // PEA
    // gain = 1000 - 10 - 800 = 190; *0.15 = 28.5
    expect(capitalGainsTax(1000, 10, 800, false, 0.15)).toBe(28.5);
    // loss -> no negative tax
    expect(capitalGainsTax(500, 10, 800, false, 0.15)).toBe(0);
  });
  it("dividend tax: PEA exempt, regular = gross*(1+vat)*rate", () => {
    expect(dividendTax(1000, true, VAT, 0.125)).toBe(0);
    // 1000 * 1.1 * 0.125 = 137.5
    expect(dividendTax(1000, false, VAT, 0.125)).toBe(137.5);
  });
});

describe("computeRow", () => {
  it("regular BUY: net = -(gross+fees)", () => {
    const r = computeRow(
      {
        date: "2025-11-27",
        ticker: "CFG",
        action: "BUY",
        qty: 1,
        price: 245.5,
        pea: false,
        broker: "saham",
      },
      0,
      CTX,
    );
    expect(r.fees).toBe(5.18);
    expect(r.net).toBe(-250.68);
    expect(r.tax).toBe(0);
  });
  it("manual total BUY: uses total directly", () => {
    const r = computeRow(
      {
        date: "2025-11-28",
        ticker: "FCP A",
        action: "BUY",
        qty: 0.582,
        price: 853.83,
        total: 500,
        opcvm: true,
        pea: false,
      },
      0,
      CTX,
    );
    expect(r.net).toBe(-500);
    expect(r.manual).toBe(true);
  });
  it("regular SELL applies capital-gains tax on gain", () => {
    // sell 1 @ 1000, avg cost 800; gross=1000, fee via saham
    const r = computeRow(
      {
        date: "2026-01-10",
        ticker: "ATW",
        action: "SELL",
        qty: 1,
        price: 1000,
        pea: false,
        broker: "saham",
      },
      800,
      CTX,
    );
    expect(r.tax).toBeGreaterThan(0);
    expect(r.net).toBeCloseTo(1000 - r.fees - r.tax, 2);
  });
});

describe("runFIFO basic scenarios", () => {
  it("buy then full sell realizes gain net of fees", () => {
    const txns = [
      {
        date: "2025-01-01",
        ticker: "ATW",
        action: "BUY",
        qty: 10,
        price: 100,
        pea: false,
        broker: "saham",
      },
      {
        date: "2025-06-01",
        ticker: "ATW",
        action: "SELL",
        qty: 10,
        price: 120,
        pea: false,
        broker: "saham",
      },
    ];
    const { pos } = runFIFO(txns, CTX);
    const p = pos["ATW||REG"];
    expect(p.held).toBe(0);
    expect(p.status).toBe("Closed");
    expect(p.realized).toBeGreaterThan(0);
  });
  it("FIFO matches oldest lots first", () => {
    const txns = [
      {
        date: "2025-01-01",
        ticker: "ATW",
        action: "BUY",
        qty: 10,
        price: 100,
        pea: false,
        broker: "saham",
      },
      {
        date: "2025-02-01",
        ticker: "ATW",
        action: "BUY",
        qty: 10,
        price: 200,
        pea: false,
        broker: "saham",
      },
      {
        date: "2025-06-01",
        ticker: "ATW",
        action: "SELL",
        qty: 10,
        price: 300,
        pea: false,
        broker: "saham",
      },
    ];
    const { pos } = runFIFO(txns, CTX);
    const p = pos["ATW||REG"];
    expect(p.held).toBe(10); // 10 left (the 200-cost lot)
    // avg cost of remaining should be ~ the 200 lot ttc (>200 due to fees)
    expect(p.avg).toBeGreaterThan(200);
  });
  it("PEA and regular accounts are independent", () => {
    const txns = [
      {
        date: "2025-01-01",
        ticker: "ATW",
        action: "BUY",
        qty: 5,
        price: 100,
        pea: true,
        broker: "attijari",
      },
      {
        date: "2025-01-01",
        ticker: "ATW",
        action: "BUY",
        qty: 5,
        price: 100,
        pea: false,
        broker: "saham",
      },
      {
        date: "2025-06-01",
        ticker: "ATW",
        action: "SELL",
        qty: 5,
        price: 150,
        pea: true,
        broker: "attijari",
      },
    ];
    const { pos } = runFIFO(txns, CTX);
    expect(pos["ATW||PEA"].held).toBe(0);
    expect(pos["ATW||REG"].held).toBe(5);
    expect(pos["ATW||PEA"].realized).toBeGreaterThan(0);
    // PEA sell pays no capital-gains tax
    expect(pos["ATW||PEA"].realizedDetail.length).toBe(1);
  });
  it("fractional OPCVM quantities produce no residual dust", () => {
    const txns = [
      {
        date: "2025-01-01",
        ticker: "FCP A",
        action: "BUY",
        qty: 0.582,
        price: 853.83,
        opcvm: true,
        pea: false,
        broker: "saham",
      },
      {
        date: "2025-06-01",
        ticker: "FCP A",
        action: "SELL",
        qty: 0.582,
        price: 900,
        opcvm: true,
        pea: false,
        broker: "saham",
      },
    ];
    const { pos } = runFIFO(txns, CTX);
    const p = pos["FCP A||REG"];
    expect(Math.abs(p.held)).toBeLessThan(1e-9);
    expect(p.status).toBe("Closed");
  });
});

describe("split-order courtage (Attijari per-order minimum)", () => {
  const CTX_PEA = { ...CTX, brokers: BROKER_DEFAULTS };

  it("applies the courtage minimum ONCE per split order (ZDJ case)", () => {
    // One order: 10 sh @ 305 (=3050 gross), filled 2 sh then 8 sh across 2 days.
    // Broker: courtage = 1% of 3050 = 30.50; the 2-sh fill hits the 10 floor,
    // the 8-sh fill absorbs the remainder (20.50). Regl 0.2% + bourse 0.1% per
    // fill, +10% VAT. Expected fees: 2-sh 13.01, 8-sh 30.60.
    const rows = annotateOrderCourtage(
      [
        {
          date: "2026-09-03",
          ticker: "ZDJ",
          action: "BUY",
          qty: 2,
          price: 305,
          pea: true,
          broker: "attijari",
        },
        {
          date: "2026-09-04",
          ticker: "ZDJ",
          action: "BUY",
          qty: 8,
          price: 305,
          pea: true,
          broker: "attijari",
        },
      ].map((t) => ({ ...t })),
      CTX_PEA,
    );
    const small = rows.find((r) => r.qty === 2);
    const big = rows.find((r) => r.qty === 8);
    expect(small._courtageOverride).toBeCloseTo(10.0, 2);
    expect(big._courtageOverride).toBeCloseTo(20.5, 2);
    const fSmall = computeRow(small, 0, CTX_PEA);
    const fBig = computeRow(big, 0, CTX_PEA);
    expect(fSmall.fees).toBeCloseTo(13.01, 2);
    expect(fBig.fees).toBeCloseTo(30.6, 2);
    // total net matches the broker statement (623.01 + 2470.60)
    expect(-(fSmall.net + fBig.net)).toBeCloseTo(3093.61, 2);
  });

  it("does NOT change split orders where every fill clears the floor (ARD case)", () => {
    // 3@439 + 3@438.9: each fill's 1% (~13.17) already exceeds the 10 floor,
    // so no per-order adjustment; fees identical to per-fill.
    const rows = annotateOrderCourtage(
      [
        {
          date: "2026-09-02",
          ticker: "ARD",
          action: "BUY",
          qty: 3,
          price: 439,
          pea: true,
          broker: "attijari",
        },
        {
          date: "2026-09-02",
          ticker: "ARD",
          action: "BUY",
          qty: 3,
          price: 438.9,
          pea: true,
          broker: "attijari",
        },
      ].map((t) => ({ ...t })),
      CTX_PEA,
    );
    rows.forEach((r) => expect(r._courtageOverride).toBeUndefined());
    const fees = rows.map((r) => computeRow(r, 0, CTX_PEA).fees);
    expect(fees[0]).toBeCloseTo(18.83, 2);
    expect(fees[1]).toBeCloseTo(18.83, 2);
  });

  it("does NOT merge separate purchases months apart", () => {
    // Two genuinely separate orders (>3 days apart) must stay independent even
    // for the same ticker/account, so neither gets an override.
    const rows = annotateOrderCourtage(
      [
        {
          date: "2026-01-10",
          ticker: "ATW",
          action: "BUY",
          qty: 1,
          price: 700,
          pea: true,
          broker: "attijari",
        },
        {
          date: "2026-06-20",
          ticker: "ATW",
          action: "BUY",
          qty: 1,
          price: 720,
          pea: true,
          broker: "attijari",
        },
      ].map((t) => ({ ...t })),
      CTX_PEA,
    );
    rows.forEach((r) => expect(r._courtageOverride).toBeUndefined());
  });

  it("groups by explicit _ord id regardless of dates", () => {
    // A shared _ord id links fills even across a wide date gap (future fills).
    const rows = annotateOrderCourtage(
      [
        {
          date: "2026-09-01",
          ticker: "ZDJ",
          action: "BUY",
          qty: 2,
          price: 305,
          pea: true,
          broker: "attijari",
          _ord: "oX",
        },
        {
          date: "2026-09-20",
          ticker: "ZDJ",
          action: "BUY",
          qty: 8,
          price: 305,
          pea: true,
          broker: "attijari",
          _ord: "oX",
        },
      ].map((t) => ({ ...t })),
      CTX_PEA,
    );
    const small = rows.find((r) => r.qty === 2);
    expect(small._courtageOverride).toBeCloseTo(10.0, 2);
  });
});
