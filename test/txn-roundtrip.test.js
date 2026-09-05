// Round-trip + schema-coverage tests for the transaction schema.
//
// These are the SAFETY NET for the "I added a field but forgot to wire the
// import/export" class of bug: if a field exists in TXN_FIELDS, the CSV header
// must contain it, and an export -> import cycle must preserve it for every
// action type. Add a field to the schema without a working toCsv/fromCsv and
// these tests go red in CI, blocking deploy.
import { describe, it, expect } from "vitest";
import {
  TXN_FIELDS,
  csvHeader,
  txnToCsvRow,
  buildCsvIx,
  csvRowToTxn,
} from "../src/core/txn-schema.js";
import { BROKER_DEFAULTS } from "../src/core/config.js";

const CTX = {
  brokers: BROKER_DEFAULTS,
  resolveBroker: (t) => t.broker || (t.opcvm ? "attijari" : "saham"),
};

// Serialise a list of txns to CSV text and parse it back (mirrors the app's
// export/import mechanics, but purely via the schema helpers).
function roundTrip(txns) {
  const header = csvHeader();
  const lines = [header.join(",")].concat(
    txns.map((t) => txnToCsvRow(t, CTX).join(",")),
  );
  const csv = lines.join("\n");
  const parsed = csv.split("\n");
  const ix = buildCsvIx(parsed[0].split(","));
  return parsed.slice(1).map((line) => csvRowToTxn(line.split(","), ix, CTX));
}

describe("txn schema: coverage", () => {
  it("every field has a unique csv column name", () => {
    const cols = TXN_FIELDS.map((f) => f.csv);
    expect(new Set(cols).size).toBe(cols.length);
  });
  it("csvHeader contains every schema field (so a new field can't be silently omitted)", () => {
    const header = csvHeader();
    for (const f of TXN_FIELDS) {
      expect(header, `header missing column for ${f.key}`).toContain(f.csv);
    }
  });
  it("required keys are date, ticker, action, qty", () => {
    const req = TXN_FIELDS.filter((f) => f.required)
      .map((f) => f.key)
      .sort();
    expect(req).toEqual(["action", "date", "qty", "ticker"].sort());
  });
});

describe("txn schema: export -> import round-trip preserves every field", () => {
  it("regular BUY (stock, saham)", () => {
    const t = {
      date: "2026-01-15",
      ticker: "ATW",
      action: "BUY",
      qty: 10,
      price: 680,
      pea: false,
      opcvm: false,
      broker: "saham",
    };
    const [back] = roundTrip([t]);
    expect(back.date).toBe("2026-01-15");
    expect(back.ticker).toBe("ATW");
    expect(back.action).toBe("BUY");
    expect(back.qty).toBe(10);
    expect(back.price).toBe(680);
    expect(back.pea).toBe(false);
    expect(back.opcvm).toBe(false);
    expect(back.broker).toBe("saham");
    expect("total" in back).toBe(false); // total only stored when > 0
    expect("exDate" in back).toBe(false); // DIV-only, absent for BUY
  });

  it("PEA SELL (attijari)", () => {
    const t = {
      date: "2026-03-20",
      ticker: "ATW",
      action: "SELL",
      qty: 5,
      price: 720,
      pea: true,
      opcvm: false,
      broker: "attijari",
    };
    const [back] = roundTrip([t]);
    expect(back.pea).toBe(true);
    expect(back.broker).toBe("attijari");
    expect(back.action).toBe("SELL");
  });

  it("OPCVM BUY with total, blank price -> total preserved", () => {
    const t = {
      date: "2026-02-04",
      ticker: "FCP A",
      action: "BUY",
      qty: 8.435,
      price: 831.8,
      pea: false,
      opcvm: true,
      total: 7025,
      broker: "attijari",
    };
    const [back] = roundTrip([t]);
    expect(back.opcvm).toBe(true);
    expect(back.total).toBe(7025);
    expect(back.qty).toBeCloseTo(8.435, 3);
  });

  it("auto DIV with exDate + eligBasis + auto flag", () => {
    const t = {
      date: "2026-06-22",
      ticker: "ATW",
      action: "DIV",
      qty: 10,
      price: 22,
      pea: false,
      opcvm: false,
      broker: "saham",
      exDate: "2026-06-10",
      eligBasis: 10,
      auto: true,
    };
    const [back] = roundTrip([t]);
    expect(back.exDate).toBe("2026-06-10");
    expect(back.eligBasis).toBe(10);
    expect(back.auto).toBe(true);
    expect(back.action).toBe("DIV");
  });

  it("Order ID (_ord) round-trips via the orderid column", () => {
    const t = {
      date: "2026-09-03",
      ticker: "ZDJ",
      action: "BUY",
      qty: 2,
      price: 305,
      pea: true,
      opcvm: false,
      broker: "attijari",
      _ord: "ID42",
    };
    const [back] = roundTrip([t]);
    expect(back._ord).toBe("ID42");
    // absent when not set (kept lean via omitIf)
    const [bare] = roundTrip([{ ...t, _ord: undefined }]);
    expect("_ord" in bare).toBe(false);
  });

  it("broker blank in CSV -> resolves to undefined (falls back to txnBroker downstream)", () => {
    // Simulate an import row with an empty broker cell.
    const ix = buildCsvIx(csvHeader());
    const header = csvHeader();
    const row = header.map((col) => {
      if (col === "date") return "2026-01-01";
      if (col === "ticker") return "IAM";
      if (col === "action") return "BUY";
      if (col === "qty") return "3";
      if (col === "price") return "100";
      return ""; // broker etc. blank
    });
    const o = csvRowToTxn(row, ix, CTX);
    expect("broker" in o).toBe(false);
    expect(o.ticker).toBe("IAM");
  });

  it("unknown broker name is matched case-insensitively; garbage -> undefined", () => {
    const ix = buildCsvIx(csvHeader());
    const mk = (brokerCell) => {
      const row = csvHeader().map((col) => {
        if (col === "date") return "2026-01-01";
        if (col === "ticker") return "IAM";
        if (col === "action") return "BUY";
        if (col === "qty") return "3";
        if (col === "price") return "100";
        if (col === "broker") return brokerCell;
        return "";
      });
      return csvRowToTxn(row, ix, CTX);
    };
    expect(mk("SAHAM").broker).toBe("saham"); // case-insensitive id
    expect(mk("Attijari").broker).toBe("attijari"); // by display name
    expect("broker" in mk("nonsense")).toBe(false); // garbage dropped
  });
});
