// Locks the meaning + units of every TradingView metric the app ingests, on
// BOTH paths: the daily CI fetch (scripts/fetch-prices.mjs -> prices.json) and
// the manual screener paste (js/06k-price-import.js). Each assertion here maps
// to a real mismatch found in an audit against the live scanner:
//   - low/high were ALL-TIME extremes (Low.All/High.All), not 52-week
//   - netdebt was GROSS debt/EBITDA under a "net debt" label
//   - pb used fiscal-year book while bvps used latest-quarter book
//   - revenue was fiscal-year under a "TTM" label
//   - the paste parser read "47.70 B" as 47.7
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { COLUMNS, toRecords } from "../scripts/fetch-prices.mjs";

// Build a scanner payload row from {tvField: value}; missing fields -> null.
const row = (sym, fields) => ({
  s: "CSEMA:" + sym,
  d: COLUMNS.map((c) => (c === "name" ? sym : (fields[c] ?? null))),
});
const one = (fields, sym = "AAA") =>
  toRecords({ data: [row(sym, { close: 100, ...fields })] })[0];

describe("fetch-prices: field mapping", () => {
  it("requests 52-week low/high, never the all-time Low.All/High.All", () => {
    expect(COLUMNS).toContain("price_52_week_low");
    expect(COLUMNS).toContain("price_52_week_high");
    expect(COLUMNS).not.toContain("Low.All");
    expect(COLUMNS).not.toContain("High.All");
    const r = one({ price_52_week_low: 80, price_52_week_high: 120 });
    expect(r.low).toBe(80);
    expect(r.high).toBe(120);
  });

  it("derives NET debt / EBITDA from net_debt and ebitda (not the gross ratio)", () => {
    expect(COLUMNS).not.toContain("total_debt_to_ebitda_fq");
    expect(one({ net_debt: 300, ebitda: 200 }).netdebt).toBeCloseTo(1.5, 10);
  });

  it("keeps net cash as a negative multiple", () => {
    expect(one({ net_debt: -50, ebitda: 100 }).netdebt).toBeCloseTo(-0.5, 10);
  });

  it("omits netdebt when EBITDA is zero/negative or an input is missing", () => {
    expect(one({ net_debt: 300, ebitda: 0 }).netdebt).toBeUndefined();
    expect(one({ net_debt: 300, ebitda: -10 }).netdebt).toBeUndefined();
    expect(one({ net_debt: 300 }).netdebt).toBeUndefined();
    expect(one({ ebitda: 100 }).netdebt).toBeUndefined();
  });

  it("takes P/B on latest-quarter book (consistent with bvps), falling back to FY", () => {
    expect(one({ price_book_fq: 2.38, price_book_ratio: 0.49 }).pb).toBe(2.38);
    expect(one({ price_book_ratio: 0.49 }).pb).toBe(0.49);
  });

  it("takes TTM revenue (matches the 'Revenue (TTM)' label), falling back to FY", () => {
    expect(
      one({ total_revenue_ttm: 48.8e9, total_revenue: 47.7e9 }).revenue,
    ).toBe(48.8e9);
    expect(one({ total_revenue: 47.7e9 }).revenue).toBe(47.7e9);
  });

  it("stores divy / roe / epsGrowth as decimals and the rest raw", () => {
    const r = one({
      dividends_yield_current: 3.3,
      return_on_equity: 15.9,
      earnings_per_share_diluted_yoy_growth_ttm: -24.5,
      price_earnings_ttm: 12.58,
      enterprise_value_ebitda_ttm: 4.96,
    });
    expect(r.divy).toBeCloseTo(0.033, 10);
    expect(r.roe).toBeCloseTo(0.159, 10);
    expect(r.epsGrowth).toBeCloseTo(-0.245, 10);
    expect(r.pe).toBe(12.58);
    expect(r.ev).toBe(4.96);
  });

  it("maps the SOT listing to the SSOT master ticker and drops price-less rows", () => {
    expect(one({}, "SOT").ticker).toBe("SSOT");
    expect(
      toRecords({ data: [row("NOP", { price_earnings_ttm: 10 })] }),
    ).toHaveLength(0);
  });
});

// cleanNum lives in the shared-scope UI layer (not a module), so evaluate its
// source in isolation - it has no outbound dependencies.
const PASTE_SRC = readFileSync(
  new URL("../js/06k-price-import.js", import.meta.url),
  "utf8",
);
const cleanNum = (() => {
  const m = /function cleanNum\(s\) \{[\s\S]*?\n\}/.exec(PASTE_SRC);
  if (!m) throw new Error("cleanNum not found in 06k-price-import.js");
  return new Function(m[0] + "\nreturn cleanNum;")();
})();

describe("manual paste: number parsing + field parity", () => {
  it("expands TradingView K/M/B/T abbreviations", () => {
    expect(cleanNum("47.70 B")).toBeCloseTo(47.7e9, 0);
    expect(cleanNum("850.2 M MAD")).toBeCloseTo(850.2e6, 0);
    expect(cleanNum("12K")).toBe(12000);
    expect(cleanNum("1.5T")).toBeCloseTo(1.5e12, 0);
    expect(cleanNum("\u22123.2 B")).toBeCloseTo(-3.2e9, 0); // unicode minus
  });

  it("still parses plain prices, percents and thousands separators", () => {
    expect(cleanNum("668.30 MAD")).toBe(668.3);
    expect(cleanNum("+75.70%")).toBe(75.7);
    expect(cleanNum("1,260")).toBe(1260);
    expect(cleanNum("22,00")).toBe(22);
    expect(cleanNum("Buy")).toBeNull();
    expect(cleanNum("")).toBeNull();
  });

  it("never writes the screener's GROSS Debt/EBITDA column into netdebt", () => {
    expect(/rec\.netdebt\s*=/.test(PASTE_SRC)).toBe(false);
  });
});
