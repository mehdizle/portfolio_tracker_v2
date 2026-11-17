// New-ticker (IPO) onboarding + data-completeness rules (src/core/master-schema.js).
// The UI (js/06n-data-health.js) only decides WHICH tickers to run these on;
// the record-shaping and the "is this complete?" rules are pure and live here.
import { describe, it, expect } from "vitest";
import {
  applyTvRec,
  onboardTvRec,
  fillTvGaps,
  stockDataIssues,
} from "../src/core/master-schema.js";

// A prices.json record like the one CI wrote for NRJ on its first days.
const IPO_REC = { ticker: "NRJ", price: 171.55, company: "JET ENERGY" };

describe("onboardTvRec", () => {
  it("creates a missing record: company name, uncategorized, price applied", () => {
    const M = {};
    expect(onboardTvRec(M, "NRJ", IPO_REC)).toBe(true);
    expect(M.NRJ).toMatchObject({
      name: "JET ENERGY",
      cat: null,
      cycle: null,
      style: null,
      price: 171.55,
    });
  });

  it("falls back to the ticker as the name and keeps the TradingView sector as a hint only", () => {
    const M = {};
    onboardTvRec(M, "XYZ", { price: 10, tvSector: "Utilities" });
    expect(M.XYZ.name).toBe("XYZ");
    expect(M.XYZ.tvSector).toBe("Utilities");
    expect(M.XYZ.cat).toBeNull(); // never auto-categorized
  });

  it("never touches an existing record's categories or name", () => {
    const M = {
      ATW: {
        name: "Attijariwafa",
        cat: "Banking",
        cycle: "Cyclical",
        style: "Value",
        price: 600,
      },
    };
    expect(
      onboardTvRec(M, "ATW", {
        price: 668.3,
        company: "ATTIJARIWAFA BANK",
        tvSector: "Finance",
      }),
    ).toBe(false);
    expect(M.ATW).toMatchObject({
      name: "Attijariwafa",
      cat: "Banking",
      cycle: "Cyclical",
      style: "Value",
      price: 668.3,
    });
  });

  it("replaces a trade-price stand-in from the add form with the market price", () => {
    const M = { NRJ: { name: "Jet", cat: null, price: 165, _seedPrice: true } };
    onboardTvRec(M, "NRJ", IPO_REC);
    expect(M.NRJ.price).toBe(171.55);
    expect(M.NRJ._seedPrice).toBeUndefined();
    expect(M.NRJ.name).toBe("Jet"); // the name you typed wins
  });

  it("keeps the stand-in flag when the feed record has no price", () => {
    const M = { NRJ: { price: 165, _seedPrice: true } };
    onboardTvRec(M, "NRJ", { ticker: "NRJ", pe: 12 });
    expect(M.NRJ._seedPrice).toBe(true);
    expect(M.NRJ.price).toBe(165);
  });
});

describe("applyTvRec: stand-in price + clearable fields", () => {
  it("any real price (e.g. a manual paste) clears the trade-price stand-in", () => {
    const M = { XYZ: { price: 100, _seedPrice: true } };
    applyTvRec(M, "XYZ", { ticker: "XYZ", price: 104 });
    expect(M.XYZ.price).toBe(104);
    expect(M.XYZ._seedPrice).toBeUndefined();
  });

  it("an explicit null netdebt removes a stale stored value; an absent one keeps it", () => {
    const M = { A: { netdebt: 8.4 }, B: { netdebt: 2.1 } };
    applyTvRec(M, "A", { ticker: "A", price: 1, netdebt: null });
    applyTvRec(M, "B", { ticker: "B", price: 1 });
    expect("netdebt" in M.A).toBe(false);
    expect(M.B.netdebt).toBe(2.1);
  });

  it("explicit nulls never clear non-clearable metrics", () => {
    const M = { A: { pe: 12 } };
    applyTvRec(M, "A", { ticker: "A", pe: null });
    expect(M.A.pe).toBe(12);
  });
});

describe("fillTvGaps (automatic, fill-only refresh)", () => {
  it("fills only missing fields and never overwrites existing values", () => {
    const M = { NRJ: { price: 160, low: null } };
    const n = fillTvGaps(M, "NRJ", {
      price: 171.55,
      low: 150,
      high: 190,
      pe: 14,
    });
    expect(n).toBe(3);
    expect(M.NRJ).toMatchObject({ price: 160, low: 150, high: 190, pe: 14 });
  });

  it("fills the FCF period tag only together with FCF", () => {
    const M = { A: { fcf: 2 }, B: {} };
    fillTvGaps(M, "A", { fcf: 5, fcfFy: 1 });
    expect(M.A.fcf).toBe(2);
    expect(M.A.fcfFy).toBeUndefined(); // stored fcf's period unknown -> no stale tag
    fillTvGaps(M, "B", { fcf: 5, fcfFy: 1 });
    expect(M.B).toMatchObject({ fcf: 5, fcfFy: 1 });
  });

  it("is a no-op for a missing record", () => {
    expect(fillTvGaps({}, "NOPE", { price: 1 })).toBe(0);
  });
});

describe("stockDataIssues", () => {
  const complete = {
    name: "Attijariwafa",
    cat: "Banking",
    cycle: "Cyclical",
    style: "Value",
    price: 668.3,
    low: 661,
    high: 780,
    pe: 12.6,
  };

  it("reports nothing for a complete record that is in the feed", () => {
    expect(stockDataIssues(complete, true)).toEqual([]);
  });

  it("lists every gap of a freshly onboarded IPO", () => {
    const M = {};
    onboardTvRec(M, "NRJ", IPO_REC);
    expect(stockDataIssues(M.NRJ, true)).toEqual([
      "noCategory",
      "noCycle",
      "noStyle",
      "noRange",
      "noFundamentals",
    ]);
  });

  it("flags no record, no price, a trade-price stand-in and absence from the feed", () => {
    expect(stockDataIssues(undefined)).toEqual(["noRecord"]);
    expect(stockDataIssues({ ...complete, price: null })).toContain("noPrice");
    expect(stockDataIssues({ ...complete, _seedPrice: true })).toContain(
      "seedPrice",
    );
    expect(stockDataIssues(complete, false)).toEqual(["notInFeed"]);
    expect(stockDataIssues(complete)).toEqual([]); // feed unknown -> not judged
  });

  it("treats the legacy 'STOCK' placeholder as uncategorized", () => {
    expect(stockDataIssues({ ...complete, cat: "STOCK" })).toEqual([
      "noCategory",
    ]);
  });
});
