// ============================================================
// money.js - integer-cents money helper.
//
// Floating-point money math (0.1 + 0.2 !== 0.3) accumulates drift across the
// FIFO/fee/tax pipeline. This module centralises rounding so every monetary
// result is snapped to whole centimes (0.01 MAD) at defined boundaries, while
// share quantities keep full precision (OPCVM funds are fractional).
//
// Pure functions only - no DOM, no globals. Imported by the financial core
// AND the test suite.
// ============================================================

/** Round a MAD amount to whole centimes (2 dp), avoiding binary-float drift. */
export function roundMoney(v) {
  if (v == null || !isFinite(v)) return 0;
  // Scale, round half-away-from-zero, unscale. The +Number.EPSILON nudge fixes
  // cases like 1.005 that would otherwise round down due to float representation.
  const sign = v < 0 ? -1 : 1;
  const n = Math.abs(v) * 100;
  return (sign * Math.round(n + Number.EPSILON)) / 100;
}

/** Convert MAD -> integer centimes (safe for exact accumulation). */
export function toCents(v) {
  if (v == null || !isFinite(v)) return 0;
  const sign = v < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(v) * 100 + Number.EPSILON);
}

/** Convert integer centimes -> MAD. */
export function fromCents(c) {
  return c / 100;
}

/** Sum a list of MAD amounts with cent-exact accumulation. */
export function sumMoney(values) {
  let cents = 0;
  for (const v of values) cents += toCents(v);
  return fromCents(cents);
}

/**
 * A share quantity times a per-share price, rounded to centimes once.
 * Keeps qty at full precision (fractional OPCVM units) but rounds the money.
 */
export function amount(qty, price) {
  return roundMoney((Number(qty) || 0) * (Number(price) || 0));
}

/** Quantity epsilon: below this, a share quantity is treated as zero. */
export const QTY_EPS = 1e-9;
