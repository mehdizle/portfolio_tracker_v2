// Tests for the portfolio value-history recompute (src/core/value-history.js):
// holdings-as-of-date, the value curve, benchmark normalization, and
// carry-forward for missing daily quotes.
import { describe, it, expect } from "vitest";
import {
  holdingsAsOf,
  costBasisAsOf,
  firstTxnDate,
  buildValueSeries,
  valueVsBenchmark,
  closeOnOrBefore,
  latestClose,
} from "../src/core/value-history.js";

const tx = (date, ticker, action, qty) => ({ date, ticker, action, qty });
// price-aware tx (for cost-basis tests)
const txp = (date, ticker, action, qty, price) => ({
  date,
  ticker,
  action,
  qty,
  price,
});

// A little price history helper.
const hist = (rows) => ({ _kind: "casa_price_history", rows });
const row = (date, closes, masi, msi20) => ({ date, masi, msi20, closes });

describe("holdingsAsOf", () => {
  const txns = [
    tx("2026-01-05", "ATW", "BUY", 10),
    tx("2026-02-10", "ATW", "BUY", 5),
    tx("2026-03-01", "ATW", "SELL", 4),
    tx("2026-02-15", "IAM", "BUY", 20),
    tx("2026-02-20", "IAM", "DIV", 20), // DIV must NOT change share count
  ];

  it("sums BUY minus SELL up to and including the date", () => {
    expect(holdingsAsOf(txns, "2026-01-05")).toEqual({ ATW: 10 });
    expect(holdingsAsOf(txns, "2026-02-14")).toEqual({ ATW: 15 });
    expect(holdingsAsOf(txns, "2026-03-01")).toEqual({ ATW: 11, IAM: 20 });
  });

  it("ignores DIV (dividends don't change holdings)", () => {
    expect(holdingsAsOf(txns, "2026-02-28").IAM).toBe(20);
  });

  it("excludes future transactions", () => {
    expect(holdingsAsOf(txns, "2026-01-01")).toEqual({});
  });

  it("drops fully-sold positions", () => {
    const t = [
      tx("2026-01-01", "X", "BUY", 5),
      tx("2026-02-01", "X", "SELL", 5),
    ];
    expect(holdingsAsOf(t, "2026-02-01")).toEqual({});
  });
});

describe("firstTxnDate", () => {
  it("returns the earliest date", () => {
    expect(
      firstTxnDate([
        tx("2026-03-01", "A", "BUY", 1),
        tx("2026-01-09", "B", "BUY", 1),
      ]),
    ).toBe("2026-01-09");
  });
  it("null when empty", () => {
    expect(firstTxnDate([])).toBe(null);
  });
});

describe("buildValueSeries", () => {
  const txns = [tx("2026-01-02", "ATW", "BUY", 10)];

  it("computes daily value = held * close", () => {
    const h = hist([
      row("2026-01-02", { ATW: 100 }, 10000, 1000),
      row("2026-01-03", { ATW: 110 }, 10100, 1010),
    ]);
    const s = buildValueSeries(txns, h);
    expect(s.points).toHaveLength(2);
    expect(s.points[0].value).toBe(1000); // 10 * 100
    expect(s.points[1].value).toBe(1100); // 10 * 110
  });

  it("skips dates before the first transaction (empty portfolio)", () => {
    const h = hist([
      row("2026-01-01", { ATW: 90 }, 9000, 900), // before the buy
      row("2026-01-02", { ATW: 100 }, 10000, 1000),
    ]);
    const s = buildValueSeries(txns, h);
    expect(s.points).toHaveLength(1);
    expect(s.first).toBe("2026-01-02");
  });

  it("carries the last known close forward when a day has no quote", () => {
    const h = hist([
      row("2026-01-02", { ATW: 100 }, 10000, 1000),
      row("2026-01-03", {}, 10100, 1010), // ATW didn't trade -> carry 100
    ]);
    const s = buildValueSeries(txns, h);
    expect(s.points[1].value).toBe(1000); // still 10 * 100 (carried)
  });

  it("reflects a mid-series buy from its date forward", () => {
    const t = [
      tx("2026-01-02", "ATW", "BUY", 10),
      tx("2026-01-03", "IAM", "BUY", 5),
    ];
    const h = hist([
      row("2026-01-02", { ATW: 100, IAM: 50 }, 1, 1),
      row("2026-01-03", { ATW: 100, IAM: 50 }, 1, 1),
    ]);
    const s = buildValueSeries(t, h);
    expect(s.points[0].value).toBe(1000); // only ATW held
    expect(s.points[1].value).toBe(1250); // ATW 1000 + IAM 250
  });
});

describe("valueVsBenchmark (rebased %)", () => {
  const txns = [tx("2026-01-02", "ATW", "BUY", 10)];
  const h = hist([
    row("2026-01-02", { ATW: 100 }, 10000, 1000),
    row("2026-01-03", { ATW: 120 }, 11000, 1050),
  ]);

  // Bought 10 ATW @ 100 (cost 1000). Portfolio return is value/cost - 1.
  const txnsP = [txp("2026-01-02", "ATW", "BUY", 10, 100)];

  it("portfolio line is COST-BASIS return (value/cost - 1), not rebased value", () => {
    const r = valueVsBenchmark(txnsP, h);
    // day 1: value 1000, cost 1000 -> 0%
    expect(r.valuePct[0].pct).toBeCloseTo(0, 6);
    // day 2: value 1200, cost 1000 -> +20%
    expect(r.valuePct[1].pct).toBeCloseTo(20, 4);
  });

  it("cost-basis return is IMMUNE to adding capital (the +134% bug)", () => {
    // Buy 10 @ 100 day 1, then 10 MORE @ 120 day 2 (price unchanged at 120).
    // Old rebased-value logic would show a huge jump because market value
    // doubled; cost-basis return must stay flat (you just paid fair price).
    const t = [
      txp("2026-01-02", "ATW", "BUY", 10, 100),
      txp("2026-01-03", "ATW", "BUY", 10, 120),
    ];
    const h2 = hist([
      row("2026-01-02", { ATW: 100 }, 1, 1),
      row("2026-01-03", { ATW: 120 }, 1, 1),
    ]);
    const r = valueVsBenchmark(t, h2);
    // day 1: 10@100 -> value 1000, cost 1000 -> 0%
    expect(r.valuePct[0].pct).toBeCloseTo(0, 4);
    // day 2: hold 20, value 20*120=2400, cost 1000+1200=2200 -> +9.09% (the
    // gain on the FIRST lot only), NOT +140% from the capital injection.
    expect(r.valuePct[1].pct).toBeCloseTo((2400 / 2200 - 1) * 100, 4);
    expect(r.valuePct[1].pct).toBeLessThan(15); // sanity: no phantom jump
  });

  it("benchmark is shifted to meet the portfolio at the first point", () => {
    // Portfolio starts at 0% here (value==cost day 1), so the benchmark still
    // starts at 0% too, then tracks its own move.
    const r = valueVsBenchmark(txnsP, h);
    expect(r.masiPct[0].pct).toBeCloseTo(0, 6); // 0 (rebased) + 0 (anchor)
    expect(r.masiPct[1].pct).toBeCloseTo(10, 4); // 10000 -> 11000
    expect(r.msi20Pct[1].pct).toBeCloseTo(5, 4); // 1000 -> 1050
  });

  it("benchmark anchor lifts to the portfolio's starting return", () => {
    // Bought below market: day-1 value 1200 vs cost 1000 -> portfolio starts at
    // +20%. The benchmark should start at +20% too (shifted), then diverge.
    const t = [txp("2026-01-02", "ATW", "BUY", 10, 100)];
    const h2 = hist([
      row("2026-01-02", { ATW: 120 }, 10000, 1000),
      row("2026-01-03", { ATW: 120 }, 11000, 1050),
    ]);
    const r = valueVsBenchmark(t, h2);
    expect(r.valuePct[0].pct).toBeCloseTo(20, 4); // 1200/1000 - 1
    expect(r.masiPct[0].pct).toBeCloseTo(20, 4); // shifted to meet portfolio
    expect(r.masiPct[1].pct).toBeCloseTo(30, 4); // +20 anchor + 10 index move
  });

  it("returns null pct where an index level is missing", () => {
    const h2 = hist([
      row("2026-01-02", { ATW: 100 }, null, 1000),
      row("2026-01-03", { ATW: 120 }, null, 1050),
    ]);
    const r = valueVsBenchmark(txnsP, h2);
    expect(r.masiPct[0].pct).toBe(null);
    // msi20 present: day1 rebased 0 + anchor 0 = 0; day2 +5%.
    expect(r.msi20Pct[1].pct).toBeCloseTo(5, 4);
  });
});

describe("costBasisAsOf", () => {
  it("sums qty*price of held shares (gross of fees)", () => {
    const t = [
      txp("2026-01-02", "ATW", "BUY", 10, 100),
      txp("2026-02-02", "IAM", "BUY", 5, 50),
    ];
    expect(costBasisAsOf(t, "2026-02-02")).toBeCloseTo(1000 + 250, 6);
    expect(costBasisAsOf(t, "2026-01-15")).toBeCloseTo(1000, 6); // IAM not bought yet
  });

  it("removes sold shares at AVERAGE cost (no phantom gain/loss)", () => {
    const t = [
      txp("2026-01-02", "ATW", "BUY", 10, 100), // avg 100
      txp("2026-01-10", "ATW", "BUY", 10, 200), // avg now 150
      txp("2026-02-01", "ATW", "SELL", 10, 999), // sell 10 at avg 150 -> cost 1500 left
    ];
    // remaining 10 shares at avg cost 150 -> 1500 (sell PRICE 999 is irrelevant
    // to cost basis).
    expect(costBasisAsOf(t, "2026-02-01")).toBeCloseTo(1500, 6);
  });

  it("is zero once fully sold, and ignores DIV", () => {
    const t = [
      txp("2026-01-02", "ATW", "BUY", 10, 100),
      tx("2026-01-20", "ATW", "DIV", 10), // no cost effect
      txp("2026-02-01", "ATW", "SELL", 10, 130),
    ];
    expect(costBasisAsOf(t, "2026-02-01")).toBeCloseTo(0, 6);
  });
});

describe("closeOnOrBefore / latestClose (signal-outcome price lookups)", () => {
  const h = hist([
    row("2026-01-02", { ATW: 100, IAM: 50 }, 1, 1),
    row("2026-01-03", { ATW: 110 }, 1, 1), // IAM didn't trade
    row("2026-01-06", { ATW: 120, IAM: 55 }, 1, 1),
  ]);

  it("returns the close on the exact date when present", () => {
    expect(closeOnOrBefore(h, "ATW", "2026-01-03")).toBe(110);
  });

  it("carries forward the nearest earlier close when the date has no quote", () => {
    // IAM has no 2026-01-03 quote -> use its 2026-01-02 close (50).
    expect(closeOnOrBefore(h, "IAM", "2026-01-03")).toBe(50);
  });

  it("returns null before the ticker first appears", () => {
    expect(closeOnOrBefore(h, "ATW", "2026-01-01")).toBe(null);
    expect(closeOnOrBefore(h, "ZZZ", "2026-01-06")).toBe(null);
  });

  it("latestClose returns the most recent available close", () => {
    expect(latestClose(h, "ATW")).toBe(120);
    expect(latestClose(h, "IAM")).toBe(55);
    expect(latestClose(h, "ZZZ")).toBe(null);
  });

  it("is case-insensitive on ticker", () => {
    expect(closeOnOrBefore(h, "atw", "2026-01-02")).toBe(100);
    expect(latestClose(h, "iam")).toBe(55);
  });
});
