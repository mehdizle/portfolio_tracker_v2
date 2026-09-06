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
// ---------- in-app modal helpers ----------
function _qwTodayISO() {
  const d = new Date();
  const o = d.getTimezoneOffset();
  const l = new Date(d.getTime() - o * 60000);
  return l.toISOString().slice(0, 10);
}
// Validate a YYYY-MM-DD string is a REAL calendar date (rejects 2024-13-40,
// 2024-02-30, empty, or non-string). Used to guard transaction/import input.
function validTxnDate(s) {
  if (typeof s !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = +m[1],
    mo = +m[2],
    da = +m[3];
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return false;
  const dt = new Date(y, mo - 1, da);
  // round-trip check: JS Date normalizes overflow (Feb 30 -> Mar 2), so a valid
  // date must read back the same Y/M/D.
  return (
    dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === da
  );
}
function appConfirm(message, opts) {
  opts = opts || {};
  return new Promise((res) => {
    const back = document.createElement("div");
    back.className = "qwmodal-back";
    back.innerHTML =
      '<div class="qwmodal" role="dialog" aria-modal="true">' +
      "<h3>" +
      escapeHtml(opts.title || "Please confirm") +
      "</h3>" +
      '<p class="qw-msg"></p>' +
      '<div class="qw-btns">' +
      '<button class="qw-b qw-cancel">' +
      escapeHtml(opts.cancelText || "Cancel") +
      "</button>" +
      '<button class="qw-b qw-ok' +
      (opts.danger ? " qw-danger" : "") +
      '">' +
      escapeHtml(opts.okText || "Confirm") +
      "</button>" +
      "</div></div>";
    back.querySelector(".qw-msg").textContent = message;
    const done = (v) => {
      back.remove();
      document.removeEventListener("keydown", onKey);
      res(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") done(false);
      else if (e.key === "Enter") done(true);
    };
    back.querySelector(".qw-cancel").onclick = () => done(false);
    back.querySelector(".qw-ok").onclick = () => done(true);
    back.addEventListener("mousedown", (e) => {
      if (e.target === back) done(false);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);
    back.querySelector(".qw-ok").focus();
  });
}
function appPrompt(label, value, opts) {
  opts = opts || {};
  return new Promise((res) => {
    const back = document.createElement("div");
    back.className = "qwmodal-back";
    const showToday = !!opts.today;
    back.innerHTML =
      '<div class="qwmodal" role="dialog" aria-modal="true">' +
      "<h3>" +
      escapeHtml(opts.title || "Enter a value") +
      "</h3>" +
      '<label class="qw-field"><span class="qw-lbl"></span>' +
      '<span class="qw-inrow"><input type="' +
      (opts.inputType || "text") +
      '">' +
      (showToday
        ? '<button type="button" class="qw-today">Today</button>'
        : "") +
      "</span></label>" +
      '<div class="qw-btns">' +
      '<button class="qw-b qw-cancel">Cancel</button>' +
      '<button class="qw-b qw-ok">OK</button>' +
      "</div></div>";
    back.querySelector(".qw-lbl").textContent = label;
    const inp = back.querySelector("input");
    inp.value = value == null ? "" : value;
    const done = (v) => {
      back.remove();
      document.removeEventListener("keydown", onKey);
      res(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") done(null);
      else if (e.key === "Enter") done(inp.value);
    };
    if (showToday) {
      back.querySelector(".qw-today").onclick = () => {
        inp.value = _qwTodayISO();
        inp.focus();
      };
    }
    back.querySelector(".qw-cancel").onclick = () => done(null);
    back.querySelector(".qw-ok").onclick = () => done(inp.value);
    back.addEventListener("mousedown", (e) => {
      if (e.target === back) done(null);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);
    inp.focus();
    inp.select();
  });
}
// combined fill dialog for validating a pending order (date+Today, price, qty, total)
function appFillDialog(o, isDiv, moneyFn) {
  return new Promise((res) => {
    const back = document.createElement("div");
    back.className = "qwmodal-back";
    const qtyRow = isDiv
      ? ""
      : '<label class="qw-field">Quantity executed (order is ' +
        moneyFn(o.qty, o.qty % 1 ? 3 : 0) +
        " \u2014 less = partial fill)" +
        '<span class="qw-inrow"><input id="qwf-qty" type="text"></span></label>';
    const totRow =
      !isDiv && o.total != null
        ? '<label class="qw-field">Executed Total TTC (blank = qty\u00D7price)' +
          '<span class="qw-inrow"><input id="qwf-tot" type="text"></span></label>'
        : "";
    back.innerHTML =
      '<div class="qwmodal" role="dialog" aria-modal="true">' +
      "<h3>" +
      (isDiv ? "Record dividend" : "Validate order") +
      " \u2014 " +
      escapeHtml(o.ticker || "") +
      "</h3>" +
      '<label class="qw-field">' +
      (isDiv ? "Date received (YYYY-MM-DD)" : "Execution date (YYYY-MM-DD)") +
      '<span class="qw-inrow"><input id="qwf-date" type="text"><button type="button" class="qw-today">Today</button></span></label>' +
      '<label class="qw-field">' +
      (isDiv ? "Dividend amount per share" : "Executed unit price") +
      '<span class="qw-inrow"><input id="qwf-price" type="text"></span></label>' +
      qtyRow +
      totRow +
      '<div class="qw-btns"><button class="qw-b qw-cancel">Cancel</button><button class="qw-b qw-ok">Confirm</button></div></div>';
    const g = (id) => back.querySelector("#" + id);
    g("qwf-date").value = o.date || "";
    g("qwf-price").value = o.price != null ? o.price : "";
    if (!isDiv) g("qwf-qty").value = o.qty;
    if (totRow) g("qwf-tot").value = +o.total.toFixed(2);
    back.querySelector(".qw-today").onclick = () => {
      g("qwf-date").value = _qwTodayISO();
      g("qwf-date").focus();
    };
    const done = (v) => {
      back.remove();
      document.removeEventListener("keydown", onKey);
      res(v);
    };
    const submit = () =>
      done({
        date: g("qwf-date").value,
        price: g("qwf-price").value,
        qty: isDiv ? null : g("qwf-qty").value,
        total: totRow ? g("qwf-tot").value : null,
      });
    const onKey = (e) => {
      if (e.key === "Escape") done(null);
      else if (e.key === "Enter" && e.target.tagName !== "BUTTON") submit();
    };
    back.querySelector(".qw-cancel").onclick = () => done(null);
    back.querySelector(".qw-ok").onclick = submit;
    back.addEventListener("mousedown", (e) => {
      if (e.target === back) done(null);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);
    g("qwf-date").focus();
    g("qwf-date").select();
  });
}
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

// ---------- Ticker badge (monogram fallback + optional real logo) ----------
// Renders a small inline badge for a ticker:
//   - a deterministic colored monogram (always works, offline, private), PLUS
//   - an <img> that tries logos/<TICKER>.svg then logos/<TICKER>.png; if one
//     loads it reveals itself and hides the monogram; if all 404 the monogram
//     stays. No inline handlers - delegated load/error listeners (in 09-boot.js)
//     wire the swap + fallback, keeping the "no inline onclick/onerror" model.
// Drop real logos into public/logos/ (SVG preferred, PNG accepted), either flat
// (logos/<TICKER>.svg) or under an exchange subfolder (logos/CSEMA/<TICKER>.svg).
// Case-insensitive stored key; they override the monogram automatically.
// Exchange subfolders under logos/ to search for a ticker logo, in order.
// "" = the flat logos/ root (kept last so a top-level drop-in still works).
// Add more exchanges here (e.g. "NYSE", "LSE") if logos are sorted by market.
const LOGO_DIRS = ["CSEMA", ""];
function _tickerHue(tk) {
  // Stable hash -> hue (0..359). Same ticker always gets the same color.
  let h = 0;
  const s = String(tk || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
function _tickerInitials(tk) {
  const s = String(tk || "").replace(/[^A-Za-z0-9]/g, "");
  if (!s) return "?";
  // Up to 3 chars for readability (e.g. "NKL", "ATW", "SBM").
  return s.slice(0, 3).toUpperCase();
}
// Filesystem-safe logo key for a ticker (spaces/punct -> underscore, upper).
function _tickerLogoKey(tk) {
  return String(tk || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
// size = badge diameter in px (default 20). Returns an inline-block HTML string.
function tickerBadge(tk, size) {
  const px = size || 20;
  const key = _tickerLogoKey(tk);
  if (!key) return "";
  const hue = _tickerHue(key);
  const initials = escapeHtml(_tickerInitials(tk));
  const fontPx = Math.max(
    7,
    Math.round(px * (initials.length >= 3 ? 0.34 : 0.42)),
  );
  // logos/ is relative to the page, so it resolves under the GitHub Pages base
  // (/portfolio_tracker_v2/logos/...) and locally, with no build-time base var.
  // Candidate URLs, tried in order: each exchange subfolder (LOGO_DIRS) then the
  // flat logos/ root, SVG before PNG. The first is the initial src; the rest go
  // in data-logo-fallbacks and are applied on error by 09-boot.js. If every
  // candidate 404s, the monogram stays. This lets logos be organized by exchange
  // (logos/CSEMA/ATW.svg) or dropped flat (logos/ATW.svg) - both resolve.
  const candidates = [];
  for (const dir of LOGO_DIRS) {
    const base = "logos/" + (dir ? dir + "/" : "") + key;
    candidates.push(base + ".svg", base + ".png");
  }
  const src = candidates[0];
  const fallbacks = candidates.slice(1).join(",");
  return (
    '<span class="tkr-badge" style="width:' +
    px +
    "px;height:" +
    px +
    'px;position:relative;display:inline-flex;flex:none;vertical-align:middle;margin-right:6px;border-radius:6px;overflow:hidden;align-items:center;justify-content:center">' +
    // monogram (visible fallback)
    '<span class="tkr-mono" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:' +
    fontPx +
    "px;color:#fff;background:hsl(" +
    hue +
    ',62%,42%);letter-spacing:.02em">' +
    initials +
    "</span>" +
    // real logo, layered ON TOP of the monogram with an opaque white background
    // so it covers it when present. It is VISIBLE by default (not display:none)
    // so the browser always fetches it - a hidden/lazy image is often never
    // loaded, which previously left the monogram stuck. On error the delegated
    // handler (09-boot.js) tries the next candidate in data-logo-fallbacks and,
    // once exhausted, hides the img so the monogram shows through. No
    // loading="lazy" for the same reason.
    '<img class="tkr-logo" alt="" src="' +
    escapeHtml(src) +
    '" data-logo-fallbacks="' +
    escapeHtml(fallbacks) +
    '" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#fff;border-radius:6px;display:block">' +
    "</span>"
  );
}

// ---------- Trusted tooltip registry ----------
// Rich (HTML) tooltips are our OWN generated markup, but embedding that HTML in
// a data-tip attribute means it must be re-parsed from the DOM on hover - a
// tainted "DOM text -> HTML" flow. Instead we keep the trusted HTML in this
// in-memory store and put only an opaque token ("#t<n>") in the attribute. The
// tooltip engine (08-salary.js) looks the token up here and builds DOM from the
// trusted string, so no untrusted attribute value is ever parsed as HTML.
const __TIP = new Map(); // token -> trusted tooltip HTML
const __TIP_BY_HTML = new Map(); // html -> token (content-addressed dedupe)
let __TIP_SEQ = 0;
// Register trusted tooltip HTML, return the token to place in data-tip="...".
// Content-addressed: identical HTML reuses the same token, so the store only
// grows by DISTINCT tooltip content (bounded and small) and never needs a reset
// that could orphan tokens still referenced by another tab's live DOM.
// Plain text should NOT use this - pass it directly so it renders as text.
function tipRef(html) {
  if (html == null || html === "") return "";
  const s = String(html);
  let token = __TIP_BY_HTML.get(s);
  if (token == null) {
    token = "#t" + ++__TIP_SEQ;
    __TIP.set(token, s);
    __TIP_BY_HTML.set(s, token);
  }
  return token;
}
if (typeof window !== "undefined") {
  window.__TIP = __TIP;
  window.tipRef = tipRef;
}

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
  div_tax_by_year: { 2025: 0.12, 2026: 0.1125, 2027: 0.1 },
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
// Granular, editable & persisted fee parameters (defaults mirror Excel BS:BX)
const FP_DEFAULT = {
  c_marche: 0.002,
  c_interm: 0.006,
  c_regl: 0.001,
  vat: 0.1,
  courier: 2.5,
  tpcvm: 0.15,
};
let FP = (() => {
  try {
    const s = localStorage.getItem("casa_fees_v1");
    if (s) return { ...FP_DEFAULT, ...JSON.parse(s) };
  } catch (e) {
    console.warn(
      "Could not load saved fees (casa_fees_v1); using defaults.",
      e,
    );
  }
  return { ...FP_DEFAULT };
})();
function saveFees() {
  if (safeSetItem("casa_fees_v1", JSON.stringify(FP))) markSaved();
}
// \u2500\u2500 GLOBAL VAT (single source of truth) \u2500\u2500
// VAT is a national 10% rate applied to broker commissions everywhere. Stored once
// on FP.vat (editable under Data \u25B8 Global tax). All fee helpers read vatRate() so
// per-broker vat fields are NOT authoritative \u2014 change it here, it flows everywhere.
// v2: fee/tax leaf helpers delegate to the tested core (src/core/fees.js,
// tax.js) so the whole app shares ONE rounding-correct implementation. They
// keep their v1 names/signatures, reading the live FP/FP_PEA/BROKERS/DIVTAX
// globals and forwarding them to the pure core functions.
function vatRate() {
  return __core.fees.vatRate(FP);
}
function feeRate() {
  return __core.fees.feeRate(FP, vatRate());
}
function fixedFee() {
  return __core.fees.fixedFee(FP, vatRate());
}
// ---------- PEA account (ECO) fee model \u2014 independent, editable & persisted ----------
// PEA stock trades use a single 'courtage' commission (min floor), a r\u00E8glement/livraison
// commission, and the Bourse de Casa commission ("imp\u00F4t de bourse"); TVA applies to ALL three.
//   fees = [ max(gross*courtage, min) + gross*regl + gross*bourse ] * (1+tva)
// OPCVM (PEA): entry/exit free, flat order fee (MAD HT) + TVA per transaction.
// Dividends (PEA): commission de distribution (% HT) + TVA; no TPCVM.
const FP_PEA_DEFAULT = {
  courtage: 0.01,
  courtageMin: 10,
  regl: 0.002,
  bourse: 0.001,
  vat: 0.1,
  opcvmOrder: 10,
  divComm: 0.02,
};
let FP_PEA = (() => {
  try {
    const s = localStorage.getItem("casa_fees_pea_v1");
    if (s) return { ...FP_PEA_DEFAULT, ...JSON.parse(s) };
  } catch (e) {
    console.warn(
      "Could not load saved PEA fees (casa_fees_pea_v1); using defaults.",
      e,
    );
  }
  return { ...FP_PEA_DEFAULT };
})();
function saveFeesPea() {
  if (safeSetItem("casa_fees_pea_v1", JSON.stringify(FP_PEA))) markSaved();
}

// \u2550\u2550\u2550\u2550\u2550\u2550\u2550 BROKER-BASED FEE SYSTEM \u2550\u2550\u2550\u2550\u2550\u2550\u2550
// Each broker has: {name, feeType:'regular'|'pea', fees:{...}}
// feeType determines WHICH formula to apply (rate-based vs courtage-based).
// TPCVM is global (government tax), not per-broker.
const BROKER_DEFAULTS = {
  saham: {
    name: "Saham",
    feeType: "regular",
    fees: {
      c_marche: 0.002,
      c_interm: 0.006,
      c_regl: 0.001,
      vat: 0.1,
      courier: 2.5,
    },
  },
  attijari: {
    name: "Attijari",
    feeType: "pea",
    fees: {
      courtage: 0.01,
      courtageMin: 10,
      regl: 0.002,
      bourse: 0.001,
      vat: 0.1,
      opcvmOrder: 10,
      divComm: 0.02,
    },
  },
};
let BROKERS =
  (() => {
    try {
      const s = localStorage.getItem("casa_brokers_v1");
      if (s) return JSON.parse(s);
    } catch (e) {
      console.warn(
        "Could not load saved brokers (casa_brokers_v1); using defaults.",
        e,
      );
    }
    return null;
  })() || JSON.parse(JSON.stringify(BROKER_DEFAULTS));
function saveBrokers() {
  if (safeSetItem("casa_brokers_v1", JSON.stringify(BROKERS))) markSaved();
}

// Resolve broker for a transaction. New/edited transactions carry an explicit
// `broker`. For legacy/imported rows with no broker field, fall back by asset type
// to match the real setup (OPCVM funds are held at Attijari; stocks at Saham).
// Broker and PEA-status are independent \u2014 we do NOT infer broker from the pea flag.
function txnBroker(t) {
  if (t.broker) return t.broker;
  const _isOpcvm =
    t.opcvm === true || !!(M[t.ticker] && M[t.ticker].cat === "OPCVM");
  return _isOpcvm ? "attijari" : "saham";
}

// \u2500\u2500 SINGLE SOURCE OF TRUTH for OPCVM (fund) fees \u2500\u2500
// An OPCVM order fee = the fund's own buy/sell % (imported from the Data tab)
// PLUS, for brokers that charge a flat order fee (Attijari: opcvmOrder + VAT,
// e.g. 10 \u00D7 1.10 = 11 MAD), that surcharge on top. Saham has no surcharge.
// Dividends carry no fund fee.
//   gross          : NAV amount (price \u00D7 qty)
//   action         : BUY | SELL | DIV
//   broker         : resolved broker object (BROKERS[...])
//   meta           : master record M[ticker] (holds buyFee/sellFee)
//   includeFundPct : true  \u2192 apply the fund % (computed paths: Net-if-Sold, qty\u00D7price entry)
//                    false \u2192 fund % already baked into a manually-entered Total; add surcharge only
function opcvmFee(gross, action, broker, meta, includeFundPct) {
  // v2: delegate to core (broker arg unused there - surcharge is Attijari-based).
  return __core.fees.opcvmFee(
    gross,
    action,
    meta,
    includeFundPct,
    _brokersOrDefaults(),
    vatRate(),
  );
}
function opcvmSurcharge() {
  return __core.fees.opcvmSurcharge(_brokersOrDefaults(), vatRate());
}
// Live brokers if present, else the core defaults (matches v1 fallback).
function _brokersOrDefaults() {
  return typeof BROKERS !== "undefined" && BROKERS
    ? BROKERS
    : __core.defaults.BROKER_DEFAULTS;
}

// Populate broker <select> elements with current broker list
function populateBrokerSelects() {
  document.querySelectorAll("#tBroker,#pBroker").forEach((sel) => {
    const cur = sel.value;
    sel.innerHTML = Object.keys(BROKERS)
      .map(
        (id) =>
          '<option value="' +
          escapeHtml(id) +
          '">' +
          escapeHtml(BROKERS[id].name) +
          "</option>",
      )
      .join("");
    sel.value = cur && BROKERS[cur] ? cur : "attijari";
  });
}
// Broker and PEA-status are INDEPENDENT (you can hold a PEA at any broker).
// We no longer force broker=Attijari when PEA is ticked \u2014 the user chooses each
// freely. Defaults (Attijari + PEA) are set once for convenience via the selects'
// initial values; toggling PEA does not override the broker.
function wireBrokerAutoSelect() {
  /* intentionally no auto-mapping \u2014 broker is chosen independently of PEA */
}

// Compute fees for a broker by its feeType
// NOTE: all broker fee helpers use the GLOBAL vatRate() \u2014 per-broker vat is ignored.
function brokerFeeRate(bk) {
  return __core.fees.brokerFeeRate(bk, vatRate());
}
function brokerFixedFee(bk) {
  return __core.fees.brokerFixedFee(bk, vatRate());
}
function brokerStockFees(gross, bk) {
  return __core.fees.brokerStockFees(gross, bk, vatRate());
}

// Universal fee calculator: given gross, action, broker object -> fees (delegates to core).
function calcBrokerFees(gross, action, bk, isOpcvm) {
  return __core.fees.calcBrokerFees(gross, action, bk, isOpcvm, vatRate(), FP);
}
// Stock BUY/SELL fees for a PEA trade of value `gross` (MAD). Returns fees incl. VAT (global).
function peaStockFees(gross, fp) {
  return __core.fees.peaStockFees(gross, fp || FP_PEA, vatRate());
}
// PEA dividend commission (incl. VAT global) on gross dividend.
function peaDivFees(gross, fp) {
  return __core.fees.peaDivFees(gross, fp || FP_PEA, vatRate());
}
let DIVTAX = (() => {
  try {
    const s = localStorage.getItem("casa_divtax_v1");
    if (s) return JSON.parse(s);
  } catch (e) {
    console.warn(
      "Could not load saved dividend tax (casa_divtax_v1); using defaults.",
      e,
    );
  }
  return { ...SEED.div_tax_by_year };
})();
function saveDivTax() {
  if (safeSetItem("casa_divtax_v1", JSON.stringify(DIVTAX))) markSaved();
}
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
function divRate(year) {
  // v2: delegate to core (same forward/backward-fill logic).
  return __core.tax.divRate(year, DIVTAX, FP.tpcvm);
}
