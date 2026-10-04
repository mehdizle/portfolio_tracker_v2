// ============================================================
// 06-transactions.js
// Transactions feature: the ledger table (renderTxns) + its fee/tax tooltips
// (ttcTipHTML, autoDivTip), the ticker datalist, and the shared Add-Transaction
// / Add-Pending FORM helpers (live total calc, OPCVM kind-badge detection, fund
// registration) used by both the Transactions and Pending forms. Renamed from
// 06-features.js after the signals/dividends code moved to their own modules -
// what remains is transactions + the shared transaction-form logic.
// Part of the Portfolio Tracker app. Loaded as an ordered plain <script>
// (shared global scope via scripts/concat.mjs).
// ============================================================
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
    h += `<div style="color:var(--info);font-size:11px;margin:4px 0 2px;font-weight:700">\uD83C\uDFE6 OPCVM fund${meta.name ? " \u2014 " + escapeHtml(meta.name) : ""}</div>`;
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
      <td class="center" style="font-size:10px;color:var(--text2)">${t._ord ? escapeHtml(String(t._ord)) : "\u2014"}</td>
      <td class="center" style="white-space:nowrap"><button class="chip" style="cursor:pointer;border:none;margin-right:4px" data-act="editTxn" data-args="${i}" aria-label="Edit transaction" data-tip="Edit this transaction">\u270E</button><button class="chip" style="cursor:pointer;border:none" data-act="delTxn" data-args="${i}" aria-label="Delete transaction" data-tip="Delete this transaction (re-computes FIFO cost basis and realized gains)">\u2715</button></td></tr>`;
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
      if (typeof CH_dashAlloc !== "undefined" && CH_dashAlloc)
        setTimeout(() => CH_dashAlloc.reflow(), 10);
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
      // Signal Scorecard is its own tab now. Refresh the trail from the current
      // signals (so a call gets recorded even if the Signals tab wasn't opened
      // today), then render the outcome panel into this view's #sigOutcomes.
      if (b.dataset.view === "signalOutcomes") {
        try {
          snapshotSignalsNow();
        } catch (e) {
          console.error("sig snapshot (scorecard)", e);
        }
        try {
          renderSignalOutcomes();
        } catch (e) {
          console.error("sig outcomes", e);
        }
      }
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
