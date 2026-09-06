// Tests for the multi-year dividend forecast (reference estimate).
import { describe, it, expect } from "vitest";
import {
  buildForecast,
  forecastEvents,
  projectedCalendar,
} from "../src/core/dividend-forecast.js";

const ev = (ticker, year, amount, extra) => ({
  ticker,
  issuer: ticker + " Co",
  amount,
  ex_date: year + "-06-01",
  pay_date: year + "-06-15",
  div_type: "Ordinary",
  ...(extra || {}),
});

describe("buildForecast", () => {
  it("returns targetYear = refYear + 1", () => {
    const fc = buildForecast([ev("ATW", 2025, 20)], 2025);
    expect(fc.targetYear).toBe(2026);
  });

  it("uses flat method with a single year of history", () => {
    const fc = buildForecast([ev("ATW", 2025, 20)], 2025);
    const r = fc.rows.find((x) => x.ticker === "ATW");
    expect(r.method).toBe("flat");
    expect(r.projectedDps).toBe(20);
  });

  it("uses trend method across multiple complete years", () => {
    // Complete years 2024=20, 2025=22 -> +10%/yr, base=2025.
    // refYear=2026 (the in-progress year), so proj 2027 = 22*1.1 = 24.2.
    const fc = buildForecast([ev("ATW", 2024, 20), ev("ATW", 2025, 22)], 2026);
    const r = fc.rows.find((x) => x.ticker === "ATW");
    expect(r.method).toBe("trend");
    expect(r.baseYear).toBe(2025);
    expect(r.growth).toBeCloseTo(0.1, 5);
    expect(r.projectedDps).toBeCloseTo(24.2, 4);
  });

  it("excludes exceptional (one-off) dividends from the forecast", () => {
    const fc = buildForecast(
      [
        ev("ATW", 2025, 20),
        ev("ATW", 2025, 100, {
          div_type: "Exceptional",
          ex_date: "2025-11-01",
          pay_date: "2025-11-15",
        }),
      ],
      2025,
    );
    const r = fc.rows.find((x) => x.ticker === "ATW");
    // Only the ordinary 20 counts, not the 100 special.
    expect(r.byYear[2025]).toBe(20);
  });

  it("does not use the incomplete current year as the trend base", () => {
    // 2024=20, 2025=22 complete; 2026 (ref year) only 5 so far (partial).
    const fc = buildForecast(
      [ev("ATW", 2024, 20), ev("ATW", 2025, 22), ev("ATW", 2026, 5)],
      2026,
    );
    const r = fc.rows.find((x) => x.ticker === "ATW");
    expect(r.baseYear).toBe(2025); // not 2026
    expect(r.partialCurrentYear).toBe(5);
  });

  it("computes consistency over the trailing window", () => {
    // paid 2024 and 2025, not 2026 -> 2 of last 3.
    const fc = buildForecast([ev("ATW", 2024, 20), ev("ATW", 2025, 22)], 2026, {
      windowYears: 3,
    });
    const r = fc.rows.find((x) => x.ticker === "ATW");
    expect(r.yearsCounted).toBe(2);
    expect(r.consistency).toBeCloseTo(2 / 3, 2);
  });

  it("clamps extreme growth so thin data can't explode", () => {
    // 1 -> 10 would be +900%/yr; clamp to +50%. base=2025, refYear=2026.
    const fc = buildForecast([ev("ATW", 2024, 1), ev("ATW", 2025, 10)], 2026);
    const r = fc.rows.find((x) => x.ticker === "ATW");
    expect(r.growth).toBeCloseTo(0.5, 5);
    expect(r.projectedDps).toBeCloseTo(15, 4); // 10 * 1.5
  });

  it("infers expected pay month from history (modal month)", () => {
    const fc = buildForecast(
      [
        {
          ticker: "IAM",
          amount: 4,
          ex_date: "2024-09-04",
          pay_date: "2024-09-15",
          div_type: "Ordinary",
        },
        {
          ticker: "IAM",
          amount: 4,
          ex_date: "2025-09-04",
          pay_date: "2025-09-15",
          div_type: "Ordinary",
        },
      ],
      2025,
    );
    const r = fc.rows.find((x) => x.ticker === "IAM");
    expect(r.expectedMonth).toBe(9);
  });

  it("returns empty rows when there's no history", () => {
    const fc = buildForecast([], 2025);
    expect(fc.rows).toHaveLength(0);
    expect(fc.totalDps).toBe(0);
  });

  it("ignores synthetic _projected rows so it can't feed on itself", () => {
    const fc = buildForecast(
      [ev("ATW", 2025, 20), ev("ATW", 2026, 21, { _projected: true })],
      2025,
    );
    const r = fc.rows.find((x) => x.ticker === "ATW");
    expect(r.years).toEqual([2025]);
  });
});

describe("forecastEvents", () => {
  it("emits DIVCAL-shaped events tagged _forecast for the target year", () => {
    const fc = buildForecast([ev("ATW", 2024, 20), ev("ATW", 2025, 22)], 2025);
    const evs = forecastEvents(fc);
    expect(evs.length).toBe(1);
    expect(evs[0].ticker).toBe("ATW");
    expect(evs[0]._forecast).toBe(true);
    expect(evs[0].pay_date.startsWith("2026-")).toBe(true);
    expect(evs[0].div_type).toBe("Ordinary");
  });

  it("skips tickers with no positive projection", () => {
    const fc = {
      targetYear: 2026,
      rows: [{ ticker: "X", projectedDps: 0, expectedMonth: 6 }],
    };
    expect(forecastEvents(fc)).toHaveLength(0);
  });
});

describe("projectedCalendar", () => {
  it("fills the current year when a past-paying ticker hasn't announced it yet", () => {
    // ATW paid 2024 & 2025, nothing announced for 2026 (refYear).
    const cal = [ev("ATW", 2024, 20), ev("ATW", 2025, 22)];
    const out = projectedCalendar(cal, 2026);
    const cur = out.filter((d) => d._forecastYear === 2026);
    expect(cur.length).toBe(1);
    expect(cur[0].ticker).toBe("ATW");
    expect(cur[0]._forecast).toBe(true);
    expect(cur[0].pay_date.startsWith("2026-")).toBe(true);
  });

  it("does NOT fill the current year when a real event already exists", () => {
    const cal = [ev("ATW", 2024, 20), ev("ATW", 2025, 22), ev("ATW", 2026, 23)];
    const out = projectedCalendar(cal, 2026);
    const cur = out.filter((d) => d._forecastYear === 2026);
    expect(cur.length).toBe(0); // 2026 already announced -> real wins
  });

  it("also projects next year", () => {
    const cal = [ev("ATW", 2024, 20), ev("ATW", 2025, 22)];
    const out = projectedCalendar(cal, 2026);
    const nxt = out.filter((d) => d._forecastYear === 2027);
    expect(nxt.length).toBe(1);
    expect(nxt[0].pay_date.startsWith("2027-")).toBe(true);
  });

  it("skips next year too when it's already announced", () => {
    const cal = [ev("ATW", 2024, 20), ev("ATW", 2025, 22), ev("ATW", 2027, 25)];
    const out = projectedCalendar(cal, 2026);
    const nxt = out.filter((d) => d._forecastYear === 2027);
    expect(nxt.length).toBe(0);
  });

  it("never synthesizes for a ticker with no history", () => {
    expect(projectedCalendar([], 2026)).toHaveLength(0);
  });
});

describe("multiple payments per year (slots)", () => {
  const evm = (tk, y, amt, mo) => ({
    ticker: tk,
    issuer: tk + " Co",
    amount: amt,
    ex_date: `${y}-${String(mo).padStart(2, "0")}-01`,
    pay_date: `${y}-${String(mo).padStart(2, "0")}-15`,
    div_type: "Ordinary",
  });

  it("detects two recurring slots for a twice-a-year payer", () => {
    const cal = [
      evm("BCP", 2024, 5, 6),
      evm("BCP", 2024, 7, 12),
      evm("BCP", 2025, 6, 6),
      evm("BCP", 2025, 8, 12),
    ];
    const fc = buildForecast(cal, 2026);
    const r = fc.rows.find((x) => x.ticker === "BCP");
    expect(r.slots.length).toBe(2);
    expect(r.paymentsPerYear).toBe(2);
  });

  it("projects each slot separately and sums them for annual DPS", () => {
    const cal = [
      evm("BCP", 2024, 5, 6),
      evm("BCP", 2024, 7, 12),
      evm("BCP", 2025, 6, 6),
      evm("BCP", 2025, 8, 12),
    ];
    const fc = buildForecast(cal, 2026);
    const r = fc.rows.find((x) => x.ticker === "BCP");
    // June: 5->6 (+20%) => 7.2 ; Dec: 7->8 => 8*(8/7) ~= 9.142857
    const expected = 6 * 1.2 + 8 * (8 / 7);
    expect(r.projectedDps).toBeCloseTo(expected, 2);
  });

  it("emits one forecast event per slot for next year, months preserved", () => {
    const cal = [
      evm("BCP", 2024, 5, 6),
      evm("BCP", 2024, 7, 12),
      evm("BCP", 2025, 6, 6),
      evm("BCP", 2025, 8, 12),
    ];
    const nxt = projectedCalendar(cal, 2026).filter(
      (d) => d._forecastYear === 2027,
    );
    expect(nxt.length).toBe(2);
    const months = nxt
      .map((d) => +d.pay_date.slice(5, 7))
      .sort((a, b) => a - b);
    expect(months).toEqual([6, 12]);
  });

  it("current-year gap-fill only fills the slot that isn't announced yet", () => {
    const cal = [
      evm("BCP", 2024, 5, 6),
      evm("BCP", 2024, 7, 12),
      evm("BCP", 2025, 6, 6),
      evm("BCP", 2025, 8, 12),
      evm("BCP", 2026, 6, 6), // June 2026 announced; December not
    ];
    const cur = projectedCalendar(cal, 2026).filter(
      (d) => d._forecastYear === 2026,
    );
    expect(cur.length).toBe(1);
    expect(+cur[0].pay_date.slice(5, 7)).toBe(12);
  });
});
