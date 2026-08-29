// Live tests for the savings-pots plan-apply core (src/core/plan-apply.js).
// This is the ACTUAL code eApplyCarPlan/eApplyOtherPlan run (they delegate to
// it), so these tests exercise the real logic - not a replica. Covers the
// realized-guard bug class that reached production twice.
import { describe, it, expect } from "vitest";
import { applyPlanToLog, planCostByMonth } from "../src/core/plan-apply.js";

// Helpers mirroring the UI's injected functions.
const realizedIf = (set) => (r) => set.has(r.month);
const noteNames = (plan) => (mo) =>
  plan
    .filter((c) => Math.abs(+c.amt || 0) > 0 && (c.months || []).includes(mo))
    .map((c) => c.name || "cost")
    .join(" + ");

describe("planCostByMonth", () => {
  it("sums absolute costs per month across the plan", () => {
    const plan = [
      { name: "A", amt: 1000, months: [3, 9] },
      { name: "B", amt: 500, months: [9] },
      { name: "C", amt: -200, months: [3] }, // abs -> 200
    ];
    const by = planCostByMonth(plan);
    expect(by[3]).toBe(1200); // 1000 + 200
    expect(by[9]).toBe(1500); // 1000 + 500
    expect(by[1]).toBeUndefined();
  });
  it("empty / missing plan -> empty map", () => {
    expect(planCostByMonth([])).toEqual({});
    expect(planCostByMonth(undefined)).toEqual({});
  });
});

describe("applyPlanToLog: recompute non-realized months", () => {
  const plan = [{ name: "Insurance", amt: 1200, months: [9] }];
  const baseLog = () => [
    { month: "2026-06", car: 300 }, // will be REALIZED -> untouched
    { month: "2026-09", car: 0 }, // payment month
    { month: "2026-10", car: 0 }, // non-payment month
    { month: "not-a-month", car: 7 }, // malformed -> skipped
  ];

  it("payment month = save - cost, note auto-filled; other future month = save", () => {
    const log = baseLog();
    const applied = applyPlanToLog({
      plan,
      monthlySave: 500,
      log,
      valueKey: "car",
      noteKey: "note",
      isRealized: realizedIf(new Set(["2026-06"])),
      noteForMonth: noteNames(plan),
    });
    expect(log[1].car).toBe(500 - 1200); // Sept payment
    expect(log[1].note).toBe("Insurance");
    expect(log[2].car).toBe(500); // Oct set-aside
    expect(applied).toBe(1); // one payment month
  });

  it("REALIZED months are never rewritten (history preserved)", () => {
    const log = baseLog();
    applyPlanToLog({
      plan,
      monthlySave: 500,
      log,
      valueKey: "car",
      noteKey: "note",
      isRealized: realizedIf(new Set(["2026-06"])),
      noteForMonth: noteNames(plan),
    });
    expect(log[0].car).toBe(300); // 2026-06 untouched
    expect("note" in log[0]).toBe(false); // note not added to realized row
  });

  it("a PAST-dated but UNREALIZED month IS recomputed (the fixed bug)", () => {
    // Sept is in the past relative to some 'today', but not marked realized.
    const log = [{ month: "2026-09", car: 1100 }]; // stale value
    applyPlanToLog({
      plan,
      monthlySave: 1150,
      log,
      valueKey: "car",
      noteKey: "note",
      isRealized: () => false, // not realized
      noteForMonth: noteNames(plan),
    });
    expect(log[0].car).toBe(1150 - 1200); // recomputed, not left at 1100
  });

  it("malformed month rows are skipped", () => {
    const log = baseLog();
    applyPlanToLog({
      plan,
      monthlySave: 500,
      log,
      valueKey: "car",
      noteKey: "note",
      isRealized: () => false,
      noteForMonth: noteNames(plan),
    });
    expect(log[3].car).toBe(7); // "not-a-month" untouched
  });

  it("works for the Other bucket (btOther / noteBt) - same logic", () => {
    const oPlan = [{ name: "Office", amt: 1100, months: [9] }];
    const log = [
      { month: "2026-09", btOther: 0 },
      { month: "2026-10", btOther: 0 },
    ];
    const applied = applyPlanToLog({
      plan: oPlan,
      monthlySave: 100,
      log,
      valueKey: "btOther",
      noteKey: "noteBt",
      isRealized: () => false,
      noteForMonth: noteNames(oPlan),
    });
    expect(log[0].btOther).toBe(100 - 1100);
    expect(log[0].noteBt).toBe("Office");
    expect(log[1].btOther).toBe(100);
    expect(applied).toBe(1);
  });

  it("monthlySave 0 and no cost -> month left unchanged", () => {
    const log = [{ month: "2026-11", car: 42 }];
    applyPlanToLog({
      plan: [],
      monthlySave: 0,
      log,
      valueKey: "car",
      noteKey: "note",
      isRealized: () => false,
      noteForMonth: () => "",
    });
    expect(log[0].car).toBe(42); // no cost, no save -> untouched
  });
});
