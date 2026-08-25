// ============================================================
// tax.js - Moroccan capital-gains (TPCVM) and dividend withholding tax.
//
// Pure functions; config passed explicitly. Rounds tax to centimes at the
// boundary. Mirrors v1 semantics:
//  - PEA accounts are exempt from both TPCVM and dividend tax.
//  - Capital-gains tax = max(gross - fees - costBasis, 0) * tpcvm.
//  - Dividend tax = gross * (1 + vat) * divRate(year)  [regular only].
// ============================================================
import { roundMoney } from "./money.js";

/**
 * Dividend withholding rate for a year, with v1's forward/backward fill:
 *  - exact year if present;
 *  - years before the earliest known -> earliest rate;
 *  - years after the latest known -> latest rate (carry forward);
 *  - empty table -> tpcvm * 0.75 fallback.
 */
export function divRate(year, divtax, tpcvm) {
  if (divtax[String(year)] != null) return divtax[String(year)];
  const yrs = Object.keys(divtax)
    .map(Number)
    .sort((a, b) => a - b);
  if (!yrs.length) return (tpcvm != null ? tpcvm : 0.15) * 0.75;
  if (year < yrs[0]) return divtax[String(yrs[0])];
  return divtax[String(yrs[yrs.length - 1])];
}

/** Capital-gains tax on a SELL. costBasis = qty * avgCostPerShare. */
export function capitalGainsTax(gross, fees, costBasis, isPea, tpcvm) {
  if (isPea) return 0;
  const gain = gross - fees - (costBasis || 0);
  return roundMoney(Math.max(gain, 0) * tpcvm);
}

/** Dividend withholding tax on a gross dividend (regular accounts only). */
export function dividendTax(gross, isPea, vat, rate) {
  if (isPea) return 0;
  return roundMoney(gross * (1 + vat) * rate);
}
