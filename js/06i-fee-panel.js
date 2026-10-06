// ============================================================
// BROKER FEE / TAX PANEL  (js/06i-fee-panel.js)
// ------------------------------------------------------------
// Extracted verbatim from js/06b-import.js (god-file decomposition).
// The editable broker-fee + dividend-tax (TPCVM) UI: tabs per broker, the
// fee form, and persistence via 02b-fees.js (BROKERS/FP/saveFees/etc.).
// All its symbols (CUR_BROKER, parsePct, fmtPct, renderBrokerTabs,
// renderBrokerFeeForm, loadFeeInputs) are referenced nowhere else. It calls
// loadFeeInputs() at load to paint the panel - that side effect is preserved
// by keeping this file in the single concatenated IIFE, loaded after
// 02b-fees.js (its data source). Placed after 06h-fund-match.js in concat.
// ============================================================

// ---------- editable fee panel ----------
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550 BROKER FEE UI \u2550\u2550\u2550\u2550\u2550\u2550\u2550
let CUR_BROKER = "saham"; // currently selected broker tab
function parsePct(str) {
  if (str == null) return null;
  let s = String(str).replace(/,/g, ".").replace(/%/g, "").trim();
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
      return `<button class="btn ${active ? "" : "sec2"} bkTab" data-bk="${escapeHtml(id)}" style="font-size:12px;padding:5px 14px;border-radius:14px">${escapeHtml(b.name)}</button>`;
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
    '<label data-tip="Display name for this broker, shown in the Broker dropdowns on transactions and pending orders."><span>Broker name</span> <input type="text" id="bk_name" value="' +
    bk.name +
    '"></label>';
  h +=
    '<label data-tip="Which fee model this broker uses. Rate-based = sum of percentage commissions plus a fixed courier fee (typical Regular account). Courtage-based = a single courtage % with a per-order minimum plus settlement and exchange fees (typical PEA). Changing this resets the fields to that model\'s defaults."><span>Fee formula</span> <select id="bk_feeType"><option value="regular"' +
    (bk.feeType === "regular" ? " selected" : "") +
    '>Rate-based (c.march\u00E9 + c.interm + c.r\u00E8gl + courier)</option><option value="pea"' +
    (bk.feeType === "pea" ? " selected" : "") +
    ">Courtage-based (courtage + r\u00E8gl + bourse)</option></select></label>";

  if (bk.feeType === "regular") {
    h +=
      '<label data-tip="Market commission: a % of the trade value charged by the broker. Part of the per-trade stock commission."><span>Commission de march\u00E9 (%)</span> <input type="text" id="bk_c_marche" value="' +
      fmtPct(f.c_marche) +
      '"></label>';
    h +=
      '<label data-tip="Intermediation commission: the broker\'s own % cut of the trade value, on top of the market commission."><span>Commission d\'interm\u00E9diation (%)</span> <input type="text" id="bk_c_interm" value="' +
      fmtPct(f.c_interm) +
      '"></label>';
    h +=
      '<label data-tip="Settlement/delivery commission: a % charged to settle and deliver the shares."><span>Commission r\u00E8glement/livraison (%)</span> <input type="text" id="bk_c_regl" value="' +
      fmtPct(f.c_regl) +
      '"></label>';
    h +=
      '<label data-tip="VAT (TVA) applied on top of the commissions above. In Morocco this is typically 10%."><span>VAT on fees (%)</span> <input type="text" id="bk_vat" value="' +
      fmtPct(f.vat) +
      '"></label>';
    h +=
      '<label data-tip="A fixed per-trade courier/handling fee in MAD (VAT added on top), charged regardless of trade size."><span>Frais de courrier (fixed, MAD)</span> <input type="text" id="bk_courier" value="' +
      (f.courier || 0) +
      '"></label>';
    h +=
      '<label data-tip="Fixed fee (MAD, before VAT) charged per OPCVM fund order, used instead of the stock commission for fund trades."><span>OPCVM order fee (MAD HT)</span> <input type="text" id="bk_opcvmOrder" value="' +
      (f.opcvmOrder || 0) +
      '"></label>';
    h +=
      '<label data-tip="Commission (%, before VAT) the broker takes on dividend payments received through this account."><span>Dividend commission (% HT)</span> <input type="text" id="bk_divComm" value="' +
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
      '<label data-tip="Brokerage commission: the broker\'s main % cut of the trade value (subject to the minimum below)."><span>Commission de courtage (%)</span> <input type="text" id="bk_courtage" value="' +
      fmtPct(f.courtage) +
      '"></label>';
    h +=
      '<label data-tip="Minimum courtage charged per order in MAD: if the % commission works out lower than this, you pay this instead. Applied once per broker order."><span>Courtage minimum (MAD)</span> <input type="text" id="bk_courtageMin" value="' +
      (f.courtageMin || 0) +
      '"></label>';
    h +=
      '<label data-tip="Settlement/delivery commission: a % charged to settle and deliver the shares."><span>Commission r\u00E8glement/livr. (%)</span> <input type="text" id="bk_regl" value="' +
      fmtPct(f.regl) +
      '"></label>';
    h +=
      '<label data-tip="Casablanca Stock Exchange fee: a % levied by the exchange on each trade."><span>Commission Bourse de Casa (%)</span> <input type="text" id="bk_bourse" value="' +
      fmtPct(f.bourse) +
      '"></label>';
    h +=
      '<label data-tip="VAT (TVA) applied on top of the commissions above. In Morocco this is typically 10%."><span>TVA on fees (%)</span> <input type="text" id="bk_vat" value="' +
      fmtPct(f.vat) +
      '"></label>';
    h +=
      '<label data-tip="Fixed fee (MAD, before VAT) charged per OPCVM fund order, used instead of the stock commission for fund trades."><span>OPCVM order fee (MAD HT)</span> <input type="text" id="bk_opcvmOrder" value="' +
      (f.opcvmOrder || 0) +
      '"></label>';
    h +=
      '<label data-tip="Commission (%, before VAT) the broker takes on dividend payments received through this account."><span>Dividend commission (% HT)</span> <input type="text" id="bk_divComm" value="' +
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
