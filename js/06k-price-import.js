// ============================================================
// PRICE IMPORT  (js/06k-price-import.js)
// ------------------------------------------------------------
// Extracted verbatim from js/06b-import.js (god-file decomposition).
// Two cohesive price-into-M flows kept together because they share
// TV_TICKER_ALIAS:
//   1. TradingView paste parser (#applyTV): cleanNum, TICKERS, parseTV.
//   2. 'Fetch latest' (#fetchPrices / #fetchPricesGlobal): fetchAndApply()
//      over public/prices.json via __core.masterSchema.applyTvRec, plus the
//      boot-time freshness fetch + reflectStamp.
// All symbols are referenced nowhere else. Outbound deps (M, __core,
// safeSetItem, render, escapeHtml, toast, snapshotSignalsNow, takeSnapshot)
// load earlier or run at event time. Has load-time side effects (the boot
// prices.json freshness fetch) preserved by staying in the single
// concatenated IIFE; placed after 06j-positions-edit.js in concat order.
// ============================================================

// ---------- price refresh (paste TradingView) ----------
function cleanNum(s) {
  if (s == null) return null;
  if (typeof s === "number") return s;
  let x = String(s)
    .replace(/\u00a0/g, "")
    .replace(/\u202f/g, "")
    .replace(/\s/g, "")
    .replace(/MAD/g, "")
    .replace(/\u2212/g, "-")
    .replace(/%/g, "");
  // thousands: "1,260" -> 1260 ; but decimals use "." in this feed
  if (/,\d{3}(\D|$)/.test(x)) x = x.replace(/,/g, "");
  else x = x.replace(/,/g, ".");
  const v = parseFloat(x);
  return isNaN(v) ? null : v;
}
const TICKERS = Object.keys(M).sort((a, b) => b.length - a.length); // longest first for prefix match
// TradingView ticker aliases: maps TV ticker \u2192 master ticker when they differ.
// Add entries here when a stock's TV symbol doesn't match your master key.
const TV_TICKER_ALIAS = { SOT: "SSOT" };
function parseTV(raw) {
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));
  const isData = (s) => s.indexOf("\t") >= 0 && /MAD/.test(s);
  const RATINGS = [
    "Buy",
    "Sell",
    "Neutral",
    "No rating",
    "Strong buy",
    "Strong sell",
  ];
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = (lines[i] || "").trim();
    // Only EXACT known tickers (or aliased) anchor a row \u2014 prevents header noise from matching.
    const _resolved = TV_TICKER_ALIAS[line] || line;
    const known = M[_resolved] != null;
    if (line && known) {
      const tk = _resolved;
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const comp = j < lines.length ? lines[j].trim() : null;
      // main data row within a few lines
      let k = j,
        main = -1;
      while (k < Math.min(j + 6, lines.length)) {
        if (isData(lines[k])) {
          main = k;
          break;
        }
        k++;
      }
      if (main >= 0) {
        const c = lines[main].split("\t").map((x) => x.trim());
        const g = (idx) => (idx < c.length ? cleanNum(c[idx]) : null);
        // divy, pe, pb, peg, dps all now come from the 2nd metrics line
        // New layout: main line = [Price, Chg%, Vol, 52wLow, 52wHigh, MktCap, Sector]
        const _sector =
          c.length >= 7 && c[6] && !/^[\d.,\s%+-]+$/.test(c[6])
            ? c[6].trim()
            : null;
        const rec = {
          ticker: tk,
          company: comp,
          price: g(0),
          low: g(3),
          high: g(4),
          category: _sector || null,
        };
        // second metrics line (category + EV/EBITDA, NetDebt, ROE%)
        let s = main + 1;
        while (s < Math.min(main + 5, lines.length)) {
          const t = lines[s].trim();
          if (
            lines[s].indexOf("\t") >= 0 &&
            !/^\s*[\d.,]+.*MAD/.test(lines[s].split("\t")[0]) &&
            t &&
            RATINGS.indexOf(t) < 0
          ) {
            const sc = lines[s].split("\t").map((x) => x.trim());
            // New 2nd metrics line layout (14 columns):
            // [0]=P/E [1]=P/B [2]=PEG [3]=EPS Growth% [4]=Net Income [5]=Revenue
            // [6]=Div Yield% [7]=DPS [8]=EV/EBITDA [9]=Debt/EBITDA [10]=ROE% [11]=EPS [12]=BVPS [13]=FCF/Share
            const _pe2 = cleanNum(sc[0]),
              _pb2 = cleanNum(sc[1]),
              _peg2 = cleanNum(sc[2]);
            const _epsGr = cleanNum(sc[3]); // EPS growth % (e.g. +75.70 from "+75.70%")
            const _rev = cleanNum(sc[5]); // Revenue (TTM)
            const _divy2 = cleanNum(sc[6]); // Div yield % (e.g. 1.31 from "1.31%")
            const _dps2 = cleanNum(sc[7]); // DPS
            const _ev2 = cleanNum(sc[8]),
              _nd2 = cleanNum(sc[9]);
            const _roe2 = cleanNum(sc[10]); // ROE %
            const _eps2 = cleanNum(sc[11]),
              _bvps2 = cleanNum(sc[12]);
            const _fcf2 = cleanNum(sc[13]); // Free Cash Flow Per Share
            if (_pe2 != null) rec.pe = _pe2;
            if (_pb2 != null) rec.pb = _pb2;
            if (_peg2 != null) rec.peg = _peg2;
            if (_epsGr != null) rec.epsGrowth = _epsGr / 100; // store as decimal
            if (_rev != null) rec.revenue = _rev;
            if (_divy2 != null) rec.divy = _divy2 / 100; // store as decimal
            if (_dps2 != null) rec.dps = _dps2;
            if (_ev2 != null) rec.ev = _ev2;
            if (_nd2 != null) rec.netdebt = _nd2;
            if (_roe2 != null) rec.roe = _roe2 / 100;
            if (_eps2 != null) rec.eps = _eps2;
            if (_bvps2 != null) rec.bvps = _bvps2;
            if (_fcf2 != null) rec.fcf = _fcf2;
            break;
          }
          s++;
        }
        out.push(rec);
        i = main + 1;
        continue;
      }
    }
    i++;
  }
  return out;
}

document.getElementById("applyTV").onclick = () => {
  const raw = document.getElementById("tvPaste").value;
  if (!raw.trim()) {
    document.getElementById("tvResult").textContent = "Paste some rows first.";
    return;
  }
  const rows = parseTV(raw);
  let updated = 0,
    unmatched = [];
  for (const r of rows) {
    const tk = r.ticker;
    if (!tk || !M[tk]) {
      if (tk) unmatched.push(tk);
      continue;
    }
    // Schema-driven copy: the metric list lives in __core.masterSchema.TV_METRICS,
    // so a metric added to the parser is applied automatically (and the coverage
    // test enforces it). Same guard (skip null/NaN) and same cat || logic.
    __core.masterSchema.applyTvRec(M, tk, r);
    updated++;
  }
  safeSetItem("casa_master_v1", JSON.stringify(M));
  document.getElementById("tvResult").innerHTML =
    "\u2705 Updated <b>" +
    updated +
    "</b> tickers." +
    (unmatched.length
      ? ' <span style="color:var(--muted)">Unmatched: ' +
        [...new Set(unmatched)].slice(0, 8).join(", ") +
        (unmatched.length > 8 ? "\u2026" : "") +
        "</span>"
      : "");
  render();
  // Fresh prices loaded -> record BOTH the signal-outcome snapshot and the
  // portfolio-value snapshot off the just-applied prices (latest-of-day wins).
  // Guarded so neither can break the import.
  snapshotSignalsNow();
  if (typeof takeSnapshot === "function") {
    try {
      takeSnapshot(true);
    } catch (_e) {}
  }
};
document.getElementById("clearTV").onclick = () => {
  document.getElementById("tvPaste").value = "";
  document.getElementById("tvResult").textContent = "";
};

// ---------- "Fetch latest": load CI-produced public/prices.json ----------
// Prices + fundamentals are refreshed daily by .github/workflows/fetch-prices.yml
// (which runs scripts/fetch-prices.mjs against TradingView's scanner) and
// committed as public/prices.json. This button loads that file and imports it
// through the SAME applyTvRec pipeline as a manual paste - so category is
// preserved (applyTvRec omits it here since the file carries no category), and
// null/NaN fields are skipped. If the file is missing/unreadable (e.g. CI hasn't
// run yet, or offline), it does nothing destructive: the manual paste box stays
// exactly as-is and a hint points the user there.
(function () {
  const dataBtn = document.getElementById("fetchPrices"); // Data-tab button
  const stamp = document.getElementById("fetchStamp"); // Data-tab freshness line
  const res = document.getElementById("tvResult"); // Data-tab result span
  const gBtn = document.getElementById("fetchPricesGlobal"); // top-bar button (all pages)
  const gLbl = document.getElementById("fetchPricesGlobalLabel");

  const REFRESH_URL =
    "https://github.com/mehdizle/portfolio_tracker_v2/actions/workflows/fetch-prices.yml";

  // Human "how old" from an ISO date. Returns { text, staleDays } where
  // staleDays counts whole days since the file was fetched.
  const freshness = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return { text: "", staleDays: Infinity };
    const ms = Date.now() - d.getTime();
    const days = Math.floor(ms / 86400000);
    const hrs = Math.floor(ms / 3600000);
    let rel;
    if (hrs < 1) rel = "just now";
    else if (hrs < 24) rel = hrs + "h ago";
    else if (days === 1) rel = "yesterday";
    else rel = days + " days ago";
    return { text: rel, staleDays: days, when: d };
  };

  // Update the Data-tab freshness line + the global button label/tooltip from a
  // fetched doc (or lack thereof). Never imports - purely informational.
  const reflectStamp = (doc) => {
    const f = doc && doc._fetched ? freshness(doc._fetched) : null;
    if (stamp) {
      stamp.innerHTML = f
        ? "\uD83C\uDF10 Auto-fetched prices \u00B7 <b>" +
          escapeHtml(f.text) +
          "</b> (" +
          escapeHtml(f.when.toLocaleString()) +
          ")" +
          (doc._count ? " \u00B7 " + doc._count + " tickers" : "") +
          (f.staleDays >= 1
            ? ' \u00B7 <span style="color:var(--muted)">daily refresh runs 18:00 UTC \u00B7 <a href="' +
              REFRESH_URL +
              '" target="_blank" rel="noopener" style="color:var(--primary2)">refresh now</a></span>'
            : "")
        : "";
    }
    if (gBtn) {
      // Color the global button by freshness: fresh = normal, stale (>1 day
      // old, e.g. a missed run or before today's 18:00) = a subtle warn tint.
      gBtn.dataset.tip = f
        ? "Auto-fetched prices from " +
          f.when.toLocaleString() +
          " (" +
          f.text +
          "). Click to apply. Daily refresh runs 18:00 UTC."
        : "Load the latest auto-fetched prices (updated daily by CI).";
      gBtn.classList.toggle("stale", !!(f && f.staleDays >= 1));
    }
  };

  // Load prices.json once on boot to populate the freshness indicators.
  fetch("prices.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((doc) => reflectStamp(doc))
    .catch(() => reflectStamp(null));

  // Shared fetch+apply. `report` is a small callback for status text so both the
  // Data-tab button (rich #tvResult) and the global button (its label) can show
  // progress/outcome. Returns true on a successful apply.
  async function fetchAndApply(report) {
    report("busy", "\u2026 loading latest prices");
    let doc;
    try {
      const r = await fetch("prices.json", { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      doc = await r.json();
    } catch (e) {
      report("err", e && e.message ? e.message : "unavailable");
      return false;
    }
    const records = (doc && Array.isArray(doc.records) && doc.records) || [];
    if (!records.length) {
      report("empty");
      return false;
    }
    let updated = 0;
    const unmatched = [];
    for (const rec of records) {
      const tk = TV_TICKER_ALIAS[rec.ticker] || rec.ticker;
      if (!tk || !M[tk]) {
        if (rec.ticker) unmatched.push(rec.ticker);
        continue;
      }
      __core.masterSchema.applyTvRec(M, tk, rec); // category omitted -> manual cats preserved
      updated++;
    }
    safeSetItem("casa_master_v1", JSON.stringify(M));
    reflectStamp(doc);
    render();
    // One action captures everything: prices applied above, then the signal-
    // outcome history AND the portfolio-value snapshot are recorded off the
    // freshly-applied prices. takeSnapshot(true) = auto capture, one-per-day
    // (latest wins). Both guarded so they can never break the apply.
    if (typeof snapshotSignalsNow === "function") snapshotSignalsNow();
    if (typeof takeSnapshot === "function") {
      try {
        takeSnapshot(true);
      } catch (_e) {}
    }
    report("ok", { updated, unmatched, doc });
    return true;
  }

  // Data-tab button: rich messages in #tvResult.
  if (dataBtn) {
    dataBtn.onclick = () =>
      fetchAndApply((kind, info) => {
        if (!res) return;
        if (kind === "busy") {
          res.style.color = "var(--muted)";
          res.textContent = info;
        } else if (kind === "err") {
          res.style.color = "var(--warn)";
          res.innerHTML =
            "\u26A0 Couldn't fetch auto prices (" +
            escapeHtml(info) +
            "). Paste your TradingView rows above and click <b>Apply pasted</b>.";
        } else if (kind === "empty") {
          res.style.color = "var(--warn)";
          res.textContent =
            "\u26A0 Auto prices file is empty. Use manual paste instead.";
        } else if (kind === "ok") {
          res.style.color = "var(--success)";
          res.innerHTML =
            "\u2705 Fetched &amp; applied <b>" +
            info.updated +
            "</b> tickers." +
            (info.unmatched.length
              ? ' <span style="color:var(--muted)">Unmatched: ' +
                [...new Set(info.unmatched)].slice(0, 8).join(", ") +
                (info.unmatched.length > 8 ? "\u2026" : "") +
                "</span>"
              : "");
        }
      });
  }

  // Global top-bar button (all pages): brief feedback in its own label, then
  // a toast. Reuses the exact same fetch+apply pipeline.
  if (gBtn) {
    gBtn.onclick = () =>
      fetchAndApply((kind, info) => {
        if (gLbl) {
          if (kind === "busy") gLbl.textContent = "Fetching\u2026";
          else if (kind === "ok") gLbl.textContent = "Fetch latest";
          else gLbl.textContent = "Fetch latest";
        }
        if (kind === "ok") {
          if (typeof toast === "function")
            toast(
              "Applied latest prices to " + info.updated + " tickers.",
              "ok",
            );
        } else if (kind === "err") {
          if (typeof toast === "function")
            toast(
              "Couldn't fetch prices (" +
                info +
                "). Use Data \u2192 paste, or run the refresh in GitHub Actions.",
              "warn",
            );
        } else if (kind === "empty") {
          if (typeof toast === "function")
            toast(
              "No auto prices available yet. Use Data \u2192 paste.",
              "warn",
            );
        }
      });
  }
})();
