// ============================================================
// 04-render.js
// render: tax/concentration, render(), KPIs, hero, charts, positions, tooltips, Top Buys/Sector/Headroom, draft-selected
// Part of the Portfolio Tracker app. Loaded as an ordered plain
// <script> (shared global scope) - order matters, see index.html.
// ============================================================
// ---------- tax summary by year + concentration ----------
function renderTaxSummary() {
  // Recompute per-transaction tax by walking TXNS (fees/tax come from computeRow with running FIFO avg).
  const byYear = {};
  const yr = (d) => String(new Date(d).getFullYear());
  const { enriched } = runFIFO(); // enriched rows carry fees/tax/net per txn
  for (const e of enriched) {
    const y = yr(e.date);
    byYear[y] = byYear[y] || {
      realized: 0,
      cgTax: 0,
      divNet: 0,
      divTax: 0,
    };
    if (e.action === "SELL") {
      byYear[y].cgTax += e.tax || 0;
    } else if (e.action === "DIV") {
      byYear[y].divNet += e.net || 0;
      byYear[y].divTax += e.tax || 0;
    }
  }
  // realized gains per year from FIFO detail (needs date) \u2014 recompute simply: sum gains of sells by year
  // Use compute: for each SELL enriched, realized gain = proceeds - matched cost. We stored realizedDetail per position with date.
  const { pos } = runFIFO();
  for (const k in pos) {
    (pos[k].realizedDetail || []).forEach((d) => {
      const y = yr(d.date);
      byYear[y] = byYear[y] || {
        realized: 0,
        cgTax: 0,
        divNet: 0,
        divTax: 0,
      };
      byYear[y].realized += d.gain;
    });
  }
  const years = Object.keys(byYear).sort();
  const tb = document.querySelector("#taxTable tbody");
  if (!years.length) {
    tb.innerHTML =
      '<tr><td colspan="6" class="l" style="color:var(--muted)">No transactions yet.</td></tr>';
    return;
  }
  let tot = { realized: 0, cgTax: 0, divNet: 0, divTax: 0 };
  tb.innerHTML =
    years
      .map((y) => {
        const r = byYear[y];
        tot.realized += r.realized;
        tot.cgTax += r.cgTax;
        tot.divNet += r.divNet;
        tot.divTax += r.divTax;
        return `<tr><td class="l">${y}</td><td class="${cls(r.realized)}">${money(r.realized)}</td><td>${money(r.cgTax)}</td><td class="pos">${money(r.divNet)}</td><td>${money(r.divTax)}</td><td><b>${money(r.cgTax + r.divTax)}</b></td></tr>`;
      })
      .join("") +
    `<tr style="border-top:2px solid var(--border)"><td class="l"><b>Total</b></td><td class="${cls(tot.realized)}"><b>${money(tot.realized)}</b></td><td><b>${money(tot.cgTax)}</b></td><td class="pos"><b>${money(tot.divNet)}</b></td><td><b>${money(tot.divTax)}</b></td><td><b>${money(tot.cgTax + tot.divTax)}</b></td></tr>`;
}
function renderConcentration() {
  const { pos } = runFIFO();
  const held = Object.values(pos).filter((p) => p.held > 0 && p.value > 0);
  const total = held.reduce((s, p) => s + p.value, 0);
  const box = document.getElementById("concentrationBox");
  if (total <= 0) {
    box.innerHTML = "";
    return;
  }
  const warns = [];
  // Single position > 20%
  held.forEach((p) => {
    const w = p.value / total;
    if (w > 0.2)
      warns.push(
        `\u26A0 <b>${p.ticker}</b> (${escapeHtml((M[p.ticker] && M[p.ticker].name) || p.ticker)}) is <b>${(w * 100).toFixed(0)}%</b> of your portfolio \u2014 consider trimming for diversification.`,
      );
  });
  // Sector > 40%
  const bySec = {};
  held.forEach((p) => {
    const c = (M[p.ticker] && M[p.ticker].cat) || "Uncategorized";
    bySec[c] = (bySec[c] || 0) + p.value;
  });
  Object.keys(bySec).forEach((c) => {
    const w = bySec[c] / total;
    if (w > 0.4)
      warns.push(
        `\u26A0 Sector <b>${c}</b> is <b>${(w * 100).toFixed(0)}%</b> of your portfolio \u2014 high sector concentration.`,
      );
  });
  if (!warns.length) {
    box.innerHTML = `<div class="sec" style="border-color:var(--success)"><h2>\uD83D\uDEE1\uFE0F Diversification</h2><div class="mini" style="color:var(--success)">\u2705 No single position &gt;20% and no sector &gt;40%. Portfolio looks reasonably diversified.</div></div>`;
    return;
  }
  box.innerHTML = `<div class="sec" style="border-color:var(--warn)"><h2>\u26A0\uFE0F Concentration Warnings</h2>${warns.map((w) => `<div style="margin-bottom:6px;font-size:13px">${w}</div>`).join("")}</div>`;
}

// ---------- rendering ----------
let CH_break = null,
  CH_dashAlloc = null,
  sortState = {};
/* robustness: global error boundary */
window.addEventListener("error", function (e) {
  try {
    if (typeof toast === "function")
      toast("Unexpected error: " + (e.message || "see console"), "err", 6000);
  } catch (_) {}
});
window.addEventListener("unhandledrejection", function (e) {
  try {
    var r = e && e.reason;
    if (typeof toast === "function")
      toast(
        "Background task failed: " + ((r && r.message) || r || "see console"),
        "warn",
        5000,
      );
  } catch (_) {}
});

function render() {
  try {
    const { pos, enriched } = runFIFO();
    const arr = Object.values(pos);
    const totals = arr.reduce(
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
    renderKPIs(totals, arr);
    renderCharts(arr, totals);
    renderPositions(arr, totals);
    renderSignals();
    renderDividends(pos);
    renderDashDivs(pos);
    renderTxns(enriched);
    renderTickerList();
    renderRecentlySold();
    renderRecentlyBought();
    renderTaxSummary();
    renderConcentration();
    renderHistory();
    renderPendingBanner();
    // Refresh the Pending table too, so its live-price column (which reads
    // M[ticker].price) updates when prices change via a TradingView paste,
    // an OPCVM file, or a manual "Set price". Previously only the banner
    // refreshed here and the table kept a stale live price until the next
    // pending-specific action. renderPending() guards on missing DOM, so
    // it's a no-op when the Pending tab isn't mounted.
    if (typeof renderPending === "function") renderPending();
    renderMissingMaster();
  } catch (err) {
    console.error("render() failed:", err);
    if (typeof toast === "function")
      toast(
        "Something went wrong while updating the view: " +
          ((err && err.message) || err),
        "err",
        6000,
      );
  }
}
function kpi(label, val, cls2, tip, nav) {
  const clickable = nav
    ? ` data-act="gotoTab" data-args="${nav}" style="cursor:pointer"`
    : tip
      ? ' style="cursor:help"'
      : "";
  return `<div class="card nis-cell"${clickable} data-tip="${tip ? tipRef(tip) : ""}"><div class="label">${label}${nav ? ' <span style="opacity:.5">\u2197</span>' : ""}</div><div class="value ${cls2 || ""}">${val}</div></div>`;
}
function gotoTab(v) {
  const b = document.querySelector('.tab[data-view="' + v + '"]');
  if (b) b.click();
}
// Fee-inclusive cost of pending BUY orders (all accounts). Mirrors the cash
// tab's calculation: uses computeRow for accurate brokerage-inclusive cost,
// falling back to gross qty\u00D7price if computeRow throws.
function pendingBuyCost() {
  let cost = 0;
  const list = Array.isArray(PENDING) ? PENDING : [];
  list.forEach((o) => {
    if (o.action !== "BUY") return;
    try {
      const rr = computeRow({
        action: "BUY",
        ticker: o.ticker,
        qty: o.qty,
        price: o.price,
        pea: o.pea,
        opcvm: o.opcvm,
        total: o.total,
      });
      cost += Math.abs(rr.net) || 0;
    } catch (_e) {
      cost += (o.qty || 0) * (o.price || 0);
    }
  });
  return cost;
}
// Dashboard "Cash available" across ALL accounts. Mirrors the Cash tab's
// all-accounts view: user cash movements (deposits +, withdrawals/fees -, only
// dated today or earlier) + trading cash flow from every account EXCEPT
// saham-regular (bank-funded, so its trades don't consume brokerage cash),
// minus the fee-inclusive cost of pending BUY orders. Kept in sync with the
// Cash tab's "all" branch (js/08-salary.js).
function dashCashAvailable(enriched) {
  let bal = 0;
  try {
    const _today = new Date().toISOString().slice(0, 10);
    const mov = typeof loadCash === "function" ? loadCash() : [];
    (Array.isArray(mov) ? mov : []).forEach((m) => {
      if (!m || m.date > _today) return; // ignore future-dated movements
      const sign = m.type === "deposit" ? 1 : -1;
      bal += Math.abs(m.amount || 0) * sign;
    });
    let tradingCash = 0;
    (Array.isArray(enriched) ? enriched : []).forEach((e) => {
      if (typeof e.net !== "number" || e.date > _today) return;
      // exclude saham-regular (bank-funded) - matches the Cash tab.
      if (txnBroker(e) === "saham" && !e.pea) return;
      tradingCash += e.net;
    });
    bal += tradingCash;
  } catch (_e) {}
  return bal - pendingBuyCost();
}

// Dashboard dividend estimates. Reuses the Dividends-tab per-dividend math
// (eligibleSharesAtEx + divNetFor) over the calendar PLUS forecast gap-fill
// events from the core module (__core.dividendForecast.projectedCalendar):
// unannounced current-year dividends for tickers that paid in past years, and
// next-year projections. Real announced events always take precedence.
// Returns { d90 } = net eligible dividends due within ~90 days (includes
// forecast fill-ins for dividends not yet announced but paid in prior years).
function dashDivEstimates() {
  const res = { d90: 0 };
  try {
    if (typeof DIVCAL === "undefined" || !Array.isArray(DIVCAL)) return res;
    const yr = new Date().getFullYear();
    let fcEvents = [];
    try {
      if (
        typeof __core !== "undefined" &&
        __core.dividendForecast &&
        typeof __core.dividendForecast.projectedCalendar === "function"
      ) {
        const _rec =
          typeof TXNS !== "undefined" && Array.isArray(TXNS)
            ? TXNS.filter((t) => t.action === "DIV" && t.date).map((t) => {
                const dt = new Date(t.date);
                return {
                  ticker: t.ticker,
                  year: dt.getFullYear(),
                  month: dt.getMonth() + 1,
                };
              })
            : [];
        fcEvents = __core.dividendForecast.projectedCalendar(DIVCAL, yr, {
          windowYears: 3,
          currentMonth: new Date().getMonth() + 1,
          recorded: _rec,
        });
      }
    } catch (_e2) {}
    const cal = DIVCAL.concat(fcEvents);
    for (const d of cal) {
      if (!d.pay_date) continue;
      const sh =
        typeof eligibleSharesAtEx === "function" ? eligibleSharesAtEx(d) : 0;
      if (sh <= 0) continue;
      const du = typeof daysUntil === "function" ? daysUntil(d.pay_date) : -1;
      if (du < 0) continue;
      if (du > 90) continue;
      res.d90 += typeof divNetFor === "function" ? divNetFor(d, sh) : 0;
    }
  } catch (_e) {}
  return res;
}
// Back-compat thin wrapper: next-3-months net estimate.
function dashUpcomingDiv3mo() {
  return dashDivEstimates().d90;
}

// Single entry point to refresh the Dashboard KPI row from live data. Recomputes
// the position totals from runFIFO() and re-renders #kpiRow. Called by render()
// AND by savePending() so the KPI cards that depend on PENDING (Cash Available,
// Pending Orders, Upcoming Dividends) update the moment an order changes - not
// only when the whole dashboard re-renders. Guards so a pending mutation on
// another tab can never throw.
function refreshKpiRow() {
  try {
    if (typeof runFIFO !== "function") return;
    const { pos } = runFIFO();
    const arr = Object.values(pos);
    const totals = arr.reduce(
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
      { inv: 0, val: 0, net: 0, unreal: 0, real: 0, div: 0, life: 0, cost: 0 },
    );
    renderKPIs(totals, arr);
  } catch (_e) {}
}

function renderKPIs(t, arr) {
  const T = (title, lines) =>
    `<div style="font-weight:700;margin-bottom:6px">${title}</div>` +
    lines.map((l) => `<div>${l}</div>`).join("");
  const _pendCost = pendingBuyCost();
  // Split held market value into stocks vs OPCVM funds (by master category).
  let _stockVal = 0,
    _opcvmVal = 0;
  (Array.isArray(arr) ? arr : []).forEach((p) => {
    if (!(p.held > 0 && p.value > 0)) return;
    if (M[p.ticker] && M[p.ticker].cat === "OPCVM") _opcvmVal += p.value;
    else _stockVal += p.value;
  });
  const _cashAvail = dashCashAvailable(
    (typeof runFIFO === "function" && runFIFO().enriched) || [],
  );
  const _divEst = dashDivEstimates();
  const _upDiv3 = _divEst.d90;
  const _kpiEl = document.getElementById("kpiRow");
  if (!_kpiEl) return; // dashboard not in DOM - nothing to update
  _kpiEl.innerHTML =
    kpi(
      "Cash Available",
      money(_cashAvail, 0) + " MAD",
      _cashAvail >= 0 ? "" : "neg",
      T("Cash Available (all accounts)", [
        "Cash movements (deposits \u2212 withdrawals \u2212 fees)",
        "plus trading cash flow, minus committed pending buys.",
        "Excludes the bank-funded Saham regular account.",
      ]),
      "cash",
    ) +
    kpi(
      "Pending Orders",
      money(_pendCost, 0) + " MAD",
      _pendCost > 0 ? "neg" : "",
      T("Pending Orders (committed)", [
        "Fee-inclusive cost of your pending BUY orders",
        "= \u03A3 (gross + brokerage fees) across all accounts",
        "Not yet executed \u2014 this cash is committed.",
      ]),
      "pending",
    ) +
    kpi(
      "Stock Value",
      money(_stockVal, 0) + " MAD",
      "",
      T("Stock Value", [
        "Current market value of your held STOCK positions",
        "(non-OPCVM), across all accounts.",
        "= \u03A3 (shares \u00D7 live price).",
      ]),
      "positions",
    ) +
    kpi(
      "OPCVM Value",
      money(_opcvmVal, 0) + " MAD",
      "",
      T("OPCVM Value", [
        "Current market value of your held OPCVM funds,",
        "across all accounts.",
        "= \u03A3 (units \u00D7 latest NAV).",
      ]),
      "positions",
    ) +
    kpi(
      "Unrealized P&L",
      money(t.unreal, 0) + " MAD",
      cls(t.unreal),
      T("Unrealized P&L", [
        "= Current Value \u2212 Invested",
        "Paper gain/loss on open positions",
        "(before exit fees & tax).",
      ]),
      "positions",
    ) +
    kpi(
      "Dividends",
      money(t.div, 0) + " MAD",
      t.div > 0 ? "pos" : "",
      T("Dividends Received", [
        "Total cash dividends collected",
        "Net of dividend withholding tax.",
        "Persists even after you sell out.",
      ]),
      "dividends",
    ) +
    kpi(
      "Upcoming Dividends",
      money(_upDiv3, 0) + " MAD",
      _upDiv3 > 0 ? "pos" : "",
      T("Upcoming Dividends (next 3 months)", [
        "Estimated NET dividends due in the next ~90 days,",
        "on shares eligible at the ex-date.",
        "Includes forecast fill-ins for dividends not yet",
        "announced but paid in prior years.",
      ]),
      "dividends",
    );
}
// ---- Dashboard hero strip (portfolio value + lifetime return verdict) ----
function renderHero(t) {
  const el = document.getElementById("dashHero");
  if (!el) return;
  const roi = t.cost > 1e-9 ? t.life / t.cost : 0;
  const verdict =
    t.life > 0
      ? '<span class="pos">\u25B2 in profit</span>'
      : t.life < 0
        ? '<span class="neg">\u25BC in loss</span>'
        : "flat";
  el.innerHTML =
    '<div class="hero-main">' +
    '<div class="hero-label">Portfolio value</div>' +
    '<div class="hero-value">' +
    money(t.val, 0) +
    ' <span style="font-size:16px;color:var(--text2)">MAD</span></div>' +
    '<div class="hero-sub">Lifetime return <b class="' +
    cls(t.life) +
    '">' +
    (t.life >= 0 ? "+" : "") +
    money(t.life, 0) +
    " MAD</b> (" +
    pct(roi) +
    ") \u00B7 " +
    verdict +
    "</div></div>" +
    '<div class="hero-card"><div class="k">Invested (held)</div><div class="v">' +
    money(t.inv, 0) +
    '</div><div class="mini">unrealized <span class="' +
    cls(t.unreal) +
    '">' +
    (t.unreal >= 0 ? "+" : "") +
    money(t.unreal, 0) +
    "</span></div></div>" +
    '<div class="hero-card"><div class="k">Realized + Dividends</div><div class="v">' +
    money(t.real + t.div, 0) +
    '</div><div class="mini">realized ' +
    money(t.real, 0) +
    " \u00B7 div " +
    money(t.div, 0) +
    "</div></div>";
}

// ---- Allocation by sector as weight bars ----
function renderDashAllocBars(arr) {
  const el = document.getElementById("dashAllocBars");
  if (!el) return;
  const held = arr.filter((p) => p.held > 0 && p.value > 0);
  const byCat = {};
  held.forEach((p) => {
    const cat = (M[p.ticker] && M[p.ticker].cat) || "Uncategorized";
    byCat[cat] = (byCat[cat] || 0) + p.value;
  });
  const data = Object.keys(byCat)
    .map((k) => ({ name: k, y: +byCat[k].toFixed(2) }))
    .sort((a, b) => b.y - a.y);
  if (!data.length) {
    if (CH_dashAlloc) {
      CH_dashAlloc.destroy();
      CH_dashAlloc = null;
    }
    el.innerHTML = '<div class="mini">No holdings yet.</div>';
    return;
  }
  // Pie chart (compact regardless of sector count) instead of stacked weight
  // bars, which grew very tall with many sectors. No legend: with many sectors
  // the legend paginated (the "1/3" page indicator rendered black/invisible in
  // dark mode). Instead the pie fills the space and each slice is labelled with
  // its sector name + %; the tooltip gives the MAD value.
  el.innerHTML = "";
  el.style.height = "300px";
  el.style.minHeight = "300px";
  const tx = themeColor("text");
  try {
    CH_dashAlloc = Highcharts.chart(el, {
      chart: { type: "pie", backgroundColor: "transparent", height: 300 },
      title: { text: null },
      credits: { enabled: false },
      legend: { enabled: false },
      tooltip: {
        pointFormat: "<b>{point.y:,.0f} MAD</b> ({point.percentage:.1f}%)",
      },
      plotOptions: {
        pie: {
          innerSize: "50%",
          size: "88%",
          borderWidth: 1,
          borderColor: themeColor("panel") || "transparent",
          dataLabels: {
            enabled: true,
            style: { color: tx, fontSize: "10px", textOutline: "none" },
            // Show the sector name + % on larger slices; % only on small ones
            // so labels don't overlap.
            formatter: function () {
              return this.percentage >= 6
                ? this.point.name + ": " + this.percentage.toFixed(0) + "%"
                : this.percentage.toFixed(0) + "%";
            },
            distance: 10,
            connectorWidth: 1,
          },
        },
      },
      series: [{ name: "Value", data: data }],
    });
  } catch (e) {
    console.error("dashAlloc", e);
  }
}

// ---- Income outlook (forward dividends 90d / 12mo + received YTD) ----
function renderDashIncomeOutlook() {
  const el = document.getElementById("dashIncomeOutlook");
  if (!el) return;
  let inc90 = 0,
    inc12 = 0,
    received = 0;
  const yrNow = TODAY.getFullYear();
  for (const d of DIVCAL) {
    if (!d.pay_date) continue;
    const sh = eligibleSharesAtEx(d);
    if (sh <= 0) continue;
    const du = daysUntil(d.pay_date);
    if (du < 0 && (du < -30 || divRecorded(d))) continue;
    const net = divNetFor(d, sh);
    if (du <= 90) inc90 += net;
    if (du <= 365) inc12 += net;
  }
  for (const t of TXNS) {
    if (t.action === "DIV" && new Date(t.date).getFullYear() === yrNow)
      received += computeRow(t, 0).net;
  }
  el.innerHTML =
    `<div class="io-item"><span>Next 90 days</span><span class="io-v pos">${money(inc90, 0)}</span></div>` +
    `<div class="io-item"><span>Next 12 months</span><span class="io-v pos">${money(inc12, 0)}</span></div>` +
    `<div class="io-item"><span>Received in ${yrNow}</span><span class="io-v">${money(received, 0)}</span></div>` +
    `<div class="mini" style="margin-top:8px">Net of fees &amp; dividend tax (PEA exempt), on shares eligible at ex-date.</div>`;
}

// ---- Top contributors / detractors (OPCVM toggled per section) ----
function _moverRowsHTML(rows) {
  return rows.length
    ? rows
        .map(
          (x, i) =>
            `<div class="mover"><span class="rank">${i + 1}</span><span class="nm"><b>${escapeHtml(x.ticker)}</b> <span class="mini">${escapeHtml(x.name || "")}</span></span><span class="amt ${cls(x.life)}">${x.life >= 0 ? "+" : ""}${money(x.life, 0)}</span></div>`,
        )
        .join("")
    : '<div class="mini">Nothing here yet.</div>';
}
function renderDashMovers(arr) {
  const incC = !!(document.getElementById("contribOpcvm") || {}).checked;
  const incD = !!(document.getElementById("detractOpcvm") || {}).checked;
  const byTk = {};
  arr.forEach((p) => {
    if (Math.abs(p.lifetime) <= 1e-6) return;
    const isFund = !!(M[p.ticker] && M[p.ticker].cat === "OPCVM");
    byTk[p.ticker] = byTk[p.ticker] || {
      ticker: p.ticker,
      name: p.name,
      life: 0,
      isFund,
    };
    byTk[p.ticker].life += p.lifetime;
  });
  const all = Object.values(byTk);
  const contrib = all
    .filter((x) => x.life > 0 && (incC || !x.isFund))
    .sort((a, b) => b.life - a.life)
    .slice(0, 6);
  const detract = all
    .filter((x) => x.life < 0 && (incD || !x.isFund))
    .sort((a, b) => a.life - b.life)
    .slice(0, 6);
  const c = document.getElementById("dashTopContrib"),
    d = document.getElementById("dashTopDetract");
  if (c) c.innerHTML = _moverRowsHTML(contrib);
  if (d) d.innerHTML = _moverRowsHTML(detract);
}

function renderCharts(arr, t) {
  renderHero(t);
  renderDashAllocBars(arr);
  renderDashMovers(arr);
  renderDashIncomeOutlook();
  const tx = themeColor("text");
  const tx2 = themeColor("text2");
  CH_break = Highcharts.chart("breakChart", {
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
          { name: "Unrealized", y: Math.round(t.unreal) },
          { name: "Realized", y: Math.round(t.real) },
          { name: "Dividends", y: Math.round(t.div) },
          { name: "Lifetime", isSum: true, color: themeColor("primary") },
        ],
      },
    ],
  });
}
function sortArr(arr, key) {
  const s = (sortState[key] = sortState[key] === 1 ? -1 : 1);
  arr.sort((a, b) => {
    let x = a[key],
      y = b[key];
    if (typeof x === "string") return s * x.localeCompare(y);
    return s * ((x || 0) - (y || 0));
  });
  return arr;
}
function dispName(tk) {
  const m = M[tk];
  return m && m.cat === "OPCVM" && m.name ? m.name : tk;
}

function unrealTipHTML(p) {
  const row = (l, v, cl) =>
    `<div style="display:flex;justify-content:space-between;gap:20px"><span>${l}</span><span class="${cl || ""}" style="font-family:var(--mono)">${v}</span></div>`;
  let h = `<div style="font-weight:700;margin-bottom:6px">Unrealized P&L \u00B7 ${p.ticker}</div>`;
  h += row(
    "Current value (" +
      money(p.held, p.held % 1 ? 3 : 0) +
      " \u00D7 " +
      money(p.price) +
      ")",
    money(p.value) + " MAD",
  );
  h += row(
    "\u2212 Invested (" +
      money(p.held, p.held % 1 ? 3 : 0) +
      " \u00D7 avg " +
      money(p.avg) +
      ")",
    money(p.invested),
  );
  h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>`;
  h += row(
    "<b>= Unrealized P&L</b>",
    "<b>" + money(p.unreal) + " MAD</b>",
    cls(p.unreal),
  );
  h += `<div class="mini" style="margin-top:6px">Paper gain/loss on shares still held (before exit fees/tax). Avg cost is FIFO, incl. buy fees.</div>`;
  return h;
}
function lifetimeTipHTML(p) {
  const row = (l, v, cl) =>
    `<div style="display:flex;justify-content:space-between;gap:20px"><span>${l}</span><span class="${cl || ""}" style="font-family:var(--mono)">${v}</span></div>`;
  let h = `<div style="font-weight:700;margin-bottom:6px">Lifetime Return \u00B7 ${p.ticker} (${p.account})</div>`;
  h += row("Unrealized (open shares)", money(p.unreal), cls(p.unreal));
  h += row("+ Realized (from sells, FIFO)", money(p.realized), cls(p.realized));
  h += row("+ Dividends received", money(p.divs), p.divs > 0 ? "pos" : "");
  h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>`;
  h += row(
    "<b>= Lifetime Return</b>",
    "<b>" + money(p.lifetime) + " MAD</b>",
    cls(p.lifetime),
  );
  h += row(
    "vs. capital deployed (" + money(p.costBasis) + ")",
    pct(p.lifepct),
    cls(p.lifepct),
  );
  return h;
}

function realizedTipHTML(p) {
  const row = _tipRow; // shared tooltip row builder (gap:18px)
  let h = `<div style="font-weight:700;margin-bottom:6px">Realized P&L \u00B7 ${p.ticker} (${p.account})</div>`;
  if (!p.realizedDetail || !p.realizedDetail.length) {
    h += '<div class="mini">No sells yet.</div>';
    return h;
  }
  h += `<div style="color:var(--text2);font-size:11px;margin-bottom:2px">Each sell: proceeds \u2212 FIFO matched cost:</div>`;
  p.realizedDetail.forEach((d) => {
    h += row(
      d.date +
        " \u00B7 sold " +
        money(d.qty, d.qty % 1 ? 3 : 0) +
        " @ " +
        money(d.price),
      (d.gain >= 0 ? "+" : "") + money(d.gain),
      cls(d.gain),
    );
  });
  h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>`;
  h += row(
    "<b>Total Realized</b>",
    "<b>" + money(p.realized) + " MAD</b>",
    cls(p.realized),
  );
  h += `<div class="mini" style="margin-top:6px">Net of fees & TPCVM tax${p.isPea ? " (PEA exempt)" : ""}. Cost is FIFO (oldest lots first).</div>`;
  return h;
}
function divTipHTML(p) {
  const row = _tipRow; // shared tooltip row builder (gap:18px)
  let h = `<div style="font-weight:700;margin-bottom:6px">Dividends \u00B7 ${p.ticker} (${p.account})</div>`;
  if (!p.divDetail || !p.divDetail.length) {
    h += '<div class="mini">No dividends received.</div>';
    return h;
  }
  p.divDetail.forEach((d) => {
    h += `<div style="margin-bottom:4px"><b>${d.date}</b> \u00B7 ${money(d.qty, d.qty % 1 ? 3 : 0)} sh @ ${money(d.perShare)}/sh</div>`;
    h += row(
      "&nbsp;&nbsp;Gross",
      money(d.gross != null ? d.gross : d.qty * d.perShare),
    );
    if (d.fees != null && d.fees > 0)
      h += row("&nbsp;&nbsp;\u2212 Fees", "\u2212" + money(d.fees));
    if (d.pea) h += row("&nbsp;&nbsp;Dividend tax", "0 (PEA exempt)", "pos");
    else if (d.tax != null)
      h += row("&nbsp;&nbsp;\u2212 Dividend tax", "\u2212" + money(d.tax));
    h += row(
      "&nbsp;&nbsp;<b>Net received</b>",
      "<b>+" + money(d.net) + "</b>",
      "pos",
    );
  });
  h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>`;
  h += row("<b>Total Dividends</b>", "<b>" + money(p.divs) + " MAD</b>", "pos");
  h += `<div class="mini" style="margin-top:6px">Net of dividend withholding tax.</div>`;
  return h;
}

// "Net if sold" tooltip. A position may span multiple accounts (e.g. PEA at
// Attijari + Regular at Saham). Each account has its OWN broker/fee structure,
// so we render a per-account split (one block per account) instead of forcing a
// single broker. Single-account positions render one block, unchanged.
function netIfSoldTipHTML(p) {
  // _tipParts = the per-account sub-positions that contribute a netIfSold
  // (set by mergePositions). Absent for already-single-account positions.
  const parts =
    p._tipParts && p._tipParts.length
      ? p._tipParts
      : p.children && p.children.length
        ? p.children.filter((c) => c.netIfSold != null && c.value > 0)
        : null;
  if (parts && parts.length > 1) {
    let combNet = 0,
      combFees = 0,
      combTax = 0;
    const blocks = parts
      .slice()
      .sort((a, b) => (a.isPea ? 0 : 1) - (b.isPea ? 0 : 1))
      .map((c) => {
        combNet += c.netIfSold || 0;
        combFees += c.sellFees || 0;
        combTax += c.sellTax || 0;
        const bkName =
          (BROKERS[c.broker] && BROKERS[c.broker].name) ||
          (c.isPea ? "Attijari" : "Saham");
        return (
          `<div style="font-weight:700;margin:2px 0 4px;color:var(--info)">${escapeHtml(c.account)} \u00B7 ${escapeHtml(bkName)}</div>` +
          _nisSingle(c, true)
        );
      })
      .join(
        '<div style="border-top:1px solid var(--border);margin:7px 0"></div>',
      );
    return (
      blocks +
      `<div style="border-top:2px solid var(--border);margin:8px 0 4px"></div>` +
      `<div style="display:flex;justify-content:space-between;gap:20px;font-weight:700"><span>Combined net if sold</span><span style="font-family:var(--mono)">${money(combNet)} MAD</span></div>` +
      `<div style="display:flex;justify-content:space-between;gap:20px;color:var(--text2)"><span class="mini">Total fees / tax across accounts</span><span class="mini" style="font-family:var(--mono)">\u2212${money(combFees)} / \u2212${money(combTax)}</span></div>`
    );
  }
  // Single account: render the one contributing sub-position if present so the
  // broker/fees always match where the shares actually sit.
  const only = parts && parts.length === 1 ? parts[0] : p;
  return _nisSingle(only, false);
}

// Single-account "net if sold" breakdown for position `p`. `compact` trims the
// header (used when rendered inside a per-account split block).
function _nisSingle(p, compact) {
  // Itemized breakdown: gross -> each fee component -> tax -> net
  const gross = p.value;
  const tax = p.sellTax || 0;
  const row = (l, v, cl) =>
    `<div style="display:flex;justify-content:space-between;gap:20px"><span>${l}</span><span class="${cl || ""}" style="font-family:var(--mono)">${v}</span></div>`;
  const pctOf = (r) => (r * 100).toFixed(3).replace(/\.?0+$/, "") + "%";
  const meta = M[p.ticker];
  const isOpcvm = !!(meta && meta.cat === "OPCVM");
  let h = compact
    ? ""
    : `<div style="font-weight:700;margin-bottom:6px">If sold today \u00B7 ${escapeHtml(p.account)} account</div>`;
  h += row("Gross (market value)", money(gross) + " MAD");
  if (isOpcvm) {
    const sf = meta.sellFee != null ? meta.sellFee : null;
    // Split the stored total sell fee (from computeRow \u2192 opcvmFee) into its parts:
    // fund redemption % on gross, plus the flat Attijari order surcharge (\u224811 MAD).
    const surcharge = opcvmSurcharge();
    const fundFee = Math.max(0, (p.sellFees || 0) - surcharge);
    h += `<div style="color:var(--text2);margin:4px 0 2px;font-size:11px">Redemption fee:</div>`;
    h += row(
      '&nbsp;&nbsp;Commission de rachat <span class="mini">(' +
        (sf != null ? pctOf(sf) : "not imported") +
        ")</span>",
      "\u2212" + money(fundFee),
    );
    if (surcharge > 0)
      h += row(
        '&nbsp;&nbsp;Frais d\'ordre <span class="mini">(Attijari, 10 + VAT)</span>',
        "\u2212" + money(surcharge),
      );
  } else {
    // Broker-aware stock fee breakdown (Attijari courtage/r\u00E8gl/bourse vs Saham
    // market/interm\u00E9d/r\u00E8gl + fixed courrier). Use the SAME broker the core
    // used for the netIfSold number (p.broker, always set by runFIFO). Fall back on
    // the account type (PEA -> attijari) - NOT the fund flag - so PEA stocks show
    // Attijari fees, matching the actual sell-fee calculation.
    const _bk =
      BROKERS[p.broker] || BROKERS[p.isPea ? "attijari" : "saham"] || null;
    const _f = _bk && _bk.fees ? _bk.fees : null;
    const _vat = vatRate();
    h += `<div style="color:var(--text2);margin:4px 0 2px;font-size:11px">Trading fees (incl. ${(_vat * 100).toFixed(0)}% VAT):</div>`;
    if (_bk && _bk.feeType === "pea" && _f) {
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
      const _cm = _f && _f.c_marche != null ? _f.c_marche : FP.c_marche;
      const _ci = _f && _f.c_interm != null ? _f.c_interm : FP.c_interm;
      const _cr = _f && _f.c_regl != null ? _f.c_regl : FP.c_regl;
      const _courier = _f && _f.courier != null ? _f.courier : FP.courier;
      h += row(
        '&nbsp;&nbsp;Commission de march\u00E9 <span class="mini">(' +
          pctOf(_cm) +
          ")</span>",
        "\u2212" + money(gross * _cm * (1 + _vat)),
      );
      h += row(
        '&nbsp;&nbsp;Commission d\'interm\u00E9diation <span class="mini">(' +
          pctOf(_ci) +
          ")</span>",
        "\u2212" + money(gross * _ci * (1 + _vat)),
      );
      h += row(
        '&nbsp;&nbsp;Commission r\u00E8gl./livraison <span class="mini">(' +
          pctOf(_cr) +
          ")</span>",
        "\u2212" + money(gross * _cr * (1 + _vat)),
      );
      h += row(
        '&nbsp;&nbsp;Frais de courrier <span class="mini">(fixed)</span>',
        "\u2212" + money(_courier * (1 + _vat)),
      );
    }
    h += row(
      "&nbsp;&nbsp;<b>Total fees</b>",
      "<b>\u2212" + money(p.sellFees || 0) + "</b>",
    );
  }
  h += p.isPea
    ? row('Cap-gains tax <span class="mini">(PEA exempt)</span>', "0", "pos")
    : row(
        'TPCVM cap-gains tax <span class="mini">(' +
          pctOf(FP.tpcvm) +
          " on gain)</span>",
        "\u2212" + money(tax),
      );
  h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>`;
  h += row("<b>Net proceeds</b>", "<b>" + money(p.netIfSold) + " MAD</b>");
  h += row("Per share", money(p.netIfSoldPS));
  return h;
}

function posChips(p) {
  return `${p.acctList ? (p.acctList.length > 1 ? ' <span class="chip" data-tip="Combined: PEA + Regular" style="background:rgba(139,92,246,.16);color:#a78bfa;cursor:help">PEA+Reg</span>' : p.acctList[0] === "PEA" ? ' <span class="chip" style="background:rgba(56,189,248,.15);color:var(--info)">PEA</span>' : '<span class="chip" style="background:var(--panel2);color:var(--muted)">REG</span>') : p.isPea ? ' <span class="chip" style="background:rgba(56,189,248,.15);color:var(--info)">PEA</span>' : '<span class="chip" style="background:var(--panel2);color:var(--muted)">REG</span>'}${(function () {
    const pd = PENDING.filter((o) => o.ticker === p.ticker);
    if (!pd.length) return "";
    const nb = pd.filter((o) => o.action === "BUY").length,
      ns = pd.filter((o) => o.action === "SELL").length;
    const lbl =
      "\u23f3 " +
      (nb ? nb + "B" : "") +
      (nb && ns ? "/" : "") +
      (ns ? ns + "S" : "");
    return (
      ' <span class="chip" style="background:rgba(245,166,35,.15);color:var(--warn)" data-tip="Pending orders for this ticker">' +
      lbl +
      "</span>"
    );
  })()}`;
}
// Cells AFTER the ticker cell (name \u2192 status). Shared by parent and per-account child rows.
function posCells(p, showDivY) {
  const divCls = p.divs > 0 ? "pos" : "";
  const priceCell =
    p.held > 0
      ? `<td class="right" data-tip="Click to edit price" style="cursor:pointer;color:var(--info)" data-act="editPrice" data-args="${p.ticker}">${p.price != null ? money(p.price) : "set"} \u270e</td>`
      : `<td>${p.price != null ? money(p.price) : "\u2014"}</td>`;
  return `<td class="l" style="color:var(--text2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer" data-tip="Click for return waterfall" data-act="showPosWaterfall" data-args="${p.key}">${escapeHtml((M[p.ticker] && M[p.ticker].name) || "")} <span style="color:var(--muted)">\ud83d\udcca</span></td><td>${money(p.held, p.held % 1 ? 3 : 0)}</td><td>${money(p.avg)}</td>
    <td>${p.held > 0 ? money(p.invested) : "\u2014"}</td>${priceCell}
    <td>${p.held > 0 ? money(p.value) : "\u2014"}</td><td class="nis-cell" style="${p.netIfSold != null ? "cursor:help" : ""}" data-tip="${p.netIfSold != null ? tipRef(netIfSoldTipHTML(p)) : ""}">${p.netIfSold != null ? money(p.netIfSold) : "\u2014"}</td><td class="${cls(p.unreal)} ${p.held > 0 ? "nis-cell" : ""}" style="${p.held > 0 ? "cursor:help" : ""}" data-tip="${p.held > 0 ? tipRef(unrealTipHTML(p)) : ""}">${p.held > 0 ? money(p.unreal) : "\u2014"}</td>
    <td class="${cls(p.realized)} ${p.realizedDetail && p.realizedDetail.length ? "nis-cell" : ""}" style="${p.realizedDetail && p.realizedDetail.length ? "cursor:help" : ""}" data-tip="${p.realizedDetail && p.realizedDetail.length ? tipRef(realizedTipHTML(p)) : ""}">${money(p.realized)}</td><td class="${divCls} ${p.divDetail && p.divDetail.length ? "nis-cell" : ""}" style="${p.divDetail && p.divDetail.length ? "cursor:help" : ""}" data-tip="${p.divDetail && p.divDetail.length ? tipRef(divTipHTML(p)) : ""}">${money(p.divs)}</td>
    <td class="${cls(p.lifetime)} nis-cell" style="cursor:help" data-tip="${tipRef(lifetimeTipHTML(p))}"><b>${money(p.lifetime)}</b></td><td class="${cls(p.lifepct)}">${pct(p.lifepct)}</td>
    ${
      showDivY
        ? (function () {
            const _m = M[p.ticker];
            const _dy = _m && _m.divy != null ? _m.divy : null;
            if (_dy == null)
              return '<td style="color:var(--muted)">\u2014</td>';
            const _r = {
              ticker: p.ticker,
              m: _m,
              price: _m && _m.price != null ? _m.price : p.price,
              divy: _dy,
            };
            return (
              '<td class="nis-cell ' +
              (_dy > 0 ? "pos" : "") +
              '" style="cursor:help" data-tip="' +
              tipRef(divyTipHTML(_r)) +
              '">' +
              pct(_dy) +
              "</td>"
            );
          })()
        : ""
    }
    <td class="center"><span class="st-${p.status === "Closed" ? "closed" : "open"}">${p.status}</span></td>`;
}
function posRow(p, showDivY) {
  const expandable = COMBINE_ACCT && p.children && p.children.length > 1;
  const rowId = expandable
    ? "cmb_" + String(p.ticker).replace(/[^A-Za-z0-9]/g, "")
    : "";
  const caret = expandable
    ? `<span class="pos-caret" data-tip="Show PEA / Regular breakdown" style="cursor:pointer;color:var(--muted);display:inline-block;width:12px" data-act="togglePosChildren" data-args="${rowId},$el">\u25b8</span> `
    : COMBINE_ACCT
      ? '<span style="display:inline-block;width:12px"></span> '
      : "";
  const parent = `<tr${expandable ? ' data-cmb="' + rowId + '"' : ""}>
    <td class="l">${caret}${tickerBadge(p.ticker)}<b>${p.ticker}</b>${posChips(p)}</td>${posCells(p, showDivY)}</tr>`;
  if (!expandable) return parent;
  // Per-account child rows (hidden by default). Reuse posCells; give them a REG/PEA chip and indented ticker.
  const kids = p.children
    .map((c) => {
      const cc = { ...c, acctList: [c.isPea ? "PEA" : "Regular"] };
      return `<tr class="pos-child ${rowId}" style="display:none;background:rgba(139,92,246,.04)">
      <td class="l" style="padding-left:26px;color:var(--text2)"><span style="opacity:.6">\u21b3</span> <b style="font-weight:600">${c.ticker}</b>${posChips(cc)}</td>${posCells(c, showDivY)}</tr>`;
    })
    .join("");
  return parent + kids;
}
function sectionHeader(label) {
  return `<tr><td class="l" colspan="14" style="background:var(--panel2);color:var(--text2);font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:7px 10px">${label}</td></tr>`;
}
// Sort: Open/Partial before Closed, then by current sort key (default lifetime desc)
function posSort(a, b) {
  const oa = a.status === "Closed" ? 1 : 0,
    ob = b.status === "Closed" ? 1 : 0;
  if (oa !== ob) return oa - ob;
  if (POS_SORT.k) {
    let x = a[POS_SORT.k],
      y = b[POS_SORT.k];
    if (typeof x === "string")
      return POS_SORT.d * String(x).localeCompare(String(y));
    return POS_SORT.d * ((x || 0) - (y || 0));
  }
  return b.lifetime - a.lifetime;
}
let POS_SORT = { k: null, d: -1 };
function subtotalRow(label, rows) {
  const s = rows.reduce(
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
  return `<tr style="border-top:1px solid var(--border)"><td class="l" style="color:var(--text2)"><i>${label} subtotal</i></td>
    <td></td><td></td><td></td><td>${money(s.inv)}</td><td></td><td>${money(s.val)}</td><td>${money(s.net)}</td>
    <td class="${cls(s.unreal)}">${money(s.unreal)}</td><td class="${cls(s.real)}">${money(s.real)}</td>
    <td class="${s.div > 0 ? "pos" : ""}">${money(s.div)}</td><td class="${cls(s.life)}">${money(s.life)}</td><td></td><td></td></tr>`;
}
let HIDE_CLOSED = true;
// Positions tab: group stocks under sector headers. Persisted so the user's
// last choice survives a refresh (and rides in backup via casa_group_sector_v1).
let GROUP_SECTOR = (() => {
  try {
    return localStorage.getItem("casa_group_sector_v1") === "1";
  } catch (e) {
    return false;
  }
})();
function totalsOf(list) {
  return list.reduce(
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
}
function totalRowHTML(label, s, extraCell) {
  return `<tr style="border-top:2px solid var(--border)">
    <td class="l"><b>${label}</b></td><td></td><td></td><td></td><td><b>${money(s.inv)}</b></td><td></td>
    <td><b>${money(s.val)}</b></td><td><b>${money(s.net || 0)}</b></td><td class="${cls(s.unreal)}"><b>${money(s.unreal)}</b></td>
    <td class="${cls(s.real)}"><b>${money(s.real)}</b></td><td class="${s.div > 0 ? "pos" : ""}"><b>${money(s.div)}</b></td>
    <td class="${cls(s.life)}"><b>${money(s.life)}</b></td><td class="${cls(s.life)}"><b>${s.cost && s.cost > 1e-9 ? pct(s.life / s.cost) : "\u2014"}</b></td>${extraCell ? "<td></td>" : ""}<td></td></tr>`;
}
let COMBINE_ACCT = true; // always combined (per-ticker rollup with drill-down)
// Merge per-(ticker,account) positions into one row per ticker (accounts still
// computed independently by FIFO; this is a display-only rollup). Sums are
// additive so grand totals are identical whether combined or split.
function mergePositions(arr) {
  const byTk = {};
  for (const p of arr) {
    const g =
      byTk[p.ticker] ||
      (byTk[p.ticker] = {
        key: p.ticker + "||COMB",
        ticker: p.ticker,
        name: p.name,
        isFund: p.isFund,
        account: "Combined",
        isPea: false,
        _accts: new Set(),
        held: 0,
        invested: 0,
        value: 0,
        unreal: 0,
        realized: 0,
        divs: 0,
        netIfSold: 0,
        netVsValue: 0,
        sellFees: 0,
        sellTax: 0,
        costBasis: 0,
        price: p.price,
        realizedDetail: [],
        divDetail: [],
        _hasNet: false,
      });
    g._accts.add(p.account);
    if (p.held > 1e-9)
      (g._heldAccts || (g._heldAccts = new Set())).add(p.account);
    (g._children || (g._children = [])).push(p);
    g.held += p.held;
    g.invested += p.invested;
    g.value += p.value;
    g.unreal += p.unreal;
    g.realized += p.realized;
    g.divs += p.divs;
    g.costBasis += p.costBasis || 0;
    if (p.netIfSold != null) {
      g.netIfSold += p.netIfSold;
      g._hasNet = true;
    }
    if (p.netVsValue != null) g.netVsValue += p.netVsValue;
    if (p.sellFees != null) g.sellFees += p.sellFees;
    if (p.sellTax != null) g.sellTax += p.sellTax;
    if (p.realizedDetail && p.realizedDetail.length)
      g.realizedDetail = g.realizedDetail.concat(
        p.realizedDetail.map((d) => ({ ...d, account: p.account })),
      );
    if (p.divDetail && p.divDetail.length)
      g.divDetail = g.divDetail.concat(
        p.divDetail.map((d) => ({ ...d, account: p.account })),
      );
    if (g.price == null && p.price != null) g.price = p.price;
  }
  return Object.values(byTk).map((g) => {
    g.avg = g.held > 1e-9 ? g.invested / g.held : 0;
    g.lifetime = g.unreal + g.realized + g.divs;
    g.lifepct = g.costBasis > 1e-9 ? g.lifetime / g.costBasis : 0;
    if (!g._hasNet) g.netIfSold = null;
    g.netIfSoldPS =
      g.netIfSold != null && g.held > 0 ? g.netIfSold / g.held : null;
    g.status = g.held > 0 ? (g.realized !== 0 ? "Partial" : "Open") : "Closed";
    // Account chip reflects CURRENTLY-HELD accounts (not historical).
    // If Regular is fully sold and only PEA is held, chip shows PEA \u2014 but the
    // per-account breakdown still keeps both sub-rows so sold history stays visible.
    const held = g._heldAccts ? Array.from(g._heldAccts) : [];
    g.acctList = (held.length ? held : Array.from(g._accts)).sort(); // e.g. ['PEA','Regular'] or ['PEA']
    g.children = (g._children || [])
      .slice()
      .sort((a, b) => (a.isPea ? 0 : 1) - (b.isPea ? 0 : 1));
    // Per-account sub-positions that contribute a "net if sold" estimate. The
    // tooltip uses these to show a per-account fee split (each with its own
    // broker), so the main row never forces a single broker's fees.
    g._tipParts = g.children.filter((c) => c.netIfSold != null && c.value > 0);
    delete g._accts;
    delete g._heldAccts;
    delete g._hasNet;
    delete g._children;
    return g;
  });
}
// Warn when transactions reference a ticker with no master record (no price/category/fees).
// Since the embedded seed master was removed, master data comes from your backup or the
// Data-tab import \u2014 this flags anything you hold/traded that isn't populated yet.
function renderMissingMaster() {
  const box = document.getElementById("missingMasterBox");
  if (!box) return;
  const seen = {};
  (TXNS || []).forEach((t) => {
    const tk = t.ticker;
    if (!tk) return;
    const m = M[tk];
    // "missing" = no master record at all, or no price (can't value/compute)
    if (!m || m.price == null || !isFinite(m.price)) {
      seen[tk] = seen[tk] || { hasRec: !!m, held: 0 };
    }
  });
  // annotate whether still held (via FIFO positions)
  try {
    const { pos } = runFIFO();
    Object.values(pos).forEach((p) => {
      if (seen[p.ticker]) seen[p.ticker].held += p.held || 0;
    });
  } catch (e) {}
  const tks = Object.keys(seen).sort();
  if (!tks.length) {
    box.innerHTML = "";
    return;
  }
  const items = tks
    .map((tk) => {
      const s = seen[tk];
      const why = !s.hasRec ? "no master record" : "no live price";
      const heldNote =
        s.held > 1e-9 ? " \u00B7 still held" : " \u00B7 closed/traded";
      return `<b>${escapeHtml(tk)}</b> <span class="mini" style="color:var(--text2)">(${why}${heldNote})</span>`;
    })
    .join(" \u00B7 ");
  box.innerHTML = `<div class="sec" style="border-color:var(--warn)">
      <h2>\u26A0\uFE0F Missing market data</h2>
      <div class="mini" style="margin-bottom:6px">These tickers appear in your transactions but have no ${""}master price/data, so their value, fees and signals can't be computed. Import them via the <b>Data</b> tab (prices + OPCVM fees), or restore a backup that includes them.</div>
      <div style="font-size:13px;line-height:1.9">${items}</div>
    </div>`;
}
// Emoji icon for a sector name. The keyword-matched mapping lives in the pure,
// tested core (src/core/sector-icon.js); this thin wrapper delegates to it via
// __core so the UI and the coverage test share one source of truth.
function sectorIcon(name) {
  return __core.sectorIcon(name);
}
// Build stock rows grouped under sector headers. Each sector gets a header row
// (icon + name + holdings value + portfolio weight) followed by its positions
// (sorted by the active posSort). Sectors are ordered by total held value, desc.
// `showDivY` is passed through to posRow (stocks table = true).
function groupBySectorHTML(list, showDivY) {
  const bySec = {};
  for (const p of list) {
    const sec = (M[p.ticker] && M[p.ticker].cat) || "Uncategorized";
    (bySec[sec] || (bySec[sec] = [])).push(p);
  }
  const grand = list.reduce((s, p) => s + (p.value || 0), 0);
  const secNames = Object.keys(bySec).sort((a, b) => {
    const va = bySec[a].reduce((s, p) => s + (p.value || 0), 0);
    const vb = bySec[b].reduce((s, p) => s + (p.value || 0), 0);
    return vb - va;
  });
  // Column count for the stocks table (matches emptyRowS colspan="15").
  const COLS = 15;
  let html = "";
  for (const sec of secNames) {
    const rows = bySec[sec].slice().sort(posSort);
    const secVal = rows.reduce((s, p) => s + (p.value || 0), 0);
    const w = grand > 0 ? (secVal / grand) * 100 : 0;
    html +=
      `<tr class="sector-hdr" style="background:var(--panel2)">` +
      `<td colspan="${COLS}" class="l" style="padding:6px 8px;font-weight:700;color:var(--text)">` +
      `${sectorIcon(sec)} ${escapeHtml(sec)} ` +
      `<span class="mini" style="font-weight:500;color:var(--text2)">\u00B7 ${rows.length} holding${rows.length > 1 ? "s" : ""} \u00B7 ${money(secVal, 0)} MAD \u00B7 ${w.toFixed(1)}%</span>` +
      `</td></tr>`;
    html += rows.map((p) => posRow(p, showDivY)).join("");
  }
  return html;
}
function renderPositions(arr, t) {
  if (COMBINE_ACCT) arr = mergePositions(arr);
  let vis = HIDE_CLOSED ? arr.filter((p) => p.status !== "Closed") : arr;
  const stocks = vis.filter((p) => !p.isFund).sort(posSort);
  const funds = vis.filter((p) => p.isFund).sort(posSort);
  // Totals ALWAYS span every position (incl. closed) so realized P&L stays correct when closed rows are hidden.
  const stocksAll = arr.filter((p) => !p.isFund),
    fundsAll = arr.filter((p) => p.isFund);
  // Summary KPI boxes (based on ALL positions, not just visible, so hiding closed doesn't change totals)
  const stkT = totalsOf(arr.filter((p) => !p.isFund)),
    fndT = totalsOf(arr.filter((p) => p.isFund)),
    allT = totalsOf(arr);
  const T2 = (title, lines) =>
    `<div style="font-weight:700;margin-bottom:6px">${title}</div>` +
    lines.map((l) => `<div>${l}</div>`).join("");
  const kr = document.getElementById("posKpiRow");
  if (kr)
    kr.innerHTML =
      kpi(
        "\uD83D\uDCC8 Stocks Value",
        money(stkT.val, 0) + " MAD",
        "",
        T2("Stocks \u2014 current market value", [
          "Sum of held stock positions",
          "at live prices.",
        ]),
      ) +
      kpi(
        "\uD83C\uDFE6 OPCVM Value",
        money(fndT.val, 0) + " MAD",
        "",
        T2("OPCVM funds \u2014 current value", [
          "Sum of held fund positions",
          "at their latest NAV.",
        ]),
      ) +
      kpi(
        "\uD83D\uDCCA Total Holdings",
        money(allT.val, 0) + " MAD",
        "",
        T2("Total holdings value", [
          "Stocks + OPCVM funds",
          "at current prices.",
        ]),
      ) +
      kpi(
        "\uD83D\uDCB5 Total if Sold",
        money(allT.net, 0) + " MAD",
        "pos",
        T2("Net proceeds if sold today", [
          "If you sold everything now:",
          "value \u2212 fees \u2212 tax (0 for PEA).",
        ]),
      );
  // Per-section KPI rows (always over ALL positions incl. closed)
  const sT = totalsOf(stocksAll),
    fT = totalsOf(fundsAll);
  const secKpis = (kind, x) => {
    const c = kind === "Stocks" ? "stocks" : "OPCVM funds";
    return (
      kpi(
        kind + " Value",
        money(x.val, 0) + " MAD",
        "",
        "Current market value of your " +
          c +
          " \u2014 sum of every held position at its latest price/NAV. Closed positions (0 held) add nothing here. Value = \u03a3(held qty \u00d7 current price).",
      ) +
      kpi(
        "Net if Sold",
        money(x.net, 0) + " MAD",
        "pos",
        "What you would actually pocket if you sold all " +
          c +
          " right now: value \u2212 trading fees \u2212 dividend/capital-gains tax. PEA is tax-exempt (fees only); regular accounts also subtract tax. Net = \u03a3 netIfSold per position.",
      ) +
      kpi(
        "Unrealized",
        money(x.unreal, 0) + " MAD",
        cls(x.unreal),
        "Paper gain/loss on positions you STILL hold \u2014 not yet banked. Unrealized = current value \u2212 cost basis of remaining shares. Moves with price; becomes realized only when you sell.",
      ) +
      kpi(
        "Realized",
        money(x.real, 0) + " MAD",
        cls(x.real),
        "Profit/loss already LOCKED IN by selling, using FIFO cost matching. Comes mostly from closed positions. Realized = \u03a3(sell proceeds \u2212 FIFO cost of shares sold) across all " +
          c +
          ", including closed ones. Independent of current price.",
      ) +
      kpi(
        "Lifetime",
        money(x.life, 0) + " MAD",
        cls(x.life),
        "Total this book of " +
          c +
          " has made end-to-end: realized + unrealized + dividends. Lifetime = realized (" +
          money(x.real, 0) +
          ") + unrealized (" +
          money(x.unreal, 0) +
          ") + dividends (" +
          money(x.div, 0) +
          ").",
      )
    );
  };
  const skr = document.getElementById("stocksKpiRow");
  if (skr) skr.innerHTML = secKpis("Stocks", sT);
  const fkr = document.getElementById("fundsKpiRow");
  if (fkr) fkr.innerHTML = secKpis("OPCVM", fT);
  // Stocks box
  const totLbl = HIDE_CLOSED
    ? ' <span style="font-weight:400;opacity:.7">(incl. closed)</span>'
    : "";
  const emptyRow = (txt) =>
    `<tr><td colspan="14" class="l" style="color:var(--muted)">${txt}</td></tr>`;
  const emptyRowS = (txt) =>
    `<tr><td colspan="15" class="l" style="color:var(--muted)">${txt}</td></tr>`;
  // Stock rows: flat, or grouped under sector headers when GROUP_SECTOR is on.
  const stockRowsHTML = GROUP_SECTOR
    ? groupBySectorHTML(stocks, true)
    : stocks.map((p) => posRow(p, true)).join("");
  document.querySelector("#stocksTable tbody").innerHTML =
    (stocks.length
      ? stockRowsHTML
      : stocksAll.length
        ? emptyRowS("All stock positions are closed (hidden).")
        : emptyRowS("No stock positions.")) +
    (stocksAll.length
      ? totalRowHTML("Stocks Total" + totLbl, totalsOf(stocksAll), true)
      : "");
  // Funds box
  document.querySelector("#fundsTable tbody").innerHTML =
    (funds.length
      ? funds.map((p) => posRow(p, false)).join("")
      : fundsAll.length
        ? emptyRow("All OPCVM positions are closed (hidden).")
        : emptyRow("No OPCVM fund positions.")) +
    (fundsAll.length
      ? totalRowHTML("Funds Total" + totLbl, totalsOf(fundsAll))
      : "");
  // Total box \u2014 combined (uses the grand totals t passed in)
  document.querySelector("#totalTable tbody").innerHTML = totalRowHTML(
    "TOTAL PORTFOLIO",
    t,
  );
}
function computeSignalsRows() {
  const { pos } = runFIFO();
  return Object.keys(M).map((tk) => {
    const m = M[tk];
    const sc = factorScores(m); // {score, pir, coverage, parts} or null
    const sig = signal(m, sc, heldSharesOf(pos, tk) > 0);
    return {
      ticker: tk,
      name: m.name,
      m,
      sc,
      sig,
      price: m.price,
      tbuy: targetBuy(m, sc),
      tsell: targetSell(m, sc),
      score: sc ? sc.score : null,
      pir: sc ? sc.pir : null,
      pe: m.pe,
      divy: m.divy,
      fv: fairValue(m),
      conviction: sc ? sc.conviction : null,
      profile: sc ? sc.profile : null,
      held: heldSharesOf(pos, tk) > 0,
    };
  });
}

// ---------- signal calculation breakdown ----------

function tgtBuyTipHTML(r) {
  const fv = fairValue(r.m);
  const s = r.sc && r.sc.score != null ? r.sc.score : 0.5;
  const conv = r.sc && r.sc.conviction;
  // Derive the ACTUAL discount from the canonical targetBuy() result so the tooltip
  // always matches the displayed target (incl. the conviction margin-of-safety).
  const tbuy = r.tbuy != null ? r.tbuy : targetBuy(r.m, r.sc);
  const disc = fv != null && fv > 0 && tbuy != null ? 1 - tbuy / fv : null;
  const convExtra = conv === "Low" ? 10 : conv === "Medium" ? 4 : 0;
  const row = _tipRow; // shared tooltip row builder (gap:18px)
  let h = `<div style="font-weight:700;margin-bottom:6px">Target Buy \u00B7 ${escapeHtml(r.ticker)}</div>`;
  h += row("Fair value", (fv != null ? money(fv) : "\u2014") + " MAD");
  h += row("Score", (s * 100).toFixed(0) + "%");
  h += row(
    'Margin of safety <span class="mini">(10% + (1\u2212score)\u00D720%' +
      (convExtra ? " + " + convExtra + "% " + conv + " conviction" : "") +
      ")</span>",
    (disc != null ? (disc * 100).toFixed(1) : "\u2014") + "%",
  );
  h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>`;
  h += row(
    '<b>Target Buy</b> <span class="mini">(fair \u00D7 (1\u2212disc))</span>',
    "<b>" + (r.tbuy != null ? money(r.tbuy) : "\u2014") + "</b>",
  );
  h += `<div class="mini" style="margin-top:6px">Higher score \u2192 smaller required discount \u2192 buy closer to fair value.</div>`;
  return h;
}
function tgtSellTipHTML(r) {
  const fv = fairValue(r.m);
  const s = r.sc && r.sc.score != null ? r.sc.score : 0.5;
  // Derive the ACTUAL premium from the canonical targetSell() result (after the
  // 52-wk-high cap and fair-value/buy floors), so the tooltip matches the target shown.
  const tsell = r.tsell != null ? r.tsell : targetSell(r.m, r.sc);
  const prem = fv != null && fv > 0 && tsell != null ? tsell / fv - 1 : null;
  const row = _tipRow; // shared tooltip row builder (gap:18px)
  let h = `<div style="font-weight:700;margin-bottom:6px">Target Sell \u00B7 ${escapeHtml(r.ticker)}</div>`;
  h += row("Fair value", (fv != null ? money(fv) : "\u2014") + " MAD");
  h += row("Score", (s * 100).toFixed(0) + "%");
  h += row(
    'Premium over fair <span class="mini">(base 12% + score\u00D728%, then capped/floored)</span>',
    (prem != null ? (prem * 100).toFixed(1) : "\u2014") + "%",
  );
  h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>`;
  h += row(
    "<b>Target Sell</b>",
    "<b>" + (r.tsell != null ? money(r.tsell) : "\u2014") + "</b>",
  );
  h += `<div class="mini" style="margin-top:6px">Floored at Buy\u00D71.18, capped ~10% above 52-wk high. Higher score \u2192 higher premium.</div>`;
  return h;
}
function fvTipHTML(r) {
  const m = r.m,
    fv = r.fv,
    pr = r.price;
  const row = _tipRow; // shared tooltip row builder (gap:18px)
  let h =
    '<div style="font-weight:700;margin-bottom:4px">' +
    r.ticker +
    " \u2014 Fair Value</div>";
  h +=
    '<div style="color:var(--text2);font-size:11px;margin-bottom:6px">Blended intrinsic value from price-independent anchors (median-trimmed).</div>';
  const aps = fairValueParts(m);
  if (aps.length) {
    aps.forEach((a) => {
      h += row(a[0], money(a[1]) + " MAD");
    });
    h +=
      '<div style="border-top:1px solid var(--border);margin:6px 0;padding-top:2px"></div>';
  }
  h += row(
    "<b>Fair value</b>",
    "<b>" + (fv != null ? money(fv) + " MAD" : "\u2014") + "</b>",
  );
  h += row("Current price", pr != null ? money(pr) + " MAD" : "\u2014");
  if (fv != null && pr != null && fv > 0) {
    const gap = (fv - pr) / pr;
    const up = gap >= 0;
    const label = up
      ? "Undervalued \u2014 upside to fair"
      : "Overvalued \u2014 above fair";
    h += row(
      label,
      "<b>" + (up ? "+" : "") + (gap * 100).toFixed(1) + "%</b>",
      up ? "pos" : "neg",
    );
  }
  return h;
}
function scoreTipHTML(r) {
  // reuse the factor breakdown from signalTipHTML
  return signalTipHTML(r);
}
function convTipHTML(r) {
  const sc = r.sc;
  const _row = (l, v, cl) =>
    '<div style="display:flex;justify-content:space-between;gap:18px"><span>' +
    l +
    '</span><span class="' +
    (cl || "") +
    '" style="font-family:var(--mono)">' +
    v +
    "</span></div>";
  let h =
    '<div style="font-weight:700;margin-bottom:6px">Conviction \u00B7 ' +
    escapeHtml(r.ticker) +
    "</div>";
  if (!sc) {
    return (
      h +
      '<div class="mini" style="color:var(--muted)">Not enough data to score.</div>'
    );
  }
  const lvl = sc.conviction || "\u2014";
  const lvlCl = lvl === "High" ? "pos" : lvl === "Low" ? "neg" : "";
  h += _row("<b>Level</b>", "<b>" + lvl + "</b>", lvlCl);
  h +=
    '<div class="mini" style="margin:4px 0 6px;color:var(--muted)">How much to trust this score \u2014 needs BOTH broad factor coverage AND enough core fundamentals present.</div>';
  h += _row(
    'Factor coverage <span class="mini">(by weight)</span>',
    sc.wcov != null ? (sc.wcov * 100).toFixed(0) + "%" : "\u2014",
  );
  const nHave = (sc.depthDefs || []).filter((d) => d[1]).length,
    nTot = (sc.depthDefs || []).length;
  h += _row(
    "Core data depth",
    nHave +
      " / " +
      nTot +
      (sc.dataDepth != null
        ? " (" + (sc.dataDepth * 100).toFixed(0) + "%)"
        : ""),
  );
  h +=
    '<div style="border-top:1px solid var(--border);margin:6px 0;padding-top:2px"></div>';
  (sc.depthDefs || []).forEach((d) => {
    h +=
      '<div style="display:flex;justify-content:space-between;gap:14px"><span class="mini">' +
      d[0] +
      '</span><span style="font-family:var(--mono);color:' +
      (d[1] ? "var(--success)" : "var(--error)") +
      '">' +
      (d[1] ? "\u2713" : "\u2717") +
      "</span></div>";
  });
  if (sc.convScore != null) {
    h +=
      '<div style="border-top:1px solid var(--border);margin:6px 0;padding-top:2px"></div>';
    h += _row(
      "<b>Conviction score</b>",
      "<b>" + (sc.convScore * 100).toFixed(0) + "%</b>",
    );
    h +=
      '<div class="mini" style="margin-top:4px;color:var(--muted)">Thresholds: High \u2265 80% \u00B7 Medium \u2265 55% \u00B7 else Low. Missing core inputs cap conviction even when weighted coverage looks high.</div>';
  }
  // \u2500\u2500 Earnings quality flags \u2500\u2500
  if (sc && sc.eqFlags && sc.eqFlags.length) {
    h +=
      '<div style="border-top:1px solid var(--border);margin:6px 0;padding-top:4px;color:var(--warn);font-weight:600">\u26a0 Quality red flags</div>';
    sc.eqFlags.forEach((f) => {
      h += _row(f, "", "neg");
    });
    h +=
      '<div class="mini" style="color:var(--muted)">These penalize the quality sub-score and may block BUY signals.</div>';
  }
  return h;
}

// ---- rebalance "why" tooltips ----
// Live price vs target buy: flag entries trading materially above their ideal entry.
const ABOVE_TGT_THRESH = 0.1; // >10% above target buy = not an ideal entry yet
function aboveTgtPct(px, tbuy) {
  return tbuy != null && isFinite(tbuy) && tbuy > 0 && px != null
    ? (px - tbuy) / tbuy
    : null;
}
function aboveTgtBadge(px, tbuy) {
  const a = aboveTgtPct(px, tbuy);
  if (a == null || a <= ABOVE_TGT_THRESH) return "";
  return (
    ' <span class="badge b-abovetgt" data-tip="' +
    tipRef(
      "Live price is " +
        (a * 100).toFixed(0) +
        "% above target buy (" +
        money(tbuy) +
        " MAD). It qualifies as undervalued vs fair value, but you'd be paying above the ideal entry \u2014 consider waiting for a dip.",
    ) +
    '" style="cursor:help">\u26A0 +' +
    (a * 100).toFixed(0) +
    "% vs tgt</span>"
  );
}
function rbBuyTipHTML(x, ctx) {
  // ctx: {capPct, secWBefore, secWAfter}
  let h =
    '<div style="font-weight:700;margin-bottom:6px">Why buy ' +
    x.ticker +
    "?</div>";
  h +=
    '<div style="display:flex;justify-content:space-between;gap:18px"><span>Sector</span><span style="font-family:var(--mono)">' +
    x.cat +
    "</span></div>";
  h +=
    '<div style="display:flex;justify-content:space-between;gap:18px"><span>Sector weight now</span><span style="font-family:var(--mono)">' +
    (ctx && ctx.secWBefore != null
      ? (ctx.secWBefore * 100).toFixed(0) + "%"
      : "\u2014") +
    "</span></div>";
  h +=
    '<div style="display:flex;justify-content:space-between;gap:18px"><span>After this plan</span><span style="font-family:var(--mono)">' +
    (ctx && ctx.secWAfter != null
      ? (ctx.secWAfter * 100).toFixed(0) + "%"
      : "\u2014") +
    ' <span class="mini">(cap ' +
    (ctx ? (ctx.capPct * 100).toFixed(0) : "\u2014") +
    "%)</span></span></div>";
  h += '<div style="border-top:1px solid var(--border);margin:6px 0"></div>';
  h +=
    '<div style="display:flex;justify-content:space-between;gap:18px"><span>Fair value</span><span style="font-family:var(--mono)">' +
    (x.fv != null ? money(x.fv) : "\u2014") +
    " MAD</span></div>";
  h +=
    '<div style="display:flex;justify-content:space-between;gap:18px"><span>Live price <span class="mini">(what you pay)</span></span><span style="font-family:var(--mono)"><b>' +
    money(x.px) +
    " MAD</b></span></div>";
  if (x.tbuy != null)
    h +=
      '<div style="display:flex;justify-content:space-between;gap:18px"><span>Target Buy <span class="mini">(ideal entry)</span></span><span style="font-family:var(--mono);color:var(--text2)">' +
      money(x.tbuy) +
      " MAD</span></div>";
  {
    const _a = aboveTgtPct(x.px, x.tbuy);
    if (_a != null)
      h +=
        '<div style="display:flex;justify-content:space-between;gap:18px"><span>vs target buy</span><span class="' +
        (_a > ABOVE_TGT_THRESH ? "neg" : "pos") +
        '" style="font-family:var(--mono)">' +
        (_a >= 0 ? "+" : "") +
        (_a * 100).toFixed(0) +
        "%" +
        (_a > ABOVE_TGT_THRESH ? " \u26A0" : "") +
        "</span></div>";
  }
  h +=
    '<div style="display:flex;justify-content:space-between;gap:18px"><span>Discount to fair</span><span class="' +
    (x.disc > 0 ? "pos" : "neg") +
    '" style="font-family:var(--mono)">' +
    (x.disc * 100).toFixed(0) +
    "%</span></div>";
  h +=
    '<div style="display:flex;justify-content:space-between;gap:18px"><span>Signal engine</span><span style="font-family:var(--mono)">' +
    ((x.sig && x.sig.t) || "\u2014") +
    "</span></div>";
  // Conviction \u00D7 range-width sizing info
  {
    const _m = M[x.ticker];
    const _sc = typeof factorScores === "function" ? factorScores(_m) : null;
    const _conv = _sc ? _sc.convScore : 0.5;
    const _kelly = _conv >= 0.8 ? 3 : _conv >= 0.55 ? 2 : 1;
    const _vol =
      num(_m.low) && num(_m.high) && x.px > 0
        ? (_m.high - _m.low) / x.px
        : null;
    h +=
      '<div style="display:flex;justify-content:space-between;gap:18px"><span>Conviction sizing</span><span style="font-family:var(--mono)">' +
      _kelly +
      ' sh/step <span class="mini">(conv ' +
      (_conv * 100).toFixed(0) +
      "%)</span></span></div>";
    if (_vol != null)
      h +=
        '<div style="display:flex;justify-content:space-between;gap:18px"><span>Range width (52w hi\u2212lo / px)</span><span style="font-family:var(--mono)">' +
        (_vol * 100).toFixed(0) +
        "%</span></div>";
    h +=
      '<div style="display:flex;justify-content:space-between;gap:18px"><span>Qty allocated</span><span style="font-family:var(--mono)"><b>' +
      x.qty +
      "</b> shares</span></div>";
  }
  h += '<div style="border-top:1px solid var(--border);margin:6px 0"></div>';
  h +=
    '<div class="mini">Chosen because its sector is <b>under-represented</b> (below the ' +
    (ctx ? (ctx.capPct * 100).toFixed(0) : "\u2014") +
    "% cap) and it trades <b>" +
    (x.disc > 0 ? (x.disc * 100).toFixed(0) + "% below" : "above") +
    " fair value</b>. Buying it moves your mix toward balance.</div>";
  return h;
}
function rbTrimTipHTML(x, ctx) {
  let h =
    '<div style="font-weight:700;margin-bottom:6px">Why trim ' +
    x.ticker +
    "?</div>";
  h +=
    '<div style="display:flex;justify-content:space-between;gap:18px"><span>Sector</span><span style="font-family:var(--mono)">' +
    x.cat +
    "</span></div>";
  h +=
    '<div style="display:flex;justify-content:space-between;gap:18px"><span>Sector weight now</span><span class="neg" style="font-family:var(--mono)">' +
    (ctx && ctx.secWBefore != null
      ? (ctx.secWBefore * 100).toFixed(0) + "%"
      : "\u2014") +
    ' <span class="mini">(cap ' +
    (ctx ? (ctx.capPct * 100).toFixed(0) : "\u2014") +
    "%)</span></span></div>";
  h += '<div style="border-top:1px solid var(--border);margin:6px 0"></div>';
  h +=
    '<div style="display:flex;justify-content:space-between;gap:18px"><span>Fair value</span><span style="font-family:var(--mono)">' +
    (x.fv != null ? money(x.fv) : "\u2014") +
    " MAD</span></div>";
  h +=
    '<div style="display:flex;justify-content:space-between;gap:18px"><span>Current price</span><span style="font-family:var(--mono)">' +
    money(x.px) +
    " MAD</span></div>";
  h +=
    '<div style="display:flex;justify-content:space-between;gap:18px"><span>Discount to fair</span><span class="' +
    (x.disc < 0 ? "neg" : "pos") +
    '" style="font-family:var(--mono)">' +
    (x.disc * 100).toFixed(0) +
    "%</span></div>";
  h +=
    '<div style="display:flex;justify-content:space-between;gap:18px"><span>Sell qty \u2192 net</span><span style="font-family:var(--mono)">' +
    x.qty +
    " \u2192 " +
    money(x.net, 0) +
    " MAD</span></div>";
  h += '<div style="border-top:1px solid var(--border);margin:6px 0"></div>';
  h +=
    '<div class="mini">This sector is <b>over the ' +
    (ctx ? (ctx.capPct * 100).toFixed(0) : "\u2014") +
    "% cap</b>, and within it this name is the <b>most richly valued</b> (" +
    (x.disc < 0
      ? (-x.disc * 100).toFixed(0) + "% above"
      : (x.disc * 100).toFixed(0) + "% below") +
    " fair). Trimming it frees cash to diversify.</div>";
  return h;
}
// ---- reusable tooltip builders (every number explains itself) ----
function _tipRow(l, v, cl) {
  return (
    '<div style="display:flex;justify-content:space-between;gap:18px"><span>' +
    l +
    '</span><span class="' +
    (cl || "") +
    '" style="font-family:var(--mono)">' +
    v +
    "</span></div>"
  );
}
function _tipHead(t) {
  return '<div style="font-weight:700;margin-bottom:6px">' + t + "</div>";
}
function _tipRule() {
  return '<div style="border-top:1px solid var(--border);margin:6px 0"></div>';
}

function fairValueTipHTML(m, ticker) {
  const fv = fairValue(m);
  const parts = fairValueParts(m);
  let h = _tipHead("Fair value \u00B7 " + (ticker || ""));
  if (!parts.length) {
    h += '<div class="mini">Not enough data \u2014 using last price.</div>';
    return h;
  }
  h +=
    '<div class="mini" style="color:var(--text2);margin-bottom:2px">Blend of ' +
    parts.length +
    " anchor" +
    (parts.length === 1 ? "" : "s") +
    " (outliers trimmed):</div>";
  parts.forEach((pr) => {
    h += _tipRow(pr[0], money(pr[1]));
  });
  h += _tipRule();
  h += _tipRow(
    '<b>Fair value</b> <span class="mini">(mean)</span>',
    "<b>" + (fv != null ? money(fv) : "\u2014") + " MAD</b>",
  );
  return h;
}
function upsideTipHTML(r) {
  const m = r.m,
    fv = r._tb && r._tb.fv != null ? r._tb.fv : fairValue(m);
  const up =
    fv != null && r.price != null && r.price > 0
      ? ((fv - r.price) / r.price) * 100
      : null;
  let h = _tipHead("Upside to fair value \u00B7 " + r.ticker);
  h += _tipRow(
    "Current price",
    (r.price != null ? money(r.price) : "\u2014") + " MAD",
  );
  h += _tipRow("Fair value", (fv != null ? money(fv) : "\u2014") + " MAD");
  h += _tipRule();
  const parts = fairValueParts(m);
  if (parts.length) {
    h +=
      '<div class="mini" style="color:var(--text2);margin-bottom:2px">Fair value = mean of:</div>';
    parts.forEach((pr) => {
      h += _tipRow(pr[0], money(pr[1]));
    });
    h += _tipRule();
  }
  h += _tipRow(
    '<b>Upside</b> <span class="mini">((fair\u2212price)/price)</span>',
    '<b class="' +
      (up != null && up >= 0 ? "pos" : "neg") +
      '">' +
      (up != null ? (up >= 0 ? "+" : "") + up.toFixed(1) + "%" : "\u2014") +
      "</b>",
  );
  return h;
}
function pirTipHTML(r) {
  const m = r.m;
  let h = _tipHead("Position in 52-wk range \u00B7 " + r.ticker);
  h += _tipRow("52-wk low", (num(m.low) ? money(m.low) : "\u2014") + " MAD");
  h += _tipRow(
    "Current price",
    (r.price != null ? money(r.price) : "\u2014") + " MAD",
  );
  h += _tipRow("52-wk high", (num(m.high) ? money(m.high) : "\u2014") + " MAD");
  h += _tipRule();
  h += _tipRow(
    '<b>Position</b> <span class="mini">((px\u2212low)/(high\u2212low))</span>',
    "<b>" + (r.pir != null ? pct(r.pir) : "\u2014") + "</b>",
  );
  h +=
    '<div class="mini" style="margin-top:6px">0% = at the 52-wk low (cheap end of its band) \u00B7 100% = at the high.</div>';
  return h;
}
function peTipHTML(r) {
  const m = r.m;
  const epsAbs = num(m.eps) && m.eps > 0;
  const eps = epsAbs ? m.eps : num(m.pe) && m.pe > 0 ? m.price / m.pe : null;
  let h = _tipHead("Price / Earnings \u00B7 " + r.ticker);
  h += _tipRow("Price", (r.price != null ? money(r.price) : "\u2014") + " MAD");
  if (eps != null)
    h += _tipRow(
      'EPS <span class="mini">(' +
        (epsAbs ? "reported" : "price/PE") +
        ")</span>",
      money(eps) + " MAD",
    );
  h += _tipRule();
  h += _tipRow(
    "<b>P/E</b>",
    "<b>" + (r.pe != null ? money(r.pe, 1) : "\u2014") + "</b>",
  );
  const pr = sectorProfile(m.cat);
  h +=
    '<div class="mini" style="margin-top:6px">Sector-fair P/E \u2248 ' +
    pr.peFair +
    ". Lower than fair = cheaper on earnings.</div>";
  return h;
}
function divyTipHTML(r) {
  const m = r.m;
  const dpsAbs = num(m.dps) && m.dps > 0;
  const dps = dpsAbs
    ? m.dps
    : num(m.divy) && m.divy > 0
      ? m.price * m.divy
      : null;
  let h = _tipHead("Dividend yield \u00B7 " + r.ticker);
  h += _tipRow("Price", (r.price != null ? money(r.price) : "\u2014") + " MAD");
  if (dps != null)
    h += _tipRow(
      'Div / share <span class="mini">(price\u00D7yield)</span>',
      money(dps) + " MAD",
    );
  h += _tipRule();
  h += _tipRow(
    "<b>Yield</b>",
    "<b>" + (r.divy != null ? pct(r.divy) : "\u2014") + "</b>",
  );
  const pr = sectorProfile(m.cat);
  h +=
    '<div class="mini" style="margin-top:6px">Sector-fair yield \u2248 ' +
    (pr.dyFair * 100).toFixed(1) +
    "%. Higher = more income per MAD.</div>";
  return h;
}
function priceTipHTML(r) {
  const m = r.m;
  let h = _tipHead("Last price \u00B7 " + r.ticker);
  h += _tipRow("Price", (r.price != null ? money(r.price) : "\u2014") + " MAD");
  if (num(m.low) && num(m.high)) {
    h += _tipRow("52-wk low", money(m.low));
    h += _tipRow("52-wk high", money(m.high));
  }
  return h;
}

// Reusable peer-relative valuation tooltip (shared by the Signals breakdown and Top Buys cards).
function peerTipHTML(r) {
  const m = r.m,
    sc = r.sc;
  const row = _tipRow; // shared tooltip row builder (gap:18px)
  let h = `<div style="font-weight:700;margin-bottom:6px">Peer-relative valuation \u00B7 ${escapeHtml(r.ticker)}</div>`;
  const pf = sc && sc.parts && sc.parts.peerrel;
  if (!pf || pf.s == null || !pf._n) {
    h +=
      '<div class="mini" style="color:var(--muted)">No comparable peers with valuation data \u2014 peer signal not used for this stock.</div>';
    return h;
  }
  const st = typeof sectorStats === "function" ? sectorStats() : null;
  const cat = m.cat || "Uncategorized";
  const key =
    typeof sectorProfile === "function" ? sectorProfile(m.cat).key : null;
  const ref = st
    ? pf._basis === "category"
      ? st.cat && st.cat[cat]
      : st.prof && st.prof[key]
    : null;
  const basisLbl =
    pf._basis === "category"
      ? "same category (" + escapeHtml(cat) + ")"
      : "broad sector (" + (sc.profile || key) + ")";
  h += row("Compared against", "<b>" + basisLbl + "</b>");
  h += row(
    "Comparables used",
    "<b>" +
      pf._n +
      "</b>" +
      (pf._n < 4
        ? ' <span class="mini neg">(thin \u2014 down-weighted)</span>'
        : ""),
  );
  if (ref) {
    if (ref.pe != null)
      h += row(
        "Peer median P/E",
        money(ref.pe, 1) +
          (num(m.pe) && m.pe > 0
            ? '  <span class="mini">\u00B7 you ' + money(m.pe, 1) + "</span>"
            : ""),
      );
    if (ref.pb != null)
      h += row(
        "Peer median P/B",
        money(ref.pb, 2) +
          (num(m.pb) && m.pb > 0
            ? '  <span class="mini">\u00B7 you ' + money(m.pb, 2) + "</span>"
            : ""),
      );
    if (ref.divy != null)
      h += row(
        "Peer median Div Y",
        (ref.divy * 100).toFixed(1) +
          "%" +
          (num(m.divy) && m.divy > 0
            ? '  <span class="mini">\u00B7 you ' +
              (m.divy * 100).toFixed(1) +
              "%</span>"
            : ""),
      );
  }
  const verdict =
    pf.s >= 0.6
      ? "cheaper than peers"
      : pf.s <= 0.4
        ? "pricier than peers"
        : "in line with peers";
  h +=
    '<div style="border-top:1px solid var(--border);margin:6px 0;padding-top:2px"></div>';
  h += row(
    "<b>Peer verdict</b>",
    '<b class="' +
      (pf.s >= 0.6 ? "pos" : pf.s <= 0.4 ? "neg" : "") +
      '">' +
      (pf.s * 100).toFixed(0) +
      "% \u00B7 " +
      verdict +
      "</b>",
  );
  h +=
    '<div class="mini" style="margin-top:4px;color:var(--muted)">Prefers same-category peers when \u22654 exist, else the broad sector. Fewer comparables \u2192 lower weight in the score.</div>';
  return h;
}
function signalTipHTML(r) {
  const m = r.m,
    sc = r.sc,
    fv = fairValue(m);
  const names = {
    valuation: "Valuation (EV/EBITDA)",
    safety: "Safety (Net Debt/EBITDA)",
    quality: "Quality (ROE)",
    growth: "Growth (PEG + EPS growth)",
    yield: "Yield (Div %)",
    book: "Book (P/B)",
    fcfy: "FCF Yield (FCF/Price)",
    timing: "Timing (Entry pos.)",
    momentum: "Range Position (52w)",
    peerrel: "Peer-relative (vs sector)",
  };
  const row = _tipRow; // shared tooltip row builder (gap:18px)
  let h = `<div style="font-weight:700;margin-bottom:2px">${escapeHtml(r.ticker)} \u2014 ${escapeHtml(r.name || "")}</div>`;
  h += `<div style="margin-bottom:8px"><span class="badge ${r.sig.c}">${r.sig.t}</span></div>`;
  h += `<div style="color:var(--text2);font-size:11px;margin-bottom:2px">Factor \u00B7 <b>raw value</b> \u00B7 weight \u00B7 score \u2192 contribution</div>`;
  if (sc && sc.parts) {
    // Raw metric values for each factor
    const _rawVals = {
      valuation: m.ev != null ? m.ev.toFixed(1) + "x" : null,
      safety: m.netdebt != null ? m.netdebt.toFixed(1) + "x" : null,
      quality: m.roe != null ? (m.roe * 100).toFixed(1) + "%" : null,
      growth:
        m.peg != null
          ? m.peg.toFixed(1) +
            (m.epsGrowth != null
              ? " (gr " +
                (m.epsGrowth >= 0 ? "+" : "") +
                (m.epsGrowth * 100).toFixed(0) +
                "%)"
              : "")
          : null,
      yield: m.divy != null ? (m.divy * 100).toFixed(2) + "%" : null,
      book: m.pb != null ? m.pb.toFixed(2) + "x" : null,
      fcfy:
        m.fcf != null && m.price != null && m.price > 0
          ? ((m.fcf / m.price) * 100).toFixed(1) + "%"
          : null,
      timing: sc.pir != null ? (sc.pir * 100).toFixed(0) + "%" : null,
      momentum: sc.pir != null ? (sc.pir * 100).toFixed(0) + "%" : null,
      peerrel:
        sc.parts.peerrel && sc.parts.peerrel._n
          ? sc.parts.peerrel._n + " peers"
          : null,
    };
    for (const k in sc.parts) {
      const f = sc.parts[k];
      // Skip factors that carry zero weight for this sector (e.g. FCF yield for
      // financials/REITs) - they contribute nothing and would just add a noisy
      // "0% weight -> 0%" row.
      if (!f.w) continue;
      const rv = _rawVals[k];
      const rawStr = rv ? "<b>" + rv + "</b> \u00B7 " : "";
      const s =
        f.s == null
          ? '<span style="color:var(--muted)">no data</span>'
          : (f.s * 100).toFixed(0) + "%";
      const contrib =
        f.s == null ? "" : " \u2192 " + (f.s * f.w * 100).toFixed(0) + "%";
      h += row(
        names[k] || k,
        rawStr +
          '<span class="mini">' +
          (f.w * 100).toFixed(0) +
          "%</span> \u00B7 " +
          s +
          contrib,
      );
    }
  }
  h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>`;
  h += row(
    '<b>Total Score</b> <span class="mini">(\u00F7 avail. weights, correlation-adjusted)</span>',
    "<b>" +
      (sc && sc.score != null ? (sc.score * 100).toFixed(0) + "%" : "\u2014") +
      "</b>",
  );
  h += row(
    "Sector weighting profile",
    "<b>" + (sc && sc.profile ? sc.profile : "\u2014") + "</b>",
  );
  h += row(
    'Conviction <span class="mini">(data coverage ' +
      (sc && sc.wcov != null ? (sc.wcov * 100).toFixed(0) + "%" : "") +
      ")</span>",
    "<b>" + (sc && sc.conviction ? sc.conviction : "\u2014") + "</b>",
    sc && sc.conviction === "High"
      ? "pos"
      : sc && sc.conviction === "Low"
        ? "neg"
        : "",
  );
  h += `<div style="margin-top:8px"></div>`;
  h += row(
    'Fair value <span class="mini">(price-independent anchors)</span>',
    (fv != null ? money(fv) : "\u2014") + " MAD",
  );
  {
    const aps = fairValueParts(m);
    if (aps.length) {
      h += '<div class="mini" style="margin:2px 0 2px 8px;color:var(--text2)">';
      aps.forEach((a) => {
        h +=
          '<div style="display:flex;justify-content:space-between;gap:14px"><span>' +
          a[0] +
          '</span><span style="font-family:var(--mono)">' +
          money(a[1]) +
          "</span></div>";
      });
      h += "</div>";
    }
  }
  // ---- (B) Peer-relative valuation detail: what we compared against, and how many peers ----
  {
    const pf = sc && sc.parts && sc.parts.peerrel;
    if (pf && pf.s != null && pf._n) {
      const st = typeof sectorStats === "function" ? sectorStats() : null;
      const cat = m.cat || "Uncategorized";
      const key =
        typeof sectorProfile === "function" ? sectorProfile(m.cat).key : null;
      const ref = st
        ? pf._basis === "category"
          ? st.cat && st.cat[cat]
          : st.prof && st.prof[key]
        : null;
      h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;font-weight:600">Peer-relative valuation</div>`;
      const basisLbl =
        pf._basis === "category"
          ? "same category (" + escapeHtml(cat) + ")"
          : "broad sector (" + (sc.profile || key) + ")";
      h += row("Compared against", "<b>" + basisLbl + "</b>");
      h += row(
        "Comparables used",
        "<b>" +
          pf._n +
          "</b>" +
          (pf._n < 4
            ? ' <span class="mini neg">(thin \u2014 down-weighted)</span>'
            : ""),
      );
      if (ref) {
        if (ref.pe != null)
          h += row(
            "Peer median P/E",
            money(ref.pe, 1) +
              (num(m.pe) && m.pe > 0
                ? '  <span class="mini">\u00B7 you ' +
                  money(m.pe, 1) +
                  "</span>"
                : ""),
          );
        if (ref.pb != null)
          h += row(
            "Peer median P/B",
            money(ref.pb, 2) +
              (num(m.pb) && m.pb > 0
                ? '  <span class="mini">\u00B7 you ' +
                  money(m.pb, 2) +
                  "</span>"
                : ""),
          );
        if (ref.divy != null)
          h += row(
            "Peer median Div Y",
            (ref.divy * 100).toFixed(1) +
              "%" +
              (num(m.divy) && m.divy > 0
                ? '  <span class="mini">\u00B7 you ' +
                  (m.divy * 100).toFixed(1) +
                  "%</span>"
                : ""),
          );
      }
      const verdict =
        pf.s >= 0.6
          ? "cheaper than peers"
          : pf.s <= 0.4
            ? "pricier than peers"
            : "in line with peers";
      h += row(
        "<b>Peer verdict</b>",
        '<b class="' +
          (pf.s >= 0.6 ? "pos" : pf.s <= 0.4 ? "neg" : "") +
          '">' +
          (pf.s * 100).toFixed(0) +
          "% \u00B7 " +
          verdict +
          "</b>",
      );
      h +=
        '<div class="mini" style="margin-top:4px;color:var(--muted)">Prefers same-category peers when \u22654 exist, else the broad sector. Fewer comparables \u2192 lower weight in the score.</div>';
      h += `<div style="margin-top:8px"></div>`;
    }
  }
  h += row(
    'Target Buy <span class="mini">(fair \u2212 discount)</span>',
    r.tbuy != null ? money(r.tbuy) : "\u2014",
  );
  h += row(
    'Target Sell <span class="mini">(fair + premium)</span>',
    r.tsell != null ? money(r.tsell) : "\u2014",
  );
  h += row("Current price", r.price != null ? money(r.price) : "\u2014");
  h += row("Position in range", r.pir != null ? pct(r.pir) : "\u2014");
  if (r.sig && r.sig.reasons && r.sig.reasons.length) {
    h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;font-weight:600">Why this signal</div>`;
    h +=
      '<ul style="margin:4px 0 0;padding-left:16px">' +
      r.sig.reasons
        .map((x) => '<li style="margin:2px 0">' + x + "</li>")
        .join("") +
      "</ul>";
  }
  // \u2500\u2500 Earnings quality flags \u2500\u2500
  if (sc && sc.eqFlags && sc.eqFlags.length) {
    h +=
      '<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;font-weight:600;color:var(--warn)">\u26a0 Earnings quality concerns</div>';
    h +=
      '<ul style="margin:4px 0 0;padding-left:16px;color:var(--warn)">' +
      sc.eqFlags
        .map((f) => '<li style="margin:2px 0">' + escapeHtml(f) + "</li>")
        .join("") +
      "</ul>";
  }
  return h;
}

// Buy strength: how compelling the buy is (higher = act first).
// Combines the signal tier, the score, and how far below the buy target the price sits.
function buyStrength(r) {
  const tier =
    {
      "\uD83D\uDE80 STRONG BUY": 5,
      "\uD83D\uDCB0 BUY (Deep Value)": 4,
      "\uD83D\uDCB8 BUY (Good Value)": 3,
      "\u2753 BUY (Speculative)": 1,
    }[r.sig.t] || 2;
  const disc =
    r.tbuy && r.price != null ? Math.max(0, (r.tbuy - r.price) / r.tbuy) : 0; // deeper discount = stronger
  return tier * 100 + (r.score || 0) * 20 + disc * 40;
}
// Sell urgency: how urgent the exit is (higher = act first).
function sellUrgency(r) {
  const tier =
    r.sig.c === "b-sell"
      ? 5
      : r.sig.t.indexOf("TRIM 50") >= 0 || r.sig.t.indexOf("Well Above") >= 0
        ? 4
        : 3;
  const over =
    r.tsell && r.price != null ? Math.max(0, (r.price - r.tsell) / r.tsell) : 0; // further above target = more urgent
  const weak = 1 - (r.score || 0.5); // weaker quality = more urgent to sell
  return tier * 100 + over * 50 + weak * 20;
}
function topBuyRank(r) {
  // Composite conviction-weighted buy quality. All components normalised ~0..1.
  const tier =
    {
      "\uD83D\uDE80 STRONG BUY": 1.0,
      "\uD83D\uDCB0 BUY (Deep Value)": 0.85,
      "\uD83D\uDCB8 BUY (Good Value)": 0.7,
      "\u2753 BUY (Speculative)": 0.45,
    }[r.sig.t] || 0.6;
  const fv = fairValue(r.m);
  const disc =
    fv && r.price != null ? Math.max(0, Math.min(0.6, (fv - r.price) / fv)) : 0; // upside to fair value, capped 60%
  const sc = r.score != null ? r.score : 0.5; // factor score 0..1
  const convW = { High: 1.0, Medium: 0.8, Low: 0.55 }[r.conviction] || 0.7; // data coverage / confidence
  // weighted blend then scaled by conviction (low data confidence discounts the whole idea)
  const raw = 0.45 * tier + 0.35 * (disc / 0.6) + 0.2 * sc;
  return { rank: raw * convW, tier, disc, sc, convW, fv };
}

function renderTopBuys() {
  const wrap = document.getElementById("topBuysWrap");
  if (!wrap) return;
  const at = (document.getElementById("sigAsset") || {}).value || "stocks";
  let rows = computeSignalsRows().filter((r) => r.sig.c === "b-buy");
  if (at === "stocks") rows = rows.filter((r) => !(r.m && r.m.cat === "OPCVM"));
  else if (at === "opcvm")
    rows = rows.filter((r) => r.m && r.m.cat === "OPCVM");
  rows.forEach((r) => {
    r._tb = topBuyRank(r);
  });
  rows.sort((a, b) => b._tb.rank - a._tb.rank);
  const top = rows.slice(0, 10);
  window.__topBuys = top;
  // prune stale selections
  if (window.__tbSel) {
    const keep = {};
    top.forEach((r) => {
      if (window.__tbSel[r.ticker]) keep[r.ticker] = true;
    });
    window.__tbSel = keep;
  } else window.__tbSel = {};
  if (!top.length) {
    wrap.innerHTML =
      '<div class="sec" style="padding:12px 14px;margin:0;height:100%;display:flex;flex-direction:column"><h3 style="margin:0 0 6px">\u2B50 Top Buys</h3><div class="mini" style="color:var(--text2)">No buy signals for the current asset filter.</div></div>';
    renderTopSector();
    renderTopHeadroom();
    return;
  }
  const row = (r, i) => {
    const up =
      r._tb.fv && r.price != null
        ? ((r._tb.fv - r.price) / r.price) * 100
        : null;
    const upTxt =
      up != null ? (up >= 0 ? "+" : "") + up.toFixed(0) + "%" : "\u2014";
    const checked = window.__tbSel[r.ticker] ? "checked" : "";
    return `<div class="tb-card" style="display:flex;align-items:center;gap:7px;padding:6px 9px;border:1px solid var(--border);border-radius:9px;background:var(--panel);margin-bottom:5px" data-tip="${escapeHtml(r.name || r.ticker)} \u2014 ${
      (r.sig.reasons || [])
        .filter((x) => !/^Score\s/.test(x))
        .slice(0, 2)
        .join(" ") || "buy signal"
    }">
      <input type="checkbox" class="tb-chk" data-tk="${escapeHtml(r.ticker)}" data-act="toggleTbSel" data-args="${r.ticker},$checked" data-stop="true" ${checked} style="width:16px;height:16px;flex:none;cursor:pointer">
      <div style="font-family:var(--mono);font-weight:800;font-size:13px;color:var(--muted);width:16px;flex:none">${i + 1}</div>
      <div style="min-width:0;flex:1;cursor:pointer" data-act="prefillPending" data-args="${r.ticker}">
        <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.ticker)} <span class="badge ${r.sig.c}" style="font-size:9px">${r.sig.t}</span></div>
        <div class="mini" style="color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.name || "")}</div>
        ${aboveTgtBadge(r.price, r.tbuy) ? '<div style="margin-top:2px">' + aboveTgtBadge(r.price, r.tbuy) + "</div>" : ""}
      </div>
      <div style="text-align:right;flex:none;width:56px;cursor:help" data-tip="${tipRef(priceTipHTML(r))}"><span class="mini" style="color:var(--text2);white-space:nowrap">Price</span><br><b style="font-family:var(--mono);font-size:12px">${r.price != null ? money(r.price) : "\u2014"}</b></div>
      <div style="text-align:right;flex:none;width:56px;cursor:help" data-tip="${tipRef(upsideTipHTML(r))}"><span class="mini" style="color:var(--text2);white-space:nowrap">Upside</span><br><b class="${up != null && up > 0 ? "pos" : "neg"}" style="font-family:var(--mono);font-size:12px">${upTxt}</b></div>
      <div style="text-align:right;flex:none;width:56px;cursor:help" data-tip="${r.tbuy != null ? tipRef(tgtBuyTipHTML(r)) : ""}"><span class="mini" style="color:var(--text2);white-space:nowrap">Tgt buy</span><br><b style="font-family:var(--mono);font-size:12px">${r.tbuy != null ? money(r.tbuy) : "\u2014"}</b></div>
      <div style="text-align:right;flex:none;width:56px;${r.divy != null ? "cursor:help" : ""}" data-tip="${r.divy != null ? tipRef(divyTipHTML(r)) : ""}"><span class="mini" style="color:var(--text2);white-space:nowrap">Div Y</span><br><b class="${r.divy > 0 ? "pos" : ""}" style="font-family:var(--mono);font-size:12px">${r.divy != null ? pct(r.divy) : "\u2014"}</b></div>
      <div style="text-align:right;flex:none;width:56px;${r.sc && r.sc.parts && r.sc.parts.peerrel ? "cursor:help" : ""}" data-tip="${r.sc && r.sc.parts && r.sc.parts.peerrel ? tipRef(peerTipHTML(r)) : ""}"><span class="mini" style="color:var(--text2);white-space:nowrap">Rank</span><br><b style="font-family:var(--mono);font-size:12px">${(r._tb.rank * 100).toFixed(0)}</b></div>
    </div>`;
  };
  wrap.innerHTML = `<div class="sec" style="padding:12px 14px;margin:0;height:100%;display:flex;flex-direction:column">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;gap:10px">
      <h3 style="margin:0;white-space:nowrap">\u2B50 Top Buys <span class="mini" style="font-weight:400;color:var(--text2)">(${top.length})</span></h3>
      <span class="mini" style="color:var(--text2);text-align:right">tick names, then Draft selected</span>
    </div>
    <div style="flex:1 1 auto;min-height:0;overflow:auto;margin:-2px -2px 0;padding:2px">${top.map(row).join("")}</div>
    <div id="tbSelBar" style="display:none;align-items:center;gap:10px;margin-top:8px;padding:8px 10px;background:var(--panel2);border-radius:8px">
      <span class="mini" id="tbSelCount" style="color:var(--text2)"></span>
      <div style="flex:1"></div>
      <button class="btn sec2" data-act="clearTbSel" style="font-size:11px;padding:4px 10px">Clear</button>
      <button class="btn" data-act="openDraftSelected" style="font-size:11px;padding:4px 10px">\u2795 Draft selected</button>
    </div>
  </div>`;
  updateTbSelBar();
  renderTopSector();
  renderTopHeadroom();
}

function toggleTbSel(tk, on) {
  window.__tbSel = window.__tbSel || {};
  if (on) window.__tbSel[tk] = true;
  else delete window.__tbSel[tk];
  updateTbSelBar();
}
function clearTbSel() {
  window.__tbSel = {};
  document.querySelectorAll(".tb-chk").forEach((c) => (c.checked = false));
  updateTbSelBar();
}
function updateTbSelBar() {
  const bar = document.getElementById("tbSelBar");
  if (!bar) return;
  const n = Object.keys(window.__tbSel || {}).length;
  bar.style.display = n ? "flex" : "none";
  const c = document.getElementById("tbSelCount");
  if (c) c.textContent = n + " name" + (n === 1 ? "" : "s") + " selected";
}

// Sector allocation donut for the companion card (current holdings by sector)
let CH_topSector = null,
  CH_topCycle = null,
  CH_topStyle = null;
function renderTopSector() {
  const wrap = document.getElementById("topSectorWrap");
  if (!wrap) return;
  const { pos } = runFIFO();
  const held = Object.values(pos).filter((p) => p.held > 0 && p.value > 0);
  // Donuts exclude OPCVM funds (they have no sector/cycle/style classification);
  // OPCVM still counts in Sector Headroom below.
  const heldStocks = held.filter((p) => !((M[p.ticker] || {}).cat === "OPCVM"));
  // Build a value breakdown by any metadata field, sorted desc.
  const breakdown = (field, fallback) => {
    const by = {};
    heldStocks.forEach((p) => {
      const m = M[p.ticker] || {};
      const k =
        m[field] != null && ("" + m[field]).trim()
          ? ("" + m[field]).trim()
          : fallback;
      by[k] = (by[k] || 0) + p.value;
    });
    const total = Object.values(by).reduce((a, b) => a + b, 0);
    const data = Object.keys(by)
      .map((k) => ({ name: k, y: by[k] }))
      .sort((a, b) => b.y - a.y);
    return { data, total };
  };
  const sec = breakdown("cat", "Uncategorized");
  const cyc = breakdown("cycle", "Unclassified");
  const sty = breakdown("style", "Unclassified");
  const total = sec.total;
  if (!sec.data.length) {
    wrap.innerHTML =
      '<div class="sec" style="padding:12px 14px;margin:0;height:100%"><h3 style="margin:0 0 6px">\uD83E\uDD67 Your Mix</h3><div class="mini" style="color:var(--text2)">No holdings yet.</div></div>';
    return;
  }
  const topCat = sec.data[0],
    conc = total > 0 ? (topCat.y / total) * 100 : 0;
  const flag =
    conc >= 35
      ? '<span class="neg">\u26A0 ' +
        topCat.name +
        " " +
        conc.toFixed(0) +
        "% \u2014 concentrated</span>"
      : conc >= 25
        ? '<span style="color:var(--warn)">' +
          topCat.name +
          " " +
          conc.toFixed(0) +
          "% (top sector)</span>"
        : '<span class="pos">Well spread \u2014 top ' +
          topCat.name +
          " " +
          conc.toFixed(0) +
          "%</span>";

  // Compact donut column: small heading + chart div. The three sit side-by-side in a grid.
  const donutCol = (
    id,
    emoji,
    title,
    n,
  ) => `<div style="min-width:0;display:flex;flex-direction:column">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;margin:0 0 2px">
        <h3 style="margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px">${emoji} ${title}</h3>
        <span class="mini" style="color:var(--text2);flex:none">${n}</span>
      </div>
      <div id="${id}" style="height:180px"></div>
    </div>`;

  wrap.innerHTML = `<div class="sec" style="padding:12px 14px;margin:0;height:100%;display:flex;flex-direction:column">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;gap:8px">
      <h3 style="margin:0;white-space:nowrap">\uD83E\uDD67 Your Mix</h3>
      <span class="mini" style="color:var(--text2)">${money(total, 0)} MAD</span>
    </div>
    <div class="mini" style="margin-bottom:6px">${flag}</div>
    <div style="flex:1;min-height:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;align-items:start">
      ${donutCol("topSectorChart", "\uD83C\uDFE6", "By Sector", sec.data.length)}
      ${donutCol("topCycleChart", "\uD83D\uDD04", "By Cycle", cyc.data.length)}
      ${donutCol("topStyleChart", "\uD83C\uDFA8", "By Asset Style", sty.data.length)}
    </div>
  </div>`;
  const tx = themeColor("text");
  const donut = (id, data, h) => {
    try {
      return Highcharts.chart(id, {
        chart: { type: "pie", backgroundColor: "transparent", height: h },
        title: { text: null },
        credits: { enabled: false },
        legend: { enabled: false },
        tooltip: {
          pointFormat: "<b>{point.y:,.0f} MAD</b> ({point.percentage:.1f}%)",
        },
        plotOptions: {
          pie: {
            innerSize: "56%",
            dataLabels: {
              enabled: true,
              style: { color: tx, fontSize: "10px", textOutline: "none" },
              format: "{point.name}: {point.percentage:.0f}%",
              distance: 6,
              connectorWidth: 1,
            },
          },
        },
        series: [{ name: "Value", data: data }],
      });
    } catch (e) {
      console.error(id, e);
      return null;
    }
  };
  CH_topSector = donut("topSectorChart", sec.data, 180);
  CH_topCycle = donut("topCycleChart", cyc.data, 180);
  CH_topStyle = donut("topStyleChart", sty.data, 180);
}

// Sector headroom card (card 3) \u2014 current sector weight vs the concentration cap set on the Rebalance tab.
function renderTopHeadroom() {
  const wrap = document.getElementById("topHeadroomWrap");
  if (!wrap) return;
  const { pos } = runFIFO();
  const held = Object.values(pos).filter((p) => p.held > 0 && p.value > 0);
  const byCat = {};
  held.forEach((p) => {
    const cat = (M[p.ticker] && M[p.ticker].cat) || "Uncategorized";
    byCat[cat] = (byCat[cat] || 0) + p.value;
  });
  const total = Object.values(byCat).reduce((a, b) => a + b, 0);
  const data = Object.keys(byCat)
    .map((k) => ({ name: k, y: byCat[k] }))
    .sort((a, b) => b.y - a.y);
  const capPct = Math.min(
    60,
    Math.max(
      5,
      parseFloat((document.getElementById("rbCap") || {}).value) || 20,
    ),
  );
  const capOpcvm = Math.min(
    80,
    Math.max(
      5,
      parseFloat((document.getElementById("rbCapOpcvm") || {}).value) || 35,
    ),
  );
  const capForP = (cat) => (cat === "OPCVM" ? capOpcvm : capPct);
  if (!data.length) {
    wrap.innerHTML =
      '<div class="sec" style="padding:12px 14px;margin:0;height:100%;display:flex;flex-direction:column"><h3 style="margin:0 0 6px">\uD83D\uDCCA Sector Headroom</h3><div class="mini" style="color:var(--text2)">No holdings yet.</div></div>';
    return;
  }
  // sorted by current weight, highest first (matches the Sector Mix ordering)
  const rowsData = data
    .map((d) => {
      const cap = capForP(d.name);
      const w = total > 0 ? (d.y / total) * 100 : 0;
      return { name: d.name, w, cap, room: cap - w };
    })
    .sort((a, b) => b.w - a.w); // highest current weight first
  const overN = rowsData.filter((r) => r.w > r.cap + 1e-9).length;
  const nearN = rowsData.filter(
    (r) => r.w <= r.cap + 1e-9 && r.w >= r.cap * 0.8,
  ).length;
  const flag = overN
    ? '<span class="neg">\u26A0 ' +
      overN +
      " sector" +
      (overN === 1 ? "" : "s") +
      " over cap</span>"
    : nearN
      ? '<span style="color:var(--warn)">' +
        nearN +
        " near cap (\u226580%)</span>"
      : '<span class="pos">All sectors within cap</span>';
  const hrRows = rowsData
    .map((d) => {
      const fill = Math.min(100, d.cap > 0 ? (d.w / d.cap) * 100 : 0);
      const over = d.w > d.cap + 1e-9;
      const near = !over && d.w >= d.cap * 0.8;
      const col = over
        ? "var(--error)"
        : near
          ? "var(--warn)"
          : "var(--success)";
      const capTag =
        d.name === "OPCVM"
          ? ' <span class="mini" style="color:var(--text2)">(fund cap)</span>'
          : "";
      const roomTxt = over
        ? "+" + (d.w - d.cap).toFixed(0) + "% over"
        : d.room.toFixed(0) + "% room";
      return `<div style="margin-bottom:7px" data-tip="${escapeHtml(d.name)}: ${d.w.toFixed(1)}% of portfolio vs ${d.cap.toFixed(0)}% cap \u2014 ${over ? "over the cap by " + (d.w - d.cap).toFixed(1) + " pts" : d.room.toFixed(1) + " pts of headroom before the cap"}">
      <div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;margin-bottom:2px">
        <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(d.name)}${capTag}</span>
        <span style="font-family:var(--mono);color:${col};flex:none">${d.w.toFixed(0)}% \u00B7 ${roomTxt}</span>
      </div>
      <div style="position:relative;height:7px;border-radius:5px;background:var(--panel2);overflow:hidden">
        <div style="position:absolute;left:0;top:0;bottom:0;width:${fill}%;background:${col};border-radius:5px;transition:width .3s"></div>
      </div>
    </div>`;
    })
    .join("");
  wrap.innerHTML = `<div class="sec" style="padding:12px 14px;margin:0;height:100%;display:flex;flex-direction:column">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;gap:8px">
      <h3 style="margin:0;white-space:nowrap">\uD83D\uDCCA Sector Headroom</h3>
      <span class="mini" style="color:var(--text2);cursor:help" data-tip="Each bar shows a sector's current share of your portfolio against the concentration cap set on the Rebalance tab. Green = room to add \u00B7 amber = getting close (\u226580% of cap) \u00B7 red = over the cap. OPCVM funds use a separate, higher cap.">vs ${capPct.toFixed(0)}% \u00B7 OPCVM ${capOpcvm.toFixed(0)}% \u24D8</span>
    </div>
    <div class="mini" style="margin-bottom:6px">${flag}</div>
    <div style="flex:1;min-height:0;overflow:auto">${hrRows}</div>
    <div class="mini" style="color:var(--text2);margin-top:6px;text-align:right"><a href="#" data-act="gotoTab" data-args="rebalance" style="color:var(--info)">Adjust cap \u2192</a></div>
  </div>`;
}

function openDraftSelected() {
  const sel = Object.keys(window.__tbSel || {});
  const top = window.__topBuys || [];
  const picks = top.filter((r) => sel.includes(r.ticker));
  if (!picks.length) {
    toast("Tick at least one name first.", "warn");
    return;
  }
  let ov = document.getElementById("draftSelOverlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "draftSelOverlay";
    ov.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px";
    ov.onclick = (e) => {
      if (e.target === ov) closeDraftSelected();
    };
    document.body.appendChild(ov);
  }
  const rowH = picks
    .map((r) => {
      const px = r.price != null && isFinite(r.price) ? r.price : null; // LIVE price = what you actually pay
      const tb = r.tbuy != null && isFinite(r.tbuy) ? r.tbuy : null; // target buy = ideal entry (reference only)
      return `<tr data-tk="${escapeHtml(r.ticker)}" data-px="${px || ""}">
      <td class="l"><b>${escapeHtml(r.ticker)}</b> <span class="mini" style="color:var(--text2)">${escapeHtml(r.name || "")}</span></td>
      <td style="text-align:right;font-family:var(--mono)"><b>${px != null ? money(px) : "\u2014"}</b></td>
      <td style="text-align:right;font-family:var(--mono);color:var(--text2)">${tb != null ? money(tb) : "\u2014"}</td>
      <td style="text-align:right"><input type="number" min="0" step="100" class="ds-amt" value="10000" style="width:100px;text-align:right" data-act="recalcDraftSel" data-on="input"></td>
      <td style="text-align:right;font-family:var(--mono)" class="ds-qty">\u2014</td>
      <td style="text-align:right;font-family:var(--mono)" class="ds-cost">\u2014</td>
    </tr>`;
    })
    .join("");
  ov.innerHTML = `<div class="sec" style="max-width:640px;width:100%;max-height:85vh;overflow:auto;margin:0;padding:16px 18px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
      <h2 style="margin:0">\u2795 Draft selected buys <span class="mini" style="font-weight:400">\u2014 ${picks.length} name${picks.length === 1 ? "" : "s"}</span></h2>
      <button class="btn sec2" data-act="closeDraftSelected" style="padding:2px 10px" aria-label="Close" title="Close">\u2715</button>
    </div>
    <div class="mini" style="color:var(--text2);margin-bottom:10px">Enter how much to buy for each (MAD). Quantity is computed at the live market price (what you pay), rounded down. Edit or set 0 to skip a name.</div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <span class="mini" style="color:var(--text2)">Set all to</span>
      <input type="number" min="0" step="500" id="dsAll" value="10000" style="width:110px;text-align:right">
      <button class="btn sec2" data-act="applyDraftAll" style="font-size:11px;padding:4px 10px">Apply to all</button>
    </div>
    <table><thead><tr>
      <th scope="col" class="l">Name</th><th scope="col" style="text-align:right" data-tip="Live market price \u2014 what you actually pay now">Live px</th><th scope="col" style="text-align:right" data-tip="Target buy (ideal entry below fair value) \u2014 reference only">Tgt buy</th><th scope="col" style="text-align:right">Amount MAD</th><th scope="col" style="text-align:right">Qty</th><th scope="col" style="text-align:right">Est. cost</th>
    </tr></thead><tbody id="dsBody">${rowH}</tbody>
    <tfoot><tr style="border-top:2px solid var(--border);font-weight:700">
      <td class="l">Total</td><td></td><td></td><td></td><td style="text-align:right" id="dsQtyTot">\u2014</td><td style="text-align:right;font-family:var(--mono)" id="dsCostTot">\u2014</td>
    </tr></tfoot></table>
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px">
      <button class="btn sec2" data-act="closeDraftSelected">Cancel</button>
      <button class="btn" data-act="commitDraftSelected">Push to Pending</button>
    </div>
  </div>`;
  recalcDraftSel();
}
function applyDraftAll() {
  const v = document.getElementById("dsAll").value;
  document
    .querySelectorAll("#dsBody .ds-amt")
    .forEach((inp) => (inp.value = v));
  recalcDraftSel();
}
function recalcDraftSel() {
  let qTot = 0,
    cTot = 0;
  document.querySelectorAll("#dsBody tr").forEach((tr) => {
    const px = parseFloat(tr.getAttribute("data-px"));
    const amt = parseFloat(tr.querySelector(".ds-amt").value);
    const _fund = isOpcvmTk(tr.getAttribute("data-tk"));
    let qty = 0,
      cost = 0;
    if (isFinite(px) && px > 0 && isFinite(amt) && amt > 0) {
      qty = buyableQty(px, amt, _fund);
      cost = qty * px;
    }
    tr.querySelector(".ds-qty").textContent =
      qty > 0 ? money(qty, _fund && qty % 1 ? 4 : 0) : "\u2014";
    tr.querySelector(".ds-cost").textContent =
      cost > 0 ? money(cost, 0) : "\u2014";
    qTot += qty;
    cTot += cost;
  });
  document.getElementById("dsQtyTot").textContent =
    qTot > 0 ? money(qTot, qTot % 1 ? 2 : 0) : "\u2014";
  document.getElementById("dsCostTot").textContent =
    cTot > 0 ? money(cTot, 0) + " MAD" : "\u2014";
}
function commitDraftSelected() {
  const today = new Date().toISOString().slice(0, 10);
  let added = 0;
  document.querySelectorAll("#dsBody tr").forEach((tr) => {
    const tk = tr.getAttribute("data-tk");
    const px = parseFloat(tr.getAttribute("data-px"));
    const amt = parseFloat(tr.querySelector(".ds-amt").value);
    if (!(isFinite(px) && px > 0 && isFinite(amt) && amt > 0)) return;
    const m = M[tk];
    const isOpcvm = !!(m && m.cat === "OPCVM");
    const qty = buyableQty(px, amt, isOpcvm);
    if (qty <= 0) return;
    PENDING.push({
      date: today,
      ticker: tk,
      action: "BUY",
      qty: qty,
      price: px,
      pea: true,
      opcvm: isOpcvm,
      broker: "attijari",
    });
    added++;
  });
  if (!added) {
    toast(
      "Nothing to draft \u2014 set an amount for at least one name.",
      "warn",
    );
    return;
  }
  savePending();
  closeDraftSelected();
  window.__tbSel = {};
  gotoTab("pending");
  if (typeof renderPending === "function") renderPending();
  const hint = document.getElementById("pendHint");
  if (hint) {
    hint.style.color = "var(--info)";
    hint.textContent =
      "Drafted " +
      added +
      " pending buy" +
      (added === 1 ? "" : "s") +
      " from your Top Buys selection. Review quantities before confirming.";
  }
}
function closeDraftSelected() {
  const ov = document.getElementById("draftSelOverlay");
  if (ov) ov.remove();
}
