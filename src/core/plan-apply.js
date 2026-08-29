// ============================================================
// plan-apply.js - pure recompute of a recurring-cost plan onto the savings log.
//
// This is the shared computation behind eApplyCarPlan / eApplyOtherPlan in
// js/07-expenses.js. Extracted here so the LIVE logic is unit-tested (the UI
// functions call this exact code, so there's no replica to drift). Pure: no
// globals, no DOM, no persistence - the caller injects the realized-check and
// note-builder and owns the side effects (save + re-render).
//
// Rule (single source of truth for Car & Other columns):
//   - REALIZED months are never rewritten (real recorded history).
//   - Every non-realized month reflects the current plan:
//       * a plan-payment month  -> value = monthlySave - cost, note = names
//       * any other month        -> value = monthlySave (when > 0)
//   Past-DATED-but-unrealized months ARE recomputed (that's the point: a cost
//   added for a month you haven't marked done should still flow into the log).
// ============================================================

/**
 * Sum the plan's cost per calendar month (1..12).
 * @param {Array<{amt:number, months:number[]}>} plan
 * @returns {Object} month(1-12) -> total absolute cost
 */
export function planCostByMonth(plan) {
  const byMonth = {};
  (plan || []).forEach((c) => {
    (c.months || []).forEach((m) => {
      byMonth[m] = (byMonth[m] || 0) + Math.abs(+c.amt || 0);
    });
  });
  return byMonth;
}

/**
 * Recompute a bucket column of the savings log from a recurring-cost plan.
 * Mutates the `log` rows in place (matching the UI's behaviour) and returns the
 * number of plan-payment months applied.
 *
 * @param {Object}   o
 * @param {Array}    o.plan          recurring costs [{name, amt, months[]}]
 * @param {number}   o.monthlySave   the monthly set-aside (0 if unset)
 * @param {Array}    o.log           log rows [{month:"YYYY-MM", ...}]
 * @param {string}   o.valueKey      row field to write (e.g. "car" | "btOther")
 * @param {string}   o.noteKey       row field for the auto note (e.g. "note" | "noteBt")
 * @param {(row)=>boolean} o.isRealized   returns true if the row is realized (locked)
 * @param {(mo:number)=>string} o.noteForMonth  builds the note for a payment month
 * @returns {number} count of payment months applied
 */
export function applyPlanToLog(o) {
  const {
    plan,
    monthlySave,
    log,
    valueKey,
    noteKey,
    isRealized,
    noteForMonth,
  } = o;
  const byMonth = planCostByMonth(plan);
  const save = Math.max(0, +monthlySave || 0);
  let applied = 0;
  (log || []).forEach((r) => {
    const mm = /^(\d{4})-(\d{2})$/.exec((r && r.month) || "");
    if (!mm) return;
    if (isRealized(r)) return; // realized -> locked, never rewritten
    const mo = +mm[2];
    const cost = byMonth[mo] || 0;
    if (cost > 0) {
      r[valueKey] = save - cost;
      if (noteKey) r[noteKey] = noteForMonth(mo);
      applied++;
    } else if (save > 0) {
      r[valueKey] = save;
    }
  });
  return applied;
}
