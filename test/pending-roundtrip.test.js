// Round-trip + coverage tests for the PENDING entity.
//
// A pending order shares the transaction shape and is derived from the same
// TXN_FIELDS registry. These tests are the safety net for the "added a field
// but forgot to carry it from pending -> transaction" bug: if a field is
// form-bound on a transaction, it must be carried into the executed txn (or be
// a dialog-driven field), for BUY/SELL/OPCVM/DIV. Add a field to TXN_FIELDS
// without wiring the pending carry and these tests go red in CI.
import { describe, it, expect } from "vitest";
import {
  TXN_FIELDS,
  pendingFormFields,
  pendingCarryKeys,
  divMetaKeys,
  txnFormToPendingForm,
} from "../src/core/txn-schema.js";

// Pure replica of the UI's validatePending() field assembly, driven by the
// same schema helpers the real code uses. Dialog fields (date/qty/price/total)
// are passed in; carry fields come from the pending order.
function pendingToTxn(o, dialog, ctx) {
  const isDiv = o.action === "DIV";
  const t = { date: dialog.date, qty: dialog.qty, price: dialog.price };
  for (const k of pendingCarryKeys()) {
    if (k === "broker") t.broker = o.broker || ctx.txnBroker(o);
    else if (k === "pea") t.pea = !!o.pea;
    else if (k === "opcvm") {
      if (o.opcvm === true || ctx.isMasterOpcvm(o.ticker)) t.opcvm = true;
    } else t[k] = o[k];
  }
  if (isDiv) {
    if (o.exDate) t.exDate = o.exDate;
    if (o.eligBasis != null) t.eligBasis = o.eligBasis;
    t.auto = true;
  } else if (o.total != null && dialog.total != null) {
    t.total = dialog.total;
  }
  return t;
}

const CTX = {
  txnBroker: (o) => o.broker || (o.opcvm ? "attijari" : "saham"),
  isMasterOpcvm: () => false,
};

describe("pending schema: coverage & derivation", () => {
  it("pending form ids are the p-prefixed txn form ids", () => {
    expect(txnFormToPendingForm("tDate")).toBe("pDate");
    expect(txnFormToPendingForm("tOpcvm")).toBe("pOpcvm");
    expect(txnFormToPendingForm("tBroker")).toBe("pBroker");
  });

  it("pending form covers every form-bound transaction field", () => {
    const formKeys = TXN_FIELDS.filter((f) => f.form).map((f) => f.key).sort();
    const pendKeys = pendingFormFields().map((f) => f.key).sort();
    expect(pendKeys).toEqual(formKeys);
  });

  it("carry keys = form fields minus dialog-driven (date/qty/price/total)", () => {
    expect(pendingCarryKeys().sort()).toEqual(
      ["ticker", "action", "pea", "opcvm", "broker"].sort(),
    );
  });

  it("div metadata keys are exDate, eligBasis, auto", () => {
    expect(divMetaKeys().sort()).toEqual(
      ["exDate", "eligBasis", "auto"].sort(),
    );
  });
});

describe("pending -> transaction preserves every field", () => {
  it("BUY (stock, saham): carries ticker/action/pea/broker; no opcvm/total", () => {
    const o = { date: "2026-01-10", ticker: "ATW", action: "BUY", qty: 10, price: 680, pea: false, opcvm: false, broker: "saham" };
    const t = pendingToTxn(o, { date: "2026-01-12", qty: 10, price: 685 }, CTX);
    expect(t.date).toBe("2026-01-12"); // dialog date
    expect(t.price).toBe(685); // dialog price
    expect(t.qty).toBe(10);
    expect(t.ticker).toBe("ATW");
    expect(t.action).toBe("BUY");
    expect(t.pea).toBe(false);
    expect(t.broker).toBe("saham");
    expect("opcvm" in t).toBe(false); // only set when true
    expect("total" in t).toBe(false);
  });

  it("PEA SELL (attijari): pea + broker carried", () => {
    const o = { date: "2026-02-01", ticker: "ATW", action: "SELL", qty: 5, price: 700, pea: true, opcvm: false, broker: "attijari" };
    const t = pendingToTxn(o, { date: "2026-02-03", qty: 5, price: 710 }, CTX);
    expect(t.pea).toBe(true);
    expect(t.broker).toBe("attijari");
    expect(t.action).toBe("SELL");
  });

  it("OPCVM BUY: opcvm flag + total carried through the dialog", () => {
    const o = { date: "2026-03-01", ticker: "FCP A", action: "BUY", qty: 8, price: 800, pea: false, opcvm: true, total: 6400, broker: "attijari" };
    const t = pendingToTxn(o, { date: "2026-03-02", qty: 8, price: 800, total: 6400 }, CTX);
    expect(t.opcvm).toBe(true);
    expect(t.total).toBe(6400);
  });

  it("broker unset on pending -> resolved via txnBroker fallback", () => {
    const o = { date: "2026-01-10", ticker: "IAM", action: "BUY", qty: 3, price: 100, pea: false, opcvm: false };
    const t = pendingToTxn(o, { date: "2026-01-10", qty: 3, price: 100 }, CTX);
    expect(t.broker).toBe("saham"); // stock fallback
  });

  it("DIV: exDate/eligBasis/auto carried; auto forced true", () => {
    const o = { date: "2026-06-20", ticker: "ATW", action: "DIV", qty: 10, price: 22, pea: false, opcvm: false, broker: "saham", exDate: "2026-06-08", eligBasis: 10 };
    const t = pendingToTxn(o, { date: "2026-06-22", qty: 10, price: 22 }, CTX);
    expect(t.exDate).toBe("2026-06-08");
    expect(t.eligBasis).toBe(10);
    expect(t.auto).toBe(true);
    expect(t.action).toBe("DIV");
  });

  it("every carry key + dialog key appears in the executed txn (no field dropped)", () => {
    const o = { date: "2026-01-10", ticker: "ATW", action: "BUY", qty: 10, price: 680, pea: true, opcvm: false, broker: "attijari" };
    const t = pendingToTxn(o, { date: "2026-01-10", qty: 10, price: 680 }, CTX);
    // Every carry key that has a value on the order must survive to the txn.
    for (const k of pendingCarryKeys()) {
      if (k === "opcvm") continue; // conditional by design
      expect(k in t, `carry key ${k} missing from executed txn`).toBe(true);
    }
    for (const k of ["date", "qty", "price"]) {
      expect(k in t).toBe(true);
    }
  });
});
