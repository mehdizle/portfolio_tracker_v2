// 02b-fees.js
// Fee / broker / dividend-tax CONFIGURATION domain. This is the editable,
// persisted parameter layer (FP, FP_PEA, BROKERS, DIVTAX) plus the thin helpers
// that forward those live globals to the tested pure core (src/core/fees.js,
// src/core/tax.js via globalThis.__core). Moved out of 01-core.js, where it was
// the single largest block and unrelated to that file's generic infrastructure.
// Part of the Portfolio Tracker app. Loaded as an ordered plain <script>
// (shared global scope via scripts/concat.mjs) AFTER 01-core.js (needs SEED,
// safeSetItem, markSaved, escapeHtml, M) and BEFORE 02-compute.js (runFIFO
// reads FP/FP_PEA/BROKERS/DIVTAX).
// ============================================================

// Granular, editable & persisted fee parameters. Defaults are the SINGLE SOURCE
// OF TRUTH in the tested core (src/core/config.js), exposed via __core.defaults
// - we no longer keep a second literal copy here that could drift.
const FP_DEFAULT = __core.defaults.FP_DEFAULT;
let FP = (() => {
  try {
    const s = localStorage.getItem("casa_fees_v1");
    if (s) return { ...FP_DEFAULT, ...JSON.parse(s) };
  } catch (e) {
    console.warn(
      "Could not load saved fees (casa_fees_v1); using defaults.",
      e,
    );
  }
  return { ...FP_DEFAULT };
})();
function saveFees() {
  if (safeSetItem("casa_fees_v1", JSON.stringify(FP))) markSaved();
}
// \u2500\u2500 GLOBAL VAT (single source of truth) \u2500\u2500
// VAT is a national 10% rate applied to broker commissions everywhere. Stored once
// on FP.vat (editable under Data \u25B8 Global tax). All fee helpers read vatRate() so
// per-broker vat fields are NOT authoritative \u2014 change it here, it flows everywhere.
// v2: fee/tax leaf helpers delegate to the tested core (src/core/fees.js,
// tax.js) so the whole app shares ONE rounding-correct implementation. They
// keep their v1 names/signatures, reading the live FP/FP_PEA/BROKERS/DIVTAX
// globals and forwarding them to the pure core functions.
function vatRate() {
  return __core.fees.vatRate(FP);
}
function feeRate() {
  return __core.fees.feeRate(FP, vatRate());
}
function fixedFee() {
  return __core.fees.fixedFee(FP, vatRate());
}
// ---------- PEA account (ECO) fee model \u2014 independent, editable & persisted ----------
// PEA stock trades use a single 'courtage' commission (min floor), a r\u00E8glement/livraison
// commission, and the Bourse de Casa commission ("imp\u00F4t de bourse"); TVA applies to ALL three.
//   fees = [ max(gross*courtage, min) + gross*regl + gross*bourse ] * (1+tva)
// OPCVM (PEA): entry/exit free, flat order fee (MAD HT) + TVA per transaction.
// Dividends (PEA): commission de distribution (% HT) + TVA; no TPCVM.
// Defaults from the tested core (single source of truth), not a local copy.
const FP_PEA_DEFAULT = __core.defaults.FP_PEA_DEFAULT;
let FP_PEA = (() => {
  try {
    const s = localStorage.getItem("casa_fees_pea_v1");
    if (s) return { ...FP_PEA_DEFAULT, ...JSON.parse(s) };
  } catch (e) {
    console.warn(
      "Could not load saved PEA fees (casa_fees_pea_v1); using defaults.",
      e,
    );
  }
  return { ...FP_PEA_DEFAULT };
})();
function saveFeesPea() {
  if (safeSetItem("casa_fees_pea_v1", JSON.stringify(FP_PEA))) markSaved();
}

// \u2550\u2550\u2550\u2550\u2550\u2550\u2550 BROKER-BASED FEE SYSTEM \u2550\u2550\u2550\u2550\u2550\u2550\u2550
// Each broker has: {name, feeType:'regular'|'pea', fees:{...}}
// feeType determines WHICH formula to apply (rate-based vs courtage-based).
// TPCVM is global (government tax), not per-broker.
// Defaults from the tested core (single source of truth), not a local copy.
const BROKER_DEFAULTS = __core.defaults.BROKER_DEFAULTS;
let BROKERS =
  (() => {
    try {
      const s = localStorage.getItem("casa_brokers_v1");
      if (s) return JSON.parse(s);
    } catch (e) {
      console.warn(
        "Could not load saved brokers (casa_brokers_v1); using defaults.",
        e,
      );
    }
    return null;
  })() || JSON.parse(JSON.stringify(BROKER_DEFAULTS));
function saveBrokers() {
  if (safeSetItem("casa_brokers_v1", JSON.stringify(BROKERS))) markSaved();
}

// Resolve broker for a transaction. New/edited transactions carry an explicit
// `broker`. For legacy/imported rows with no broker field, fall back by asset type
// to match the real setup (OPCVM funds are held at Attijari; stocks at Saham).
// Broker and PEA-status are independent \u2014 we do NOT infer broker from the pea flag.
function txnBroker(t) {
  if (t.broker) return t.broker;
  return isOpcvmTxn(t) ? "attijari" : "saham";
}

// \u2500\u2500 SINGLE SOURCE OF TRUTH for OPCVM (fund) fees \u2500\u2500
// An OPCVM order fee = the fund's own buy/sell % (imported from the Data tab)
// PLUS, for brokers that charge a flat order fee (Attijari: opcvmOrder + VAT,
// e.g. 10 \u00D7 1.10 = 11 MAD), that surcharge on top. Saham has no surcharge.
// Dividends carry no fund fee.
//   gross          : NAV amount (price \u00D7 qty)
//   action         : BUY | SELL | DIV
//   broker         : resolved broker object (BROKERS[...])
//   meta           : master record M[ticker] (holds buyFee/sellFee)
//   includeFundPct : true  \u2192 apply the fund % (computed paths: Net-if-Sold, qty\u00D7price entry)
//                    false \u2192 fund % already baked into a manually-entered Total; add surcharge only
function opcvmFee(gross, action, broker, meta, includeFundPct) {
  // v2: delegate to core (broker arg unused there - surcharge is Attijari-based).
  return __core.fees.opcvmFee(
    gross,
    action,
    meta,
    includeFundPct,
    _brokersOrDefaults(),
    vatRate(),
  );
}
function opcvmSurcharge() {
  return __core.fees.opcvmSurcharge(_brokersOrDefaults(), vatRate());
}
// Live brokers if present, else the core defaults (matches v1 fallback).
function _brokersOrDefaults() {
  return typeof BROKERS !== "undefined" && BROKERS
    ? BROKERS
    : __core.defaults.BROKER_DEFAULTS;
}

// Populate broker <select> elements with current broker list
function populateBrokerSelects() {
  document.querySelectorAll("#tBroker,#pBroker").forEach((sel) => {
    const cur = sel.value;
    sel.innerHTML = Object.keys(BROKERS)
      .map(
        (id) =>
          '<option value="' +
          escapeHtml(id) +
          '">' +
          escapeHtml(BROKERS[id].name) +
          "</option>",
      )
      .join("");
    sel.value = cur && BROKERS[cur] ? cur : "attijari";
  });
}
// Broker and PEA-status are INDEPENDENT (you can hold a PEA at any broker).
// We no longer force broker=Attijari when PEA is ticked \u2014 the user chooses each
// freely. Defaults (Attijari + PEA) are set once for convenience via the selects'
// initial values; toggling PEA does not override the broker.
function wireBrokerAutoSelect() {
  /* intentionally no auto-mapping \u2014 broker is chosen independently of PEA */
}

// Compute fees for a broker by its feeType
// NOTE: all broker fee helpers use the GLOBAL vatRate() \u2014 per-broker vat is ignored.
function brokerFeeRate(bk) {
  return __core.fees.brokerFeeRate(bk, vatRate());
}
function brokerFixedFee(bk) {
  return __core.fees.brokerFixedFee(bk, vatRate());
}
function brokerStockFees(gross, bk) {
  return __core.fees.brokerStockFees(gross, bk, vatRate());
}

// Universal fee calculator: given gross, action, broker object -> fees (delegates to core).
function calcBrokerFees(gross, action, bk, isOpcvm) {
  return __core.fees.calcBrokerFees(gross, action, bk, isOpcvm, vatRate(), FP);
}
// Stock BUY/SELL fees for a PEA trade of value `gross` (MAD). Returns fees incl. VAT (global).
function peaStockFees(gross, fp) {
  return __core.fees.peaStockFees(gross, fp || FP_PEA, vatRate());
}
// PEA dividend commission (incl. VAT global) on gross dividend.
function peaDivFees(gross, fp) {
  return __core.fees.peaDivFees(gross, fp || FP_PEA, vatRate());
}
let DIVTAX = (() => {
  try {
    const s = localStorage.getItem("casa_divtax_v1");
    if (s) return JSON.parse(s);
  } catch (e) {
    console.warn(
      "Could not load saved dividend tax (casa_divtax_v1); using defaults.",
      e,
    );
  }
  // Seed from the tested core's defaults (single source of truth). Previously
  // this read SEED.div_tax_by_year, which had drifted to 2025=0.12 while the
  // core (and its tests) use the correct 2025=0.125 - so fresh state now gets
  // the right rate.
  return { ...__core.defaults.DIVTAX_DEFAULT };
})();
function saveDivTax() {
  if (safeSetItem("casa_divtax_v1", JSON.stringify(DIVTAX))) markSaved();
}
