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
        `\u26A0 <b>${escapeHtml(p.ticker)}</b> (${escapeHtml((M[p.ticker] && M[p.ticker].name) || p.ticker)}) is <b>${(w * 100).toFixed(0)}%</b> of your portfolio \u2014 consider trimming for diversification.`,
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
        `\u26A0 Sector <b>${escapeHtml(c)}</b> is <b>${(w * 100).toFixed(0)}%</b> of your portfolio \u2014 high sector concentration.`,
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
  // Cash available (all accounts) - same source as the KPI card. Total Portfolio
  // = held market value + cash; Total if sold = net-if-sold (after exit fees/tax)
  // + cash. Guarded so a missing runFIFO can't throw here.
  let _cash = 0;
  try {
    _cash =
      typeof dashCashAvailable === "function"
        ? dashCashAvailable(
            (typeof runFIFO === "function" && runFIFO().enriched) || [],
          )
        : 0;
  } catch (_e) {}
  const _totalInclCash = t.val + _cash;
  const _totalIfSold = t.net + _cash;
  // Both totals colored by the overall profit/loss verdict (lifetime return
  // sign) - consistent with the "in profit / in loss" text beside them.
  const verdictCls = cls(t.life);
  el.innerHTML =
    // Main value card. Left = label/value/lifetime; Right (smaller) = the two
    // portfolio totals, tucked inside this same card (no extra grid column).
    '<div class="hero-main">' +
    '<div class="hero-main-left nis-cell" style="cursor:help" data-tip="' +
    tipRef(
      tipHead("Portfolio value") +
        tipRow("Held market value", money(t.val, 0) + " MAD") +
        tipRule() +
        tipRow(
          "Lifetime return",
          (t.life >= 0 ? "+" : "") + money(t.life, 0) + " MAD",
        ) +
        tipRow("ROI", pct(roi)) +
        tipNote(
          "Current market value of everything you still hold (shares x live price). Lifetime return = unrealized + realized + dividends, as a % of the cash you invested.",
        ),
    ) +
    '">' +
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
    '<div class="hero-totals">' +
    '<div class="hero-total nis-cell" style="cursor:help" data-tip="' +
    tipRef(
      tipHead("Total Portfolio") +
        tipRow("Held market value", money(t.val, 0) + " MAD") +
        tipRow("+ Cash (all accounts)", money(_cash, 0) + " MAD") +
        tipRow("= Total Portfolio", money(_totalInclCash, 0) + " MAD") +
        tipNote(
          "Everything you own right now at live prices, plus uninvested cash across every account. This is your gross net worth in the app, before any exit fees or tax.",
        ),
    ) +
    '"><div class="k">Total Portfolio</div><div class="v ' +
    verdictCls +
    '">' +
    money(_totalInclCash, 0) +
    ' <span class="u">MAD</span></div><div class="mini">incl. cash ' +
    money(_cash, 0) +
    "</div></div>" +
    '<div class="hero-total nis-cell" style="cursor:help" data-tip="' +
    tipRef(
      tipHead("Total if sold") +
        tipRow("Net if sold (holdings)", money(t.net, 0) + " MAD") +
        tipRow("+ Cash (all accounts)", money(_cash, 0) + " MAD") +
        tipRow("= Total if sold", money(_totalIfSold, 0) + " MAD") +
        tipNote(
          "What you would actually walk away with if you liquidated everything today: market value minus estimated broker commission and capital-gains tax on each holding, plus your cash.",
        ),
    ) +
    '"><div class="k">Total if sold</div><div class="v ' +
    verdictCls +
    '">' +
    money(_totalIfSold, 0) +
    ' <span class="u">MAD</span></div><div class="mini">net of exit fees &amp; tax</div></div>' +
    "</div>" +
    "</div>" +
    '<div class="hero-card nis-cell" style="cursor:help" data-tip="' +
    tipRef(
      tipHead("Invested (held)") +
        tipRow("Cost basis of holdings", money(t.inv, 0) + " MAD") +
        tipRow(
          "Unrealized P&L",
          (t.unreal >= 0 ? "+" : "") + money(t.unreal, 0) + " MAD",
        ) +
        tipNote(
          "The cash cost basis of the shares you still hold (FIFO). Unrealized P&L = current market value minus that cost basis - paper gain/loss not yet locked in.",
        ),
    ) +
    '"><div class="k">Invested (held)</div><div class="v">' +
    money(t.inv, 0) +
    '</div><div class="mini">unrealized <span class="' +
    cls(t.unreal) +
    '">' +
    (t.unreal >= 0 ? "+" : "") +
    money(t.unreal, 0) +
    "</span></div></div>" +
    '<div class="hero-card nis-cell" style="cursor:help" data-tip="' +
    tipRef(
      tipHead("Realized + Dividends") +
        tipRow("Realized gains (locked in)", money(t.real, 0) + " MAD") +
        tipRow("Dividends received (net)", money(t.div, 0) + " MAD") +
        tipRow("= Total", money(t.real + t.div, 0) + " MAD") +
        tipNote(
          "Money already banked: realized = profit/loss on shares you have sold (FIFO, net of fees/tax); dividends = cash distributions received, net of dividend tax.",
        ),
    ) +
    '"><div class="k">Realized + Dividends</div><div class="v">' +
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
  const byCat = sumValueByField(held, "cat", "Uncategorized");
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
  const meta = M[p.ticker];
  const _isOpcvm = isOpcvm(p.ticker);
  let h = compact
    ? ""
    : `<div style="font-weight:700;margin-bottom:6px">If sold today \u00B7 ${escapeHtml(p.account)} account</div>`;
  h += row("Gross (market value)", money(gross) + " MAD");
  if (_isOpcvm) {
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
  return `${p.acctList ? (p.acctList.length > 1 ? ' <span class="chip" data-tip="Combined: held in BOTH a PEA (tax-exempt) and a Regular (taxable) account. Expand the row to see the per-account split." style="background:rgba(139,92,246,.16);color:#a78bfa;cursor:help">PEA+Reg</span>' : p.acctList[0] === "PEA" ? ' <span class="chip" data-tip="Held in a PEA account \u2014 capital gains are tax-exempt." style="background:rgba(56,189,248,.15);color:var(--info);cursor:help">PEA</span>' : '<span class="chip" data-tip="Held in a Regular (taxable) account \u2014 capital gains are subject to TPCVM tax." style="background:var(--panel2);color:var(--muted);cursor:help">REG</span>') : p.isPea ? ' <span class="chip" data-tip="Held in a PEA account \u2014 capital gains are tax-exempt." style="background:rgba(56,189,248,.15);color:var(--info);cursor:help">PEA</span>' : '<span class="chip" data-tip="Held in a Regular (taxable) account \u2014 capital gains are subject to TPCVM tax." style="background:var(--panel2);color:var(--muted);cursor:help">REG</span>'}${(function () {
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
      : `<td class="nis-cell" style="cursor:help" data-tip="Last known market price per share. This position isn't currently held, so the price is shown for reference only.">${p.price != null ? money(p.price) : "\u2014"}</td>`;
  return `<td class="l" style="color:var(--text2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer" data-tip="Click for return waterfall" data-act="showPosWaterfall" data-args="${p.key}">${escapeHtml((M[p.ticker] && M[p.ticker].name) || "")} <span style="color:var(--muted)">\ud83d\udcca</span></td><td>${money(p.held, p.held % 1 ? 3 : 0)}</td><td>${money(p.avg)}</td>
    <td class="nis-cell" style="${p.held > 0 ? "cursor:help" : ""}" data-tip="${p.held > 0 ? "Total cash cost basis of the shares you still hold (FIFO, including all buy fees)." : ""}">${p.held > 0 ? money(p.invested) : "\u2014"}</td>${priceCell}
    <td class="nis-cell" style="${p.held > 0 ? "cursor:help" : ""}" data-tip="${p.held > 0 ? "Current market value = shares held x live price." : ""}">${p.held > 0 ? money(p.value) : "\u2014"}</td><td class="nis-cell" style="${p.netIfSold != null ? "cursor:help" : ""}" data-tip="${p.netIfSold != null ? tipRef(netIfSoldTipHTML(p)) : ""}">${p.netIfSold != null ? money(p.netIfSold) : "\u2014"}</td><td class="${cls(p.unreal)} ${p.held > 0 ? "nis-cell" : ""}" style="${p.held > 0 ? "cursor:help" : ""}" data-tip="${p.held > 0 ? tipRef(unrealTipHTML(p)) : ""}">${p.held > 0 ? money(p.unreal) : "\u2014"}</td>
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
    <td class="center"><span class="st-${p.status === "Closed" ? "closed" : "open"} nis-cell" style="cursor:help" data-tip="Position lifecycle: Open = still fully held, Partial = some shares sold, Closed = fully exited.">${p.status}</span></td>`;
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
// ---------- Signals row model + factor-breakdown tooltips moved to js/03b-signals-ui.js ----------
// (computeSignalsRows, tgtBuyTipHTML, tgtSellTipHTML, fvTipHTML, scoreTipHTML,
// convTipHTML now live in the signals-UI module.)

// ---- reusable tooltip builders moved to js/01b-tooltip.js ----
// (_tipRow / _tipHead / _tipRule now live in the tooltip module.)

// ---------- Signal factor tooltips + Top Buys/Sector/Headroom widgets moved to js/03b-signals-ui.js ----------
// (fairValueTipHTML, upsideTipHTML, pirTipHTML, peTipHTML, divyTipHTML,
// priceTipHTML, peerTipHTML, signalTipHTML, buyStrength, sellUrgency,
// topBuyRank, renderTopBuys/toggleTbSel/clearTbSel/updateTbSelBar,
// renderTopSector, renderTopHeadroom now live in the signals-UI module.)

// ============================================================
// Dashboard "Upcoming Dividends" summary widget (moved from 06-features.js:
// it renders into the Dashboard tab, not the Dividends tab).
// ============================================================
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
