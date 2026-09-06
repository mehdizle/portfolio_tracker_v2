// Tests for the multi-year dividend forecast (reference estimate).
import { describe, it, expect } from "vitest";
import {
  buildForecast,
  forecastEvents,
  projectedCalendar,
  splitInconsistency,
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

  it("uses a level + gentle trend across multiple years", () => {
    // 2024=20, 2025=22. Level = avg(20,22) = 21. Trend = +10%/yr (at the cap).
    // Projection = 21 * 1.10 = 23.1 (NOT a raw 22*1.1 extrapolation).
    const fc = buildForecast([ev("ATW", 2024, 20), ev("ATW", 2025, 22)], 2026);
    const r = fc.rows.find((x) => x.ticker === "ATW");
    expect(r.method).toBe("trend");
    expect(r.slots).toHaveLength(1);
    expect(r.slots[0].level).toBeCloseTo(21, 4);
    expect(r.slots[0].growth).toBeCloseTo(0.1, 5);
    expect(r.projectedDps).toBeCloseTo(23.1, 4);
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

  it("includes the current year as the freshest data point", () => {
    // 2024=20, 2025=22, 2026=24. The current year IS the most recent signal and
    // must be used (not discarded). Level = avg(20,22,24) = 22, base = 2026.
    const fc = buildForecast(
      [ev("ATW", 2024, 20), ev("ATW", 2025, 22), ev("ATW", 2026, 24)],
      2026,
    );
    const r = fc.rows.find((x) => x.ticker === "ATW");
    expect(r.baseYear).toBe(2026);
    expect(r.baseDps).toBe(24);
    expect(r.slots[0].level).toBeCloseTo(22, 4);
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

  it("clamps the trend so thin/noisy data can't explode", () => {
    // 1 -> 10 would be +900%/yr; clamped to +10%. Level = avg(1,10) = 5.5,
    // so projection = 5.5 * 1.10 = 6.05 (not a runaway 15).
    const fc = buildForecast([ev("ATW", 2024, 1), ev("ATW", 2025, 10)], 2026);
    const r = fc.rows.find((x) => x.ticker === "ATW");
    expect(r.slots[0].growth).toBeCloseTo(0.1, 5);
    expect(r.slots[0].level).toBeCloseTo(5.5, 4);
    expect(r.projectedDps).toBeCloseTo(6.05, 4);
  });

  it("does not overshoot on a spike-then-revert pattern (TMA regression)", () => {
    // Real case: 56 -> 113 -> 89.57. The old geometric method projected ~169.5.
    // Level+gentle-trend keeps it near the recent level (~94.8), not 169.
    const fc = buildForecast(
      [ev("TMA", 2024, 56), ev("TMA", 2025, 113), ev("TMA", 2026, 89.57)],
      2026,
    );
    const r = fc.rows.find((x) => x.ticker === "TMA");
    expect(r.projectedDps).toBeGreaterThan(85);
    expect(r.projectedDps).toBeLessThan(100);
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
    // June slot 5,6: level 5.5, trend +20%->cap +10% => 5.5*1.1 = 6.05
    // Dec  slot 7,8: level 7.5, trend +14%->cap +10% => 7.5*1.1 = 8.25
    const expected = 5.5 * 1.1 + 7.5 * 1.1; // = 14.30
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

describe("quarterly / 4x-a-year payer (ordinal slots)", () => {
  const evm = (tk, y, amt, mo) => ({
    ticker: tk,
    issuer: tk + " Co",
    amount: amt,
    ex_date: `${y}-${String(mo).padStart(2, "0")}-01`,
    pay_date: `${y}-${String(mo).padStart(2, "0")}-15`,
    div_type: "Ordinary",
  });
  // A REIT paying 4x a year (Apr, Jun, Sep/Oct, Dec) - months that would
  // WRONGLY collapse under a proximity-merge model. Ordinal slots keep them 4.
  const hist = [
    evm("IMO", 2024, 1, 4),
    evm("IMO", 2024, 2.2, 6),
    evm("IMO", 2024, 1, 9),
    evm("IMO", 2024, 1, 12),
    evm("IMO", 2025, 1, 4),
    evm("IMO", 2025, 2.2, 6),
    evm("IMO", 2025, 1, 10),
    evm("IMO", 2025, 1, 12),
  ];

  it("keeps four distinct slots (does not collapse nearby months)", () => {
    const fc = buildForecast(hist, 2026);
    const r = fc.rows.find((x) => x.ticker === "IMO");
    expect(r.slots.length).toBe(4);
    expect(r.paymentsPerYear).toBe(4);
    expect(r.projectedDps).toBeCloseTo(5.2, 4); // 1 + 2.2 + 1 + 1
  });

  it("projects all four payments for next year at their own months", () => {
    const nxt = projectedCalendar(hist, 2026).filter(
      (d) => d._forecastYear === 2027,
    );
    expect(nxt.length).toBe(4);
  });

  it("does NOT re-forecast current-year months that already passed", () => {
    // Today = September (month 9). Apr & Jun already gone and not announced for
    // 2026 -> must NOT be injected as upcoming. Only Oct & Dec remain.
    const cur = projectedCalendar(hist, 2026, { currentMonth: 9 }).filter(
      (d) => d._forecastYear === 2026,
    );
    const months = cur
      .map((d) => +d.pay_date.slice(5, 7))
      .sort((a, b) => a - b);
    expect(months).toEqual([10, 12]);
  });

  it("treats a recorded DIV payment as real (never re-forecasts it)", () => {
    // Dec 2026 already received (in the transaction ledger, not the calendar).
    const cur = projectedCalendar(hist, 2026, {
      currentMonth: 9,
      recorded: [{ ticker: "IMO", year: 2026, month: 12 }],
    }).filter((d) => d._forecastYear === 2026);
    const months = cur
      .map((d) => +d.pay_date.slice(5, 7))
      .sort((a, b) => a - b);
    expect(months).toEqual([10]); // Dec suppressed by the recorded payment
  });
});

describe("splitInconsistency", () => {
  const row = (tk, y, amt, typ, mo = 6) => ({
    ticker: tk,
    amount: amt,
    ex_date: `${y}-${String(mo).padStart(2, "0")}-01`,
    pay_date: `${y}-${String(mo).padStart(2, "0")}-15`,
    div_type: typ,
  });

  it("flags a ticker split into Ord+Exc some years, single Ord others (SLF)", () => {
    const cal = [
      row("SLF", 2024, 14.25, "Ordinary"),
      row("SLF", 2024, 14.25, "Exceptional"),
      row("SLF", 2025, 14.75, "Ordinary"),
      row("SLF", 2025, 14.75, "Exceptional"),
      row("SLF", 2026, 30, "Ordinary"),
    ];
    const m = splitInconsistency(cal);
    expect(m.has("SLF")).toBe(true);
    expect(m.get("SLF").years[2024]).toBe(true); // paired
    expect(m.get("SLF").years[2026]).toBe(false); // ord-only
  });

  it("does NOT flag a ticker that splits consistently every year (ARD)", () => {
    const cal = [
      row("ARD", 2024, 5.88, "Ordinary"),
      row("ARD", 2024, 14.59, "Exceptional"),
      row("ARD", 2025, 10.43, "Ordinary"),
      row("ARD", 2025, 11.57, "Exceptional"),
      row("ARD", 2026, 5.71, "Ordinary"),
      row("ARD", 2026, 17.29, "Exceptional"),
    ];
    expect(splitInconsistency(cal).has("ARD")).toBe(false);
  });

  it("does NOT flag a plain ordinary-only payer", () => {
    const cal = [
      row("ATW", 2024, 16.5, "Ordinary"),
      row("ATW", 2025, 19, "Ordinary"),
      row("ATW", 2026, 22, "Ordinary"),
    ];
    expect(splitInconsistency(cal).has("ATW")).toBe(false);
  });

  it("only pairs when Ordinary and Exceptional share the SAME ex-date", () => {
    // Exceptional on a DIFFERENT date is a genuine one-off, not a split.
    const cal = [
      row("X", 2024, 10, "Ordinary", 6),
      row("X", 2024, 5, "Exceptional", 11), // separate date
      row("X", 2025, 11, "Ordinary", 6),
    ];
    expect(splitInconsistency(cal).has("X")).toBe(false);
  });

  it("ignores forecast/projected synthetic rows", () => {
    const cal = [
      row("SLF", 2024, 14.25, "Ordinary"),
      row("SLF", 2024, 14.25, "Exceptional"),
      { ...row("SLF", 2026, 30, "Ordinary"), _forecast: true },
    ];
    // Only the real 2024 pair remains -> consistent (single year) -> not flagged.
    expect(splitInconsistency(cal).has("SLF")).toBe(false);
  });
});
