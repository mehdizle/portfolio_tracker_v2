// ============================================================
// POSITIONS: EDITABLE PRICE / HIDE-CLOSED / GROUP-BY-SECTOR  (js/06j-positions-edit.js)
// ------------------------------------------------------------
// Extracted verbatim from js/06b-import.js (god-file decomposition, final
// large seam). Defines rerenderPositions + the window.* data-act handlers
// editPrice / showPosWaterfall / togglePosChildren / addMissingDiv (invoked
// at CLICK time via the delegated dispatcher - other files reference them
// only as data-act strings, so there is no load-order coupling), plus the
// hide-closed / group-by-sector toggles. Stays in the single concatenated
// IIFE; placed after 06i-fee-panel.js. Keeps publishing to window exactly
// as before, so the dispatcher (09-boot.js) still finds the handlers.
// ============================================================

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
  // Pass arr too: renderKPIs needs it to split held value into Stock vs OPCVM.
  // Omitting it left those Dashboard cards at 0 after toggling Show/Hide closed.
  renderKPIs(t, arr);
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
{
  const _gb = document.getElementById("toggleGroupSector");
  // Reflect GROUP_SECTOR on the button (label + active state). Called on load so
  // the restored preference shows correctly, and after each toggle.
  const _syncGroupBtn = () => {
    if (!_gb) return;
    _gb.textContent = GROUP_SECTOR
      ? "\uD83D\uDCCB Ungroup"
      : "\uD83D\uDDC2\uFE0F Group by sector";
    _gb.classList.toggle("active", GROUP_SECTOR);
  };
  _syncGroupBtn(); // restore saved state's label on load
  if (_gb)
    _gb.onclick = () => {
      GROUP_SECTOR = !GROUP_SECTOR;
      try {
        localStorage.setItem("casa_group_sector_v1", GROUP_SECTOR ? "1" : "0");
      } catch (e) {}
      _syncGroupBtn();
      rerenderPositions();
    };
}
