// Coverage + behaviour tests for the MASTER-LIST import schema.
//
// Safety net for the "added a metric to the TradingView parser but forgot the
// apply-copy line" bug: applyTvRec is driven by TV_METRICS, so every metric the
// parser can emit is copied onto M[tk]. These tests assert coverage, the
// null/NaN guard, the cat || logic, and the OPCVM weekly/daily fee gating.
import { describe, it, expect } from "vitest";
import {
  TV_METRICS,
  OPCVM_FIELDS,
  applyTvRec,
  applyOpcvmFund,
  tvMetricKeys,
} from "../src/core/master-schema.js";

describe("TV metric schema: coverage", () => {
  it("metric keys are unique", () => {
    const keys = TV_METRICS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every metric the parser emits is applied (no silent drop)", () => {
    // A rec carrying a value for EVERY schema key must land all of them on M.
    const rec = {};
    tvMetricKeys().forEach((k, i) => (rec[k] = i + 1)); // distinct non-null numbers
    const M = { ATW: { name: "Attijariwafa", cat: "Banks" } };
    const written = applyTvRec(M, "ATW", rec);
    expect(written).toBe(TV_METRICS.length);
    for (const f of TV_METRICS) {
      const store = f.store || f.key;
      expect(M.ATW[store], `metric ${f.key} not applied`).toBeDefined();
    }
  });
});

describe("applyTvRec: guards & category", () => {
  it("skips null and NaN values", () => {
    const M = { ATW: { cat: "Banks" } };
    applyTvRec(M, "ATW", { price: 680, pe: null, pb: NaN, roe: 0.15 });
    expect(M.ATW.price).toBe(680);
    expect(M.ATW.roe).toBe(0.15);
    expect("pe" in M.ATW).toBe(false);
    expect("pb" in M.ATW).toBe(false);
  });

  it("does not overwrite an existing category, but fills a missing one", () => {
    const M = { A: { cat: "Banks" }, B: {} };
    applyTvRec(M, "A", { price: 1, category: "Telecom" });
    applyTvRec(M, "B", { price: 1, category: "Telecom" });
    expect(M.A.cat).toBe("Banks"); // kept
    expect(M.B.cat).toBe("Telecom"); // filled
  });

  it("scaled fields are stored as-is (parser pre-scales to decimals)", () => {
    // The parser divides %-fields by 100 before calling apply, so apply copies
    // the decimal verbatim. Confirm the schema marks which fields are pre-scaled.
    const scaled = TV_METRICS.filter((f) => f.scaledInParser).map((f) => f.key);
    expect(scaled.sort()).toEqual(["divy", "epsGrowth", "roe"].sort());
    const M = { X: {} };
    applyTvRec(M, "X", { divy: 0.0131, roe: 0.15, epsGrowth: 0.757 });
    expect(M.X.divy).toBeCloseTo(0.0131, 6);
    expect(M.X.roe).toBeCloseTo(0.15, 6);
    expect(M.X.epsGrowth).toBeCloseTo(0.757, 6);
  });

  it("no-op when the ticker is not in the master list", () => {
    const M = {};
    expect(applyTvRec(M, "GHOST", { price: 100 })).toBe(0);
    expect(M.GHOST).toBeUndefined();
  });
});

describe("applyOpcvmFund: price/isin/fee gating", () => {
  it("weekly file writes fees; price + isin always", () => {
    const M = { FCP: { cat: "OPCVM" } };
    const res = applyOpcvmFund(
      M,
      "FCP",
      { vl: 831.8, isin: "MA000123", buyFee: 0.01, sellFee: 0.005, mgmt: 0.015 },
      true,
    );
    expect(M.FCP.price).toBe(831.8);
    expect(M.FCP.isin).toBe("MA000123");
    expect(M.FCP.buyFee).toBe(0.01);
    expect(M.FCP.sellFee).toBe(0.005);
    expect(M.FCP.mgmt).toBe(0.015);
    expect(res.priceUpdated).toBe(true);
    expect(res.feeUpdated).toBe(true);
  });

  it("daily file updates price/isin but NEVER overwrites stored fees", () => {
    const M = { FCP: { cat: "OPCVM", buyFee: 0.02, sellFee: 0.01, mgmt: 0.02 } };
    const res = applyOpcvmFund(
      M,
      "FCP",
      { vl: 900, isin: "MA000123", buyFee: 0.01, sellFee: 0.005, mgmt: 0.015 },
      false,
    );
    expect(M.FCP.price).toBe(900); // updated
    expect(M.FCP.isin).toBe("MA000123"); // updated
    expect(M.FCP.buyFee).toBe(0.02); // preserved
    expect(M.FCP.sellFee).toBe(0.01); // preserved
    expect(M.FCP.mgmt).toBe(0.02); // preserved
    expect(res.feeUpdated).toBe(false);
  });

  it("isin is written even when null (matches original always-set behaviour)", () => {
    const M = { FCP: { cat: "OPCVM", isin: "OLD" } };
    applyOpcvmFund(M, "FCP", { vl: null, isin: null }, false);
    expect(M.FCP.isin).toBe(null);
    expect(M.FCP.price).toBeUndefined(); // vl null -> price not set
  });

  it("OPCVM field store keys are unique", () => {
    const stores = OPCVM_FIELDS.map((f) => f.store);
    expect(new Set(stores).size).toBe(stores.length);
  });
});
