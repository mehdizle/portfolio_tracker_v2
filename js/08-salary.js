// ============================================================
// 08-salary.js
// salary + categories + cash tab + boot wiring (render(), restore last tab, init)
// Part of the Portfolio Tracker app. Loaded as an ordered plain
// <script> (shared global scope) - order matters, see index.html.
// ============================================================
// ---------- Salary Calculation module (Moroccan law, 2026) ----------
const S_LS = "casa_salary_v1";
const CNSS_CEIL_M = 6000; // legal CNSS monthly ceiling (fixed by law)
// 2026 MONTHLY IR bar\u00E8me: [upper bound, rate, deduction]
const IR_BRACKETS_M = [
  [3333.33, 0.0, 0.0],
  [5000.0, 0.1, 333.33],
  [6666.67, 0.2, 833.33],
  [8333.33, 0.3, 1500.0],
  [15000.0, 0.34, 1833.33],
  [Infinity, 0.37, 2283.33],
];
function irMonthly(rni) {
  if (rni <= 0) return { ir: 0, rate: 0, ded: 0 };
  for (const [ub, rate, ded] of IR_BRACKETS_M) {
    if (rni <= ub) return { ir: Math.max(rni * rate - ded, 0), rate, ded };
  }
  return { ir: 0, rate: 0, ded: 0 };
}
// Moroccan labor-law seniority scale (prime d'anciennete)
function ancRate(years) {
  if (years >= 25) return 0.25;
  if (years >= 20) return 0.2;
  if (years >= 12) return 0.15;
  if (years >= 5) return 0.1;
  if (years >= 2) return 0.05;
  return 0.0;
}
function salInputs() {
  return {
    baseAnnual: +document.getElementById("s_baseAnnual").value || 0,
    ancYears: +document.getElementById("s_ancYears").value || 0,
    transport: +document.getElementById("s_transport").value || 0,
    panier: +document.getElementById("s_panier").value || 0,
    rsu: +document.getElementById("s_rsu").value || 0,
    cimr: (+document.getElementById("s_cimr").value || 0) / 100,
    dep: Math.min(Math.max(+document.getElementById("s_dep").value || 0, 0), 6),
    logementOn: !!(document.getElementById("s_logementOn") || {}).checked,
    // Actual annual loan interest (MAD); 0/blank => apply the full 10% cap.
    logementInt: +(document.getElementById("s_logementInt") || {}).value || 0,
  };
}
function computeSalary(i) {
  const base = i.baseAnnual / 12;
  const ancPct = ancRate(i.ancYears); // derive % from Moroccan seniority scale
  const anc = base * ancPct; // seniority premium
  const bg = base + anc + i.transport + i.panier + i.rsu; // brut global
  const sbi = bg - i.transport - i.panier; // salaire brut imposable (exempt allowances removed)
  // Social contributions
  const cnss = Math.min(sbi, CNSS_CEIL_M) * 0.0448; // CNSS salarial 4.48% capped at legal ceiling (6000)
  const amo = sbi * 0.0226; // AMO 2.26%
  const cimr = sbi * i.cimr; // CIMR (contractual)
  // Frais professionnels (LF 2023+): 35% if annual brut imposable \u2264 78 000 MAD,
  // otherwise 25%; both capped at 35 000 MAD/yr.
  const fraisProRate = sbi * 12 <= 78000 ? 0.35 : 0.25;
  const fraisPro = Math.min(sbi * fraisProRate, 35000 / 12);
  const cotis = cnss + amo + cimr + fraisPro; // total deductions from base
  // Housing-loan interest deduction (Moroccan law): deductible interest on a
  // qualifying primary-residence loan, capped at 10% of net taxable income.
  // Base for the 10% cap = (sbi - cotis - rsu). If the user enters their actual
  // annual interest, the deduction = min(actual monthly interest, 10% cap).
  // Toggle off => no deduction (for anyone without such a loan).
  const logementCap = Math.max(sbi - cotis - i.rsu, 0) * 0.1;
  const logement = !i.logementOn
    ? 0
    : i.logementInt > 0
      ? Math.min(i.logementInt / 12, logementCap)
      : logementCap;
  // Net taxable income (RNI)
  const rni = sbi - cotis - logement;
  const { ir: irGross, rate, ded } = irMonthly(rni);
  const depRelief = i.dep * (600 / 12); // 2026: 600 MAD/yr per dependent (was 500 in 2025), monthly
  const ir = Math.max(irGross - depRelief, 0);
  const net = bg - cnss - amo - cimr - ir; // net in hand (frais pro & logement are notional deductions, not cash)
  return {
    base,
    anc,
    ancPct,
    bg,
    sbi,
    cnss,
    amo,
    cimr,
    fraisPro,
    fraisProRate,
    cotis,
    logement,
    rni,
    rate,
    ded,
    irGross,
    depRelief,
    ir,
    net,
    effRate: bg > 0 ? 1 - net / bg : 0,
  };
}
function mad(n) {
  return (Math.round(n * 100) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function renderSalary() {
  const i = salInputs();
  const r = computeSalary(i);
  safeSetItem(S_LS, JSON.stringify(i));
  const ph2 = document.getElementById("s_ancPctHint");
  if (ph2) ph2.textContent = " = " + (r.ancPct * 100).toFixed(0) + "% premium";
  // cards
  document.getElementById("s_cards").innerHTML =
    '<div class="salcard"><div class="k">Gross (Brut Global)</div><div class="v">' +
    mad(r.bg) +
    '</div><div class="mini">MAD / month</div></div>' +
    '<div class="salcard"><div class="k">Net in hand</div><div class="v" style="color:var(--success)">' +
    mad(r.net) +
    '</div><div class="mini">MAD / month \u00B7 ' +
    mad(r.net * 12) +
    "/yr</div></div>" +
    '<div class="salcard"><div class="k">Income Tax (IR)</div><div class="v" style="color:var(--error)">' +
    mad(r.ir) +
    '</div><div class="mini">marginal ' +
    (r.rate * 100).toFixed(0) +
    "%</div></div>" +
    '<div class="salcard"><div class="k">Effective deduction</div><div class="v">' +
    (r.effRate * 100).toFixed(2) +
    '%</div><div class="mini">of gross</div></div>';
  // table
  const row = (l, v, cls) =>
    '<tr class="' +
    (cls || "") +
    '"><td>' +
    l +
    '</td><td class="num" style="text-align:right;font-family:var(--mono)">' +
    mad(v) +
    "</td></tr>";
  document.querySelector("#s_table tbody").innerHTML =
    row("Base salary (monthly)", r.base) +
    row(
      "+ Seniority (Anciennet\u00E9: " +
        i.ancYears +
        " yr \u2192 " +
        (r.ancPct * 100).toFixed(0) +
        "%)",
      r.anc,
    ) +
    row("+ Transport (exempt)", i.transport, "sub") +
    row("+ Panier (exempt)", i.panier, "sub") +
    row("+ RSU / other", i.rsu, "sub") +
    row("= Brut Global (BG)", r.bg, "tot") +
    row("Salaire Brut Imposable (SBI)", r.sbi) +
    row("\u2212 CNSS (4.48% cap 6 000)", r.cnss, "sub") +
    row("\u2212 AMO (2.26%)", r.amo, "sub") +
    row("\u2212 CIMR (" + (i.cimr * 100).toFixed(1) + "%)", r.cimr, "sub") +
    row(
      "\u2212 Frais professionnels (" +
        (r.fraisProRate * 100).toFixed(0) +
        "% cap 35k/yr)",
      r.fraisPro,
      "sub",
    ) +
    (i.logementOn
      ? row(
          "\u2212 Housing-loan interest deduction (\u226410% RNI)",
          r.logement,
          "sub",
        )
      : "") +
    row("= Revenu Net Imposable (RNI)", r.rni, "tot") +
    row(
      "IR before dependents (marg " +
        (r.rate * 100).toFixed(0) +
        "% \u2212 " +
        mad(r.ded) +
        ")",
      r.irGross,
      "sub",
    ) +
    row(
      "\u2212 Dependent relief (" + i.dep + " \u00D7 50)",
      r.depRelief,
      "sub",
    ) +
    row("= Income Tax (IR)", r.ir, "tot") +
    row("NET IN HAND", r.net, "tot");
}

// live recompute on any salary input change
[
  "s_baseAnnual",
  "s_ancYears",
  "s_transport",
  "s_panier",
  "s_rsu",
  "s_cimr",
  "s_dep",
  "s_logementInt",
].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", renderSalary);
});
// checkbox uses 'change' rather than 'input'
(function () {
  const el = document.getElementById("s_logementOn");
  if (el) el.addEventListener("change", renderSalary);
})();
// restore saved inputs
(function () {
  try {
    const s = JSON.parse(localStorage.getItem(S_LS) || "null");
    if (s) {
      const set = (id, v) => {
        const e = document.getElementById(id);
        if (e && v != null) e.value = v;
      };
      set("s_baseAnnual", s.baseAnnual);
      set("s_ancYears", s.ancYears);
      set("s_transport", s.transport);
      set("s_panier", s.panier);
      set("s_rsu", s.rsu);
      set("s_cimr", s.cimr != null ? s.cimr * 100 : null);
      set("s_dep", s.dep);
      set("s_logementInt", s.logementInt ? s.logementInt : null);
      const _lgOn = document.getElementById("s_logementOn");
      if (_lgOn && typeof s.logementOn === "boolean")
        _lgOn.checked = s.logementOn;
    }
  } catch (e) {}
})();

/* ===== Instant tooltip engine (data-tip) \u2014 no native title delay ===== */
(function () {
  if (window.__qtipInit) return;
  window.__qtipInit = true;
  const tip = document.createElement("div");
  tip.id = "__qtip";
  tip.style.cssText =
    "position:fixed;z-index:99999;max-width:340px;background:#0d1520;color:#e6edf3;border:1px solid #2c3742;border-radius:8px;padding:9px 11px;font-size:11.5px;line-height:1.5;white-space:pre-line;box-shadow:0 8px 24px rgba(0,0,0,.45);pointer-events:none;opacity:0;transition:opacity .08s;font-family:var(--sans,system-ui);display:none";
  document.addEventListener("DOMContentLoaded", () =>
    document.body.appendChild(tip),
  );
  if (document.body) document.body.appendChild(tip);
  let cur = null;
  function place(e) {
    const pad = 14;
    let x = e.clientX + pad,
      y = e.clientY + pad;
    const r = tip.getBoundingClientRect();
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  document.addEventListener("mouseover", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) {
      return;
    }
    cur = t;
    var raw = t.getAttribute("data-tip") || "";
    var txt = raw;
    if (/%[0-9A-Fa-f]{2}/.test(raw)) {
      try {
        txt = decodeURIComponent(raw);
      } catch (_) {
        txt = raw;
      }
    }
    if (/<[a-z][\s\S]*>/i.test(txt)) {
      tip.innerHTML = txt;
      tip.style.whiteSpace = "normal";
    } else {
      tip.textContent = txt;
      tip.style.whiteSpace = "pre-line";
    }
    tip.style.display = "block";
    place(e);
    requestAnimationFrame(() => {
      tip.style.opacity = "1";
      place(e);
    });
  });
  document.addEventListener("mousemove", (e) => {
    if (cur) place(e);
  });
  document.addEventListener("mouseout", (e) => {
    const t = e.target.closest("[data-tip]");
    if (t && t === cur) {
      cur = null;
      tip.style.opacity = "0";
      setTimeout(() => {
        if (!cur) tip.style.display = "none";
      }, 100);
    }
  });
})();

/* ===== Stock Categories (manual, not TradingView) \u2014 upload / persist / apply ===== */
const CAT_LS = "casa_categories_v1";
// Split a CSV line respecting simple double-quoted fields (company names may contain commas).
function _csvSplit(line) {
  const out = [];
  let cur = "",
    q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
// Parse a Category CSV -> { TICKER: {name, cat, cycle, style} }
function parseCategoryCSV(text) {
  const lines = String(text)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (!lines.length) return { map: {}, err: "empty file" };
  const hdr = _csvSplit(lines[0]).map((s) => s.toLowerCase());
  const ix = {
    ticker: hdr.findIndex((h) => h === "ticker"),
    name: hdr.findIndex((h) => h.includes("company") || h === "name"),
    cat: hdr.findIndex((h) => h === "category" || h === "sector"),
    cycle: hdr.findIndex((h) => h.includes("economic") || h === "cycle"),
    style: hdr.findIndex((h) => h.includes("asset") || h === "style"),
  };
  if (ix.ticker < 0) return { map: {}, err: "CSV needs a Ticker column" };
  const map = {};
  for (let i = 1; i < lines.length; i++) {
    const c = _csvSplit(lines[i]);
    const tk = (c[ix.ticker] || "").toUpperCase().trim();
    if (!tk) continue;
    const rec = {};
    if (ix.name >= 0 && c[ix.name]) rec.name = c[ix.name];
    if (ix.cat >= 0 && c[ix.cat]) rec.cat = c[ix.cat];
    if (ix.cycle >= 0 && c[ix.cycle]) rec.cycle = c[ix.cycle];
    if (ix.style >= 0 && c[ix.style]) rec.style = c[ix.style];
    if (Object.keys(rec).length) map[tk] = rec;
  }
  return { map, err: null };
}
// Apply a category map onto M. Only tickers present in the map are touched; others keep
// their existing (TradingView / seed) category. Returns {updated, unknown[]}.
function applyCategories(map) {
  let updated = 0;
  const unknown = [];
  Object.keys(map).forEach((tk) => {
    const rec = map[tk];
    if (!M[tk]) {
      unknown.push(tk);
      return;
    } // not in master \u2014 cannot attach metrics; skip (TV fallback stays)
    if (rec.cat) M[tk].cat = rec.cat;
    if (rec.cycle) M[tk].cycle = rec.cycle;
    if (rec.style) M[tk].style = rec.style;
    if (rec.name && !M[tk].name) M[tk].name = rec.name;
    updated++;
  });
  return { updated, unknown };
}
function saveCategories(map) {
  safeSetItem(CAT_LS, JSON.stringify(map));
}
function loadCategories() {
  try {
    const s = localStorage.getItem(CAT_LS);
    return s ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
}
// On boot: if the user has uploaded an updated set, re-apply it over the built-in default.
function applySavedCategories() {
  const map = loadCategories();
  if (map) {
    applyCategories(map);
  }
  refreshCatStamp();
}
function refreshCatStamp() {
  const el = document.getElementById("catStamp");
  if (!el) return;
  const map = loadCategories();
  el.textContent = map
    ? "\u00B7 using your uploaded set (" + Object.keys(map).length + " tickers)"
    : "\u00B7 built-in default set";
}

// ---- upload handler ----
(function () {
  const inp = document.getElementById("importCat");
  if (!inp) return;
  inp.onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const { map, err } = parseCategoryCSV(rd.result);
      const res = document.getElementById("catResult");
      const rev = document.getElementById("catReview");
      if (err) {
        res.style.color = "var(--error)";
        res.textContent = "\u274c " + err;
        return;
      }
      const n = Object.keys(map).length;
      if (!n) {
        res.style.color = "var(--error)";
        res.textContent = "\u274c No ticker rows found.";
        return;
      }
      const { updated, unknown } = applyCategories(map);
      saveCategories(map);
      res.style.color = "var(--success)";
      res.textContent =
        "\u2705 Applied " +
        updated +
        " categories" +
        (unknown.length
          ? " \u00b7 " + unknown.length + " unknown ticker(s) skipped"
          : "") +
        ".";
      if (rev) {
        rev.innerHTML =
          '<div class="mini" style="color:var(--text2)">Updated <b>' +
          updated +
          "</b> tickers" +
          (unknown.length
            ? " \u00b7 skipped (not in master, kept TradingView category): <b>" +
              unknown.join(", ") +
              "</b>"
            : "") +
          ".</div>";
      }
      refreshCatStamp();
      try {
        render();
      } catch (_) {}
      inp.value = "";
    };
    rd.readAsText(f);
  };
})();

// ---- template download ----
(function () {
  const b = document.getElementById("dlCatTemplate");
  if (!b) return;
  b.onclick = () => {
    const rows = [
      "Ticker,Company Name,Category,Economic Cycle,Asset Style",
      "ATW,Attijariwafa Bank SA,Banking,Cyclical,Compounder",
      "GAZ,Afriquia Gaz,Energy,Defensive,Yield King",
      "AKT,Akdital,Healthcare,Defensive,Growth",
      "# Economic Cycle: Cyclical / Sensitives / Defensive",
      "# Asset Style: Yield King / Growth / Compounder / Recovery / Value / Defensive / Cyclical",
      "# Tickers not listed here keep their existing (TradingView) category.",
    ];
    downloadText("stock_categories_template.csv", rows.join("\n"));
  };
})();

// ---- reset to built-in default ----
(function () {
  const b = document.getElementById("resetCat");
  if (!b) return;
  b.onclick = () => {
    try {
      localStorage.removeItem(CAT_LS);
    } catch (e) {}
    const res = document.getElementById("catResult");
    if (res) {
      res.style.color = "var(--muted)";
      res.textContent =
        "\u21ba Reverted to built-in default. Reload to fully reset any changed values.";
    }
    const rev = document.getElementById("catReview");
    if (rev) rev.innerHTML = "";
    refreshCatStamp();
  };
})();

applySavedCategories();

showBackupAge();
renderDivTax();
renderPending();

// \u2550\u2550\u2550\u2550\u2550\u2550\u2550 CASH TAB \u2550\u2550\u2550\u2550\u2550\u2550\u2550
const CASH_LS = "casa_cash_v1";
let CASH_ACCT = "all"; // 'all' or a broker id (e.g. 'saham','attijari')
function loadCash() {
  // Corruption-safe like the other loaders: quarantines a bad value to a
  // *_corrupt_* key and warns, instead of silently discarding it.
  const raw = localStorage.getItem(CASH_LS);
  if (raw == null) return [];
  const parsed = safeParseLS(CASH_LS, raw, [], "Cash movements");
  return Array.isArray(parsed.value) ? parsed.value : [];
}
function saveCash(arr) {
  if (safeSetItem(CASH_LS, JSON.stringify(arr))) markSaved();
  else markSaveFailed();
}

function renderCash() {
  const _today = _qwTodayISO();
  // Include ALL movements (past + future). Future-dated ones are shown as "upcoming"
  // but do NOT count toward the current balance (which is as-of-today).
  // Carry each row's index in the FULL sorted array (_srcIdx) so edit/delete
  // target the correct stored row even when an account filter is active.
  const _allMov = loadCash()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m, i) => ({ ...m, _srcIdx: i }));
  const movements =
    CASH_ACCT === "all"
      ? _allMov
      : _allMov.filter((m) => {
          const parts = CASH_ACCT.split("_"); // e.g. 'attijari_pea' \u2192 ['attijari','pea']
          if (parts.length === 2) {
            return (
              (m.broker || "saham") === parts[0] &&
              (parts[1] === "pea" ? !!m.pea : !m.pea)
            );
          }
          return (m.broker || "saham") === CASH_ACCT; // fallback: broker-only filter
        });
  const body = document.getElementById("cashBody");
  const summary = document.getElementById("cashSummary");
  if (!body || !summary) return;

  // Compute running balance from user cash movements (deposits/withdrawals/fees)
  let bal = 0,
    totalDeposits = 0,
    totalWithdrawals = 0,
    totalFees = 0;
  const rows = movements.map((m, i) => {
    const sign = m.type === "deposit" ? 1 : -1;
    const amt = Math.abs(m.amount) * sign;
    const _future = m.date > _today;
    if (!_future) {
      // Only past/today movements accrue the current balance and the totals.
      bal += amt;
      if (m.type === "deposit") totalDeposits += Math.abs(m.amount);
      else if (m.type === "withdrawal") totalWithdrawals += Math.abs(m.amount);
      else if (m.type === "fee") totalFees += Math.abs(m.amount);
    }
    return {
      ...m,
      _bal: _future ? null : bal,
      _idx: m._srcIdx,
      _amt: amt,
      _future,
    };
  });

  // Check for an "initial" balance entry \u2014 sets the reference date
  const initEntry = movements.find((m) => m.type === "initial");
  const refDate = initEntry ? initEntry.date : null;

  // Net trading cash flow: sum of all transaction .net values
  // Only count transactions ON OR AFTER the reference date (if set)
  let fifoResult = {};
  try {
    fifoResult = runFIFO();
  } catch (_e) {}
  const pos = fifoResult.pos || {};
  const enriched = fifoResult.enriched || [];
  let tradingCash = 0;
  enriched.forEach((e) => {
    if (typeof e.net === "number" && e.date <= _today) {
      if (!refDate || e.date >= refDate) {
        if (CASH_ACCT === "all") {
          if (!(txnBroker(e) === "saham" && !e.pea)) tradingCash += e.net;
        } else {
          const _p = CASH_ACCT.split("_");
          if (_p.length === 2) {
            if (txnBroker(e) === _p[0] && (_p[1] === "pea" ? !!e.pea : !e.pea))
              tradingCash += e.net;
          } else if (txnBroker(e) === CASH_ACCT) tradingCash += e.net;
        }
      }
    }
  });

  // Cash in account = user movements + trading cash flow (from ref date onward)
  const cashBalance = bal + tradingCash;

  // Portfolio valuations from current positions
  const _cpos = Object.values(pos);
  let stockVal = 0,
    opcvmVal = 0;
  _cpos.forEach((p) => {
    if (p.held > 0 && p.value > 0) {
      if (CASH_ACCT !== "all") {
        const _parts = CASH_ACCT.split("_");
        if (_parts.length === 2) {
          const _pBk = txnBroker({ pea: p.isPea });
          if (_pBk !== _parts[0] || (_parts[1] === "pea") !== p.isPea) return;
        } else {
          const _pBk = p.isPea ? "attijari" : "saham";
          if (_pBk !== CASH_ACCT) return;
        }
      }
      if (M[p.ticker] && M[p.ticker].cat === "OPCVM") opcvmVal += p.value;
      else stockVal += p.value;
    }
  });

  // Pending orders estimated cost (using computeRow for accurate fee-inclusive amount)
  let pending = [];
  try {
    pending = JSON.parse(localStorage.getItem("casa_pending_v1") || "[]");
    if (!Array.isArray(pending)) pending = [];
  } catch (e) {
    pending = Array.isArray(PENDING) ? PENDING : [];
  }
  let pendingCost = 0;
  pending.forEach((o) => {
    if (o.action === "BUY" && o.date <= _today) {
      if (CASH_ACCT !== "all") {
        const _pp = CASH_ACCT.split("_");
        if (_pp.length === 2) {
          if (txnBroker(o) !== _pp[0] || (_pp[1] === "pea") !== !!o.pea) return;
        } else if (txnBroker(o) !== CASH_ACCT) return;
      }
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
        pendingCost += Math.abs(rr.net) || 0;
      } catch (_e) {
        pendingCost += (o.qty || 0) * (o.price || 0);
      }
    }
  });

  // Summary cards
  const card = (label, value, cls, tip) =>
    `<div class="card nis-cell"${tip ? ' style="cursor:help" data-tip="' + encodeURIComponent(tip) + '"' : ""}>` +
    `<div class="label">${label}</div>` +
    `<div class="value ${cls || ""}">${value}</div></div>`;

  // Warning if transactions exist before first recorded deposit & no initial balance
  let _cashWarn = "";
  if (!initEntry && enriched.length > 0 && movements.length > 0) {
    // Only check transactions matching the current account filter
    const _filteredTxns = enriched.filter((e) => {
      // Exclude bank-funded accounts (saham+reg) \u2014 they don't track cash
      if (txnBroker(e) === "saham" && !e.pea) return false;
      if (CASH_ACCT === "all") return true;
      const _wp = CASH_ACCT.split("_");
      if (_wp.length === 2)
        return txnBroker(e) === _wp[0] && (_wp[1] === "pea" ? !!e.pea : !e.pea);
      return txnBroker(e) === CASH_ACCT;
    });
    if (_filteredTxns.length > 0) {
      const firstTxn = _filteredTxns.reduce(
        (m, e) => (e.date < m ? e.date : m),
        _filteredTxns[0].date,
      );
      const firstMov = movements[0].date;
      if (firstTxn < firstMov)
        _cashWarn =
          '<div style="background:var(--warn-bg,#fef3c7);border:1px solid var(--warn-border,#f59e0b);border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:#92400e">\u26a0\ufe0f You have transactions before your first recorded deposit. Add an <b>Initial Balance</b> entry (your broker cash on the date you started tracking) for accurate totals.</div>';
    }
  }

  const _isBankFunded = CASH_ACCT === "saham_reg";
  const _effectiveCash = _isBankFunded ? 0 : cashBalance;
  const cashAvailable = _effectiveCash - pendingCost;
  const totalPortfolio = _isBankFunded
    ? stockVal + opcvmVal
    : _effectiveCash + stockVal + opcvmVal;
  summary.innerHTML =
    _cashWarn +
    card(
      "Cash Available",
      _isBankFunded ? "N/A (bank-funded)" : money(cashAvailable, 0) + " MAD",
      _isBankFunded ? "" : cashAvailable >= 0 ? "pos" : "neg",
      _isBankFunded
        ? "Trades are paid directly from your bank account. No separate brokerage cash to track."
        : "Cash in account minus committed pending orders. What you can actually deploy.",
    ) +
    card(
      "Stocks Value",
      money(stockVal, 0) + " MAD",
      "",
      "Market value of all held stock positions (shares \u00d7 live price).",
    ) +
    card(
      "OPCVM Value",
      money(opcvmVal, 0) + " MAD",
      "",
      "Market value of all held fund/OPCVM positions.",
    ) +
    card(
      "Pending Orders",
      money(pendingCost, 0) + " MAD",
      pendingCost > 0 ? "neg" : "",
      "Total cost of pending BUY orders (fee-inclusive). This cash is committed.",
    ) +
    card(
      "Total Portfolio",
      money(totalPortfolio, 0) + " MAD",
      "",
      "Cash balance + Stocks + OPCVM. Your total account value.",
    );

  // Hide movements form+table for bank-funded accounts
  const _cashForm = document.querySelector("#cash .form-row");
  const _cashTableWrap = document.getElementById("cashTable");
  if (_isBankFunded) {
    if (_cashForm) _cashForm.style.display = "none";
    if (_cashTableWrap) _cashTableWrap.parentElement.style.display = "none";
    const _bfNote = document.querySelector("#cash .bankfunded-note");
    if (!_bfNote) {
      const n = document.createElement("div");
      n.className = "bankfunded-note mini";
      n.style.cssText =
        "margin-top:12px;padding:10px 14px;background:var(--panel2);border-radius:8px;color:var(--text2)";
      n.innerHTML =
        "This account is funded directly from your bank \u2014 no cash deposits/withdrawals to track here. Portfolio value and pending orders are shown above.";
      const sec = document.querySelector("#cash .sec");
      if (sec) sec.appendChild(n);
    }
    return;
  } else {
    if (_cashForm) _cashForm.style.display = "";
    if (_cashTableWrap) _cashTableWrap.parentElement.style.display = "";
    const _bfNote = document.querySelector("#cash .bankfunded-note");
    if (_bfNote) _bfNote.remove();
  }

  // Table
  const typeLabel = {
    deposit: "\u2795 Deposit",
    withdrawal: "\u2796 Withdrawal",
    fee: "\ud83d\udcb8 Fee",
    initial: "\u2696\ufe0f Initial",
  };
  const typeCls = {
    deposit: "pos",
    withdrawal: "neg",
    fee: "neg",
    initial: "pos",
  };
  body.innerHTML = rows
    .slice()
    .reverse()
    .map(
      (r) => `<tr${r._future ? ' style="opacity:.6"' : ""}>
    <td>${r.date}${r._future ? ' <span class="chip" style="background:rgba(56,189,248,.15);color:var(--info)" data-tip="Future-dated \u2014 not counted in the current balance until this date">\u23F3 upcoming</span>' : ""}</td>
    <td><span class="${typeCls[r.type] || ""}">${typeLabel[r.type] || r.type}</span></td>
    <td class="${r._amt >= 0 ? "pos" : "neg"}">${money(r._amt)} MAD</td>
    <td style="font-size:11px;opacity:.8">${(BROKERS[r.broker] || {}).name || (r.pea ? "PEA" : "Reg")} <span class="mini">${r.pea ? "PEA" : "Reg"}</span></td>
    <td>${r.note || "\u2014"}</td>
    <td style="font-weight:600">${r._bal == null ? "\u2014" : money(r._bal) + " MAD"}</td>
    <td><button class="btn-sm" data-act="editCashRow" data-args="${r._idx}" title="Edit">\u270e</button> <button class="btn-sm" data-act="deleteCashRow" data-args="${r._idx}" title="Delete">\u2715</button></td>
  </tr>`,
    )
    .join("");

  if (rows.length === 0) {
    body.innerHTML =
      '<tr><td colspan="7" style="text-align:center;opacity:.6;padding:24px">No cash movements recorded yet. Add a deposit to get started.</td></tr>';
  }
}

function deleteCashRow(idx) {
  if (!confirm("Delete this cash movement?")) return;
  const arr = loadCash().sort((a, b) => a.date.localeCompare(b.date));
  arr.splice(idx, 1);
  saveCash(arr);
  renderCash();
}

// Wire the Add/Edit button
let CASH_EDIT_IX = null;
(function () {
  const btn = document.getElementById("cashAdd");
  if (!btn) return;
  const dateEl = document.getElementById("cashDate");
  if (dateEl) dateEl.value = _qwTodayISO();

  btn.onclick = () => {
    const date = document.getElementById("cashDate").value;
    const type = document.getElementById("cashType").value;
    const amt = parseFloat(document.getElementById("cashAmt").value);
    const note = document.getElementById("cashNote").value.trim();

    if (!date) {
      toast("Please enter a date.", "warn");
      return;
    }
    if (!amt || amt <= 0) {
      toast("Please enter a positive amount.", "warn");
      return;
    }

    const arr = loadCash();
    const broker = document.getElementById("cashBroker").value;
    const pea = document.getElementById("cashPea").checked;
    if (CASH_EDIT_IX !== null) {
      // Editing existing entry
      const sorted = arr.sort((a, b) => a.date.localeCompare(b.date));
      sorted[CASH_EDIT_IX] = {
        date,
        type,
        amount: amt,
        note,
        broker,
        pea,
      };
      saveCash(sorted);
      CASH_EDIT_IX = null;
      btn.textContent = "Add";
    } else {
      arr.push({ date, type, amount: amt, note, broker, pea });
      saveCash(arr);
    }

    // Reset form
    document.getElementById("cashAmt").value = "";
    document.getElementById("cashNote").value = "";
    {
      const _cbk = document.getElementById("cashBroker");
      const _rp = CASH_ACCT.split("_");
      if (_cbk)
        _cbk.value = _rp[0] !== "all" ? _rp[0] : Object.keys(BROKERS)[0];
      document.getElementById("cashPea").checked =
        _rp.length === 2 ? _rp[1] === "pea" : _rp[0] === "attijari";
    }
    document.getElementById("cashDate").value = _qwTodayISO();
    document.getElementById("cashType").value = "deposit";
    renderCash();
  };
})();

function editCashRow(idx) {
  const arr = loadCash().sort((a, b) => a.date.localeCompare(b.date));
  const m = arr[idx];
  if (!m) return;
  document.getElementById("cashDate").value = m.date;
  document.getElementById("cashType").value = m.type;
  document.getElementById("cashAmt").value = m.amount;
  document.getElementById("cashNote").value = m.note || "";
  {
    const _cbk = document.getElementById("cashBroker");
    if (_cbk) _cbk.value = m.broker || "saham";
  }
  document.getElementById("cashPea").checked = !!m.pea;
  CASH_EDIT_IX = idx;
  document.getElementById("cashAdd").textContent = "Save";
  document
    .getElementById("cashAdd")
    .scrollIntoView({ behavior: "smooth", block: "nearest" });
}

populateBrokerSelects();
wireBrokerAutoSelect();
try {
  renderCash();
} catch (_ce) {
  console.error("Cash init:", _ce);
}
// Build broker+account filter buttons dynamically
(function () {
  const cont = document.getElementById("cashAcctFilter");
  if (!cont) return;
  // Generate one button per broker+account combo (PEA and Reg for each broker)
  Object.keys(BROKERS).forEach((id) => {
    ["reg", "pea"].forEach((acct) => {
      const btn = document.createElement("button");
      btn.className = "btn sec2 cashAcctBtn";
      btn.dataset.cacct = id + "_" + acct;
      btn.style.cssText = "font-size:12px;padding:5px 14px;border-radius:14px";
      btn.textContent =
        BROKERS[id].name + " " + (acct === "pea" ? "PEA" : "Reg");
      cont.appendChild(btn);
    });
  });
  // Populate cashBroker dropdown
  const cbk = document.getElementById("cashBroker");
  if (cbk) {
    cbk.innerHTML = Object.keys(BROKERS)
      .map(
        (id) => '<option value="' + id + '">' + BROKERS[id].name + "</option>",
      )
      .join("");
    cbk.value = "attijari";
    cbk.onchange = () => {
      document.getElementById("cashPea").checked = cbk.value === "attijari";
    };
  }
})();
document.querySelectorAll(".cashAcctBtn").forEach((b) => {
  b.onclick = () => {
    CASH_ACCT = b.dataset.cacct;
    document.querySelectorAll(".cashAcctBtn").forEach((x) => {
      const on = x.dataset.cacct === CASH_ACCT;
      x.classList.toggle("active", on);
      x.classList.toggle("sec2", !on);
    });
    renderCash();
  };
});

render();

// Restore last active app + tab (from localStorage; URL is kept clean).
(function () {
  try {
    // Strip any leftover "#tab" from older versions / bookmarks so the URL is
    // clean. Restore is driven entirely by localStorage below.
    if (window.location.hash) {
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
    const lastApp = localStorage.getItem("casa_last_app_v1") || "portfolio";
    if (lastApp !== "portfolio") {
      const ab = document.querySelector('.app-btn[data-app="' + lastApp + '"]');
      if (ab) ab.click();
    } else {
      const lastTab = localStorage.getItem("casa_last_tab_v1");
      if (lastTab) {
        const btn = document.querySelector('.tab[data-view="' + lastTab + '"]');
        if (btn) btn.click();
      }
    }
  } catch (e) {}
})();
