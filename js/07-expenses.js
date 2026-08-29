// ============================================================
// 07-expenses.js
// expenses: the full e* Monthly Expenses module
// Part of the Portfolio Tracker app. Loaded as an ordered plain
// <script> (shared global scope) - order matters, see index.html.
// ============================================================
// ---------- Monthly Expenses module ----------
const E_LS = "casa_expenses_v1";
// Seed data intentionally empty \u2014 real data lives in localStorage / backup.
// A fresh browser starts blank by design. Restore from backup to load data.
const E_SEED_LOG = [];
const E_BILL_CATS = [
  { key: "loans", label: "Loans", color: "#38bdf8" }, // sky \u2014 high contrast on dark
  { key: "living", label: "Living & family", color: "#34d399" }, // emerald
  { key: "fixed", label: "Fixed / annualized", color: "#a78bfa" }, // violet
];
// Seed empty by design \u2014 user's bills come from localStorage / backup.
const E_DEFAULT_BILLS = [];
// Recompute a bill's monthly amt from its components (yearly => /12).
function eBillAmt(b) {
  if (b && Array.isArray(b.components) && b.components.length) {
    return b.components.reduce(
      (a, c) => a + (+c.amt || 0) * (c.freq === "yearly" ? 1 / 12 : 1),
      0,
    );
  }
  return +b.amt || 0;
}
const E_BUCKETS = [
  { key: "btOther", label: "BT Other" },
  { key: "mt", label: "MT" },
  { key: "car", label: "Car" },
  { key: "toMd", label: "To MD" },
];
// Recurring Car costs: each = {name, amt (positive $ that gets WITHDRAWN), months:[1..12]}.
// Seed empty by design \u2014 user's car plan comes from localStorage / backup.
const E_CARPLAN_SEED = [];
const E_CARPLAN_VER = 1;
let E_STATE = null;
const E_COMP_OPEN = new Set(); // bill indices whose component editor is expanded
// Re-seed version. The migration in eLoad is gated on E_DEFAULT_BILLS.length,
// so bumping this only re-seeds when there is real seed data \u2014 it can never wipe
// a user's saved bills when the seed is empty.
const E_BILLS_SEED_VER = 2;
function eFreshState() {
  // Fresh browser starts blank by design \u2014 real data comes from localStorage/backup.
  return {
    inc1: 0,
    inc2: 0,
    btToMd: 0,
    floatTarget: 0,
    startCash: 0,
    logYear: "all",
    billsSeedVer: E_BILLS_SEED_VER,
    bills: JSON.parse(JSON.stringify(E_DEFAULT_BILLS)),
    carPlan: JSON.parse(JSON.stringify(E_CARPLAN_SEED)),
    carPlanVer: E_CARPLAN_VER,
    log: JSON.parse(JSON.stringify(E_SEED_LOG)),
  };
}
function eLoad() {
  const raw = localStorage.getItem(E_LS);
  if (raw != null) {
    const parsed = safeParseLS(E_LS, raw, null, "Expenses");
    if (parsed.ok && parsed.value && typeof parsed.value === "object") {
      E_STATE = parsed.value;
      // Loan-draws panel is a transient UI state \u2014 always start collapsed on load.
      E_STATE._loanDrawsOpen = false;
      // Re-seed migration: only meaningful when there is actual seed data to apply.
      // With an empty E_DEFAULT_BILLS this must NOT run, or it would wipe the user's
      // saved bills. Gate on seed length so bumping the version can never destroy data.
      if (
        E_DEFAULT_BILLS.length &&
        (E_STATE.billsSeedVer || 0) < E_BILLS_SEED_VER
      ) {
        E_STATE.bills = JSON.parse(JSON.stringify(E_DEFAULT_BILLS));
        E_STATE.billsSeedVer = E_BILLS_SEED_VER;
        safeSetItem(E_LS, JSON.stringify(E_STATE));
      }
      // Shape guards: make sure the arrays every renderer dereferences actually exist,
      // so a hand-edited or older backup can't crash the Expenses tab with a TypeError.
      let _needSave = false;
      if (!Array.isArray(E_STATE.carPlan)) {
        E_STATE.carPlan = JSON.parse(JSON.stringify(E_CARPLAN_SEED));
        _needSave = true;
      }
      if (!Array.isArray(E_STATE.log)) {
        E_STATE.log = JSON.parse(JSON.stringify(E_SEED_LOG));
        _needSave = true;
      }
      if (!Array.isArray(E_STATE.bills)) {
        E_STATE.bills = JSON.parse(JSON.stringify(E_DEFAULT_BILLS));
        _needSave = true;
      }
      if (_needSave) safeSetItem(E_LS, JSON.stringify(E_STATE));
      return;
    }
    // parsed but not a usable object (corrupt or null) \u2014 fall through to a fresh state.
  }
  E_STATE = eFreshState();
}
function eSave() {
  safeSetItem(E_LS, JSON.stringify(E_STATE));
}
// ---- Per-bucket realized flags (per month, per bucket) ----
// Legacy data has a single row-wide r.realized boolean. We now support r.rz =
// {btOther,mt,car,toMd}. eRz reads the per-bucket flag, falling back to the legacy
// row flag so old data (and untouched rows) behave exactly as before.
function eRz(r, key) {
  if (r && r.rz && Object.prototype.hasOwnProperty.call(r.rz, key))
    return !!r.rz[key];
  return !!(r && r.realized);
}
// Set one bucket's realized flag. On first touch we seed r.rz for EVERY bucket from
// the legacy row flag, so toggling one bucket never silently changes the others.
function eSetRz(r, key, val) {
  if (!r) return;
  if (!r.rz) {
    r.rz = {};
    E_BUCKETS.forEach((b) => {
      r.rz[b.key] = !!r.realized;
    });
  }
  r.rz[key] = !!val;
  // Keep the legacy flag in sync (true if ANY bucket is realized) for code that still reads it.
  r.realized = E_BUCKETS.some((b) => !!r.rz[b.key]);
}
// Set every bucket at once (used by "Mark realized through this month").
function eSetRzAll(r, val) {
  if (!r) return;
  r.rz = r.rz || {};
  E_BUCKETS.forEach((b) => {
    r.rz[b.key] = !!val;
  });
  r.realized = !!val;
}
function eFmt(n) {
  return (Math.round(n * 100) / 100).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
}

function eCompute() {
  // Faithful reproduction of the Excel settlement:
  //   pool      = (inc1+inc2) - totalSharedBills           (leftover both keep, split evenly)
  //   totalMD   = inc1 - pool/2 ;  totalBT = inc2 - pool/2  (each gets income minus half the pool)
  //   toPayMD   = totalMD - (bills MD is assigned to pay)   (>0 => MD transfers to BT)
  //   toPayBT   = totalBT - (bills BT is assigned to pay)   (mirror)
  //   netMDtoBT = toPayMD - btToMd                          (BT's monthly payment nets against it)
  const s = E_STATE;
  const bills = Array.isArray(arguments[0]) ? arguments[0] : s.bills; // optional per-month bill set
  const inc1 = +s.inc1 || 0,
    inc2 = +s.inc2 || 0,
    btToMd = +s.btToMd || 0;
  const billsTot = bills.reduce((a, b) => a + eBillAmt(b), 0);
  const paidMD = bills
    .filter((b) => b.by === "MD")
    .reduce((a, b) => a + eBillAmt(b), 0);
  const paidBT = bills
    .filter((b) => b.by === "BT")
    .reduce((a, b) => a + eBillAmt(b), 0);
  const pool = inc1 + inc2 - billsTot;
  const totalMD = inc1 - pool / 2;
  const totalBT = inc2 - pool / 2;
  const toPayMD = totalMD - paidMD; // sheet C26 = 1240 with defaults
  const toPayBT = totalBT - paidBT; // sheet C27 = -1240
  const netMDtoBT = toPayMD - btToMd; // sheet D26 = 1185: MD -> BT after BT's monthly payment
  const share = billsTot / 2; // shown as "each partner's 50% of bills"
  const discMD = inc1 - totalMD; // = pool/2, the leftover each keeps
  const discBT = inc2 - totalBT;
  const ratio1 = inc1 / (inc1 + inc2 || 1),
    ratio2 = inc2 / (inc1 + inc2 || 1);
  return {
    inc1,
    inc2,
    btToMd,
    billsTot,
    paidMD,
    paidBT,
    share,
    pool,
    totalMD,
    totalBT,
    toPayMD,
    toPayBT,
    netMDtoBT,
    discMD,
    discBT,
    ratio1,
    ratio2,
  };
}

function eBucketTotals() {
  const s = E_STATE;
  const banked = {},
    proj = {};
  E_BUCKETS.forEach((b) => {
    banked[b.key] = 0;
    proj[b.key] = 0;
  });
  s.log.forEach((r) => {
    E_BUCKETS.forEach((b) => {
      const v = +r[b.key] || 0;
      proj[b.key] += v;
      if (eRz(r, b.key)) banked[b.key] += v;
    });
  });
  return { banked, proj };
}

// ===================== Sub-tabs =====================
function eShowTab(name) {
  E_STATE = E_STATE || null;
  if (!E_STATE) eLoad();
  E_STATE.uiTab = name;
  eSave();
  ["pots", "setup"].forEach((t) => {
    const p = document.getElementById("etab_" + t);
    if (p) p.style.display = t === name ? "block" : "none";
  });
  document.querySelectorAll("#expensesTabs .tab[data-etab]").forEach((b) => {
    const on = b.dataset.etab === name;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
}

// ===================== Per-month bills =====================
// Current viewing month for the "This Month" tab. Defaults to the latest realized
// month, else current calendar month.
function eCurMonth() {
  if (E_STATE.viewMonth && /^\d{4}-\d{2}$/.test(E_STATE.viewMonth))
    return E_STATE.viewMonth;
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
}
// List of months to offer in the nav: unique months from the log, plus current month.
function eMonthOptions() {
  const set = new Set();
  (E_STATE.log || []).forEach((r) => {
    if (/^\d{4}-\d{2}$/.test(r.month || "")) set.add(r.month);
  });
  const now = new Date();
  set.add(
    now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0"),
  );
  return [...set].sort();
}
// Effective bills for a given month = defaults, with any per-month override applied.
// Override shape: E_STATE.monthBills[month] = { [billIndex]: {off?, amt?, by?, note?} }
function eMonthBills(month) {
  const ov = (E_STATE.monthBills || {})[month] || {};
  const out = [];
  (E_STATE.bills || []).forEach((b, idx) => {
    const o = ov[idx] || {};
    if (o.off) return; // toggled off this month
    const amt = o.amt != null && o.amt !== "" ? +o.amt || 0 : eBillAmt(b);
    const by = o.by || b.by;
    out.push({
      name: b.name,
      amt,
      by,
      cat: b.cat,
      note: o.note || "",
      _idx: idx,
      _overridden: o.amt != null || o.by || o.off,
    });
  });
  return out;
}
function eMonthHasOverride(month) {
  const ov = (E_STATE.monthBills || {})[month];
  if (!ov) return false;
  return Object.keys(ov).length > 0;
}
function eSetMonthOverride(month, idx, patch) {
  E_STATE.monthBills = E_STATE.monthBills || {};
  E_STATE.monthBills[month] = E_STATE.monthBills[month] || {};
  const cur = E_STATE.monthBills[month][idx] || {};
  E_STATE.monthBills[month][idx] = { ...cur, ...patch };
  // prune empty override objects
  const o = E_STATE.monthBills[month][idx];
  if (!o.off && (o.amt == null || o.amt === "") && !o.by && !o.note) {
    delete E_STATE.monthBills[month][idx];
  }
  if (Object.keys(E_STATE.monthBills[month]).length === 0)
    delete E_STATE.monthBills[month];
}
function eClearMonth(month) {
  if (E_STATE.monthBills) delete E_STATE.monthBills[month];
}

function eMonthLabel(m) {
  const mm = /^(\d{4})-(\d{2})$/.exec(m);
  if (!mm) return m;
  const names = [
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
  return names[+mm[2] - 1] + " " + mm[1];
}

function eRenderMonthNav() {
  const box = document.getElementById("e_monthNav");
  if (!box) return;
  const cur = eCurMonth();
  box.innerHTML = `<div style="font-size:15px;font-weight:800;color:var(--text)">${eMonthLabel(cur)}</div>`;
}

function eRenderSettleBanner() {
  const el = document.getElementById("e_settleBanner");
  if (!el) return;
  const cur = eCurMonth();
  const bills = eMonthBills(cur);
  const c = eCompute(bills);
  const net = c.netMDtoBT; // >0 => MD sends to BT ; <0 => BT sends to MD
  const amt = Math.abs(Math.round(net));
  const mdToBt = net >= 0;
  const dirTxt =
    amt === 0
      ? "Nothing to settle this month"
      : "This month you " + (mdToBt ? "send" : "receive");
  const whoHTML =
    amt === 0
      ? '<span class="paypill md">MD</span> <span class="settle-arrow">=</span> <span class="paypill bt">BT</span>'
      : mdToBt
        ? '<span class="paypill md">MD</span> <span class="settle-arrow">\u2192</span> <span class="paypill bt">BT</span>'
        : '<span class="paypill bt">BT</span> <span class="settle-arrow">\u2192</span> <span class="paypill md">MD</span>';
  const col =
    amt === 0 ? "var(--text2)" : mdToBt ? "var(--primary2)" : "var(--success)";
  el.className = "settle-banner";
  el.innerHTML = `
    <div>
      <div class="dir">${dirTxt}${amt ? " to " + (mdToBt ? "BT" : "MD") : ""}</div>
      <div class="big" style="color:${col}">${money(amt, 0)} <span style="font-size:15px;color:var(--text2)">MAD</span></div>
      <div class="dir">to keep the 50/50 split even \u00b7 <b>${eMonthLabel(cur)}</b></div>
    </div>
    <div class="settle-who">${whoHTML}</div>`;
}

// Cards: how much each partner keeps this month (discretionary leftover = pool/2 each),
// plus the settlement transfer as a third card so the key numbers are scannable.
function eRenderKeepCards() {
  const el = document.getElementById("e_keepCards");
  if (!el) return;
  const c = eCompute(E_STATE.bills); // straight from Monthly bills (payer/amount edits flow through immediately)
  const net = c.netMDtoBT;
  const amt = Math.abs(Math.round(net));
  const mdToBt = net >= 0;
  const settleLabel =
    amt === 0
      ? "Settled \u2014 nothing to send"
      : mdToBt
        ? "MD sends BT"
        : "BT sends MD";
  const settleCol =
    amt === 0 ? "var(--text2)" : mdToBt ? "var(--primary2)" : "var(--success)";
  el.innerHTML = `
    <div class="card"><div class="label">MD keeps</div><div class="value pos">${money(c.discMD, 0)}<span style="font-size:13px;color:var(--text2);font-weight:600"> MAD</span></div><div class="mini" style="margin-top:2px">after bills &amp; settle-up</div></div>
    <div class="card"><div class="label">BT keeps</div><div class="value pos">${money(c.discBT, 0)}<span style="font-size:13px;color:var(--text2);font-weight:600"> MAD</span></div><div class="mini" style="margin-top:2px">after bills &amp; settle-up</div></div>
    <div class="card"><div class="label">${settleLabel}</div><div class="value" style="color:${settleCol}">${money(amt, 0)}<span style="font-size:13px;color:var(--text2);font-weight:600"> MAD</span></div><div class="mini" style="margin-top:2px">to keep the 50/50 split even</div></div>`;
}

function eRenderMonthBills() {
  const body = document.getElementById("e_mBillsBody");
  if (!body) return;
  const cur = eCurMonth();
  const ov = (E_STATE.monthBills || {})[cur] || {};
  const catOf = (k) => {
    const c = E_BILL_CATS.find((x) => x.key === k);
    return c ? c.label : k || "";
  };
  let rows = "";
  (E_STATE.bills || []).forEach((b, idx) => {
    const o = ov[idx] || {};
    const off = !!o.off;
    const amt = o.amt != null && o.amt !== "" ? +o.amt || 0 : eBillAmt(b);
    const by = o.by || b.by;
    const note = o.note || "";
    const edited = (o.amt != null && o.amt !== "") || o.by;
    rows += `<tr class="${off ? "mbill-off" : ""}">
      <td style="text-align:center"><span class="sw ${off ? "" : "on"}" data-mtoggle="${idx}" role="switch" aria-checked="${off ? "false" : "true"}"><i></i></span></td>
      <td>${escapeHtml(b.name)} ${edited ? '<span class="mini" style="color:var(--primary2)" data-tip="Changed for this month">\u270e</span>' : ""}<div class="mini" style="color:var(--muted)">${catOf(b.cat)}</div></td>
      <td style="text-align:right;font-family:var(--mono)${off ? ";opacity:.4" : ""}">${money(amt, 0)}</td>
      <td style="text-align:center"><span class="paypill ${by === "BT" ? "bt" : "md"}" data-mby="${idx}" data-tip="Click to switch payer">${by}</span></td>
      <td><input class="mbill-note" value="${escapeHtml(note)}" placeholder="\u2014" data-mnote="${idx}"></td>
    </tr>`;
  });
  body.innerHTML =
    rows ||
    '<tr><td colspan="5" class="mini" style="padding:14px;text-align:center">No bills yet \u2014 add them under Bills Setup.</td></tr>';

  // totals for the month
  const bills = eMonthBills(cur);
  const tot = bills.reduce((a, b) => a + (+b.amt || 0), 0);
  const paidMD = bills
    .filter((b) => b.by === "MD")
    .reduce((a, b) => a + (+b.amt || 0), 0);
  const paidBT = bills
    .filter((b) => b.by === "BT")
    .reduce((a, b) => a + (+b.amt || 0), 0);
  const totEl = document.getElementById("e_mBillsTot");
  if (totEl) totEl.textContent = money(tot, 0);
  const foot = document.getElementById("e_mBillsFoot");
  if (foot)
    foot.innerHTML =
      `<span>Total shared <b class="mono">${money(tot, 0)}</b></span>` +
      `<span>MD pays <b class="mono">${money(paidMD, 0)}</b></span>` +
      `<span>BT pays <b class="mono">${money(paidBT, 0)}</b></span>` +
      `<span>Each owes <b class="mono">${money(tot / 2, 0)}</b></span>`;

  // reset link
  const rw = document.getElementById("e_mResetWrap");
  if (rw)
    rw.innerHTML = eMonthHasOverride(cur)
      ? `<button class="btn sec2" id="e_mReset" data-tip="Revert this month back to your default bills">\u21ba Reset ${eMonthLabel(cur)} to defaults</button>`
      : `<span class="mini" style="color:var(--muted)">Using your default bills for ${eMonthLabel(cur)}.</span>`;

  // wire handlers
  body.querySelectorAll("[data-mtoggle]").forEach(
    (el) =>
      (el.onclick = () => {
        const i = +el.dataset.mtoggle;
        const isOn = el.classList.contains("on"); // currently on => user wants to turn it OFF
        eSetMonthOverride(cur, i, { off: isOn });
        eSave();
        eRenderMonthTab();
      }),
  );
  body.querySelectorAll("[data-mby]").forEach(
    (el) =>
      (el.onclick = () => {
        const i = +el.dataset.mby;
        const b = E_STATE.bills[i];
        const o =
          ((E_STATE.monthBills || {})[cur] && E_STATE.monthBills[cur][i]) || {};
        const curBy = o.by || b.by;
        eSetMonthOverride(cur, i, { by: curBy === "MD" ? "BT" : "MD" });
        eSave();
        eRenderMonthTab();
      }),
  );
  body.querySelectorAll("[data-mnote]").forEach(
    (el) =>
      (el.onchange = () => {
        const i = +el.dataset.mnote;
        eSetMonthOverride(cur, i, { note: el.value });
        eSave();
        eRenderMonthBills();
      }),
  );
  const rb = document.getElementById("e_mReset");
  if (rb)
    rb.onclick = () => {
      eClearMonth(cur);
      eSave();
      eRenderMonthTab();
    };
}

function eRenderMonthTab() {
  eRenderMonthNav();
  eRenderKeepCards();
  eRenderMonthBills();
}

// Net monthly income: collapsible, collapsed by default.
function eIncCollapsed() {
  try {
    const v = localStorage.getItem("casa_incCollapsed_v1");
    return v === null ? true : v === "1";
  } catch (e) {
    return true;
  }
}
function eApplyIncCollapsed() {
  const body = document.getElementById("e_incBody");
  const tog = document.getElementById("e_incToggle");
  const sum = document.getElementById("e_incSummary");
  const collapsed = eIncCollapsed();
  if (body) body.style.display = collapsed ? "none" : "";
  if (tog) tog.textContent = collapsed ? "\u25b8" : "\u25be";
  if (sum) {
    const inc1 = +E_STATE.inc1 || 0,
      inc2 = +E_STATE.inc2 || 0;
    sum.textContent = collapsed
      ? "MD " + money(inc1, 0) + " \u00b7 BT " + money(inc2, 0)
      : "";
  }
}
function eWireIncToggle() {
  const h = document.getElementById("e_incHead");
  if (!h || h._wired) return;
  h._wired = true;
  h.onclick = () => {
    const now = eIncCollapsed();
    try {
      localStorage.setItem("casa_incCollapsed_v1", now ? "0" : "1");
    } catch (e) {}
    eApplyIncCollapsed();
  };
}

function renderExpenses() {
  eLoad();
  // seed defaults for new fields
  eSeedExpenseDefaults();
  // sync top inputs (Setup tab)
  const setv = (id, v) => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = v;
  };
  setv("e_inc1", E_STATE.inc1);
  setv("e_inc2", E_STATE.inc2);
  setv("e_btToMd", E_STATE.btToMd);
  // wire sub-tab buttons (idempotent)
  document.querySelectorAll("#expensesTabs .tab[data-etab]").forEach((b) => {
    b.onclick = () => eShowTab(b.dataset.etab);
  });
  eWireIncToggle();
  eApplyIncCollapsed();
  // Setup tab renders
  eRenderBills();
  eRenderBillWarn();
  eRenderCatDonut();
  eRenderSettle();
  // Pots tab renders
  eRenderBuckets();
  eRenderCarPlan();
  eRenderLog();
  // This-month tab
  eRenderMonthTab();
  // restore last tab (default: This Month)
  const _ut = E_STATE.uiTab === "pots" ? "pots" : "setup"; // 'month' tab removed -> default to Monthly bills
  eShowTab(_ut);
}
// Seed targets / loan principal / month-override map on first run (all editable later).
function eSeedExpenseDefaults() {
  if (!E_STATE.potTargets) {
    E_STATE.potTargets = { mt: 0, car: 0, btOther: 0, toMd: 0 };
  }
  if (!("loanPrincipal" in E_STATE)) {
    E_STATE.loanPrincipal = "";
  } // '' => auto = full planned schedule
  // Extra loan draws taken from MT over time (each adds to the principal).
  // [{ id, when:'YYYY-Www', amount:Number, note:String }]
  if (!Array.isArray(E_STATE.loanDraws)) {
    E_STATE.loanDraws = [];
  }
  // Loan-draws panel starts collapsed each session (hidden by default).
  E_STATE._loanDrawsOpen = false;
  // The "This Month" tab was removed \u2014 drop any stale per-month bill overrides so they
  // can't shadow payer/amount edits made in Monthly bills. Settlement now derives
  // straight from the default bills.
  if (E_STATE.monthBills && Object.keys(E_STATE.monthBills).length) {
    E_STATE.monthBills = {};
  }
  if (!E_STATE.monthBills) {
    E_STATE.monthBills = {};
  }
  eSave();
}

function eRenderBills() {
  const body = document.getElementById("e_billsBody");
  if (!body) return;
  const s = E_STATE;
  s.bills.forEach((b) => {
    if (!b.cat) {
      const n = (b.name || "").toLowerCase();
      if (/loan/.test(n)) b.cat = "loans";
      else if (/car|house|other|redal|iam/.test(n)) b.cat = "fixed";
      else b.cat = "living";
    }
  });
  const inp =
    "width:100%;padding:6px 9px;background:transparent;border:1px solid transparent;border-radius:7px;color:var(--text);font-size:13px;transition:border-color .12s ease";
  const inpN =
    "width:96px;padding:6px 9px;text-align:right;background:transparent;border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px;font-family:var(--mono)";
  const catSel =
    "padding:4px 7px;background:var(--panel2);border:1px solid var(--border);border-radius:7px;color:var(--text2);font-size:11.5px";
  let out = "";
  E_BILL_CATS.forEach((cat) => {
    const idxs = s.bills
      .map((b, i) => ({ b, i }))
      .filter((x) => (x.b.cat || "living") === cat.key);
    if (!idxs.length) return;
    const sub = idxs.reduce((a, x) => a + eBillAmt(x.b), 0);
    const n = idxs.length;
    const mdSum = idxs
      .filter((x) => x.b.by !== "BT")
      .reduce((a, x) => a + eBillAmt(x.b), 0);
    const btSum = idxs
      .filter((x) => x.b.by === "BT")
      .reduce((a, x) => a + eBillAmt(x.b), 0);
    const payer = btSum > mdSum ? "BT" : "MD";
    // ---- category SECTION HEADER row (full-width, tinted) ----
    out += `<tr class="e-cathead" style="background:${cat.color}14">
      <td colspan="4" style="padding:9px 12px;border-bottom:1px solid ${cat.color}33">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:9px;height:9px;border-radius:50%;background:${cat.color};flex:none"></span>
          <span style="font-weight:800;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:${cat.color}">${cat.label}</span>
          <span class="mini" style="color:var(--muted)">${n} bill${n > 1 ? "s" : ""}</span>
          <span style="margin-left:auto;display:flex;align-items:center;gap:10px">
            <span class="paypill ${payer === "BT" ? "bt" : "md"}" data-tip="Most of this group is paid by ${payer}">${payer}</span>
            <span style="font-family:var(--mono);font-weight:800;font-size:14px;color:var(--text)">${eFmt(sub)}</span>
          </span>
        </div>
      </td>
    </tr>`;
    // ---- bill rows ----
    idxs.forEach(({ b, i }, k) => {
      const first = k === 0,
        last = k === n - 1;
      const hasComp = Array.isArray(b.components) && b.components.length;
      const open = E_COMP_OPEN.has(i);
      const arrows = `<span style="display:inline-flex;flex-direction:column;gap:2px;margin-right:2px;opacity:0;transition:opacity .12s ease" class="e-reord">
          <span data-bmove="${i}:up" data-tip="Move up" style="cursor:${first ? "default" : "pointer"};opacity:${first ? 0.2 : 0.6};font-size:9px;line-height:1">\u25B2</span>
          <span data-bmove="${i}:dn" data-tip="Move down" style="cursor:${last ? "default" : "pointer"};opacity:${last ? 0.2 : 0.6};font-size:9px;line-height:1">\u25BC</span>
        </span>`;
      const nameCell = `<div style="display:flex;align-items:center;gap:6px">${arrows}
          <input data-bi="${i}" data-bk="name" value="${escapeHtml(b.name || "")}" style="${inp}" class="e-billname"></div>`;
      const amtCell = hasComp
        ? `<div style="display:flex;align-items:center;justify-content:flex-end;gap:7px">
             <span style="font-family:var(--mono);font-weight:700;font-size:13px">${eFmt(eBillAmt(b))}</span>
             <span data-comp="${i}" data-tip="Edit monthly/yearly breakdown" style="cursor:pointer;opacity:${open ? 0.95 : 0.55};font-size:13px">\u2699</span>
           </div>`
        : `<div style="display:flex;align-items:center;justify-content:flex-end;gap:7px">
             <input data-bi="${i}" data-bk="amt" type="number" step="1" value="${b.amt}" style="${inpN}">
             <span data-comp="${i}" data-tip="Break into monthly/yearly items" style="cursor:pointer;opacity:.4;font-size:13px">\u2699</span>
           </div>`;
      const payCell = `<span class="e-payseg" role="group" aria-label="Paid by">
          <button type="button" data-bpay="${i}:MD" class="${b.by !== "BT" ? "on" : ""}">MD</button>
          <button type="button" data-bpay="${i}:BT" class="${b.by === "BT" ? "on" : ""}">BT</button>
        </span>`;
      const catCell = `<select data-bi="${i}" data-bk="cat" style="${catSel}" data-tip="Move to another group">${E_BILL_CATS.map((c) => `<option value="${c.key}"${(b.cat || "living") === c.key ? " selected" : ""}>${c.label}</option>`).join("")}</select>`;
      out += `<tr class="e-billrow${last && !(hasComp && open) ? " e-lastincat" : ""}">
        <td style="padding:5px 8px 5px 20px">${nameCell}</td>
        <td style="text-align:right;padding:5px 8px">${amtCell}</td>
        <td style="text-align:center;padding:5px 8px"><div style="display:flex;align-items:center;justify-content:center;gap:8px">${payCell}${catCell}</div></td>
        <td style="text-align:center;padding:5px 8px"><span data-del="${i}" data-tip="Remove" style="cursor:pointer;color:var(--text2);opacity:.45;font-size:14px">\u2715</span></td>
      </tr>`;
      if (hasComp && open) {
        const cinp =
          "padding:4px 7px;background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px";
        let crows = "";
        b.components.forEach((cp, ci) => {
          crows += `<tr>
            <td style="padding:2px 6px"><input data-ci="${i}" data-cj="${ci}" data-ck="name" value="${escapeHtml(cp.name || "")}" style="${cinp};width:150px"></td>
            <td style="padding:2px 6px;text-align:right"><input data-ci="${i}" data-cj="${ci}" data-ck="amt" type="number" step="1" value="${cp.amt}" style="${cinp};width:92px;text-align:right"></td>
            <td style="padding:2px 6px;text-align:center"><select data-ci="${i}" data-cj="${ci}" data-ck="freq" style="${cinp};background:var(--panel2);color:var(--text)"><option value="yearly" style="background:var(--panel2);color:var(--text)"${cp.freq === "yearly" ? " selected" : ""}>/yr \u2192 \u00F712</option><option value="monthly" style="background:var(--panel2);color:var(--text)"${cp.freq !== "yearly" ? " selected" : ""}>/mo</option></select></td>
            <td style="padding:2px 6px;text-align:right;font-family:var(--mono);color:var(--text2);font-size:12px">${eFmt((+cp.amt || 0) * (cp.freq === "yearly" ? 1 / 12 : 1))}/mo</td>
            <td style="padding:2px 6px;text-align:center"><span data-cdel="${i}:${ci}" data-tip="Remove item" style="cursor:pointer;color:var(--text2);opacity:.5;font-size:13px">\u2715</span></td>
          </tr>`;
        });
        out += `<tr class="e-comp-row${last ? " e-lastincat" : ""}"><td colspan="4" style="padding:6px 8px 12px 40px;background:var(--panel2);border-bottom:1px solid var(--border)">
          <div style="font-size:11px;color:var(--text2);margin-bottom:5px">Breakdown for <b>${escapeHtml(b.name || "")}</b> \u2014 monthly total <b style="font-family:var(--mono)">${eFmt(eBillAmt(b))}</b></div>
          <table style="border-collapse:collapse"><thead><tr style="color:var(--text2);font-size:10.5px;text-transform:uppercase;letter-spacing:.03em">
            <th scope="col" style="text-align:left;padding:0 6px">Item</th><th scope="col" style="text-align:right;padding:0 6px">Amount</th><th scope="col" style="padding:0 6px">Frequency</th><th scope="col" style="text-align:right;padding:0 6px">Monthly</th><th scope="col"></th></tr></thead>
            <tbody>${crows}</tbody></table>
          <span data-cadd="${i}" style="cursor:pointer;color:var(--primary2);font-size:11px;display:inline-block;margin-top:5px">+ add item</span>
        </td></tr>`;
      }
    });
    out += `<tr class="e-catspacer"><td colspan="4"></td></tr>`;
  });
  body.innerHTML = out;
  const tot = s.bills.reduce((a, b) => a + eBillAmt(b), 0);
  document.getElementById("e_billsTot").textContent = eFmt(tot);
  const eRefresh = () => {
    eSave();
    eRenderBills();
    eRenderBillWarn();
    eRenderCatDonut();
    eRenderSettle();
    eRenderMonthTab();
    eRenderCarPlan();
  };
  body.querySelectorAll("input[data-bi],select[data-bi]").forEach((el) => {
    el.onchange = () => {
      const i = +el.dataset.bi,
        k = el.dataset.bk;
      E_STATE.bills[i][k] = k === "amt" ? +el.value || 0 : el.value;
      eRefresh();
    };
  });
  body.querySelectorAll("[data-bpay]").forEach((el) => {
    el.onclick = () => {
      const [ix, who] = el.dataset.bpay.split(":");
      E_STATE.bills[+ix].by = who;
      eRefresh();
    };
  });
  body.querySelectorAll("[data-del]").forEach((el) => {
    el.onclick = () => {
      const i = +el.dataset.del;
      E_STATE.bills.splice(i, 1);
      E_COMP_OPEN.delete(i);
      eRefresh();
    };
  });
  body.querySelectorAll("[data-bmove]").forEach((el) => {
    el.onclick = () => {
      const [ix, dir] = el.dataset.bmove.split(":");
      eMoveBill(+ix, dir === "up" ? "up" : "down");
    };
  });
  body.querySelectorAll("[data-comp]").forEach((el) => {
    el.onclick = () => {
      const i = +el.dataset.comp;
      const bill = E_STATE.bills[i];
      if (E_COMP_OPEN.has(i)) {
        E_COMP_OPEN.delete(i);
      } else {
        if (!Array.isArray(bill.components) || !bill.components.length) {
          bill.components = [
            {
              name: bill.name || "Amount",
              amt: +bill.amt || 0,
              freq: "monthly",
            },
          ];
          bill.amt = eBillAmt(bill);
          eSave();
        }
        E_COMP_OPEN.add(i);
      }
      eRenderBills();
    };
  });
  body.querySelectorAll("input[data-ci],select[data-ci]").forEach((el) => {
    el.onchange = () => {
      const i = +el.dataset.ci,
        j = +el.dataset.cj,
        k = el.dataset.ck;
      const cp = E_STATE.bills[i].components[j];
      cp[k] = k === "amt" ? +el.value || 0 : el.value;
      E_STATE.bills[i].amt = eBillAmt(E_STATE.bills[i]);
      eRefresh();
    };
  });
  body.querySelectorAll("[data-cadd]").forEach((el) => {
    el.onclick = () => {
      const i = +el.dataset.cadd;
      (E_STATE.bills[i].components = E_STATE.bills[i].components || []).push({
        name: "New item",
        amt: 0,
        freq: "yearly",
      });
      E_STATE.bills[i].amt = eBillAmt(E_STATE.bills[i]);
      eRefresh();
    };
  });
  body.querySelectorAll("[data-cdel]").forEach((el) => {
    el.onclick = () => {
      const [i, j] = el.dataset.cdel.split(":").map(Number);
      E_STATE.bills[i].components.splice(j, 1);
      E_STATE.bills[i].amt = eBillAmt(E_STATE.bills[i]);
      eRefresh();
    };
  });
}

// ---- Untagged-bill validation: MD + BT tagged must cover the shared total ----
function eRenderBillWarn() {
  const el = document.getElementById("e_billWarn");
  if (!el) return;
  const s = E_STATE;
  const tot = s.bills.reduce((a, b) => a + eBillAmt(b), 0);
  const untagged = s.bills.filter((b) => b.by !== "MD" && b.by !== "BT");
  const untaggedAmt = untagged.reduce((a, b) => a + eBillAmt(b), 0);
  if (untaggedAmt < 1) {
    el.innerHTML = "";
    return;
  }
  const names = untagged
    .filter((b) => eBillAmt(b) > 0)
    .map((b) => b.name || "(unnamed)")
    .join(", ");
  el.innerHTML = `<div style="border:1px solid var(--warn);border-left:4px solid var(--warn);border-radius:10px;padding:9px 13px;background:color-mix(in srgb,var(--warn) 10%,transparent);font-size:13px">
    \u26A0\uFE0F <b>${eFmt(untaggedAmt)} MAD of shared bills isn't tagged to a payer</b> (MD / BT).
    The settlement only splits tagged bills, so this amount is currently ignored.
    <span class="mini" style="display:block;margin-top:3px;opacity:.85">Untagged: ${names}</span></div>`;
}

// ---- Category breakdown donut: shared bills by category ----
let E_CH_cat = null;
function eRenderCatDonut() {
  const el = document.getElementById("e_catDonut");
  const leg = document.getElementById("e_catLegend");
  if (!el || typeof Highcharts === "undefined") return;
  const s = E_STATE;
  const c = eThemeColors();
  const data = E_BILL_CATS.map((cat) => {
    const amt = s.bills
      .filter((b) => (b.cat || "living") === cat.key)
      .reduce((a, b) => a + eBillAmt(b), 0);
    return { name: cat.label, y: Math.round(amt), color: cat.color };
  }).filter((d) => d.y > 0);
  const tot = data.reduce((a, d) => a + d.y, 0);
  if (!data.length) {
    el.innerHTML = "";
    if (leg) leg.innerHTML = "";
    const _cc0 = document.getElementById("e_catDonutCenter");
    if (_cc0) _cc0.innerHTML = "";
    return;
  }
  E_CH_cat = Highcharts.chart("e_catDonut", {
    chart: {
      type: "pie",
      backgroundColor: "transparent",
      margin: [4, 4, 4, 4],
    },
    title: { text: null },
    credits: { enabled: false },
    tooltip: {
      pointFormat: "<b>{point.y:,.0f} MAD</b> ({point.percentage:.0f}%)",
    },
    plotOptions: {
      pie: {
        innerSize: "62%",
        size: "100%",
        center: ["50%", "50%"],
        borderWidth: 0,
        dataLabels: { enabled: false },
      },
    },
    series: [{ name: "Shared bills", data: data }],
  });
  const _cc = document.getElementById("e_catDonutCenter");
  if (_cc) {
    _cc.innerHTML = tot
      ? `<div style="font-family:var(--mono);font-weight:800;font-size:17px;color:var(--text)">${eFmt(tot)}</div><div style="font-size:10px;color:var(--text2);letter-spacing:.04em">MAD/mo</div>`
      : "";
  }
  if (leg) {
    leg.innerHTML = data
      .map(
        (
          d,
        ) => `<div style="display:flex;align-items:center;gap:7px;margin:3px 0">
      <span style="width:10px;height:10px;border-radius:2px;background:${d.color};flex:none"></span>
      <span style="flex:1">${escapeHtml(d.name)}</span>
      <b style="font-family:var(--mono)">${eFmt(d.y)}</b>
      <span style="opacity:.6;width:42px;text-align:right">${tot ? Math.round((d.y / tot) * 100) : 0}%</span></div>`,
      )
      .join("");
  }
}

function eMoveBill(i, dir) {
  const bills = E_STATE.bills;
  if (i < 0 || i >= bills.length) return;
  const cat = bills[i].cat || "living";
  // find nearest sibling index in the SAME category, in the move direction
  let j = -1;
  if (dir === "up") {
    for (let k = i - 1; k >= 0; k--) {
      if ((bills[k].cat || "living") === cat) {
        j = k;
        break;
      }
    }
  } else {
    for (let k = i + 1; k < bills.length; k++) {
      if ((bills[k].cat || "living") === cat) {
        j = k;
        break;
      }
    }
  }
  if (j < 0) return; // already at the group edge
  [bills[i], bills[j]] = [bills[j], bills[i]]; // swap positions
  // keep expanded-editor state attached to the bills as they move
  const iOpen = E_COMP_OPEN.has(i),
    jOpen = E_COMP_OPEN.has(j);
  E_COMP_OPEN.delete(i);
  E_COMP_OPEN.delete(j);
  if (iOpen) E_COMP_OPEN.add(j);
  if (jOpen) E_COMP_OPEN.add(i);
  eSave();
  eRenderBills();
}
function eRenderSettle() {
  const c = eCompute();
  document.getElementById("e_splitLine").innerHTML =
    `Income split: <b>MD ${(c.ratio1 * 100).toFixed(1)}%</b> / <b>BT ${(c.ratio2 * 100).toFixed(1)}%</b> \u00B7 Total shared bills <b>${eFmt(c.billsTot)}</b> (MD pays ${eFmt(c.paidMD)}, BT pays ${eFmt(c.paidBT)})`;
  const q = document.getElementById("e_q35hint");
  if (q) q.textContent = " (she sends you this)";
  const arrow = c.netMDtoBT >= 0 ? "MD \u2192 BT" : "BT \u2192 MD";
  const amt = Math.abs(c.netMDtoBT);
  const cards = document.getElementById("e_settle");
  // ---- hover tooltips: full numeric derivation of each figure ----
  const tipMD = [
    'How "To Pay MD" is derived:',
    "  Pool (leftover both keep) = (MD income " +
      eFmt(c.inc1) +
      " + BT income " +
      eFmt(c.inc2) +
      ") \u2212 shared bills " +
      eFmt(c.billsTot) +
      " = " +
      eFmt(c.pool),
    "  MD's target total = MD income " +
      eFmt(c.inc1) +
      " \u2212 pool/2 " +
      eFmt(c.pool / 2) +
      " = " +
      eFmt(c.totalMD),
    "  To Pay MD = MD's target " +
      eFmt(c.totalMD) +
      " \u2212 bills MD already pays " +
      eFmt(c.paidMD) +
      " = " +
      eFmt(c.toPayMD),
    c.toPayMD < 0
      ? "  (negative \u2192 MD owes nothing; the excess is settled via the net transfer)"
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const tipBT = [
    'How "To Pay BT" is derived:',
    "  Pool (leftover both keep) = (MD income " +
      eFmt(c.inc1) +
      " + BT income " +
      eFmt(c.inc2) +
      ") \u2212 shared bills " +
      eFmt(c.billsTot) +
      " = " +
      eFmt(c.pool),
    "  BT's target total = BT income " +
      eFmt(c.inc2) +
      " \u2212 pool/2 " +
      eFmt(c.pool / 2) +
      " = " +
      eFmt(c.totalBT),
    "  To Pay BT = BT's target " +
      eFmt(c.totalBT) +
      " \u2212 bills BT already pays " +
      eFmt(c.paidBT) +
      " = " +
      eFmt(c.toPayBT),
    c.toPayBT < 0
      ? "  (negative \u2192 BT owes nothing; the excess is settled via the net transfer)"
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const tipNet = [
    "How the net transfer is derived:",
    "  To Pay MD " +
      eFmt(c.toPayMD) +
      " \u2212 BT's monthly payment to MD " +
      eFmt(c.btToMd) +
      " = " +
      eFmt(c.netMDtoBT),
    "  Result " +
      (c.netMDtoBT >= 0
        ? "positive \u2192 MD sends BT"
        : "negative \u2192 BT sends MD") +
      " " +
      eFmt(amt) +
      ".",
    "  (BT's standing " +
      eFmt(c.btToMd) +
      " payment nets against what MD would otherwise transfer.)",
  ].join("\n");
  const esc = (t) => t.replace(/"/g, "&quot;");
  cards.innerHTML = `
   <div class="card" data-tip="${esc(tipMD)}" style="cursor:help"><div class="mini">To Pay MD <span style="opacity:.7">(before BT's payment)</span></div><div style="font-size:22px;font-weight:800">${c.toPayMD < 0 ? "\u2014" : eFmt(c.toPayMD)}</div><div class="mini">${c.toPayMD < 0 ? "nothing owed by MD" : "MD's total " + eFmt(c.totalMD) + " \u2212 MD's bills " + eFmt(c.paidMD)} \u24D8</div></div>
   <div class="card" data-tip="${esc(tipBT)}" style="cursor:help"><div class="mini">To Pay BT</div><div style="font-size:22px;font-weight:800">${c.toPayBT < 0 ? "\u2014" : eFmt(c.toPayBT)}</div><div class="mini">${c.toPayBT < 0 ? "nothing owed by BT" : "BT's total " + eFmt(c.totalBT) + " \u2212 BT's bills " + eFmt(c.paidBT)} \u24D8</div></div>
   <div class="card" data-tip="${esc(tipNet)}" style="border-color:var(--primary);cursor:help"><div class="mini">\uD83D\uDCB8 Net transfer to settle 50/50</div><div style="font-size:24px;font-weight:800;color:var(--primary2)">${eFmt(amt)}</div><div class="mini"><b>${arrow}</b> \u00B7 ${eFmt(c.toPayMD)} \u2212 ${eFmt(c.btToMd)} (BT\u2192MD) \u24D8</div></div>
   <div class="card"><div class="mini">Leftover each keeps</div><div style="font-size:20px;font-weight:800">${eFmt(c.discMD)}</div><div class="mini">pool ${eFmt(c.pool)} \u00F7 2 \u00B7 same for both</div></div>`;

  // ---- Plain-language headline: the one number you glance at ----
  const hEl = document.getElementById("e_settleHeadline");
  if (hEl) {
    if (Math.abs(amt) < 1) {
      hEl.innerHTML = `<div style="border:1px solid var(--border);border-left:4px solid var(--success);border-radius:10px;padding:10px 14px;background:var(--panel2);font-size:14px">\u2705 <b>All settled this month</b> \u2014 no transfer needed.</div>`;
    } else {
      const from = c.netMDtoBT >= 0 ? "you (MD)" : "BT";
      const to = c.netMDtoBT >= 0 ? "BT" : "you (MD)";
      hEl.innerHTML = `<div style="border:1px solid var(--primary2);border-left:4px solid var(--primary2);border-radius:10px;padding:10px 14px;background:color-mix(in srgb,var(--primary2) 10%,transparent);font-size:15px">\uD83D\uDCB8 <b>This month: ${from} send ${to} <span style="font-family:var(--mono);color:var(--primary2)">${eFmt(amt)} MAD</span></b> to keep the 50/50 even.</div>`;
    }
  }
}

const E_MONTH_ABBR = [
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

function eCarPlanYearlyTotal() {
  return (E_STATE.carPlan || []).reduce(
    (a, c) => a + Math.abs(+c.amt || 0) * (c.months || []).length,
    0,
  );
}
// How much the user sets aside for the car each month. This is an EXPLICIT number the
// user enters (E_STATE.carMonthlySave) \u2014 not inferred from the log, to avoid confusion.
function eCarMonthlySave() {
  return Math.max(0, +(E_STATE && E_STATE.carMonthlySave) || 0);
}
// Actual car costs paid this year: sum of the recurring-plan cost for each
// REALIZED car month in the current calendar year. Uses the plan (which knows
// each cost + the months it hits) so gross garage payments show even when a
// month's net set-aside stayed positive.
function eCarPaidOutYTD() {
  const plan = (E_STATE && E_STATE.carPlan) || [];
  if (!plan.length) return 0;
  const byMonth = {};
  plan.forEach((c) => {
    (c.months || []).forEach((mo) => {
      byMonth[mo] = (byMonth[mo] || 0) + Math.abs(+c.amt || 0);
    });
  });
  const nowY = new Date().getFullYear();
  let total = 0;
  (E_STATE.log || []).forEach((r) => {
    const mm = /^(\d{4})-(\d{2})$/.exec(r.month || "");
    if (!mm) return;
    if (+mm[1] !== nowY) return; // this year only
    if (!eRz(r, "car")) return; // realized car months only
    total += byMonth[+mm[2]] || 0;
  });
  return total;
}
// For each plan month, list the cost names that hit it (used for auto-filled notes).
function eCarNoteForMonth(mo) {
  const names = (E_STATE.carPlan || [])
    .filter((c) => Math.abs(+c.amt || 0) > 0 && (c.months || []).includes(mo))
    .map((c) => c.name || "Car cost");
  return names.join(" + ");
}

function eRenderCarPlan() {
  const body = document.getElementById("e_carPlanBody");
  if (!body) return;
  const plan = E_STATE.carPlan || [];
  body.innerHTML =
    plan
      .map((c, i) => {
        const yr = Math.abs(+c.amt || 0) * (c.months || []).length;
        const monthChips = E_MONTH_ABBR.map((mn, mi) => {
          const on = (c.months || []).includes(mi + 1);
          return `<span data-cm="${i}:${mi + 1}" data-tip="${mn}" style="cursor:pointer;user-select:none;display:inline-block;width:30px;text-align:center;margin:1px;padding:2px 0;border-radius:6px;font-size:11px;font-weight:600;
        border:1px solid ${on ? "var(--primary2)" : "var(--border)"};background:${on ? "var(--primary2)" : "transparent"};color:${on ? "#fff" : "var(--text2)"}">${mn}</span>`;
        }).join("");
        return `<tr style="border-top:1px solid var(--border)">
      <td style="padding:5px 6px"><input data-cname="${i}" value="${escapeHtml(c.name || "")}" style="width:100%;min-width:150px;padding:4px 6px"></td>
      <td style="padding:5px 6px;text-align:right"><input data-camt="${i}" type="number" step="50" value="${+c.amt || 0}" style="width:90px;padding:4px 6px;text-align:right"></td>
      <td style="padding:5px 6px">${monthChips}</td>
      <td data-cyr="${i}" style="padding:5px 6px;text-align:right;font-family:var(--mono);font-weight:700">${eFmt(yr)}</td>
      <td style="padding:5px 6px;text-align:right"><span data-cdel="${i}" data-tip="Remove" style="cursor:pointer;color:var(--error);font-weight:700;padding:0 6px">\u2715</span></td>
    </tr>`;
      })
      .join("") ||
    `<tr><td colspan="5" class="mini" style="padding:8px 6px">No recurring costs yet \u2014 add one below.</td></tr>`;

  // Wire inputs. IMPORTANT: never call eRenderCarPlan() on oninput \u2014 rebuilding the
  // table mid-typing destroys the focused input (keyboard "blocks" after 1 char).
  // Update state + live cells only on input; do the full re-render on blur.
  body.querySelectorAll("[data-cname]").forEach((el) => {
    el.oninput = () => {
      E_STATE.carPlan[+el.dataset.cname].name = el.value;
      eSave();
    };
  });
  body.querySelectorAll("[data-camt]").forEach((el) => {
    el.oninput = () => {
      const i = +el.dataset.camt,
        c = E_STATE.carPlan[i];
      c.amt = +el.value || 0;
      eSave();
      // update this row's "per year" cell + the banner live, without re-rendering the table
      const yrCell = body.querySelector(`[data-cyr="${i}"]`);
      if (yrCell)
        yrCell.textContent = eFmt(Math.abs(c.amt) * (c.months || []).length);
      eRenderCarPlanBanner();
      const note = document.getElementById("e_carPlanNote");
      if (note) {
        note.innerHTML = `Total <b>${eFmt(eCarPlanYearlyTotal())}</b>/yr`;
      }
    };
    el.onblur = () => {
      eRenderCarPlan();
      eRenderLog();
    }; // full refresh once editing is done (also updates log locks)
  });
  body.querySelectorAll("[data-cm]").forEach((el) => {
    el.onclick = () => {
      const [i, m] = el.dataset.cm.split(":").map(Number);
      const c = E_STATE.carPlan[i];
      c.months = c.months || [];
      if (c.months.includes(m)) c.months = c.months.filter((x) => x !== m);
      else c.months.push(m);
      c.months.sort((a, b) => a - b);
      eSave();
      eRenderCarPlan();
      eRenderLog();
    };
  });
  body.querySelectorAll("[data-cdel]").forEach((el) => {
    el.onclick = () => {
      E_STATE.carPlan.splice(+el.dataset.cdel, 1);
      eSave();
      eRenderCarPlan();
      eRenderLog();
    };
  });

  eRenderCarPlanBanner();
  const note = document.getElementById("e_carPlanNote");
  if (note) {
    const yt = eCarPlanYearlyTotal();
    note.innerHTML = `Total <b>${eFmt(yt)}</b>/yr`;
  }
  eApplyCarPlanCollapsed();
}

function eCarPlanCollapsed() {
  try {
    const v = localStorage.getItem("casa_carPlanCollapsed_v1");
    return v === null ? true : v === "1";
  } catch (e) {
    return true;
  }
}
function eApplyCarPlanCollapsed() {
  const det = document.getElementById("e_carPlanDetails");
  const tog = document.getElementById("e_carPlanToggle");
  const collapsed = eCarPlanCollapsed();
  if (det) det.style.display = collapsed ? "none" : "";
  if (tog) {
    tog.textContent = collapsed ? "\u25B8" : "\u25BE";
    tog.title = collapsed ? "Show car cost details" : "Hide car cost details";
  }
}

function eRenderCarPlanBanner() {
  const b = document.getElementById("e_carPlanBanner");
  if (!b) return;
  const yearly = eCarPlanYearlyTotal();
  const need = yearly / 12; // even monthly set-aside required to cover the year
  const have = eCarMonthlySave(); // what the user says they set aside each month
  const gap = have - need;
  const ok = have > 0 ? gap >= -1 : false;
  const col =
    have <= 0 ? "var(--warn)" : ok ? "var(--success)" : "var(--error)";
  const icon = have <= 0 ? "\u2022" : ok ? "\u2713" : "\u25BC";
  let verdict;
  if (have <= 0) {
    verdict = `Enter how much you set aside for the car each month to see if you're on track. You need <b>${eFmt(need)}</b>/mo to cover <b>${eFmt(yearly)}</b>/yr.`;
  } else if (ok) {
    verdict = `On track \u2014 you set aside <b>${eFmt(have)}</b>/mo, covering the <b>${eFmt(need)}</b>/mo needed (<b>${eFmt(have - need)}</b>/mo buffer).`;
  } else {
    verdict = `Short by <b>${eFmt(need - have)}</b>/mo \u2014 you set aside <b>${eFmt(have)}</b>/mo but need <b>${eFmt(need)}</b>/mo.`;
  }
  b.innerHTML = `<div style="border:1px solid ${col}55;background:${col}14;border-radius:10px;padding:10px 12px;font-size:13px">
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">
      <span style="display:flex;align-items:center;gap:6px"><span class="mini">I set aside</span>
        <input id="e_carSaveInp" type="number" step="50" value="${have || ""}" placeholder="0"
          style="width:90px;padding:4px 6px;text-align:right;font-family:var(--mono);font-weight:700">
        <span class="mini">/mo</span></span>
      <span><span class="mini">Need to save</span> <b style="font-family:var(--mono)">${eFmt(need)}</b>/mo</span>
      <span><span class="mini">Recurring/yr</span> <b style="font-family:var(--mono)">${eFmt(yearly)}</b></span>
    </div>
    <div style="margin-top:6px;color:${col}">${icon} ${verdict}</div>
  </div>`;
  const inp = document.getElementById("e_carSaveInp");
  if (inp) {
    inp.oninput = () => {
      E_STATE.carMonthlySave = +inp.value || 0;
      eSave();
      // live-update only the verdict text/colors; don't rebuild input (keeps focus)
      const yl = eCarPlanYearlyTotal(),
        nd = yl / 12,
        hv = eCarMonthlySave(),
        okk = hv > 0 && hv - nd >= -1;
      const cc =
        hv <= 0 ? "var(--warn)" : okk ? "var(--success)" : "var(--error)";
      const ic = hv <= 0 ? "\u2022" : okk ? "\u2713" : "\u25BC";
      let vt;
      if (hv <= 0)
        vt = `Enter how much you set aside for the car each month to see if you're on track. You need <b>${eFmt(nd)}</b>/mo to cover <b>${eFmt(yl)}</b>/yr.`;
      else if (okk)
        vt = `On track \u2014 you set aside <b>${eFmt(hv)}</b>/mo, covering the <b>${eFmt(nd)}</b>/mo needed (<b>${eFmt(hv - nd)}</b>/mo buffer).`;
      else
        vt = `Short by <b>${eFmt(nd - hv)}</b>/mo \u2014 you set aside <b>${eFmt(hv)}</b>/mo but need <b>${eFmt(nd)}</b>/mo.`;
      const box = inp.closest("div").parentElement;
      const vd = box.lastElementChild;
      if (vd) {
        vd.style.color = cc;
        vd.innerHTML = `${ic} ${vt}`;
      }
      box.style.borderColor = cc + "55";
      box.style.background = cc + "14";
    };
    // On COMMIT (blur / Enter), recompute the savings log's future car months
    // from the new monthly set-aside. Done on change (not oninput) so we don't
    // rebuild the log on every keystroke and steal input focus. Future-only, so
    // realized/past months are never rewritten.
    inp.onchange = () => {
      E_STATE.carMonthlySave = +inp.value || 0;
      eSave();
      eApplyCarPlan();
    };
  }
}

// Write each recurring cost as a NEGATIVE withdrawal into matching future (non-realized) months.
// Only touches non-realized rows so history is never overwritten. Overwrites the car value of
// a month only if that month is targeted by the plan (keeps other months' deposits intact).
function eApplyCarPlan() {
  const plan = E_STATE.carPlan || [];
  // month(1-12) -> total cost withdrawn that month
  const byMonth = {};
  plan.forEach((c) => {
    (c.months || []).forEach((m) => {
      byMonth[m] = (byMonth[m] || 0) + Math.abs(+c.amt || 0);
    });
  });
  const save = eCarMonthlySave(); // monthly set-aside (0 if not entered)
  const nowYM = (() => {
    const d = new Date();
    return d.getFullYear() * 100 + (d.getMonth() + 1);
  })();
  let applied = 0;
  E_STATE.log.forEach((r) => {
    const mm = /^(\d{4})-(\d{2})$/.exec(r.month || "");
    if (!mm) return;
    const ym = +mm[1] * 100 + +mm[2];
    if (ym < nowYM) return; // only today or future \u2014 never rewrite the past
    const mo = +mm[2];
    const cost = byMonth[mo] || 0;
    if (cost > 0) {
      // payment month: you set aside `save`, then the cost comes out \u2192 net = save - cost
      r.car = save - cost;
      r.note = eCarNoteForMonth(mo);
      applied++;
    } else if (save > 0) {
      // non-payment future month: reflect the monthly set-aside as a deposit
      r.car = save;
    }
  });
  eSave();
  eRenderLog();
  eRenderBuckets();
  eRenderSavingsChart();
  eRenderForward();
  eRenderCarPlan();
  return applied;
}

// Per-pot stats from the REALIZED log rows:
//   accumulated = sum of realized amounts (running balance in the pot)
//   savedIn     = sum of positive realized amounts (money put in)
//   paidOut     = sum of |negative realized amounts| (money spent out)
//   monthlySave = the most recent positive contribution (typical monthly deposit)
//   paidOutYTD  = |negatives| within the current calendar year
function ePotStats(key) {
  const nowY = new Date().getFullYear();
  let acc = 0,
    savedIn = 0,
    paidOut = 0,
    paidOutYTD = 0,
    monthlySave = 0,
    lastMonth = "";
  (E_STATE.log || [])
    .slice()
    .sort((a, b) => (a.month || "").localeCompare(b.month || ""))
    .forEach((r) => {
      if (!eRz(r, key)) return; // realized only
      const v = +r[key] || 0;
      acc += v;
      if (v > 0) {
        savedIn += v;
        monthlySave = v;
        lastMonth = r.month;
      } else if (v < 0) {
        paidOut += -v;
        const y = +(/^(\d{4})/.exec(r.month || "") || [])[1];
        if (y === nowY) paidOutYTD += -v;
      }
    });
  return { acc, savedIn, paidOut, paidOutYTD, monthlySave, lastMonth };
}
// To MD loan: principal (editable, default = full planned To MD schedule), repaid = realized To MD deposits.
function eLoanState() {
  let repaid = 0,
    plannedTotal = 0;
  (E_STATE.log || []).forEach((r) => {
    const v = +r.toMd || 0;
    if (v > 0) {
      plannedTotal += v;
      if (eRz(r, "toMd")) repaid += v;
    }
  });
  const basePrincipal =
    E_STATE.loanPrincipal != null && E_STATE.loanPrincipal !== ""
      ? +E_STATE.loanPrincipal || 0
      : plannedTotal;
  // Extra draws taken from MT over time add to the principal.
  const draws = Array.isArray(E_STATE.loanDraws) ? E_STATE.loanDraws : [];
  const drawsTotal = draws.reduce((s, d) => s + (+d.amount || 0), 0);
  const principal = basePrincipal + drawsTotal;
  const remaining = Math.max(0, principal - repaid);
  const pct = principal > 0 ? Math.min(100, (repaid / principal) * 100) : 0;
  return {
    principal,
    basePrincipal,
    drawsTotal,
    repaid,
    remaining,
    plannedTotal,
    pct,
  };
}
function eRenderBuckets() {
  const el = document.getElementById("e_bucketCards");
  if (!el) return;
  E_STATE.potTargets = E_STATE.potTargets || {};
  const T = E_STATE.potTargets;
  const meta = {
    mt: {
      icon: "\u{1f476}",
      label: "MT",
      owner: "both save",
      kind: "save",
    },
    car: {
      icon: "\u{1f697}",
      label: "Car",
      owner: "MD saves",
      kind: "save",
    },
    btOther: {
      icon: "\u{1f3e6}",
      label: "BT Other",
      owner: "BT saves",
      kind: "save",
    },
    toMd: {
      icon: "\u27a1\ufe0f",
      label: "To MD",
      owner: "loan repay",
      kind: "loan",
    },
  };
  const order = ["mt", "car", "btOther", "toMd"];
  let cards = "";
  order.forEach((key) => {
    const m = meta[key];
    const s = ePotStats(key);
    if (m.kind === "loan") {
      const L = eLoanState();
      const draws = Array.isArray(E_STATE.loanDraws) ? E_STATE.loanDraws : [];
      const drawsOpen = !!E_STATE._loanDrawsOpen;
      const drawRows =
        draws.length === 0
          ? '<div class="mini" style="color:var(--muted);padding:4px 0">No extra draws yet.</div>'
          : draws
              .slice()
              .sort((a, b) => (a.when < b.when ? 1 : -1))
              .map(
                (
                  d,
                ) => `<div class="loan-draw-row" style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border-l)">
          <span class="mono mini" style="width:66px;flex:none;color:var(--text2)">${escapeHtml(d.when || "\u2014")}</span>
          <span class="mono" style="width:66px;flex:none;text-align:right;color:var(--warn)">${money(+d.amount || 0, 0)}</span>
          <span class="mini" style="flex:1;min-width:0;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(d.note || "")}">${escapeHtml(d.note || "")}</span>
          <button class="chip" style="cursor:pointer;border:none;flex:none" title="Delete draw" data-act="eDelLoanDraw" data-args="${d.id}">\u2715</button>
        </div>`,
              )
              .join("");
      cards += `<div class="pot card">
        <h3 style="font-size:15px;margin:0 0 1px;display:flex;align-items:center;gap:8px">${m.icon} ${m.label} <span class="mini" style="font-weight:600;color:var(--muted)">\u00b7 ${m.owner}</span></h3>
        <div style="font-family:var(--mono);font-weight:800;font-size:24px;margin:9px 0 1px;color:${L.remaining > 0 ? "var(--warn)" : "var(--success)"}">${money(L.remaining, 0)}</div>
        <div class="mini">remaining to MD ${L.pct >= 100 ? "\u00b7 fully repaid" : "\u00b7 " + money(L.repaid, 0) + " repaid"}</div>
        <div class="pot-bar"><i style="width:${L.pct.toFixed(0)}%"></i></div>
        <div class="potrow"><span>Base principal</span><span><input class="principal-inp" type="number" step="500" value="${E_STATE.loanPrincipal === "" || E_STATE.loanPrincipal == null ? "" : L.basePrincipal}" placeholder="auto (${money(L.plannedTotal, 0)})" data-loanp="1" data-tip="Base loan amount. Leave blank to auto-use the planned To MD schedule (${money(L.plannedTotal, 0)}). Extra draws below add on top."></span></div>
        ${L.drawsTotal > 0 ? `<div class="potrow"><span>Extra draws</span><span class="mono" style="color:var(--warn)">+${money(L.drawsTotal, 0)}</span></div>` : ""}
        <div class="potrow" style="font-weight:700"><span>Total principal</span><span class="mono">${money(L.principal, 0)}</span></div>
        <div class="potrow"><span>Repaid</span><span class="mono" style="color:var(--success)">${money(L.repaid, 0)}</span></div>
        <div class="potrow" style="font-weight:700"><span>Remaining</span><span class="mono" style="color:${L.remaining > 0 ? "var(--warn)" : "var(--success)"}">${money(L.remaining, 0)}</span></div>
        <div style="border-top:1px solid var(--border-l);margin-top:8px;padding-top:6px">
          <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none" data-act="eToggleLoanDraws">
            <span class="mini" style="font-weight:700;color:var(--text)">\u{1f4dd} Loan draws${draws.length ? " (" + draws.length + ")" : ""}</span>
            <span class="mini" style="color:var(--text2)">${drawsOpen ? "\u25be Hide" : "\u25b8 Add / view"}</span>
          </div>
          <div style="display:${drawsOpen ? "block" : "none"};margin-top:6px">
            ${drawRows}
            <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;align-items:flex-end">
              <label class="mini" style="display:flex;flex-direction:column;gap:2px;color:var(--text2)">Week-year<input id="ld_when" type="week" class="principal-inp" style="width:120px" data-tip="Week the draw was taken"></label>
              <label class="mini" style="display:flex;flex-direction:column;gap:2px;color:var(--text2)">Amount<input id="ld_amt" type="number" step="100" class="principal-inp" style="width:80px" placeholder="MAD"></label>
              <label class="mini" style="display:flex;flex-direction:column;gap:2px;color:var(--text2);flex:1;min-width:120px">Note<input id="ld_note" type="text" class="principal-inp" style="width:100%" placeholder="what it's for"></label>
              <button class="btn sec2" style="font-size:12px" data-act="eAddLoanDraw">+ Add draw</button>
            </div>
          </div>
        </div>
        <div class="mini" style="margin-top:6px;color:var(--muted)">${L.pct >= 100 ? "\u2713 Fully repaid" : "Planned installments total " + money(L.plannedTotal, 0)}</div>
      </div>`;
    } else {
      // Target source per pot:
      //  - car: AUTO from the recurring car costs (read-only, updates with the planner)
      //  - mt : NO yearly target (loan-driven pot; we show in-account instead)
      //  - others (btOther): user-editable yearly target
      const autoTarget = key === "car";
      const noTarget = key === "mt";
      const target = noTarget
        ? 0
        : autoTarget
          ? eCarPlanYearlyTotal()
          : +T[key] || 0;
      const basis =
        target > 0 ? Math.min(100, Math.max(0, (s.acc / target) * 100)) : 0;
      const over = target > 0 && s.acc > target;
      cards += `<div class="pot card">
        <h3 style="font-size:15px;margin:0 0 1px;display:flex;align-items:center;gap:8px">${m.icon} ${m.label} <span class="mini" style="font-weight:600;color:var(--muted)">\u00b7 ${m.owner}</span></h3>
        ${(() => {
          // MT headline = "In account now" (accumulated minus outstanding loan);
          // accumulated is shown as a secondary row below. Other pots keep
          // accumulated as the headline. Display-only.
          if (key === "mt") {
            const L = eLoanState();
            const inAcc = s.acc - L.remaining;
            return `<div style="font-family:var(--mono);font-weight:800;font-size:24px;margin:9px 0 1px;color:${inAcc >= 0 ? "var(--success)" : "var(--error)"}">${money(inAcc, 0)}</div>
        <div class="mini">in account now</div>
        <div class="potrow" style="margin-top:6px"><span>Accumulated</span><span class="mono">${money(s.acc, 0)}${s.lastMonth ? ' <span class="mini" style="color:var(--muted)">\u00b7 ' + eMonthLabel(s.lastMonth) + "</span>" : ""}</span></div>
        <div class="potrow"><span>Loan outstanding</span><span class="mono" style="color:${L.remaining > 0 ? "var(--warn)" : "var(--success)"}">${L.remaining > 0 ? "\u2212" + money(L.remaining, 0) : "\u2014"}</span></div>`;
          }
          return `<div style="font-family:var(--mono);font-weight:800;font-size:24px;margin:9px 0 1px">${money(s.acc, 0)}</div>
        <div class="mini">accumulated so far ${s.lastMonth ? "\u00b7 as of " + eMonthLabel(s.lastMonth) : ""}</div>`;
        })()}
        ${
          noTarget
            ? ""
            : autoTarget
              ? `<div class="pot-bar ${over ? "over" : ""}"><i style="width:${basis.toFixed(0)}%"></i></div>
        <div class="potrow"><span>Yearly target</span><span class="mono">${money(target, 0)}</span></div>
        <div class="mini" style="color:var(--muted);margin-top:-2px">from recurring car costs</div>`
              : target > 0
                ? `<div class="pot-bar ${over ? "over" : ""}"><i style="width:${basis.toFixed(0)}%"></i></div>
        <div class="potrow"><span>Yearly target</span><span><input class="target-inp" type="number" step="100" value="${target}" data-pottgt="${key}"></span></div>`
                : `<div class="potrow" style="margin-top:8px"><span>Yearly target</span><span><input class="target-inp" type="number" step="100" value="" placeholder="set\u2026" data-pottgt="${key}"></span></div>`
        }
        ${(() => {
          // Car pot: "Need / mo" = the same monthly set-aside shown under Recurring
          // car costs (yearly plan total \u00F7 12 = target \u00F7 12, single source). "Paid out"
          // = actual plan cost for realized months this year.
          const saveMo = key === "car" ? target / 12 : s.monthlySave;
          const paidYTD = key === "car" ? eCarPaidOutYTD() : s.paidOutYTD;
          const saveLabel =
            key === "car" ? "Need / mo (target \u00F7 12)" : "Saving / mo";
          return (
            '<div class="potrow"><span>' +
            saveLabel +
            '</span><span class="mono" style="color:var(--success)">+' +
            money(saveMo, 0) +
            "</span></div>" +
            '<div class="potrow"><span>Paid out (this year)</span><span class="mono" style="color:' +
            (paidYTD ? "var(--error)" : "var(--text2)") +
            '">' +
            (paidYTD ? "\u2212" + money(paidYTD, 0) : "\u2014") +
            "</span></div>"
          );
        })()}
      </div>`;
    }
  });
  el.innerHTML = cards;

  // wire target + principal inputs
  el.querySelectorAll("[data-pottgt]").forEach(
    (inp) =>
      (inp.onchange = () => {
        const k = inp.dataset.pottgt;
        E_STATE.potTargets = E_STATE.potTargets || {};
        E_STATE.potTargets[k] = inp.value === "" ? 0 : +inp.value || 0;
        eSave();
        eRenderBuckets();
      }),
  );
  const lp = el.querySelector("[data-loanp]");
  if (lp)
    lp.onchange = () => {
      E_STATE.loanPrincipal = lp.value === "" ? "" : +lp.value || 0;
      eSave();
      eRenderBuckets();
    };
}

// ---- To MD loan draws (extra principal taken from MT over time) ----
function eToggleLoanDraws() {
  E_STATE._loanDrawsOpen = !E_STATE._loanDrawsOpen;
  eRenderBuckets();
}
function eAddLoanDraw() {
  const w = document.getElementById("ld_when");
  const a = document.getElementById("ld_amt");
  const n = document.getElementById("ld_note");
  const amount = +(a && a.value) || 0;
  if (!(amount > 0)) {
    toast("Enter a draw amount greater than 0.", "warn");
    if (a) a.focus();
    return;
  }
  if (!Array.isArray(E_STATE.loanDraws)) E_STATE.loanDraws = [];
  E_STATE.loanDraws.push({
    id: "ld" + Date.now().toString(36),
    when: (w && w.value) || "",
    amount,
    note: (n && n.value ? n.value.trim() : "") || "",
  });
  E_STATE._loanDrawsOpen = true; // keep panel open after adding
  eSave();
  eRenderBuckets();
  toast("Loan draw added (+" + money(amount, 0) + " MAD).", "ok");
}
async function eDelLoanDraw(id) {
  if (!Array.isArray(E_STATE.loanDraws)) return;
  const d = E_STATE.loanDraws.find((x) => x.id === id);
  const ok = await appConfirm(
    "Delete this loan draw" +
      (d ? " (" + money(+d.amount || 0, 0) + " MAD)" : "") +
      "? It will be removed from the total principal.",
    { danger: true, okText: "Delete" },
  );
  if (!ok) return;
  E_STATE.loanDraws = E_STATE.loanDraws.filter((x) => x.id !== id);
  E_STATE._loanDrawsOpen = true;
  eSave();
  eRenderBuckets();
}

function eYearsInLog() {
  const ys = new Set();
  E_STATE.log.forEach((r) => {
    const m = /^(\d{4})/.exec(r.month || "");
    if (m) ys.add(m[1]);
  });
  return [...ys].sort();
}
// Selected years as a Set. logYear may be 'all' (legacy string), an array of
// year strings (multi-select), or undefined. 'all' / empty => every year.
function eSelYears() {
  const all = eYearsInLog();
  let ly = E_STATE.logYear;
  if (ly == null || ly === "all") return new Set(all);
  if (typeof ly === "string") ly = [ly]; // legacy single-year string
  if (Array.isArray(ly) && ly.length === 0) return new Set(); // explicit "none" (user cleared All)
  const sel = new Set(ly.filter((y) => all.includes(y)));
  // An array that had entries but none match current years is stale => fall back to all.
  return sel.size ? sel : new Set(all);
}
function eIsAllYears() {
  const n = eYearsInLog().length;
  return n > 0 && eSelYears().size === n;
}
function eIsNoYears() {
  return eSelYears().size === 0;
}

function eRenderYearChips() {
  const box = document.getElementById("e_yearChips");
  if (!box) return;
  const years = eYearsInLog();
  const sel = eSelYears();
  const allOn = eIsAllYears();
  const chip = (
    val,
    lbl,
    on,
  ) => `<span data-yr="${val}" style="cursor:pointer;user-select:none;padding:4px 12px;border-radius:999px;font-size:12.5px;font-weight:600;
      border:1px solid ${on ? "var(--primary2)" : "var(--border)"};
      background:${on ? "var(--primary2)" : "transparent"};
      color:${on ? "#fff" : "var(--text2)"};transition:all .12s">${lbl}</span>`;
  // "All" reflects the select-all state; each year chip reflects its own on/off
  // so you can add or remove individual years while the others stay put.
  box.innerHTML =
    '<span class="mini" style="font-weight:600;margin-right:2px">Show years:</span>' +
    chip("all", "All", allOn) +
    years.map((y) => chip(y, y, sel.has(y))).join("");
  box.querySelectorAll("[data-yr]").forEach((el) => {
    el.onmouseenter = () => {
      el.style.borderColor = "var(--primary2)";
    };
    el.onmouseleave = () => {
      eRenderYearChips();
    };
    el.onclick = () => {
      const yr = el.dataset.yr;
      const years = eYearsInLog();
      if (yr === "all") {
        // Toggle All: if everything is already on, clear to none; otherwise select all.
        E_STATE.logYear = eIsAllYears() ? [] : "all";
      } else {
        // Toggle just this one year, keeping every other year's state intact.
        // When currently on "All", start from the full set so removing one year
        // leaves the rest selected (instead of jumping to only-this-year).
        let cur = eIsAllYears() ? [...years] : [...eSelYears()];
        if (cur.includes(yr)) cur = cur.filter((y) => y !== yr);
        else cur.push(yr);
        // If the toggle happens to re-select every year, collapse back to 'all'.
        E_STATE.logYear = cur.length === years.length ? "all" : cur.sort();
      }
      eSave();
      eRenderYearChips();
      eRenderLog();
    };
  });
}

function eCarPlanMonths() {
  const set = new Set();
  (E_STATE.carPlan || []).forEach((c) => {
    if (Math.abs(+c.amt || 0) > 0) (c.months || []).forEach((m) => set.add(m));
  });
  return set;
}
function eRenderLog() {
  const wrap = document.getElementById("e_logCards");
  if (!wrap) return;
  eRenderYearChips();
  const s = E_STATE;
  const sel = eSelYears();
  const inpN =
    "width:100%;box-sizing:border-box;padding:4px 6px;text-align:right;background:transparent;border:1px solid transparent;border-radius:6px;font-size:12.5px";
  const inpM =
    "width:100%;box-sizing:border-box;padding:4px 6px;background:transparent;border:1px solid transparent;border-radius:6px;color:var(--text2);font-size:12.5px";
  const inpNote =
    "width:100%;padding:4px 6px;background:transparent;border:1px solid transparent;border-radius:6px;color:var(--text2);font-size:12.5px";
  // rows in selected years, keep original index for editing
  const rows = s.log
    .map((r, i) => ({ r, i }))
    .filter((x) => {
      const y = (/^(\d{4})/.exec(x.r.month || "") || [])[1];
      return y && sel.has(y);
    });
  let cards = "";
  E_BUCKETS.forEach((bk) => {
    // realized subtotal for this bucket across selected years
    const banked = rows.reduce(
      (a, x) => a + (eRz(x.r, bk.key) ? +x.r[bk.key] || 0 : 0),
      0,
    );
    // Select-all state for THIS bucket across the visible rows (for the header toggle).
    const _allRz = rows.length > 0 && rows.every((x) => eRz(x.r, bk.key));
    let body = "";
    const carPlanMonths = eCarPlanMonths();
    const nowYM = (() => {
      const d = new Date();
      return d.getFullYear() * 100 + (d.getMonth() + 1);
    })();
    // Trailing average of this bucket's non-zero amounts (for anomaly flags)
    const bkVals = rows.map((x) => +x.r[bk.key] || 0).filter((v) => v !== 0);
    const bkAvg = bkVals.length
      ? bkVals.reduce((a, v) => a + v, 0) / bkVals.length
      : 0;
    let curYear = null; // for annual roll-up subtotal rows
    let yearAcc = 0;
    const flush = (yr) => {
      if (yr === null) return "";
      const t = `<tr style="background:var(--panel2);font-weight:700;border-top:1px solid var(--border)">
        <td></td><td style="padding:3px 4px;color:var(--text2);font-size:11px">${yr} total</td>
        <td style="text-align:right;padding:3px 4px;font-family:var(--mono);color:${yearAcc < 0 ? "var(--error)" : "var(--text)"}">${eFmt(yearAcc)}</td>
        <td colspan="2"></td></tr>`;
      return t;
    };
    rows.forEach(({ r, i }) => {
      const yr = (/^(\d{4})/.exec(r.month || "") || [])[1] || null;
      if (curYear !== null && yr !== curYear) {
        body += flush(curYear);
        yearAcc = 0;
      }
      curYear = yr;
      yearAcc += +r[bk.key] || 0;
      const v = +r[bk.key] || 0;
      const col =
        v < 0 ? "var(--error)" : v > 0 ? "var(--success)" : "var(--text2)";
      // Lock the Car amount + note when this month is controlled by the recurring-costs planner
      // AND the month is today or in the future. Past months stay editable so you can fix actuals.
      const mm = /^(\d{4})-(\d{2})$/.exec(r.month || "");
      const moNum = mm ? +mm[2] : 0;
      const ym = mm ? +mm[1] * 100 + +mm[2] : 0;
      const carLocked =
        bk.key === "car" && moNum && carPlanMonths.has(moNum) && ym >= nowYM;
      const planNote = carLocked ? eCarNoteForMonth(moNum) : "";
      const amtCell = carLocked
        ? `<div data-tip="Managed by the Recurring car costs planner \u2014 edit it there, or untick this month to unlock" style="display:flex;align-items:center;justify-content:flex-end;gap:4px">
             <span style="opacity:.6;font-size:11px">\uD83D\uDD12</span>
             <input data-li="${i}" data-lk="${bk.key}" type="number" value="${v}" readonly tabindex="-1" style="${inpN};color:${col};opacity:.7;cursor:not-allowed;background:var(--panel2);border-color:var(--border-l)"></div>`
        : `<input data-li="${i}" data-lk="${bk.key}" type="number" step="1" value="${v}" style="${inpN};color:${col}">`;
      // Note cell: for locked car months, show the recurring cost name(s) read-only.
      let noteCell = "";
      if (bk.key === "car") {
        noteCell = carLocked
          ? `<input value="${escapeHtml(planNote)}" readonly tabindex="-1" data-tip="Auto-filled from the Recurring car costs planner" style="${inpNote};opacity:.7;cursor:not-allowed;font-style:italic">`
          : `<input data-li="${i}" data-lk="note" value="${escapeHtml(r.note || "")}" style="${inpNote}">`;
      } else if (bk.key === "btOther") {
        noteCell = `<input data-li="${i}" data-lk="noteBt" value="${escapeHtml(r.noteBt || "")}" style="${inpNote}">`;
      }
      // Anomaly flag: this month's amount vs the bucket's trailing average
      let flag = "";
      if (bkAvg !== 0 && v !== 0) {
        const dev = (v - bkAvg) / Math.abs(bkAvg);
        if (Math.abs(dev) >= 0.5) {
          const up = v > bkAvg;
          const fcol = up ? "var(--success)" : "var(--error)";
          flag = `<span data-tip="${up ? "Above" : "Below"} the ${bk.label} average (${eFmt(bkAvg)}) by ${(Math.abs(dev) * 100).toFixed(0)}%" style="position:absolute;left:2px;top:50%;transform:translateY(-50%);font-size:10px;color:${fcol};cursor:help">${up ? "\u25B2" : "\u25BC"}</span>`;
        }
      }
      const _rz = eRz(r, bk.key);
      body += `<tr style="${_rz ? "" : "opacity:.5"};border-bottom:1px solid var(--border-l)">
        <td style="text-align:center;padding:2px 4px"><input type="checkbox" data-li="${i}" data-rzk="${bk.key}" ${_rz ? "checked" : ""} data-tip="Mark ${bk.label} realized for ${r.month}" style="accent-color:var(--primary2);width:14px;height:14px;cursor:pointer"></td>
        <td style="padding:2px 4px"><input data-li="${i}" data-lk="month" value="${r.month}" style="${inpM}"></td>
        <td style="text-align:right;padding:2px 4px;position:relative">${flag}${amtCell}</td>
        <td style="padding:2px 4px">${noteCell}</td>
        <td style="text-align:center;padding:2px 4px"><span data-ldel="${i}" data-tip="Remove month" style="cursor:pointer;color:var(--text2);opacity:.5;font-size:13px">\u2715</span></td>
      </tr>`;
    });
    body += flush(curYear); // final year roll-up
    if (!rows.length)
      body = `<tr><td colspan="5" style="padding:14px;text-align:center;color:var(--text2)">${eIsNoYears() ? "No years selected \u2014 pick a year chip above (or \u201cAll\u201d)." : "No months for the selected year(s)."}</td></tr>`;
    cards += `<div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;display:flex;flex-direction:column">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:var(--panel2);border-bottom:1px solid var(--border)">
        <span style="font-weight:800;font-size:14px;color:var(--text)">${bk.label}</span>
        <span class="mini" style="font-weight:600">Banked <b style="font-family:var(--mono);color:${banked < 0 ? "var(--error)" : "var(--text)"}">${eFmt(banked)}</b></span>
      </div>
      <div style="overflow-x:hidden">
        <table style="width:100%;border-collapse:collapse;table-layout:fixed">
          <thead><tr style="position:sticky;top:0;background:var(--panel)">
            <th scope="col" style="width:26px;text-align:center;padding:5px 4px;font-size:11px"><input type="checkbox" data-rzall="${bk.key}" ${_allRz ? "checked" : ""} style="accent-color:var(--primary2);width:14px;height:14px;cursor:pointer" data-tip="Toggle realized for ALL ${bk.label} months shown"></th>
            <th scope="col" style="width:72px;text-align:left;padding:5px 4px;font-size:11px">Month</th>
            <th scope="col" style="width:88px;text-align:right;padding:5px 4px;font-size:11px">Amount</th>
            <th scope="col" style="text-align:left;padding:5px 4px;font-size:11px">${bk.key === "car" || bk.key === "btOther" ? "Note" : ""}</th>
            <th scope="col" style="width:28px;padding:5px 4px"></th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
  });
  // summary strip: banked total per bucket + grand total (selected years)
  let grand = 0;
  let pills = "";
  E_BUCKETS.forEach((bk) => {
    const bt = rows.reduce(
      (a, x) => a + (eRz(x.r, bk.key) ? +x.r[bk.key] || 0 : 0),
      0,
    );
    grand += bt;
    pills += `<div style="flex:1 1 120px;min-width:120px;border:1px solid var(--border);border-radius:10px;padding:8px 12px;background:var(--panel2)">
      <div class="mini" style="font-weight:600">${bk.label}</div>
      <div style="font-family:var(--mono);font-weight:800;font-size:15px;color:${bt < 0 ? "var(--error)" : "var(--text)"}">${eFmt(bt)}</div>
    </div>`;
  });
  pills += `<div style="flex:1 1 140px;min-width:140px;border:1px solid var(--primary2);border-radius:10px;padding:8px 12px;background:color-mix(in srgb,var(--primary2) 12%,transparent)">
      <div class="mini" style="font-weight:700;color:var(--primary2)">Total banked</div>
      <div style="font-family:var(--mono);font-weight:800;font-size:15px;color:${grand < 0 ? "var(--error)" : "var(--text)"}">${eFmt(grand)}</div>
    </div>`;
  const sumEl = document.getElementById("e_logSummary");
  if (sumEl) sumEl.innerHTML = pills;

  wrap.innerHTML = cards;

  // focus ring
  wrap
    .querySelectorAll(
      "input[type=number],input[data-lk=month],input[data-lk=note],input[data-lk=noteBt]",
    )
    .forEach((el) => {
      el.onfocus = () => {
        el.style.borderColor = "var(--primary2)";
        el.style.background = "var(--panel2)";
      };
      el.onblur = () => {
        el.style.borderColor = "transparent";
        el.style.background = "transparent";
      };
    });
  wrap.querySelectorAll("input").forEach((el) => {
    el.onchange = () => {
      const i = +el.dataset.li,
        k = el.dataset.lk,
        rzk = el.dataset.rzk,
        rzall = el.dataset.rzall;
      if (rzall) {
        // header: realize/clear every visible month for this bucket
        const on = el.checked;
        const selY = eSelYears();
        E_STATE.log.forEach((r) => {
          const y = (/^(\d{4})/.exec(r.month || "") || [])[1];
          if (y && selY.has(y)) eSetRz(r, rzall, on);
        });
        eSave();
        eRenderBuckets();
        eRenderSavingsChart();
        eRenderSavingsRate();
        eRenderCumChart();
        eRenderLog();
        eRenderForward();
        return;
      }
      if (rzk) {
        // per-bucket realized checkbox
        eSetRz(E_STATE.log[i], rzk, el.checked);
        eSave();
        eRenderBuckets();
        eRenderSavingsChart();
        eRenderSavingsRate();
        eRenderCumChart();
        eRenderLog();
        eRenderForward();
        return;
      }
      if (k === "month" || k === "note" || k === "noteBt")
        E_STATE.log[i][k] = el.value;
      else E_STATE.log[i][k] = +el.value || 0;
      eSave();
      if (!["month", "note", "noteBt"].includes(k)) {
        eRenderBuckets();
        eRenderSavingsChart();
        eRenderSavingsRate();
        eRenderCumChart();
      }
      if (k === "month") {
        eRenderLog();
        eRenderForward();
      }
    };
  });
  wrap.querySelectorAll("[data-ldel]").forEach((el) => {
    el.onclick = () => {
      E_STATE.log.splice(+el.dataset.ldel, 1);
      eSave();
      eRenderLog();
      eRenderBuckets();
      eRenderSavingsChart();
      eRenderSavingsRate();
      eRenderCumChart();
      eRenderForward();
    };
  });
}

let E_CH_savings = null,
  E_CH_fwd = null;
function eThemeColors() {
  // Use the cached theme tokens (single getComputedStyle in refreshThemeCache).
  return {
    tx: themeColor("text"),
    tx2: themeColor("text2"),
    line: themeColor("border"),
    ok: themeColor("success"),
    pri: themeColor("primary2"),
    warn: themeColor("warn"),
  };
}
function eRenderSavingsChart() {
  const el = document.getElementById("e_savingsChart");
  if (!el || typeof Highcharts === "undefined") return;
  const { banked, proj } = eBucketTotals();
  const c = eThemeColors();
  const cats = E_BUCKETS.map((b) => b.label);
  const bankedData = E_BUCKETS.map((b) => Math.round(banked[b.key]));
  const projData = E_BUCKETS.map((b) =>
    Math.round(proj[b.key] - banked[b.key]),
  ); // remaining planned on top
  const target = +E_STATE.floatTarget || 0;
  E_CH_savings = Highcharts.chart("e_savingsChart", {
    chart: { type: "column", backgroundColor: "transparent" },
    title: { text: null },
    credits: { enabled: false },
    xAxis: {
      categories: cats,
      labels: { style: { color: c.tx2 } },
      lineColor: c.line,
      tickColor: c.line,
    },
    yAxis: {
      title: { text: null },
      gridLineColor: c.line,
      labels: {
        style: { color: c.tx2 },
        formatter: function () {
          return this.value / 1000 + "k";
        },
      },
      plotLines: [
        {
          value: target,
          color: c.warn,
          dashStyle: "Dash",
          width: 1.5,
          zIndex: 5,
          label: {
            text: "Float target",
            style: { color: c.warn, fontSize: "10px" },
            align: "right",
          },
        },
      ],
    },
    legend: { itemStyle: { color: c.tx2 } },
    tooltip: {
      shared: true,
      pointFormat: "<b>{series.name}: {point.y:,.0f} MAD</b><br>",
    },
    plotOptions: { column: { stacking: "normal", borderWidth: 0 } },
    series: [
      { name: "Banked", data: bankedData, color: c.ok },
      { name: "Planned (remaining)", data: projData, color: c.pri },
    ],
  });
}

// ---- Savings-rate KPI: banked \u00F7 combined income (annualized over selected months) ----
function eRenderSavingsRate() {
  const el = document.getElementById("e_savingsRate");
  if (!el) return;
  const s = E_STATE;
  const sel = eSelYears();
  const rows = s.log.filter((r) => {
    const y = (/^(\d{4})/.exec(r.month || "") || [])[1];
    return y && sel.has(y) && E_BUCKETS.some((b) => eRz(r, b.key));
  });
  const nMonths = rows.length;
  let banked = 0;
  rows.forEach((r) => {
    E_BUCKETS.forEach((b) => {
      if (eRz(r, b.key)) banked += +r[b.key] || 0;
    });
  });
  const monthlyIncome = (+s.inc1 || 0) + (+s.inc2 || 0);
  const incomeOverPeriod = monthlyIncome * nMonths;
  const rate = incomeOverPeriod > 0 ? (banked / incomeOverPeriod) * 100 : 0;
  const avgPerMo = nMonths ? banked / nMonths : 0;
  const col =
    rate >= 20 ? "var(--success)" : rate >= 10 ? "var(--warn)" : "var(--error)";
  const verdict = rate >= 20 ? "healthy" : rate >= 10 ? "okay" : "low";
  const bkList = E_BUCKETS.map((b) => {
    let t = 0;
    rows.forEach((r) => {
      if (eRz(r, b.key)) t += +r[b.key] || 0;
    });
    return { label: b.label, total: t };
  });
  const rateTip = [
    "HOW SAVINGS RATE IS COMPUTED",
    "",
    "Savings rate = total banked \u00F7 total income over the selected period",
    "",
    "Total banked = sum of every saving-log bucket across all realized months:",
    ...bkList.map((x) => "  \u2022 " + x.label + ": " + eFmt(x.total)),
    "  = " + eFmt(banked) + " total",
    "",
    "Total income = combined monthly income \u00D7 realized months",
    "  = " +
      eFmt(monthlyIncome) +
      "/mo \u00D7 " +
      nMonths +
      " mo = " +
      eFmt(incomeOverPeriod),
    "",
    "Rate = " +
      eFmt(banked) +
      " \u00F7 " +
      eFmt(incomeOverPeriod) +
      " = " +
      rate.toFixed(1) +
      "%",
    "",
    "Only REALIZED months count (unrealized/future rows are excluded).",
    "Thresholds: \u2265 20% healthy  \u00B7  10\u201319% okay  \u00B7  < 10% low.",
  ].join("\n");
  const avgTip =
    "Avg banked / month = total banked \u00F7 realized months\n  = " +
    eFmt(banked) +
    " \u00F7 " +
    nMonths +
    " = " +
    eFmt(avgPerMo) +
    "/mo\n\nCombined income is Income 1 + Income 2 = " +
    eFmt(monthlyIncome) +
    "/mo.";
  const helpChip =
    "display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;border:1px solid var(--border-l);font-size:10px;opacity:.7;cursor:help;margin-left:5px;font-family:var(--sans)";
  el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:10px">
    <div class="card" style="flex:1 1 180px;border-color:${col};cursor:help" data-tip="${rateTip.replace(/"/g, "&quot;")}">
      <div class="mini" style="font-weight:700">\uD83D\uDCBE Savings rate <span style="opacity:.7">(banked \u00F7 income)</span><span style="${helpChip}" data-tip="${rateTip.replace(/"/g, "&quot;")}">?</span></div>
      <div style="font-size:26px;font-weight:800;color:${col};font-family:var(--mono)">${rate.toFixed(1)}%</div>
      <div class="mini">${eFmt(banked)} banked over ${nMonths} realized month${nMonths === 1 ? "" : "s"} \u00B7 <b style="color:${col}">${verdict}</b></div>
      <div class="mini" style="opacity:.6;margin-top:4px">hover for the full breakdown</div>
    </div>
    <div class="card" style="flex:1 1 180px;cursor:help" data-tip="${avgTip.replace(/"/g, "&quot;")}">
      <div class="mini" style="font-weight:700">Avg banked / month<span style="${helpChip}" data-tip="${avgTip.replace(/"/g, "&quot;")}">?</span></div>
      <div style="font-size:26px;font-weight:800;font-family:var(--mono)">${eFmt(avgPerMo)}</div>
      <div class="mini">combined income ${eFmt(monthlyIncome)}/mo</div>
    </div>
  </div>`;
}

// ---- Cumulative banked savings over time (realized months, selected years) ----
let E_CH_cum = null;
function eRenderCumChart() {
  const el = document.getElementById("e_cumChart");
  if (!el || typeof Highcharts === "undefined") return;
  const s = E_STATE;
  const c = eThemeColors();
  const sel = eSelYears();
  const rows = s.log
    .filter((r) => {
      const y = (/^(\d{4})/.exec(r.month || "") || [])[1];
      return y && sel.has(y) && E_BUCKETS.some((b) => eRz(r, b.key));
    })
    .slice()
    .sort((a, b) => (a.month || "").localeCompare(b.month || ""));
  let run = 0;
  const pts = rows.map((r) => {
    let m = 0;
    E_BUCKETS.forEach((b) => {
      if (eRz(r, b.key)) m += +r[b.key] || 0;
    });
    run += m;
    return [r.month, Math.round(run)];
  });
  E_CH_cum = Highcharts.chart("e_cumChart", {
    chart: { type: "area", backgroundColor: "transparent" },
    title: { text: null },
    credits: { enabled: false },
    xAxis: {
      categories: pts.map((p) => p[0]),
      labels: { style: { color: c.tx2, fontSize: "10px" } },
      lineColor: c.line,
      tickColor: c.line,
    },
    yAxis: {
      title: { text: null },
      gridLineColor: c.line,
      labels: {
        style: { color: c.tx2 },
        formatter: function () {
          return this.value / 1000 + "k";
        },
      },
    },
    legend: { enabled: false },
    tooltip: {
      pointFormat: "Cumulative banked: <b>{point.y:,.0f} MAD</b>",
    },
    plotOptions: {
      area: {
        lineWidth: 2,
        color: c.pri,
        marker: { enabled: false, radius: 3 },
        fillColor: {
          linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
          stops: [
            [0, "rgba(96,165,250,.35)"],
            [1, "rgba(96,165,250,.02)"],
          ],
        },
      },
    },
    series: [{ name: "Cumulative banked", data: pts.map((p) => p[1]) }],
  });
}

function eForwardRows() {
  // Build next-12-month projection from future log rows (unrealized, month >= current month)
  const s = E_STATE;
  const c = eCompute();
  const now = new Date();
  const cur =
    now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  // planned savings per month = sum of all bucket columns for that month's log row
  const planByMonth = {};
  s.log.forEach((r) => {
    if (/^\d{4}-\d{2}$/.test(r.month)) {
      const tot = E_BUCKETS.reduce((a, b) => a + (+r[b.key] || 0), 0);
      planByMonth[r.month] = (planByMonth[r.month] || 0) + tot;
    }
  });
  const leftover = c.discMD; // MD's leftover kept each month
  let running = +s.startCash || 0;
  const out = [];
  let d = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i = 0; i < 12; i++) {
    const mk =
      d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    const planned = planByMonth[mk] || 0;
    const net = leftover + planned;
    running += net;
    out.push({
      month: mk,
      leftover: leftover,
      planned: planned,
      net: net,
      running: running,
    });
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

function eRenderForward() {
  const rows = eForwardRows();
  const body = document.getElementById("e_fwdBody");
  if (body) {
    body.innerHTML = rows
      .map(
        (r) => `<tr>
      <td>${r.month}</td>
      <td style="text-align:right">${eFmt(r.leftover)}</td>
      <td style="text-align:right;color:${r.planned < 0 ? "var(--error)" : "var(--text2)"}">${eFmt(r.planned)}</td>
      <td style="text-align:right;font-weight:700;color:${r.net < 0 ? "var(--error)" : "var(--success)"}">${eFmt(r.net)}</td>
      <td style="text-align:right;font-weight:800">${eFmt(r.running)}</td>
    </tr>`,
      )
      .join("");
  }
  const el = document.getElementById("e_fwdChart");
  if (el && typeof Highcharts !== "undefined") {
    const c = eThemeColors();
    E_CH_fwd = Highcharts.chart("e_fwdChart", {
      chart: { backgroundColor: "transparent" },
      title: { text: null },
      credits: { enabled: false },
      xAxis: {
        categories: rows.map((r) => r.month),
        labels: {
          style: { color: c.tx2 },
          rotation: -40,
          fontSize: "10px",
        },
        lineColor: c.line,
        tickColor: c.line,
      },
      yAxis: {
        title: { text: null },
        gridLineColor: c.line,
        labels: {
          style: { color: c.tx2 },
          formatter: function () {
            return this.value / 1000 + "k";
          },
        },
      },
      legend: { itemStyle: { color: c.tx2 } },
      tooltip: { shared: true, valueSuffix: " MAD", valueDecimals: 0 },
      plotOptions: { column: { borderWidth: 0 } },
      series: [
        {
          type: "column",
          name: "Monthly net",
          data: rows.map((r) => Math.round(r.net)),
          color: c.pri,
          yAxis: 0,
        },
        {
          type: "line",
          name: "Running cash",
          data: rows.map((r) => Math.round(r.running)),
          color: c.ok,
          lineWidth: 2.5,
          marker: { radius: 3 },
        },
      ],
    });
  }
}

// input wiring (top fields)
["e_inc1", "e_inc2", "e_btToMd", "e_floatTarget", "e_startCash"].forEach(
  (id) => {
    document.addEventListener("input", (ev) => {
      if (ev.target && ev.target.id === id) {
        const map = {
          e_inc1: "inc1",
          e_inc2: "inc2",
          e_btToMd: "btToMd",
          e_floatTarget: "floatTarget",
          e_startCash: "startCash",
        };
        if (!E_STATE) eLoad();
        E_STATE[map[id]] = +ev.target.value || 0;
        eSave();
        eRenderSettle();
        eRenderBuckets();
        eRenderMonthTab();
        if (typeof eApplyIncCollapsed === "function") eApplyIncCollapsed();
      }
    });
  },
);
document.addEventListener("click", (ev) => {
  const t = ev.target;
  if (!t) return;
  if (t.id === "e_addBill") {
    if (!E_STATE) eLoad();
    E_STATE.bills.push({
      name: "New bill",
      amt: 0,
      by: "MD",
      cat: "living",
    });
    eSave();
    eRenderBills();
    eRenderBillWarn();
    eRenderCatDonut();
    eRenderSettle();
    eRenderMonthTab();
  }
  if (t.id === "e_addYear") {
    if (!E_STATE) eLoad();
    const last = E_STATE.log[E_STATE.log.length - 1];
    let baseYear;
    if (last && /^\d{4}-\d{2}$/.test(last.month)) {
      baseYear = +last.month.slice(0, 4) + 1;
    } else {
      baseYear = new Date().getFullYear() + 1;
    }
    const tmpl = last || {
      btOther: 0,
      mt: 0,
      car: 0,
      mdSaving: 0,
      toMd: 0,
      note: "",
    };
    for (let m = 1; m <= 12; m++) {
      E_STATE.log.push({
        month: baseYear + "-" + String(m).padStart(2, "0"),
        realized: false,
        btOther: tmpl.btOther || 0,
        mt: tmpl.mt || 0,
        car: tmpl.car || 0,
        mdSaving: tmpl.mdSaving || 0,
        toMd: tmpl.toMd || 0,
        note: "",
      });
    }
    E_STATE.logYear = "all";
    // auto-apply recurring car costs to the newly added months (saving-aware, same as eApplyCarPlan)
    if (Array.isArray(E_STATE.carPlan) && E_STATE.carPlan.length) {
      const byMonth = {};
      E_STATE.carPlan.forEach((c) => {
        (c.months || []).forEach((mo) => {
          byMonth[mo] = (byMonth[mo] || 0) + Math.abs(+c.amt || 0);
        });
      });
      const save = eCarMonthlySave();
      E_STATE.log.forEach((r) => {
        const mm = /^(\d{4})-(\d{2})$/.exec(r.month || "");
        if (!mm) return;
        if (+mm[1] !== baseYear) return;
        const mo = +mm[2],
          cost = byMonth[mo] || 0;
        if (cost > 0) {
          r.car = save - cost;
          r.note = eCarNoteForMonth(mo);
        } else if (save > 0) {
          r.car = save;
        }
      });
    }
    eSave();
    eRenderYearChips();
    eRenderLog();
    eRenderBuckets();
    eRenderSavingsRate();
    eRenderCumChart();
    eRenderSavingsChart();
    eRenderForward();
    eRenderCarPlan();
  }
  if (t.id === "e_carPlanToggle") {
    const now = !eCarPlanCollapsed();
    try {
      localStorage.setItem("casa_carPlanCollapsed_v1", now ? "1" : "0");
    } catch (e) {}
    eApplyCarPlanCollapsed();
    return;
  }
  if (t.id === "e_carAdd") {
    if (!E_STATE) eLoad();
    E_STATE.carPlan = E_STATE.carPlan || [];
    E_STATE.carPlan.push({ name: "New car cost", amt: 0, months: [] });
    eSave();
    eRenderCarPlan();
    // Recompute the savings log's FUTURE car months from the live plan so the
    // Car line in the log stays in sync. eApplyCarPlan only rewrites today-or-
    // future months (history is preserved) and re-renders the log + buckets.
    eApplyCarPlan();
  }
  if (t.id === "e_carApply") {
    if (!E_STATE) eLoad();
    const n = eApplyCarPlan();
    const note = document.getElementById("e_carPlanNote");
    if (note) {
      const prev = note.innerHTML;
      note.innerHTML = `\u2713 applied to ${n} future month${n === 1 ? "" : "s"}`;
      setTimeout(() => eRenderCarPlan(), 2200);
    }
  }
  if (t.id === "e_markThru") {
    if (!E_STATE) eLoad();
    const now = new Date();
    const cur =
      now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    E_STATE.log.forEach((r) => {
      if (/^\d{4}-\d{2}$/.test(r.month) && r.month <= cur) eSetRzAll(r, true);
    });
    eSave();
    eRenderLog();
    eRenderBuckets();
    eRenderSavingsRate();
    eRenderCumChart();
    eRenderSavingsChart();
  }
});
