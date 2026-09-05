// ============================================================
// txn-schema.js - single source of truth for the TRANSACTION shape.
//
// Every place that serialises, parses, or form-binds a transaction should be
// DRIVEN by TXN_FIELDS instead of hardcoding its own field list. Add a field
// here once and the CSV header/export/import (and the round-trip test) pick it
// up automatically - which is what prevents the "I forgot to update the import"
// class of bug.
//
// Pure module: no DOM, no globals. Coercion helpers take primitive
// strings/values so the whole thing is unit-testable and importable by tests.
//
// Per-field properties:
//   key       - property name on the transaction object
//   csv       - CSV column header (lowercase)
//   form      - DOM input id for the add/edit form, or null if no field
//   kind      - "checkbox" | "value" (how the UI reads/writes the form control)
//   required  - must be present for a valid row (import filter + form validate)
//   omitIf    - (value)=>bool: skip writing this key onto the object (keeps
//               objects lean, matching current behaviour e.g. total only if >0)
//   toCsv     - (value, txn)=>string: value -> CSV cell
//   fromCsv   - (cell, ctx)=>value: CSV cell -> value (ctx gives brokers etc.)
// ============================================================

// --- small coercion helpers (pure) ---
const truthy = (s) => {
  const v = String(s == null ? "" : s)
    .trim()
    .toLowerCase();
  return v === "yes" || v === "true" || v === "1";
};
const num = (s) => {
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
};

export const TXN_FIELDS = [
  {
    key: "date",
    csv: "date",
    form: "tDate",
    kind: "value",
    required: true,
    toCsv: (v) => v || "",
    fromCsv: (c) => (c || "").trim(),
  },
  {
    key: "ticker",
    csv: "ticker",
    form: "tTicker",
    kind: "value",
    required: true,
    toCsv: (v) => v || "",
    fromCsv: (c) => (c || "").trim().toUpperCase(),
  },
  {
    key: "action",
    csv: "action",
    form: "tAction",
    kind: "value",
    required: true,
    toCsv: (v) => v || "",
    fromCsv: (c) => (c || "").trim().toUpperCase(),
  },
  {
    key: "qty",
    csv: "qty",
    form: "tQty",
    kind: "value",
    required: true,
    toCsv: (v) => (v == null ? "" : v),
    fromCsv: (c) => num(c),
  },
  {
    key: "price",
    csv: "price",
    form: "tPrice",
    kind: "value",
    required: false, // may be derived from total/qty for OPCVM
    toCsv: (v) => (v == null ? "" : v),
    fromCsv: (c) => num(c),
  },
  {
    key: "pea",
    csv: "pea",
    form: "tPea",
    kind: "checkbox",
    default: false,
    toCsv: (v) => (v ? "yes" : "no"),
    fromCsv: (c) => {
      const v = String(c || "")
        .trim()
        .toLowerCase();
      return v === "yes" || v === "pea" || v === "true" || v === "1";
    },
  },
  {
    key: "opcvm",
    csv: "opcvm",
    form: "tOpcvm",
    kind: "checkbox",
    default: false,
    toCsv: (v) => (v ? "yes" : "no"),
    fromCsv: (c) => {
      const v = String(c || "")
        .trim()
        .toLowerCase();
      return (
        v === "yes" ||
        v === "opcvm" ||
        v === "fund" ||
        v === "true" ||
        v === "1"
      );
    },
  },
  {
    key: "total",
    csv: "total",
    form: "tTotal",
    kind: "value",
    // OPCVM total TTC. Only stored when > 0 (matches current behaviour).
    omitIf: (v) => !(typeof v === "number" && v > 0),
    toCsv: (v) => (typeof v === "number" && v > 0 ? v : ""),
    fromCsv: (c) => {
      const n = parseFloat(c);
      return !isNaN(n) && n > 0 ? n : undefined;
    },
  },
  {
    key: "broker",
    csv: "broker",
    form: "tBroker",
    kind: "value",
    // Blank/unknown -> undefined so txnBroker() resolves by asset type.
    toCsv: (v, t, ctx) =>
      ctx && ctx.resolveBroker ? ctx.resolveBroker(t) : v || "",
    fromCsv: (c, ctx) => {
      const raw = String(c || "").trim();
      if (!raw) return undefined;
      const brokers = (ctx && ctx.brokers) || {};
      const match = Object.keys(brokers).find(
        (id) =>
          id.toLowerCase() === raw.toLowerCase() ||
          String(brokers[id].name || "").toLowerCase() === raw.toLowerCase(),
      );
      return match || undefined;
    },
  },
  // --- Order ID (side-channel; no form control) ---------------------------
  // Identifies which fills belong to ONE broker order. Auto-assigned when a
  // pending item is created (ID1, ID2, ...) and carried onto every executed
  // (possibly split) transaction, so the fee engine applies a per-order
  // courtage minimum once per order. Round-trips through CSV as "orderid".
  {
    key: "_ord",
    csv: "orderid",
    form: null,
    omitIf: (v) => v == null || v === "",
    toCsv: (v) => (v == null ? "" : String(v)),
    fromCsv: (c) => {
      const s = (c || "").trim();
      return s || undefined;
    },
  },
  // --- DIV side-channel fields (no form control; round-tripped via CSV) ---
  {
    key: "exDate",
    csv: "exdate",
    form: null,
    divOnly: true,
    omitIf: (v) => v == null || v === "",
    toCsv: (v) => v || "",
    fromCsv: (c) => {
      const s = (c || "").trim();
      return s || undefined;
    },
  },
  {
    key: "eligBasis",
    csv: "eligbasis",
    form: null,
    divOnly: true,
    omitIf: (v) => v == null,
    toCsv: (v) => (v == null ? "" : v),
    fromCsv: (c) => {
      const n = parseFloat(c);
      return isNaN(n) ? undefined : n;
    },
  },
  {
    key: "auto",
    csv: "auto",
    form: null,
    divOnly: true,
    omitIf: (v) => !v,
    toCsv: (v) => (v ? "yes" : ""),
    fromCsv: (c) => (truthy(c) ? true : undefined),
  },
];

/** CSV header row (array of column names) - derived from the schema. */
export function csvHeader() {
  return TXN_FIELDS.map((f) => f.csv);
}

/** Serialise one transaction to a CSV row (array), schema-ordered.
 *  ctx may provide { resolveBroker(t) } so broker exports its resolved value. */
export function txnToCsvRow(t, ctx) {
  return TXN_FIELDS.map((f) => f.toCsv(t[f.key], t, ctx));
}

/** Build a header->column-index map from a parsed CSV header array. */
export function buildCsvIx(headerCells) {
  const lower = headerCells.map((h) =>
    String(h || "")
      .trim()
      .toLowerCase(),
  );
  const ix = {};
  for (const f of TXN_FIELDS) ix[f.key] = lower.indexOf(f.csv);
  return ix;
}

/** Parse one CSV row (array of cells) + ix map into a transaction object.
 *  Only sets keys whose column is present and whose value passes omitIf.
 *  ctx may provide { brokers } for broker matching. */
export function csvRowToTxn(cells, ix, ctx) {
  const o = {};
  for (const f of TXN_FIELDS) {
    const col = ix[f.key];
    if (col == null || col < 0) continue; // column absent
    const val = f.fromCsv(cells[col], ctx);
    if (val === undefined) continue; // parser said "skip"
    if (f.omitIf && f.omitIf(val)) continue;
    o[f.key] = val;
  }
  return o;
}

/** The keys the import parser needs present to treat a row as valid. */
export function requiredKeys() {
  return TXN_FIELDS.filter((f) => f.required).map((f) => f.key);
}

/** CSV column names that MUST be present for an import row to be valid. */
export function requiredCsvColumns() {
  return TXN_FIELDS.filter((f) => f.required).map((f) => f.csv);
}

/** CSV column names that are optional on import (everything not required). */
export function optionalCsvColumns() {
  return TXN_FIELDS.filter((f) => !f.required).map((f) => f.csv);
}

/** Form-bound fields (have a DOM id) - for schema-driven form prefill. */
export function formFields() {
  return TXN_FIELDS.filter((f) => f.form);
}

// ============================================================
// PENDING helpers.
//
// A pending order shares the transaction shape. Its add/edit form uses the same
// field set as transactions but with "p"-prefixed input ids (tDate -> pDate,
// tOpcvm -> pOpcvm, ...) and never has the DIV-only side-channel fields as form
// controls. Rather than a second registry, we DERIVE pending from TXN_FIELDS so
// the two entities can never drift apart: add a field to TXN_FIELDS and the
// pending form + pending->txn conversion pick it up for free (and the pending
// round-trip test enforces it).
// ============================================================

/** Map a transaction form id (tXxx) to the matching pending form id (pXxx). */
export function txnFormToPendingForm(formId) {
  return formId && formId[0] === "t" ? "p" + formId.slice(1) : formId;
}

/** Form-bound fields for the PENDING form: same fields as the txn form, but
 *  addressed by their p-prefixed ids. Returns { key, kind, pform, required }. */
export function pendingFormFields() {
  return TXN_FIELDS.filter((f) => f.form).map((f) => ({
    key: f.key,
    kind: f.kind,
    required: !!f.required,
    pform: txnFormToPendingForm(f.form),
  }));
}

/** Fields the fill dialog supplies at execution time (NOT copied from the
 *  pending order verbatim): the UI resolves these from the dialog. */
const PENDING_DIALOG_KEYS = ["date", "qty", "price", "total"];

/** Keys that a pending order carries over UNCHANGED into the executed
 *  transaction. Everything form-bound except the dialog-driven fields, i.e.
 *  ticker, action, pea, opcvm, broker. Deriving this from TXN_FIELDS means a
 *  new pending field is carried into the txn automatically. */
export function pendingCarryKeys() {
  return TXN_FIELDS.filter(
    (f) => f.form && PENDING_DIALOG_KEYS.indexOf(f.key) < 0,
  ).map((f) => f.key);
}

/** DIV-only metadata keys carried from a pending DIV order to the txn. */
export function divMetaKeys() {
  return TXN_FIELDS.filter((f) => f.divOnly).map((f) => f.key);
}
