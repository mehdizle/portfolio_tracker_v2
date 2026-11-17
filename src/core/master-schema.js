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
  { key: "fcfFy" }, // 1 = fcf is the last-fiscal-year fallback, 0 = TTM
  { key: "revenue" },
  { key: "shares" }, // total shares outstanding (for Revenue/Sh = revenue/shares)
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
 * Onboard a ticker from a prices.json record: create M[tk] if it doesn't exist
 * (e.g. a new IPO the user just bought), then apply the record's metrics.
 * A new record gets the TradingView company name and NO category (cat/cycle/
 * style null -> "Uncategorized"): TradingView's sector taxonomy doesn't map
 * cleanly onto the app's categories, so the user is asked instead; tvSector is
 * kept as a hint. An existing record only gains a name/hint it lacks - its
 * categories are never touched. Returns true if a record was created.
 */
export function onboardTvRec(M, tk, rec) {
  if (!tk || !rec) return false;
  const company =
    typeof rec.company === "string" && rec.company.trim()
      ? rec.company.trim()
      : null;
  let created = false;
  if (!M[tk]) {
    M[tk] = { name: company || tk, cat: null, cycle: null, style: null };
    created = true;
  } else if (!M[tk].name && company) {
    M[tk].name = company;
  }
  if (typeof rec.tvSector === "string" && rec.tvSector && !M[tk].tvSector)
    M[tk].tvSector = rec.tvSector;
  applyTvRec(M, tk, rec);
  // A trade/order price used as a stand-in (set by the add forms) has now been
  // replaced by the feed's market price - it's a normal record from here on.
  if (isNum(rec.price)) delete M[tk]._seedPrice;
  return created;
}

/**
 * Fill-only refresh: copy record metrics onto M[tk] ONLY where M[tk] has no
 * value yet. Never overwrites anything (manual price edits, older fetched
 * values), so it's safe to run automatically - it just lets a new listing
 * complete itself as TradingView publishes more data. fcfFy (the FCF period
 * tag) is only filled together with fcf so the tag always matches the value.
 * Returns the number of fields filled.
 */
export function fillTvGaps(M, tk, rec) {
  const target = M[tk];
  if (!target || !rec) return 0;
  let n = 0;
  for (const f of TV_METRICS) {
    if (f.key === "fcfFy") continue;
    const k = f.store || f.key;
    if (!isNum(target[k]) && isNum(rec[f.key])) {
      target[k] = rec[f.key];
      n++;
      if (f.key === "fcf" && isNum(rec.fcfFy)) target.fcfFy = rec.fcfFy;
    }
  }
  return n;
}

/**
 * Data-completeness report for one STOCK master record (pure). Returns a list
 * of short issue codes; [] = complete. Used by the in-app data-health check so
 * a new listing (IPO) that's missing pieces is visible instead of silent.
 *   noRecord / noPrice   -> can't be valued (hard error)
 *   seedPrice            -> valued at the trade price, no market price yet
 *   noCategory / noCycle / noStyle -> categories not set (manual step)
 *   noRange              -> no 52-week low/high yet
 *   noFundamentals       -> none of P/E, P/B, EPS, BVPS, yield, DPS
 *   notInFeed            -> absent from the latest daily price file
 */
export function stockDataIssues(m, inFeed) {
  if (!m) return ["noRecord"];
  const out = [];
  if (!isNum(m.price)) out.push("noPrice");
  else if (m._seedPrice) out.push("seedPrice"); // still valued at the trade price
  const cat = String(m.cat || "").trim();
  if (!cat || cat.toUpperCase() === "STOCK") out.push("noCategory");
  if (!m.cycle) out.push("noCycle");
  if (!m.style) out.push("noStyle");
  if (!isNum(m.low) || !isNum(m.high)) out.push("noRange");
  if (!["pe", "pb", "eps", "bvps", "divy", "dps"].some((k) => isNum(m[k])))
    out.push("noFundamentals");
  if (inFeed === false) out.push("notInFeed");
  return out;
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
