// ============================================================
// connection-manifest.js - the "rule that lists every connection".
//
// This is the machine-checkable contract the connections test enforces. It
// does NOT duplicate field data (that lives in txn-schema.js); it derives the
// field->UI connections from TXN_FIELDS and adds the connections a data schema
// can't express: which VIEWS must be refreshed by render() because they display
// live market data.
//
// The paired test (test/connections.test.js) reads the REAL source files from
// disk and fails CI if any declared connection is missing. That turns three
// silent-bug classes into red builds:
//   1. a schema field with no matching HTML <input>          (add-field gap)
//   2. a renamed/removed input id the form still references   (modify/delete gap)
//   3. a price-displaying view not wired into render()        (today's bug)
//
// Pure module: no DOM, no globals.
// ============================================================
import { TXN_FIELDS, txnFormToPendingForm } from "./txn-schema.js";

/**
 * FIELD_CONNECTIONS: for every FORM-BOUND transaction field, the concrete
 * places it must be connected:
 *   - txnInput:     the id="tXxx" control in the transaction form
 *   - pendingInput: the id="pXxx" control in the pending form
 *   - csv:          the CSV column header it serialises to
 * Derived from the schema so it can never drift from TXN_FIELDS.
 */
export const FIELD_CONNECTIONS = TXN_FIELDS.filter((f) => f.form).map((f) => ({
  key: f.key,
  txnInput: f.form,
  pendingInput: txnFormToPendingForm(f.form),
  csv: f.csv,
}));

/**
 * RENDER_CONNECTIONS: view functions that display live market data
 * (M[ticker].price and values derived from it) and therefore MUST be invoked by
 * the master render() so they refresh when a price changes (TradingView paste,
 * OPCVM file, manual "Set price"). If you add a new view that shows a live
 * price/value, add it here and the checker enforces that render() calls it.
 *
 * `reason` documents why each is price-sensitive (for humans reading failures).
 */
export const RENDER_CONNECTIONS = [
  { fn: "renderKPIs", reason: "portfolio value / unrealized use live price" },
  { fn: "renderPositions", reason: "position value column uses live price" },
  { fn: "renderSignals", reason: "signal targets compare to live price" },
  { fn: "renderDividends", reason: "dividend yield vs live price" },
  {
    fn: "renderPending",
    reason: "pending live-price + expected-total columns",
  },
  { fn: "renderConcentration", reason: "weights use live position values" },
];

/** Every HTML input id that must exist for the transaction form. */
export function txnInputIds() {
  return FIELD_CONNECTIONS.map((c) => c.txnInput);
}

/** Every HTML input id that must exist for the pending form. */
export function pendingInputIds() {
  return FIELD_CONNECTIONS.map((c) => c.pendingInput);
}

/** Every CSV column that must appear in the transaction CSV header. */
export function csvColumns() {
  return FIELD_CONNECTIONS.map((c) => c.csv);
}

/** Every view fn name that render() must call. */
export function requiredRenderCalls() {
  return RENDER_CONNECTIONS.map((c) => c.fn);
}

/**
 * SAVE_REFRESH_CONNECTIONS: data-save functions whose stored data feeds the
 * Dashboard KPI row, and therefore MUST call refreshKpiRow() so the cards
 * (Cash Available, Pending Orders, Stock/OPCVM Value, Unrealized P&L,
 * Dividends, Upcoming Dividends) never go stale when data changes from any tab.
 *
 * This encodes the single-source-of-truth rule: the DATA WRITE owns refreshing
 * its dependents, not each UI call site. The checker (connections.test.js)
 * reads each save function's body from disk and fails CI if the refresh call is
 * missing - so a new save path can't silently reintroduce the staleness bug.
 *
 *  - fn:     the save function name (as declared: `function <fn>(`)
 *  - file:   the source file it lives in (relative to repo root)
 *  - must:   the call that must appear inside its body
 *  - reason: why its data feeds the KPI row (for humans reading failures)
 */
export const SAVE_REFRESH_CONNECTIONS = [
  {
    fn: "saveTxns",
    file: "js/01-core.js",
    must: "refreshKpiRow",
    reason:
      "transactions drive every KPI (value, unrealized, dividends, splits)",
  },
  {
    fn: "savePending",
    file: "js/06d-pending.js",
    must: "refreshKpiRow",
    reason:
      "pending orders drive Cash Available, Pending Orders, Upcoming Dividends",
  },
  {
    fn: "saveCash",
    file: "js/08-salary.js",
    must: "refreshKpiRow",
    reason: "cash movements drive Cash Available",
  },
];

/** The save->refresh connections the checker must verify. */
export function requiredSaveRefreshes() {
  return SAVE_REFRESH_CONNECTIONS.slice();
}

/**
 * PLAN_RECOMPUTE_CONNECTIONS: the Savings-Pots recurring-cost planners are the
 * single source for the Car/Other columns of the savings log. Editing a cost
 * (amount, months, add, delete) or the monthly set-aside must RECOMPUTE the log
 * via eApplyCarPlan()/eApplyOtherPlan() - not merely re-render stale stored
 * values. This was the exact "added a car cost but the log didn't change" bug.
 * The renderer functions below own the per-row edit handlers, so each MUST
 * reference its apply function.
 *
 *  - fn:     the renderer function whose edit handlers must recompute
 *  - file:   the source file it lives in
 *  - must:   the apply call that must appear in its body
 */
export const PLAN_RECOMPUTE_CONNECTIONS = [
  {
    fn: "eRenderCarPlan",
    file: "js/07-expenses.js",
    must: "eApplyCarPlan",
    reason:
      "car-cost edits must recompute the log's Car column, not restale it",
  },
  {
    fn: "eRenderOtherPlan",
    file: "js/07-expenses.js",
    must: "eApplyOtherPlan",
    reason: "other-cost edits must recompute the log's Other column",
  },
];

/** The plan-recompute connections the checker must verify. */
export function requiredPlanRecomputes() {
  return PLAN_RECOMPUTE_CONNECTIONS.slice();
}
