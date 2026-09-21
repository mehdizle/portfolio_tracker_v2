// Tests for the portfolio value-history recompute (src/core/value-history.js):
// holdings-as-of-date, the value curve, benchmark normalization, and
// carry-forward for missing daily quotes.
import { describe, it, expect } from "vitest";
import {
  holdingsAsOf,
  firstTxnDate,
  buildValueSeries,
  valueVsBenchmark,
  closeOnOrBefore,
  latestClose,
} from "../src/core/value-history.js";

const tx = (date, ticker, action, qty) => ({ date, ticker, action, qty });

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

  it("rebases portfolio and both indices to 0% at the first point", () => {
    const r = valueVsBenchmark(txns, h);
    expect(r.valuePct[0].pct).toBeCloseTo(0, 6);
    expect(r.masiPct[0].pct).toBeCloseTo(0, 6);
    expect(r.msi20Pct[0].pct).toBeCloseTo(0, 6);
  });

  it("computes the right %-returns on the second point", () => {
    const r = valueVsBenchmark(txns, h);
    expect(r.valuePct[1].pct).toBeCloseTo(20, 4); // 100 -> 120
    expect(r.masiPct[1].pct).toBeCloseTo(10, 4); // 10000 -> 11000
    expect(r.msi20Pct[1].pct).toBeCloseTo(5, 4); // 1000 -> 1050
  });

  it("returns null pct where an index level is missing", () => {
    const h2 = hist([
      row("2026-01-02", { ATW: 100 }, null, 1000),
      row("2026-01-03", { ATW: 120 }, null, 1050),
    ]);
    const r = valueVsBenchmark(txns, h2);
    expect(r.masiPct[0].pct).toBe(null);
    expect(r.msi20Pct[1].pct).toBeCloseTo(5, 4);
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
