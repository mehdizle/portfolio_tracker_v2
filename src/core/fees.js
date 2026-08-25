// ============================================================
// fees.js - brokerage / OPCVM / dividend fee engine (pure).
//
// Faithful port of v1's fee formulas, but:
//  - config is passed in explicitly (no globals) so it is testable;
//  - every returned fee is rounded to centimes once, at the boundary.
//
// VAT is a single global rate (v1 used the regular-account vat for ALL fee
// paths via vatRate()); we keep that behaviour: pass `vat` explicitly.
// ============================================================
import { roundMoney } from "./money.js";

/** VAT rate from the regular-account fee params (single source, like v1). */
export function vatRate(fp) {
  return fp && fp.vat != null ? fp.vat : 0.1;
}

// ---- Regular-account (legacy) helpers ----
export function feeRate(fp, vat) {
  return (fp.c_marche + fp.c_interm + fp.c_regl) * (1 + vat);
}
export function fixedFee(fp, vat) {
  return fp.courier * (1 + vat);
}

// ---- PEA helpers ----
export function peaStockFees(gross, fpPea, vat) {
  const court = Math.max(gross * fpPea.courtage, fpPea.courtageMin);
  const regl = gross * fpPea.regl;
  const bourse = gross * fpPea.bourse;
  return roundMoney((court + regl + bourse) * (1 + vat));
}
export function peaDivFees(gross, fpPea, vat) {
  return roundMoney(gross * fpPea.divComm * (1 + vat));
}

// ---- Broker helpers ----
export function brokerFeeRate(bk, vat) {
  const f = bk.fees;
  return (f.c_marche + f.c_interm + f.c_regl) * (1 + vat);
}
export function brokerFixedFee(bk, vat) {
  return bk.fees.courier * (1 + vat);
}
export function brokerStockFees(gross, bk, vat) {
  const f = bk.fees;
  const court = Math.max(gross * f.courtage, f.courtageMin);
  return roundMoney((court + gross * f.regl + gross * f.bourse) * (1 + vat));
}

/**
 * Universal fee calculator: given gross, action, broker object -> fees (MAD).
 * `fpFallback` is the legacy regular FP used when no broker is supplied.
 */
export function calcBrokerFees(gross, action, bk, isOpcvm, vat, fpFallback) {
  if (!bk) return roundMoney(gross * feeRate(fpFallback, vat) + fixedFee(fpFallback, vat));
  if (isOpcvm) {
    if (action === "DIV")
      return bk.fees.divComm ? roundMoney(gross * bk.fees.divComm * (1 + vat)) : 0;
    return bk.fees.opcvmOrder ? roundMoney(bk.fees.opcvmOrder * (1 + vat)) : 0;
  }
  if (action === "DIV" && bk.fees.divComm) {
    return roundMoney(gross * bk.fees.divComm * (1 + vat));
  }
  if (bk.feeType === "regular") {
    return roundMoney(gross * brokerFeeRate(bk, vat) + brokerFixedFee(bk, vat));
  }
  return brokerStockFees(gross, bk, vat);
}

/** Flat OPCVM order surcharge (Attijari): opcvmOrder + VAT (~11 MAD). */
export function opcvmSurcharge(brokers, vat) {
  const bk = (brokers && (brokers.attijari || brokers.Attijari)) || null;
  const f = bk && bk.fees ? bk.fees : null;
  const order = f && f.opcvmOrder != null ? f.opcvmOrder : 10;
  return roundMoney(order * (1 + vat));
}

/**
 * OPCVM fee: optional fund % (buy/sell) from master meta + flat surcharge.
 * includeFundPct=false when a manual Total already embeds the fund %.
 */
export function opcvmFee(gross, action, meta, includeFundPct, brokers, vat) {
  if (action === "DIV") return 0;
  let fee = 0;
  if (includeFundPct && meta) {
    const pctFee = action === "BUY" ? meta.buyFee : meta.sellFee;
    fee += gross * (pctFee || 0);
  }
  fee += opcvmSurcharge(brokers, vat);
  return roundMoney(fee);
}
