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
    <td class="center nis-cell" style="cursor:help" data-tip="${encodeURIComponent(signalTipHTML(r))}"><span class="badge ${r.sig.c}">${r.sig.t}</span> <span style="color:var(--muted)">\u24D8</span></td>
    <td class="${r.price != null ? "nis-cell" : ""}" style="${r.price != null ? "cursor:help" : ""}" data-tip="${r.price != null ? encodeURIComponent(priceTipHTML(r)) : ""}">${r.price != null ? money(r.price) : "\u2014"}${r.price != null && r.fv != null && r.fv > 0 ? (r.price < r.fv ? ' <span style=\"color:var(--success)\" title=\"Below fair value\">\u25B2</span>' : r.price > r.fv ? ' <span style=\"color:var(--error)\" title=\"Above fair value\">\u25BC</span>' : "") : ""}</td><td class="${r.fv != null ? "nis-cell" : ""}" style="${r.fv != null ? "cursor:help" : ""}" data-tip="${r.fv != null ? encodeURIComponent(fvTipHTML(r)) : ""}">${r.fv != null ? money(r.fv) : "\u2014"}</td>
    <td class="${r.tbuy != null ? "nis-cell" : ""}" style="${r.tbuy != null ? "cursor:help" : ""}" data-tip="${r.tbuy != null ? encodeURIComponent(tgtBuyTipHTML(r)) : ""}">${r.tbuy != null ? money(r.tbuy) : "\u2014"}</td>
    <td class="${r.tsell != null ? "nis-cell" : ""}" style="${r.tsell != null ? "cursor:help" : ""}" data-tip="${r.tsell != null ? encodeURIComponent(tgtSellTipHTML(r)) : ""}">${r.tsell != null ? money(r.tsell) : "\u2014"}</td>
    <td class="${r.score != null ? "nis-cell" : ""}" style="${r.score != null ? "cursor:help" : ""}" data-tip="${r.score != null ? encodeURIComponent(scoreTipHTML(r)) : ""}">${r.score != null ? (r.score * 100).toFixed(0) + "%" : "\u2014"}</td>
    <td class="center ${r.sc ? "nis-cell" : ""}" style="${r.sc ? "cursor:help" : ""}" data-tip="${r.sc ? encodeURIComponent(convTipHTML(r)) : ""}">${r.conviction ? `<span class="chip" style="background:${r.conviction === "High" ? "rgba(34,197,94,.15);color:var(--success)" : r.conviction === "Medium" ? "rgba(245,158,11,.15);color:var(--warn)" : "rgba(239,68,68,.15);color:var(--error)"}">${r.conviction}</span>` : "\u2014"}</td>
    <td class="${r.pir != null ? "nis-cell" : ""}" style="${r.pir != null ? "cursor:help" : ""}" data-tip="${r.pir != null ? encodeURIComponent(pirTipHTML(r)) : ""}">${r.pir != null ? pct(r.pir) : "\u2014"}</td><td class="${r.pe != null ? "nis-cell" : ""}" style="${r.pe != null ? "cursor:help" : ""}" data-tip="${r.pe != null ? encodeURIComponent(peTipHTML(r)) : ""}">${r.pe != null ? money(r.pe, 1) : "\u2014"}</td>
    <td class="${r.divy != null ? "nis-cell" : ""}" style="${r.divy != null ? "cursor:help" : ""}" data-tip="${r.divy != null ? encodeURIComponent(divyTipHTML(r)) : ""}">${r.divy != null ? pct(r.divy) : "\u2014"}</td></tr>`;
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
  // Dividend tax on the REGULAR-account portion only (PEA is exempt), rounded
  // to centimes to match the cents-precise core.
  const tax = _round(d.amount * regPortion * (1 + vatRate()) * rate);
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
  let _projCal = DIVCAL;
  if (_divProject) {
    const yr = TODAY.getFullYear();
    const shifted = DIVCAL.filter(
      (d) => d.pay_date && d.pay_date.startsWith(String(yr)),
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
          h += `<div style="display:flex;justify-content:space-between;gap:16px"><span>${x.ticker} <span class="mini">${x.date}</span></span><span style="font-family:var(--mono)">${money(x.amount)}</span></div>`;
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
            (tk) => `<tr><td class="l"><b>${tk}</b></td>
        <td class="l" style="color:var(--text2)">${(M[tk] && M[tk].name) || ""}</td>
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
            ? `<td class="nis-cell" style="cursor:help" data-tip="${encodeURIComponent(divEstTipHTML(d, eligNow))}">${money(d.amount)} <span style="color:var(--muted)">\u24D8</span></td>`
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
      <td>${money(q, q % 1 ? 3 : 0)}</td><td class="nis-cell pos" style="cursor:help" data-tip="${encodeURIComponent(divEstTipHTML(d, q))}">${money(est)} <span style="color:var(--muted)">\u24D8</span></td><td class="center">${daysUntil(d.pay_date)}d</td></tr>`;
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
      return `<tr${rowStyle}><td class="center"><input type="checkbox" class="txnChk" data-idx="${i}"></td><td class="l">${t.date}</td><td class="l"><b>${escapeHtml(t.ticker)}</b>${t.auto ? ' <span class="chip nis-cell" style="background:rgba(245,158,11,.18);color:var(--warn);cursor:help" data-tip="' + encodeURIComponent(autoDivTip(t)) + '">auto \u24D8</span>' : ""}${typeof t.total === "number" && t.total > 0 ? ' <span class="chip" style="background:rgba(56,189,248,.15);color:var(--info)" data-tip="Manual total \u2014 custom fees (e.g. OPCVM)">manual</span>' : ""}</td>
      <td class="l" style="color:var(--text2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml((M[t.ticker] && M[t.ticker].name) || "")}">${escapeHtml((M[t.ticker] && M[t.ticker].name) || "\u2014")}</td>
      <td class="l"><span class="badge ${ac}">${t.action}</span></td><td>${money(t.qty, t.qty % 1 ? 3 : 0)}</td>
      <td>${money(t.price)}</td><td>${e.fees != null ? money(e.fees) : "\u2014"}</td><td>${e.tax != null ? money(e.tax) : "\u2014"}</td>
      <td class="${e.ttc != null ? "nis-cell" : ""}" style="${e.ttc != null ? "cursor:help" : ""}" data-tip="${e.ttc != null ? encodeURIComponent(ttcTipHTML(t, e)) : ""}">${e.ttc != null ? money(e.ttc) : "\u2014"} ${e.ttc != null ? '<span style="color:var(--muted)">\u24D8</span>' : ""}</td><td class="${cls(e.net)} ${e.net != null ? "nis-cell" : ""}" style="${e.net != null ? "cursor:help" : ""}" data-tip="${e.net != null ? encodeURIComponent(ttcTipHTML(t, e)) : ""}">${e.net != null ? money(e.net) : "\u2014"} ${e.net != null ? '<span style="color:var(--muted)">\u24D8</span>' : ""}</td>
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

// ---------- price refresh (paste TradingView) ----------
function cleanNum(s) {
  if (s == null) return null;
  if (typeof s === "number") return s;
  let x = String(s)
    .replace(/\u00a0/g, "")
    .replace(/\u202f/g, "")
    .replace(/\s/g, "")
    .replace(/MAD/g, "")
    .replace(/\u2212/g, "-")
    .replace(/%/g, "");
  // thousands: "1,260" -> 1260 ; but decimals use "." in this feed
  if (/,\d{3}(\D|$)/.test(x)) x = x.replace(/,/g, "");
  else x = x.replace(/,/g, ".");
  const v = parseFloat(x);
  return isNaN(v) ? null : v;
}
const TICKERS = Object.keys(M).sort((a, b) => b.length - a.length); // longest first for prefix match
function extractTicker(colA) {
  if (!colA) return null;
  const s = String(colA).trim();
  for (const t of TICKERS) {
    if (s.toUpperCase().startsWith(t.toUpperCase())) return t;
  }
  // fallback: leading capital block
  const m = s.match(/^([A-Z0-9]{2,5})/);
  return m ? m[1] : null;
}

// Multi-line TradingView watchlist parser (ticker / company / "D" / data row / rating / category+metrics)
const TV_TICKERS = Object.keys(M).sort((a, b) => b.length - a.length);
// TradingView ticker aliases: maps TV ticker \u2192 master ticker when they differ.
// Add entries here when a stock's TV symbol doesn't match your master key.
const TV_TICKER_ALIAS = { SOT: "SSOT" };
function parseTV(raw) {
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));
  const isData = (s) => s.indexOf("\t") >= 0 && /MAD/.test(s);
  const RATINGS = [
    "Buy",
    "Sell",
    "Neutral",
    "No rating",
    "Strong buy",
    "Strong sell",
  ];
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = (lines[i] || "").trim();
    // Only EXACT known tickers (or aliased) anchor a row \u2014 prevents header noise from matching.
    const _resolved = TV_TICKER_ALIAS[line] || line;
    const known = M[_resolved] != null;
    if (line && known) {
      const tk = _resolved;
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const comp = j < lines.length ? lines[j].trim() : null;
      // main data row within a few lines
      let k = j,
        main = -1;
      while (k < Math.min(j + 6, lines.length)) {
        if (isData(lines[k])) {
          main = k;
          break;
        }
        k++;
      }
      if (main >= 0) {
        const c = lines[main].split("\t").map((x) => x.trim());
        const g = (idx) => (idx < c.length ? cleanNum(c[idx]) : null);
        // divy, pe, pb, peg, dps all now come from the 2nd metrics line
        // New layout: main line = [Price, Chg%, Vol, 52wLow, 52wHigh, MktCap, Sector]
        const _sector =
          c.length >= 7 && c[6] && !/^[\d.,\s%+\-]+$/.test(c[6])
            ? c[6].trim()
            : null;
        const rec = {
          ticker: tk,
          company: comp,
          price: g(0),
          low: g(3),
          high: g(4),
          category: _sector || null,
        };
        // second metrics line (category + EV/EBITDA, NetDebt, ROE%)
        let s = main + 1;
        while (s < Math.min(main + 5, lines.length)) {
          const t = lines[s].trim();
          if (
            lines[s].indexOf("\t") >= 0 &&
            !/^\s*[\d.,]+.*MAD/.test(lines[s].split("\t")[0]) &&
            t &&
            RATINGS.indexOf(t) < 0
          ) {
            const sc = lines[s].split("\t").map((x) => x.trim());
            // New 2nd metrics line layout (14 columns):
            // [0]=P/E [1]=P/B [2]=PEG [3]=EPS Growth% [4]=Net Income [5]=Revenue
            // [6]=Div Yield% [7]=DPS [8]=EV/EBITDA [9]=Debt/EBITDA [10]=ROE% [11]=EPS [12]=BVPS [13]=FCF/Share
            const _pe2 = cleanNum(sc[0]),
              _pb2 = cleanNum(sc[1]),
              _peg2 = cleanNum(sc[2]);
            const _epsGr = cleanNum(sc[3]); // EPS growth % (e.g. +75.70 from "+75.70%")
            const _ni = cleanNum(sc[4]); // Net Income (informational)
            const _rev = cleanNum(sc[5]); // Revenue (TTM)
            const _divy2 = cleanNum(sc[6]); // Div yield % (e.g. 1.31 from "1.31%")
            const _dps2 = cleanNum(sc[7]); // DPS
            const _ev2 = cleanNum(sc[8]),
              _nd2 = cleanNum(sc[9]);
            const _roe2 = cleanNum(sc[10]); // ROE %
            const _eps2 = cleanNum(sc[11]),
              _bvps2 = cleanNum(sc[12]);
            const _fcf2 = cleanNum(sc[13]); // Free Cash Flow Per Share
            if (_pe2 != null) rec.pe = _pe2;
            if (_pb2 != null) rec.pb = _pb2;
            if (_peg2 != null) rec.peg = _peg2;
            if (_epsGr != null) rec.epsGrowth = _epsGr / 100; // store as decimal
            if (_rev != null) rec.revenue = _rev;
            if (_divy2 != null) rec.divy = _divy2 / 100; // store as decimal
            if (_dps2 != null) rec.dps = _dps2;
            if (_ev2 != null) rec.ev = _ev2;
            if (_nd2 != null) rec.netdebt = _nd2;
            if (_roe2 != null) rec.roe = _roe2 / 100;
            if (_eps2 != null) rec.eps = _eps2;
            if (_bvps2 != null) rec.bvps = _bvps2;
            if (_fcf2 != null) rec.fcf = _fcf2;
            break;
          }
          s++;
        }
        out.push(rec);
        i = main + 1;
        continue;
      }
    }
    i++;
  }
  return out;
}

document.getElementById("applyTV").onclick = () => {
  const raw = document.getElementById("tvPaste").value;
  if (!raw.trim()) {
    document.getElementById("tvResult").textContent = "Paste some rows first.";
    return;
  }
  const rows = parseTV(raw);
  let updated = 0,
    unmatched = [];
  for (const r of rows) {
    const tk = r.ticker;
    if (!tk || !M[tk]) {
      if (tk) unmatched.push(tk);
      continue;
    }
    const set = (k, v) => {
      if (v != null && !isNaN(v)) M[tk][k] = v;
    };
    set("price", r.price);
    set("low", r.low);
    set("high", r.high);
    set("pe", r.pe);
    set("pb", r.pb);
    set("peg", r.peg);
    set("divy", r.divy);
    set("ev", r.ev);
    set("netdebt", r.netdebt);
    set("roe", r.roe);
    // Absolute per-share fundamentals (price-independent) \u2014 used by fairValue to break circularity.
    set("eps", r.eps);
    set("bvps", r.bvps);
    set("dps", r.dps);
    set("fcf", r.fcf);
    set("revenue", r.revenue);
    set("epsGrowth", r.epsGrowth);
    if (r.category) M[tk].cat = M[tk].cat || r.category;
    updated++;
  }
  safeSetItem("casa_master_v1", JSON.stringify(M));
  document.getElementById("tvResult").innerHTML =
    "\u2705 Updated <b>" +
    updated +
    "</b> tickers." +
    (unmatched.length
      ? ' <span style="color:var(--muted)">Unmatched: ' +
        [...new Set(unmatched)].slice(0, 8).join(", ") +
        (unmatched.length > 8 ? "\u2026" : "") +
        "</span>"
      : "");
  render();
};
document.getElementById("clearTV").onclick = () => {
  document.getElementById("tvPaste").value = "";
  document.getElementById("tvResult").textContent = "";
};

// ---------- OPCVM performance-file import (native unzip, no libs) ----------
(function () {
  const fileInpDaily = document.getElementById("opcvmFileDaily");
  const fileInpWeekly = document.getElementById("opcvmFileWeekly");
  const applyBtn = document.getElementById("applyOpcvm");
  const reviewEl = document.getElementById("opcvmReview");
  const resEl = document.getElementById("opcvmResult");
  const nameEl = document.getElementById("opcvmFileName");
  const stampEl = document.getElementById("opcvmStamp");
  if (!fileInpDaily && !fileInpWeekly) return;
  let IMPORT_MODE = "weekly"; // 'daily' = VL only \u00B7 'weekly' = VL + fees

  const MAP_LS = "casa_opcvm_isin_map_v1"; // { ticker: isin }
  const loadMap = () => {
    try {
      return JSON.parse(localStorage.getItem(MAP_LS) || "{}");
    } catch (e) {
      return {};
    }
  };
  const saveMap = (m) => {
    safeSetItem(MAP_LS, JSON.stringify(m));
  };

  const norm = (s) =>
    String(s || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  // Fuzzy fund-name matching helpers (accent-insensitive + token overlap).
  const stripAccents = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const normFuzzy = (s) => norm(stripAccents(s));
  const _STOP = new Set([
    "DE",
    "DU",
    "DES",
    "LA",
    "LE",
    "LES",
    "FCP",
    "SICAV",
    "OPCVM",
    "FONDS",
    "FUND",
    "R",
    "C",
    "D",
    "I",
  ]);
  const toks = (s) =>
    normFuzzy(s)
      .split(" ")
      .filter((w) => w && !_STOP.has(w));
  // Jaccard-ish token overlap in [0,1]; 1.0 = identical significant tokens.
  function nameScore(a, b) {
    const A = toks(a),
      B = toks(b);
    if (!A.length || !B.length) return 0;
    const sa = new Set(A),
      sb = new Set(B);
    let inter = 0;
    sa.forEach((w) => {
      if (sb.has(w)) inter++;
    });
    const union = new Set([...sa, ...sb]).size;
    return inter / union;
  }
  // Best fuzzy match of a held-fund name against the file's FUNDS list.
  // Returns {idx, score} or {idx:-1}. Threshold 0.5 avoids weak false matches.
  function bestFuzzy(heldName) {
    let best = -1,
      bestS = 0,
      second = -1,
      secondS = 0;
    for (let i = 0; i < FUNDS.length; i++) {
      const sc = nameScore(heldName, FUNDS[i].name);
      if (sc > bestS) {
        second = best;
        secondS = bestS;
        bestS = sc;
        best = i;
      } else if (sc > secondS) {
        secondS = sc;
        second = i;
      }
    }
    if (bestS < 0.5) return { idx: -1, score: bestS };
    // Ambiguous when the runner-up is within 0.15 of the winner (and non-trivial).
    const ambiguous = second >= 0 && secondS >= 0.4 && bestS - secondS < 0.15;
    return {
      idx: best,
      score: bestS,
      ambiguous,
      secondName: ambiguous ? FUNDS[second].name : null,
      secondScore: ambiguous ? secondS : null,
    };
  }

  // --- minimal ZIP reader: locate a stored entry by name and inflate (deflate-raw) ---
  async function readXlsxSheet(buf) {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    // scan End Of Central Directory to find central dir
    let eocd = -1;
    for (let i = u8.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("Not a valid .xlsx (no EOCD)");
    let cdOff = dv.getUint32(eocd + 16, true);
    const cdCount = dv.getUint16(eocd + 10, true);
    const entries = {};
    let p = cdOff;
    for (let n = 0; n < cdCount; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commLen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const nm = new TextDecoder().decode(
        u8.subarray(p + 46, p + 46 + nameLen),
      );
      entries[nm] = { method, compSize, lho };
      p += 46 + nameLen + extraLen + commLen;
    }
    async function extract(nm) {
      const e = entries[nm];
      if (!e) throw new Error("missing " + nm);
      // parse local header for its own name/extra lengths
      const lnl = dv.getUint16(e.lho + 26, true),
        lel = dv.getUint16(e.lho + 28, true);
      const start = e.lho + 30 + lnl + lel;
      const comp = u8.subarray(start, start + e.compSize);
      if (e.method === 0) return new TextDecoder().decode(comp); // stored
      // deflate-raw via native DecompressionStream
      const ds = new DecompressionStream("deflate-raw");
      const stream = new Response(comp).body.pipeThrough(ds);
      const ab = await new Response(stream).arrayBuffer();
      return new TextDecoder("utf-8").decode(ab);
    }
    // Find first worksheet
    const sheetName = Object.keys(entries).find((k) =>
      /^xl\/worksheets\/sheet\d+\.xml$/.test(k),
    );
    if (!sheetName) throw new Error("no worksheet found");
    return await extract(sheetName);
  }

  function colOf(ref) {
    // 'A3' -> 0
    const m = /^([A-Z]+)/.exec(ref);
    if (!m) return -1;
    let c = 0;
    for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
    return c - 1;
  }
  function parseSheet(xml) {
    const rows = [];
    const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
    let rm;
    while ((rm = rowRe.exec(xml))) {
      const cells = {};
      const cRe = /<c\s+([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
      let cm;
      while ((cm = cRe.exec(rm[1]))) {
        const attrs = cm[1];
        const inner = cm[3] || "";
        const rMatch = /r="([A-Z]+\d+)"/.exec(attrs);
        if (!rMatch) continue;
        const ci = colOf(rMatch[1]);
        const tMatch = /t="([^"]*)"/.exec(attrs);
        const t = tMatch ? tMatch[1] : null;
        let val = null;
        if (t === "inlineStr") {
          const im = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
          val = im ? decodeXml(im[1]) : "";
        } else {
          const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
          val = vm ? vm[1] : null;
        }
        cells[ci] = val;
      }
      rows.push(cells);
    }
    return rows;
  }
  function decodeXml(s) {
    return s
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  let FUNDS = []; // parsed file rows: {isin,name,vl,buyFee,sellFee,mgmt}
  let PLAN = []; // review rows: {ticker,fundName,curPrice, chosenIdx}

  function buildPlan() {
    const map = loadMap();
    PLAN = [];
    const byIsin = {};
    FUNDS.forEach((f, idx) => {
      if (f.isin) byIsin[f.isin] = idx;
    });
    const byName = {};
    FUNDS.forEach((f, idx) => {
      byName[norm(f.name)] = idx;
    });
    const byNameFz = {};
    FUNDS.forEach((f, idx) => {
      const k = normFuzzy(f.name);
      if (byNameFz[k] == null) byNameFz[k] = idx;
    });
    for (const tk in M) {
      if (!(M[tk] && M[tk].cat === "OPCVM")) continue;
      let idx = -1;
      const savedIsin = map[tk] || M[tk].isin;
      if (savedIsin && byIsin[savedIsin] != null) idx = byIsin[savedIsin];
      else if (byName[norm(M[tk].name)] != null) idx = byName[norm(M[tk].name)];
      else if (byNameFz[normFuzzy(M[tk].name)] != null)
        idx = byNameFz[normFuzzy(M[tk].name)];
      let _fuzzyScore = null,
        _amb = null,
        _secName = null,
        _secScore = null;
      if (idx < 0) {
        const bf = bestFuzzy(M[tk].name);
        if (bf.idx >= 0) {
          idx = bf.idx;
          _fuzzyScore = bf.score;
          _amb = bf.ambiguous;
          _secName = bf.secondName;
          _secScore = bf.secondScore;
        }
      }
      PLAN.push({
        ticker: tk,
        fundName: M[tk].name,
        curPrice: M[tk].price,
        chosenIdx: idx,
        fuzzy: _fuzzyScore,
        amb: _amb,
        secName: _secName,
        secScore: _secScore,
      });
    }
    renderReview();
  }

  function renderReview() {
    if (!FUNDS.length) {
      reviewEl.innerHTML = "";
      applyBtn.style.display = "none";
      return;
    }
    const weekly = IMPORT_MODE === "weekly";
    const opts = (sel) =>
      ['<option value="-1">\u2014 not in file / skip \u2014</option>']
        .concat(
          FUNDS.map(
            (f, i) =>
              '<option value="' +
              i +
              '"' +
              (i === sel ? " selected" : "") +
              ">" +
              f.name +
              " (" +
              f.isin +
              ")</option>",
          ),
        )
        .join("");
    // Fee columns only shown for the weekly file (the daily file's fees are ignored).
    const feeHead = weekly
      ? '<th scope="col" style="text-align:right">Buy fee</th><th scope="col" style="text-align:right">Sell fee</th>'
      : "";
    let h =
      '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="text-align:left;color:var(--muted)">' +
      '<th scope="col" style="padding:4px">Held OPCVM</th><th scope="col">Matched fund (from file)</th><th scope="col" style="text-align:right">Old VL</th><th scope="col" style="text-align:right">New VL</th>' +
      feeHead +
      "</tr></thead><tbody>";
    PLAN.forEach((row, ri) => {
      const f = row.chosenIdx >= 0 ? FUNDS[row.chosenIdx] : null;
      const pct = (v) => (v == null ? "\u2014" : (v * 100).toFixed(2) + "%");
      const feeCells = weekly
        ? '<td style="text-align:right">' +
          (f ? pct(f.buyFee) : "\u2014") +
          "</td>" +
          '<td style="text-align:right">' +
          (f ? pct(f.sellFee) : "\u2014") +
          "</td>"
        : "";
      h +=
        '<tr style="border-top:1px solid var(--border)">' +
        '<td style="padding:5px 4px"><b>' +
        row.fundName +
        '</b> <span class="mini" style="color:var(--muted)">' +
        row.ticker +
        "</span>" +
        (row.fuzzy != null && row.chosenIdx >= 0
          ? ' <span class="mini" title="Matched by name similarity \u2014 please verify" style="color:var(--warn)">~fuzzy ' +
            Math.round(row.fuzzy * 100) +
            "%</span>"
          : "") +
        (row.amb && row.chosenIdx >= 0
          ? ' <span class="mini" title="Close runner-up: ' +
            String(row.secName || "").replace(/"/g, "&quot;") +
            " (" +
            Math.round((row.secScore || 0) * 100) +
            '%). Two funds scored similarly \u2014 verify the right one is selected." style="color:var(--danger,#e5484d);font-weight:600">\u26A0 ambiguous</span>'
          : "") +
        "</td>" +
        '<td><select data-ri="' +
        ri +
        '" class="opcvmSel" style="max-width:260px;background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:3px 6px;font-size:11px">' +
        opts(row.chosenIdx) +
        "</select></td>" +
        '<td style="text-align:right;font-family:var(--mono)">' +
        (row.curPrice != null ? row.curPrice : "\u2014") +
        "</td>" +
        '<td style="text-align:right;font-family:var(--mono);color:' +
        (f ? "var(--success)" : "var(--muted)") +
        '">' +
        (f ? f.vl : "\u2014") +
        "</td>" +
        feeCells +
        "</tr>";
    });
    h += "</tbody></table>";
    const matched = PLAN.filter((r) => r.chosenIdx >= 0).length;
    h +=
      '<div class="mini" style="margin-top:8px">' +
      matched +
      " of " +
      PLAN.length +
      " held funds matched. " +
      FUNDS.length +
      " funds in file \u00B7 <b>" +
      (weekly ? "weekly (VL + fees)" : "daily (VL only)") +
      "</b> mode.</div>";
    reviewEl.innerHTML = h;
    reviewEl.querySelectorAll(".opcvmSel").forEach((sel) => {
      sel.onchange = (e) => {
        const ri = +e.target.dataset.ri;
        PLAN[ri].chosenIdx = +e.target.value;
        PLAN[ri].fuzzy = null;
        renderReview();
      };
    });
    applyBtn.style.display = matched ? "inline-block" : "none";
  }

  async function handleFile(f, mode) {
    if (!f) return;
    IMPORT_MODE = mode;
    nameEl.textContent =
      f.name +
      "  \u00B7  " +
      (mode === "daily" ? "daily (VL only)" : "weekly (VL + fees)");
    resEl.textContent = "Reading\u2026";
    try {
      const buf = await f.arrayBuffer();
      const xml = await readXlsxSheet(buf);
      const rows = parseSheet(xml);
      // header row: find row containing 'CODE ISIN'
      let hi = rows.findIndex((r) =>
        Object.values(r).some((v) =>
          String(v).toUpperCase().includes("CODE ISIN"),
        ),
      );
      if (hi < 0) hi = 1;
      const num = (v) => {
        if (v == null || v === "" || v === "-") return null;
        const n = parseFloat(v);
        return isNaN(n) ? null : n;
      };
      FUNDS = [];
      for (let i = hi + 1; i < rows.length; i++) {
        const r = rows[i];
        const isin = r[0];
        const name = r[2];
        if (!isin || !name) continue;
        FUNDS.push({
          isin: String(isin).trim(),
          name: String(name).trim(),
          vl: num(r[17]),
          buyFee: num(r[11]),
          sellFee: num(r[12]),
          mgmt: num(r[13]),
        });
      }
      // date from title row (row 1) if present
      const t0 = rows[0] ? Object.values(rows[0]).join(" ") : "";
      const dm = /(\d{2})-(\d{2})-(\d{4})/.exec(t0);
      window.__opcvmFileDate = dm ? dm[3] + "-" + dm[2] + "-" + dm[1] : null;
      resEl.textContent =
        "Parsed " +
        FUNDS.length +
        " funds" +
        (mode === "daily"
          ? " (VL only \u2014 fees ignored in this file)"
          : "") +
        ".";
      buildPlan();
    } catch (err) {
      resEl.innerHTML =
        '<span style="color:var(--error)">Import failed: ' +
        err.message +
        "</span>";
    }
  }
  if (fileInpDaily)
    fileInpDaily.onchange = (e) =>
      handleFile(e.target.files && e.target.files[0], "daily");
  if (fileInpWeekly)
    fileInpWeekly.onchange = (e) =>
      handleFile(e.target.files && e.target.files[0], "weekly");

  applyBtn.onclick = () => {
    const map = loadMap();
    let updated = 0,
      fees = 0;
    const weekly = IMPORT_MODE === "weekly";
    for (const row of PLAN) {
      if (row.chosenIdx < 0) continue;
      const f = FUNDS[row.chosenIdx];
      const tk = row.ticker;
      if (!M[tk]) continue;
      if (f.vl != null) {
        M[tk].price = f.vl;
        updated++;
      }
      M[tk].isin = f.isin;
      // Fees only come from the WEEKLY (full) file. The daily file's fee columns
      // are ignored so a daily refresh never overwrites your stored fees.
      if (weekly) {
        if (f.buyFee != null) {
          M[tk].buyFee = f.buyFee;
          fees++;
        }
        if (f.sellFee != null) {
          M[tk].sellFee = f.sellFee;
        }
        if (f.mgmt != null) {
          M[tk].mgmt = f.mgmt;
        }
      }
      map[tk] = f.isin; // remember mapping for future imports
    }
    saveMap(map);
    safeSetItem("casa_master_v1", JSON.stringify(M));
    if (window.__opcvmFileDate) {
      try {
        localStorage.setItem("casa_opcvm_updated_v1", window.__opcvmFileDate);
      } catch (e) {}
      // remember which file kind set the VL date (for the stamp label)
      try {
        localStorage.setItem(
          "casa_opcvm_updated_kind_v1",
          weekly ? "weekly" : "daily",
        );
      } catch (e) {}
    }
    resEl.innerHTML = weekly
      ? "\u2705 Updated <b>" +
        updated +
        "</b> prices and stored fees for <b>" +
        fees +
        "</b> funds."
      : "\u2705 Updated <b>" +
        updated +
        "</b> prices (VL). Fees left unchanged \u2014 import the weekly file to refresh fees.";
    showOpcvmStamp();
    render();
  };

  function showOpcvmStamp() {
    let d = null,
      kind = null;
    try {
      d = localStorage.getItem("casa_opcvm_updated_v1");
      kind = localStorage.getItem("casa_opcvm_updated_kind_v1");
    } catch (e) {}
    if (stampEl)
      stampEl.textContent = d
        ? "\u00B7 VL as of " + d + (kind ? " (" + kind + ")" : "")
        : "";
  }
  showOpcvmStamp();
})();

// restore any saved master overrides on load
try {
  const sm = localStorage.getItem("casa_master_v1");
  if (sm) {
    const o = JSON.parse(sm);
    for (const k in o) {
      if (M[k]) Object.assign(M[k], o[k]);
      else M[k] = o[k];
    }
  }
} catch (e) {}

// ---------- CSV import / export ----------
document.getElementById("exportCsv").onclick = () => {
  const rows = [
    ["date", "ticker", "action", "qty", "price", "pea", "opcvm", "total"],
    ...TXNS.map((t) => [
      t.date,
      t.ticker,
      t.action,
      t.qty,
      t.price,
      t.pea ? "yes" : "no",
      t.opcvm ? "yes" : "no",
      typeof t.total === "number" && t.total > 0 ? t.total : "",
    ]),
  ];
  const csv = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" }),
    url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "transactions.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  document.getElementById("csvResult").textContent =
    `Exported ${TXNS.length} rows.`;
};
document.getElementById("importCsv").onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      const lines = String(rd.result)
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .filter((l) => l.trim());
      const hdr = lines[0]
        .toLowerCase()
        .split(",")
        .map((s) => s.trim());
      const ix = {
        date: hdr.indexOf("date"),
        ticker: hdr.indexOf("ticker"),
        action: hdr.indexOf("action"),
        qty: hdr.indexOf("qty"),
        price: hdr.indexOf("price"),
        pea: hdr.indexOf("pea"),
        opcvm: hdr.indexOf("opcvm"),
        total: hdr.indexOf("total"),
      };
      if (
        [ix.date, ix.ticker, ix.action, ix.qty, ix.price].some((v) => v < 0)
      ) {
        document.getElementById("csvResult").textContent =
          "\u274C CSV needs columns: date,ticker,action,qty,price (pea,total optional)";
        return;
      }
      const out = [];
      for (let i = 1; i < lines.length; i++) {
        const c = lines[i].split(",");
        const o = {
          date: (c[ix.date] || "").trim(),
          ticker: (c[ix.ticker] || "").trim().toUpperCase(),
          action: (c[ix.action] || "").trim().toUpperCase(),
          qty: parseFloat(c[ix.qty]),
          price: parseFloat(c[ix.price]),
        };
        if (ix.pea >= 0) {
          const pv = (c[ix.pea] || "").trim().toLowerCase();
          o.pea = pv === "yes" || pv === "pea" || pv === "true" || pv === "1";
        }
        if (ix.opcvm >= 0) {
          const ov = (c[ix.opcvm] || "").trim().toLowerCase();
          o.opcvm =
            ov === "yes" ||
            ov === "opcvm" ||
            ov === "fund" ||
            ov === "true" ||
            ov === "1";
        }
        // If the column is absent, infer from the master list so known funds are still flagged.
        if (o.opcvm !== true && M[o.ticker] && M[o.ticker].cat === "OPCVM")
          o.opcvm = true;
        if (ix.total >= 0) {
          const tv = parseFloat(c[ix.total]);
          if (!isNaN(tv) && tv > 0) o.total = tv;
        }
        // OPCVM parity with the add-form: if a row has a Total but no unit price
        // (funds are entered by Quantity + Total TTC), derive the unit price so the
        // row survives the filter below and stores identically to a UI-entered fund.
        if ((isNaN(o.price) || !o.price) && o.total > 0 && o.qty) {
          o.price = o.total / o.qty;
        }
        out.push(o);
      }
      let clean = out.filter(
        (t) => t.date && t.ticker && t.qty && (t.price || t.total),
      );
      let _rounded = 0,
        _dropped = 0;
      clean = clean.filter((t) => {
        if (!t.opcvm && Math.abs(t.qty - Math.round(t.qty)) > 1e-9) {
          const wq = Math.floor(t.qty);
          if (wq < 1) {
            _dropped++;
            return false;
          }
          t.qty = wq;
          _rounded++;
        }
        return true;
      });
      const mode =
        (document.getElementById("csvMode") || {}).value || "replace";
      if (mode === "append") {
        TXNS = TXNS.concat(clean);
      } else {
        if (
          !(await appConfirm(
            "Replace ALL current transactions with the " +
              clean.length +
              " imported row(s)?",
          ))
        ) {
          return;
        }
        TXNS = clean;
      }
      saveTxns(TXNS);
      document.getElementById("csvResult").innerHTML =
        `\u2705 ${mode === "append" ? "Appended" : "Imported"} <b>${clean.length}</b> transaction(s). Ledger now has ${TXNS.length}.` +
        (_rounded
          ? ` <span class="mini" style="color:var(--warn)">\u00B7 ${_rounded} stock row(s) rounded to whole shares</span>`
          : "") +
        (_dropped
          ? ` <span class="mini" style="color:var(--neg)">\u00B7 ${_dropped} dropped (fractional <1 share)</span>`
          : "");
      render();
    } catch (err) {
      document.getElementById("csvResult").textContent =
        "\u274C Parse error: " + err.message;
    }
  };
  rd.readAsText(f);
  e.target.value = "";
};

// ---------- fees explainer values + dividend-tax-by-year editor ----------
function renderDivTax() {
  const el = (id) => document.getElementById(id);
  const yrs = Object.keys(DIVTAX)
    .map(Number)
    .sort((a, b) => a - b);
  document.querySelector("#divTaxTable tbody").innerHTML =
    yrs
      .map(
        (y) => `<tr>
    <td class="l">${y}</td><td>${(DIVTAX[y] * 100).toFixed(2)}%</td>
    <td class="center"><button class="chip" style="cursor:pointer;border:none" data-act="delYear" data-args="${y}" aria-label="Delete year" title="Delete year">\u2715</button></td></tr>`,
      )
      .join("") +
    `<tr style="border-top:1px solid var(--border)"><td class="l" style="color:var(--muted)"><i>2028+ \u2192</i></td><td style="color:var(--muted)">${yrs.length ? (DIVTAX[yrs[yrs.length - 1]] * 100).toFixed(2) + "%" : "\u2014"}</td><td></td></tr>`;
}
window.delYear = function (y) {
  delete DIVTAX[String(y)];
  saveDivTax();
  renderDivTax();
  render();
};
document.getElementById("addYear").onclick = () => {
  const y = parseInt(document.getElementById("ntYear").value, 10);
  const r = parseFloat(document.getElementById("ntRate").value);
  if (!y || isNaN(r)) {
    toast("Enter a year and a rate %.", "warn");
    return;
  }
  DIVTAX[String(y)] = r / 100;
  saveDivTax();
  document.getElementById("ntYear").value = "";
  document.getElementById("ntRate").value = "";
  renderDivTax();
  render();
};

// ---------- transaction edit / update ----------
let EDIT_IX = null;
window.editTxn = function (i) {
  const t = TXNS[i];
  if (!t) return;
  EDIT_IX = i;
  window._loadingEditForm = true; // keep stored price/total, don't auto-overwrite
  document.getElementById("tDate").value = t.date;
  document.getElementById("tTicker").value = t.ticker;
  document.getElementById("tAction").value = t.action;
  document.getElementById("tQty").value = t.qty;
  document.getElementById("tPrice").value = t.price;
  document.getElementById("tTotal").value =
    typeof t.total === "number" && t.total > 0 ? t.total : "";
  {
    const _tt = document.getElementById("tTotal");
    if (_tt) _tt.dataset.auto = "";
  }
  {
    const _nf = document.getElementById("tFundName");
    if (_nf) _nf.value = (M[t.ticker] && M[t.ticker].name) || "";
  }
  document.getElementById("tPea").checked = !!t.pea;
  document.getElementById("tOpcvm").checked =
    t.opcvm === true || !!(M[t.ticker] && M[t.ticker].cat === "OPCVM");
  document.getElementById("tOpcvm").dispatchEvent(new Event("change"));
  window._loadingEditForm = false;
  document.getElementById("addTxn").textContent = "Update";
  document.getElementById("cancelEdit").style.display = "";
  document.getElementById("editHint").textContent =
    "Editing transaction \u2014 change fields and press Update.";
  setKindBadge(document.getElementById("tKind"), t.ticker);
  liveCalc();
  document.querySelector('.tab[data-view="transactions"]').click();
  window.scrollTo(0, 0);
};
document.getElementById("cancelEdit").onclick = () => {
  EDIT_IX = null;
  document.getElementById("addTxn").textContent = "Add";
  document.getElementById("cancelEdit").style.display = "none";
  document.getElementById("editHint").textContent = "";
  document.getElementById("tQty").value = "";
  document.getElementById("tPrice").value = "";
  document.getElementById("tTotal").value = "";
  document.getElementById("txnCalc").textContent = "";
};

// ---------- light / dark mode toggle ----------
// NOTE: these MUST mirror the current "THEME REFRESH" :root palette
// (the purple flat-modern pass), because applyTheme() sets these tokens
// inline on <html> and would otherwise override the CSS defaults.
const THEMES = {
  dark: {
    "--bg": "#0a0b0f",
    "--bg2": "#0f1116",
    "--panel": "#14161c",
    "--panel2": "#1b1e26",
    "--border": "#262a33",
    "--border-l": "#1d2029",
    "--text": "#eceef2",
    "--text2": "#9ca3af",
    "--muted": "#656b76",
    // subtle dark-purple accent (matches the refreshed :root)
    "--primary": "#7c5cdd",
    "--primary2": "#9a7ef0",
    "--success": "#2dd4a7",
    "--error": "#f26d6d",
    "--warn": "#f5b544",
    "--info": "#8b9cf5",
  },
  light: {
    "--bg": "#f6f6fb",
    "--bg2": "#ffffff",
    "--panel": "#ffffff",
    "--panel2": "#f1f0f8",
    "--border": "#e4e2ee",
    "--border-l": "#eeecf5",
    "--text": "#1a1725",
    "--text2": "#5a5570",
    "--muted": "#8b869c",
    // same purple identity, deepened for contrast on white panels
    "--primary": "#6d4fd0",
    "--primary2": "#7c5cdd",
    "--success": "#0f9d76",
    "--error": "#e0484d",
    "--warn": "#c77f00",
    "--info": "#5b6fd8",
  },
};
function applyTheme(name) {
  const t = THEMES[name] || THEMES.dark;
  for (const k in t) document.documentElement.style.setProperty(k, t[k]);
  // Refresh the cached theme tokens so charts/renders pick up the new palette.
  if (typeof refreshThemeCache === "function") refreshThemeCache();
  try {
    localStorage.setItem("casa_theme_v1", name);
  } catch (e) {}
  const btn = document.getElementById("themeToggle");
  if (btn)
    btn.textContent =
      name === "light" ? "\uD83C\uDF19 Dark" : "\u2600\uFE0F Light";
  // Re-render so charts recolor to the new theme. (Previously gated on the
  // now-removed allocation pie's CH_alloc, which left charts stale on toggle.)
  setTimeout(() => {
    try {
      if (typeof render === "function") render();
    } catch (e) {}
  }, 10);
}
document.getElementById("themeToggle").onclick = () => {
  const cur = (() => {
    try {
      return localStorage.getItem("casa_theme_v1") || "dark";
    } catch (e) {
      return "dark";
    }
  })();
  applyTheme(cur === "dark" ? "light" : "dark");
};
(function () {
  try {
    const s = localStorage.getItem("casa_theme_v1");
    if (s) applyTheme(s);
  } catch (e) {}
})();

// ---------- dividend calendar import (replicates Excel date-fix formula) ----------
let DIVCAL = (() => {
  const s = localStorage.getItem("casa_divcal_v1");
  const seed = () => SEED.dividend_calendar.map((d) => ({ ...d }));
  if (s == null) return seed();
  const parsed = safeParseLS("casa_divcal_v1", s, null, "Dividend calendar");
  return Array.isArray(parsed.value) ? parsed.value : seed();
})();
function saveDivCal() {
  if (safeSetItem("casa_divcal_v1", JSON.stringify(DIVCAL))) markSaved();
}
function fixDate(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0"),
      mm = m[2].padStart(2, "0"),
      yyyy = m[3];
    return yyyy + "-" + mm + "-" + dd;
  }
  const dt = new Date(s);
  if (!isNaN(dt)) return dt.toISOString().slice(0, 10);
  return null;
}
function issuerNorm(s) {
  // Uppercase, strip accents, unify apostrophes/dashes, collapse whitespace, drop trailing legal suffixes.
  let x = String(s || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[\u2019\u2018\u02bc`']/g, " ") // apostrophes -> space
    .replace(/[\u2010-\u2015\-]/g, " ") // dashes -> space
    .replace(/[.,]/g, " ")
    .replace(/\b(S\s*A\s*R\s*L|S\s*A\s*S|S\s*A|SCA|SPA)\b/g, " ") // legal suffixes
    .replace(/\s+/g, " ")
    .trim();
  return x;
}
// Common acronym / short-name aliases that aren't the full registered issuer name.
// User-saved issuer aliases (resolved via the import quick-map). Normalized key -> ticker.
let USER_ALIASES = (() => {
  try {
    const s = localStorage.getItem("casa_issuer_aliases_v1");
    if (s) return JSON.parse(s);
  } catch (e) {}
  return {};
})();
function saveUserAliases() {
  if (
    safeSetItem("casa_issuer_aliases_v1", JSON.stringify(USER_ALIASES)) &&
    typeof markSaved === "function"
  )
    markSaved();
}
const ISSUER_ALIASES = {
  BMCI: "BCI",
  CIH: "CIH",
  "CIH BANK": "CIH",
  BCP: "BCP",
  BOA: "BOA",
  "BANK OF AFRICA BMCE GROUP": "BOA",
  ATTIJARIWAFA: "ATW",
  "MARSA MAROC": "MSA",
  "TOTALENERGIES MAROC": "TMA",
  "EAUX MINERALES D OULMES": "OUL",
  OULMES: "OUL",
  SBM: "SBM",
  "LAFARGEHOLCIM MAROC": "LHM",
  "HOLCIM MAROC": "LHM",
  "LAFARGE HOLCIM MAROC": "LHM",
};
function issuerToTicker(name) {
  if (!name) return null;
  const rawK = name.trim().toUpperCase();
  if (ISSUER_TO_TICKER[rawK]) return ISSUER_TO_TICKER[rawK];
  const nk = issuerNorm(name);
  // user-saved aliases take priority (resolved via the import quick-map)
  if (USER_ALIASES[nk] && M[USER_ALIASES[nk]]) return USER_ALIASES[nk];
  // 0) direct master ticker (issuer text IS a ticker, e.g. "CIH")
  if (M[rawK]) return rawK;
  const firstTok = nk.split(" ")[0];
  if (firstTok && M[firstTok]) return firstTok;
  // 1) alias table (normalized)
  if (ISSUER_ALIASES[nk]) return ISSUER_ALIASES[nk];
  for (const a in ISSUER_ALIASES) {
    if (nk === a || nk.startsWith(a + " ") || a.startsWith(nk + " "))
      return ISSUER_ALIASES[a];
  }
  // 2) normalized match against the issuer map
  for (const key in ISSUER_TO_TICKER) {
    const nkey = issuerNorm(key);
    if (nkey === nk || nkey.startsWith(nk) || nk.startsWith(nkey))
      return ISSUER_TO_TICKER[key];
  }
  // 3) normalized match against master company names
  for (const tk in M) {
    const nm = issuerNorm(M[tk].name || "");
    if (nm && (nm === nk || nm.startsWith(nk) || nk.startsWith(nm))) return tk;
  }
  // 4) last resort: exact-key loose match (legacy behavior)
  for (const key in ISSUER_TO_TICKER) {
    if (key.startsWith(rawK) || rawK.startsWith(key))
      return ISSUER_TO_TICKER[key];
  }
  return null;
}
function parseCalendar(raw) {
  // Detect format. If most non-empty lines contain a TAB -> tab-separated. Else -> block/newline format.
  const rawLines = raw.split(/\r?\n/);
  const nonEmpty = rawLines.filter((l) => l.trim());
  const out = [];
  let bad = 0,
    unmatched = [];
  const AMT = /^-?[\d.,\s]+$/,
    DATE = /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/;
  // --- Role-based (column-order-independent) row detector ---------------------
  // Handles the "Issuer  Ex-date  Payment date  Type  Amount MAD" feed (amount LAST,
  // with a MAD suffix) as well as any single-line layout, tab- OR space-separated.
  // A line qualifies when it carries: 2 dates, a dividend-type keyword, and a
  // <number> MAD amount. Issuer = text before the first date.
  const DATE_G = /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/g;
  const TYPE_RE =
    /\b(ordinary|exceptional|special|interim|ordinaire|exceptionnel|exceptionnelle|special dividend)\b/i;
  const AMT_MAD = /(-?[\d.\s\u00a0\u202f]*,?\d+(?:[.,]\d+)?)\s*MAD\b/i;
  function parseRoleLine(line) {
    const dates = line.match(DATE_G);
    if (!dates || dates.length < 2) return null;
    const tm = line.match(TYPE_RE);
    const am = line.match(AMT_MAD);
    if (!am) return null;
    const ex = dates[0],
      pay = dates[1];
    const amount = cleanNum(am[1]);
    if (amount == null) return null;
    // issuer = everything before the first date
    const firstDateIdx = line.indexOf(dates[0]);
    let issuer = line.slice(0, firstDateIdx).replace(/[\t]+/g, " ").trim();
    // strip a possible leading ticker column that duplicates issuer (rare); keep as-is otherwise
    const typ = tm ? tm[1] : "Ordinary";
    return { issuer, amount, ex, pay, typ };
  }
  const CAL_HEADER =
    /\b(issuer|ex[-\s]?date|payment\s*date|dividend\s*type|amount)\b/i;
  const isHeaderLine = (l) =>
    !DATE.test(l) && !AMT_MAD.test(l) && CAL_HEADER.test(l);
  const roleHits = nonEmpty.map(parseRoleLine);
  const roleCount = roleHits.filter(Boolean).length;
  const roleDenom = nonEmpty.filter((l) => !isHeaderLine(l)).length || 1;
  if (roleCount > 0 && roleCount >= roleDenom * 0.5) {
    for (let idx = 0; idx < nonEmpty.length; idx++) {
      if (isHeaderLine(nonEmpty[idx])) continue;
      const r = roleHits[idx];
      if (!r) {
        bad++;
        continue;
      }
      const ticker = issuerToTicker(r.issuer);
      const payd = fixDate(r.pay),
        exd = fixDate(r.ex);
      if (!ticker) {
        unmatched.push(r.issuer);
        bad++;
        continue;
      }
      if (!payd) {
        bad++;
        continue;
      }
      out.push({
        ticker,
        issuer: r.issuer,
        amount: r.amount,
        ex_date: exd,
        pay_date: payd,
        div_type: r.typ || "Ordinary",
      });
    }
    return { out, bad, unmatched };
  }
  const tabbed =
    nonEmpty.filter((l) => l.indexOf("\t") >= 0).length > nonEmpty.length / 2;
  if (tabbed) {
    for (const line of nonEmpty) {
      const c = line.split("\t").map((x) => x.trim());
      if (c.length < 5) {
        bad++;
        continue;
      }
      // support both "Ticker,Issuer,Amount,Ex,Pay,Type" and "Issuer,Amount,Ex,Pay,Type"
      let ticker, issuer, amount, ex, pay, typ;
      if (c.length >= 6 && !AMT.test(c[1])) {
        [ticker, issuer, amount, ex, pay, typ] = [
          c[0].toUpperCase(),
          c[1],
          cleanNum(c[2]),
          c[3],
          c[4],
          c[5],
        ];
      } else {
        issuer = c[0];
        amount = cleanNum(c[1]);
        ex = c[2];
        pay = c[3];
        typ = c[4];
        ticker = issuerToTicker(issuer);
      }
      const payd = fixDate(pay),
        exd = fixDate(ex);
      if (!ticker) {
        unmatched.push(issuer);
        bad++;
        continue;
      }
      if (!payd) {
        bad++;
        continue;
      }
      out.push({
        ticker,
        issuer,
        amount,
        ex_date: exd,
        pay_date: payd,
        div_type: typ || "Ordinary",
      });
    }
  } else {
    // Block format: fields on separate lines, records separated by blank line(s).
    // Skip an optional header block (Issuer/Amount/Ex-date/Payment date/Dividend type labels).
    const HEADERS = new Set([
      "issuer",
      "amount",
      "ex-date",
      "payment date",
      "dividend type",
      "ex date",
      "paymentdate",
    ]);
    const toks = nonEmpty.filter((l) => !HEADERS.has(l.trim().toLowerCase()));
    // Consume in groups of 5: Issuer, Amount, Ex-date, Payment date, Type
    for (let i = 0; i + 4 < toks.length || i < toks.length; ) {
      // find an issuer start: a non-numeric, non-date line
      const issuer = toks[i];
      if (issuer === undefined) break;
      const amount = cleanNum(toks[i + 1]);
      const ex = toks[i + 2],
        pay = toks[i + 3],
        typ = toks[i + 4];
      // validate shape
      if (amount == null || !DATE.test(ex || "") || !DATE.test(pay || "")) {
        i++;
        bad++;
        continue;
      }
      const ticker = issuerToTicker(issuer);
      const payd = fixDate(pay),
        exd = fixDate(ex);
      if (ticker && payd) {
        out.push({
          ticker,
          issuer,
          amount,
          ex_date: exd,
          pay_date: payd,
          div_type: typ || "Ordinary",
        });
      } else {
        if (!ticker) unmatched.push(issuer);
        bad++;
      }
      i += 5;
    }
  }
  return { out, bad, unmatched };
}
// Collapse exact-duplicate dividend events (same ticker + pay-date + amount) within a batch.
function dedupeDivcal(list) {
  const seen = new Set(),
    out = [];
  for (const d of list) {
    const k = d.ticker + "|" + d.pay_date + "|" + +(+d.amount).toFixed(4);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  return out;
}
function calImport() {
  const raw = document.getElementById("calPaste").value.trim();
  if (!raw) {
    document.getElementById("calResult").textContent =
      "Paste calendar rows first.";
    return;
  }
  const mode = document.getElementById("calMode").value;
  const { out: out2, bad, unmatched } = parseCalendar(raw);
  const uniqUnmatched = [...new Set(unmatched)];
  if (!out2.length && !uniqUnmatched.length) {
    document.getElementById("calResult").innerHTML =
      "\u274c Could not parse any rows.";
    return;
  }
  let added = 0,
    dups = 0;
  if (out2.length) {
    if (mode === "replace") {
      DIVCAL = dedupeDivcal(out2);
      added = DIVCAL.length;
    } else {
      const key = (d) =>
        d.ticker + "|" + d.pay_date + "|" + +(+d.amount).toFixed(4);
      const have = new Set(DIVCAL.map(key));
      for (const d of dedupeDivcal(out2)) {
        if (have.has(key(d))) {
          dups++;
          continue;
        }
        DIVCAL.push(d);
        have.add(key(d));
        added++;
      }
    }
    saveDivCal();
  }
  let msg = added
    ? "\u2705 Imported <b>" +
      added +
      "</b> dividend(s)." +
      (dups
        ? ' <span style="color:var(--muted)">(' +
          dups +
          " duplicate(s) skipped)</span>"
        : "")
    : out2.length
      ? "\u2139 Nothing new \u2014 all " +
        out2.length +
        " row(s) already present."
      : "\u26a0 No rows imported yet.";
  if (uniqUnmatched.length) {
    msg +=
      ' <span style="color:var(--warn)">' +
      uniqUnmatched.length +
      " issuer(s) not matched \u2014 pick a ticker below.</span>";
    msg += calResolverHTML(uniqUnmatched);
  }
  document.getElementById("calResult").innerHTML = msg;
  if (uniqUnmatched.length) wireCalResolver();
  render();
}
// Best-guess ticker for an unmatched issuer: token-overlap against master names + ISSUER_TO_TICKER keys.
// Returns {ticker, score} or {ticker:null, score:0}. Threshold 0.34 keeps weak guesses out.
const _ISS_STOP = new Set([
  "DE",
  "DU",
  "DES",
  "LA",
  "LE",
  "LES",
  "SA",
  "SARL",
  "SAS",
  "SCA",
  "GROUP",
  "GROUPE",
  "HOLDING",
  "COMPAGNIE",
  "SOCIETE",
  "STE",
  "MAROC",
  "MAROCAINE",
  "ET",
  "AL",
  "CO",
  "INC",
]);
function issuerTokens(s) {
  return issuerNorm(s)
    .split(" ")
    .filter((w) => w && !_ISS_STOP.has(w));
}
function issuerNameScore(a, b) {
  const A = issuerTokens(a),
    B = issuerTokens(b);
  if (!A.length || !B.length) return 0;
  const sa = new Set(A),
    sb = new Set(B);
  let inter = 0;
  sa.forEach((w) => {
    if (sb.has(w)) inter++;
  });
  return inter / new Set([...sa, ...sb]).size;
}
function guessTicker(issuer) {
  let best = null,
    bestS = 0;
  for (const tk in M) {
    const sc = issuerNameScore(issuer, M[tk].name || "");
    if (sc > bestS) {
      bestS = sc;
      best = tk;
    }
  }
  for (const key in ISSUER_TO_TICKER) {
    const sc = issuerNameScore(issuer, key);
    if (sc > bestS) {
      bestS = sc;
      best = ISSUER_TO_TICKER[key];
    }
  }
  return bestS >= 0.34 && best
    ? { ticker: best, score: bestS }
    : { ticker: null, score: bestS };
}
// Build the quick-map resolver: each unmatched issuer + a ticker <select>.
function calResolverHTML(list) {
  let h =
    '<div id="calResolver" style="margin-top:10px;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--panel2)">';
  h +=
    '<div class="mini" style="margin-bottom:8px;color:var(--text2)">Map each unmatched issuer to a ticker, then re-import. Your choices are remembered for next time.</div>';
  for (const iss of list) {
    const esc = String(iss).replace(/</g, "&lt;").replace(/"/g, "&quot;");
    const guess = guessTicker(iss);
    // build options: blank first, then all tickers; pre-select best guess if confident
    let opts = '<option value="">\u2014 pick \u2014</option>';
    opts += Object.keys(M)
      .sort()
      .map((tk) => {
        const nm = (M[tk].name || "").replace(/</g, "&lt;");
        const sel = guess.ticker === tk ? " selected" : "";
        return (
          '<option value="' +
          tk +
          '"' +
          sel +
          ">" +
          tk +
          (nm ? " \u00b7 " + nm : "") +
          "</option>"
        );
      })
      .join("");
    const guessHint = guess.ticker
      ? '<span class="mini" style="color:var(--info);margin-left:4px" title="Best guess based on name similarity (' +
        Math.round(guess.score * 100) +
        '% match) \u2014 confirm or change">\u2754 guess</span>'
      : "";
    h +=
      '<div style="display:flex;gap:8px;align-items:center;margin:5px 0">' +
      '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' +
      esc +
      '">' +
      esc +
      "</span>" +
      '<select class="cal-resolve" data-issuer="' +
      esc +
      '" style="max-width:260px">' +
      opts +
      "</select>" +
      guessHint +
      "</div>";
  }
  h +=
    '<button class="btn" id="calResolveSave" style="margin-top:8px">Save &amp; re-import</button>';
  h += "</div>";
  return h;
}
function wireCalResolver() {
  const btn = document.getElementById("calResolveSave");
  if (!btn) return;
  btn.onclick = () => {
    let n = 0;
    document.querySelectorAll("#calResolver .cal-resolve").forEach((sel) => {
      const tk = sel.value;
      if (!tk) return;
      const iss = sel.getAttribute("data-issuer");
      const key = issuerNorm(iss);
      if (key) {
        USER_ALIASES[key] = tk;
        n++;
      }
    });
    if (!n) {
      document
        .getElementById("calResult")
        .insertAdjacentHTML(
          "beforeend",
          '<div class="mini" style="color:var(--warn);margin-top:6px">Pick at least one ticker first.</div>',
        );
      return;
    }
    saveUserAliases();
    calImport(); // re-run with the new aliases in effect
  };
}
document.getElementById("applyCal").onclick = calImport;
document.getElementById("clearCal").onclick = () => {
  document.getElementById("calPaste").value = "";
  document.getElementById("calResult").textContent = "";
};

document.getElementById("addAllMissing").onclick = async () => {
  const miss = DIVCAL.filter(
    (d) => d.pay_date && divStatus(d).t === "\u26a0 Not recorded",
  );
  if (!miss.length) {
    document.getElementById("calResult").textContent =
      "No missing dividends to add.";
    return;
  }
  if (
    !(await appConfirm(
      "Add " +
        miss.length +
        " missing dividend(s)? They will be tagged auto for review.",
    ))
  )
    return;
  let added = 0;
  for (const d of miss) {
    const exd = d.ex_date || d.pay_date;
    const amt = +(+d.amount).toFixed(4);
    for (const pea of [false, true]) {
      const sh = heldBefore(d.ticker, pea, exd);
      if (sh <= 1e-9) continue;
      const dup = TXNS.some(
        (t) =>
          t.action === "DIV" &&
          t.ticker === d.ticker &&
          !!t.pea === pea &&
          +(+t.price).toFixed(4) === amt &&
          daysBetween(t.date, d.pay_date) <= DIV_MATCH_WINDOW_DAYS,
      );
      if (dup) continue;
      TXNS.push({
        date: d.pay_date,
        ticker: d.ticker,
        action: "DIV",
        qty: +sh.toFixed(4),
        price: d.amount,
        pea: pea,
        broker: pea ? "attijari" : "saham",
        auto: true,
        exDate: exd,
        eligBasis: sh,
      });
      added++;
    }
  }
  if (added) {
    saveTxns(TXNS);
    document.getElementById("calResult").innerHTML =
      "\u2705 Added <b>" +
      added +
      "</b> missing dividend(s) \u2014 tagged for review.";
    render();
  } else
    document.getElementById("calResult").textContent =
      "Nothing added (all already recorded).";
};

// ---------- downloadable templates ----------
function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" }),
    url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
document.getElementById("dlTxnTemplate").onclick = () => {
  const t = [
    "date,ticker,action,qty,price,pea,opcvm,total",
    "2026-01-15,ATW,BUY,10,680,no,no,",
    "2026-03-20,ATW,SELL,5,720,no,no,",
    "2026-06-22,ATW,DIV,10,22,no,no,",
    "2026-02-04,FCP A,BUY,8.435,831.8,no,yes,7025",
    "2026-02-04,FCP B,BUY,2.34,,no,yes,2990.35",
    "# date=YYYY-MM-DD \u00B7 action=BUY/SELL/DIV \u00B7 pea=yes/no \u00B7 opcvm=yes/no (fund? auto-detected for known funds) \u00B7 total=OPCVM total TTC (optional, blank for stocks) \u00B7 qty=shares (or share count for DIV)  price=unit price MAD (or dividend/share for DIV)",
    "# OPCVM funds: you can leave price BLANK and give total only \u2014 unit price is derived as total/qty on import (see FCP B row above).",
  ].join("\n");
  downloadText("transactions_template.csv", t);
};
document.getElementById("dlCalTemplate").onclick = () => {
  const t = [
    "Ticker\tIssuer\tAmount\tEx-date\tPayment date\tType",
    "ATW\tAttijariwafa Bank\t22,00\t18/06/2026\t08/07/2026\tOrdinary",
    "IAM\tMaroc Telecom\t4,00\t04/09/2026\t15/09/2026\tOrdinary",
    "AFI\tAfric Industries\t20,00\t19/06/2026\t30/06/2026\tOrdinary",
  ].join("\n");
  downloadText("dividend_calendar_template.csv", t);
};

// prices updated stamp
(function () {
  const el = document.getElementById("pricesStamp");
  if (el && SEED.prices_updated)
    el.textContent = "Prices as of " + SEED.prices_updated;
})();

// ---------- editable fee panel ----------
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550 BROKER FEE UI \u2550\u2550\u2550\u2550\u2550\u2550\u2550
let CUR_BROKER = "saham"; // currently selected broker tab
function parsePct(str) {
  if (str == null) return null;
  let s = String(str).replace(",", ".").replace("%", "").trim();
  if (s === "") return null;
  let v = parseFloat(s);
  if (isNaN(v)) return null;
  return v / 100;
}
function fmtPct(dec) {
  return dec == null ? "" : +(dec * 100).toFixed(4) + "%";
}

function renderBrokerTabs() {
  const el = document.getElementById("brokerTabs");
  if (!el) return;
  el.innerHTML = Object.keys(BROKERS)
    .map((id) => {
      const b = BROKERS[id];
      const active = id === CUR_BROKER;
      return `<button class="btn ${active ? "" : "sec2"} bkTab" data-bk="${id}" style="font-size:12px;padding:5px 14px;border-radius:14px">${b.name}</button>`;
    })
    .join("");
  el.querySelectorAll(".bkTab").forEach((btn) => {
    btn.onclick = () => {
      CUR_BROKER = btn.dataset.bk;
      renderBrokerTabs();
      renderBrokerFeeForm();
    };
  });
}

function renderBrokerFeeForm() {
  const el = document.getElementById("brokerFeePanel");
  if (!el) return;
  const bk = BROKERS[CUR_BROKER];
  if (!bk) return;
  const f = bk.fees;
  let h =
    '<div class="fee-sub">' +
    bk.name +
    ' <span class="mini">\u2014 trading fees</span></div>';
  h += '<div class="fee-fields" style="margin-top:8px">';
  h +=
    '<label>Broker name <input type="text" id="bk_name" value="' +
    bk.name +
    '"></label>';
  h +=
    '<label>Fee formula <select id="bk_feeType"><option value="regular"' +
    (bk.feeType === "regular" ? " selected" : "") +
    '>Rate-based (c.march\u00E9 + c.interm + c.r\u00E8gl + courier)</option><option value="pea"' +
    (bk.feeType === "pea" ? " selected" : "") +
    ">Courtage-based (courtage + r\u00E8gl + bourse)</option></select></label>";

  if (bk.feeType === "regular") {
    h +=
      '<label>Commission de march\u00E9 (%) <input type="text" id="bk_c_marche" value="' +
      fmtPct(f.c_marche) +
      '"></label>';
    h +=
      '<label>Commission d\'interm\u00E9diation (%) <input type="text" id="bk_c_interm" value="' +
      fmtPct(f.c_interm) +
      '"></label>';
    h +=
      '<label>Commission r\u00E8glement/livraison (%) <input type="text" id="bk_c_regl" value="' +
      fmtPct(f.c_regl) +
      '"></label>';
    h +=
      '<label>VAT on fees (%) <input type="text" id="bk_vat" value="' +
      fmtPct(f.vat) +
      '"></label>';
    h +=
      '<label>Frais de courrier (fixed, MAD) <input type="text" id="bk_courier" value="' +
      (f.courier || 0) +
      '"></label>';
    h +=
      '<label>OPCVM order fee (MAD HT) <input type="text" id="bk_opcvmOrder" value="' +
      (f.opcvmOrder || 0) +
      '"></label>';
    h +=
      '<label>Dividend commission (% HT) <input type="text" id="bk_divComm" value="' +
      fmtPct(f.divComm) +
      '"></label>';
    // Effective rate display
    const eff =
      ((f.c_marche || 0) + (f.c_interm || 0) + (f.c_regl || 0)) *
      (1 + (f.vat || 0.1));
    const fix = (f.courier || 0) * (1 + (f.vat || 0.1));
    h +=
      '</div><div style="margin-top:10px;padding:8px 10px;background:var(--panel2);border-radius:8px;font-size:13px"><b>Effective stock fee:</b> ' +
      (eff * 100).toFixed(3) +
      "% + " +
      fix.toFixed(2) +
      " MAD fixed" +
      (f.opcvmOrder
        ? " \u00b7 OPCVM: " +
          ((f.opcvmOrder || 0) * (1 + (f.vat || 0.1))).toFixed(2) +
          " MAD"
        : "") +
      "</div>";
  } else {
    h +=
      '<label>Commission de courtage (%) <input type="text" id="bk_courtage" value="' +
      fmtPct(f.courtage) +
      '"></label>';
    h +=
      '<label>Courtage minimum (MAD) <input type="text" id="bk_courtageMin" value="' +
      (f.courtageMin || 0) +
      '"></label>';
    h +=
      '<label>Commission r\u00E8glement/livr. (%) <input type="text" id="bk_regl" value="' +
      fmtPct(f.regl) +
      '"></label>';
    h +=
      '<label>Commission Bourse de Casa (%) <input type="text" id="bk_bourse" value="' +
      fmtPct(f.bourse) +
      '"></label>';
    h +=
      '<label>TVA on fees (%) <input type="text" id="bk_vat" value="' +
      fmtPct(f.vat) +
      '"></label>';
    h +=
      '<label>OPCVM order fee (MAD HT) <input type="text" id="bk_opcvmOrder" value="' +
      (f.opcvmOrder || 0) +
      '"></label>';
    h +=
      '<label>Dividend commission (% HT) <input type="text" id="bk_divComm" value="' +
      fmtPct(f.divComm) +
      '"></label>';
    // Effective rate
    const eff =
      ((f.courtage || 0) + (f.regl || 0) + (f.bourse || 0)) *
      (1 + (f.vat || 0.1));
    const minFee = (f.courtageMin || 0) * (1 + (f.vat || 0.1));
    h +=
      '</div><div style="margin-top:10px;padding:8px 10px;background:var(--panel2);border-radius:8px;font-size:13px"><b>Effective:</b> ' +
      (eff * 100).toFixed(3) +
      "% (min " +
      minFee.toFixed(2) +
      " MAD) \u00B7 OPCVM " +
      ((f.opcvmOrder || 0) * (1 + (f.vat || 0.1))).toFixed(2) +
      " MAD</div>";
  }
  el.innerHTML = h;
  // Re-render form when fee type changes
  const ftSel = document.getElementById("bk_feeType");
  if (ftSel)
    ftSel.onchange = () => {
      BROKERS[CUR_BROKER].feeType = ftSel.value;
      // Reset fees to defaults for that type
      if (ftSel.value === "regular")
        BROKERS[CUR_BROKER].fees = { ...BROKER_DEFAULTS.saham.fees };
      else BROKERS[CUR_BROKER].fees = { ...BROKER_DEFAULTS.attijari.fees };
      saveBrokers();
      renderBrokerFeeForm();
    };
}

// Save current broker's fees from the form
document.getElementById("saveBrokerFeesBtn").onclick = () => {
  const bk = BROKERS[CUR_BROKER];
  if (!bk) return;
  const nameEl = document.getElementById("bk_name");
  if (nameEl) bk.name = nameEl.value.trim() || CUR_BROKER;
  const p = (id) => parsePct(document.getElementById(id)?.value);
  const num = (id) =>
    parseFloat(
      String(document.getElementById(id)?.value || "0").replace(",", "."),
    );
  if (bk.feeType === "regular") {
    bk.fees = {
      c_marche: p("bk_c_marche"),
      c_interm: p("bk_c_interm"),
      c_regl: p("bk_c_regl"),
      vat: p("bk_vat"),
      courier: num("bk_courier"),
      opcvmOrder: num("bk_opcvmOrder"),
      divComm: p("bk_divComm"),
    };
  } else {
    bk.fees = {
      courtage: p("bk_courtage"),
      courtageMin: num("bk_courtageMin"),
      regl: p("bk_regl"),
      bourse: p("bk_bourse"),
      vat: p("bk_vat"),
      opcvmOrder: num("bk_opcvmOrder"),
      divComm: p("bk_divComm"),
    };
  }
  for (const k in bk.fees) {
    if (bk.fees[k] == null || isNaN(bk.fees[k])) {
      toast("All fee fields must be valid numbers.", "warn");
      return;
    }
  }
  // Also sync to legacy FP/FP_PEA for backward compat
  if (CUR_BROKER === "saham") {
    FP = { ...bk.fees, tpcvm: FP.tpcvm };
    saveFees();
  }
  if (CUR_BROKER === "attijari") {
    FP_PEA = { ...bk.fees };
    saveFeesPea();
  }
  saveBrokers();
  document.getElementById("brokerFeeSaved").textContent = "\u2705 Saved.";
  renderBrokerFeeForm();
  render();
};

document.getElementById("resetBrokerFeesBtn").onclick = () => {
  const def = BROKER_DEFAULTS[CUR_BROKER];
  if (def) {
    BROKERS[CUR_BROKER] = { ...def, fees: { ...def.fees } };
  }
  saveBrokers();
  if (CUR_BROKER === "saham") {
    FP = { ...BROKER_DEFAULTS.saham.fees, tpcvm: FP_DEFAULT.tpcvm };
    saveFees();
  }
  if (CUR_BROKER === "attijari") {
    FP_PEA = { ...BROKER_DEFAULTS.attijari.fees };
    saveFeesPea();
  }
  renderBrokerFeeForm();
  document.getElementById("brokerFeeSaved").textContent = "Reset to defaults.";
  render();
};

// Add broker
document.getElementById("addBrokerBtn").onclick = () => {
  const name = prompt("New broker name:");
  if (!name) return;
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, "_");
  if (BROKERS[id]) {
    toast('Broker "' + name + '" already exists.', "warn");
    return;
  }
  BROKERS[id] = {
    name: name,
    feeType: "regular",
    fees: { ...BROKER_DEFAULTS.saham.fees },
  };
  saveBrokers();
  CUR_BROKER = id;
  renderBrokerTabs();
  renderBrokerFeeForm();
};

// TPCVM save
document.getElementById("saveTpcvmBtn").onclick = () => {
  const v = parsePct(document.getElementById("fe_tpcvm").value);
  if (v == null || isNaN(v)) {
    toast("TPCVM must be a valid number.", "warn");
    return;
  }
  FP.tpcvm = v;
  saveFees();
  toast("TPCVM saved.", "ok");
  render();
};

// Init fee UI
function loadFeeInputs() {
  const el = document.getElementById("fe_tpcvm");
  if (el) el.value = fmtPct(FP.tpcvm);
  renderBrokerTabs();
  renderBrokerFeeForm();
}
loadFeeInputs();

// ---------- Positions: editable price + hide closed ----------
function rerenderPositions() {
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
  renderCharts(arr, t);
  renderKPIs(t);
}

window.addMissingDiv = function (ticker, payDate, amount, exDate) {
  let added = 0;
  for (const pea of [false, true]) {
    const sh = heldBefore(ticker, pea, exDate);
    if (sh <= 1e-9) continue;
    // dedupe: same ticker+amount+account within window
    const amt = +(+amount).toFixed(4);
    const dup = TXNS.some(
      (t) =>
        t.action === "DIV" &&
        t.ticker === ticker &&
        !!t.pea === pea &&
        +(+t.price).toFixed(4) === amt &&
        daysBetween(t.date, payDate) <= DIV_MATCH_WINDOW_DAYS,
    );
    if (dup) continue;
    TXNS.push({
      date: payDate,
      ticker: ticker,
      action: "DIV",
      qty: +sh.toFixed(4),
      price: amount,
      pea: pea,
      broker: pea ? "attijari" : "saham",
      auto: true,
      exDate: exDate,
      eligBasis: sh,
    });
    added++;
  }
  if (added) {
    saveTxns(TXNS);
    render();
  } else toast("Already recorded, or no eligible shares.", "warn");
};

let CH_wf = null;
window.togglePosChildren = function (rowId, el) {
  const kids = document.querySelectorAll("tr.pos-child." + rowId);
  const show = kids.length && kids[0].style.display === "none";
  kids.forEach((k) => {
    k.style.display = show ? "table-row" : "none";
  });
  if (el) el.textContent = show ? "\u25be" : "\u25b8"; // \u25BE open / \u25B8 closed
};
window.showPosWaterfall = function (key) {
  const { pos } = runFIFO();
  let p = pos[key];
  // Combined parent rows use a synthetic 'TICKER||COMB' key that does NOT exist in the
  // FIFO map (which is keyed by TICKER||PEA / TICKER||Regular). Aggregate all account
  // positions for that ticker so the waterfall works on the combined row too \u2014 not just
  // on the per-account drill-down children.
  if (!p && typeof key === "string" && key.indexOf("||COMB") >= 0) {
    const tk = key.slice(0, key.indexOf("||COMB"));
    const parts = Object.values(pos).filter((x) => x.ticker === tk);
    if (parts.length) {
      p = {
        ticker: tk,
        account: "Combined",
        held: 0,
        unreal: 0,
        realized: 0,
        divs: 0,
      };
      parts.forEach((x) => {
        p.held += x.held || 0;
        p.unreal += x.unreal || 0;
        p.realized += x.realized || 0;
        p.divs += x.divs || 0;
      });
    }
  }
  // Fallback: allow a bare ticker key too (resolve to combined).
  if (!p && typeof key === "string" && key.indexOf("||") < 0) {
    const parts = Object.values(pos).filter((x) => x.ticker === key);
    if (parts.length) {
      p = {
        ticker: key,
        account: "Combined",
        held: 0,
        unreal: 0,
        realized: 0,
        divs: 0,
      };
      parts.forEach((x) => {
        p.held += x.held || 0;
        p.unreal += x.unreal || 0;
        p.realized += x.realized || 0;
        p.divs += x.divs || 0;
      });
    }
  }
  if (!p) return;
  const _acctLbl =
    p.account === "Combined" ? "Combined (all accounts)" : p.account;
  document.getElementById("wfTitle").textContent =
    p.ticker + " \u2014 " + _acctLbl + " \u00B7 Return Waterfall";
  document.getElementById("wfNote").innerHTML =
    "Unrealized + Realized + Dividends \u2192 Lifetime. " +
    (p.held > 0 ? "" : "Position closed \u2014 unrealized is 0.");
  document.getElementById("wfModal").style.display = "flex";
  const tx = themeColor("text");
  const tx2 = themeColor("text2");
  setTimeout(() => {
    CH_wf = Highcharts.chart("wfChart", {
      chart: { type: "waterfall", backgroundColor: "transparent" },
      title: { text: null },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        categories: ["Unrealized", "Realized", "Dividends", "Lifetime"],
        labels: { style: { color: tx2 } },
      },
      yAxis: {
        title: { text: null },
        gridLineColor: "#2c3742",
        labels: { style: { color: tx2 }, format: "{value:,.0f}" },
      },
      tooltip: { pointFormat: "<b>{point.y:,.0f} MAD</b>" },
      plotOptions: {
        waterfall: {
          dataLabels: {
            enabled: true,
            style: { color: tx, textOutline: "none", fontWeight: "600" },
            format: "{point.y:,.0f}",
          },
        },
      },
      series: [
        {
          upColor: themeColor("success"),
          color: themeColor("error"),
          lineWidth: 1,
          dashStyle: "ShortDot",
          data: [
            { name: "Unrealized", y: Math.round(p.unreal) },
            { name: "Realized", y: Math.round(p.realized) },
            { name: "Dividends", y: Math.round(p.divs) },
            {
              name: "Lifetime",
              isSum: true,
              color: themeColor("primary"),
            },
          ],
        },
      ],
    });
  }, 20);
};

window.editPrice = async function (tk) {
  if (!M[tk]) M[tk] = {};
  const cur = M[tk].price != null ? M[tk].price : "";
  const v = await appPrompt(
    "Set current price for " + dispName(tk) + " (MAD):",
    cur,
    { title: "Set price", inputType: "text" },
  );
  if (v === null) return;
  const num = parseFloat(String(v).replace(",", "."));
  if (isNaN(num)) {
    toast("Enter a valid number.", "warn");
    return;
  }
  M[tk].price = num;
  safeSetItem("casa_master_v1", JSON.stringify(M));
  render();
};
document.getElementById("toggleClosed").onclick = () => {
  HIDE_CLOSED = !HIDE_CLOSED;
  document.getElementById("toggleClosed").textContent = HIDE_CLOSED
    ? "Show closed"
    : "Hide closed";
  rerenderPositions();
};

// ---------- full-state backup / restore ----------
const APP_LS_KEYS = [
  "casa_portfolio_txns_v1",
  "casa_fees_v1",
  "casa_fees_pea_v1",
  "casa_divtax_v1",
  "casa_master_v1",
  "casa_divcal_v1",
  "casa_theme_v1",
  "casa_snapshots_v1",
  "casa_pending_v1",
  "casa_salary_v1",
  "casa_expenses_v1",
  "casa_categories_v1",
  "casa_opcvm_isin_map_v1",
  "casa_opcvm_updated_v1",
  "casa_opcvm_updated_kind_v1",
  "casa_rebalance_v1",
  "casa_issuer_aliases_v1",
  "casa_cash_v1",
  "casa_brokers_v1",
];
let _backupBusy = false;
document.getElementById("backupAll").onclick = () => {
  // Guard set synchronously FIRST \u2014 blocks any rapid re-fire before setTimeout runs.
  if (_backupBusy) return;
  _backupBusy = true;
  // Defer the actual download to the next event-loop tick.
  // This ensures even two synchronous calls to this handler only produce one download:
  // both pass the guard check in the same tick, but only the first sets the flag and
  // schedules the work; the second is blocked on the very next line.
  setTimeout(() => {
    try {
      takeSnapshot(true);
      const dump = {
        _app: "casa_portfolio_tracker",
        _version: 2,
        _exported: new Date().toISOString(),
        data: {},
      };
      for (let n = 0; n < localStorage.length; n++) {
        const k = localStorage.key(n);
        if (
          k &&
          k.indexOf("casa_") === 0 &&
          k !== "casa_last_backup_v1" &&
          k !== "casa_carPlanCollapsed_v1" &&
          k !== "casa_incCollapsed_v1" &&
          k !== "casa_last_tab_v1" &&
          k !== "casa_last_app_v1"
        ) {
          const v = localStorage.getItem(k);
          if (v != null) dump.data[k] = v;
        }
      }
      APP_LS_KEYS.forEach((k) => {
        if (dump.data[k] == null) {
          const v = localStorage.getItem(k);
          if (v != null) dump.data[k] = v;
        }
      });
      // v2: optional password encryption. Leaving the passphrase blank keeps the
      // plaintext backup (unchanged default). A passphrase produces an encrypted
      // envelope (AES-GCM) that restore auto-detects. Async, so wrapped in IIFE.
      (async () => {
        try {
          let payloadObj = dump;
          let suffix = "";
          const pass = await appPrompt(
            "Optional: enter a password to ENCRYPT this backup (leave blank for a normal, unencrypted backup).",
            "",
            { inputType: "password", title: "Encrypt backup?" },
          );
          if (pass && String(pass).length > 0) {
            payloadObj = await __core.backupCrypto.encryptBackup(
              dump,
              String(pass),
            );
            suffix = "_encrypted";
          }
          const blob = new Blob(
              [JSON.stringify(payloadObj, null, pass ? 0 : 1)],
              {
                type: "application/json",
              },
            ),
            url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download =
            "portfolio_backup_" +
            (() => {
              const d = new Date();
              const pad = (n) => String(n).padStart(2, "0");
              return (
                d.getFullYear() +
                "-" +
                pad(d.getMonth() + 1) +
                "-" +
                pad(d.getDate()) +
                "_" +
                pad(d.getHours()) +
                pad(d.getMinutes())
              );
            })() +
            suffix +
            ".json";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          try {
            localStorage.setItem(
              "casa_last_backup_v1",
              new Date().toISOString(),
            );
          } catch (e) {}
          showBackupAge();
        } catch (err) {
          toast(
            "Backup failed: " + (err && err.message ? err.message : err),
            "err",
          );
        }
      })();
    } finally {
      setTimeout(() => {
        _backupBusy = false;
      }, 1500);
    }
  }, 0);
};
document.getElementById("restoreAll").onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      let dump = JSON.parse(rd.result);
      // v2: if this is an encrypted backup envelope, prompt for the password
      // and decrypt before proceeding. Plaintext backups skip this untouched.
      if (__core.backupCrypto.isEncryptedBackup(dump)) {
        const pass = await appPrompt(
          "This backup is encrypted. Enter its password to restore.",
          "",
          { inputType: "password", title: "Encrypted backup" },
        );
        if (pass == null || pass === "")
          throw new Error("Restore cancelled (no password).");
        dump = await __core.backupCrypto.decryptBackup(dump, String(pass));
      }
      if (!dump || dump._app !== "casa_portfolio_tracker" || !dump.data)
        throw new Error("Not a valid backup file.");
      var APP_SCHEMA = 2;
      var fileV = typeof dump._version === "number" ? dump._version : 1;
      if (
        fileV > APP_SCHEMA &&
        !(await appConfirm(
          "This backup was made by a NEWER version of the app (schema v" +
            fileV +
            " > v" +
            APP_SCHEMA +
            "). Some fields may not import correctly. Continue anyway?",
        ))
      )
        return;
      if (
        !(await appConfirm(
          "Restore this backup? It REPLACES current data, but portfolio-value snapshots are MERGED so no history is lost.",
        ))
      )
        return;
      // Merge snapshots (union by date) so switching browsers/files never loses value history.
      let mergedSnaps = null;
      try {
        const local = JSON.parse(
          localStorage.getItem("casa_snapshots_v1") || "[]",
        );
        const incoming = JSON.parse(dump.data["casa_snapshots_v1"] || "[]");
        const byDate = {};
        [...local, ...incoming].forEach((s) => {
          if (s && s.date) byDate[s.date] = s;
        });
        mergedSnaps = Object.values(byDate).sort((a, b) =>
          a.date < b.date ? -1 : 1,
        );
      } catch (e) {}
      // Restore EVERY key present in the backup (future-proof), not just a fixed list.
      Object.keys(dump.data).forEach((k) => {
        if (dump.data[k] != null) localStorage.setItem(k, dump.data[k]);
      });
      if (mergedSnaps)
        localStorage.setItem("casa_snapshots_v1", JSON.stringify(mergedSnaps));
      toast("Backup restored (value history merged). Reloading.", "ok");
      setTimeout(() => location.reload(), 200);
    } catch (err) {
      toast("Restore failed: " + err.message, "err");
    }
  };
  rd.readAsText(f);
};

// (removed redundant tipBox engine \u2014 unified #__qtip handles all data-tip)

// ---------- auto-add dividends from calendar (ex-date aware) ----------
// Eligibility: net shares held STRICTLY BEFORE the ex-date. Sell on/before ex-date => not eligible.
// Eligibility per user's rule: you receive the dividend on shares held through the day
// BEFORE the ex-date. So a BUY counts only if strictly before ex-date; a SELL removes
// shares if it happens ON or BEFORE the ex-date (selling on ex-date = NOT eligible).
function heldBefore(ticker, pea, exDateISO) {
  let q = 0;
  for (const t of TXNS) {
    if (t.ticker !== ticker) continue;
    if (!!t.pea !== !!pea) continue;
    if (t.action === "BUY") {
      if (t.date < exDateISO) q += t.qty; // bought before ex-date -> eligible
    } else if (t.action === "SELL") {
      if (t.date <= exDateISO) q -= t.qty; // sold on/before ex-date -> not eligible
    }
  }
  return q > 1e-9 ? q : 0; // never negative
}
const DIV_MATCH_WINDOW_DAYS = 14; // same dividend won't recur at same amount within ~2 weeks
function daysBetween(a, b) {
  return Math.abs((new Date(a) - new Date(b)) / 86400000);
}
document.getElementById("autoDiv").onclick = () => {
  const cal = DIVCAL.filter((d) => d.pay_date && (d.ex_date || d.pay_date));
  const accounts = [false, true]; // Regular, PEA
  let added = 0,
    matched = 0,
    exact = 0,
    pended = 0;
  const matchNotes = [];
  for (const d of cal) {
    const exd = d.ex_date || d.pay_date;
    for (const pea of accounts) {
      const sh = heldBefore(d.ticker, pea, exd);
      if (sh <= 1e-9) continue;
      // Look for an EXISTING DIV of same ticker + same amount + same account within a \u00B1window.
      // This catches a manual entry whose date differs slightly from the official pay date.
      const amt = +(+d.amount).toFixed(4);
      let hit = null;
      for (const t of TXNS) {
        if (t.action !== "DIV") continue;
        if (t.ticker !== d.ticker) continue;
        if (!!t.pea !== !!pea) continue;
        if (+(+t.price).toFixed(4) !== amt) continue;
        if (daysBetween(t.date, d.pay_date) <= DIV_MATCH_WINDOW_DAYS) {
          hit = t;
          break;
        }
      }
      if (hit) {
        // Already recorded (possibly with a slightly-off date) -> correct the date, don't duplicate.
        if (hit.date !== d.pay_date) {
          matchNotes.push(
            d.ticker +
              " " +
              (pea ? "(PEA) " : "") +
              hit.date +
              " \u2192 " +
              d.pay_date,
          );
          hit.date = d.pay_date;
          matched++;
        } else {
          exact++;
        }
        // enrich with ex-date/eligibility for the tooltip, and mark reconciled
        hit.exDate = exd;
        if (hit.eligBasis == null) hit.eligBasis = sh;
        hit.reconciled = true;
        continue;
      }
      // Also check PENDING for an already-staged matching dividend (avoid dup there too)
      const pendHit = PENDING.some(
        (o) =>
          o.action === "DIV" &&
          o.ticker === d.ticker &&
          !!o.pea === pea &&
          +(+o.price).toFixed(4) === amt &&
          daysBetween(o.date, d.pay_date) <= DIV_MATCH_WINDOW_DAYS,
      );
      if (pendHit) continue;
      // Only act once the EX-DATE has PASSED (you've actually qualified). A future ex-date
      // means you haven't locked in the dividend yet (could still buy/sell) -> skip for now.
      if (daysUntil(exd) > 0) continue;
      if (daysUntil(d.pay_date) > 0) {
        // Ex-date passed but pay date still future -> owed but not received -> stage in PENDING.
        PENDING.push({
          date: d.pay_date,
          ticker: d.ticker,
          action: "DIV",
          qty: +sh.toFixed(4),
          price: d.amount,
          pea: pea,
          broker: pea ? "attijari" : "saham",
          auto: true,
          exDate: exd,
          eligBasis: sh,
        });
        pended++;
      } else {
        // Pay date reached/passed -> record as a real transaction.
        TXNS.push({
          date: d.pay_date,
          ticker: d.ticker,
          action: "DIV",
          qty: +sh.toFixed(4),
          price: d.amount,
          pea: pea,
          broker: pea ? "attijari" : "saham",
          auto: true,
          exDate: exd,
          eligBasis: sh,
        });
        added++;
      }
    }
  }
  saveTxns(TXNS);
  savePending();
  let msg = "";
  if (added) msg += "\u2705 Recorded <b>" + added + "</b> paid dividend(s). ";
  if (pended)
    msg +=
      "\u23F3 Staged <b>" +
      pended +
      "</b> not-yet-paid dividend(s) in Pending. ";
  if (matched)
    msg += "\uD83D\uDD01 Corrected date on <b>" + matched + "</b> existing. ";
  if (exact) msg += exact + " already matched. ";
  if (!added && !pended && !matched && !exact)
    msg = "No eligible dividends found for your holdings.";
  document.getElementById("editHint").innerHTML = msg;
  render();
  renderPending();
};

document.getElementById("clearAutoDiv").onclick = async () => {
  const n = TXNS.filter((t) => t.auto).length;
  if (n === 0) {
    document.getElementById("editHint").textContent =
      "No auto-added dividends to clear.";
    return;
  }
  if (
    !(await appConfirm(
      "Remove all " +
        n +
        " auto-added dividend row(s)? Your manually-entered transactions are kept.",
    ))
  )
    return;
  TXNS = TXNS.filter((t) => !t.auto);
  saveTxns(TXNS);
  document.getElementById("editHint").innerHTML =
    "\u2705 Cleared <b>" + n + "</b> auto-added dividend(s).";
  render();
};

// ---------- portfolio value history (snapshots) ----------
let CH_history = null;
function loadSnapshots() {
  const s = localStorage.getItem("casa_snapshots_v1");
  if (s == null) return [];
  const parsed = safeParseLS("casa_snapshots_v1", s, null, "Value history");
  return Array.isArray(parsed.value) ? parsed.value : [];
}
function saveSnapshots(a) {
  if (safeSetItem("casa_snapshots_v1", JSON.stringify(a))) markSaved();
}
function currentTotals() {
  const { pos } = runFIFO();
  const arr = Object.values(pos);
  return arr.reduce(
    (a, p) => ({
      val: a.val + p.value,
      real: a.real + p.realized,
      div: a.div + p.divs,
      life: a.life + p.lifetime,
      inv: a.inv + (p.held > 0 ? p.invested : 0),
    }),
    { val: 0, real: 0, div: 0, life: 0, inv: 0 },
  );
}
function takeSnapshot(auto) {
  const t = currentTotals();
  const today = new Date().toISOString().slice(0, 10);
  let snaps = loadSnapshots();
  // one snapshot per day \u2014 overwrite same-day
  snaps = snaps.filter((s) => s.date !== today);
  let bankedTot = 0,
    netXfer = 0;
  try {
    if (typeof eLoad === "function") {
      eLoad();
      const bk = eBucketTotals().banked;
      bankedTot = Object.values(bk).reduce((a, b) => a + b, 0);
      netXfer = eCompute().netMDtoBT;
    }
  } catch (e) {}
  snaps.push({
    date: today,
    value: +t.val.toFixed(2),
    invested: +t.inv.toFixed(2),
    realized: +t.real.toFixed(2),
    dividends: +t.div.toFixed(2),
    lifetime: +t.life.toFixed(2),
    banked: +bankedTot.toFixed(2),
    netXfer: +netXfer.toFixed(2),
  });
  snaps.sort((a, b) => (a.date < b.date ? -1 : 1));
  saveSnapshots(snaps);
  if (!auto) {
    document.getElementById("snapNote").textContent =
      "Snapshot saved for " + today + ".";
    renderHistory();
  }
  return snaps;
}
function renderHistory() {
  let snaps = loadSnapshots();
  const note = document.getElementById("snapNote");
  if (snaps.length < 2) {
    if (note)
      note.textContent = snaps.length
        ? "A value-over-time trend appears after 2+ snapshots. Each backup adds one automatically; you can also click \u201CSave snapshot\u201D anytime."
        : "No snapshots yet. Each time you back up (or click \u201CSave snapshot\u201D) a point is recorded \u2014 the chart builds from there and travels with your backup file.";
  } else if (note) {
    note.textContent =
      snaps.length +
      " snapshots \u00B7 " +
      snaps[0].date +
      " \u2192 " +
      snaps[snaps.length - 1].date;
  }
  const tx2 = themeColor("text2");
  const cats = snaps.map((s) => s.date);
  CH_history = Highcharts.chart("historyChart", {
    chart: { backgroundColor: "transparent" },
    title: { text: null },
    credits: { enabled: false },
    legend: { itemStyle: { color: tx2 } },
    xAxis: { categories: cats, labels: { style: { color: tx2 } } },
    yAxis: {
      title: { text: null },
      gridLineColor: "#2c3742",
      labels: { style: { color: tx2 }, format: "{value:,.0f}" },
    },
    tooltip: { shared: true, valueDecimals: 0, valueSuffix: " MAD" },
    series: [
      {
        name: "Current Value",
        type: "area",
        color: themeColor("primary"),
        fillOpacity: 0.15,
        data: snaps.map((s) => s.value),
      },
      {
        name: "Lifetime Return",
        type: "line",
        color: themeColor("success"),
        data: snaps.map((s) => s.lifetime),
      },
    ],
  });
}
document.getElementById("snapBtn").onclick = () => takeSnapshot(false);
// Snapshots are captured on BACKUP (reliable & travels with the file), not daily-on-open.

// ---------- Transactions multi-select (bulk delete) ----------
function updateTxnBulkBar() {
  const sel = [...document.querySelectorAll(".txnChk:checked")];
  const bar = document.getElementById("txnBulkBar");
  if (!bar) return;
  if (sel.length) {
    bar.style.display = "flex";
    document.getElementById("txnSelCount").textContent =
      sel.length + " selected";
  } else bar.style.display = "none";
}
document.addEventListener("change", (e) => {
  if (e.target && e.target.classList && e.target.classList.contains("txnChk"))
    updateTxnBulkBar();
  if (e.target && e.target.id === "txnSelectAll") {
    const on = e.target.checked;
    document.querySelectorAll(".txnChk").forEach((c) => (c.checked = on));
    updateTxnBulkBar();
  }
});
document.getElementById("txnClearSel").onclick = () => {
  document
    .querySelectorAll(".txnChk,#txnSelectAll")
    .forEach((c) => (c.checked = false));
  updateTxnBulkBar();
};
document.getElementById("txnDelSel").onclick = async () => {
  const idxs = [...document.querySelectorAll(".txnChk:checked")].map(
    (c) => +c.dataset.idx,
  );
  if (!idxs.length) return;
  if (
    !(await appConfirm(
      "Delete " +
        idxs.length +
        " selected transaction(s)? This cannot be undone (except via a backup).",
    ))
  )
    return;
  const drop = new Set(idxs);
  TXNS = TXNS.filter((t, i) => !drop.has(i));
  saveTxns(TXNS);
  render();
};
document.getElementById("txnToPending").onclick = async () => {
  const idxs = [...document.querySelectorAll(".txnChk:checked")].map(
    (c) => +c.dataset.idx,
  );
  if (!idxs.length) return;
  const sel = idxs.map((i) => TXNS[i]).filter(Boolean);
  const divs = sel.filter((t) => t.action === "DIV").length;
  const movable = sel.filter((t) => t.action !== "DIV");
  if (!movable.length) {
    toast(
      "Dividends cannot be moved to pending. Select BUY/SELL transactions.",
      "warn",
    );
    return;
  }
  if (
    !(await appConfirm(
      "Move " +
        movable.length +
        " transaction(s) to Pending" +
        (divs ? " (" + divs + " dividend(s) skipped)" : "") +
        "? They will be removed from Transactions until re-validated.",
    ))
  )
    return;
  movable.forEach((t) => {
    const o = {
      date: t.date,
      ticker: t.ticker,
      action: t.action,
      qty: t.qty,
      price: t.price,
      pea: !!t.pea,
      broker: t.broker || txnBroker(t),
    };
    if (typeof t.total === "number" && t.total > 0) o.total = t.total;
    PENDING.push(o);
  });
  const drop = new Set(idxs.filter((i) => TXNS[i] && TXNS[i].action !== "DIV"));
  TXNS = TXNS.filter((t, i) => !drop.has(i));
  saveTxns(TXNS);
  savePending();
  render();
  renderPending();
  toast("Moved " + movable.length + " transaction(s) to Pending.", "ok");
};

// \u2500\u2500 "Apply to all rows" bar for bulk-edit modals (Transactions + Pending) \u2500\u2500
// Lets you set Action / Account / Broker / OPCVM once and stamp it onto every row
// currently shown in the modal, instead of editing each row individually.
function beBulkBarHTML() {
  const brokerOpts = Object.keys(BROKERS)
    .map(
      (id) =>
        `<option value="${escapeHtml(id)}">${escapeHtml(BROKERS[id].name)}</option>`,
    )
    .join("");
  return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:9px 11px;margin-bottom:12px;background:var(--panel2);border:1px solid var(--border);border-radius:9px">
      <span class="mini" style="font-weight:700;color:var(--text)">Apply to all rows:</span>
      <select id="beAllAction" class="mini"><option value="">Action\u2026</option><option>BUY</option><option>SELL</option><option>DIV</option></select>
      <select id="beAllAccount" class="mini"><option value="">Account\u2026</option><option value="reg">Regular</option><option value="pea">PEA</option></select>
      <select id="beAllBroker" class="mini"><option value="">Broker\u2026</option>${brokerOpts}</select>
      <select id="beAllOpcvm" class="mini"><option value="">OPCVM\u2026</option><option value="1">Fund</option><option value="0">Not fund</option></select>
      <button class="btn sec2" id="beApplyAll" style="font-size:12px">Apply to all</button>
    </div>`;
}
function wireBeBulkBar() {
  const btn = document.getElementById("beApplyAll");
  if (!btn) return;
  btn.onclick = () => {
    const act = document.getElementById("beAllAction").value;
    const acct = document.getElementById("beAllAccount").value;
    const brk = document.getElementById("beAllBroker").value;
    const opc = document.getElementById("beAllOpcvm").value;
    document.querySelectorAll("#bulkEditBody .behdr").forEach((row) => {
      if (act) {
        const el = row.querySelector(".beAction");
        if (el) el.value = act;
      }
      if (acct) {
        const el = row.querySelector(".beAccount");
        if (el) el.value = acct;
      }
      if (brk) {
        const el = row.querySelector(".beBroker");
        if (el) el.value = brk;
      }
      if (opc !== "") {
        const el = row.querySelector(".beOpcvm");
        if (el) el.checked = opc === "1";
      }
    });
  };
}

document.getElementById("txnEditSel").onclick = () => {
  const idxs = [...document.querySelectorAll(".txnChk:checked")].map(
    (c) => +c.dataset.idx,
  );
  if (!idxs.length) return;
  const m = document.getElementById("bulkEditModal"),
    body = document.getElementById("bulkEditBody");
  const tickerOpts = Object.keys(M)
    .sort()
    .map((t) => `<option value="${t}">`)
    .join("");
  const brokerOpts = (cur) =>
    Object.keys(BROKERS)
      .map(
        (id) =>
          `<option value="${escapeHtml(id)}"${(cur || "") === id ? " selected" : ""}>${escapeHtml(BROKERS[id].name)}</option>`,
      )
      .join("");
  const GRID =
    "display:grid;grid-template-columns:118px 110px 78px 68px 82px 88px 92px 100px 54px;gap:7px;align-items:center;margin-bottom:6px;min-width:940px";
  const rows = idxs
    .map((i) => {
      const t = TXNS[i];
      const curBroker = txnBroker(t);
      const isOpc =
        t.opcvm === true || !!(M[t.ticker] && M[t.ticker].cat === "OPCVM");
      return `<div class="behdr" data-idx="${i}" style="${GRID}">
      <input type="date" class="beDate" value="${t.date}" style="width:100%;box-sizing:border-box">
      <input list="beTickersTxn" class="beTicker" value="${escapeHtml(t.ticker)}" placeholder="ticker" style="width:100%;box-sizing:border-box">
      <select class="beAction" style="width:100%;box-sizing:border-box"><option${t.action === "BUY" ? " selected" : ""}>BUY</option><option${t.action === "SELL" ? " selected" : ""}>SELL</option><option${t.action === "DIV" ? " selected" : ""}>DIV</option></select>
      <input type="number" step="any" class="beQty" value="${t.qty}" placeholder="qty" style="width:100%;box-sizing:border-box">
      <input type="number" step="any" class="bePrice" value="${t.price}" placeholder="price" style="width:100%;box-sizing:border-box">
      <input type="number" step="any" class="beTotal" value="${typeof t.total === "number" && t.total > 0 ? t.total : ""}" placeholder="auto" data-tip="Manual total (OPCVM) \u2014 blank = auto" style="width:100%;box-sizing:border-box">
      <select class="beAccount" style="width:100%;box-sizing:border-box"><option value="reg"${!t.pea ? " selected" : ""}>Regular</option><option value="pea"${t.pea ? " selected" : ""}>PEA</option></select>
      <select class="beBroker" style="width:100%;box-sizing:border-box" data-tip="Broker (fee model)">${brokerOpts(curBroker)}</select>
      <label class="mini" style="display:flex;align-items:center;justify-content:center;gap:4px" data-tip="OPCVM fund?"><input type="checkbox" class="beOpcvm"${isOpc ? " checked" : ""}>Fund</label>
    </div>`;
    })
    .join("");
  body.innerHTML = `<h3 style="margin:0 0 4px">Edit ${idxs.length} transaction(s)</h3>
    <div class="mini" style="margin-bottom:10px">Adjust date, ticker, action, quantity, price, account, broker or OPCVM flag.</div>
    <datalist id="beTickersTxn">${tickerOpts}</datalist>
    ${beBulkBarHTML("Txn")}
    <div style="${GRID};font-size:11px;color:var(--text2);font-weight:600;margin-bottom:4px"><span>Date</span><span>Ticker</span><span>Action</span><span>Qty</span><span>Price</span><span>Total</span><span>Account</span><span>Broker</span><span>OPCVM</span></div>
    ${rows}
    <div class="form-row" style="margin-top:14px"><button class="btn" id="beSave">Save changes</button><button class="btn sec2" id="beCancel">Cancel</button></div>`;
  m.style.display = "flex";
  wireBeBulkBar();
  document.getElementById("beCancel").onclick = () => {
    m.style.display = "none";
  };
  document.getElementById("beSave").onclick = () => {
    document.querySelectorAll("#bulkEditBody .behdr").forEach((row) => {
      const i = +row.dataset.idx;
      const t = TXNS[i];
      if (!t) return;
      const date = row.querySelector(".beDate").value;
      const ticker = row.querySelector(".beTicker").value.trim().toUpperCase();
      const action = row.querySelector(".beAction").value;
      const qty = parseFloat(row.querySelector(".beQty").value);
      const price = parseFloat(row.querySelector(".bePrice").value);
      const acct = row.querySelector(".beAccount")
        ? row.querySelector(".beAccount").value
        : null;
      const brEl = row.querySelector(".beBroker");
      const opcEl = row.querySelector(".beOpcvm");
      const totEl = row.querySelector(".beTotal");
      const totV = totEl ? parseFloat(totEl.value) : NaN;
      if (date) t.date = date;
      if (ticker) t.ticker = ticker;
      if (action) t.action = action;
      if (!isNaN(qty)) t.qty = qty;
      if (!isNaN(price)) t.price = price;
      if (acct) t.pea = acct === "pea";
      if (brEl && brEl.value) t.broker = brEl.value;
      if (opcEl) t.opcvm = opcEl.checked;
      if (totEl) {
        if (!isNaN(totV) && totV > 0) t.total = totV;
        else delete t.total;
      }
      if (t.auto) delete t.auto; // manual edit -> no longer auto
    });
    saveTxns(TXNS);
    m.style.display = "none";
    render();
  };
};

// ---------- ledger search ----------
(function () {
  const el = document.getElementById("txnSearch");
  if (!el) return;
  el.addEventListener("input", () => {
    const { enriched } = runFIFO();
    renderTxns(enriched);
  });
})();

// fee panel collapse toggle
(function () {
  const h = document.getElementById("feeToggle");
  if (!h) return;
  h.onclick = () => {
    const b = document.getElementById("feeBody"),
      ch = document.getElementById("feeChevron");
    const open = b.style.display !== "none";
    b.style.display = open ? "none" : "block";
    if (ch) ch.textContent = open ? "\u25b8 Show" : "\u25be Hide";
  };
})();

// ---------- generic collapsible sections ----------
document.addEventListener("click", function (e) {
  const h = e.target.closest && e.target.closest("h2.collap");
  if (!h) return;
  const body = h.nextElementSibling;
  if (!body || !body.classList.contains("collap-body")) return;
  const open = body.style.display !== "none";
  body.style.display = open ? "none" : "block";
  const ch = h.querySelector(".collap-ch");
  if (ch) ch.textContent = open ? "\u25B8 Show" : "\u25BE Hide";
});

// ---------- pending indicators (dashboard banner + positions) ----------
function pendingByTicker() {
  const m = {};
  PENDING.forEach((o) => {
    (m[o.ticker] = m[o.ticker] || []).push(o);
  });
  return m;
}
function renderPendingBanner() {
  const el = document.getElementById("pendingBanner");
  if (!el) return;
  if (!PENDING.length) {
    el.innerHTML = "";
    return;
  }
  const buys = PENDING.filter((o) => o.action === "BUY").length,
    sells = PENDING.filter((o) => o.action === "SELL").length,
    divs = PENDING.filter((o) => o.action === "DIV").length;
  const parts = [];
  if (buys) parts.push(buys + " buy");
  if (sells) parts.push(sells + " sell");
  if (divs) parts.push(divs + " dividend" + (divs > 1 ? "s" : ""));
  el.innerHTML = `<div class="sec" style="border-color:var(--warn);cursor:pointer;margin-bottom:14px" data-act="gotoTab" data-args="pending">
    <div style="display:flex;align-items:center;gap:10px"><span style="font-size:18px">\u23F3</span>
    <div><b>${PENDING.length} pending item${PENDING.length > 1 ? "s" : ""}</b> <span class="mini">(${parts.join(" \u00B7 ")})</span> \u2014 not yet executed/received. Click to review in the Pending tab.</div></div></div>`;
}

// ---------- pending orders ----------
let PENDING = (() => {
  const s = localStorage.getItem("casa_pending_v1");
  if (s == null) return [];
  const parsed = safeParseLS("casa_pending_v1", s, null, "Pending orders");
  return Array.isArray(parsed.value) ? parsed.value : [];
})();
function savePending() {
  if (safeSetItem("casa_pending_v1", JSON.stringify(PENDING))) markSaved();
  else markSaveFailed();
}
let PEND_EDIT = null;
function readPendingForm() {
  const g = (id) => document.getElementById(id);
  const o = {
    date: g("pDate").value,
    ticker: g("pTicker").value.trim().toUpperCase(),
    action: g("pAction").value,
    qty: parseFloat(g("pQty").value),
    price: parseFloat(g("pPrice").value),
    pea: g("pPea").checked,
    opcvm: g("pOpcvm").checked,
    broker: g("pBroker").value,
  };
  const tot = parseFloat(g("pTotal").value);
  if (!isNaN(tot) && tot > 0) o.total = tot;

  if ((isNaN(o.price) || !o.price) && o.total > 0 && o.qty)
    o.price = o.total / o.qty;
  return o;
}

document.getElementById("clearPendDiv").onclick = async () => {
  const n = PENDING.filter((o) => o.action === "DIV").length;
  if (n === 0) {
    toast("No pending dividends to clear.", "warn");
    return;
  }
  if (
    !(await appConfirm(
      "Remove all " +
        n +
        " pending dividend(s)? (Pending buy/sell orders are kept.)",
    ))
  )
    return;
  PENDING = PENDING.filter((o) => o.action !== "DIV");
  savePending();
  renderPending();
};

document.getElementById("addPending").onclick = () => {
  const o = readPendingForm();
  if (!o.date || !o.ticker || !o.qty || (!o.price && !o.total)) {
    toast("Fill date, ticker, quantity and price (or total).", "warn");
    return;
  }
  // --- Tier 2 additive validation (pending orders): reject malformed values. ---
  if (!validTxnDate(o.date)) {
    toast("Date must be a real calendar date (YYYY-MM-DD).", "warn");
    return;
  }
  if (!(o.qty > 0) || !isFinite(o.qty)) {
    toast("Quantity must be a positive number.", "warn");
    return;
  }
  if (
    o.price != null &&
    o.price !== "" &&
    (!(o.price > 0) || !isFinite(o.price))
  ) {
    toast("Unit price must be a positive number.", "warn");
    return;
  }
  if (
    o.total != null &&
    o.total !== "" &&
    (!(o.total > 0) || !isFinite(o.total))
  ) {
    toast("Total must be a positive number.", "warn");
    return;
  }
  // --- end Tier 2 validation ---
  if (o.opcvm && !(M[o.ticker] && M[o.ticker].cat === "OPCVM")) {
    registerOpcvm(o.ticker, (document.getElementById("pFundName") || {}).value);
  } else if (o.opcvm && M[o.ticker] && M[o.ticker].cat === "OPCVM") {
    const _fn = (document.getElementById("pFundName") || {}).value;
    if (_fn && _fn.trim()) {
      M[o.ticker].name = _fn.trim();
      safeSetItem("casa_master_v1", JSON.stringify(M));
    }
  } else {
    const _fn = (document.getElementById("pFundName") || {}).value;
    if (_fn && _fn.trim()) {
      if (!M[o.ticker])
        M[o.ticker] = {
          name: _fn.trim(),
          cat: "STOCK",
          cycle: null,
          style: null,
          price: o.price || null,
        };
      else M[o.ticker].name = _fn.trim();
      safeSetItem("casa_master_v1", JSON.stringify(M));
    }
  }
  let _pFracWarn = "";
  if (!o.opcvm && Math.abs(o.qty - Math.round(o.qty)) > 1e-9) {
    _pFracWarn =
      "\u26a0\ufe0f Kept fractional stock qty " +
      o.qty +
      " for " +
      o.ticker +
      " (stocks usually trade in whole shares).";
  }
  // Off-target sanity check (buy above ideal entry / sell below ideal exit)
  {
    const _tf = pendingTargetFlag(o);
    if (_tf) {
      _pFracWarn =
        (_pFracWarn ? _pFracWarn + " " : "") + "\u26a0\ufe0f " + _tf.msg;
    }
  }
  if (PEND_EDIT != null) {
    PENDING[PEND_EDIT] = o;
    PEND_EDIT = null;
    document.getElementById("addPending").textContent = "Add order";
    document.getElementById("cancelPendingEdit").style.display = "none";
    document.getElementById("pendHint").textContent = "";
  } else PENDING.push(o);
  savePending();
  ["pQty", "pPrice", "pTotal"].forEach(
    (id) => (document.getElementById(id).value = ""),
  );
  document.getElementById("pPea").checked = true;
  document.getElementById("pOpcvm").checked = false;
  {
    const _d = document.getElementById("pDate");
    if (_d && PEND_EDIT == null) _d.value = _qwTodayISO();
  }
  {
    const _fn = document.getElementById("pFundName");
    if (_fn) {
      _fn.value = "";
    }
  }
  {
    const _tt = document.getElementById("pTotal");
    if (_tt) {
      _tt.dataset.auto = "";
    }
  }
  {
    const _pc = document.getElementById("pendCalc");
    if (_pc) _pc.textContent = "";
  }
  renderPending();
  if (_pFracWarn) {
    const ph = document.getElementById("pendHint");
    if (ph) {
      ph.style.color = "var(--warn)";
      ph.textContent = _pFracWarn;
      setTimeout(() => {
        if (ph.textContent === _pFracWarn) {
          ph.textContent = "";
          ph.style.color = "";
        }
      }, 12000);
    }
  }
};
document.getElementById("cancelPendingEdit").onclick = () => {
  PEND_EDIT = null;
  document.getElementById("addPending").textContent = "Add order";
  document.getElementById("cancelPendingEdit").style.display = "none";
  document.getElementById("pendHint").textContent = "";
  ["pQty", "pPrice", "pTotal"].forEach(
    (id) => (document.getElementById(id).value = ""),
  );
  document.getElementById("pPea").checked = true;
  document.getElementById("pOpcvm").checked = false;
  {
    const _d = document.getElementById("pDate");
    if (_d && PEND_EDIT == null) _d.value = _qwTodayISO();
  }
  {
    const _fn = document.getElementById("pFundName");
    if (_fn) {
      _fn.value = "";
    }
  }
  {
    const _tt = document.getElementById("pTotal");
    if (_tt) {
      _tt.dataset.auto = "";
    }
  }
  {
    const _pc = document.getElementById("pendCalc");
    if (_pc) _pc.textContent = "";
  }
};

window.prefillDividend = function (tk, amount, payDate, exDate) {
  // Prefill a DIV transaction in the Transactions Add form. Qty = eligible shares at ex-date.
  const elig = exDate
    ? heldBefore(tk, false, exDate) + heldBefore(tk, true, exDate)
    : 0;
  gotoTab("transactions");
  const g = (id) => document.getElementById(id);
  if (g("tDate")) g("tDate").value = payDate;
  if (g("tTicker")) g("tTicker").value = tk;
  setKindBadge(document.getElementById("tKind"), tk);
  if (g("tAction")) g("tAction").value = "DIV";
  if (g("tQty")) g("tQty").value = elig || "";
  if (g("tPrice")) g("tPrice").value = amount;
  if (g("tTotal")) g("tTotal").value = "";
  if (g("tPea")) g("tPea").checked = false;
  if (typeof liveCalc === "function") liveCalc();
  const hint = g("editHint");
  if (hint) {
    hint.style.color = "var(--info)";
    hint.textContent =
      "Drafting dividend for " +
      tk +
      " \u2014 " +
      (elig ? money(elig, elig % 1 ? 3 : 0) + " sh" : "set qty") +
      " @ " +
      money(amount) +
      "/sh on " +
      payDate +
      ". Review & Add.";
  }
  if (g("tQty")) setTimeout(() => g("tQty").focus(), 60);
};

window.prefillPending = function (tk) {
  const px = M[tk] && M[tk].price != null ? M[tk].price : "";
  gotoTab("pending");
  const g = (id) => document.getElementById(id);
  if (g("pDate")) g("pDate").value = _qwTodayISO();
  if (g("pTicker")) g("pTicker").value = tk;
  setKindBadge(document.getElementById("pKind"), tk);
  if (g("pAction")) g("pAction").value = "BUY";
  if (g("pPrice")) g("pPrice").value = px;
  if (g("pQty")) {
    g("pQty").value = "";
    setTimeout(() => g("pQty").focus(), 50);
  }
  const hint = g("pendHint");
  if (hint) {
    hint.style.color = "var(--info)";
    hint.textContent =
      "Drafting order for " +
      tk +
      " at " +
      (px ? money(px) + " MAD" : "(no price)") +
      " \u2014 set quantity and Add.";
  }
};

window.editPending = function (i) {
  const o = PENDING[i];
  if (!o) return;
  PEND_EDIT = i;
  window._loadingEditForm = true;
  document.getElementById("pDate").value = o.date;
  document.getElementById("pTicker").value = o.ticker;
  setKindBadge(document.getElementById("pKind"), o.ticker);
  document.getElementById("pAction").value = o.action;
  document.getElementById("pQty").value = o.qty;
  document.getElementById("pPrice").value = o.price != null ? o.price : "";
  document.getElementById("pTotal").value = o.total != null ? o.total : "";
  {
    const _tt = document.getElementById("pTotal");
    if (_tt) _tt.dataset.auto = "";
  }
  {
    const _nf = document.getElementById("pFundName");
    if (_nf) _nf.value = (M[o.ticker] && M[o.ticker].name) || "";
  }
  document.getElementById("pPea").checked = !!o.pea;
  document.getElementById("pOpcvm").checked =
    o.opcvm === true || !!(M[o.ticker] && M[o.ticker].cat === "OPCVM");
  document.getElementById("pOpcvm").dispatchEvent(new Event("change"));
  window._loadingEditForm = false;
  document.getElementById("addPending").textContent = "Update order";
  document.getElementById("cancelPendingEdit").style.display = "";
  document.getElementById("pendHint").textContent =
    "Editing pending order \u2014 change fields and press Update.";
  window.scrollTo(0, 0);
};
window.delPending = async function (i) {
  if (!(await appConfirm("Delete (cancel) this pending order?"))) return;
  PENDING.splice(i, 1);
  savePending();
  renderPending();
};
window.validatePending = async function (i) {
  const o = PENDING[i];
  if (!o) return;
  const isDiv = o.action === "DIV";
  const f = await appFillDialog(o, isDiv, money);
  if (f === null) return;
  const fillDate = f.date;
  if (fillDate === null || String(fillDate).trim() === "") {
    toast("Please enter a date.", "warn");
    return;
  }
  const px = parseFloat(String(f.price).replace(",", "."));
  if (isNaN(px) || px <= 0) {
    toast("Invalid amount.", "warn");
    return;
  }
  // --- Partial fill (BUY/SELL only) ---
  let fillQty = o.qty;
  if (!isDiv) {
    const qv = parseFloat(String(f.qty).replace(",", "."));
    if (isNaN(qv) || qv <= 0) {
      toast("Invalid quantity.", "warn");
      return;
    }
    if (qv > o.qty + 1e-9) {
      toast(
        "Executed quantity (" +
          money(qv, qv % 1 ? 3 : 0) +
          ") cannot exceed the pending order (" +
          money(o.qty, o.qty % 1 ? 3 : 0) +
          ").",
        "err",
      );
      return;
    }
    fillQty = qv;
  }
  const partial = !isDiv && fillQty < o.qty - 1e-9;
  const t = {
    date: String(fillDate).trim(),
    ticker: o.ticker,
    action: o.action,
    qty: fillQty,
    price: px,
    pea: !!o.pea,
    broker: o.broker || txnBroker(o),
  };
  if (o.opcvm === true || (M[o.ticker] && M[o.ticker].cat === "OPCVM"))
    t.opcvm = true;
  if (isDiv) {
    if (o.exDate) t.exDate = o.exDate;
    if (o.eligBasis != null) t.eligBasis = o.eligBasis;
    t.auto = true;
  } else if (o.total != null) {
    // total from dialog; blank => proportional default (qty\u00D7price implied downstream)
    const raw = f.total;
    if (raw != null && String(raw).trim() !== "") {
      const tv = parseFloat(String(raw).replace(",", "."));
      if (!isNaN(tv) && tv > 0) t.total = tv;
    } else {
      t.total = +(o.total * (fillQty / o.qty)).toFixed(2);
    }
  }
  TXNS.push(t);
  saveTxns(TXNS);
  if (partial) {
    const remQty = +(o.qty - fillQty).toFixed(6);
    o.qty = remQty;
    if (o.total != null)
      o.total = +(o.total * (remQty / (remQty + fillQty))).toFixed(2);
    PENDING[i] = o;
    savePending();
  } else {
    PENDING.splice(i, 1);
    savePending();
  }
  render();
  renderPending();
  toast(
    isDiv
      ? "Dividend recorded \u2014 added to Transactions."
      : partial
        ? "Partial fill: " +
          money(fillQty, fillQty % 1 ? 3 : 0) +
          " added to Transactions. " +
          money(o.qty, o.qty % 1 ? 3 : 0) +
          " left pending."
        : "Order validated \u2014 added to Transactions.",
    "ok",
  );
};

// ---------- Pending multi-select (bulk edit / validate / delete) ----------
function updatePendBulkBar() {
  const sel = [...document.querySelectorAll(".pendChk:checked")];
  const bar = document.getElementById("pendBulkBar");
  if (!bar) return;
  if (sel.length) {
    bar.style.display = "flex";
    document.getElementById("pendSelCount").textContent =
      sel.length + " selected";
  } else bar.style.display = "none";
}
document.addEventListener("change", (e) => {
  if (e.target && e.target.classList && e.target.classList.contains("pendChk"))
    updatePendBulkBar();
  if (e.target && e.target.id === "pendSelectAll") {
    const on = e.target.checked;
    document.querySelectorAll(".pendChk").forEach((c) => (c.checked = on));
    updatePendBulkBar();
  }
});
document.getElementById("pendClearSel").onclick = () => {
  document
    .querySelectorAll(".pendChk,#pendSelectAll")
    .forEach((c) => (c.checked = false));
  updatePendBulkBar();
};

document.getElementById("pendDelSel").onclick = async () => {
  const idxs = [...document.querySelectorAll(".pendChk:checked")].map(
    (c) => +c.dataset.idx,
  );
  if (!idxs.length) return;
  if (
    !(await appConfirm(
      "Delete " +
        idxs.length +
        " selected pending order(s)? This cancels them (recoverable only via a backup).",
    ))
  )
    return;
  const drop = new Set(idxs);
  PENDING = PENDING.filter((o, i) => !drop.has(i));
  savePending();
  renderPending();
};

document.getElementById("pendValSel").onclick = async () => {
  // Validate selected BUY/SELL/DIV orders one-by-one, reusing validatePending (per-order fill prompts).
  // Indices shift as orders are removed/reduced, so resolve each selected order by identity, newest first.
  const idxs = [...document.querySelectorAll(".pendChk:checked")].map(
    (c) => +c.dataset.idx,
  );
  if (!idxs.length) return;
  const targets = idxs.map((i) => PENDING[i]).filter(Boolean);
  if (
    !(await appConfirm(
      "Validate " +
        targets.length +
        " selected order(s)? You will be asked for fill details for each \u2014 press Cancel on any prompt to skip that one.",
    ))
  )
    return;
  targets.forEach((o) => {
    const cur = PENDING.indexOf(o); // resolve by identity \u2014 indices shift as orders are removed/reduced
    if (cur < 0) return; // already fully filled/removed
    validatePending(cur); // handles full or partial fill + its own confirmation
  });
  document
    .querySelectorAll(".pendChk,#pendSelectAll")
    .forEach((c) => (c.checked = false));
  updatePendBulkBar();
  renderPending();
};

document.getElementById("pendEditSel").onclick = () => {
  const idxs = [...document.querySelectorAll(".pendChk:checked")].map(
    (c) => +c.dataset.idx,
  );
  if (!idxs.length) return;
  const m = document.getElementById("bulkEditModal"),
    body = document.getElementById("bulkEditBody");
  const tickerOpts = Object.keys(M)
    .sort()
    .map((t) => `<option value="${t}">`)
    .join("");
  const brokerOpts = (cur) =>
    Object.keys(BROKERS)
      .map(
        (id) =>
          `<option value="${escapeHtml(id)}"${(cur || "") === id ? " selected" : ""}>${escapeHtml(BROKERS[id].name)}</option>`,
      )
      .join("");
  const GRID =
    "display:grid;grid-template-columns:118px 110px 78px 68px 82px 88px 92px 100px 54px;gap:7px;align-items:center;margin-bottom:6px;min-width:940px";
  const rows = idxs
    .map((i) => {
      const o = PENDING[i];
      const curBroker = txnBroker(o);
      const isOpc =
        o.opcvm === true || !!(M[o.ticker] && M[o.ticker].cat === "OPCVM");
      return `<div class="behdr" data-idx="${i}" style="${GRID}">
      <input type="date" class="beDate" value="${o.date}" style="width:100%;box-sizing:border-box">
      <input list="beTickersPend" class="beTicker" value="${o.ticker}" placeholder="ticker" style="width:100%;box-sizing:border-box">
      <select class="beAction" style="width:100%;box-sizing:border-box"><option${o.action === "BUY" ? " selected" : ""}>BUY</option><option${o.action === "SELL" ? " selected" : ""}>SELL</option><option${o.action === "DIV" ? " selected" : ""}>DIV</option></select>
      <input type="number" step="any" class="beQty" value="${o.qty}" placeholder="qty" style="width:100%;box-sizing:border-box">
      <input type="number" step="any" class="bePrice" value="${o.price != null ? o.price : ""}" placeholder="price" style="width:100%;box-sizing:border-box">
      <input type="number" step="any" class="beTotal" value="${typeof o.total === "number" && o.total > 0 ? o.total : ""}" placeholder="auto" data-tip="Manual total (OPCVM) \u2014 blank = auto" style="width:100%;box-sizing:border-box">
      <select class="beAccount" style="width:100%;box-sizing:border-box"><option value="reg"${!o.pea ? " selected" : ""}>Regular</option><option value="pea"${o.pea ? " selected" : ""}>PEA</option></select>
      <select class="beBroker" style="width:100%;box-sizing:border-box" data-tip="Broker (fee model)">${brokerOpts(curBroker)}</select>
      <label class="mini" style="display:flex;align-items:center;justify-content:center;gap:4px" data-tip="OPCVM fund?"><input type="checkbox" class="beOpcvm"${isOpc ? " checked" : ""}>Fund</label>
    </div>`;
    })
    .join("");
  body.innerHTML = `<h3 style="margin:0 0 4px">Edit ${idxs.length} pending order(s)</h3>
    <div class="mini" style="margin-bottom:10px">Adjust date, ticker, action, quantity, price, total, account, broker or OPCVM flag. These stay in Pending until validated.</div>
    <datalist id="beTickersPend">${tickerOpts}</datalist>
    ${beBulkBarHTML("Pend")}
    <div style="${GRID};font-size:11px;color:var(--text2);font-weight:600;margin-bottom:4px"><span>Date</span><span>Ticker</span><span>Action</span><span>Qty</span><span>Price</span><span>Total</span><span>Account</span><span>Broker</span><span>OPCVM</span></div>
    ${rows}
    <div class="form-row" style="margin-top:14px"><button class="btn" id="beSavePend">Save changes</button><button class="btn sec2" id="beCancelPend">Cancel</button></div>`;
  m.style.display = "flex";
  wireBeBulkBar();
  document.getElementById("beCancelPend").onclick = () => {
    m.style.display = "none";
  };
  document.getElementById("beSavePend").onclick = () => {
    document.querySelectorAll("#bulkEditBody .behdr").forEach((row) => {
      const i = +row.dataset.idx;
      const o = PENDING[i];
      if (!o) return;
      const date = row.querySelector(".beDate").value;
      const ticker = row.querySelector(".beTicker").value.trim().toUpperCase();
      const action = row.querySelector(".beAction").value;
      const qty = parseFloat(row.querySelector(".beQty").value);
      const price = parseFloat(row.querySelector(".bePrice").value);
      const acct = row.querySelector(".beAccount")
        ? row.querySelector(".beAccount").value
        : null;
      const brEl = row.querySelector(".beBroker");
      const opcEl = row.querySelector(".beOpcvm");
      const totEl = row.querySelector(".beTotal");
      const totV = totEl ? parseFloat(totEl.value) : NaN;
      if (date) o.date = date;
      if (ticker) o.ticker = ticker;
      if (action) o.action = action;
      if (!isNaN(qty) && qty > 0) o.qty = qty;
      if (!isNaN(price)) o.price = price;
      if (acct) o.pea = acct === "pea";
      if (brEl && brEl.value) o.broker = brEl.value;
      if (opcEl) o.opcvm = opcEl.checked;
      if (totEl) {
        if (!isNaN(totV) && totV > 0) o.total = totV;
        else delete o.total;
      }
    });
    savePending();
    m.style.display = "none";
    document
      .querySelectorAll(".pendChk,#pendSelectAll")
      .forEach((c) => (c.checked = false));
    updatePendBulkBar();
    renderPending();
  };
};

// Expected P&L for a pending SELL: net proceeds (at order price) \u2212 FIFO cost of shares sold.
function pendingSellPnl(o) {
  if (o.action !== "SELL") return null;
  const { pos } = runFIFO();
  const k = o.ticker + "||" + (o.pea ? "PEA" : "REG");
  const p = pos[k];
  if (!p || p.held <= 1e-9) return { pnl: null, note: "no holding" };
  const qty = Math.min(o.qty, p.held); // can only sell what you hold
  const avg = p.avg; // FIFO avg cost/share (incl. buy fees)
  // Net proceeds at the order price (or manual total), applying sell fees + TPCVM (0 for PEA)
  const r = computeRow(
    {
      action: "SELL",
      qty: qty,
      price: o.price,
      pea: o.pea,
      total: o.total,
    },
    avg,
  );
  const proceeds = r.net; // net cash received
  const cost = qty * avg;
  return { pnl: proceeds - cost, qty: qty, capped: o.qty > p.held };
}

// --- Pending order sanity flag: compare the ORDER price to the ideal target ---
// BUY  : order price materially ABOVE target buy  -> paying above ideal entry (\u26A0).
// SELL : order price materially BELOW target sell -> selling below ideal exit (\u26A0).
// Uses the same 10% threshold as the Signals/Rebalance "above target" flag.
// Rich hover tooltip for a pending order's ticker: shows the target buy/sell + fair value
// (mirrors the Signals tab), so the user can judge without switching tabs.
function pendingSignalTipHTML(o) {
  const m = M[o.ticker];
  const row = _tipRow; // shared tooltip row builder (gap:18px)
  let h =
    '<div style="font-weight:700;margin-bottom:6px">' +
    escapeHtml(o.ticker) +
    ' \u2014 Signal targets <span class="mini">(' +
    (o.pea ? "PEA" : "Regular") +
    ")</span></div>";
  if (!m) {
    h +=
      '<div class="mini" style="color:var(--muted)">No master data for this ticker yet \u2014 add it in Signals/Data to see targets.</div>';
    return h;
  }
  if (m.cat === "OPCVM") {
    h +=
      '<div class="mini" style="color:var(--muted)">OPCVM fund \u2014 no buy/sell target model (NAV-based).</div>';
    return h;
  }
  const sc = typeof factorScores === "function" ? factorScores(m) : null;
  const fv = typeof fairValue === "function" ? fairValue(m) : null;
  const tb = typeof targetBuy === "function" ? targetBuy(m, sc) : null;
  const ts = typeof targetSell === "function" ? targetSell(m, sc) : null;
  const px = m.price != null ? m.price : o.price;
  const s = sc && sc.score != null ? sc.score : null;
  h += row("Fair value", fv != null ? money(fv) + " MAD" : "\u2014");
  if (s != null) h += row("Signal score", (s * 100).toFixed(0) + "%");
  h +=
    '<div style="border-top:1px solid var(--border);margin:6px 0;padding-top:2px"></div>';
  h += row(
    '<b>Target Buy</b> <span class="mini">(ideal entry)</span>',
    '<b class="pos">' + (tb != null ? money(tb) + " MAD" : "\u2014") + "</b>",
  );
  h += row(
    '<b>Target Sell</b> <span class="mini">(ideal exit)</span>',
    '<b class="neg">' + (ts != null ? money(ts) + " MAD" : "\u2014") + "</b>",
  );
  h += row("Live price", px != null ? money(px) + " MAD" : "\u2014");
  // How does THIS order price sit vs the relevant target?
  if (o.price != null && isFinite(o.price)) {
    h +=
      '<div style="border-top:1px solid var(--border);margin:6px 0;padding-top:2px"></div>';
    if (o.action === "BUY" && tb != null && tb > 0) {
      const a = (o.price - tb) / tb;
      const good = a <= 0;
      h += row(
        "Your buy vs target",
        "<b>" + (a >= 0 ? "+" : "") + (a * 100).toFixed(0) + "%</b>",
        good ? "pos" : "neg",
      );
      if (fv != null && isFinite(fv) && fv > 0) {
        const vf = (o.price - fv) / fv; // + = above fair value
        h += row(
          "Your buy vs fair value",
          "<b>" + (vf >= 0 ? "+" : "") + (vf * 100).toFixed(0) + "%</b>",
          vf <= 0 ? "pos" : "neg",
        );
      }
      h +=
        '<div class="mini" style="margin-top:4px">' +
        (good
          ? "\u2713 At or below ideal entry \u2014 good."
          : a <= ABOVE_TGT_THRESH
            ? "Slightly above ideal entry."
            : fv != null && o.price > fv
              ? "\u26A0\uFE0F Above fair value \u2014 overpaying vs intrinsic worth."
              : "\u26A0\uFE0F Above ideal entry (still below fair value) \u2014 you\u2019re paying up vs the margin-of-safety price.") +
        "</div>";
    } else if (o.action === "SELL" && ts != null && ts > 0) {
      const b = (ts - o.price) / ts;
      const good = b <= 0;
      h += row(
        "Your sell vs target",
        "<b>" +
          (b > 0 ? "\u2212" : "+") +
          Math.abs(b * 100).toFixed(0) +
          "%</b>",
        good ? "pos" : "neg",
      );
      if (fv != null && isFinite(fv) && fv > 0) {
        const vf = (o.price - fv) / fv; // + = above fair value (good for a sell)
        h += row(
          "Your sell vs fair value",
          "<b>" + (vf >= 0 ? "+" : "") + (vf * 100).toFixed(0) + "%</b>",
          vf >= 0 ? "pos" : "neg",
        );
      }
      h +=
        '<div class="mini" style="margin-top:4px">' +
        (good
          ? "\u2713 At or above ideal exit \u2014 good."
          : b <= ABOVE_TGT_THRESH
            ? "Slightly below ideal exit."
            : fv != null && o.price < fv
              ? "\u26A0\uFE0F Below fair value \u2014 selling under intrinsic worth."
              : "\u26A0\uFE0F Below ideal exit (still above fair value) \u2014 a decent exit, short of the premium target.") +
        "</div>";
    }
  }
  return h;
}
function pendingTargetFlag(o) {
  if (!o || o.price == null || !isFinite(o.price)) return null;
  const m = M[o.ticker];
  if (!m || m.cat === "OPCVM") return null; // OPCVM has no target model
  const sc = typeof factorScores === "function" ? factorScores(m) : null;
  if (o.action === "BUY") {
    const tb = typeof targetBuy === "function" ? targetBuy(m, sc) : null;
    if (tb == null || !isFinite(tb) || tb <= 0) return null;
    const a = (o.price - tb) / tb; // + means above ideal entry
    if (a <= ABOVE_TGT_THRESH) return null;
    // Message depends on where the buy price sits RELATIVE TO FAIR VALUE, not just target buy.
    // Target Buy = fair value MINUS a 10-30% margin of safety, so it sits BELOW fair value.
    // A price can clear the target-buy+10% flag while still being (a) below fair value
    // (undervalued, just paying above the ideal discounted entry) OR (b) above fair value
    // (genuinely overpaying). Word it correctly for each case.
    const fv = typeof fairValue === "function" ? fairValue(m) : null;
    let msg;
    if (fv != null && isFinite(fv) && fv > 0 && o.price > fv) {
      const over = (o.price - fv) / fv;
      msg =
        "Buy price " +
        money(o.price) +
        " is " +
        (a * 100).toFixed(0) +
        "% above the ideal entry (target buy " +
        money(tb) +
        " MAD) AND " +
        (over * 100).toFixed(0) +
        "% ABOVE fair value (" +
        money(fv) +
        " MAD) \u2014 you\u2019d be overpaying vs intrinsic worth. Reconsider before executing.";
    } else if (fv != null && isFinite(fv) && fv > 0) {
      const disc = (fv - o.price) / fv;
      msg =
        "Buy price " +
        money(o.price) +
        " is " +
        (a * 100).toFixed(0) +
        "% above the ideal entry (target buy " +
        money(tb) +
        " MAD). It is still " +
        (disc * 100).toFixed(0) +
        "% below fair value (" +
        money(fv) +
        " MAD) \u2014 undervalued vs intrinsic worth, but above the discounted entry the model prefers as a margin of safety. Target buy = fair value \u2212 margin of safety, so it sits below fair value by design.";
    } else {
      msg =
        "Buy price " +
        money(o.price) +
        " is " +
        (a * 100).toFixed(0) +
        "% above the ideal entry (target buy " +
        money(tb) +
        " MAD) \u2014 double-check before executing.";
    }
    return { kind: "buy", pct: a, ref: tb, msg: msg };
  }
  if (o.action === "SELL") {
    const ts = typeof targetSell === "function" ? targetSell(m, sc) : null;
    if (ts == null || !isFinite(ts) || ts <= 0) return null;
    const b = (ts - o.price) / ts; // + means below ideal exit
    if (b <= ABOVE_TGT_THRESH) return null;
    // Message depends on where the sell price sits RELATIVE TO FAIR VALUE, not just target sell.
    // Target Sell = fair value PLUS a 12-40% premium, so it sits ABOVE fair value. A sell price
    // can trip the (>10% below target-sell) flag while still being (a) above fair value (a decent
    // exit, just short of the ideal premium) OR (b) below fair value (selling under intrinsic
    // worth \u2014 a stronger warning). Word it correctly for each case.
    const fv = typeof fairValue === "function" ? fairValue(m) : null;
    let msg;
    if (fv != null && isFinite(fv) && fv > 0 && o.price < fv) {
      const under = (fv - o.price) / fv;
      msg =
        "Sell price " +
        money(o.price) +
        " is " +
        (b * 100).toFixed(0) +
        "% below the ideal exit (target sell " +
        money(ts) +
        " MAD) AND " +
        (under * 100).toFixed(0) +
        "% BELOW fair value (" +
        money(fv) +
        " MAD) \u2014 you\u2019d be selling under intrinsic worth. Reconsider before executing.";
    } else if (fv != null && isFinite(fv) && fv > 0) {
      const prem = (o.price - fv) / fv;
      msg =
        "Sell price " +
        money(o.price) +
        " is " +
        (b * 100).toFixed(0) +
        "% below the ideal exit (target sell " +
        money(ts) +
        " MAD). It is still " +
        (prem * 100).toFixed(0) +
        "% above fair value (" +
        money(fv) +
        " MAD) \u2014 a decent exit above intrinsic worth, just short of the premium the model targets. Target sell = fair value + premium, so it sits above fair value by design.";
    } else {
      msg =
        "Sell price " +
        money(o.price) +
        " is " +
        (b * 100).toFixed(0) +
        "% below the ideal exit (target sell " +
        money(ts) +
        " MAD). You may be leaving money on the table \u2014 double-check before executing.";
    }
    return { kind: "sell", pct: b, ref: ts, msg: msg };
  }
  return null;
}
function pendingFlagBadge(o) {
  const f = pendingTargetFlag(o);
  if (!f) return "";
  const label =
    f.kind === "buy"
      ? "\u26a0 +" + (f.pct * 100).toFixed(0) + "% vs tgt buy"
      : "\u26a0 \u2212" + (f.pct * 100).toFixed(0) + "% vs tgt sell";
  return (
    ' <span class="badge b-abovetgt" style="cursor:help" data-tip="' +
    encodeURIComponent(f.msg) +
    '">' +
    label +
    "</span>"
  );
}
// Ticker color verdict for the Pending tab: green if buying at/below target buy
// or selling at/above target sell; red if buying above target buy or selling
// below target sell; neutral if no target model (OPCVM / missing data / no price).
function pendingPriceVerdict(o) {
  if (!o || o.price == null || !isFinite(o.price)) return null;
  const m = M[o.ticker];
  if (!m || m.cat === "OPCVM") return null;
  const sc = typeof factorScores === "function" ? factorScores(m) : null;
  if (o.action === "BUY") {
    const tb = typeof targetBuy === "function" ? targetBuy(m, sc) : null;
    if (tb == null || !isFinite(tb) || tb <= 0) return null;
    const d = (o.price - tb) / tb; // <=0 good (at/below ideal entry)
    return { good: d <= 0, action: "BUY", pct: d, ref: tb };
  }
  if (o.action === "SELL") {
    const ts = typeof targetSell === "function" ? targetSell(m, sc) : null;
    if (ts == null || !isFinite(ts) || ts <= 0) return null;
    const d = (o.price - ts) / ts; // >=0 good (at/above ideal exit)
    return { good: d >= 0, action: "SELL", pct: d, ref: ts };
  }
  return null;
}
// Reusable 52-week range bar (used by the Unit Px tooltip AND the Pending "Range" column).
// Returns { bar, hasRange, pos, live, lo, hi } \u2014 `bar` is HTML, empty string if no range.
// Pass compact=true for the small in-table version (no low/high captions).
function pendingRangeBar(o, barW, compact) {
  const m = M[o.ticker];
  const px = o.price;
  const out = { bar: "", hasRange: false, lo: null, hi: null };
  if (!m || px == null || !isFinite(px)) return out;
  const lo = m.low,
    hi = m.high,
    live = m.price;
  if (!(lo != null && isFinite(lo) && hi != null && isFinite(hi) && hi > lo))
    return out;
  out.hasRange = true;
  out.lo = lo;
  out.hi = hi;
  out.live = live;
  const pos = Math.max(-0.05, Math.min(1.05, (px - lo) / (hi - lo)));
  const livePos =
    live != null ? Math.max(0, Math.min(1, (live - lo) / (hi - lo))) : null;
  const dotX = Math.round(5 + Math.max(0, Math.min(1, pos)) * (barW - 10));
  const liveX =
    livePos != null
      ? Math.round(5 + Math.max(0, Math.min(1, livePos)) * (barW - 10))
      : null;
  const outLeft = px < lo,
    outRight = px > hi;
  let bar = '<div style="position:relative;height:18px;width:' + barW + 'px">';
  bar +=
    '<div style="position:absolute;top:7px;left:0;right:0;height:4px;background:linear-gradient(90deg,var(--success),var(--warn),var(--error));border-radius:2px"></div>';
  if (liveX != null)
    bar +=
      '<div title="Live price" style="position:absolute;top:2px;left:' +
      (liveX - 1) +
      'px;width:2px;height:14px;background:var(--text2);border-radius:1px"></div>';
  bar +=
    '<div title="Your order" style="position:absolute;top:0;left:' +
    (dotX - 5) +
    'px;width:10px;height:18px;background:var(--primary);border-radius:3px;opacity:.9"></div>';
  if (outLeft)
    bar +=
      '<div style="position:absolute;top:3px;left:-2px;font-size:9px;color:var(--warn)" title="Below 52-wk low">\u25C0</div>';
  if (outRight)
    bar +=
      '<div style="position:absolute;top:3px;right:-2px;font-size:9px;color:var(--warn)" title="Above 52-wk high">\u25B6</div>';
  bar += "</div>";
  out.bar = bar;
  return out;
}
function pendingUnitPxTipHTML(o) {
  const row = _tipRow; // shared tooltip row builder (gap:18px)
  const m = M[o.ticker];
  const px = o.price;
  let h =
    '<div style="font-weight:700;margin-bottom:6px">' +
    escapeHtml(o.ticker) +
    " \u2014 Price sanity check</div>";
  if (px == null || !isFinite(px)) {
    h += '<div class="mini" style="color:var(--muted)">No price entered.</div>';
    return h;
  }
  if (!m) {
    h +=
      '<div class="mini" style="color:var(--muted)">No master data \u2014 add ticker in Signals/Data to see 52-wk range.</div>';
    return h;
  }
  const lo = m.low,
    hi = m.high,
    live = m.price;
  const hasRange =
    lo != null && isFinite(lo) && hi != null && isFinite(hi) && hi > lo;
  if (!hasRange) {
    h += row("Your order price", money(px) + " MAD");
    if (live != null) h += row("Live price", money(live) + " MAD");
    h +=
      '<div class="mini" style="color:var(--muted);margin-top:4px">52-wk range not available \u2014 refresh prices from TradingView.</div>';
    return h;
  }
  // Position in range [0,1]; can be outside [0,1] for out-of-range prices
  const pos = Math.max(-0.05, Math.min(1.05, (px - lo) / (hi - lo)));
  const livePosRaw = live != null ? (live - lo) / (hi - lo) : null;
  const livePos =
    livePosRaw != null ? Math.max(0, Math.min(1, livePosRaw)) : null;
  // Verdict
  let verdict, vCol;
  if (px < lo) {
    verdict =
      o.action === "BUY"
        ? "\u26a0\ufe0f Below 52-wk low \u2014 unlikely to fill unless price falls further."
        : "\u2705 Far below 52-wk low \u2014 great sell price if it reaches it.";
    vCol = o.action === "BUY" ? "var(--warn)" : "var(--success)";
  } else if (px > hi) {
    verdict =
      o.action === "SELL"
        ? "\u26a0\ufe0f Above 52-wk high \u2014 unlikely to fill unless price breaks out."
        : "\u2705 Far above 52-wk high \u2014 great buy price if it falls to it.";
    vCol = o.action === "SELL" ? "var(--warn)" : "var(--success)";
  } else {
    const pct = Math.round(((px - lo) / (hi - lo)) * 100);
    verdict =
      o.action === "BUY"
        ? pct <= 35
          ? "\u2705 In the lower third of the range \u2014 realistic entry."
          : pct <= 65
            ? "\u2139\ufe0f Mid-range \u2014 reasonable."
            : "\ud83d\udcc8 In the upper third \u2014 buying near the high."
        : pct >= 65
          ? "\u2705 In the upper third of the range \u2014 realistic exit."
          : pct >= 35
            ? "\u2139\ufe0f Mid-range \u2014 reasonable."
            : "\ud83d\udcc8 In the lower third \u2014 selling near the low.";
    vCol =
      o.action === "BUY"
        ? pct <= 65
          ? "var(--success)"
          : "var(--warn)"
        : pct >= 35
          ? "var(--success)"
          : "var(--warn)";
  }
  // Mini range bar (shared with the Pending "Range" column via pendingRangeBar)
  const barW = 180;
  const liveX = livePos != null ? 1 : null; // presence flag for the caption below
  let bar =
    '<div style="margin:8px 0 4px">' +
    pendingRangeBar(o, barW, false).bar +
    "</div>";
  bar +=
    '<div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted);width:' +
    barW +
    'px">' +
    "<span>\u2193 " +
    money(lo) +
    "</span>" +
    (liveX != null
      ? '<span style="color:var(--text2)">Live: ' + money(live) + "</span>"
      : "") +
    "<span>" +
    money(hi) +
    " \u2191</span></div>";
  h += row("Your order", money(px) + " MAD");
  if (live != null)
    h += row(
      "Live price",
      money(live) + " MAD",
      livePosRaw != null && livePosRaw >= 0 && livePosRaw <= 1 ? "" : "",
    );
  h += '<div style="border-top:1px solid var(--border);margin:6px 0"></div>';
  h += row("52-wk low", money(lo) + " MAD");
  h += row("52-wk high", money(hi) + " MAD");
  const pctInRange = hasRange
    ? Math.round(((px - lo) / (hi - lo)) * 100)
    : null;
  if (pctInRange != null) h += row("Position in range", pctInRange + "%");
  h += bar;
  h += '<div style="margin-top:6px;color:' + vCol + '">' + verdict + "</div>";
  // Merge in the full signal targets (fair value, target buy/sell, vs fair, etc.)
  // so the Unit Px tooltip is the single place to judge the order.
  h +=
    '<div style="border-top:1px solid var(--border);margin:8px 0 6px"></div>';
  h += pendingSignalTipHTML(o);
  return h;
}
function renderPending() {
  const trades = PENDING.map((o, i) => ({ o, i })).filter(
    (x) => x.o.action === "BUY" || x.o.action === "SELL",
  );
  const divs = PENDING.map((o, i) => ({ o, i })).filter(
    (x) => x.o.action === "DIV",
  );
  // --- Buy/Sell box ---
  const cc = document.getElementById("pendCount");
  if (cc) cc.textContent = trades.length + " pending";
  const tb = document.querySelector("#pendTable tbody");
  if (tb) {
    if (!trades.length) {
      tb.innerHTML =
        '<tr><td colspan="16" class="l" style="color:var(--muted)">No pending buy/sell orders.</td></tr>';
    } else {
      const rows = trades.sort((a, b) => (a.o.date < b.o.date ? 1 : -1));
      tb.innerHTML = rows
        .map(({ o, i }) => {
          const ac = o.action === "BUY" ? "b-buy" : "b-sell";
          return `<tr><td class="center"><input type="checkbox" class="pendChk" data-idx="${i}"></td><td class="l">${o.date}</td><td class="l">${(function () {
            // Ticker keeps its on/off-target colour, but the tooltip now lives
            // on the Unit Px cell (which includes these signal targets), so no
            // duplicate hover here.
            const _v = pendingPriceVerdict(o);
            const _col = _v
              ? _v.good
                ? "var(--success)"
                : "var(--error)"
              : "";
            const _cs = _col ? "color:" + _col + ";" : "";
            return '<b style="' + _cs + '">' + escapeHtml(o.ticker) + "</b>";
          })()}</td>
          ${(function () {
            const _m = M[o.ticker];
            const _nm = (_m && _m.name) || "";
            // Clickable \u2192 full company detail overlay (same as Signals tab), but only
            // when master data exists (showCompanyDetail returns early otherwise).
            if (_m) {
              return (
                '<td class="l" style="color:var(--text2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer" data-tip="Click for full company details" data-act="showCompanyDetail" data-stop="true" data-args="' +
                o.ticker +
                '">' +
                escapeHtml(_nm || o.ticker) +
                ' <span style="color:var(--muted)">\ud83d\udcca</span></td>'
              );
            }
            return (
              '<td class="l" style="color:var(--text2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' +
              escapeHtml(_nm) +
              '">' +
              escapeHtml(_nm || "\u2014") +
              "</td>"
            );
          })()}
          <td class="l"><span class="badge ${ac}">${o.action}</span></td><td>${money(o.qty, o.qty % 1 ? 3 : 0)}</td>
          ${(function () {
            const _m = M[o.ticker];
            const _lp = _m && _m.price != null ? _m.price : null;
            return (
              "<td>" +
              (_lp != null
                ? money(_lp)
                : "<span style='color:var(--muted)'>\u2014</span>") +
              "</td>"
            );
          })()}
          ${(function () {
            if (o.price == null)
              return '<td style="color:var(--muted)">\u2014</td>';
            const _tip = pendingUnitPxTipHTML(o);
            return (
              '<td style="cursor:help;border-bottom:1px dotted var(--border-l)" data-tip="' +
              encodeURIComponent(_tip) +
              '">' +
              money(o.price) +
              ' <span style="color:var(--muted)">\u24d8</span></td>'
            );
          })()}
          ${(function () {
            // Range column: compact 52-wk range bar mirroring the Unit Px tooltip.
            const rb = pendingRangeBar(o, 88, true);
            if (!rb.hasRange)
              return '<td class="center" style="color:var(--muted)">\u2014</td>';
            const _tip = pendingUnitPxTipHTML(o);
            return (
              '<td class="center" style="cursor:help" data-tip="' +
              encodeURIComponent(_tip) +
              '"><div style="display:inline-block;vertical-align:middle">' +
              rb.bar +
              "</div></td>"
            );
          })()}
          ${(function () {
            const _b = pendingFlagBadge(o).trim();
            return (
              '<td class="center">' +
              (_b ? _b : '<span style="color:var(--muted)">\u2014</span>') +
              "</td>"
            );
          })()}
          ${(function () {
            // Expected total WITH fees. For BUY: gross+fees (=\u2212net). For SELL: net proceeds after fees & tax.
            if (o.price == null || o.qty == null) {
              return o.total != null
                ? "<td>" + money(o.total) + "</td>"
                : '<td style="color:var(--muted)">\u2014</td>';
            }
            const rr = computeRow({
              action: o.action,
              ticker: o.ticker,
              qty: o.qty,
              price: o.price,
              date: o.date,
              pea: o.pea,
              opcvm: o.opcvm,
              total: o.total,
            });
            const gross = o.price * o.qty;
            const expTot =
              o.action === "BUY"
                ? gross + rr.fees
                : o.action === "SELL"
                  ? rr.net
                  : o.total != null
                    ? o.total
                    : gross;
            const row = _tipRow; // shared tooltip row builder (gap:18px)
            let h =
              '<div style="font-weight:700;margin-bottom:6px">Expected ' +
              (o.action === "BUY" ? "cost" : "proceeds") +
              " \u00B7 " +
              o.ticker +
              " (" +
              (o.pea ? "PEA" : "Regular") +
              ")</div>";
            h += row(
              "Unit \u00D7 Qty",
              money(o.price) + " \u00D7 " + money(o.qty, o.qty % 1 ? 3 : 0),
            );
            h += row("Gross", money(gross) + " MAD");
            if (rr.fees > 0)
              h += row(
                (o.action === "BUY" ? "+ " : "\u2212 ") + "Fees",
                (o.action === "BUY" ? "+" : "\u2212") + money(rr.fees),
              );
            if (o.action === "SELL" && rr.tax > 0)
              h += row("\u2212 Capital-gains tax", "\u2212" + money(rr.tax));
            h +=
              '<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>';
            h += row(
              "<b>Expected total</b>",
              "<b>" + money(expTot) + " MAD</b>",
            );
            if (rr.manual)
              h +=
                '<div class="mini" style="margin-top:4px;color:var(--muted)">Manual total entered \u2014 fees implied.</div>';
            return (
              '<td style="cursor:help" data-tip="' +
              encodeURIComponent(h) +
              '">' +
              money(expTot) +
              ' <span style="color:var(--muted)">\u24D8</span></td>'
            );
          })()}
          ${(function () {
            // Div Yield \u2014 from the master list (same figure as the Signals tab).
            const _m = M[o.ticker];
            const dy =
              _m && _m.divy != null && isFinite(_m.divy) ? _m.divy : null;
            if (dy == null) return '<td style="color:var(--muted)">\u2014</td>';
            const _tip =
              typeof divyTipHTML === "function"
                ? ' data-tip="' +
                  encodeURIComponent(
                    divyTipHTML({
                      ticker: o.ticker,
                      m: _m,
                      divy: dy,
                      price: _m.price,
                    }),
                  ) +
                  '" style="cursor:help"'
                : "";
            return (
              '<td class="' +
              (dy > 0 ? "pos" : "") +
              '"' +
              _tip +
              ">" +
              pct(dy) +
              "</td>"
            );
          })()}
          ${(function () {
            if (o.action !== "SELL")
              return '<td style="color:var(--muted)">\u2014</td>';
            const ep = pendingSellPnl(o);
            if (!ep || ep.pnl == null)
              return '<td style="color:var(--muted)" data-tip="You do not currently hold this in this account">\u2014</td>';
            return (
              '<td class="' +
              cls(ep.pnl) +
              '" data-tip="If executed: expected realized ' +
              (ep.pnl >= 0 ? "gain" : "loss") +
              (ep.capped
                ? " (capped to shares held: " +
                  money(ep.qty, ep.qty % 1 ? 3 : 0) +
                  ")"
                : "") +
              '">' +
              (ep.pnl >= 0 ? "+" : "") +
              money(ep.pnl) +
              (ep.capped ? " *" : "") +
              "</td>"
            );
          })()}
          <td class="center">${o.pea ? '<span class="chip" style="background:rgba(56,189,248,.15);color:var(--info)">PEA</span>' : "REG"}</td>
          <td class="center" style="font-size:10px">${escapeHtml((BROKERS[txnBroker(o)] || {}).name || txnBroker(o))}</td>
          <td class="center" style="white-space:nowrap">
            <button class="chip" style="cursor:pointer;border:none;background:rgba(38,208,124,.15);color:var(--success);margin-right:4px" data-act="validatePending" data-args="${i}" aria-label="Mark executed" title="Mark executed" data-tip="Mark executed \u2192 add to Transactions">\u2713</button>
            <button class="chip" style="cursor:pointer;border:none;margin-right:4px" data-act="editPending" data-args="${i}" aria-label="Edit order" title="Edit order">\u270E</button>
            <button class="chip" style="cursor:pointer;border:none" data-act="delPending" data-args="${i}" aria-label="Delete pending order" title="Delete pending order">\u2715</button>
          </td></tr>`;
        })
        .join("");
    }
  }
  let totPnl = 0,
    nSell = 0,
    totBuy = 0,
    nBuy = 0,
    totSellProceeds = 0,
    nSellPriced = 0;
  trades.forEach(({ o }) => {
    if (o.action === "SELL") {
      const ep = pendingSellPnl(o);
      if (ep && ep.pnl != null) {
        totPnl += ep.pnl;
        nSell++;
      }
    }
    if (o.price != null && o.qty != null) {
      const rr = computeRow({
        action: o.action,
        ticker: o.ticker,
        qty: o.qty,
        price: o.price,
        date: o.date,
        pea: o.pea,
        opcvm: o.opcvm,
        total: o.total,
      });
      const gross = o.price * o.qty;
      if (o.action === "BUY") {
        totBuy += gross + rr.fees;
        nBuy++;
      } else if (o.action === "SELL") {
        totSellProceeds += rr.net;
        nSellPriced++;
      }
    }
  });
  const el = document.getElementById("pendSellSummary");
  if (el) {
    let parts = [];
    if (nBuy)
      parts.push(
        `Total expected cost of ${nBuy} pending buy${nBuy > 1 ? "s" : ""} (incl. fees): <b>${money(totBuy)} MAD</b>`,
      );
    if (nSellPriced)
      parts.push(
        `Total expected proceeds of ${nSellPriced} pending sell${nSellPriced > 1 ? "s" : ""} (net of fees &amp; tax): <b>${money(totSellProceeds)} MAD</b>`,
      );
    if (nSell)
      parts.push(
        `Expected P&L if those sells execute: <b class="${cls(totPnl)}">${totPnl >= 0 ? "+" : ""}${money(totPnl)} MAD</b>`,
      );
    el.innerHTML = parts.length
      ? parts.map((s) => "<div>" + s + "</div>").join("") +
        '<div class="mini">At order prices. Buy total = gross + brokerage fees; sell proceeds = gross \u2212 fees \u2212 tax.</div>'
      : '<span class="mini">No priced pending orders.</span>';
  }
  // --- Dividends box ---
  const dc = document.getElementById("pendDivCount");
  if (dc) dc.textContent = divs.length + " pending";
  const dtb = document.querySelector("#pendDivTable tbody");
  if (dtb) {
    if (!divs.length) {
      dtb.innerHTML =
        '<tr><td colspan="8" class="l" style="color:var(--muted)">No pending dividends.</td></tr>';
      const ds0 = document.getElementById("pendDivSummary");
      if (ds0) ds0.innerHTML = "";
    } else {
      let totNet = 0;
      const rows = divs.sort((a, b) => (a.o.date < b.o.date ? 1 : -1));
      dtb.innerHTML = rows
        .map(({ o, i }) => {
          const r = computeRow({
            action: "DIV",
            qty: o.qty,
            price: o.price,
            date: o.date,
            pea: o.pea,
          });
          const net = r.net;
          totNet += net;
          const tip = (function () {
            const row = _tipRow; // shared tooltip row builder (gap:18px)
            const gross = o.price * o.qty;
            const yr = new Date(o.date).getFullYear();
            let h =
              '<div style="font-weight:700;margin-bottom:6px">Pending dividend \u00B7 ' +
              o.ticker +
              " (" +
              (o.pea ? "PEA" : "Regular") +
              ")</div>";
            h += row(
              "Amount/share \u00D7 qty",
              money(o.price) + " \u00D7 " + money(o.qty, o.qty % 1 ? 3 : 0),
            );
            h += row("Gross", money(gross) + " MAD");
            if (r.fees > 0) h += row("\u2212 Fees", "\u2212" + money(r.fees));
            h += o.pea
              ? row("Dividend tax", "0 (PEA exempt)", "pos")
              : row(
                  '\u2212 Dividend tax <span class="mini">(' +
                    (divRate(yr) * 100).toFixed(2) +
                    "% incl VAT, " +
                    yr +
                    ")</span>",
                  "\u2212" + money(r.tax),
                );
            h +=
              '<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>';
            h += row("<b>Est. net</b>", "<b>" + money(net) + " MAD</b>", "pos");
            h += row(
              "Ex-date / Pay date",
              (o.exDate || "\u2014") + " \u2192 " + o.date,
            );
            return h;
          })();
          const _tkCell = M[o.ticker]
            ? '<b style="cursor:pointer;color:var(--primary2)" data-tip="Click for full company details" data-act="showCompanyDetail" data-args="' +
              o.ticker +
              '">' +
              escapeHtml(o.ticker) +
              "</b>"
            : "<b>" + escapeHtml(o.ticker) + "</b>";
          return `<tr><td class="l">${o.date}</td><td class="l" style="color:var(--text2)">${o.exDate || "\u2014"}</td><td class="l">${_tkCell}${o.pea ? ' <span class="chip" style="background:rgba(56,189,248,.15);color:var(--info)">PEA</span>' : ""}</td>
          <td>${money(o.qty, o.qty % 1 ? 3 : 0)}</td><td>${money(o.price)}</td><td class="pos nis-cell" style="cursor:help" data-tip="${encodeURIComponent(tip)}">${money(net)} <span style="color:var(--muted)">\u24D8</span></td>
          <td class="center" style="font-size:11px">${(BROKERS[o.broker] || {}).name || (o.pea ? "PEA" : "REG")}<br><span class="mini">${o.pea ? "PEA" : "Reg"}</span></td>
          <td class="center" style="white-space:nowrap">
            <button class="chip" style="cursor:pointer;border:none;background:rgba(38,208,124,.15);color:var(--success);margin-right:4px" data-act="validatePending" data-args="${i}" aria-label="Mark executed" title="Mark executed" data-tip="Mark received \u2192 add to Transactions">\u2713</button>
            <button class="chip" style="cursor:pointer;border:none;margin-right:4px" data-act="editPending" data-args="${i}" aria-label="Edit order" title="Edit order">\u270E</button>
            <button class="chip" style="cursor:pointer;border:none" data-act="delPending" data-args="${i}" aria-label="Delete pending order" title="Delete pending order">\u2715</button>
          </td></tr>`;
        })
        .join("");
      const ds = document.getElementById("pendDivSummary");
      if (ds)
        ds.innerHTML = `Total expected net dividends pending: <b class="pos">${money(totNet)} MAD</b>`;
    }
  }
}

// ---------- recently sold summary (30/90 days) ----------

// ---------- recently bought summary (30/90 days) ----------
function renderRecentlyBought() {
  // Buys straight from TXNS (cost incl. fees via computeRow, or manual total)
  const buys = [];
  TXNS.filter((t) => t.action === "BUY").forEach((t) => {
    const r = computeRow(t, 0);
    buys.push({
      ticker: t.ticker,
      date: t.date,
      qty: t.qty,
      cost: Math.abs(r.net),
      pea: !!t.pea,
    });
  });
  function win(days) {
    const rows = buys.filter((s) => {
      const du = daysUntil(s.date);
      return du <= 0 && du >= -days;
    });
    return {
      n: rows.length,
      cost: rows.reduce((a, s) => a + s.cost, 0),
      rows,
    };
  }
  const tip = (title, st) => {
    let h = `<div style="font-weight:700;margin-bottom:6px">${title}</div>`;
    if (!st.rows.length)
      return h + '<div class="mini">No buys in this window.</div>';
    h += `<div class="mini" style="margin-bottom:2px">ticker \u00B7 date \u00B7 cost (incl. fees)</div>`;
    [...st.rows]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .forEach((s) => {
        h += `<div style="display:flex;justify-content:space-between;gap:16px"><span>${s.ticker} <span class="mini">${s.date} \u00B7 ${money(s.qty, s.qty % 1 ? 3 : 0)}sh</span></span><span style="font-family:var(--mono)">${money(s.cost)}</span></div>`;
      });
    h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>`;
    h += `<div style="display:flex;justify-content:space-between;gap:16px"><span><b>Total invested</b></span><span style="font-family:var(--mono)"><b>${money(st.cost)} MAD</b></span></div>`;
    return h;
  };
  const b30 = win(30),
    b90 = win(90);
  const kr = document.getElementById("boughtKpiRow");
  if (!kr) return;
  kr.innerHTML =
    kpi(
      "Bought \u00B7 last 30d",
      b30.n + " trade" + (b30.n === 1 ? "" : "s"),
      "",
      tip("Bought in last 30 days", b30),
    ) +
    kpi(
      "Invested \u00B7 30d",
      money(b30.cost, 0) + " MAD",
      "",
      tip("Cash deployed \u2014 last 30 days", b30),
    ) +
    kpi(
      "Bought \u00B7 last 90d",
      b90.n + " trade" + (b90.n === 1 ? "" : "s"),
      "",
      tip("Bought in last 90 days", b90),
    ) +
    kpi(
      "Invested \u00B7 90d",
      money(b90.cost, 0) + " MAD",
      "",
      tip("Cash deployed \u2014 last 90 days", b90),
    );
}

function renderRecentlySold() {
  const { pos } = runFIFO();
  // Gather all sells with their ticker/account from realizedDetail
  const sells = [];
  Object.values(pos).forEach((p) => {
    (p.realizedDetail || []).forEach((d) => {
      sells.push({ ticker: p.ticker, account: p.account, ...d });
    });
  });
  function windowStats(days) {
    const rows = sells.filter((s) => {
      const du = daysUntil(s.date);
      return du <= 0 && du >= -days;
    });
    const proceeds = rows.reduce((a, s) => a + s.proceeds, 0);
    const gain = rows.reduce((a, s) => a + s.gain, 0);
    return { n: rows.length, proceeds, gain, rows };
  }
  const tip = (title, st) => {
    let h = `<div style="font-weight:700;margin-bottom:6px">${title}</div>`;
    if (!st.rows.length)
      return h + '<div class="mini">No sells in this window.</div>';
    h += `<div class="mini" style="margin-bottom:2px">ticker \u00B7 date \u00B7 proceeds \u00B7 (gain)</div>`;
    [...st.rows]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .forEach((s) => {
        h += `<div style="display:flex;justify-content:space-between;gap:16px"><span>${s.ticker} <span class="mini">${s.date} \u00B7 ${money(s.qty, s.qty % 1 ? 3 : 0)}sh</span></span><span style="font-family:var(--mono)">${money(s.proceeds)} <span class="${cls(s.gain)}">(${s.gain >= 0 ? "+" : ""}${money(s.gain)})</span></span></div>`;
      });
    h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>`;
    h += `<div style="display:flex;justify-content:space-between;gap:16px"><span><b>Total proceeds</b></span><span style="font-family:var(--mono)"><b>${money(st.proceeds)} MAD</b></span></div>`;
    h += `<div style="display:flex;justify-content:space-between;gap:16px"><span>Total realized gain</span><span class="${cls(st.gain)}" style="font-family:var(--mono)">${money(st.gain)}</span></div>`;
    return h;
  };
  const s30 = windowStats(30),
    s90 = windowStats(90);
  const kr = document.getElementById("soldKpiRow");
  if (!kr) return;
  kr.innerHTML =
    kpi(
      "Sold \u00B7 30d",
      s30.n + " trade" + (s30.n === 1 ? "" : "s"),
      "",
      tip("Sold in last 30 days", s30),
    ) +
    kpi(
      "Proceeds \u00B7 30d",
      money(s30.proceeds, 0) + " MAD",
      "pos",
      tip("Sold in last 30 days \u2014 " + s30.n + " trade(s)", s30),
    ) +
    kpi(
      "Sold \u00B7 90d",
      s90.n + " trade" + (s90.n === 1 ? "" : "s"),
      "",
      tip("Sold in last 90 days", s90),
    ) +
    kpi(
      "Proceeds \u00B7 90d",
      money(s90.proceeds, 0) + " MAD",
      "pos",
      tip("Sold in last 90 days \u2014 " + s90.n + " trade(s)", s90),
    );
}

// ---------- top-level app switcher (placeholders) ----------
document.querySelectorAll(".app-btn").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll(".app-btn")
        .forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const app = b.dataset.app;
      try {
        localStorage.setItem("casa_last_app_v1", app);
      } catch (e) {}
      const tabsRow = document.querySelector(".tabs");
      const views = document.querySelectorAll(".view");
      const pTabs = document.getElementById("portfolioTabs");
      const eTabs = document.getElementById("expensesTabs");
      if (app === "portfolio") {
        // top-bar tabs stay in place; show the portfolio tab group
        if (tabsRow) tabsRow.style.display = "";
        if (pTabs) pTabs.style.display = "contents";
        if (eTabs) eTabs.style.display = "none";
        {
          const sv0 = document.getElementById("salaryView");
          if (sv0) sv0.style.display = "none";
        }
        {
          const ev0 = document.getElementById("expensesView");
          if (ev0) ev0.style.display = "none";
        }
        const active = document.querySelector("#portfolioTabs .tab.active");
        const v = active ? active.dataset.view : "dashboard";
        views.forEach((x) => x.classList.remove("active"));
        const vd = document.getElementById(v);
        if (vd) vd.classList.add("active");
        const ph = document.getElementById("appPlaceholder");
        if (ph) ph.style.display = "none";
      } else {
        views.forEach((x) => x.classList.remove("active"));
        const sv = document.getElementById("salaryView");
        let ph = document.getElementById("appPlaceholder");
        if (app === "salary") {
          // Salary has no sub-tabs \u2014 hide the tab groups but keep the row height consistent by hiding the whole row
          if (tabsRow) tabsRow.style.display = "none";
          if (ph) ph.style.display = "none";
          {
            const ev0 = document.getElementById("expensesView");
            if (ev0) ev0.style.display = "none";
          }
          if (sv) {
            sv.style.display = "block";
            renderSalary();
          }
        } else {
          if (sv) sv.style.display = "none";
          const ev = document.getElementById("expensesView");
          if (app === "expenses") {
            // top-bar tabs stay in place; swap to the expenses tab group
            if (tabsRow) tabsRow.style.display = "";
            if (pTabs) pTabs.style.display = "none";
            if (eTabs) eTabs.style.display = "contents";
            if (ph) ph.style.display = "none";
            if (ev) {
              ev.style.display = "block";
              renderExpenses();
            }
            return;
          }
          if (tabsRow) tabsRow.style.display = "none";
          if (ev) ev.style.display = "none";
          if (!ph) {
            ph = document.createElement("div");
            ph.id = "appPlaceholder";
            document.querySelector(".app").appendChild(ph);
          }
          ph.style.display = "block";
          ph.innerHTML =
            '<div class="sec" style="text-align:center;padding:48px 20px"><div style="font-size:40px;margin-bottom:10px">\uD83D\uDCB8</div><h2 style="justify-content:center;border:none">\uD83D\uDCB8 Monthly Expenses</h2><div class="mini" style="margin-top:8px">Coming soon \u2014 this module is a placeholder for now.</div></div>';
        }
      }
    }),
);
