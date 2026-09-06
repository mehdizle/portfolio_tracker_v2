// ============================================================
// market-session.js - Casablanca Stock Exchange session schedule + pure phase
// logic (no DOM, no Intl). The UI (09-boot.js) owns "what time is it in
// Casablanca" (casaNow, via Intl) and rendering; this module owns the schedule
// and the pure classification so it is unit-testable.
//
// Times are local Casablanca time, "HH:MM". A phase is [start, end) except a
// `point: true` phase (a single instant, e.g. the fixing).
// ============================================================

export const MARKET_GROUPS = [
  {
    id: "continuous",
    name: "Group 1 \u00B7 Continuous",
    note: "Most liquid stocks (e.g. ALM, ATW, IAM). Trade all day with auctions at the open and close.",
    phases: [
      { key: "preopen", label: "Pre-Opening", start: "08:10", end: "09:00", desc: "Orders are entered but no trades occur." },
      { key: "openauct", label: "Opening Auction", start: "09:00", end: "09:30", desc: "System calculates the opening price and executes matches." },
      { key: "continuous", label: "Continuous Trading", start: "09:30", end: "15:20", desc: "Real-time trading \u2014 orders match instantly if prices align." },
      { key: "closeauct", label: "Closing Auction", start: "15:20", end: "15:30", desc: "Trading freezes to calculate the final closing price." },
      { key: "tal", label: "Trading At Last", start: "15:30", end: "15:40", desc: "Buy/sell only at the fixed closing price." },
    ],
  },
  {
    id: "fixing",
    name: "Group 3 \u00B7 Fixing",
    note: "Less liquid stocks (e.g. MLE, REB, BAL). No real-time trading \u2014 everything happens in one burst.",
    phases: [
      { key: "accum", label: "Order Accumulation", start: "08:10", end: "14:30", desc: "You place orders, but they just sit in the book." },
      { key: "fixing", label: "The Fixing", start: "14:30", end: "14:30", point: true, desc: "The only time of day trades are executed." },
      { key: "postfix", label: "Post-Fixing", start: "14:30", end: "15:45", desc: "Orders can be adjusted for the next day." },
    ],
  },
];

export const MARKET_DAY_OPEN = "08:10";
export const MARKET_DAY_CLOSE = "15:45"; // latest phase end across both groups

/** "HH:MM" -> minutes since midnight. */
export function toMins(hhmm) {
  const [h, m] = String(hhmm)
    .split(":")
    .map((x) => parseInt(x, 10));
  return h * 60 + m;
}

/** "HH:MM \u2013 HH:MM" (or just the start for a point phase). */
export function fmtRange(p) {
  return p.point ? p.start : p.start + " \u2013 " + p.end;
}

/**
 * Classify each phase relative to nowMins (minutes since midnight).
 * Returns phases annotated with sMin/eMin and state = "past" | "now" | "upcoming".
 * When marketOpenToday is false (weekend/holiday), nothing is "now": phases are
 * "upcoming" before the day opens and "past" after.
 */
export function classifyPhases(phases, nowMins, marketOpenToday) {
  const out = phases.map((p) => ({
    ...p,
    sMin: toMins(p.start),
    eMin: toMins(p.end),
  }));
  let currentIdx = -1;
  if (marketOpenToday) {
    for (let i = 0; i < out.length; i++) {
      const p = out[i];
      const inWin = p.point
        ? nowMins === p.sMin
        : nowMins >= p.sMin && nowMins < p.eMin;
      if (inWin) {
        currentIdx = i;
        break;
      }
    }
  }
  return out.map((p, i) => {
    let state;
    if (!marketOpenToday) state = nowMins < out[0].sMin ? "upcoming" : "past";
    else if (i === currentIdx) state = "now";
    else if (currentIdx === -1) state = nowMins < p.sMin ? "upcoming" : "past";
    else state = i < currentIdx ? "past" : "upcoming";
    return { ...p, state };
  });
}

/**
 * Short headline for the market button given minutes-since-midnight and a
 * weekend flag: "Closed \u00B7 weekend", "Pre-market", "Closed", the current
 * continuous-group phase label, or "Open".
 */
export function overallLabel(nowMins, isWeekend, groups) {
  if (isWeekend) return "Closed \u00B7 weekend";
  if (nowMins < toMins(MARKET_DAY_OPEN)) return "Pre-market";
  if (nowMins >= toMins(MARKET_DAY_CLOSE)) return "Closed";
  const cont = (groups || MARKET_GROUPS)[0];
  for (const p of cont.phases) {
    const s = toMins(p.start),
      e = toMins(p.end);
    if (p.point ? nowMins === s : nowMins >= s && nowMins < e) return p.label;
  }
  return "Open";
}
