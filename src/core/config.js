// ============================================================
// config.js - fee / broker / tax default parameters.
//
// Extracted verbatim from the original app so v2 reproduces v1's numbers.
// These are DEFAULTS; the live app overlays any user-saved overrides from
// localStorage on top (same as v1).
// ============================================================

// Regular-account (legacy) fee params.
export const FP_DEFAULT = {
  c_marche: 0.002,
  c_interm: 0.006,
  c_regl: 0.001,
  vat: 0.1,
  courier: 2.5,
  tpcvm: 0.15, // capital-gains tax (regular accounts only)
};

// PEA-account fee params.
export const FP_PEA_DEFAULT = {
  courtage: 0.01,
  courtageMin: 10,
  regl: 0.002,
  bourse: 0.001,
  vat: 0.1,
  opcvmOrder: 10,
  divComm: 0.02,
};

// Broker definitions. feeType 'regular' = rate-based; 'pea' = courtage-based.
export const BROKER_DEFAULTS = {
  saham: {
    name: "Saham",
    feeType: "regular",
    fees: { c_marche: 0.002, c_interm: 0.006, c_regl: 0.001, vat: 0.1, courier: 2.5 },
  },
  attijari: {
    name: "Attijari",
    feeType: "pea",
    fees: {
      courtage: 0.01,
      courtageMin: 10,
      regl: 0.002,
      bourse: 0.001,
      vat: 0.1,
      opcvmOrder: 10,
      divComm: 0.02,
    },
  },
};

// Dividend withholding tax by year (matches the real backup).
export const DIVTAX_DEFAULT = { 2025: 0.125, 2026: 0.1125, 2027: 0.1 };
