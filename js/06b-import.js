// 06b-import.js - split from 06-features.js (TradingView/OPCVM/CSV import, fee panel, theme, calendar). Shared scope; concatenated by scripts/concat.mjs.
// ---------- price refresh (TradingView paste) + fetch-latest: extracted to js/06k-price-import.js ----------

// ---------- OPCVM performance-file import: extracted to js/06g-opcvm-import.js ----------

// ---------- Match funds to ASFIM (auto NAV history): extracted to js/06h-fund-match.js ----------

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

// ---------- CSV import / export: extracted to js/06l-csv-import.js ----------

// ---------- fees explainer values + dividend-tax-by-year editor ----------
function renderDivTax() {
  const yrs = Object.keys(DIVTAX)
    .map(Number)
    .sort((a, b) => a - b);
  document.querySelector("#divTaxTable tbody").innerHTML =
    yrs
      .map(
        (y) => `<tr>
    <td class="l">${y}</td><td>${(DIVTAX[y] * 100).toFixed(2)}%</td>
    <td class="center"><button class="chip" style="cursor:pointer;border:none" data-act="delYear" data-args="${y}" aria-label="Delete year" data-tip="Delete this year's dividend-tax rate">\u2715</button></td></tr>`,
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
// Holds ex-date / eligible-shares basis for a dividend being added or edited,
// since the transaction form has no visible field for them. addTxn merges it.
let _pendingDivMeta = null;
window.editTxn = function (i) {
  const t = TXNS[i];
  if (!t) return;
  EDIT_IX = i;
  // Preserve DIV ex-date / eligibility basis across an edit (no visible field).
  _pendingDivMeta =
    t.action === "DIV" && (t.exDate != null || t.eligBasis != null)
      ? { exDate: t.exDate, eligBasis: t.eligBasis }
      : null;
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
  // Prefill the broker select so editing doesn't silently reset it to the
  // default. Use the stored broker, else the resolved fallback (txnBroker).
  {
    const _bs = document.getElementById("tBroker");
    if (_bs) {
      const _bv = t.broker || txnBroker(t);
      if (BROKERS[_bv]) _bs.value = _bv;
    }
  }
  document.getElementById("tOpcvm").checked = isOpcvmTxn(t);
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
  _pendingDivMeta = null;
  document.getElementById("addTxn").textContent = "Add";
  document.getElementById("cancelEdit").style.display = "none";
  document.getElementById("editHint").textContent = "";
  document.getElementById("tQty").value = "";
  document.getElementById("tPrice").value = "";
  document.getElementById("tTotal").value = "";
  document.getElementById("txnCalc").textContent = "";
};

// ---------- light / dark mode toggle: extracted to js/06f-theme.js ----------

// ---------- dividend calendar import: extracted to js/06m-divcal-import.js ----------

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
  // SCHEMA-DRIVEN: header + sample rows are generated from __core.txnSchema so a
  // new transaction field (e.g. Order ID) appears in the template automatically
  // and can never drift from the real import/export columns.
  const S = __core.txnSchema;
  const ctx = {
    resolveBroker: (t) => t.broker || (t.opcvm ? "attijari" : "saham"),
  };
  const samples = [
    {
      date: "2026-01-15",
      ticker: "ATW",
      action: "BUY",
      qty: 10,
      price: 680,
      pea: false,
      opcvm: false,
      broker: "saham",
    },
    {
      date: "2026-03-20",
      ticker: "ATW",
      action: "SELL",
      qty: 5,
      price: 720,
      pea: false,
      opcvm: false,
      broker: "saham",
    },
    {
      date: "2026-06-22",
      ticker: "ATW",
      action: "DIV",
      qty: 10,
      price: 22,
      pea: false,
      opcvm: false,
      broker: "saham",
    },
    {
      date: "2026-02-04",
      ticker: "FCP A",
      action: "BUY",
      qty: 8.435,
      price: 831.8,
      pea: false,
      opcvm: true,
      total: 7025,
      broker: "attijari",
    },
    {
      date: "2026-02-04",
      ticker: "FCP B",
      action: "BUY",
      qty: 2.34,
      pea: false,
      opcvm: true,
      total: 2990.35,
      broker: "attijari",
    },
  ];
  const lines = [S.csvHeader().join(",")];
  for (const s of samples) lines.push(S.txnToCsvRow(s, ctx).join(","));
  lines.push(
    "# date=YYYY-MM-DD \u00B7 action=BUY/SELL/DIV \u00B7 pea=yes/no \u00B7 opcvm=yes/no (fund? auto-detected for known funds) \u00B7 total=OPCVM total TTC (optional, blank for stocks) \u00B7 qty=shares (or share count for DIV)  price=unit price MAD (or dividend/share for DIV)",
    "# broker=saham/attijari (optional). Blank -> auto: funds->attijari, stocks->saham. It sets the fee model, so fill it if you use a specific broker.",
    "# orderid=optional. Fills of ONE broker order (split executions) share the same Order ID so the per-order courtage minimum is charged once. Leave blank for single fills.",
    "# OPCVM funds: you can leave price BLANK and give total only \u2014 unit price is derived as total/qty on import (see FCP B row above).",
    "# Optional columns for auto-recorded dividends (exdate,eligbasis,auto) re-import automatically \u2014 you don't need to fill them by hand.",
  );
  downloadText("transactions_template.csv", lines.join("\n"));
};
// ---------- dividend calendar template download: extracted to js/06m-divcal-import.js ----------

// prices updated stamp
(function () {
  const el = document.getElementById("pricesStamp");
  if (el && SEED.prices_updated)
    el.textContent = "Prices as of " + SEED.prices_updated;
})();

// ---------- editable fee panel: extracted to js/06i-fee-panel.js ----------

// ---------- Positions: editable price + hide closed: extracted to js/06j-positions-edit.js ----------
