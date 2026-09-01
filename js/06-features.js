// ============================================================
// 06-features.js
// features: signals render, dividends dashboards, transactions, pending, forms wiring, TV/CSV/calendar import, broker fee UI, backup/restore, bulk edit, recently bought/sold
// Part of the Portfolio Tracker app. Loaded as an ordered plain
// <script> (shared global scope) - order matters, see index.html.
// ============================================================
function renderSignals() {
  try {
    renderTopBuys();
  } catch (e) {
    console.error("topBuys", e);
  }
  const f = document.getElementById("sigFilter").value;
  const at = (document.getElementById("sigAsset") || {}).value || "stocks";
  let rows = computeSignalsRows();
  if (at === "stocks") rows = rows.filter((r) => !(r.m && r.m.cat === "OPCVM"));
  else if (at === "opcvm")
    rows = rows.filter((r) => r.m && r.m.cat === "OPCVM");
  if (f === "buy") rows = rows.filter((r) => r.sig.c === "b-buy");
  else if (f === "sell")
    rows = rows.filter((r) => r.sig.c === "b-sell" || r.sig.c === "b-trim");
  else if (f === "held") rows = rows.filter((r) => r.held);
  // Free-text search across ticker + name (case-insensitive).
  const _sq = ((document.getElementById("sigSearch") || {}).value || "")
    .trim()
    .toLowerCase();
  if (_sq)
    rows = rows.filter((r) =>
      ((r.ticker || "") + " " + (r.name || "")).toLowerCase().includes(_sq),
    );
  // If the user hasn't clicked a column header, sort by SIGNAL STRENGTH for the active filter:
  //   Buy filter  -> strongest buys first;  Sell filter -> most urgent sells first.
  const userSorted = typeof SIG_SORT !== "undefined" && SIG_SORT.userSet;
  // Group rank for the "All" view: Buys first, then Wait/Hold, then Sells/Trims.
  const groupRank = (r) =>
    r.sig.c === "b-buy"
      ? 0
      : r.sig.c === "b-wait" || r.sig.c === "b-hold"
        ? 1
        : 2;
  if (!userSorted && f === "buy") {
    rows.sort((a, b) => buyStrength(b) - buyStrength(a));
  } else if (!userSorted && f === "sell") {
    rows.sort((a, b) => sellUrgency(b) - sellUrgency(a));
  } else if (!userSorted && (f === "all" || f === "held")) {
    // Ranked: strongest buys \u2192 holds/waits \u2192 most urgent sells.
    // Within the middle "Hold / Wait" band, cluster identical signal labels together
    // (all HOLDs, then WAITs, then AVOIDs) so the list doesn't visually zig-zag between
    // labels; within each label, best score first. (Rows are score-ranked overall, but
    // grouping like-labels makes the ordering read cleanly.)
    const midLabelRank = (r) => {
      const t = (r.sig && r.sig.t) || "";
      if (t.indexOf("HOLD") >= 0) return 0; // fairly valued
      if (t.indexOf("WAIT") >= 0) return 1; // cheap-ish but wait for entry
      if (t.indexOf("AVOID") >= 0) return 2; // rich / overvalued / weak
      return 3; // any other wait/hold variant
    };
    rows.sort((a, b) => {
      const ga = groupRank(a),
        gb = groupRank(b);
      if (ga !== gb) return ga - gb;
      if (ga === 0) return buyStrength(b) - buyStrength(a); // buys: strongest first
      if (ga === 2) return sellUrgency(b) - sellUrgency(a); // sells: most urgent first
      const la = midLabelRank(a),
        lb = midLabelRank(b); // holds/waits: cluster by label\u2026
      if (la !== lb) return la - lb;
      return (b.score || 0) - (a.score || 0); // \u2026then best score first within a label
    });
  } else {
    const k =
      typeof SIG_SORT !== "undefined" && SIG_SORT.k ? SIG_SORT.k : "score";
    const d = typeof SIG_SORT !== "undefined" ? SIG_SORT.d : -1;
    rows.sort((a, b) => {
      let x = a[k],
        y = b[k];
      if (typeof x === "string")
        return d * String(x).localeCompare(String(y || ""));
      return d * ((x || 0) - (y || 0));
    });
  }
  window._sigRows = {};
  rows.forEach((r) => (window._sigRows[r.ticker] = r));
  // Group dividers only in the ranked (non-user-sorted) All/Held views
  const showDividers = !userSorted && (f === "all" || f === "held");
  const grpLabel = (r) =>
    r.sig.c === "b-buy"
      ? "\uD83D\uDFE2 Buy Opportunities"
      : r.sig.c === "b-wait" || r.sig.c === "b-hold"
        ? "\u26AA Hold / Wait"
        : "\uD83D\uDD34 Sell / Trim";
  const divider = (txt) =>
    `<tr><td colspan="12" style="background:var(--panel2);color:var(--text2);font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:7px 10px">${txt}</td></tr>`;
  let lastGrp = null;
  const rowHtml = (r) => `<tr class="${r.held ? "held-row" : ""} sig-row">
    <td class="l" style="cursor:pointer" data-tip="Click to draft a pending order for ${escapeHtml(r.ticker)}" data-act="prefillPending" data-args="${r.ticker}" data-stop="true"><b style="color:var(--primary2)">${escapeHtml(r.ticker)}</b>${r.held ? ' <span class="tag-in">held</span>' : ""}</td>
    <td class="l" style="cursor:pointer;color:var(--text2)" data-tip="Click for full company details" data-act="showCompanyDetail" data-args="${r.ticker}" data-stop="true">${escapeHtml(r.name || "")}</td>
    <td class="center nis-cell" style="cursor:help" data-tip="${tipRef(signalTipHTML(r))}"><span class="badge ${r.sig.c}">${r.sig.t}</span> <span style="color:var(--muted)">\u24D8</span></td>
    <td class="${r.price != null ? "nis-cell" : ""}" style="${r.price != null ? "cursor:help" : ""}" data-tip="${r.price != null ? tipRef(priceTipHTML(r)) : ""}">${r.price != null ? money(r.price) : "\u2014"}${r.price != null && r.fv != null && r.fv > 0 ? (r.price < r.fv ? ' <span style=\"color:var(--success)\" title=\"Below fair value\">\u25B2</span>' : r.price > r.fv ? ' <span style=\"color:var(--error)\" title=\"Above fair value\">\u25BC</span>' : "") : ""}</td><td class="${r.fv != null ? "nis-cell" : ""}" style="${r.fv != null ? "cursor:help" : ""}" data-tip="${r.fv != null ? tipRef(fvTipHTML(r)) : ""}">${r.fv != null ? money(r.fv) : "\u2014"}</td>
    <td class="${r.tbuy != null ? "nis-cell" : ""}" style="${r.tbuy != null ? "cursor:help" : ""}" data-tip="${r.tbuy != null ? tipRef(tgtBuyTipHTML(r)) : ""}">${r.tbuy != null ? money(r.tbuy) : "\u2014"}</td>
    <td class="${r.tsell != null ? "nis-cell" : ""}" style="${r.tsell != null ? "cursor:help" : ""}" data-tip="${r.tsell != null ? tipRef(tgtSellTipHTML(r)) : ""}">${r.tsell != null ? money(r.tsell) : "\u2014"}</td>
    <td class="${r.score != null ? "nis-cell" : ""}" style="${r.score != null ? "cursor:help" : ""}" data-tip="${r.score != null ? tipRef(scoreTipHTML(r)) : ""}">${r.score != null ? (r.score * 100).toFixed(0) + "%" : "\u2014"}</td>
    <td class="center ${r.sc ? "nis-cell" : ""}" style="${r.sc ? "cursor:help" : ""}" data-tip="${r.sc ? tipRef(convTipHTML(r)) : ""}">${r.conviction ? `<span class="chip" style="background:${r.conviction === "High" ? "rgba(34,197,94,.15);color:var(--success)" : r.conviction === "Medium" ? "rgba(245,158,11,.15);color:var(--warn)" : "rgba(239,68,68,.15);color:var(--error)"}">${r.conviction}</span>` : "\u2014"}</td>
    <td class="${r.pir != null ? "nis-cell" : ""}" style="${r.pir != null ? "cursor:help" : ""}" data-tip="${r.pir != null ? tipRef(pirTipHTML(r)) : ""}">${r.pir != null ? pct(r.pir) : "\u2014"}</td><td class="${r.pe != null ? "nis-cell" : ""}" style="${r.pe != null ? "cursor:help" : ""}" data-tip="${r.pe != null ? tipRef(peTipHTML(r)) : ""}">${r.pe != null ? money(r.pe, 1) : "\u2014"}</td>
    <td class="${r.divy != null ? "nis-cell" : ""}" style="${r.divy != null ? "cursor:help" : ""}" data-tip="${r.divy != null ? tipRef(divyTipHTML(r)) : ""}">${r.divy != null ? pct(r.divy) : "\u2014"}</td></tr>`;
  const _tb = rows
    .map((r) => {
      let out = "";
      if (showDividers) {
        const g = grpLabel(r);
        if (g !== lastGrp) {
          out += divider(g);
          lastGrp = g;
        }
      }
      return out + rowHtml(r);
    })
    .join("");
  document.querySelector("#sigTable tbody").innerHTML =
    _tb ||
    `<tr><td colspan="12" class="l" style="color:var(--muted);padding:14px">${_sq ? "No opportunities match \u201c" + escapeHtml(_sq) + "\u201d." : "No opportunities."}</td></tr>`;
  // Signal-outcome tracking: snapshot today's signals (once/day) and render how
  // past calls have played out. Wrapped in try so it can never break the table.
  try {
    recordSignalSnapshot(computeSignalsRows());
  } catch (e) {
    console.error("sig snapshot", e);
  }
  try {
    renderSignalOutcomes();
  } catch (e) {
    console.error("sig outcomes", e);
  }
}

// \u2500\u2500 SIGNAL-OUTCOME TRACKING \u2500\u2500
// Persists a dated snapshot of each ticker's signal + price so we can later
// measure whether the engine's calls actually worked (did Buy-rated names rise
// more than Avoid-rated ones?). This is the feedback loop a factor model needs.
const SIGHIST_LS = "casa_signal_hist_v1";
function loadSigHist() {
  try {
    const raw = localStorage.getItem(SIGHIST_LS);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}
function saveSigHist(arr) {
  try {
    if (safeSetItem(SIGHIST_LS, JSON.stringify(arr))) markSaved();
  } catch (e) {}
}
// Bucket a signal class into buy / neutral / sell for aggregate outcome stats.
function _sigBucket(sigC) {
  if (sigC === "b-buy") return "buy";
  if (sigC === "b-sell" || sigC === "b-trim") return "sell";
  return "neutral";
}
// Append one snapshot per ranked ticker, at most once per calendar day. A day
// with an existing snapshot for a ticker is skipped (idempotent re-renders).
function recordSignalSnapshot(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const today = new Date().toISOString().slice(0, 10);
  const hist = loadSigHist();
  // LATEST-of-day wins: index today's existing entry per ticker so a re-snapshot
  // (e.g. after importing fresh prices in the Data tab) OVERWRITES it in place
  // with the newer values, rather than being skipped. One snapshot per ticker
  // per day, always reflecting the most recent data you loaded that day.
  const todayIdx = {};
  for (let i = 0; i < hist.length; i++) {
    if (hist[i].date === today) todayIdx[hist[i].ticker] = i;
  }
  let changed = 0;
  for (const r of rows) {
    if (!r || !r.ticker || r.price == null) continue;
    const rec = {
      date: today,
      ticker: r.ticker,
      sig: (r.sig && r.sig.c) || "",
      label: (r.sig && r.sig.t) || "",
      score: r.score != null ? r.score : null,
      price: r.price,
      fv: r.fv != null ? r.fv : null,
    };
    const at = todayIdx[r.ticker];
    if (at != null)
      hist[at] = rec; // overwrite today's entry (latest wins)
    else {
      todayIdx[r.ticker] = hist.length;
      hist.push(rec);
    }
    changed++;
  }
  // Cap history so it can't grow unbounded (keep ~2y of daily snapshots).
  const MAX = 20000;
  if (hist.length > MAX) hist.splice(0, hist.length - MAX);
  if (changed) saveSigHist(hist);
}
// Take a signal snapshot right now (used by the Data-tab importers, which is the
// most accurate trigger - the snapshot reflects the prices just loaded).
// Guarded so it can never break an import; latest-of-day overwrites earlier.
function snapshotSignalsNow() {
  try {
    if (typeof computeSignalsRows === "function")
      recordSignalSnapshot(computeSignalsRows());
  } catch (e) {
    console.error("sig snapshot (import)", e);
  }
}
// Build the outcome panel: for snapshots older than a horizon, compare the
// signal-time price to the CURRENT price and aggregate return by signal bucket.
function renderSignalOutcomes() {
  const host = document.getElementById("sigOutcomes");
  if (!host) return;
  const hist = loadSigHist();
  const today = new Date();
  const horizonDays = 30; // only judge calls at least this old
  const curPrice = (tk) => (M[tk] && M[tk].price != null ? M[tk].price : null);
  // Keep, per ticker, the OLDEST snapshot that is at least `horizonDays` old,
  // so each name is judged on its earliest qualifying call (longest track).
  const byTk = {};
  for (const h of hist) {
    const ageD = (today - new Date(h.date)) / 86400000;
    if (ageD < horizonDays) continue;
    if (!byTk[h.ticker] || h.date < byTk[h.ticker].date) byTk[h.ticker] = h;
  }
  // \u2500\u2500 PER-DATE BENCHMARK \u2500\u2500
  // The benchmark for a call made on date D is the AVERAGE price change, from D
  // to now, of EVERY name snapshotted on D (regardless of its signal). Comparing
  // a name's return to this "typical stock starting the same day" isolates
  // whether the SIGNAL added value vs the market just drifting. Computed per
  // start-date so a 60-day-old call is measured against a 60-day benchmark, not
  // a 30-day one. Only names with a current price contribute.
  const benchByDate = {}; // date -> { sum, n }
  for (const s of hist) {
    const now0 = curPrice(s.ticker);
    if (now0 == null || !s.price) continue;
    const r0 = (now0 - s.price) / s.price;
    benchByDate[s.date] = benchByDate[s.date] || { sum: 0, n: 0 };
    benchByDate[s.date].sum += r0;
    benchByDate[s.date].n += 1;
  }
  const benchFor = (dt) => {
    const b = benchByDate[dt];
    return b && b.n ? b.sum / b.n : null;
  };
  const rows = [];
  const agg = {
    buy: { n: 0, sum: 0, exSum: 0, exN: 0 },
    neutral: { n: 0, sum: 0, exSum: 0, exN: 0 },
    sell: { n: 0, sum: 0, exSum: 0, exN: 0 },
  };
  let allSum = 0,
    allN = 0; // overall benchmark across judged names
  for (const tk in byTk) {
    const h = byTk[tk];
    const now = curPrice(tk);
    if (now == null || !h.price) continue;
    const ret = (now - h.price) / h.price; // price change since the call
    const bench = benchFor(h.date); // typical name starting the same day
    const excess = bench != null ? ret - bench : null; // signal value-add
    const bucket = _sigBucket(h.sig);
    agg[bucket].n++;
    agg[bucket].sum += ret;
    if (excess != null) {
      agg[bucket].exSum += excess;
      agg[bucket].exN++;
    }
    allSum += ret;
    allN++;
    rows.push({ tk, h, now, ret, bench, excess, bucket });
  }
  if (!rows.length) {
    host.innerHTML =
      '<div class="mini" style="color:var(--muted)">Signal-outcome tracking is on. Once your saved signals are at least 30 days old, this panel will show how Buy / Hold / Sell calls have performed since. (Snapshots are taken automatically each day you open this tab.)</div>';
    return;
  }
  // Sort by EXCESS return (signal value-add) when available, else raw return.
  rows.sort((a, b) => {
    const ax = a.excess != null ? a.excess : a.ret;
    const bx = b.excess != null ? b.excess : b.ret;
    return bx - ax;
  });
  const pctS = (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%";
  const cls = (x) => (x > 0.0001 ? "pos" : x < -0.0001 ? "neg" : "");
  const avg = (b) => (b.n ? b.sum / b.n : null);
  const exAvg = (b) => (b.exN ? b.exSum / b.exN : null);
  const overallBench = allN ? allSum / allN : null;
  // Bucket card now shows raw avg AND excess-vs-benchmark (the value-add).
  const aggCard = (label, b, tip) => {
    const ex = exAvg(b);
    return (
      `<div class="card nis-cell" data-tip="${tipRef(tip)}" style="cursor:help">` +
      `<div class="label">${label} <span class="mini">(${b.n})</span></div>` +
      `<div class="value ${b.n ? cls(avg(b)) : ""}">${b.n ? pctS(avg(b)) : "\u2014"}</div>` +
      `<div class="mini" style="margin-top:2px">vs bench: <span class="${ex != null ? cls(ex) : ""}">${ex != null ? pctS(ex) : "\u2014"}</span></div>` +
      `</div>`
    );
  };
  let h =
    '<div style="font-weight:700;margin-bottom:6px">\uD83D\uDCC8 Signal outcomes <span class="mini" style="font-weight:400;color:var(--text2)">\u2014 price change since each call (\u2265 30 days old, earliest call per name). "vs bench" = excess over the average name from the same start date.</span></div>';
  h +=
    '<div class="grid kpis" style="margin-bottom:10px">' +
    `<div class="card nis-cell" data-tip="${tipRef("Average price change of ALL judged names over their tracking windows - the market baseline the signal buckets are compared against.")}" style="cursor:help"><div class="label">Benchmark (all) <span class="mini">(${allN})</span></div><div class="value ${overallBench != null ? cls(overallBench) : ""}">${overallBench != null ? pctS(overallBench) : "\u2014"}</div></div>` +
    aggCard(
      "Buy-rated",
      agg.buy,
      "Average price change since the engine first rated these names Buy (\u2265 30 days ago), and the EXCESS over the average name from the same start date. Positive 'vs bench' means the Buy calls beat the typical stock - the signal added value.",
    ) +
    aggCard(
      "Hold/Wait",
      agg.neutral,
      "Average price change since these names were rated Hold/Wait/Avoid, and the excess vs the same-day benchmark.",
    ) +
    aggCard(
      "Sell/Trim",
      agg.sell,
      "Average price change since Sell/Trim, and the excess vs benchmark. NEGATIVE 'vs bench' is the engine being right (these underperformed the typical stock).",
    ) +
    "</div>";
  h +=
    '<div class="scroll"><table style="width:100%;font-size:12px"><thead><tr>' +
    '<th class="l">Ticker</th><th class="l">Call</th><th>On</th><th>Price then</th><th>Price now</th><th>Change</th><th data-tip="Excess return over the average name from the same start date - the signal\'s value-add.">vs bench</th></tr></thead><tbody>';
  for (const x of rows) {
    h +=
      '<tr><td class="l"><b>' +
      escapeHtml(x.tk) +
      '</b></td><td class="l"><span class="badge ' +
      (x.h.sig || "") +
      '">' +
      escapeHtml(x.h.label || x.h.sig || "\u2014") +
      "</span></td><td>" +
      escapeHtml(x.h.date) +
      "</td><td>" +
      money(x.h.price) +
      "</td><td>" +
      money(x.now) +
      '</td><td class="' +
      cls(x.ret) +
      '">' +
      pctS(x.ret) +
      '</td><td class="' +
      (x.excess != null ? cls(x.excess) : "") +
      '">' +
      (x.excess != null ? pctS(x.excess) : "\u2014") +
      "</td></tr>";
  }
  h += "</tbody></table></div>";
  h +=
    '<div class="mini" style="margin-top:6px;color:var(--muted)">Price-only change (excludes dividends &amp; fees). "vs bench" compares each call to the average name from the same start date, isolating the signal\'s value-add. A rough scorecard for the signal engine, not a P&amp;L.</div>';
  host.innerHTML = h;
}
function heldSharesOf(pos, tk) {
  let q = 0;
  for (const k in pos) {
    if (pos[k].ticker === tk) q += pos[k].held;
  }
  return q;
}
// \u2500\u2500 SINGLE SOURCE OF TRUTH for an estimated dividend (blended PEA/Regular) \u2500\u2500
// Splits `shares` into PEA (tax-exempt) and Regular (taxed) portions by shares held
// at the ex-date, then computes gross, fees (0 for OPCVM), withholding tax on the
// Regular portion, and net. Both the tooltip and divNetFor() call this so the number
// is defined once.
function divCalc(d, shares) {
  const yr = new Date(d.pay_date).getFullYear();
  const rate = divRate(yr);
  const exd = d.ex_date || d.pay_date;
  const peaSh = heldBefore(d.ticker, true, exd),
    regSh = heldBefore(d.ticker, false, exd);
  const tot = peaSh + regSh;
  const peaPortion = tot > 1e-9 ? shares * (peaSh / tot) : 0;
  const regPortion = shares - peaPortion;
  const gross = d.amount * shares;
  const _m = M[d.ticker];
  const isOpcvm = !!(_m && _m.cat === "OPCVM");
  // Resolve the regular-account broker for this ticker from its transactions
  // (falls back to Saham) rather than hardcoding, so dividend fees follow the
  // actual broker's DIV commission.
  const _regTxn = (TXNS || []).find((t) => t.ticker === d.ticker && !t.pea);
  const _regBk =
    BROKERS[(_regTxn && txnBroker(_regTxn)) || "saham"] ||
    BROKERS["saham"] ||
    null;
  const _round = __core.money.roundMoney;
  const grossR = _round(gross);
  const fees = isOpcvm
    ? 0
    : _regBk
      ? calcBrokerFees(grossR, "DIV", _regBk, false)
      : _round(grossR * feeRate() + fixedFee());
  // Dividend tax on the REGULAR-account portion only (PEA is exempt). Routed
  // through the shared core so the projected-dividend tax uses the exact same
  // formula as recorded DIV transactions (computeRow -> __core.tax). The gross
  // passed is the regular (taxed) portion; isPea=false since PEA is pre-split.
  const tax = __core.tax.dividendTax(
    d.amount * regPortion,
    false,
    vatRate(),
    rate,
  );
  const net = _round(grossR - fees - tax);
  return {
    yr,
    rate,
    peaPortion,
    regPortion,
    gross: grossR,
    isOpcvm,
    fees,
    tax,
    net,
  };
}
function divEstTipHTML(d, shares) {
  const row = _tipRow; // shared tooltip row builder (gap:18px)
  const _c = divCalc(d, shares);
  const yr = _c.yr,
    rate = _c.rate,
    peaPortion = _c.peaPortion,
    regPortion = _c.regPortion,
    gross = _c.gross,
    _opc = _c.isOpcvm,
    fees = _c.fees,
    tax = _c.tax,
    net = _c.net;
  let h = `<div style="font-weight:700;margin-bottom:6px">Estimated dividend \u00B7 ${d.ticker}</div>`;
  h += row("Amount per share", money(d.amount) + " MAD");
  h += row(
    "Shares held",
    money(shares, shares % 1 ? 3 : 0) +
      (peaPortion > 1e-9
        ? " (" +
          money(peaPortion, peaPortion % 1 ? 3 : 0) +
          " PEA + " +
          money(regPortion, regPortion % 1 ? 3 : 0) +
          " Reg)"
        : ""),
  );
  h += row("Gross", money(gross) + " MAD");
  h += _opc
    ? row('Fund fee <span class="mini">(none on dividends)</span>', "0", "pos")
    : row("\u2212 Fees", "\u2212" + money(fees));
  if (peaPortion > 1e-9) h += row("PEA portion tax", "0 (exempt)", "pos");
  h += row(
    '\u2212 Dividend tax on Reg <span class="mini">(' +
      (rate * 100).toFixed(2) +
      "% incl VAT, " +
      yr +
      ")</span>",
    "\u2212" + money(tax),
  );
  h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>`;
  h += row("<b>Est. net cash</b>", "<b>" + money(net) + " MAD</b>", "pos");
  h += row("Payment date", d.pay_date);
  return h;
}
// Total eligible shares (both accounts) held at a dividend's ex-date.

// ---------- dividend income dashboard ----------
let CH_divIncome = null,
  CH_divReceived = null,
  CH_divByTk = null;
function divNetFor(d, shares) {
  // Net dividend = gross \u2212 fees \u2212 tax (PEA portion exempt). Single source: divCalc().
  return divCalc(d, shares).net;
}
function renderDivDashboard(pos) {
  const _divProject = !!(document.getElementById("divProjectNext") || {})
    .checked;
  // If projecting, clone THIS YEAR's calendar entries shifted +12 months.
  // "This year" = entries whose pay_date is in the current calendar year.
  // Exceptional (one-off) dividends are NOT recurring, so they are excluded
  // from the projection - only ordinary dividends are expected to repeat.
  let _projCal = DIVCAL;
  if (_divProject) {
    const yr = TODAY.getFullYear();
    const shifted = DIVCAL.filter(
      (d) =>
        d.pay_date &&
        d.pay_date.startsWith(String(yr)) &&
        String(d.div_type || "").toLowerCase() !== "exceptional",
    ).map((d) => {
      const nd = d.pay_date.replace(/^\d{4}/, String(yr + 1));
      const ne = d.ex_date ? d.ex_date.replace(/^\d{4}/, String(yr + 1)) : null;
      return { ...d, pay_date: nd, ex_date: ne, _projected: true };
    });
    _projCal = DIVCAL.concat(shifted);
  }
  // Expected income: dividends you're eligible for (held before ex-date) that are upcoming
  // OR just passed (within 30 days) but not yet recorded. Uses ex-date eligibility.
  const upcoming = _projCal.filter((d) => {
    if (!d.pay_date || eligibleSharesAtEx(d) <= 0) return false;
    const du = daysUntil(d.pay_date);
    return du >= 0 || (du >= -30 && !divRecorded(d));
  });
  let inc90 = 0,
    inc12 = 0;
  const byMonth = {},
    byMonthTk = {},
    det90 = [],
    det12 = [];
  for (const d of upcoming) {
    const sh = eligibleSharesAtEx(d);
    const net = divNetFor(d, sh);
    const du = daysUntil(d.pay_date);
    const item = {
      ticker: d.ticker,
      date: d.pay_date,
      amount: net,
      sh: sh,
    };
    if (du <= 90) {
      inc90 += net;
      det90.push(item);
    }
    if (du <= 365) {
      inc12 += net;
      det12.push(item);
    }
    const mk = d.pay_date.slice(0, 7);
    byMonth[mk] = (byMonth[mk] || 0) + net;
    (byMonthTk[mk] = byMonthTk[mk] || {})[d.ticker] =
      (byMonthTk[mk][d.ticker] || 0) + net;
  }
  // Received YTD (recorded DIV transactions this calendar year) \u2014 with detail
  const yr = TODAY.getFullYear();
  let received = 0;
  const detRecv = [];
  for (const t of TXNS) {
    if (t.action === "DIV" && new Date(t.date).getFullYear() === yr) {
      const r = computeRow(t, 0);
      received += r.net;
      detRecv.push({ ticker: t.ticker, date: t.date, amount: r.net });
    }
  }
  // Build an HTML detail tooltip: title + per-dividend rows (ticker \u00B7 date \u00B7 amount), sorted by date
  const detTip = (title, lines, arr) => {
    let h =
      `<div style="font-weight:700;margin-bottom:6px">${title}</div>` +
      lines
        .map((l) => `<div class="mini" style="margin:0">${l}</div>`)
        .join("");
    if (arr && arr.length) {
      h += `<div style="border-top:1px solid var(--border);margin:6px 0;padding-top:6px"></div>`;
      [...arr]
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .forEach((x) => {
          h += `<div style="display:flex;justify-content:space-between;gap:16px"><span>${escapeHtml(x.ticker)} <span class="mini">${escapeHtml(x.date)}</span></span><span style="font-family:var(--mono)">${money(x.amount)}</span></div>`;
        });
    } else h += '<div class="mini" style="margin-top:6px">No dividends.</div>';
    return h;
  };
  // KPI cards
  const T = (title, lines) =>
    `<div style="font-weight:700;margin-bottom:6px">${title}</div>` +
    lines.map((l) => `<div>${l}</div>`).join("");
  let portVal = 0;
  for (const kk in pos) {
    portVal += pos[kk].value;
  }
  const __FWDYIELD__ =
    portVal > 0 ? ((inc12 / portVal) * 100).toFixed(2) + "%" : "\u2014";
  document.getElementById("divKpiRow").innerHTML =
    kpi(
      "Income \u00B7 next 90d",
      money(inc90, 0) + " MAD",
      "pos",
      detTip(
        "Expected income \u00B7 next 90 days",
        ["Net, on shares eligible at ex-date."],
        det90,
      ),
    ) +
    kpi(
      "Income \u00B7 next 12mo",
      money(inc12, 0) + " MAD",
      "pos",
      detTip(
        "Expected income \u00B7 next 12 months",
        ["Net of dividend tax."],
        det12,
      ),
    ) +
    kpi(
      "Received in " + yr,
      money(received, 0) + " MAD",
      "pos",
      detTip(
        "Dividends received in " + yr,
        ["Recorded DIV transactions this year."],
        detRecv,
      ),
    ) +
    kpi(
      "YTD Yield",
      portVal > 0 ? ((received / portVal) * 100).toFixed(2) + "%" : "\u2014",
      "pos",
      T("YTD dividend yield", [
        "Dividends received in " + yr + " divided by",
        "current portfolio market value.",
        "(Realized income yield so far this year.)",
      ]),
    ) +
    kpi(
      "Fwd Yield (12mo)",
      __FWDYIELD__,
      "",
      T("Forward dividend yield", [
        "Next-12mo expected income divided by",
        "current portfolio market value.",
      ]),
    );
  // Monthly chart (next 12 months, or 24 when projecting next year)
  const _chartRange = _divProject ? 24 : 12;
  const months = [];
  const base = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
  for (let i = 0; i < _chartRange; i++) {
    const dt = new Date(base.getFullYear(), base.getMonth() + i, 1);
    months.push(dt.toISOString().slice(0, 7));
  }
  const data = months.map((m) => +(byMonth[m] || 0).toFixed(2));
  const labels = months.map((m) => {
    const [y, mo] = m.split("-");
    return (
      [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ][+mo - 1] +
      " '" +
      y.slice(2)
    );
  });
  const tx2 = themeColor("text2");
  const tx = themeColor("text");
  const incMonths = months.slice();
  CH_divIncome = Highcharts.chart("divIncomeChart", {
    chart: { type: "column", backgroundColor: "transparent" },
    title: { text: null },
    credits: { enabled: false },
    legend: { enabled: false },
    xAxis: { categories: labels, labels: { style: { color: tx2 } } },
    yAxis: {
      title: { text: null },
      gridLineColor: "#2c3742",
      labels: { style: { color: tx2 }, format: "{value:,.0f}" },
    },
    tooltip: {
      useHTML: true,
      backgroundColor: "#161d27",
      borderColor: "#2a3441",
      style: { color: "#e8eef5" },
      formatter: function () {
        const mk = incMonths[this.point.index];
        const tks = byMonthTk[mk] || {};
        const items = Object.keys(tks)
          .sort((a, b) => tks[b] - tks[a])
          .map(
            (t) =>
              '<div style="display:flex;justify-content:space-between;gap:14px"><span>' +
              t +
              '</span><span style="font-family:monospace">' +
              Math.round(tks[t]).toLocaleString() +
              "</span></div>",
          )
          .join("");
        return (
          "<b>" +
          this.x +
          "</b> \u2014 " +
          Math.round(this.y).toLocaleString() +
          " MAD net<br>" +
          (items || '<span style="color:#9aa7b4">\u2014</span>')
        );
      },
    },
    plotOptions: {
      column: {
        color: themeColor("warn"),
        borderRadius: 3,
        dataLabels: {
          enabled: true,
          style: { color: tx, textOutline: "none", fontWeight: "600" },
          format: "{point.y:,.0f}",
          allowOverlap: true,
        },
      },
    },
    series: [{ data: data }],
  });

  // ---- Historical dividends RECEIVED (from recorded DIV transactions) ----
  const recvByMonth = {};
  const recvByMonthTk = {};
  for (const t of TXNS) {
    if (t.action !== "DIV") continue;
    const r = computeRow(t, 0); // net cash received
    const mk = t.date.slice(0, 7);
    recvByMonth[mk] = (recvByMonth[mk] || 0) + r.net;
    (recvByMonthTk[mk] = recvByMonthTk[mk] || {})[t.ticker] =
      (recvByMonthTk[mk][t.ticker] || 0) + r.net;
  }
  const rmonths = Object.keys(recvByMonth).sort();
  const sub = document.getElementById("divRecvSubtitle");
  if (!rmonths.length) {
    if (sub) sub.textContent = "(none recorded yet)";
    CH_divReceived = Highcharts.chart("divReceivedChart", {
      chart: { backgroundColor: "transparent" },
      title: {
        text: "No dividends recorded yet",
        style: { color: tx2, fontSize: "13px" },
      },
      credits: { enabled: false },
      series: [],
    });
  } else {
    const totalRecv = rmonths.reduce((s, m) => s + recvByMonth[m], 0);
    if (sub) sub.textContent = "(total " + money(totalRecv, 0) + " MAD, net)";
    const rlabels = rmonths.map((m) => {
      const [y, mo] = m.split("-");
      return (
        [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ][+mo - 1] +
        " '" +
        y.slice(2)
      );
    });
    let cum = 0;
    const cumData = rmonths.map((m) => +(cum += recvByMonth[m]).toFixed(2));
    CH_divReceived = Highcharts.chart("divReceivedChart", {
      chart: { backgroundColor: "transparent" },
      title: { text: null },
      credits: { enabled: false },
      legend: { itemStyle: { color: tx2 } },
      xAxis: { categories: rlabels, labels: { style: { color: tx2 } } },
      yAxis: {
        title: { text: null },
        gridLineColor: "#2c3742",
        labels: { style: { color: tx2 }, format: "{value:,.0f}" },
      },
      tooltip: {
        useHTML: true,
        backgroundColor: "#161d27",
        borderColor: "#2a3441",
        style: { color: "#e8eef5" },
        formatter: function () {
          const mk = rmonths[this.point.index];
          const tks = recvByMonthTk[mk] || {};
          if (this.series.name === "Cumulative")
            return (
              "<b>" +
              this.x +
              "</b><br>Cumulative: " +
              Math.round(this.y).toLocaleString() +
              " MAD"
            );
          const items = Object.keys(tks)
            .sort((a, b) => tks[b] - tks[a])
            .map(
              (t) =>
                '<div style="display:flex;justify-content:space-between;gap:14px"><span>' +
                t +
                '</span><span style="font-family:monospace">' +
                Math.round(tks[t]).toLocaleString() +
                "</span></div>",
            )
            .join("");
          return (
            "<b>" +
            this.x +
            "</b> \u2014 " +
            Math.round(this.y).toLocaleString() +
            " MAD net<br>" +
            (items || "")
          );
        },
      },
      series: [
        {
          name: "Received",
          type: "column",
          color: themeColor("success"),
          borderRadius: 3,
          data: rmonths.map((m) => +recvByMonth[m].toFixed(2)),
        },
        {
          name: "Cumulative",
          type: "line",
          color: themeColor("primary"),
          data: cumData,
        },
      ],
    });
  }

  // ---- Received by ticker (net, all-time) ----
  const byTk = {};
  for (const t of TXNS) {
    if (t.action !== "DIV") continue;
    const r = computeRow(t, 0);
    const e = byTk[t.ticker] || (byTk[t.ticker] = { net: 0, count: 0 });
    e.net += r.net;
    e.count++;
  }
  const tks = Object.keys(byTk).sort((a, b) => byTk[b].net - byTk[a].net);
  const grand = tks.reduce((s, tk) => s + byTk[tk].net, 0);
  const tb = document.querySelector("#divByTickerTable tbody");
  if (tb) {
    if (!tks.length) {
      tb.innerHTML =
        '<tr><td colspan="5" class="l" style="color:var(--muted)">No dividends recorded yet.</td></tr>';
    } else {
      tb.innerHTML =
        tks
          .map(
            (tk) => `<tr><td class="l"><b>${escapeHtml(tk)}</b></td>
        <td class="l" style="color:var(--text2)">${escapeHtml((M[tk] && M[tk].name) || "")}</td>
        <td class="center">${byTk[tk].count}</td>
        <td class="pos">${money(byTk[tk].net)}</td>
        <td>${grand > 0 ? ((byTk[tk].net / grand) * 100).toFixed(1) + "%" : "\u2014"}</td></tr>`,
          )
          .join("") +
        `<tr style="border-top:2px solid var(--border)"><td class="l"><b>Total</b></td><td></td><td class="center"><b>${tks.reduce((s, tk) => s + byTk[tk].count, 0)}</b></td><td class="pos"><b>${money(grand)}</b></td><td><b>100%</b></td></tr>`;
    }
  }
  // pie chart of received-by-ticker
  const txp = themeColor("text");
  const txp2 = themeColor("text2");
  const pieData = tks.map((tk) => ({
    name: tk,
    y: +byTk[tk].net.toFixed(2),
  }));
  CH_divByTk = Highcharts.chart("divByTickerChart", {
    chart: { type: "pie", backgroundColor: "transparent" },
    title: { text: null },
    credits: { enabled: false },
    legend: { itemStyle: { color: txp2 } },
    tooltip: {
      pointFormat: "<b>{point.y:,.0f} MAD</b> ({point.percentage:.1f}%)",
    },
    plotOptions: {
      pie: {
        dataLabels: {
          style: { color: txp },
          format: "{point.name}: {point.percentage:.0f}%",
        },
      },
    },
    series: [{ name: "Received", data: pieData }],
  });
}

function eligibleSharesAtEx(d) {
  const exd = d.ex_date || d.pay_date;
  return heldBefore(d.ticker, false, exd) + heldBefore(d.ticker, true, exd);
}
// Is this calendar dividend already recorded? (ticker+amount within the match window)
function divRecorded(d) {
  const amt = +(+d.amount).toFixed(4);
  for (const t of TXNS) {
    if (t.action !== "DIV" || t.ticker !== d.ticker) continue;
    if (+(+t.price).toFixed(4) !== amt) continue;
    if (daysBetween(t.date, d.pay_date) <= DIV_MATCH_WINDOW_DAYS) return true;
  }
  return false;
}
function divStatus(d) {
  const elig = eligibleSharesAtEx(d);
  if (elig <= 1e-9)
    return {
      t: "\u2014",
      c: "var(--muted)",
      title: "You did not hold shares before the ex-date",
    };
  if (divRecorded(d))
    return {
      t: "\u2705 Recorded",
      c: "var(--success)",
      title: "A matching dividend transaction exists",
    };
  // eligible but not recorded \u2014 only meaningful once ex-date has passed
  if (daysUntil(d.ex_date || d.pay_date) > 0)
    return {
      t: "\u23F3 Upcoming",
      c: "var(--info)",
      title: "Eligible \u2014 ex-date not yet reached",
    };
  return {
    t: "\u26A0 Not recorded",
    c: "var(--warn)",
    title:
      "You were eligible (" +
      money(elig, elig % 1 ? 3 : 0) +
      " sh) but no dividend is logged",
  };
}
// \u2500\u2500 Dividend Calendar Grid View (monthly, color-coded ex/pay dates) \u2500\u2500
let _divCalMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); // current month
// Named handlers for the calendar prev/next buttons (replaces a compound inline
// onclick so the buttons can use data-act event delegation).
function divCalPrevMonth() {
  _divCalMonth = new Date(
    _divCalMonth.getFullYear(),
    _divCalMonth.getMonth() - 1,
    1,
  );
  renderDivCalGrid();
}
function divCalNextMonth() {
  _divCalMonth = new Date(
    _divCalMonth.getFullYear(),
    _divCalMonth.getMonth() + 1,
    1,
  );
  renderDivCalGrid();
}
function renderDivCalGrid(pos) {
  const wrap = document.getElementById("divCalGrid");
  if (!wrap) return;
  const f = document.getElementById("divFilter").value;
  // Filter DIVCAL the same way the table does
  const _projOn = !!(document.getElementById("divProjectNext") || {}).checked;
  const yr = new Date().getFullYear();
  let cal = DIVCAL;
  if (_projOn) {
    const shifted = DIVCAL.filter(
      (d) => d.pay_date && d.pay_date.startsWith(String(yr)),
    ).map((d) => ({
      ...d,
      pay_date: d.pay_date.replace(/^\d{4}/, String(yr + 1)),
      ex_date: d.ex_date ? d.ex_date.replace(/^\d{4}/, String(yr + 1)) : null,
      _projected: true,
    }));
    cal = DIVCAL.concat(shifted);
  }
  let rows = cal.filter((d) => d.pay_date);
  if (f === "upcoming" || f === "held")
    rows = rows.filter((d) => daysUntil(d.pay_date) >= 0);
  if (f === "held") rows = rows.filter((d) => eligibleSharesAtEx(d) > 0);
  if (f === "missing")
    rows = rows.filter((d) => divStatus(d).t === "\u26a0 Not recorded");

  // Build event maps for displayed month + overflow (prev/next month)
  const mYear = _divCalMonth.getFullYear(),
    mMonth = _divCalMonth.getMonth();
  const events = {},
    prevEvents = {},
    nextEvents = {};
  const _prevM = mMonth === 0 ? 11 : mMonth - 1,
    _prevY = mMonth === 0 ? mYear - 1 : mYear;
  const _nextM = mMonth === 11 ? 0 : mMonth + 1,
    _nextY = mMonth === 11 ? mYear + 1 : mYear;
  const addEv = (dateStr, ev) => {
    if (!dateStr) return;
    const d = new Date(dateStr);
    const dy = d.getFullYear(),
      dm = d.getMonth(),
      dd = d.getDate();
    if (dy === mYear && dm === mMonth) {
      (events[dd] = events[dd] || []).push(ev);
    } else if (dy === _prevY && dm === _prevM) {
      (prevEvents[dd] = prevEvents[dd] || []).push(ev);
    } else if (dy === _nextY && dm === _nextM) {
      (nextEvents[dd] = nextEvents[dd] || []).push(ev);
    }
  };
  for (const d of rows) {
    const held = eligibleSharesAtEx(d) > 0;
    const recorded = divRecorded(d);
    addEv(d.ex_date, {
      ticker: d.ticker,
      type: "ex",
      amount: d.amount,
      held,
      recorded,
      projected: !!d._projected,
    });
    addEv(d.pay_date, {
      ticker: d.ticker,
      type: "pay",
      amount: d.amount,
      held,
      recorded,
      projected: !!d._projected,
    });
  }

  // Render
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const today = new Date();
  const todayKey =
    today.getFullYear() === mYear && today.getMonth() === mMonth
      ? today.getDate()
      : null;

  // Calendar math
  const firstDay = new Date(mYear, mMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(mYear, mMonth + 1, 0).getDate();
  const weeksNeeded = Math.ceil((firstDay + daysInMonth) / 7);

  let h =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">';
  h += '<div style="font-weight:700;font-size:13px">Dividend Calendar</div>';
  h += '<div style="display:flex;align-items:center;gap:10px">';
  h +=
    '<button class="btn sec2" style="padding:2px 8px;font-size:14px" data-act="divCalPrevMonth">\u25c0</button>';
  h +=
    '<span style="font-weight:700;min-width:90px;text-align:center">' +
    monthNames[mMonth] +
    " " +
    mYear +
    "</span>";
  h +=
    '<button class="btn sec2" style="padding:2px 8px;font-size:14px" data-act="divCalNextMonth">\u25b6</button>';
  h += "</div></div>";

  // Grid header
  h += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px">';
  dayNames.forEach((d) => {
    h +=
      '<div style="text-align:center;font-size:10px;font-weight:700;color:var(--muted);padding:4px 0;text-transform:uppercase">' +
      d +
      "</div>";
  });

  // Grid cells (show overflow days from prev/next month in muted style)
  const prevMonthDays = new Date(mYear, mMonth, 0).getDate(); // last day of previous month
  let day = 1;
  for (let w = 0; w < weeksNeeded; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const cellIdx = w * 7 + dow;
      if (cellIdx < firstDay) {
        // Previous month overflow (with events)
        const prevDay = prevMonthDays - firstDay + cellIdx + 1;
        const _pEvts = prevEvents[prevDay] || [];
        h +=
          '<div style="min-height:72px;background:var(--bg2);border-radius:4px;padding:4px;opacity:.65">';
        h +=
          '<div style="font-size:11px;color:var(--muted)">' +
          prevDay +
          "</div>";
        _pEvts.slice(0, 2).forEach((ev) => {
          const col =
            ev.type === "ex" ? themeColor("warn") : themeColor("success");
          const dot = ev.projected ? "\u25cb" : "\u25cf";
          h +=
            '<div style="font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:' +
            col +
            ';margin:1px 0">' +
            dot +
            " " +
            ev.ticker +
            (ev.type === "pay" ? " Pay" : "  Ex") +
            "</div>";
        });
        if (_pEvts.length > 2)
          h +=
            '<div style="font-size:8px;color:var(--muted)">+' +
            (_pEvts.length - 2) +
            "</div>";
        h += "</div>";
      } else if (day > daysInMonth) {
        // Next month overflow (with events)
        const nextDay = day - daysInMonth;
        const _nEvts = nextEvents[nextDay] || [];
        h +=
          '<div style="min-height:72px;background:var(--bg2);border-radius:4px;padding:4px;opacity:.65">';
        h +=
          '<div style="font-size:11px;color:var(--muted)">' +
          nextDay +
          "</div>";
        _nEvts.slice(0, 2).forEach((ev) => {
          const col =
            ev.type === "ex" ? themeColor("warn") : themeColor("success");
          const dot = ev.projected ? "\u25cb" : "\u25cf";
          h +=
            '<div style="font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:' +
            col +
            ';margin:1px 0">' +
            dot +
            " " +
            ev.ticker +
            (ev.type === "pay" ? " Pay" : "  Ex") +
            "</div>";
        });
        if (_nEvts.length > 2)
          h +=
            '<div style="font-size:8px;color:var(--muted)">+' +
            (_nEvts.length - 2) +
            "</div>";
        h += "</div>";
        day++;
      } else {
        const isToday = day === todayKey;
        const evts = events[day] || [];
        h +=
          '<div style="min-height:72px;background:' +
          (isToday ? "rgba(59,130,246,.12)" : "var(--panel2)") +
          ";border-radius:4px;padding:4px;border:" +
          (isToday ? "1px solid var(--primary)" : "1px solid transparent") +
          '">';
        h +=
          '<div style="font-size:11px;font-weight:600;color:' +
          (isToday ? "var(--primary2)" : "var(--text2)") +
          ';margin-bottom:2px">' +
          day +
          "</div>";
        // Show up to 3 events per cell, then "+N"
        const show = evts.slice(0, 3);
        show.forEach((ev) => {
          const col =
            ev.type === "ex" ? themeColor("warn") : themeColor("success"); // yellow=ex, green=pay
          const filled = !ev.projected;
          const dot = filled ? "\u25cf" : "\u25cb"; // filled or hollow circle
          const label =
            ev.ticker +
            (ev.type === "pay"
              ? " Pay: " + money(ev.amount, 0) + " \u062f.\u0645"
              : "  Ex-Div");
          h +=
            '<div style="font-size:9.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:' +
            col +
            ';margin:1px 0" title="' +
            ev.ticker +
            " " +
            (ev.type === "ex" ? "Ex-dividend" : "Payment") +
            " " +
            (ev.projected ? "(projected)" : "") +
            '">' +
            dot +
            " " +
            label +
            "</div>";
        });
        if (evts.length > 3)
          h +=
            '<div style="font-size:9px;color:var(--muted)">+' +
            (evts.length - 3) +
            " more</div>";
        h += "</div>";
        day++;
      }
    }
  }
  h += "</div>";
  // Legend
  h +=
    '<div style="display:flex;gap:16px;margin-top:8px;font-size:10.5px;color:var(--text2)">';
  h += '<span>\u25cf <span style="color:var(--warn)">Ex-Dividend</span></span>';
  h +=
    '<span>\u25cb <span style="color:var(--warn)">Ex-Div (projected)</span></span>';
  h += '<span>\u25cf <span style="color:var(--success)">Payment</span></span>';
  h +=
    '<span>\u25cb <span style="color:var(--success)">Payment (projected)</span></span>';
  h += "</div>";
  wrap.innerHTML = h;
}
function renderDividends(pos) {
  const f = document.getElementById("divFilter").value;
  let rows = DIVCAL.filter((d) => d.pay_date);
  if (f !== "all") rows = rows.filter((d) => daysUntil(d.pay_date) >= 0);
  if (f === "held") rows = rows.filter((d) => eligibleSharesAtEx(d) > 0);
  if (f === "missing")
    rows = rows.filter((d) => divStatus(d).t === "\u26A0 Not recorded");
  rows.sort((a, b) => (a.pay_date < b.pay_date ? -1 : 1));
  const missCount = DIVCAL.filter(
    (d) => d.pay_date && divStatus(d).t === "\u26a0 Not recorded",
  ).length;
  const mc = document.getElementById("divMissingCount");
  if (mc)
    mc.innerHTML = missCount
      ? '<span style="color:var(--warn)">\u26a0 ' +
        missCount +
        " eligible dividend(s) not recorded</span>"
      : '<span style="color:var(--success)">\u2705 All eligible dividends recorded</span>';
  document.querySelector("#divTable tbody").innerHTML =
    rows
      .map((d) => {
        const sh = heldSharesOf(pos, d.ticker);
        const held = sh > 0;
        const du = daysUntil(d.pay_date);
        const st = divStatus(d);
        const eligNow = eligibleSharesAtEx(d);
        const amtCell =
          eligNow > 0
            ? `<td class="nis-cell" style="cursor:help" data-tip="${tipRef(divEstTipHTML(d, eligNow))}">${money(d.amount)} <span style="color:var(--muted)">\u24D8</span></td>`
            : `<td>${money(d.amount)}</td>`;
        const rowStyle =
          st.t === "\u26A0 Not recorded"
            ? ' style="background:rgba(245,158,11,.10)"'
            : "";
        return `<tr${rowStyle}><td class="l" style="color:var(--text2)">${d.ex_date || "\u2014"}</td><td class="l">${d.pay_date}</td><td class="l">${(function () {
          const recorded = d._fromTxn || divRecorded(d);
          if (recorded)
            return (
              "<b>" +
              d.ticker +
              '</b> <span class="chip" style="background:rgba(38,208,124,.14);color:var(--success)" data-tip="Already recorded in Transactions">\u2713 recorded</span>'
            );
          return (
            '<b><a href="#" data-act="prefillDividend" data-args="' +
            d.ticker +
            "," +
            d.amount +
            "," +
            d.pay_date +
            "," +
            (d.ex_date || "") +
            '" style="color:var(--primary2);text-decoration:none" data-tip="Add this dividend to Transactions (prefilled)">' +
            d.ticker +
            " \uFF0B</a></b>"
          );
        })()}${(function () {
          const du = daysUntil(d.pay_date);
          return du < 0
            ? ' <span class="chip" style="background:rgba(245,166,35,.15);color:var(--warn)" data-tip="Payment date passed \u2014 record it?">due</span>'
            : "";
        })()}</td>
      <td class="l" style="color:var(--text2)">${escapeHtml(d.issuer || "")}</td><td class="l"><span class="chip">${d.div_type || ""}</span></td>
      ${amtCell}<td class="center">${held ? '<span class="tag-in">Yes</span>' : "\u2014"}</td>
      <td class="center" data-tip="${st.title}" style="color:${st.c};white-space:nowrap">${st.t}${st.t === "\u26A0 Not recorded" ? ` <button class="chip" style="cursor:pointer;border:none;background:rgba(34,197,94,.15);color:var(--success)" data-act="addMissingDiv" data-args="${d.ticker},${d.pay_date},${d.amount},${d.ex_date || d.pay_date}">+ Add</button>` : ""}</td>
      <td class="center" style="color:${du < 0 ? "var(--muted)" : du < 14 ? "var(--warn)" : "var(--text2)"}">${du < 0 ? "past" : du + "d"}</td></tr>`;
      })
      .join("") ||
    '<tr><td colspan="9" class="l" style="color:var(--muted)">No dividends match.</td></tr>';
  renderDivDashboard(pos);
  renderDivCalGrid(pos);
}
function renderDashDivs(pos) {
  // Source 1: calendar dividends you're ELIGIBLE for (held before the ex-date), whose payment is upcoming
  // OR just passed (within 30 days) but NOT yet recorded as received. Uses ex-date eligibility, not current holdings.
  let rows = DIVCAL.filter((d) => {
    if (!d.pay_date || eligibleSharesAtEx(d) <= 0) return false;
    const du = daysUntil(d.pay_date);
    if (du >= 0) return true; // upcoming
    if (du >= -30 && !divRecorded(d)) return true; // just passed, not yet recorded
    return false;
  });
  // Source 2: DIV transactions you've RECORDED with a future pay date (not yet received),
  // even if they aren't in the calendar. Dedup against calendar by ticker+amount within the window.
  const seen = new Set(
    rows.map((d) => d.ticker + "|" + +(+d.amount).toFixed(4)),
  );
  TXNS.filter((t) => t.action === "DIV" && daysUntil(t.date) >= 0).forEach(
    (t) => {
      const key = t.ticker + "|" + +(+t.price).toFixed(4);
      // avoid duplicating a calendar row already listed for this ticker+amount
      const dupCal = rows.some(
        (d) =>
          d.ticker === t.ticker &&
          Math.abs(+d.amount - +t.price) < 1e-4 &&
          daysBetween(d.pay_date, t.date) <= DIV_MATCH_WINDOW_DAYS,
      );
      if (dupCal) return;
      rows.push({
        ticker: t.ticker,
        issuer: (M[t.ticker] && M[t.ticker].name) || "",
        amount: t.price,
        pay_date: t.date,
        ex_date: t.exDate || "",
        _fromTxn: true,
        _txnQty: t.qty,
        _txnPea: t.pea,
      });
    },
  );
  rows.sort((a, b) => (a.pay_date < b.pay_date ? -1 : 1));
  const tb = document.querySelector("#dashDivTable tbody");
  const empty = document.getElementById("dashDivEmpty");
  if (!rows.length) {
    tb.innerHTML = "";
    empty.textContent =
      "No upcoming dividends \u2014 none where you qualified at the ex-date and payment is still pending.";
    return;
  }
  empty.textContent = "";
  tb.innerHTML = rows
    .map((d) => {
      const q = d._fromTxn ? d._txnQty : eligibleSharesAtEx(d);
      const est = d._fromTxn
        ? computeRow({
            action: "DIV",
            qty: d._txnQty,
            price: d.amount,
            date: d.pay_date,
            pea: d._txnPea,
          }).net
        : divNetFor(d, q);
      return `<tr><td class="l" style="color:var(--text2)">${d.ex_date || "\u2014"}</td>${(function () {
        if (!d.ex_date)
          return '<td class="center" style="color:var(--muted)">\u2014</td>';
        const de = daysUntil(d.ex_date);
        const col =
          de < 0 ? "var(--muted)" : de <= 3 ? "var(--warn)" : "var(--text2)";
        return (
          '<td class="center" style="color:' +
          col +
          '">' +
          (de < 0 ? "passed" : de + "d") +
          "</td>"
        );
      })()}<td class="l">${d.pay_date}</td><td class="l">${(function () {
        const recorded = d._fromTxn || divRecorded(d);
        if (recorded)
          return (
            "<b>" +
            d.ticker +
            '</b> <span class="chip" style="background:rgba(38,208,124,.14);color:var(--success)" data-tip="Already recorded in Transactions">\u2713 recorded</span>'
          );
        return (
          '<b><a href="#" data-act="prefillDividend" data-args="' +
          d.ticker +
          "," +
          d.amount +
          "," +
          d.pay_date +
          "," +
          (d.ex_date || "") +
          '" style="color:var(--primary2);text-decoration:none" data-tip="Add this dividend to Transactions (prefilled)">' +
          d.ticker +
          " \uFF0B</a></b>"
        );
      })()}${(function () {
        const du = daysUntil(d.pay_date);
        return du < 0
          ? ' <span class="chip" style="background:rgba(245,166,35,.15);color:var(--warn)" data-tip="Payment date passed \u2014 record it?">due</span>'
          : "";
      })()}</td>
      <td class="l" style="color:var(--text2)">${escapeHtml(d.issuer || "")}</td><td>${money(d.amount)}</td>
      <td>${money(q, q % 1 ? 3 : 0)}</td><td class="nis-cell pos" style="cursor:help" data-tip="${tipRef(divEstTipHTML(d, q))}">${money(est)} <span style="color:var(--muted)">\u24D8</span></td><td class="center">${daysUntil(d.pay_date)}d</td></tr>`;
    })
    .join("");
}
function autoDivTip(t) {
  const row = (l, v) =>
    `<div style="display:flex;justify-content:space-between;gap:18px"><span>${l}</span><span style="font-family:var(--mono)">${v}</span></div>`;
  let h = `<div style="font-weight:700;margin-bottom:6px">Auto-added dividend \u00B7 ${escapeHtml(t.ticker)}</div>`;
  h += row(
    'Ex-date <span class="mini">(eligibility cutoff)</span>',
    t.exDate || "\u2014",
  );
  h += row("Pay date", t.date);
  h += row(
    "Shares held before ex-date",
    money(t.eligBasis != null ? t.eligBasis : t.qty, t.qty % 1 ? 3 : 0),
  );
  h += row("Amount / share", money(t.price));
  h += `<div class="mini" style="margin-top:6px">Eligible = shares bought before the ex-date and not sold on/before it. Review & edit or delete if wrong.</div>`;
  return h;
}

function ttcTipHTML(t, e) {
  const row = _tipRow; // shared tooltip row builder (gap:18px)
  const gross = t.price * t.qty;
  const manual = typeof t.total === "number" && t.total > 0;
  const _brokerName = (BROKERS[txnBroker(t)] || {}).name || txnBroker(t);
  let h = `<div style="font-weight:700;margin-bottom:6px">${t.action} ${escapeHtml(t.ticker)} \u2014 ${t.pea ? "PEA" : "Regular"} \u00B7 ${escapeHtml(_brokerName)}</div>`;
  h += row(
    "Quantity \u00D7 Unit price",
    money(t.qty, t.qty % 1 ? 3 : 0) + " \u00D7 " + money(t.price),
  );
  h += row("Gross", money(gross) + " MAD");
  if (manual) {
    h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>`;
    h += row("Manual Total (TTC) entered", money(t.total) + " MAD", "pos");
    h += row("Implied fees/costs", money(e.fees));
    h += row("<b>TTC / share</b>", "<b>" + money(e.ttc) + "</b>");
    h += `<div class="mini" style="margin-top:6px">Custom total (e.g. OPCVM) \u2014 standard fee/tax formula skipped.</div>`;
    return h;
  }
  // OPCVM (fund) breakdown \u2014 subscription/redemption fee %, no brokerage courier fee.
  if (e.opcvm) {
    const meta = M[t.ticker] || {};
    const pctOf = (r) => (r * 100).toFixed(3).replace(/\.?0+$/, "") + "%";
    h += `<div style="color:var(--info);font-size:11px;margin:4px 0 2px;font-weight:700">\uD83C\uDFE6 OPCVM fund${meta.name ? " \u2014 " + meta.name : ""}</div>`;
    if (t.action === "BUY") {
      const hasFee = meta.buyFee != null;
      h += row(
        'Commission de souscription <span class="mini">(' +
          (hasFee ? pctOf(meta.buyFee) : "not imported") +
          ")</span>",
        "\u2212" + money(e.fees),
      );
    } else if (t.action === "SELL") {
      const hasFee = meta.sellFee != null;
      h += row(
        'Commission de rachat <span class="mini">(' +
          (hasFee ? pctOf(meta.sellFee) : "not imported") +
          ")</span>",
        "\u2212" + money(e.fees),
      );
      const yr2 = new Date(t.date).getFullYear();
      h += row(
        "TPCVM cap-gains tax " +
          (t.pea
            ? '<span class="mini">(PEA exempt)</span>'
            : '<span class="mini">(' + pctOf(FP.tpcvm) + " on gain)</span>"),
        "\u2212" + money(e.tax),
      );
    } else if (t.action === "DIV") {
      h += row(
        'Fund fee <span class="mini">(none on dividends)</span>',
        "0",
        "pos",
      );
      const yr2 = new Date(t.date).getFullYear();
      h += t.pea
        ? row('Dividend tax <span class="mini">(PEA exempt)</span>', "0", "pos")
        : row(
            'Dividend tax <span class="mini">(' +
              pctOf(divRate(yr2)) +
              " \u00D7 " +
              (1 + FP.vat).toFixed(2) +
              " VAT, " +
              yr2 +
              ")</span>",
            "\u2212" + money(e.tax),
          );
    }
    if (
      (t.action === "BUY" && meta.buyFee == null) ||
      (t.action === "SELL" && meta.sellFee == null)
    ) {
      h += `<div class="mini" style="margin-top:6px;color:var(--warn)">Fund fee % not imported \u2014 import the weekly OPCVM file (VL + fees) to populate it. Treated as 0% for now.</div>`;
    }
    h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>`;
    h += row(
      '<b>TTC / share</b> <span class="mini">' +
        (t.action === "BUY"
          ? "(gross+fees)/qty"
          : "(gross\u2212fees\u2212tax)/qty") +
        "</span>",
      "<b>" + money(e.ttc) + "</b>",
    );
    h += row("Net cash", money(e.net) + " MAD", cls(e.net));
    return h;
  }
  // Standard (stock) fee breakdown \u2014 broker-aware so Attijari (PEA-type) shows its
  // courtage/r\u00E8glement/bourse structure, and Saham (regular) shows market/interm\u00E9d/
  // r\u00E8glement + fixed courrier. Uses the SAME broker resolution as computeRow.
  const _bk = BROKERS[txnBroker(t)] || null;
  const _f = _bk && _bk.fees ? _bk.fees : null;
  const _vat = vatRate();
  const pctOf = (r) => (r * 100).toFixed(3).replace(/\.?0+$/, "") + "%";
  h += `<div style="color:var(--text2);font-size:11px;margin:4px 0 2px">Trading fees (incl. ${(_vat * 100).toFixed(0)}% VAT):</div>`;
  if (_bk && _bk.feeType === "pea" && _f) {
    // Attijari-style: courtage (with min floor) + r\u00E8glement + bourse, all \u00D7 VAT.
    const court = Math.max(gross * (_f.courtage || 0), _f.courtageMin || 0);
    const regl = gross * (_f.regl || 0);
    const bourse = gross * (_f.bourse || 0);
    h += row(
      '&nbsp;&nbsp;Courtage <span class="mini">(' +
        pctOf(_f.courtage || 0) +
        (court <= (_f.courtageMin || 0)
          ? ", min " + money(_f.courtageMin || 0)
          : "") +
        ")</span>",
      "\u2212" + money(court * (1 + _vat)),
    );
    h += row(
      '&nbsp;&nbsp;R\u00E8glement/livraison <span class="mini">(' +
        pctOf(_f.regl || 0) +
        ")</span>",
      "\u2212" + money(regl * (1 + _vat)),
    );
    h += row(
      '&nbsp;&nbsp;Commission bourse <span class="mini">(' +
        pctOf(_f.bourse || 0) +
        ")</span>",
      "\u2212" + money(bourse * (1 + _vat)),
    );
  } else {
    // Saham-style / regular: market + interm\u00E9diation + r\u00E8glement + fixed courrier.
    const _cm = _f && _f.c_marche != null ? _f.c_marche : FP.c_marche;
    const _ci = _f && _f.c_interm != null ? _f.c_interm : FP.c_interm;
    const _cr = _f && _f.c_regl != null ? _f.c_regl : FP.c_regl;
    const _courier = _f && _f.courier != null ? _f.courier : FP.courier;
    const cm = gross * _cm * (1 + _vat),
      ci = gross * _ci * (1 + _vat),
      cr = gross * _cr * (1 + _vat),
      courier = _courier * (1 + _vat);
    h += row(
      '&nbsp;&nbsp;Commission de march\u00E9 <span class="mini">(' +
        pctOf(_cm) +
        ")</span>",
      "\u2212" + money(cm),
    );
    h += row(
      '&nbsp;&nbsp;Commission d\'interm\u00E9diation <span class="mini">(' +
        pctOf(_ci) +
        ")</span>",
      "\u2212" + money(ci),
    );
    h += row(
      '&nbsp;&nbsp;Commission r\u00E8gl./livraison <span class="mini">(' +
        pctOf(_cr) +
        ")</span>",
      "\u2212" + money(cr),
    );
    h += row(
      '&nbsp;&nbsp;Frais de courrier <span class="mini">(fixed)</span>',
      "\u2212" + money(courier),
    );
  }
  h += row(
    "&nbsp;&nbsp;<b>Total fees</b>",
    "<b>\u2212" + money(e.fees) + "</b>",
  );
  const yr = new Date(t.date).getFullYear();
  if (t.action === "DIV")
    h += t.pea
      ? row('Dividend tax <span class="mini">(PEA exempt)</span>', "0", "pos")
      : row(
          'Dividend tax <span class="mini">(' +
            pctOf(divRate(yr)) +
            " \u00D7 " +
            (1 + FP.vat).toFixed(2) +
            " VAT, " +
            yr +
            ")</span>",
          "\u2212" + money(e.tax),
        );
  else if (t.action === "SELL")
    h += row(
      "TPCVM cap-gains tax " +
        (t.pea
          ? '<span class="mini">(PEA exempt)</span>'
          : '<span class="mini">(' + pctOf(FP.tpcvm) + " on gain)</span>"),
      "\u2212" + money(e.tax),
    );
  h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>`;
  h += row(
    '<b>TTC / share</b> <span class="mini">' +
      (t.action === "BUY"
        ? "(gross+fees)/qty"
        : "(gross\u2212fees\u2212tax)/qty") +
      "</span>",
    "<b>" + money(e.ttc) + "</b>",
  );
  h += row("Net cash", money(e.net), cls(e.net));
  return h;
}

function renderTxns(enriched) {
  document.getElementById("txnCount").textContent = TXNS.length + " trades";
  // (filtered count updated after row build below)
  const byKey = {};
  enriched.forEach((e) => {
    byKey[e.date + e.ticker + e.action + e.qty + e.price] = e;
  });
  const q = (
    document.getElementById("txnSearch")
      ? document.getElementById("txnSearch").value
      : ""
  )
    .trim()
    .toLowerCase();
  let rows = [...TXNS].map((t, i) => ({ t, i }));
  if (q)
    rows = rows.filter(({ t }) => {
      const cat = ((M[t.ticker] && M[t.ticker].cat) || "").toLowerCase();
      const nm = ((M[t.ticker] && M[t.ticker].name) || "").toLowerCase();
      return (
        (t.ticker || "").toLowerCase().includes(q) ||
        (t.action || "").toLowerCase().includes(q) ||
        (t.date || "").includes(q) ||
        nm.includes(q) ||
        cat.includes(q) ||
        ((q === "opcvm" || q === "fund" || q === "funds" || q === "fonds") &&
          cat === "opcvm")
      );
    });
  rows.sort((a, b) => (a.t.date < b.t.date ? 1 : -1));
  if (q) {
    const cc = document.getElementById("txnCount");
    if (cc) cc.textContent = rows.length + " of " + TXNS.length + " trades";
  }
  document.querySelector("#txnTable tbody").innerHTML = rows
    .map(({ t, i }) => {
      const e = byKey[t.date + t.ticker + t.action + t.qty + t.price] || {};
      const ac =
        t.action === "BUY"
          ? "b-buy"
          : t.action === "SELL"
            ? "b-sell"
            : "b-wait";
      const rowStyle = t.auto ? ' style="background:rgba(245,158,11,.10)"' : "";
      return `<tr${rowStyle}><td class="center"><input type="checkbox" class="txnChk" data-idx="${i}"></td><td class="l">${t.date}</td><td class="l"><b>${escapeHtml(t.ticker)}</b>${t.auto ? ' <span class="chip nis-cell" style="background:rgba(245,158,11,.18);color:var(--warn);cursor:help" data-tip="' + tipRef(autoDivTip(t)) + '">auto \u24D8</span>' : ""}${typeof t.total === "number" && t.total > 0 ? ' <span class="chip" style="background:rgba(56,189,248,.15);color:var(--info)" data-tip="Manual total \u2014 custom fees (e.g. OPCVM)">manual</span>' : ""}</td>
      <td class="l" style="color:var(--text2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml((M[t.ticker] && M[t.ticker].name) || "")}">${escapeHtml((M[t.ticker] && M[t.ticker].name) || "\u2014")}</td>
      <td class="l"><span class="badge ${ac}">${t.action}</span></td><td>${money(t.qty, t.qty % 1 ? 3 : 0)}</td>
      <td>${money(t.price)}</td><td>${e.fees != null ? money(e.fees) : "\u2014"}</td><td>${e.tax != null ? money(e.tax) : "\u2014"}</td>
      <td class="${e.ttc != null ? "nis-cell" : ""}" style="${e.ttc != null ? "cursor:help" : ""}" data-tip="${e.ttc != null ? tipRef(ttcTipHTML(t, e)) : ""}">${e.ttc != null ? money(e.ttc) : "\u2014"} ${e.ttc != null ? '<span style="color:var(--muted)">\u24D8</span>' : ""}</td><td class="${cls(e.net)} ${e.net != null ? "nis-cell" : ""}" style="${e.net != null ? "cursor:help" : ""}" data-tip="${e.net != null ? tipRef(ttcTipHTML(t, e)) : ""}">${e.net != null ? money(e.net) : "\u2014"} ${e.net != null ? '<span style="color:var(--muted)">\u24D8</span>' : ""}</td>
      <td style="text-align:center">${t.pea ? '<span class="chip" style="background:rgba(56,189,248,.15);color:var(--info)">PEA</span>' : "Reg"}</td>
      <td style="font-size:10px;text-align:center">${escapeHtml((BROKERS[txnBroker(t)] || {}).name || txnBroker(t))}</td>
      <td class="center" style="white-space:nowrap"><button class="chip" style="cursor:pointer;border:none;margin-right:4px" data-act="editTxn" data-args="${i}" aria-label="Edit transaction" title="Edit transaction">\u270E</button><button class="chip" style="cursor:pointer;border:none" data-act="delTxn" data-args="${i}" aria-label="Delete transaction" title="Delete transaction">\u2715</button></td></tr>`;
    })
    .join("");
}
function renderTickerList() {
  document.getElementById("tickerList").innerHTML = Object.keys(M)
    .sort()
    .map((t) => `<option value="${t}">`)
    .join("");
}
window.delTxn = async function (i) {
  if (!(await appConfirm("Delete this transaction?"))) return;
  TXNS.splice(i, 1);
  saveTxns(TXNS);
  render();
};

// ---------- interactions ----------
const _rbBtn = document.getElementById("rbRun");
try {
  loadRbSettings();
} catch (e) {}
// Value-vs-Diversification slider: update its live label as it moves and persist
// the position (takes effect on the next "Run", like the other rebalance inputs).
{
  const _vt = document.getElementById("rbValueTilt");
  if (_vt) {
    const _sync = () => {
      const _lbl = document.getElementById("rbValueTiltVal");
      if (_lbl && typeof _rbTiltLabel === "function")
        _lbl.textContent = _rbTiltLabel(_vt.value);
      try {
        saveRbSettings();
      } catch (e) {}
    };
    _vt.addEventListener("input", _sync);
    _sync();
  }
}
if (_rbBtn)
  _rbBtn.onclick = () => {
    try {
      renderRebalance();
    } catch (e) {
      console.error(e);
      toast("Rebalance error: " + e.message, "err");
    }
  };
document.querySelectorAll(".tab[data-view]").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll(".tab[data-view]")
        .forEach((x) => x.classList.remove("active"));
      document
        .querySelectorAll(".view")
        .forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      document.getElementById(b.dataset.view).classList.add("active");
      try {
        // Persist the active tab so a refresh reopens it (see boot restore in
        // 08-salary.js). We intentionally do NOT write the tab into the URL
        // hash - the last-tab is restored from localStorage, keeping the URL
        // clean and consistent across all tabs (portfolio, expenses, salary).
        localStorage.setItem("casa_last_tab_v1", b.dataset.view);
        localStorage.setItem("casa_last_app_v1", "portfolio");
      } catch (e) {}
      if (CH_break) CH_break.reflow();
      if (typeof CH_divIncome !== "undefined" && CH_divIncome)
        setTimeout(() => CH_divIncome.reflow(), 10);
      if (typeof CH_divReceived !== "undefined" && CH_divReceived)
        setTimeout(() => CH_divReceived.reflow(), 10);
      if (typeof CH_divByTk !== "undefined" && CH_divByTk)
        setTimeout(() => CH_divByTk.reflow(), 10);
      if (typeof CH_history !== "undefined" && CH_history)
        setTimeout(() => CH_history.reflow(), 10);
      if (b.dataset.view === "rebalance") {
        try {
          renderRebalance();
        } catch (e) {
          console.error("rebalance", e);
        }
      }
      // Keep the entry date fresh: if not editing an existing row, reset to today when opening the tab.
      if (b.dataset.view === "cash") {
        renderCash();
      }
      if (b.dataset.view === "transactions") {
        const d = document.getElementById("tDate");
        if (d && (typeof EDIT_IX === "undefined" || EDIT_IX == null))
          d.value = _qwTodayISO();
      }
      if (b.dataset.view === "pending") {
        const d = document.getElementById("pDate");
        if (d && (typeof PEND_EDIT === "undefined" || PEND_EDIT == null))
          d.value = _qwTodayISO();
      }
      if (
        b.dataset.view === "signals" &&
        typeof CH_topSector !== "undefined" &&
        CH_topSector
      )
        setTimeout(() => CH_topSector.reflow(), 10);
    }),
);
document.getElementById("sigFilter").onchange = () => {
  if (typeof SIG_SORT !== "undefined") SIG_SORT.userSet = false;
  renderSignals();
};
document.getElementById("sigAsset").onchange = () => {
  if (typeof SIG_SORT !== "undefined") SIG_SORT.userSet = false;
  renderSignals();
};
(function () {
  const si = document.getElementById("sigSearch"),
    sc = document.getElementById("sigSearchClear");
  if (si) {
    si.addEventListener("input", () => {
      if (sc) sc.style.display = si.value ? "block" : "none";
      renderSignals();
    });
  }
  if (sc) {
    sc.onclick = () => {
      si.value = "";
      sc.style.display = "none";
      renderSignals();
      si.focus();
    };
  }
  const cs = document.getElementById("sigClearSort");
  if (cs) {
    cs.onclick = () => {
      if (typeof SIG_SORT !== "undefined") {
        SIG_SORT.k = "score";
        SIG_SORT.d = -1;
        SIG_SORT.userSet = false;
      }
      renderSignals();
    };
  }
})();
// Dashboard "include OPCVM" toggles \u2014 re-render just the movers lists.
["contribOpcvm", "detractOpcvm"].forEach((id) => {
  const cb = document.getElementById(id);
  if (cb)
    cb.onchange = () => {
      try {
        const { pos } = runFIFO();
        renderDashMovers(Object.values(pos));
      } catch (e) {
        console.error("movers toggle", e);
      }
    };
});
document.getElementById("divFilter").onchange = () => render();
document.getElementById("divProjectNext").onchange = () => render();
if (document.getElementById("tDate"))
  document.getElementById("tDate").value = _qwTodayISO();
if (document.getElementById("pDate"))
  document.getElementById("pDate").value = _qwTodayISO();
function liveCalc() {
  const t = {
    date:
      document.getElementById("tDate").value ||
      new Date().toISOString().slice(0, 10),
    ticker: document.getElementById("tTicker").value.trim().toUpperCase(),
    action: document.getElementById("tAction").value,
    qty: parseFloat(document.getElementById("tQty").value),
    price: parseFloat(document.getElementById("tPrice").value),
    pea: document.getElementById("tPea").checked,
    opcvm: !!(
      document.getElementById("tOpcvm") &&
      document.getElementById("tOpcvm").checked
    ),
    broker: (document.getElementById("tBroker") || {}).value || "attijari",
  };
  const _lt = parseFloat(document.getElementById("tTotal").value);
  if (!isNaN(_lt) && _lt > 0) t.total = _lt;
  // Mirror the save path: funds are Total-driven so the preview matches what gets saved.
  const _isFundLC = !!(
    (document.getElementById("tOpcvm") &&
      document.getElementById("tOpcvm").checked) ||
    (M[t.ticker] && M[t.ticker].cat === "OPCVM")
  );

  if (t.total > 0 && t.qty && (_isFundLC || isNaN(t.price) || !t.price)) {
    t.price = t.total / t.qty;
  }
  if (!t.qty || (!t.price && !t.total)) {
    document.getElementById("txnCalc").textContent = "";
    return;
  }
  const { pos } = runFIFO();
  const _pk = t.ticker + "||" + (t.pea ? "PEA" : "REG");
  const avg = pos[_pk] ? pos[_pk].avg : 0;
  const r = computeRow(t, avg);
  document.getElementById("txnCalc").innerHTML =
    (r.manual
      ? '<span style="color:var(--warn)">Manual total</span> \u00B7 '
      : "") +
    `Fees: <b>${money(r.fees)}</b>${r.manual ? " (implied)" : ""} \u00B7 Tax: <b>${money(r.tax)}</b> \u00B7 Cost/share: <b>${money(r.ttc)}</b> \u00B7 Net cash: <b class="${cls(r.net)}">${money(r.net)}</b> MAD`;
}
["tTicker", "tAction", "tQty", "tPrice", "tTotal", "tDate"].forEach((id) =>
  document.getElementById(id).addEventListener("input", liveCalc),
);

// ---------- pending form live calc (mirrors txn liveCalc; shows total WITH fees) ----------
function pLiveCalc() {
  const g = (id) => document.getElementById(id);
  const calc = g("pendCalc");
  if (!calc) return;
  const tk = (g("pTicker").value || "").trim().toUpperCase();
  const t = {
    action: g("pAction").value || "BUY",
    ticker: tk,
    qty: parseFloat(g("pQty").value),
    price: parseFloat(g("pPrice").value),
    date: g("pDate").value || new Date().toISOString().slice(0, 10),
    pea: g("pPea").checked,
  };
  const _lt = parseFloat(g("pTotal").value);
  if (!isNaN(_lt) && _lt > 0) t.total = _lt;
  const _isFund = !!(
    (g("pOpcvm") && g("pOpcvm").checked) ||
    (M[t.ticker] && M[t.ticker].cat === "OPCVM")
  );
  t.opcvm = _isFund;
  if (t.total > 0 && t.qty && (_isFund || isNaN(t.price) || !t.price)) {
    t.price = t.total / t.qty;
  }
  if (!t.qty || (!t.price && !t.total)) {
    calc.textContent = "";
    return;
  }
  const { pos } = runFIFO();
  const _pk = t.ticker + "||" + (t.pea ? "PEA" : "REG");
  const avg = pos[_pk] ? pos[_pk].avg : 0;
  const r = computeRow(t, avg);
  const gross = (t.price || 0) * (t.qty || 0);
  const expTot =
    t.action === "BUY"
      ? gross + r.fees
      : t.action === "SELL"
        ? r.net
        : t.total != null
          ? t.total
          : gross;
  const lbl =
    t.action === "BUY"
      ? "Expected cost"
      : t.action === "SELL"
        ? "Expected proceeds"
        : "Total";
  calc.innerHTML =
    (r.manual
      ? '<span style="color:var(--warn)">Manual total</span> \u00B7 '
      : "") +
    `Gross: <b>${money(gross)}</b> \u00B7 Fees: <b>${money(r.fees)}</b>${r.manual ? " (implied)" : ""}` +
    (t.action === "SELL" && r.tax > 0
      ? ` \u00B7 Tax: <b>${money(r.tax)}</b>`
      : "") +
    ` \u00B7 ${lbl} (incl. fees): <b class="${cls(t.action === "BUY" ? -expTot : expTot)}">${money(expTot)}</b> MAD`;
}
[
  "pTicker",
  "pAction",
  "pQty",
  "pPrice",
  "pTotal",
  "pDate",
  "pPea",
  "pOpcvm",
].forEach((id) => {
  const e = document.getElementById(id);
  if (e) e.addEventListener("input", pLiveCalc);
});
document.getElementById("pPea") &&
  document.getElementById("pPea").addEventListener("change", pLiveCalc);
document.getElementById("pOpcvm") &&
  document.getElementById("pOpcvm").addEventListener("change", pLiveCalc);

// ---------- OPCVM detection: badge + auto Total-mode (Transactions & Pending) ----------
// Sets a visible "\uD83C\uDFE6 OPCVM fund" / "\uD83D\uDCC8 Stock" chip next to the ticker so it's obvious
// what kind of instrument you're entering, and tunes the price/total fields for funds.
function setKindBadge(badgeEl, tkVal, forceFund) {
  if (!badgeEl) return null;
  const t = (tkVal || "").trim().toUpperCase();
  const known = M[t];
  // Hide only when there's nothing to show: no ticker AND not manually flagged as a fund.
  if (!t && !forceFund) {
    badgeEl.style.display = "none";
    return null;
  }
  const isFund = forceFund === true || !!(known && known.cat === "OPCVM");
  if (!isFund && !known) {
    badgeEl.style.display = "none";
    return null;
  }
  badgeEl.style.display = "inline-block";
  if (isFund) {
    badgeEl.textContent = "\uD83C\uDFE6 OPCVM fund";
    badgeEl.style.background = "rgba(56,189,248,.20)";
    badgeEl.style.color = "var(--info)";
    badgeEl.style.fontWeight = "700";
    badgeEl.style.border = "1px solid var(--info)";
    const hasFees = known && (known.buyFee != null || known.sellFee != null);
    badgeEl.setAttribute(
      "data-tip",
      "OPCVM fund" +
        (hasFees
          ? " \u2014 buy " +
            (((known && known.buyFee) || 0) * 100).toFixed(2) +
            "% / sell " +
            (((known && known.sellFee) || 0) * 100).toFixed(2) +
            "%"
          : " \u2014 fees not imported yet (import the weekly file)"),
    );
  } else {
    badgeEl.textContent = "\uD83D\uDCC8 Stock";
    badgeEl.style.background = "var(--panel2)";
    badgeEl.style.color = "var(--muted)";
    badgeEl.style.fontWeight = "600";
    badgeEl.style.border = "1px solid var(--border)";
    badgeEl.setAttribute(
      "data-tip",
      "Listed stock \u2014 standard brokerage fees apply.",
    );
  }
  return isFund;
}
(function () {
  const tk = document.getElementById("tTicker"),
    price = document.getElementById("tPrice"),
    total = document.getElementById("tTotal"),
    calc = document.getElementById("txnCalc"),
    badge = document.getElementById("tKind"),
    opc = document.getElementById("tOpcvm");
  if (!tk) return;
  let _lastTk = (tk.value || "").trim().toUpperCase(); // track ticker to detect real changes
  function apply(fromCheckbox) {
    const curTk = (tk.value || "").trim().toUpperCase();
    const tickerChanged = curTk !== _lastTk;
    const known = M[curTk];
    const knownFund = !!(known && known.cat === "OPCVM");
    // A known fund auto-checks the box; the user may also tick it manually for a fund not in the list.
    if (!fromCheckbox && knownFund && opc && !opc.checked) opc.checked = true;
    const isFund = (opc && opc.checked) || knownFund;
    setKindBadge(badge, tk.value, isFund);
    // --- Name: shown for BOTH stocks and funds now. Keep it in sync with the ticker: on a real
    //     ticker change, refresh from the master list (a known name wins over the previous one). ---
    {
      const nw = document.getElementById("tFundNameWrap"),
        nf = document.getElementById("tFundName");
      if (nw) nw.style.display = ""; // always visible
      if (nf) {
        if (known && known.name) {
          if (tickerChanged || !nf.value) nf.value = known.name;
        } else if (tickerChanged) {
          nf.value = "";
        } // unknown ticker on a change \u2192 clear for manual entry
      }
    }
    // --- Price: auto-populate today's / last-known price on a real ticker change (stocks & funds).
    //     Skipped while loading an existing row into the form for editing (keep stored values). ---
    if (tickerChanged && !window._loadingEditForm) {
      const lastPx = known && known.price != null ? known.price : null;
      if (lastPx != null) price.value = lastPx;
      else if (isFund) price.value = ""; // unknown fund, no price \u2192 leave empty (derive from Total)
    }
    if (isFund) {
      price.placeholder = "(price known \u2014 or leave, Total wins)";
      price.style.opacity = "1";
      total.style.borderColor = "var(--info)";
      total.setAttribute(
        "data-tip",
        "OPCVM \u2014 enter Quantity + Total TTC; unit price is derived (Total wins over price).",
      );
      if (!total.value && calc && !calc.textContent) {
        calc.innerHTML =
          '<span style="color:var(--info)">OPCVM fund \u2014 enter Quantity + Total TTC (custom fees; standard formula skipped).</span>';
      }
      suggestTotal(tickerChanged); // auto-suggest Total = price \u00D7 qty for funds
    } else {
      price.placeholder = "or use Total";
      price.style.opacity = "1";
      total.style.borderColor = "";
    }
    _lastTk = curTk;
  }
  // Auto-suggest Total for funds: fill Total = price \u00D7 qty when both are known, so the user can
  // review/adjust it. Only sets Total when it is empty or was itself auto-suggested (never clobbers
  // a value the user typed). Total still wins over price on save.
  function suggestTotal(force) {
    if (window._loadingEditForm) return;
    const isFund =
      (opc && opc.checked) ||
      !!(
        M[(tk.value || "").trim().toUpperCase()] &&
        M[(tk.value || "").trim().toUpperCase()].cat === "OPCVM"
      );
    if (!isFund) return;
    const q = parseFloat(document.getElementById("tQty").value),
      px = parseFloat(price.value);
    if (!isNaN(q) && q > 0 && !isNaN(px) && px > 0) {
      const sug = +(q * px).toFixed(2);
      if (total.value === "" || total.dataset.auto === "1" || force) {
        total.value = sug;
        total.dataset.auto = "1";
      }
    }
  }
  // Once the user edits Total themselves, stop auto-overwriting it.
  total.addEventListener("input", () => {
    total.dataset.auto = "";
  });
  ["tQty", "tPrice"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", () => suggestTotal(false));
  });
  tk.addEventListener("input", () => apply(false));
  tk.addEventListener("change", () => apply(false));
  if (opc) opc.addEventListener("change", () => apply(true));
  apply(false);
})();
// Pending form \u2014 same OPCVM badge + Total-field hint
(function () {
  const tk = document.getElementById("pTicker"),
    badge = document.getElementById("pKind"),
    total = document.getElementById("pTotal"),
    price = document.getElementById("pPrice"),
    opc = document.getElementById("pOpcvm");
  if (!tk) return;
  let _lastPTk = (tk.value || "").trim().toUpperCase();
  const apply = (fromCheckbox) => {
    const curTk = (tk.value || "").trim().toUpperCase();
    const tickerChanged = curTk !== _lastPTk;
    const known = M[curTk];
    const knownFund = !!(known && known.cat === "OPCVM");
    if (!fromCheckbox && knownFund && opc && !opc.checked) opc.checked = true;
    const isFund = (opc && opc.checked) || knownFund;
    setKindBadge(badge, tk.value, isFund);
    {
      const nw = document.getElementById("pFundNameWrap"),
        nf = document.getElementById("pFundName");
      if (nw) nw.style.display = ""; // Name shown for stocks & funds
      if (nf) {
        if (known && known.name) {
          if (tickerChanged || !nf.value) nf.value = known.name;
        } else if (tickerChanged) {
          nf.value = "";
        }
      }
    }
    // Auto-populate last-known price on a real ticker change (stocks & funds), user can modify.
    if (tickerChanged && price && !window._loadingEditForm) {
      const lastPx = known && known.price != null ? known.price : null;
      if (lastPx != null) price.value = lastPx;
      else if (isFund) price.value = "";
    }
    if (total) {
      if (isFund) {
        total.style.borderColor = "var(--info)";
        total.setAttribute(
          "data-tip",
          "OPCVM \u2014 enter Quantity + Total TTC; unit price is derived (Total wins over price).",
        );
        if (price) {
          price.placeholder = "(price known \u2014 or leave, Total wins)";
          price.style.opacity = "1";
        }
        pSuggestTotal(tickerChanged);
      } else {
        total.style.borderColor = "";
        if (price) {
          price.placeholder = "or use Total";
          price.style.opacity = "1";
        }
      }
    }
    _lastPTk = curTk;
  };
  function pSuggestTotal(force) {
    if (window._loadingEditForm) return;
    const isFund =
      (opc && opc.checked) ||
      !!(
        M[(tk.value || "").trim().toUpperCase()] &&
        M[(tk.value || "").trim().toUpperCase()].cat === "OPCVM"
      );
    if (!isFund || !total) return;
    const q = parseFloat(document.getElementById("pQty").value),
      px = parseFloat(price.value);
    if (!isNaN(q) && q > 0 && !isNaN(px) && px > 0) {
      const sug = +(q * px).toFixed(2);
      if (total.value === "" || total.dataset.auto === "1" || force) {
        total.value = sug;
        total.dataset.auto = "1";
      }
    }
  }
  if (total)
    total.addEventListener("input", () => {
      total.dataset.auto = "";
    });
  ["pQty", "pPrice"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", () => pSuggestTotal(false));
  });
  tk.addEventListener("input", () => apply(false));
  tk.addEventListener("change", () => apply(false));
  if (opc) opc.addEventListener("change", () => apply(true));
  apply(false);
})();

// Register (or update) a manually-entered OPCVM into the master list so the
// price/fee importer can see it. Matching in the import loops over M and links
// by fund NAME first, then remembers the ISIN after the first manual match.
function registerOpcvm(ticker, name) {
  const tk = (ticker || "").trim().toUpperCase();
  if (!tk) return;
  if (!M[tk]) {
    M[tk] = {
      name: (name || "").trim() || tk,
      cat: "OPCVM",
      cycle: null,
      style: null,
      price: null,
      low: null,
      high: null,
      ev: null,
      netdebt: null,
      roe: null,
      pe: null,
      peg: null,
      divy: null,
      pb: null,
    };
  } else {
    // Existing entry: ensure it's flagged OPCVM and refresh the name if provided.
    M[tk].cat = "OPCVM";
    if (name && String(name).trim()) M[tk].name = String(name).trim();
    else if (!M[tk].name) M[tk].name = tk;
  }
  safeSetItem("casa_master_v1", JSON.stringify(M));
}
document.getElementById("addTxn").onclick = () => {
  const t = {
    date: document.getElementById("tDate").value,
    ticker: document.getElementById("tTicker").value.trim().toUpperCase(),
    action: document.getElementById("tAction").value,
    qty: parseFloat(document.getElementById("tQty").value),
    price: parseFloat(document.getElementById("tPrice").value),
    pea: document.getElementById("tPea").checked,
    opcvm: document.getElementById("tOpcvm").checked,
    broker: document.getElementById("tBroker").value,
  };
  const _tot = parseFloat(document.getElementById("tTotal").value);
  if (!isNaN(_tot) && _tot > 0) t.total = _tot;
  // OPCVM/fund entries are Total-driven: Total TTC is the source of truth and the unit
  // price is ALWAYS derived from total/qty \u2014 this prevents a stale price left in the
  // (dimmed) price box from a previous ticker selection poisoning the fee calc.
  // Stocks keep legacy behaviour: derive price from total only when price is blank.
  const _isFundTxn = !!(
    t.opcvm ||
    (M[t.ticker] && M[t.ticker].cat === "OPCVM")
  );

  if (t.total > 0 && t.qty && (_isFundTxn || isNaN(t.price) || !t.price)) {
    t.price = t.total / t.qty;
  }
  if (!t.date || !t.ticker || !t.qty) {
    toast("Fill date, ticker and quantity.", "warn");
    return;
  }
  if (!t.price && !t.total) {
    toast("Enter a unit price, or a total (for OPCVM).", "warn");
    return;
  }
  // If flagged OPCVM (and not already a known fund), register it in the master list
  // so the VL/fee importer can match it \u2014 by the fund name entered here, or later by ISIN.
  if (t.opcvm && !(M[t.ticker] && M[t.ticker].cat === "OPCVM")) {
    registerOpcvm(t.ticker, (document.getElementById("tFundName") || {}).value);
  } else if (t.opcvm && M[t.ticker] && M[t.ticker].cat === "OPCVM") {
    const _fn = (document.getElementById("tFundName") || {}).value;
    if (_fn && _fn.trim()) {
      M[t.ticker].name = _fn.trim();
      safeSetItem("casa_master_v1", JSON.stringify(M));
    }
  } else {
    // Stock: persist the typed Name to the master list so tables show it (create entry if new).
    const _fn = (document.getElementById("tFundName") || {}).value;
    if (_fn && _fn.trim()) {
      if (!M[t.ticker])
        M[t.ticker] = {
          name: _fn.trim(),
          cat: "STOCK",
          cycle: null,
          style: null,
          price: t.price || null,
        };
      else M[t.ticker].name = _fn.trim();
      safeSetItem("casa_master_v1", JSON.stringify(M));
    }
  }
  // Moroccan market lot note: stocks normally trade in whole shares (OPCVM funds are fractional).
  // The user may legitimately hold a fractional stock (e.g. a partial lot from another portfolio),
  // so we KEEP the fraction and only show a non-blocking heads-up.
  let _fracWarn = "";
  if (!t.opcvm && Math.abs(t.qty - Math.round(t.qty)) > 1e-9) {
    _fracWarn =
      "\u26a0\ufe0f Kept fractional stock qty " +
      t.qty +
      " for " +
      t.ticker +
      " (stocks usually trade in whole shares).";
  }
  // --- Tier 2 additive validation: reject malformed values before they
  // enter TXNS. Guards only; valid input is processed exactly as before. ---
  if (!validTxnDate(t.date)) {
    toast("Date must be a real calendar date (YYYY-MM-DD).", "warn");
    return;
  }
  if (!(t.qty > 0) || !isFinite(t.qty)) {
    toast("Quantity must be a positive number.", "warn");
    return;
  }
  if (t.price != null && (!(t.price > 0) || !isFinite(t.price))) {
    toast("Unit price must be a positive number.", "warn");
    return;
  }
  if (t.total != null && (!(t.total > 0) || !isFinite(t.total))) {
    toast("Total must be a positive number.", "warn");
    return;
  }
  // --- end Tier 2 validation ---
  // Carry dividend side-channel metadata (ex-date, eligible-shares basis) that
  // the form has no visible field for. Set by prefillDividend / editTxn; merged
  // here so manual add + edit no longer drop it. Cleared after use.
  if (t.action === "DIV" && _pendingDivMeta) {
    if (_pendingDivMeta.exDate) t.exDate = _pendingDivMeta.exDate;
    if (_pendingDivMeta.eligBasis != null)
      t.eligBasis = _pendingDivMeta.eligBasis;
  }
  _pendingDivMeta = null;
  if (EDIT_IX != null) {
    TXNS[EDIT_IX] = t;
    EDIT_IX = null;
    document.getElementById("addTxn").textContent = "Add";
    document.getElementById("cancelEdit").style.display = "none";
    document.getElementById("editHint").textContent = "";
  } else {
    TXNS.push(t);
  }
  saveTxns(TXNS);
  document.getElementById("tQty").value = "";
  document.getElementById("tPrice").value = "";
  document.getElementById("tTotal").value = "";
  document.getElementById("tPea").checked = true;
  document.getElementById("tOpcvm").checked = false;
  document.getElementById("txnCalc").textContent = "";
  {
    const _fn = document.getElementById("tFundName");
    if (_fn) {
      _fn.value = "";
    }
  }
  {
    const _tt = document.getElementById("tTotal");
    if (_tt) {
      _tt.dataset.auto = "";
    }
  }
  {
    const _d = document.getElementById("tDate");
    if (_d && EDIT_IX == null) _d.value = _qwTodayISO();
  }
  render();
  if (_fracWarn) {
    const eh = document.getElementById("editHint");
    if (eh) {
      eh.style.color = "var(--warn)";
      eh.textContent = _fracWarn;
      setTimeout(() => {
        if (eh.textContent === _fracWarn) {
          eh.textContent = "";
          eh.style.color = "";
        }
      }, 6000);
    }
  }
};
document
  .querySelectorAll("#stocksTable th[data-k], #fundsTable th[data-k]")
  .forEach(
    (th) =>
      (th.onclick = () => {
        const k = th.dataset.k;
        POS_SORT.d = POS_SORT.k === k ? -POS_SORT.d : -1;
        POS_SORT.k = k;
        const { pos } = runFIFO();
        const arr = Object.values(pos);
        const t = arr.reduce(
          (a, p) => ({
            inv: a.inv + (p.held > 0 ? p.invested : 0),
            val: a.val + p.value,
            net: a.net + (p.netIfSold || 0),
            unreal: a.unreal + p.unreal,
            real: a.real + p.realized,
            div: a.div + p.divs,
            life: a.life + p.lifetime,
            cost: a.cost + (p.costBasis || 0),
          }),
          {
            inv: 0,
            val: 0,
            net: 0,
            unreal: 0,
            real: 0,
            div: 0,
            life: 0,
            cost: 0,
          },
        );
        renderPositions(arr, t);
      }),
  );
// 2) Signals sortable headers
let SIG_SORT = { k: "score", d: -1, userSet: false };
document.querySelectorAll("#sigTable th[data-k]").forEach(
  (th) =>
    (th.onclick = () => {
      const k = th.dataset.k;
      SIG_SORT.d = SIG_SORT.k === k ? -SIG_SORT.d : -1;
      SIG_SORT.k = k;
      SIG_SORT.userSet = true;
      renderSignals();
    }),
);
