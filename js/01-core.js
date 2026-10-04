// ============================================================
// 01-core.js
// core: toast, safe storage, modals, escapeHtml, theme cache, SEED/config, fees & broker defs, formatters, divRate
//
// One of 9 ordered source files (01..09). scripts/concat.mjs concatenates
// them in order into a single shared-scope bundle, which Vite bundles +
// minifies. Order matters (definitions before boot). Logic unchanged from
// the original single-file app.
// ============================================================
"use strict";
// ---------- Toast notifications (accessible, non-blocking) ----------
function toast(msg, type) {
  try {
    var host = document.getElementById("toastHost");
    if (!host) return;
    var ico =
      {
        err: "\u26D4",
        warn: "\u26A0\uFE0F",
        ok: "\u2705",
        info: "\u2139\uFE0F",
      }[type || "info"] || "\u2139\uFE0F";
    var el = document.createElement("div");
    el.className = "qtoast " + (type || "info");
    el.setAttribute("role", type === "err" ? "alert" : "status");
    var span = document.createElement("span");
    span.className = "qt-ico";
    span.textContent = ico;
    var body = document.createElement("span");
    body.textContent = String(msg);
    el.appendChild(span);
    el.appendChild(body);
    host.appendChild(el);
    requestAnimationFrame(function () {
      el.classList.add("show");
    });
    var life = type === "err" ? 5200 : 3200;
    setTimeout(function () {
      el.classList.remove("show");
      setTimeout(function () {
        el.remove();
      }, 240);
    }, life);
  } catch (_) {
    /* toast must never throw */
  }
}
// ---------- safe persistence helpers ----------
// Single choke point for localStorage writes so a failure (private mode,
// quota exceeded, disabled storage) is surfaced to the user instead of being
// silently swallowed. Returns true on success, false on failure.
let _storageWarned = false;
function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    _storageWarned = false;
    return true;
  } catch (e) {
    // Only nag once per failure streak so we don't spam a toast per keystroke.
    if (!_storageWarned) {
      _storageWarned = true;
      const quota =
        e &&
        (e.name === "QuotaExceededError" ||
          e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
          e.code === 22 ||
          e.code === 1014);
      toast(
        quota
          ? "Storage is full \u2014 your latest change was NOT saved. Export a backup and free up space."
          : "Couldn't save to this browser \u2014 your latest change was NOT saved. " +
              ((e && e.message) || ""),
        "err",
      );
    }
    return false;
  }
}
// Parse a localStorage value that is expected to be JSON. On corruption, the
// raw string is preserved under "<key>_corrupt_<timestamp>" (best effort) and
// the caller-supplied fallback is returned, so bad data is never silently lost
// and can be recovered from the backup dump. Returns { ok, value }.
function safeParseLS(key, raw, fallback, label) {
  if (raw == null) return { ok: true, value: fallback };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    try {
      localStorage.setItem(key + "_corrupt_" + Date.now(), raw);
    } catch (_) {}
    console.error("Corrupt data for " + (label || key) + ":", e);
    toast(
      (label || key) +
        " data was unreadable and has been set aside (saved as a *_corrupt_* key). Restore from a backup to recover it.",
      "err",
    );
    return { ok: false, value: fallback };
  }
}
// ---------- in-app modal helpers moved to js/01c-ui-kit.js ----------
// (_qwTodayISO / validTxnDate / appConfirm / appPrompt / appFillDialog now live
// in the UI-kit module.)

// ---------- HTML escaping (XSS-safe interpolation of user text) ----------
function escapeHtml(v) {
  if (v == null) return "";
  return String(v).replace(/[&<>"']/g, function (c) {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c];
  });
}

// ---------- Ticker badge widget moved to js/01c-ui-kit.js ----------
// (tickerBadge / logoCandidate / LOGO_DIRS / LOGO_EXTS and the logo-error
// fallback now live in the UI-kit module.)

// ---------- Tooltip registry + engine moved to js/01b-tooltip.js ----------
// (tipRef / __TIP and the hover engine now live in the dedicated tooltip
// module, which loads immediately after this file.)

// ---------- Highcharts load guard (graceful offline degradation) ----------
(function () {
  if (typeof Highcharts === "undefined") {
    // Charts need the Highcharts CDN (internet). Show a friendly note instead of blank boxes,
    // and stub the API so render() never throws.
    window.Highcharts = {
      chart: function (id) {
        const el = document.getElementById(id);
        if (el)
          el.innerHTML =
            '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px;text-align:center;padding:20px">\uD83D\uDCC8 Charts need an internet connection to load.<br>All tables & numbers work offline.</div>';
        return { reflow: function () {} };
      },
    };
  }
})();

// ---------- Theme color accessor (single source of truth for charts) ----------
// Reads a CSS design token (e.g. themeColor('primary')) so chart series colors
// always follow the :root theme. If you retune --primary/--success/etc., every
// chart updates on next render \u2014 no hardcoded hexes to hunt down. Fallbacks match
// the current palette in case a token is ever missing.
// Theme tokens are cached: reading a CSS custom property forces a style
// recalc, and the chart/render paths ask for them many times per refresh.
// We compute them once and refresh only when the theme actually changes
// (see refreshThemeCache(), called from applyTheme + at boot).
const _themeFallback = {
  primary: "#7c5cdd",
  primary2: "#9a7ef0",
  success: "#2dd4a7",
  error: "#f26d6d",
  warn: "#f5b544",
  info: "#8b9cf5",
  text: "#e6edf3",
  text2: "#9ca3af",
  border: "#262a33",
};
let _themeCache = null;
function refreshThemeCache() {
  try {
    const cs = getComputedStyle(document.documentElement);
    const c = {};
    for (const name in _themeFallback) {
      const v = cs.getPropertyValue("--" + name).trim();
      c[name] = v || _themeFallback[name];
    }
    _themeCache = c;
  } catch (e) {
    _themeCache = { ..._themeFallback };
  }
  return _themeCache;
}
function themeColor(name) {
  const c = _themeCache || refreshThemeCache();
  return c[name] || _themeFallback[name] || "#7c5cdd";
}

const SEED = {
  transactions: [],
  master: {},
  dividend_calendar: [],
  fee_params: { commission: 0.0099, fixed_fee: 2.75, tpcvm: 0.15 },
  // Dividend tax by year now has a single source of truth in src/core/config.js
  // (DIVTAX_DEFAULT, via __core.defaults); 02b-fees.js seeds from there.
  prices_updated: "2026-07-29",
};
const LS_KEY = "casa_portfolio_txns_v1";
const ISSUER_TO_TICKER = {
  "MAGHREB OXYGENE": "MOX",
  "AFRIQUIA GAZ": "GAZ",
  "IMMORENTE INVEST": "IMO",
  "AUTO NEJMA": "NEJ",
  "AUTO HALL": "ATH",
  SALAFIN: "SLF",
  CDM: "CDM",
  "CASH PLUS S.A": "CAP",
  "SOCIETE DES BOISSONS DU MAROC": "SBM",
  "CFG BANK": "CFG",
  "HOLCIM MAROC S.A": "LHM",
  "WAFA ASSURANCE": "WAA",
  "TOTALENERGIES MARKETING MAROC": "TMA",
  ATLANTASANAD: "ATL",
  "ARADEI CAPITAL": "ARD",
  "AFRIC INDUSTRIES SA": "AFI",
  "SOCIETE LES EAUX MINERALES D'OULMES": "OUL",
  VICENNE: "VCN",
  RISMA: "RIS",
  DISWAY: "DWY",
  "DISTY TECHNOLOGIES": "DYT",
  "LABEL VIE": "LBV",
  "MUTANDIS SCA": "MUT",
  "CREDIT IMMOBILIER ET HOTELIER": "CIH",
  "SOCIETE DE THERAPEUTIQUE MAROCAINE": "SSOT",
  "CIMENTS DU MAROC": "CMA",
  "ENNAKL AUTOMOBILES": "NKL",
  "ATTIJARIWAFA BANK": "ATW",
  "BANQUE CENTRALE POPULAIRE": "BCP",
  "DELTA HOLDING": "DHO",
  "JET CONTRACTORS": "JET",
  "ALUMINIUM DU MAROC": "ALM",
  AGMA: "AGM",
  "SOCIETE GENERALE DES TRAVAUX DU MAROC": "GTM",
  MANAGEM: "MNG",
  "SOCIETE METALLURGIQUE D'IMITER": "SMI",
  "HIGHTECH PAYMENT SYSTEMS": "HPS",
  "BANK OF AFRICA": "BOA",
  "BANQUE MAROCAINE POUR LE COMMERCE ET L'INDUSTRIE": "BCI",
  MICRODATA: "MIC",
  "SOCIETE D'EXPLOITATION DES PORTS - MARSA MAROC": "MSA",
  "SOCIETE NATIONALE DE SIDERURGIE SA": "SID",
  "ALLIANCES DEVELOPPEMENT IMMOBILIER SA": "ADI",
  COSUMAR: "CSR",
  EQDOM: "EQD",
  BALIMA: "BAL",
  "DARI COUSPATE": "DRI",
  "SANLAM MAROC": "SAH",
  MAGHREBAIL: "MAB",
  "ITISSALAT AL-MAGHRIB": "IAM",
  "SOCIETE DE PROMOTION PHARMACEUTIQUE DU MAGHREB S.A.": "PRO",
  "TAQA MOROCCO": "TQM",
};
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
// ---------- Fee / broker / dividend-tax config moved to js/02b-fees.js ----------
// (FP, FP_PEA, BROKERS, DIVTAX and their ~20 helper functions now live in the
// fees module, which loads right after this file and before 02-compute.js.)
const M = SEED.master; // ticker -> metrics

// ---------- persistence ----------
function loadTxns() {
  const s = localStorage.getItem(LS_KEY);
  const seed = () => SEED.transactions.map((t) => ({ ...t }));
  if (s == null) return seed();
  const parsed = safeParseLS(LS_KEY, s, null, "Transactions");
  // On corrupt data safeParseLS has stashed the raw copy and warned; fall back to
  // the (empty) seed without letting the next save silently overwrite the bad key.
  return Array.isArray(parsed.value) ? parsed.value : seed();
}
function saveTxns(t) {
  if (safeSetItem(LS_KEY, JSON.stringify(t))) markSaved();
  else markSaveFailed();
  // Transactions drive the whole Dashboard KPI row. Refresh it at the save
  // point so the cards stay in sync even if a caller saves without a full
  // render(). Guarded + no-op when the dashboard/helper isn't available.
  if (typeof refreshKpiRow === "function") refreshKpiRow();
}
// ---------- saved indicator + last-backup time ----------
let _saveTimer = null;
function markSaved() {
  const el = document.getElementById("saveStatus");
  if (!el) return;
  el.textContent = "\u2713 Saved";
  el.style.color = "var(--success)";
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    showBackupAge();
  }, 1500);
}
// Persistent counterpart to markSaved(): when a localStorage write fails
// (quota/private mode), leave a visible "NOT saved" marker instead of letting
// the failure scroll away with the toast. Stays until the next successful save.
function markSaveFailed() {
  const el = document.getElementById("saveStatus");
  if (!el) return;
  clearTimeout(_saveTimer);
  el.textContent = "\u2715 NOT saved \u2014 export a backup";
  el.style.color = "var(--danger, #ef4444)";
}
function timeAgo(iso) {
  if (!iso) return null;
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
function showBackupAge() {
  const el = document.getElementById("saveStatus");
  if (!el) return;
  let t = null;
  try {
    t = localStorage.getItem("casa_last_backup_v1");
  } catch (e) {}
  el.style.color = "var(--muted)";
  el.textContent = t ? "Backed up " + timeAgo(t) : "Not backed up yet";
}

let TXNS = loadTxns();

// ---------- money helpers ----------
const money = (v, d = 2) =>
  v == null || isNaN(v)
    ? "\u2014"
    : v.toLocaleString("en-US", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });
// Percentage formatter. Default 1 decimal; pass d for other precisions (e.g. pct(x,0), pct(x,2)).
const pct = (v, d = 1) =>
  v == null || isNaN(v) ? "\u2014" : (v * 100).toFixed(d) + "%";
const cls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
// Compact percentage: up to 3 decimals, trailing zeros trimmed (e.g. 0.99%,
// 2.75%). Used for fee-rate displays. Single source for what was copied inline
// in several render/fee tooltips.
const pctOf = (r) => (r * 100).toFixed(3).replace(/\.?0+$/, "") + "%";
// Is this ticker an OPCVM fund? Single source of truth for the sector check
// that was scattered as `M[tk].cat === "OPCVM"` across the app.
function isOpcvm(tk) {
  return !!(M[tk] && M[tk].cat === "OPCVM");
}
// Is this transaction/order an OPCVM trade? Honors an explicit `opcvm` flag,
// else falls back to the ticker's master category. Single source for the
// compound check that was duplicated in fees/import/backup/pending code.
function isOpcvmTxn(t) {
  return !!(t && (t.opcvm === true || isOpcvm(t.ticker)));
}
function divRate(year) {
  // v2: delegate to core (same forward/backward-fill logic).
  return __core.tax.divRate(year, DIVTAX, FP.tpcvm);
}

// Whole days from today (midnight) to date `d`; negative = past.
// Generic date util (moved from 03-signals.js, which is pure scoring).
function daysUntil(d) {
  return Math.round((new Date(d) - TODAY) / 86400000);
}
