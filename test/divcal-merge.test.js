// Tests for the dividend-calendar smart-merge (upsert) logic that replaced the
// old Replace/Append modes. Guarantees: add new, update changed, keep old years,
// never duplicate, never delete.
import { describe, it, expect } from "vitest";
import {
  mergeDivcal,
  divIdentity,
  dedupeBatch,
} from "../src/core/divcal-merge.js";

const ev = (o) => ({
  ticker: "ATW",
  issuer: "Attijariwafa",
  amount: 22,
  ex_date: "2026-06-18",
  pay_date: "2026-07-08",
  div_type: "Ordinary",
  ...o,
});

describe("divIdentity", () => {
  it("is ticker + ex-date and is case/space insensitive on ticker", () => {
    expect(divIdentity(ev({ ticker: " atw " }))).toBe(divIdentity(ev({})));
  });
  it("falls back to pay-date when ex-date missing", () => {
    const a = divIdentity(ev({ ex_date: "" }));
    expect(a).toContain("@2026-07-08");
  });
  it("differs across years for the same ticker", () => {
    expect(divIdentity(ev({ ex_date: "2025-06-18" }))).not.toBe(
      divIdentity(ev({ ex_date: "2026-06-18" })),
    );
  });
});

describe("mergeDivcal", () => {
  it("adds brand-new events", () => {
    const r = mergeDivcal([], [ev({}), ev({ ticker: "IAM", ex_date: "2026-09-04" })]);
    expect(r.added).toBe(2);
    expect(r.updated).toBe(0);
    expect(r.list).toHaveLength(2);
  });

  it("skips an identical re-import (nothing changes)", () => {
    const base = [ev({})];
    const r = mergeDivcal(base, [ev({})]);
    expect(r.added).toBe(0);
    expect(r.updated).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.list).toHaveLength(1);
  });

  it("updates a changed amount in place (no duplicate)", () => {
    const base = [ev({ amount: 22 })];
    const r = mergeDivcal(base, [ev({ amount: 24 })]);
    expect(r.added).toBe(0);
    expect(r.updated).toBe(1);
    expect(r.list).toHaveLength(1);
    expect(r.list[0].amount).toBe(24);
  });

  it("updates a changed pay-date in place", () => {
    const base = [ev({ pay_date: "2026-07-08" })];
    const r = mergeDivcal(base, [ev({ pay_date: "2026-07-15" })]);
    expect(r.updated).toBe(1);
    expect(r.list[0].pay_date).toBe("2026-07-15");
  });

  it("KEEPS previous years when importing only the new year (the core ask)", () => {
    const base = [
      ev({ ex_date: "2024-06-18", pay_date: "2024-07-08", amount: 18 }),
      ev({ ex_date: "2025-06-18", pay_date: "2025-07-08", amount: 20 }),
    ];
    const r = mergeDivcal(base, [ev({ ex_date: "2026-06-18", amount: 22 })]);
    expect(r.added).toBe(1);
    expect(r.list).toHaveLength(3);
    // 2024 and 2025 survive untouched.
    expect(r.list.some((d) => d.ex_date === "2024-06-18")).toBe(true);
    expect(r.list.some((d) => d.ex_date === "2025-06-18")).toBe(true);
  });

  it("does not mutate the input array", () => {
    const base = [ev({ amount: 22 })];
    mergeDivcal(base, [ev({ amount: 24 })]);
    expect(base[0].amount).toBe(22);
  });

  it("preserves runtime flags on existing rows it doesn't touch", () => {
    const base = [ev({ _fromTxn: true })];
    const r = mergeDivcal(base, [ev({ ticker: "IAM", ex_date: "2026-09-04" })]);
    const atw = r.list.find((d) => d.ticker === "ATW");
    expect(atw._fromTxn).toBe(true);
  });

  it("treats 22 and 22.00 as equal (no false update)", () => {
    const r = mergeDivcal([ev({ amount: 22 })], [ev({ amount: 22.0 })]);
    expect(r.updated).toBe(0);
    expect(r.skipped).toBe(1);
  });
});

describe("dedupeBatch", () => {
  it("collapses same-identity rows keeping the last (corrected) one", () => {
    const out = dedupeBatch([ev({ amount: 22 }), ev({ amount: 24 })]);
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe(24);
  });
});
