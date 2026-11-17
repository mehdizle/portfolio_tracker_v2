// 06n-data-health.js - automatic onboarding of tickers you enter (e.g. a new
// IPO) from the daily price file, plus a per-holding data-completeness check.
// Shared scope; concatenated by scripts/concat.mjs.
//
// ONBOARDING (no clicks needed): any stock ticker in your transactions or
// pending orders is matched against public/prices.json (the daily CI fetch of
// the whole Casablanca market):
//   - no master record yet          -> created (TradingView company name,
//                                      uncategorized) + all metrics applied
//   - record without a market price -> all metrics applied
//     (or still on the trade price a form put there as a stand-in)
//   - complete record               -> FILL-ONLY: missing fields are filled,
//                                      nothing existing is overwritten
// It runs once per page load for every ticker, and again for any ticker you
// add during the session. Pure logic lives in src/core/master-schema.js
// (onboardTvRec / fillTvGaps / stockDataIssues).
//
// DATA CHECK: rendered under the "Missing market data" box (04-render.js
// renderMissingMaster), listing held stocks whose data is incomplete: price
// still the trade price, no category/cycle/style, no 52-wk range or
// fundamentals yet, absent from today's feed, or no logo file yet.
//
// State uses `var` with no initializer on purpose: render() can call into this
// file before its text is evaluated (load order), and a `let` would throw
// (TDZ) while a `var x = ...` would later reset the cache.
var _PRICES_DOC_P; // cached promise of prices.json (one fetch per page load)
var _PRICES_DOC; // the resolved doc, once loaded (null if unavailable)
var _ONBOARD_TRIED; // { ticker: true } once looked up against the doc
var _LOGO_OK; // { logoKey: true | false } once probed; absent = unknown

// Load prices.json once and share it (boot freshness stamp, onboarding, data
// check). force=true refetches (used by the explicit "Fetch latest" path).
function loadPricesDoc(force) {
  if (force || !_PRICES_DOC_P) {
    _PRICES_DOC_P = fetch("prices.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => {
        _PRICES_DOC = d && Array.isArray(d.records) ? d : null;
        return _PRICES_DOC;
      });
  }
  return _PRICES_DOC_P;
}
// Record the doc a manual "Fetch latest" just applied, so the data check uses it.
function setPricesDoc(doc) {
  _PRICES_DOC = doc && Array.isArray(doc.records) ? doc : null;
  _PRICES_DOC_P = Promise.resolve(_PRICES_DOC);
}

// { ticker: "stock" | "fund" } for every ticker in your transactions + pending
// orders. A ticker with any OPCVM entry counts as a fund (funds get their
// record + fees from the OPCVM import path, never from TradingView).
function _userTickers() {
  const out = {};
  const add = (t) => {
    const tk = t && t.ticker ? String(t.ticker).trim() : "";
    if (!tk) return;
    if (isOpcvmTxn(t)) out[tk] = "fund";
    else if (!out[tk]) out[tk] = "stock";
  };
  try {
    (TXNS || []).forEach(add);
  } catch (_e) {}
  try {
    // PENDING is a `let` in 06d-pending.js - guarded in case of early calls.
    if (Array.isArray(PENDING)) PENDING.forEach(add);
  } catch (_e) {}
  return out;
}
// Helpers are function DECLARATIONS (hoisted) rather than top-level consts, so
// they're usable even if render() runs before this file's text is evaluated.
function _hasPrice(m) {
  return !!m && m.price != null && isFinite(m.price);
}
// TradingView symbol -> master ticker (SOT -> SSOT). TV_TICKER_ALIAS is a
// const in 06k-price-import.js; guarded against an early (pre-eval) call.
function _tvToMaster(sym) {
  try {
    return (TV_TICKER_ALIAS && TV_TICKER_ALIAS[sym]) || sym;
  } catch (_e) {
    return sym;
  }
}

// Apply the doc to the given tickers. Returns { created:[tk], filled:[tk] }.
function onboardFromDoc(doc, tickers) {
  const res = { created: [], filled: [] };
  const recs = (doc && Array.isArray(doc.records) && doc.records) || [];
  if (!recs.length) return res;
  const byTk = {};
  for (const r of recs) {
    const tk = _tvToMaster(r.ticker);
    if (tk) byTk[tk] = r;
  }
  const users = _userTickers();
  const list = tickers || Object.keys(users);
  const S = __core.masterSchema;
  for (const tk of list) {
    const rec = byTk[tk];
    if (!rec) continue;
    const m = M[tk];
    if (!m) {
      if (users[tk] === "fund") continue; // funds onboard via the OPCVM path
      // Only a real TradingView STOCK row (it carries company/sector) may
      // create a record. Fund NAV rows in prices.json are just {ticker, price};
      // creating from those would turn a fund whose transactions lack the
      // opcvm flag (e.g. a bare CSV import) into a "stock" with stock fees.
      if (!rec.company && !rec.tvSector) continue;
      if (S.onboardTvRec(M, tk, rec)) res.created.push(tk);
    } else if (!_hasPrice(m) || m._seedPrice) {
      S.onboardTvRec(M, tk, rec); // full apply: no real market price yet
      res.filled.push(tk);
    } else if (S.fillTvGaps(M, tk, rec) > 0) {
      res.filled.push(tk);
    }
  }
  return res;
}

// Called from renderMissingMaster on every render: looks up any ticker of
// yours not tried yet this session. Saves + re-renders only if data changed.
function autoOnboardMissing() {
  _ONBOARD_TRIED = _ONBOARD_TRIED || {};
  const need = Object.keys(_userTickers()).filter((tk) => !_ONBOARD_TRIED[tk]);
  if (!need.length) return;
  need.forEach((tk) => (_ONBOARD_TRIED[tk] = true));
  loadPricesDoc()
    .then((doc) => {
      if (!doc) return;
      const res = onboardFromDoc(doc, need);
      if (res.created.length || res.filled.length) {
        safeSetItem("casa_master_v1", JSON.stringify(M));
        if (res.created.length && typeof toast === "function")
          toast(
            "Added " +
              res.created
                .map((tk) =>
                  M[tk] && M[tk].name && M[tk].name !== tk
                    ? tk + " (" + M[tk].name + ")"
                    : tk,
                )
                .join(", ") +
              " from the daily price feed. Set its category in Data \u2192 Import Stock Categories \u2192 Set categories.",
            "ok",
          );
        if (typeof render === "function") render();
      } else {
        renderDataHealth(); // doc just arrived: the "not in feed" check can run
      }
    })
    .catch(() => {}); // best-effort: never let a render error escape the promise
}

// Probe for a logo file the same way the badge does (logoCandidate order).
// true = found, false = none of the candidates exist, network error = unknown.
function _probeLogo(key) {
  _LOGO_OK = _LOGO_OK || {};
  if (key in _LOGO_OK) return;
  _LOGO_OK[key] = undefined; // in flight
  const tryAt = (i) => {
    const url = logoCandidate(key, i);
    if (!url) {
      _LOGO_OK[key] = false;
      renderDataHealth();
      return;
    }
    fetch(url, { method: "HEAD", cache: "no-store" })
      .then((r) => {
        if (r.ok) {
          _LOGO_OK[key] = true;
          renderDataHealth();
        } else tryAt(i + 1);
      })
      .catch(() => {}); // offline / file:// -> stay unknown, never nag
  };
  tryAt(0);
}

// Human text for a holding's issue codes. The three category gaps are folded
// into one item ("not set: category, cycle, style") to keep the list short.
function _issueText(issues) {
  const TEXT = {
    seedPrice: "valued at your trade price (no market price in the feed yet)",
    noRange: "no 52-wk range yet",
    noFundamentals: "no fundamentals yet (P/E, P/B, EPS, yield\u2026)",
    notInFeed: "missing from today's price feed (delisted or renamed?)",
    noLogo: "no logo yet (monogram shown)",
  };
  const CAT = { noCategory: "category", noCycle: "cycle", noStyle: "style" };
  const parts = [];
  const cats = issues.filter((c) => CAT[c]).map((c) => CAT[c]);
  if (cats.length) parts.push("not set: " + cats.join(", "));
  issues.forEach((c) => {
    if (!CAT[c]) parts.push(TEXT[c] || c);
  });
  return parts.join(" \u00B7 ");
}

// [{ ticker, name, tvSector, issues:[code] }] for held stocks with gaps.
// Stocks with no record / no price are excluded: the warning box above
// already lists them.
function dataHealthRows() {
  const held = {};
  try {
    const { pos } = runFIFO();
    Object.values(pos).forEach((p) => {
      if (p && p.ticker && p.held > 1e-9)
        held[p.ticker] = (held[p.ticker] || 0) + p.held;
    });
  } catch (_e) {
    return [];
  }
  const feed = _PRICES_DOC
    ? new Set(_PRICES_DOC.records.map((r) => _tvToMaster(r.ticker)))
    : null;
  const rows = [];
  Object.keys(held)
    .sort()
    .forEach((tk) => {
      if (isOpcvm(tk)) return;
      const m = M[tk];
      const issues = __core.masterSchema.stockDataIssues(
        m,
        feed ? feed.has(tk) : undefined,
      );
      if (issues.includes("noRecord") || issues.includes("noPrice")) return;
      const key = _tickerLogoKey(tk);
      _probeLogo(key);
      if (_LOGO_OK && _LOGO_OK[key] === false) issues.push("noLogo");
      if (issues.length)
        rows.push({
          ticker: tk,
          name: (m && m.name) || "",
          tvSector: (m && m.tvSector) || "",
          issues,
        });
    });
  return rows;
}

// Render the data check into #dataHealthBox (created by renderMissingMaster).
function renderDataHealth() {
  const el = document.getElementById("dataHealthBox");
  if (!el) return;
  const rows = dataHealthRows();
  if (!rows.length) {
    el.innerHTML = "";
    return;
  }
  const items = rows
    .map((r) => {
      const nm =
        r.name && r.name !== r.ticker
          ? ' <span class="mini" style="color:var(--text2)">' +
            escapeHtml(r.name) +
            "</span>"
          : "";
      const hint =
        r.tvSector && r.issues.includes("noCategory")
          ? ' <span class="mini" style="color:var(--muted)">(TradingView sector: ' +
            escapeHtml(r.tvSector) +
            ")</span>"
          : "";
      const what = _issueText(r.issues);
      return (
        "<div><b>" +
        escapeHtml(r.ticker) +
        "</b>" +
        nm +
        ' <span class="mini" style="color:var(--text2)">\u2014 ' +
        escapeHtml(what) +
        "</span>" +
        hint +
        "</div>"
      );
    })
    .join("");
  el.innerHTML =
    '<div class="sec" style="border-color:var(--info)">' +
    "<h2>\uD83E\uDE7A Data check \u00B7 your holdings</h2>" +
    '<div class="mini" style="margin-bottom:6px">Some data for these holdings is incomplete. ' +
    "Prices and fundamentals fill in automatically from the daily feed as TradingView publishes them " +
    "(a new listing often has none for a while); logos refresh weekly. Set missing categories with the dropdowns in " +
    "<b>Data \u2192 Import Stock Categories \u2192 Set categories</b>.</div>" +
    '<div style="font-size:13px;line-height:1.8">' +
    items +
    "</div></div>";
}
