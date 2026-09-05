// ============================================================
// master-schema.js - single source of truth for MASTER-LIST (M) metadata
// fields that IMPORTERS populate (TradingView paste + OPCVM fund file).
//
// The bug this prevents: parseTV() builds a `rec` with ~19 fields and applyTV()
// separately copies each one onto M[tk] with a hand-written list. If someone
// adds a metric to the parser but forgets the matching copy line, the value is
// silently dropped. Driving the copy from TV_METRICS (and asserting coverage in
// a test) makes that impossible.
//
// Pure module: no DOM, no globals. The parser still owns column-index mapping
// and scaling (that's inherently feed-specific); this module owns the
// field list + the mechanical copy-with-guard onto M.
// ============================================================

/**
 * TV_METRICS: every numeric metric a TradingView paste can populate on M[tk].
 * The parser emits rec[key]; applyTvRec copies rec[key] -> M[tk][store] when the
 * value is a real number. `store` defaults to `key` (all current fields match).
 *
 * NOTE on scaling: divy/roe/epsGrowth are stored as DECIMALS (e.g. 3% -> 0.03).
 * The parser divides by 100 as it reads the feed, so rec already holds decimals
 * and this module performs a plain guarded copy - matching current behaviour
 * exactly. `scaledInParser: true` documents which fields are pre-scaled so the
 * round-trip test can verify the parser side.
 */
export const TV_METRICS = [
  { key: "price" },
  { key: "low" },
  { key: "high" },
  { key: "pe" },
  { key: "pb" },
  { key: "peg" },
  { key: "divy", scaledInParser: true }, // % -> decimal
  { key: "ev" },
  { key: "netdebt" },
  { key: "roe", scaledInParser: true }, // % -> decimal
  { key: "eps" },
  { key: "bvps" },
  { key: "dps" },
  { key: "fcf" },
  { key: "revenue" },
  { key: "epsGrowth", scaledInParser: true }, // % -> decimal
];

/** OPCVM fund-file fields. `weeklyOnly` fields are ignored on daily refreshes
 *  (a daily file must never overwrite stored fees). `always` fields are copied
 *  even when the value is null (isin is always written, matching current code). */
export const OPCVM_FIELDS = [
  { key: "vl", store: "price" }, // NAV -> price; only when non-null
  { key: "isin", store: "isin", always: true }, // always set (even null)
  { key: "buyFee", store: "buyFee", weeklyOnly: true },
  { key: "sellFee", store: "sellFee", weeklyOnly: true },
  { key: "mgmt", store: "mgmt", weeklyOnly: true },
];

/**
 * CAL_FIELDS: the canonical shape of a dividend-calendar entry (what the
 * calendar parser emits and what the downloadable template advertises). The
 * parser itself is intentionally format-FLEXIBLE (tab/space/block layouts,
 * column-order-independent), so it does not bind to a fixed header - but the
 * OUTPUT shape and the template header derive from this one list so they can
 * never drift. `header` is the human column label used in the template.
 */
export const CAL_FIELDS = [
  { key: "ticker", header: "Ticker" },
  { key: "issuer", header: "Issuer" },
  { key: "amount", header: "Amount" },
  { key: "ex_date", header: "Ex-date" },
  { key: "pay_date", header: "Payment date" },
  { key: "div_type", header: "Type" },
];

/** Column headers (in order) for the dividend-calendar template. */
export function calTemplateHeader() {
  return CAL_FIELDS.map((f) => f.header);
}

/** Field keys of a calendar entry (for coverage tests). */
export function calFieldKeys() {
  return CAL_FIELDS.map((f) => f.key);
}

const isNum = (v) => v != null && !isNaN(v);

/**
 * Copy TradingView `rec` onto M[tk] using TV_METRICS. Only real numbers are
 * written (null/NaN skipped), matching applyTV's `set()` guard. The category is
 * handled specially: set only if the master entry has no category yet
 * (M[tk].cat = M[tk].cat || rec.category), same as current behaviour.
 * Mutates M[tk]; returns the number of metric fields written.
 */
export function applyTvRec(M, tk, rec) {
  const target = M[tk];
  if (!target) return 0;
  let written = 0;
  for (const f of TV_METRICS) {
    const v = rec[f.key];
    if (isNum(v)) {
      target[f.store || f.key] = v;
      written++;
    }
  }
  if (rec.category) target.cat = target.cat || rec.category;
  return written;
}

/**
 * Apply one parsed OPCVM fund record `f` onto M[tk] using OPCVM_FIELDS.
 * `weekly` gates the fee/mgmt fields. Mirrors the applyBtn loop exactly:
 *  - price (vl) only when non-null;
 *  - isin always written;
 *  - buyFee/sellFee/mgmt only on weekly files, only when non-null.
 * Mutates M[tk]; returns { priceUpdated, feeUpdated } counters.
 */
export function applyOpcvmFund(M, tk, f, weekly) {
  const target = M[tk];
  const out = { priceUpdated: false, feeUpdated: false };
  if (!target) return out;
  for (const fld of OPCVM_FIELDS) {
    const v = f[fld.key];
    if (fld.weeklyOnly && !weekly) continue;
    if (fld.always) {
      target[fld.store] = v; // isin: written even when null
      continue;
    }
    if (v == null) continue;
    target[fld.store] = v;
    if (fld.store === "price") out.priceUpdated = true;
    if (fld.key === "buyFee") out.feeUpdated = true;
  }
  return out;
}

/** Field keys the TV parser is expected to be able to emit (for coverage tests). */
export function tvMetricKeys() {
  return TV_METRICS.map((f) => f.key);
}
