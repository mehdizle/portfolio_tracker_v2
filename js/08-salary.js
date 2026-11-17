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
    '<div class="salcard nis-cell" style="cursor:help" data-tip="' +
    tipRef(
      tipHead("Gross (Brut Global)") +
        tipRow("Base salary", mad(r.base)) +
        tipRow("+ Seniority premium", mad(r.anc)) +
        tipRow("+ Transport (exempt)", mad(i.transport)) +
        tipRow("+ Panier (exempt)", mad(i.panier)) +
        tipRow("+ RSU / other", mad(i.rsu)) +
        tipRow("= Brut Global", mad(r.bg)) +
        tipNote(
          "Your total monthly gross pay before any social or tax deductions.",
        ),
    ) +
    '"><div class="k">Gross (Brut Global)</div><div class="v">' +
    mad(r.bg) +
    '</div><div class="mini">MAD / month</div></div>' +
    '<div class="salcard nis-cell" style="cursor:help" data-tip="' +
    tipRef(
      tipHead("Net in hand") +
        tipRow("Brut Global", mad(r.bg)) +
        tipRow("\u2212 CNSS + AMO + CIMR", mad(r.cnss + r.amo + r.cimr)) +
        tipRow("\u2212 Income tax (IR)", mad(r.ir)) +
        tipRow("= Net in hand", mad(r.net)) +
        tipRow("Per year", mad(r.net * 12)) +
        tipNote(
          "What actually lands in your account each month, after social contributions and income tax. See the Breakdown table below for every line.",
        ),
    ) +
    '"><div class="k">Net in hand</div><div class="v" style="color:var(--success)">' +
    mad(r.net) +
    '</div><div class="mini">MAD / month \u00B7 ' +
    mad(r.net * 12) +
    "/yr</div></div>" +
    '<div class="salcard nis-cell" style="cursor:help" data-tip="' +
    tipRef(
      tipHead("Income Tax (IR)") +
        tipRow("Revenu Net Imposable", mad(r.rni)) +
        tipRow("Marginal rate", (r.rate * 100).toFixed(0) + "%") +
        tipRow("IR before dependents", mad(r.irGross)) +
        tipRow("\u2212 Dependent relief", mad(r.irGross - r.ir)) +
        tipRow("= Income tax", mad(r.ir)) +
        tipNote(
          "Monthly income tax (IR) from the progressive Moroccan bar\u00E8me: marginal rate on your net taxable income, minus the fixed bracket deduction and dependent relief.",
        ),
    ) +
    '"><div class="k">Income Tax (IR)</div><div class="v" style="color:var(--error)">' +
    mad(r.ir) +
    '</div><div class="mini">marginal ' +
    (r.rate * 100).toFixed(0) +
    "%</div></div>" +
    '<div class="salcard nis-cell" style="cursor:help" data-tip="' +
    tipRef(
      tipHead("Effective deduction") +
        tipRow("Gross (Brut Global)", mad(r.bg)) +
        tipRow("Net in hand", mad(r.net)) +
        tipRow("Effective deduction", (r.effRate * 100).toFixed(2) + "%") +
        tipNote(
          "Share of your gross that is lost to all deductions combined = 1 - net / gross. Your true overall 'tax + contributions' rate.",
        ),
    ) +
    '"><div class="k">Effective deduction</div><div class="v">' +
    (r.effRate * 100).toFixed(2) +
    '%</div><div class="mini">of gross</div></div>';
  // table. Optional 4th arg `tip` adds a hover explanation to the row (for the
  // derived/aggregate lines a reader is likely to question).
  const row = (l, v, cls, tip) =>
    '<tr class="' +
    (cls || "") +
    (tip ? " nis-cell" : "") +
    '"' +
    (tip ? ' style="cursor:help" data-tip="' + tipRef(tip) + '"' : "") +
    "><td>" +
    l +
    '</td><td class="num" style="text-align:right;font-family:var(--mono)">' +
    mad(v) +
    "</td></tr>";
  document.querySelector("#s_table tbody").innerHTML =
    row(
      "Base salary (monthly)",
      r.base,
      "",
      "Your annual base salary divided by 12.",
    ) +
    row(
      "+ Seniority (Anciennet\u00E9: " +
        i.ancYears +
        " yr \u2192 " +
        (r.ancPct * 100).toFixed(0) +
        "%)",
      r.anc,
      "",
      "Seniority premium = base salary x the legally-scaled anciennet\u00E9 rate for your years of service (" +
        (r.ancPct * 100).toFixed(0) +
        "%).",
    ) +
    row(
      "+ Transport (exempt)",
      i.transport,
      "sub",
      "Transport allowance. Tax-exempt within legal limits, so it is added to take-home but not to the taxable base.",
    ) +
    row(
      "+ Panier (exempt)",
      i.panier,
      "sub",
      "Meal allowance (panier). Tax-exempt within legal limits.",
    ) +
    row(
      "+ RSU / other",
      i.rsu,
      "sub",
      "Other taxable income you entered (RSUs, bonuses, etc.).",
    ) +
    row(
      "= Brut Global (BG)",
      r.bg,
      "tot",
      "Brut Global = base + seniority + transport + panier + RSU. Your total gross pay.",
    ) +
    row(
      "Salaire Brut Imposable (SBI)",
      r.sbi,
      "",
      "Taxable gross = Brut Global minus the exempt allowances (transport, panier). This is what social contributions and tax are based on.",
    ) +
    row(
      "\u2212 CNSS (4.48% cap 6 000)",
      r.cnss,
      "sub",
      "Social-security contribution: 4.48% of taxable gross, capped at a 6,000 MAD base.",
    ) +
    row(
      "\u2212 AMO (2.26%)",
      r.amo,
      "sub",
      "Compulsory health-insurance contribution: 2.26% of taxable gross.",
    ) +
    row(
      "\u2212 CIMR (" + (i.cimr * 100).toFixed(1) + "%)",
      r.cimr,
      "sub",
      "Complementary retirement contribution at your chosen rate (" +
        (i.cimr * 100).toFixed(1) +
        "% of taxable gross).",
    ) +
    row(
      "\u2212 Frais professionnels (" +
        (r.fraisProRate * 100).toFixed(0) +
        "% cap 35k/yr)",
      r.fraisPro,
      "sub",
      "Standard professional-expense allowance: " +
        (r.fraisProRate * 100).toFixed(0) +
        "% of taxable gross (35% if annual \u2264 78,000 MAD else 25%), capped at 35,000 MAD/year.",
    ) +
    (i.logementOn
      ? row(
          "\u2212 Housing-loan interest deduction (\u226410% RNI)",
          r.logement,
          "sub",
          "Primary-residence loan interest, deductible up to 10% of net taxable income.",
        )
      : "") +
    row(
      "= Revenu Net Imposable (RNI)",
      r.rni,
      "tot",
      "Net taxable income = taxable gross minus CNSS, AMO, CIMR, professional expenses (and housing-loan interest if enabled). The income tax is computed on this.",
    ) +
    row(
      "IR before dependents (marg " +
        (r.rate * 100).toFixed(0) +
        "% \u2212 " +
        mad(r.ded) +
        ")",
      r.irGross,
      "sub",
      "Income tax from the progressive bar\u00E8me: your net taxable income x the marginal rate (" +
        (r.rate * 100).toFixed(0) +
        "%), minus the fixed deduction for that bracket (" +
        mad(r.ded) +
        "), before dependent relief.",
    ) +
    row(
      "\u2212 Dependent relief (" + i.dep + " \u00D7 50)",
      r.depRelief,
      "sub",
      "50 MAD per month per dependent (" +
        i.dep +
        " x 50), deducted from the income tax.",
    ) +
    row(
      "= Income Tax (IR)",
      r.ir,
      "tot",
      "Final monthly income tax after dependent relief.",
    ) +
    row(
      "NET IN HAND",
      r.net,
      "tot",
      "Take-home pay = Brut Global minus CNSS, AMO, CIMR and income tax.",
    );
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

/* ===== Instant tooltip engine moved to js/01b-tooltip.js ===== */

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
// their current category. Returns {updated, unknown[]}.
function applyCategories(map) {
  // Single source of truth: an uploaded category/cycle/style ALWAYS lands on M,
  // whether or not the ticker already has a master entry. Previously a ticker
  // missing from M was dropped (pushed to `unknown`) and its category silently
  // lost until a later boot re-applied it \u2014 which failed if the key appeared
  // after boot (e.g. you imported categories first, then bought the name). Now
  // we create a lightweight stub so the metadata attaches immediately. The stub
  // carries no price, so it never becomes a trade candidate or a phantom table
  // row (computeSignalsRows() skips price-less, unheld, category-only stubs);
  // once real pricing/financials arrive they Object.assign onto the same key.
  let updated = 0;
  const created = [];
  Object.keys(map).forEach((tk) => {
    const rec = map[tk];
    if (!M[tk]) {
      M[tk] = { _catOnly: true }; // stub \u2014 metadata holder until priced
      created.push(tk);
    }
    if (rec.cat) M[tk].cat = rec.cat;
    if (rec.cycle) M[tk].cycle = rec.cycle;
    if (rec.style) M[tk].style = rec.style;
    if (rec.name && !M[tk].name) M[tk].name = rec.name;
    updated++;
  });
  // `unknown` kept in the return shape for callers/tests, now always empty:
  // nothing is skipped anymore. `created` surfaces the stub count for the UI.
  return { updated, unknown: [], created };
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
    ? "\u00B7 your saved set (" + Object.keys(map).length + " tickers)"
    : "\u00B7 none saved yet";
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
      const { updated, created } = applyCategories(map);
      saveCategories(map);
      // Persist the metadata onto the master itself so it's part of the single
      // source of truth immediately \u2014 not merely replayed from casa_categories_v1
      // on the next boot. Without this, a category attached to a key that only
      // existed in memory (e.g. a stub, or a name added after boot) could be
      // lost the next time casa_master_v1 was rewritten by another action.
      try {
        safeSetItem("casa_master_v1", JSON.stringify(M));
      } catch (_) {}
      res.style.color = "var(--success)";
      res.textContent =
        "\u2705 Applied " +
        updated +
        " categories" +
        (created && created.length
          ? " \u00b7 " + created.length + " new ticker(s) added"
          : "") +
        ".";
      if (rev) {
        rev.innerHTML =
          '<div class="mini" style="color:var(--text2)">Updated <b>' +
          updated +
          "</b> tickers" +
          (created && created.length
            ? " \u00b7 added (not yet priced \u2014 metadata kept): <b>" +
              created.join(", ") +
              "</b>"
            : "") +
          ".</div>";
      }
      refreshCatStamp();
      try {
        render();
      } catch (_) {}
      try {
        renderCatEditor(true);
      } catch (_) {}
      // render() repaints every tab EXCEPT Rebalance (that tab only recomputes
      // on its "Compute plan" button or when you switch into it). Imported
      // categories feed the Rebalance sector/cycle/style readout, so refresh it
      // here too \u2014 otherwise the tab keeps showing the pre-import grouping
      // ("Uncategorized" / "Unclassified") until the next manual recompute.
      try {
        if (
          typeof renderRebalance === "function" &&
          document.getElementById("rbResult")
        ) {
          renderRebalance();
        }
      } catch (_) {}
      inp.value = "";
    };
    rd.readAsText(f);
  };
})();

// ---- set categories in-app (dropdown editor) ----
// Lists every stock whose category / economic cycle / asset style is missing
// (or still the legacy "STOCK" placeholder), held names first, with three
// dropdowns each. Saving goes through the SAME path as a CSV upload
// (applyCategories -> M, merged into the saved set in casa_categories_v1 that
// is replayed on boot, master persisted), so in-app edits survive reloads and
// are part of backups. "Show all stocks" lets you edit any stock.
//
// render() calls this on every repaint (via renderMissingMaster) so a ticker
// that appears later (e.g. a new IPO onboarded from the price feed) shows up
// on its own. Unsaved dropdown choices are kept in a draft and re-applied, so
// a repaint never wipes what you were selecting. State is `var` with no
// initializer: render() can run before this file's text is evaluated.
var _CAT_ED; // { draft: {tk:{cat,cycle,style}}, showAll: bool, extra: {field:[]}, sig: "" }
const CAT_FIELDS = [
  { key: "cat", label: "Category" },
  { key: "cycle", label: "Economic cycle" },
  { key: "style", label: "Asset style" },
];
// Standard values offered even before any stock uses them (same vocabulary as
// the export template's hints). Values already in your data are added on top.
const CAT_DEFAULT_OPTIONS = {
  cat: [
    "Agri-Services / Industrial",
    "Automotive",
    "Banking",
    "Beverages",
    "Building Materials",
    "Chemicals",
    "Construction",
    "Consumer Goods",
    "Energy",
    "Financial Services",
    "Food Producers",
    "Forestry & Paper",
    "Healthcare",
    "Holding",
    "Industrial Goods",
    "Insurance",
    "Mining",
    "Real Estate",
    "Real Estate (REIT)",
    "Retail",
    "Technology",
    "Telecommunications",
    "Tourism",
    "Transport",
    "Transport & Logistics",
    "Utilities",
  ],
  cycle: ["Cyclical", "Sensitives", "Defensive"],
  style: [
    "Yield King",
    "Growth",
    "Compounder",
    "Recovery",
    "Value",
    "Defensive",
    "Cyclical",
  ],
};
function _catBlank(v) {
  return !v || String(v).trim().toUpperCase() === "STOCK";
}

function _catEdState() {
  _CAT_ED = _CAT_ED || { draft: {}, showAll: false, extra: {}, sig: "" };
  return _CAT_ED;
}
// Dropdown options for one field: standard list + every value in M + any
// "Other..." value typed this session, de-duplicated and sorted.
function _catOptions(field) {
  const set = new Set(CAT_DEFAULT_OPTIONS[field] || []);
  Object.keys(M).forEach((tk) => {
    const m = M[tk];
    const v = m && m[field];
    if (m && m.cat !== "OPCVM" && !_catBlank(v)) set.add(String(v).trim());
  });
  (_catEdState().extra[field] || []).forEach((v) => set.add(v));
  return [...set].sort((a, b) => a.localeCompare(b));
}
// Stocks to list: every non-fund master ticker plus every stock ticker in your
// transactions / pending orders. Category-only stubs for names you don't own
// (rows from an uploaded CSV) are listed only in "Show all".
function _catCandidates(showAll) {
  const held = {};
  try {
    Object.values(runFIFO().pos).forEach((p) => {
      if (p && p.ticker && p.held > 1e-9) held[p.ticker] = true;
    });
  } catch (_e) {}
  const mine = {};
  const addMine = (t) => {
    if (t && t.ticker && !isOpcvmTxn(t)) mine[String(t.ticker).trim()] = true;
  };
  try {
    (TXNS || []).forEach(addMine);
  } catch (_e) {}
  try {
    if (Array.isArray(PENDING)) PENDING.forEach(addMine);
  } catch (_e) {}
  const all = new Set([...Object.keys(M), ...Object.keys(mine)]);
  const rows = [];
  all.forEach((tk) => {
    const m = M[tk] || {};
    if (m.cat === "OPCVM") return;
    const relevant = mine[tk] || held[tk] || !m._catOnly;
    if (!relevant && !showAll) return;
    const missing = CAT_FIELDS.some((f) => _catBlank(m[f.key]));
    if (!showAll && !missing) return;
    rows.push({ tk, m, held: !!held[tk], missing });
  });
  // held first, then anything missing, then alphabetical
  rows.sort(
    (a, b) =>
      b.held - a.held || b.missing - a.missing || a.tk.localeCompare(b.tk),
  );
  return rows;
}

function renderCatEditor(force) {
  const el = document.getElementById("catEditor");
  if (!el) return;
  const st = _catEdState();
  const rows = _catCandidates(st.showAll);
  // Skip the repaint when nothing it shows has changed (keeps focus/scroll).
  const sig =
    (st.showAll ? "A|" : "M|") +
    rows
      .map(
        (r) =>
          r.tk +
          ":" +
          (r.m.cat || "") +
          "/" +
          (r.m.cycle || "") +
          "/" +
          (r.m.style || "") +
          (r.held ? "*" : ""),
      )
      .join(",");
  if (!force && sig === st.sig && el.firstChild) return;
  st.sig = sig;

  const missingCount = rows.filter((r) => r.missing).length;
  let h =
    '<div style="border-top:1px solid var(--border);padding-top:12px">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
    "<b>\u270F\uFE0F Set categories</b>" +
    '<label class="mini" style="cursor:pointer"><input type="checkbox" id="catEdAll"' +
    (st.showAll ? " checked" : "") +
    "> Show all stocks</label></div>";
  if (!rows.length) {
    h +=
      '<div class="mini" style="color:var(--success)">\u2705 Every stock has a category, economic cycle and asset style.' +
      (st.showAll ? "" : " Tick <b>Show all stocks</b> to change one.") +
      "</div></div>";
    el.innerHTML = h;
    _wireCatEditor(el);
    return;
  }
  h +=
    '<div class="mini" style="margin-bottom:8px;color:var(--text2)">' +
    (st.showAll
      ? "All stocks. Change any dropdown, then <b>Save</b>."
      : missingCount +
        " stock" +
        (missingCount === 1 ? "" : "s") +
        " with a missing category, cycle or style. Pick the values, then <b>Save</b>. Choose <i>Other\u2026</i> to add a new value.") +
    "</div>";
  h +=
    '<div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr>' +
    '<th scope="col" class="l">Ticker</th>' +
    CAT_FIELDS.map(
      (f) => '<th scope="col" class="l">' + f.label + "</th>",
    ).join("") +
    "</tr></thead><tbody>";
  const opts = {};
  CAT_FIELDS.forEach((f) => (opts[f.key] = _catOptions(f.key)));
  rows.forEach((r) => {
    const d = st.draft[r.tk] || {};
    const nm =
      r.m.name && r.m.name !== r.tk
        ? '<div class="mini" style="color:var(--text2)">' +
          escapeHtml(r.m.name) +
          "</div>"
        : "";
    const hint = r.m.tvSector
      ? '<div class="mini" style="color:var(--muted)">TradingView: ' +
        escapeHtml(r.m.tvSector) +
        "</div>"
      : "";
    h +=
      '<tr><td class="l">' +
      (typeof tickerBadge === "function" ? tickerBadge(r.tk) : "") +
      "<b>" +
      escapeHtml(r.tk) +
      "</b>" +
      (r.held ? ' <span class="tag-in">held</span>' : "") +
      nm +
      hint +
      "</td>";
    CAT_FIELDS.forEach((f) => {
      const cur = _catBlank(r.m[f.key]) ? "" : String(r.m[f.key]).trim();
      const val = d[f.key] != null ? d[f.key] : cur;
      const list = opts[f.key].slice();
      if (val && list.indexOf(val) < 0) list.push(val);
      const changed = d[f.key] != null && d[f.key] !== cur;
      h +=
        '<td class="l"><select class="cat-ed" data-tk="' +
        escapeHtml(r.tk) +
        '" data-field="' +
        f.key +
        '" aria-label="' +
        escapeHtml(f.label + " for " + r.tk) +
        '" style="max-width:190px' +
        (val ? "" : ";border-color:var(--warn)") +
        (changed ? ";outline:1px solid var(--primary2)" : "") +
        '"><option value="">\u2014 choose \u2014</option>' +
        list
          .map(
            (o) =>
              '<option value="' +
              escapeHtml(o) +
              '"' +
              (o === val ? " selected" : "") +
              ">" +
              escapeHtml(o) +
              "</option>",
          )
          .join("") +
        '<option value="__other__">Other\u2026</option></select></td>';
    });
    h += "</tr>";
  });
  const pending = Object.keys(st.draft).length;
  h +=
    "</tbody></table></div>" +
    '<div class="form-row" style="gap:8px;margin-top:8px;align-items:center">' +
    '<button class="btn" id="catEdSave"' +
    (pending ? "" : " disabled") +
    ">\uD83D\uDCBE Save" +
    (pending ? " (" + pending + ")" : "") +
    "</button>" +
    (pending
      ? '<button class="btn sec2" id="catEdDiscard">Discard changes</button>'
      : "") +
    '<span class="mini" id="catEdResult" style="color:var(--muted)"></span></div></div>';
  el.innerHTML = h;
  _wireCatEditor(el);
}

function _wireCatEditor(el) {
  const st = _catEdState();
  const all = el.querySelector("#catEdAll");
  if (all)
    all.onchange = () => {
      st.showAll = all.checked;
      renderCatEditor(true);
    };
  el.querySelectorAll("select.cat-ed").forEach((sel) => {
    sel.onchange = async () => {
      const tk = sel.getAttribute("data-tk");
      const field = sel.getAttribute("data-field");
      let v = sel.value;
      if (v === "__other__") {
        const label =
          (CAT_FIELDS.find((f) => f.key === field) || {}).label || field;
        const typed =
          typeof appPrompt === "function"
            ? await appPrompt("New " + label.toLowerCase() + " for " + tk, "")
            : null;
        v = typed ? String(typed).trim() : "";
        if (!v) {
          renderCatEditor(true); // cancelled -> restore the previous choice
          return;
        }
        st.extra[field] = st.extra[field] || [];
        if (st.extra[field].indexOf(v) < 0) st.extra[field].push(v);
      }
      const m = M[tk] || {};
      const cur = _catBlank(m[field]) ? "" : String(m[field]).trim();
      st.draft[tk] = st.draft[tk] || {};
      // "— choose —" (empty) is not a value you can save: it just undoes any
      // pending change for this field (the repaint shows the stored value).
      if (v === cur || v === "") delete st.draft[tk][field];
      else st.draft[tk][field] = v;
      if (!Object.keys(st.draft[tk]).length) delete st.draft[tk];
      renderCatEditor(true);
    };
  });
  const disc = el.querySelector("#catEdDiscard");
  if (disc)
    disc.onclick = () => {
      st.draft = {};
      renderCatEditor(true);
    };
  const save = el.querySelector("#catEdSave");
  if (save) save.onclick = () => saveCatEditor();
}

// Persist the draft exactly like a CSV upload of those rows would.
function saveCatEditor() {
  const st = _catEdState();
  const map = {};
  Object.keys(st.draft).forEach((tk) => {
    const d = st.draft[tk];
    const rec = {};
    CAT_FIELDS.forEach((f) => {
      if (d[f.key]) rec[f.key] = d[f.key];
    });
    if (Object.keys(rec).length) map[tk] = rec;
  });
  const tks = Object.keys(map);
  if (!tks.length) return;
  applyCategories(map);
  // Merge into the saved set (replayed on every boot) so the edit sticks.
  const saved = loadCategories() || {};
  tks.forEach((tk) => {
    saved[tk] = Object.assign({}, saved[tk], map[tk]);
    if (M[tk] && M[tk].name && !saved[tk].name) saved[tk].name = M[tk].name;
  });
  saveCategories(saved);
  try {
    safeSetItem("casa_master_v1", JSON.stringify(M));
  } catch (_e) {}
  st.draft = {};
  refreshCatStamp();
  try {
    render();
  } catch (_e) {}
  // Same reason as the upload handler: Rebalance only recomputes on demand.
  try {
    if (
      typeof renderRebalance === "function" &&
      document.getElementById("rbResult")
    )
      renderRebalance();
  } catch (_e) {}
  renderCatEditor(true);
  const res = document.getElementById("catEdResult");
  if (res) {
    res.style.color = "var(--success)";
    res.textContent =
      "\u2705 Saved " +
      tks.length +
      " stock" +
      (tks.length === 1 ? "" : "s") +
      ": " +
      tks.join(", ") +
      ".";
  }
  if (typeof toast === "function")
    toast("Categories saved for " + tks.join(", ") + ".", "ok");
}

// ---- export current categories (doubles as the template) ----
// Dumps every master ticker's CURRENT category / economic cycle / asset style
// (reflecting your uploaded set + TradingView + seed) as a CSV with the exact
// columns the importer accepts - so you can edit it and re-import. When nothing
// but the header would be produced (no master yet), a small example is included
// so it still works as a blank template.
(function () {
  const b = document.getElementById("dlCatTemplate");
  if (!b) return;
  // CSV-escape: quote fields containing comma, quote or newline; double inner quotes.
  const q = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  b.onclick = () => {
    const rows = ["Ticker,Company Name,Category,Economic Cycle,Asset Style"];
    const tickers = M && typeof M === "object" ? Object.keys(M).sort() : [];
    let n = 0;
    for (const tk of tickers) {
      const m = M[tk] || {};
      // Skip pure OPCVM funds - categories are a stock concept.
      if (m.cat === "OPCVM") continue;
      rows.push(
        [
          q(tk),
          q(m.name || ""),
          q(m.cat || ""),
          q(m.cycle || ""),
          q(m.style || ""),
        ].join(","),
      );
      n++;
    }
    if (!n) {
      // No master data yet: emit an illustrative example so it still seeds edits.
      rows.push(
        "ATW,Attijariwafa Bank SA,Banking,Cyclical,Compounder",
        "GAZ,Afriquia Gaz,Energy,Defensive,Yield King",
        "AKT,Akdital,Healthcare,Defensive,Growth",
      );
    }
    rows.push(
      "# Economic Cycle: Cyclical / Sensitives / Defensive",
      "# Asset Style: Yield King / Growth / Compounder / Recovery / Value / Defensive / Cyclical",
      "# Edit and re-import. Tickers not listed keep their current category.",
    );
    downloadText("stock_categories.csv", rows.join("\n"));
  };
})();

// ---- clear your categories ----
// There is no built-in default set any more (the embedded seed master was
// removed), so "reset" means: remove the category / cycle / style of every
// ticker in your saved set from the master list too (not just the saved copy -
// imports and the editor also persist them into casa_master_v1, which would
// otherwise restore them on the next load), drop category-only stubs for names
// you don't hold, and repaint. Asks first: this can't be undone (export first).
(function () {
  const b = document.getElementById("resetCat");
  if (!b) return;
  b.onclick = async () => {
    const saved = loadCategories() || {};
    const tks = Object.keys(saved);
    const res = document.getElementById("catResult");
    if (!tks.length) {
      if (res) {
        res.style.color = "var(--muted)";
        res.textContent =
          "Nothing to clear: no categories have been imported or set.";
      }
      return;
    }
    const ok =
      typeof appConfirm === "function"
        ? await appConfirm(
            "Clear the category, economic cycle and asset style of " +
              tks.length +
              " ticker(s)? Export them first if you may want them back.",
          )
        : true;
    if (!ok) return;
    tks.forEach((tk) => {
      const m = M[tk];
      if (!m || m.cat === "OPCVM") return;
      if (m._catOnly && (m.price == null || !isFinite(m.price))) {
        delete M[tk]; // category-only stub for a name you never priced
        return;
      }
      m.cat = null;
      m.cycle = null;
      m.style = null;
    });
    try {
      localStorage.removeItem(CAT_LS);
    } catch (e) {}
    try {
      safeSetItem("casa_master_v1", JSON.stringify(M));
    } catch (_e) {}
    _catEdState().draft = {};
    if (res) {
      res.style.color = "var(--muted)";
      res.textContent =
        "\u21ba Cleared categories for " + tks.length + " ticker(s).";
    }
    const rev = document.getElementById("catReview");
    if (rev) rev.innerHTML = "";
    refreshCatStamp();
    try {
      render();
    } catch (_e) {}
    renderCatEditor(true);
  };
})();

applySavedCategories();
renderCatEditor(true);

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
  // Cash movements feed the Dashboard "Cash Available" KPI. Refresh it at the
  // single save point so the card stays in sync when a movement changes.
  if (typeof refreshKpiRow === "function") refreshKpiRow();
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
  let bal = 0;
  const rows = movements.map((m, i) => {
    const sign = m.type === "deposit" ? 1 : -1;
    const amt = Math.abs(m.amount) * sign;
    const _future = m.date > _today;
    if (!_future) {
      // Only past/today movements accrue the current balance.
      bal += amt;
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
        // Attribute the position to its REAL broker (p.broker, set by the FIFO
        // engine from the transaction's broker field) - NOT one inferred from
        // the PEA flag. Broker and PEA-status are independent, so a PEA holding
        // can live at Saham and a Regular holding at Attijari; inferring broker
        // from pea silently mis-files positions into the wrong account KPI.
        const _pBk = p.broker || (p.isPea ? "attijari" : "saham");
        const _parts = CASH_ACCT.split("_");
        if (_parts.length === 2) {
          if (_pBk !== _parts[0] || (_parts[1] === "pea") !== p.isPea) return;
        } else {
          if (_pBk !== CASH_ACCT) return;
        }
      }
      if (M[p.ticker] && M[p.ticker].cat === "OPCVM") opcvmVal += p.value;
      else stockVal += p.value;
    }
  });

  // Pending orders estimated cost (using computeRow for accurate fee-inclusive amount)
  let pending;
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
    `<div class="card nis-cell"${tip ? ' style="cursor:help" data-tip="' + tipRef(tip) + '"' : ""}>` +
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
    <td style="font-size:11px;opacity:.8">${escapeHtml((BROKERS[r.broker] || {}).name || (r.pea ? "PEA" : "Reg"))} <span class="mini">${r.pea ? "PEA" : "Reg"}</span></td>
    <td>${escapeHtml(r.note || "\u2014")}</td>
    <td style="font-weight:600">${r._bal == null ? "\u2014" : money(r._bal) + " MAD"}</td>
    <td><button class="btn-sm" data-act="editCashRow" data-args="${r._idx}" data-tip="Edit this cash movement">\u270e</button> <button class="btn-sm" data-act="deleteCashRow" data-args="${r._idx}" data-tip="Delete this cash movement">\u2715</button></td>
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
      // Re-default the broker/pea inputs to the CURRENTLY SELECTED account so the
      // next movement is tagged for the account you're actually viewing. When no
      // specific account is selected ("all"), fall back to the same sensible
      // default as the initial form (Attijari + PEA) instead of silently
      // flipping to the first broker key (Saham) + Regular, which mis-filed new
      // movements under the wrong account.
      const _cbk = document.getElementById("cashBroker");
      const _rp = CASH_ACCT.split("_");
      const _hasAcct = _rp[0] !== "all";
      if (_cbk) _cbk.value = _hasAcct ? _rp[0] : "attijari";
      document.getElementById("cashPea").checked = _hasAcct
        ? _rp.length === 2
          ? _rp[1] === "pea"
          : _rp[0] === "attijari"
        : true;
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
