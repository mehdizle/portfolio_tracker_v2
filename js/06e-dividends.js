// 06e-dividends.js
// Dividend feature: estimate math, income dashboard, calendar grid, and the
// multi-year forecast. Moved out of 06-features.js so dividends own their file
// (sibling to 06b-import / 06c-backup / 06d-pending). Part of the Portfolio
// Tracker app, loaded as an ordered plain <script> (shared global scope via
// scripts/concat.mjs). Reads DIVCAL/DIVTAX/M + __core.dividendForecast/tax and
// the shared helpers (heldSharesOf in 02-compute, tooltip builders in 01b).
// ============================================================
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
  // Forecast fill: synthesize gap events from multi-year history via the core
  // module. Current-year gaps (a ticker that paid in past years but hasn't been
  // announced yet this year) are ALWAYS filled so they show up in expected
  // income. Next-year forecast events are included only when "Project next year"
  // is on. Real announced events always take precedence (projectedCalendar skips
  // any ticker/year already present).
  const _refYr = TODAY.getFullYear();
  const _recordedDiv = TXNS.filter((t) => t.action === "DIV" && t.date).map(
    (t) => {
      const dt = new Date(t.date);
      return {
        ticker: t.ticker,
        year: dt.getFullYear(),
        month: dt.getMonth() + 1,
      };
    },
  );
  const _fcAll = __core.dividendForecast.projectedCalendar(DIVCAL, _refYr, {
    windowYears: 3,
    currentMonth: TODAY.getMonth() + 1,
    recorded: _recordedDiv,
  });
  const _fcEvents = _divProject
    ? _fcAll
    : _fcAll.filter((d) => d._forecastYear === _refYr);
  const _projCal = DIVCAL.concat(_fcEvents);
  // Expected income: dividends you're eligible for (held before ex-date) that are upcoming
  // OR just passed (within 30 days) but not yet recorded. Uses ex-date eligibility.
  const upcoming = _projCal.filter((d) => {
    if (!d.pay_date || eligibleSharesAtEx(d) <= 0) return false;
    const du = daysUntil(d.pay_date);
    return du >= 0 || (du >= -30 && !divRecorded(d));
  });
  let inc90 = 0;
  const byMonth = {},
    byMonthTk = {},
    det90 = [];
  for (const d of upcoming) {
    const sh = eligibleSharesAtEx(d);
    const net = divNetFor(d, sh);
    const du = daysUntil(d.pay_date);
    const item = {
      ticker: d.ticker,
      date: d.pay_date,
      amount: net,
      sh: sh,
      est: !!d._forecast,
    };
    if (du <= 90) {
      inc90 += net;
      det90.push(item);
    }
    const mk = d.pay_date.slice(0, 7);
    byMonth[mk] = (byMonth[mk] || 0) + net;
    (byMonthTk[mk] = byMonthTk[mk] || {})[d.ticker] =
      (byMonthTk[mk][d.ticker] || 0) + net;
  }
  // Income for the NEXT CALENDAR YEAR (refYear+1): net of all eligible dividends
  // whose pay-date falls in that year - announced calendar events PLUS forecast
  // fill-ins. Computed independently of the "Project next year" display toggle
  // so the KPI is always populated. This is a per-YEAR total, not a rolling 365d.
  const _nextYr = _refYr + 1;
  let incNextYr = 0;
  const detNextYr = [];
  for (const d of DIVCAL.concat(_fcAll)) {
    if (!d.pay_date || d.pay_date.slice(0, 4) !== String(_nextYr)) continue;
    const sh = eligibleSharesAtEx(d);
    if (sh <= 0) continue;
    const net = divNetFor(d, sh);
    incNextYr += net;
    detNextYr.push({
      ticker: d.ticker,
      date: d.pay_date,
      amount: net,
      est: !!d._forecast,
    });
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
          h += `<div style="display:flex;justify-content:space-between;gap:16px"><span>${escapeHtml(x.ticker)} <span class="mini">${escapeHtml(x.date)}${x.est ? " \u00B7 est." : ""}</span></span><span style="font-family:var(--mono)">${money(x.amount)}</span></div>`;
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
  const __NEXTYRYIELD__ =
    portVal > 0 ? ((incNextYr / portVal) * 100).toFixed(2) + "%" : "\u2014";
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
      "Income \u00B7 next year",
      money(incNextYr, 0) + " MAD",
      "pos",
      detTip(
        "Expected income \u00B7 " + _nextYr,
        [
          "Net of dividend tax. Total for the " + _nextYr + " calendar year.",
          "Announced dividends + forecast fill-ins.",
        ],
        detNextYr,
      ),
    ) +
    kpi(
      "Received this year",
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
      "Next-year Yield",
      __NEXTYRYIELD__,
      "",
      T("Next-year dividend yield", [
        "Expected " + _nextYr + " income divided by",
        "current portfolio market value.",
        "(Forward yield for the next calendar year.)",
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
    // Exclude Exceptional (one-off) dividends from the projection - only
    // ordinary dividends are expected to recur next year.
    const shifted = DIVCAL.filter(
      (d) =>
        d.pay_date &&
        d.pay_date.startsWith(String(yr)) &&
        String(d.div_type || "").toLowerCase() !== "exceptional",
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
  renderDivForecast(pos);
}
// Multi-year dividend forecast (reference estimate). Builds a per-ticker
// projection for next year from the calendar's history via __core.dividendForecast,
// values it on currently-held shares, and renders a table into #divForecastBox.
function renderDivForecast(pos) {
  const box = document.getElementById("divForecastBox");
  if (!box) return;
  const refYear = TODAY.getFullYear();
  const fc = __core.dividendForecast.buildForecast(DIVCAL, refYear, {
    windowYears: 3,
  });
  const body = document.getElementById("divForecastBody");
  const head = document.getElementById("divForecastHead");
  if (!fc.rows.length) {
    if (head) head.textContent = "Reference forecast";
    if (body)
      body.innerHTML =
        '<tr><td colspan="7" class="l" style="color:var(--muted)">No dividend history yet \u2014 import past years (2024, 2025\u2026) in the Dividend Calendar to build a forecast.</td></tr>';
    const ft = document.getElementById("divForecastTotal");
    if (ft) ft.textContent = "\u2014";
    return;
  }
  const MONTHS = [
    "",
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
  // Respect the Dividends-tab filter: "held" limits the forecast to tickers you
  // currently hold; other filters (all/upcoming/missing) show every forecast row
  // (a forecast is inherently upcoming). Keeps this table consistent with the
  // calendar table above it.
  const _f = (document.getElementById("divFilter") || {}).value || "all";
  let fcRows = fc.rows;
  if (_f === "held")
    fcRows = fc.rows.filter((r) => heldSharesOf(pos, r.ticker) > 0);
  if (head)
    head.textContent =
      "Reference forecast \u00B7 " +
      fc.targetYear +
      (_f === "held" ? " (held only)" : "") +
      (fc.rows.length ? " (from your dividend history)" : "");
  if (!fcRows.length) {
    if (body)
      body.innerHTML =
        '<tr><td colspan="7" class="l" style="color:var(--muted)">No tickers match this filter.</td></tr>';
    const ft0 = document.getElementById("divForecastTotal");
    if (ft0) ft0.textContent = money(0, 0) + " MAD";
    return;
  }
  const _fcYr = fc.targetYear;
  let projIncome = 0;
  const rowsHtml = fcRows
    .map((r) => {
      const sh = heldSharesOf(pos, r.ticker);
      // Est. Income = NET of dividend tax (and broker fees / PEA exemption),
      // valued on shares held now. Value each projected payment slot as a
      // synthetic next-year DIV event and run it through divNetFor - the same
      // math recorded and calendar dividends use - so tax is applied per slot
      // at next year's rate.
      let projInc = 0,
        projGross = 0,
        projFees = 0,
        projTax = 0;
      const slotCalcs = [];
      for (const s of r.slots || []) {
        if (!(s.projectedAmt > 0)) continue;
        const mm = String(s.month || 6).padStart(2, "0");
        const evt = {
          ticker: r.ticker,
          amount: s.projectedAmt,
          ex_date: _fcYr + "-" + mm + "-01",
          pay_date: _fcYr + "-" + mm + "-15",
          div_type: "Ordinary",
        };
        const c = sh > 0 ? divCalc(evt, sh) : null;
        slotCalcs.push({ slot: s, mm, calc: c });
        if (c) {
          projInc += c.net;
          projGross += c.gross;
          projFees += c.fees;
          projTax += c.tax;
        }
      }
      projIncome += projInc;
      // Payment months (a ticker paying twice a year shows both).
      const payMonths = (r.slots || [])
        .map((s) => s.month)
        .filter(Boolean)
        .map((m) => MONTHS[m]);
      const monthLabel = payMonths.length
        ? payMonths.join(", ")
        : r.expectedMonth
          ? MONTHS[r.expectedMonth]
          : "\u2014";
      const perYearBadge =
        r.paymentsPerYear > 1
          ? ` <span class="chip" style="color:var(--text2)" data-tip="Pays about ${r.paymentsPerYear}x per year">${r.paymentsPerYear}x/yr</span>`
          : "";
      // Informational: ordinary/exceptional split changed year-to-year, so the
      // ordinary-only projection may look like a jump (e.g. SALAFIN).
      const splitBadge = r.splitFlag
        ? ` <span class="chip" style="color:var(--warn);cursor:help" data-tip="${tipRef("Ordinary/Exceptional split is inconsistent across years for this ticker. Only the Ordinary portion is forecast, so the estimate may look like a jump. Check the labels if the totals should match.")}">\u26A0 split</span>`
        : "";
      const _tr = _tipRow;
      // HISTORY: show the most recent HIST_INLINE years inline; if there are
      // more, add a "+N more" chip and put the FULL series in a tooltip (so 10+
      // years never overflow the column).
      const HIST_INLINE = 3;
      const yearsAsc = r.years.slice();
      const shownYears = yearsAsc.slice(-HIST_INLINE);
      const hiddenCount = yearsAsc.length - shownYears.length;
      const histInline = shownYears
        .map(
          (y) =>
            `<span class="mini" style="color:var(--muted)">${y}:</span> ${money(r.byYear[y])}`,
        )
        .join(' <span style="color:var(--border)">\u00B7</span> ');
      const histFullTip =
        `<div style="font-weight:700;margin-bottom:6px">${escapeHtml(r.ticker)} \u00B7 dividend history</div>` +
        yearsAsc
          .map((y) => _tr(String(y), money(r.byYear[y]) + " MAD"))
          .join("");
      const histCell = hiddenCount
        ? `${histInline} <span class="chip" style="cursor:help;color:var(--text2)" data-tip="${tipRef(histFullTip)}">+${hiddenCount} more</span>`
        : histInline;

      const growthPct =
        r.method === "trend"
          ? (r.growth >= 0 ? "+" : "") + (r.growth * 100).toFixed(0) + "%"
          : "flat";
      const consChip = (() => {
        const c = r.consistency;
        const col =
          c >= 1
            ? "var(--success)"
            : c >= 0.66
              ? "var(--warn)"
              : "var(--muted)";
        return `<span class="chip" style="color:${col}" data-tip="Paid in ${r.yearsCounted} of last ${r.windowYears} years">${r.yearsCounted}/${r.windowYears}</span>`;
      })();

      // PROJ./SH tooltip: how the projection was built, per payment slot.
      const projTip = (() => {
        let h = `<div style="font-weight:700;margin-bottom:6px">Projected per share \u00B7 ${escapeHtml(r.ticker)} \u00B7 ${_fcYr}</div>`;
        h += `<div class="mini" style="margin-bottom:6px">Level = recency-weighted average of up to 5 recent years (newest counts most); trend = gentle nudge (max \u00B110%/yr).</div>`;
        for (const s of r.slots || []) {
          if (r.paymentsPerYear > 1)
            h += `<div style="font-weight:600;margin-top:4px">${MONTHS[s.month] || "\u2014"} payment</div>`;
          h += _tr("Level (weighted avg)", money(s.level) + " MAD");
          h += _tr(
            "Trend",
            (s.growth >= 0 ? "+" : "") + (s.growth * 100).toFixed(1) + "%",
          );
          h += _tr("= Projected", money(s.projectedAmt) + " MAD");
        }
        if ((r.slots || []).length > 1) {
          h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>`;
          h += _tr(
            "<b>Annual total</b>",
            "<b>" + money(r.projectedDps) + " MAD</b>",
          );
        }
        return h;
      })();

      // EST. INCOME tooltip: gross -> fees -> tax -> net, per slot + combined.
      const incTip = (() => {
        if (!(sh > 0))
          return `<div style="font-weight:700;margin-bottom:6px">Est. income \u00B7 ${escapeHtml(r.ticker)}</div><div class="mini">You don't currently hold this ticker.</div>`;
        let h = `<div style="font-weight:700;margin-bottom:6px">Est. net income \u00B7 ${escapeHtml(r.ticker)} \u00B7 ${_fcYr}</div>`;
        h += _tr("Shares held", money(sh, sh % 1 ? 3 : 0));
        const multi = slotCalcs.length > 1;
        for (const sc of slotCalcs) {
          if (!sc.calc) continue;
          if (multi)
            h += `<div style="font-weight:600;margin-top:4px">${MONTHS[sc.slot.month] || "\u2014"} \u00B7 ${money(sc.slot.projectedAmt)}/sh</div>`;
          h += _tr("Gross", money(sc.calc.gross) + " MAD");
          if (sc.calc.fees)
            h += _tr("\u2212 Fees", "\u2212" + money(sc.calc.fees));
          h += _tr(
            "\u2212 Tax (" + (sc.calc.rate * 100).toFixed(2) + "%)",
            "\u2212" + money(sc.calc.tax),
          );
        }
        h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>`;
        h += _tr("Total gross", money(projGross) + " MAD");
        if (projFees) h += _tr("\u2212 Total fees", "\u2212" + money(projFees));
        h += _tr("\u2212 Total tax", "\u2212" + money(projTax));
        h += _tr("<b>Est. net</b>", "<b>" + money(projInc) + " MAD</b>", "pos");
        return h;
      })();

      return `<tr>
        <td class="l"><b>${escapeHtml(r.ticker)}</b>${splitBadge} <span class="mini" style="color:var(--muted)">${escapeHtml(r.issuer || "")}</span></td>
        <td class="l">${histCell}</td>
        <td class="nis-cell" style="cursor:help" data-tip="${tipRef(projTip)}">${money(r.projectedDps)} <span style="color:var(--muted)">\u24D8</span></td>
        <td class="center"><span class="mini" style="color:var(--text2)">${growthPct}</span></td>
        <td class="center">${consChip}</td>
        <td class="center" style="color:var(--text2)">${monthLabel}${perYearBadge}</td>
        <td class="nis-cell" style="cursor:help" data-tip="${tipRef(incTip)}">${sh > 0 ? money(projInc) + ' <span style="color:var(--muted)">\u24D8</span>' : '<span style="color:var(--muted)">\u2014</span>'}</td>
      </tr>`;
    })
    .join("");
  if (body) body.innerHTML = rowsHtml;
  const ft = document.getElementById("divForecastTotal");
  if (ft) ft.textContent = money(projIncome, 0) + " MAD";
}
