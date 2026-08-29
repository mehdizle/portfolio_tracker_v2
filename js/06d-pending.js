// 06d-pending.js - split from 06-features.js (pending orders + indicators + tooltips, recently sold/bought). Shared scope.
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
  // Pending orders feed the Dashboard KPI row (Cash Available, Pending Orders,
  // Upcoming Dividends). Refresh it here - at the single save point - so those
  // cards stay in sync no matter which tab changed an order. Guarded + a no-op
  // when the dashboard isn't mounted.
  if (typeof refreshKpiRow === "function") refreshKpiRow();
}
let PEND_EDIT = null;
function readPendingForm() {
  const g = (id) => document.getElementById(id);
  // Schema-driven: the field list (and each field's p-prefixed input id + kind)
  // comes from __core.txnSchema.pendingFormFields(), so a new transaction field
  // is read from the pending form automatically. The per-kind DOM coercion below
  // matches the previous hand-written reads exactly (no behaviour change).
  const o = {};
  for (const f of __core.txnSchema.pendingFormFields()) {
    const el = g(f.pform);
    if (!el) continue;
    if (f.kind === "checkbox") {
      o[f.key] = el.checked;
    } else if (f.key === "qty" || f.key === "price") {
      o[f.key] = parseFloat(el.value);
    } else if (f.key === "ticker") {
      o[f.key] = el.value.trim().toUpperCase();
    } else if (f.key === "total") {
      const tot = parseFloat(el.value);
      if (!isNaN(tot) && tot > 0) o[f.key] = tot; // only stored when > 0
    } else {
      o[f.key] = el.value;
    }
  }
  // OPCVM parity with the add form: derive unit price from Total / qty when the
  // price box is blank (funds are entered by Quantity + Total TTC).
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
  // Stash ex-date + eligibility basis so addTxn stores them (form has no field).
  _pendingDivMeta = exDate ? { exDate: exDate, eligBasis: elig } : null;
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
  // Schema-driven prefill for the plain value/checkbox fields (so a new field is
  // prefilled automatically). Fields needing special handling (broker fallback,
  // opcvm master-detect, kind badge, fund name) are done explicitly afterwards.
  const _special = { broker: 1, opcvm: 1 };
  for (const f of __core.txnSchema.pendingFormFields()) {
    if (_special[f.key]) continue;
    const el = document.getElementById(f.pform);
    if (!el) continue;
    if (f.kind === "checkbox") el.checked = !!o[f.key];
    else el.value = o[f.key] != null ? o[f.key] : "";
  }
  setKindBadge(document.getElementById("pKind"), o.ticker);
  {
    const _tt = document.getElementById("pTotal");
    if (_tt) _tt.dataset.auto = "";
  }
  {
    const _nf = document.getElementById("pFundName");
    if (_nf) _nf.value = (M[o.ticker] && M[o.ticker].name) || "";
  }
  // Prefill the broker select (was missing -> edits silently reset broker).
  {
    const _bs = document.getElementById("pBroker");
    if (_bs) {
      const _bv = o.broker || txnBroker(o);
      if (BROKERS[_bv]) _bs.value = _bv;
    }
  }
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
  // Dialog-driven fields (date/qty/price come from the fill dialog); the
  // remaining fields are carried from the pending order. The carry-key list is
  // derived from the shared schema (__core.txnSchema.pendingCarryKeys()), so a
  // new transaction field is carried from pending -> txn automatically instead
  // of being silently dropped here. Per-key resolution matches the prior code.
  const t = {
    date: String(fillDate).trim(),
    qty: fillQty,
    price: px,
  };
  for (const k of __core.txnSchema.pendingCarryKeys()) {
    if (k === "broker") {
      t.broker = o.broker || txnBroker(o);
    } else if (k === "pea") {
      t.pea = !!o.pea;
    } else if (k === "opcvm") {
      // opcvm is set only when true or the master flags the ticker as a fund.
      if (o.opcvm === true || (M[o.ticker] && M[o.ticker].cat === "OPCVM"))
        t.opcvm = true;
    } else {
      // ticker, action, and any future carried field: copy through.
      t[k] = o[k];
    }
  }
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
    .map((t) => `<option value="${escapeHtml(t)}">`)
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
      <input type="date" class="beDate" value="${escapeHtml(o.date)}" style="width:100%;box-sizing:border-box">
      <input list="beTickersPend" class="beTicker" value="${escapeHtml(o.ticker)}" placeholder="ticker" style="width:100%;box-sizing:border-box">
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
    tipRef(f.msg) +
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
  // Valuation references (single source of truth: the Signals engine). Fair
  // value + target buy/sell let you judge whether the order price is GOOD, not
  // just where it sits in the 52-wk range. OPCVM funds have no fair value -> the
  // helpers return null and we simply draw no zones/FV tick for them.
  let fvX = null,
    fv = null,
    tb = null,
    ts = null;
  try {
    const _sc = typeof factorScores === "function" ? factorScores(m) : null;
    fv = typeof fairValue === "function" ? fairValue(m) : null;
    tb = typeof targetBuy === "function" ? targetBuy(m, _sc) : null;
    ts = typeof targetSell === "function" ? targetSell(m, _sc) : null;
  } catch (_e) {}
  out.fv = fv;
  out.tb = tb;
  out.ts = ts;
  // Map a price to an x within the drawable track [5 .. barW-5], clamped.
  const xOf = (v) =>
    Math.round(
      5 + Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * (barW - 10),
    );
  let bar = '<div style="position:relative;height:18px;width:' + barW + 'px">';
  // Buy zone: from the left edge up to Target Buy (below TB = attractive entry).
  // Sell zone: from Target Sell to the right edge (above TS = attractive exit).
  // Drawn FIRST (under everything) as faint bands so they never obscure markers.
  if (tb != null && isFinite(tb)) {
    const tbX = xOf(tb);
    if (tbX > 5)
      bar +=
        '<div title="Buy zone (\u2264 target buy)" style="position:absolute;top:5px;left:5px;width:' +
        (tbX - 5) +
        'px;height:8px;background:rgba(34,197,94,.18);border-radius:2px"></div>';
  }
  if (ts != null && isFinite(ts)) {
    const tsX = xOf(ts);
    if (tsX < barW - 5)
      bar +=
        '<div title="Sell zone (\u2265 target sell)" style="position:absolute;top:5px;left:' +
        tsX +
        "px;width:" +
        (barW - 5 - tsX) +
        'px;height:8px;background:rgba(239,68,68,.18);border-radius:2px"></div>';
  }
  bar +=
    '<div style="position:absolute;top:7px;left:0;right:0;height:4px;background:linear-gradient(90deg,var(--success),var(--warn),var(--error));border-radius:2px"></div>';
  // Fair Value tick (neutral diamond) - the intrinsic-worth reference.
  if (fv != null && isFinite(fv)) {
    fvX = xOf(fv);
    out.fvX = fvX;
    bar +=
      '<div title="Fair value" style="position:absolute;top:6px;left:' +
      (fvX - 3) +
      'px;width:6px;height:6px;background:var(--text);transform:rotate(45deg);border-radius:1px;opacity:.85"></div>';
  }
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
              tipRef(_tip) +
              '">' +
              money(o.price) +
              ' <span style="color:var(--muted)">\u24d8</span></td>'
            );
          })()}
          ${(function () {
            // Range column: 52-wk range bar with valuation zones, mirroring the
            // Unit Px tooltip. Wider now to fit the buy/sell zones + fair-value
            // tick alongside the order & live-price markers.
            const rb = pendingRangeBar(o, 120, true);
            if (!rb.hasRange)
              return '<td class="center" style="color:var(--muted)">\u2014</td>';
            const _tip = pendingUnitPxTipHTML(o);
            return (
              '<td class="center" style="cursor:help" data-tip="' +
              tipRef(_tip) +
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
              tipRef(h) +
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
                  tipRef(
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
          <td>${money(o.qty, o.qty % 1 ? 3 : 0)}</td><td>${money(o.price)}</td><td class="pos nis-cell" style="cursor:help" data-tip="${tipRef(tip)}">${money(net)} <span style="color:var(--muted)">\u24D8</span></td>
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
