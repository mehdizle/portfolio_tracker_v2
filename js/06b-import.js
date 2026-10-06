// 06b-import.js - split from 06-features.js (TradingView/OPCVM/CSV import, fee panel, theme, calendar). Shared scope; concatenated by scripts/concat.mjs.
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
          c.length >= 7 && c[6] && !/^[\d.,\s%+\-]+$/.test(c[6])
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
            const _ni = cleanNum(sc[4]); // Net Income (informational)
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
    let doc = null;
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

// ---------- OPCVM performance-file import: extracted to js/06g-opcvm-import.js ----------

// ---------- Match funds to ASFIM (auto NAV history): extracted to js/06h-fund-match.js ----------

// restore any saved master overrides on load
try {
  const sm = localStorage.getItem("casa_master_v1");
  if (sm) {
    const o = JSON.parse(sm);
    for (const k in o) {
      if (M[k]) Object.assign(M[k], o[k]);
      else M[k] = o[k];
    }
  }
} catch (e) {}

// ---------- CSV import / export ----------
document.getElementById("exportCsv").onclick = () => {
  // Schema-driven: columns + per-field serialisation come from TXN_FIELDS, so
  // adding a field to the schema automatically appears in the export (and the
  // round-trip test enforces it). ctx.resolveBroker emits the resolved broker
  // so export -> re-import preserves the fee model.
  const S = __core.txnSchema;
  const ctx = { resolveBroker: (t) => txnBroker(t) };
  const rows = [S.csvHeader(), ...TXNS.map((t) => S.txnToCsvRow(t, ctx))];
  const csv = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" }),
    url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "transactions.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  document.getElementById("csvResult").textContent =
    `Exported ${TXNS.length} rows.`;
};
document.getElementById("importCsv").onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      const lines = String(rd.result)
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .filter((l) => l.trim());
      const hdr = lines[0]
        .toLowerCase()
        .split(",")
        .map((s) => s.trim());
      // Schema-driven parse: column index map + per-field parsing come from
      // TXN_FIELDS, so a new field is picked up automatically (and the
      // round-trip test enforces coverage). Two OPCVM-specific behaviours are
      // kept as explicit post-steps below, matching the add-form.
      const S = __core.txnSchema;
      const ix = S.buildCsvIx(hdr);
      if (S.requiredKeys().some((k) => ix[k] < 0)) {
        // Column names come from the schema so this message can never go stale
        // when a field is added/renamed.
        document.getElementById("csvResult").textContent =
          "\u274C CSV needs columns: " +
          S.requiredCsvColumns().join(", ") +
          " (" +
          S.optionalCsvColumns().join(", ") +
          " optional)";
        return;
      }
      const parseCtx = { brokers: BROKERS };
      const out = [];
      for (let i = 1; i < lines.length; i++) {
        const c = lines[i].split(",");
        const o = S.csvRowToTxn(c, ix, parseCtx);
        // OPCVM auto-detect: if the column is absent/false but the master list
        // knows this ticker as a fund, flag it (same as the add-form).
        if (o.opcvm !== true && M[o.ticker] && M[o.ticker].cat === "OPCVM")
          o.opcvm = true;
        // OPCVM parity with the add-form: if a row has a Total but no unit price
        // (funds are entered by Quantity + Total TTC), derive the unit price so
        // the row survives the filter below and stores identically to a
        // UI-entered fund.
        if ((isNaN(o.price) || !o.price) && o.total > 0 && o.qty) {
          o.price = o.total / o.qty;
        }
        out.push(o);
      }
      let clean = out.filter(
        (t) => t.date && t.ticker && t.qty && (t.price || t.total),
      );
      let _rounded = 0,
        _dropped = 0;
      clean = clean.filter((t) => {
        if (!t.opcvm && Math.abs(t.qty - Math.round(t.qty)) > 1e-9) {
          const wq = Math.floor(t.qty);
          if (wq < 1) {
            _dropped++;
            return false;
          }
          t.qty = wq;
          _rounded++;
        }
        return true;
      });
      const mode =
        (document.getElementById("csvMode") || {}).value || "replace";
      if (mode === "append") {
        TXNS = TXNS.concat(clean);
      } else {
        if (
          !(await appConfirm(
            "Replace ALL current transactions with the " +
              clean.length +
              " imported row(s)?",
          ))
        ) {
          return;
        }
        TXNS = clean;
      }
      saveTxns(TXNS);
      document.getElementById("csvResult").innerHTML =
        `\u2705 ${mode === "append" ? "Appended" : "Imported"} <b>${clean.length}</b> transaction(s). Ledger now has ${TXNS.length}.` +
        (_rounded
          ? ` <span class="mini" style="color:var(--warn)">\u00B7 ${_rounded} stock row(s) rounded to whole shares</span>`
          : "") +
        (_dropped
          ? ` <span class="mini" style="color:var(--neg)">\u00B7 ${_dropped} dropped (fractional <1 share)</span>`
          : "");
      render();
    } catch (err) {
      document.getElementById("csvResult").textContent =
        "\u274C Parse error: " + err.message;
    }
  };
  rd.readAsText(f);
  e.target.value = "";
};

// ---------- fees explainer values + dividend-tax-by-year editor ----------
function renderDivTax() {
  const el = (id) => document.getElementById(id);
  const yrs = Object.keys(DIVTAX)
    .map(Number)
    .sort((a, b) => a - b);
  document.querySelector("#divTaxTable tbody").innerHTML =
    yrs
      .map(
        (y) => `<tr>
    <td class="l">${y}</td><td>${(DIVTAX[y] * 100).toFixed(2)}%</td>
    <td class="center"><button class="chip" style="cursor:pointer;border:none" data-act="delYear" data-args="${y}" aria-label="Delete year" data-tip="Delete this year's dividend-tax rate">\u2715</button></td></tr>`,
      )
      .join("") +
    `<tr style="border-top:1px solid var(--border)"><td class="l" style="color:var(--muted)"><i>2028+ \u2192</i></td><td style="color:var(--muted)">${yrs.length ? (DIVTAX[yrs[yrs.length - 1]] * 100).toFixed(2) + "%" : "\u2014"}</td><td></td></tr>`;
}
window.delYear = function (y) {
  delete DIVTAX[String(y)];
  saveDivTax();
  renderDivTax();
  render();
};
document.getElementById("addYear").onclick = () => {
  const y = parseInt(document.getElementById("ntYear").value, 10);
  const r = parseFloat(document.getElementById("ntRate").value);
  if (!y || isNaN(r)) {
    toast("Enter a year and a rate %.", "warn");
    return;
  }
  DIVTAX[String(y)] = r / 100;
  saveDivTax();
  document.getElementById("ntYear").value = "";
  document.getElementById("ntRate").value = "";
  renderDivTax();
  render();
};

// ---------- transaction edit / update ----------
let EDIT_IX = null;
// Holds ex-date / eligible-shares basis for a dividend being added or edited,
// since the transaction form has no visible field for them. addTxn merges it.
let _pendingDivMeta = null;
window.editTxn = function (i) {
  const t = TXNS[i];
  if (!t) return;
  EDIT_IX = i;
  // Preserve DIV ex-date / eligibility basis across an edit (no visible field).
  _pendingDivMeta =
    t.action === "DIV" && (t.exDate != null || t.eligBasis != null)
      ? { exDate: t.exDate, eligBasis: t.eligBasis }
      : null;
  window._loadingEditForm = true; // keep stored price/total, don't auto-overwrite
  document.getElementById("tDate").value = t.date;
  document.getElementById("tTicker").value = t.ticker;
  document.getElementById("tAction").value = t.action;
  document.getElementById("tQty").value = t.qty;
  document.getElementById("tPrice").value = t.price;
  document.getElementById("tTotal").value =
    typeof t.total === "number" && t.total > 0 ? t.total : "";
  {
    const _tt = document.getElementById("tTotal");
    if (_tt) _tt.dataset.auto = "";
  }
  {
    const _nf = document.getElementById("tFundName");
    if (_nf) _nf.value = (M[t.ticker] && M[t.ticker].name) || "";
  }
  document.getElementById("tPea").checked = !!t.pea;
  // Prefill the broker select so editing doesn't silently reset it to the
  // default. Use the stored broker, else the resolved fallback (txnBroker).
  {
    const _bs = document.getElementById("tBroker");
    if (_bs) {
      const _bv = t.broker || txnBroker(t);
      if (BROKERS[_bv]) _bs.value = _bv;
    }
  }
  document.getElementById("tOpcvm").checked = isOpcvmTxn(t);
  document.getElementById("tOpcvm").dispatchEvent(new Event("change"));
  window._loadingEditForm = false;
  document.getElementById("addTxn").textContent = "Update";
  document.getElementById("cancelEdit").style.display = "";
  document.getElementById("editHint").textContent =
    "Editing transaction \u2014 change fields and press Update.";
  setKindBadge(document.getElementById("tKind"), t.ticker);
  liveCalc();
  document.querySelector('.tab[data-view="transactions"]').click();
  window.scrollTo(0, 0);
};
document.getElementById("cancelEdit").onclick = () => {
  EDIT_IX = null;
  _pendingDivMeta = null;
  document.getElementById("addTxn").textContent = "Add";
  document.getElementById("cancelEdit").style.display = "none";
  document.getElementById("editHint").textContent = "";
  document.getElementById("tQty").value = "";
  document.getElementById("tPrice").value = "";
  document.getElementById("tTotal").value = "";
  document.getElementById("txnCalc").textContent = "";
};

// ---------- light / dark mode toggle: extracted to js/06f-theme.js ----------

// ---------- dividend calendar import (replicates Excel date-fix formula) ----------
let DIVCAL = (() => {
  const s = localStorage.getItem("casa_divcal_v1");
  const seed = () => SEED.dividend_calendar.map((d) => ({ ...d }));
  if (s == null) return seed();
  const parsed = safeParseLS("casa_divcal_v1", s, null, "Dividend calendar");
  return Array.isArray(parsed.value) ? parsed.value : seed();
})();
function saveDivCal() {
  if (safeSetItem("casa_divcal_v1", JSON.stringify(DIVCAL))) markSaved();
}

// ---- Auto-merge the committed dividend calendar (public/dividends.json) ----
// The daily workflow writes public/dividends.json (issuer->ticker-mapped rows
// from the Bourse de Casablanca calendar). On load we fetch it and UPSERT it
// into DIVCAL via the same mergeDivcal used by manual import - so new/updated
// dividends appear automatically and manual entries are never deleted. The file
// also carries `_unmapped` (issuers with no ticker) which the Data-tab matcher
// surfaces. Best-effort and idempotent: a missing file or a no-op merge is
// silent. Runs once, shortly after boot so it can't delay first paint.
let DIVIDENDS_UNMAPPED = []; // issuers from the feed with no ticker mapping
function loadDividendsUnmapped() {
  try {
    return JSON.parse(localStorage.getItem("casa_div_unmapped_v1") || "[]");
  } catch (_e) {
    return [];
  }
}
DIVIDENDS_UNMAPPED = loadDividendsUnmapped();
let _autoDivDone = false;
function autoMergeDividends() {
  if (_autoDivDone) return;
  _autoDivDone = true;
  fetch("dividends.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((doc) => {
      if (!doc || !Array.isArray(doc.rows) || !doc.rows.length) return;
      // Remember unmapped issuers for the matcher UI (persist so it survives
      // to the Data tab even before the next fetch).
      if (Array.isArray(doc._unmapped)) {
        DIVIDENDS_UNMAPPED = doc._unmapped;
        try {
          localStorage.setItem(
            "casa_div_unmapped_v1",
            JSON.stringify(doc._unmapped),
          );
        } catch (_e) {}
      }
      if (
        typeof __core === "undefined" ||
        !__core.divcalMerge ||
        !__core.divcalMerge.mergeDivcal
      )
        return;
      const res = __core.divcalMerge.mergeDivcal(DIVCAL, doc.rows);
      if (res.added || res.updated) {
        DIVCAL = res.list;
        saveDivCal();
        if (typeof render === "function") {
          try {
            render();
          } catch (_e) {}
        }
        if (typeof toast === "function")
          toast(
            "Dividend calendar auto-updated: " +
              res.added +
              " added, " +
              res.updated +
              " updated.",
            "ok",
          );
      }
    })
    .catch(() => {
      /* no committed dividends.json / offline -> silent */
    });
}
// Defer so it never blocks first render.
setTimeout(() => {
  try {
    autoMergeDividends();
  } catch (_e) {}
}, 1200);

// ---- Data-tab: match unmapped dividend issuers to tickers ----
// Lists the issuers the daily feed couldn't map (DIVIDENDS_UNMAPPED), lets the
// user bind each to a ticker (stored locally in casa_issuer_overrides_v1), and
// generates the FULL issuer-name -> ticker map to paste into
// public/issuer-map.json (committed baseline + local overrides). Best-effort,
// mirrors the fund-matcher UX.
(function () {
  const listEl = document.getElementById("issuerMatchList");
  const exportBtn = document.getElementById("issuerMapExportBtn");
  const exportEl = document.getElementById("issuerMapExport");
  const statusEl = document.getElementById("issuerMatchResult");
  if (!listEl || !exportBtn) return;

  const OV_LS = "casa_issuer_overrides_v1"; // { "ISSUER NAME": "TICKER" }
  const loadOv = () => {
    try {
      return JSON.parse(localStorage.getItem(OV_LS) || "{}");
    } catch (e) {
      return {};
    }
  };
  const saveOv = (m) => {
    if (safeSetItem(OV_LS, JSON.stringify(m))) markSaved();
  };

  // Ticker <datalist> options from the master list.
  function tickerOptions() {
    return Object.keys(M)
      .sort()
      .map((t) => '<option value="' + escapeHtml(t) + '">')
      .join("");
  }

  function renderList() {
    const ov = loadOv();
    // Unmapped issuers that are STILL unmapped (not yet given a local override).
    const pending = (DIVIDENDS_UNMAPPED || []).filter((iss) => !ov[iss]);
    const done = Object.keys(ov).sort();
    let html = "";
    if (!pending.length && !done.length) {
      listEl.innerHTML =
        '<div class="mini" style="color:var(--muted)">No unmapped dividend issuers. Everything in the calendar maps to a ticker.</div>';
      return;
    }
    if (pending.length) {
      html += '<datalist id="issuerTickers">' + tickerOptions() + "</datalist>";
      html += pending
        .map(
          (iss) =>
            '<div class="form-row" style="align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">' +
            '<span style="flex:1;min-width:200px">' +
            escapeHtml(iss) +
            "</span>" +
            '<input list="issuerTickers" class="issuerBindInput" data-iss="' +
            escapeHtml(iss) +
            '" placeholder="ticker" style="width:110px">' +
            '<button class="chip issuerBindBtn" data-iss="' +
            escapeHtml(iss) +
            '" style="cursor:pointer">Map</button>' +
            "</div>",
        )
        .join("");
    }
    if (done.length) {
      html +=
        '<div class="mini" style="margin-top:8px;color:var(--success)">Your mappings:</div>' +
        done
          .map(
            (iss) =>
              '<div class="form-row" style="align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">' +
              '<span style="flex:1;min-width:200px">' +
              escapeHtml(iss) +
              "</span><b>" +
              escapeHtml(ov[iss]) +
              "</b>" +
              '<button class="chip issuerUnbindBtn" data-iss="' +
              escapeHtml(iss) +
              '" style="cursor:pointer">Remove</button>' +
              "</div>",
          )
          .join("");
    }
    listEl.innerHTML = html;
  }

  listEl.addEventListener("click", (e) => {
    const bind = e.target.closest(".issuerBindBtn");
    if (bind) {
      const iss = bind.dataset.iss;
      const inp = listEl.querySelector(
        '.issuerBindInput[data-iss="' + CSS.escape(iss) + '"]',
      );
      const tk = ((inp && inp.value) || "").trim().toUpperCase();
      if (!tk) {
        statusEl.textContent = "Enter a ticker for " + iss + ".";
        return;
      }
      const ov = loadOv();
      ov[iss] = tk;
      saveOv(ov);
      statusEl.textContent = "\u2705 " + iss + " \u2192 " + tk + " mapped.";
      renderList();
      return;
    }
    const unbind = e.target.closest(".issuerUnbindBtn");
    if (unbind) {
      const ov = loadOv();
      delete ov[unbind.dataset.iss];
      saveOv(ov);
      renderList();
      return;
    }
  });

  // Build the FULL map (committed baseline fetched live + local overrides) for
  // pasting into public/issuer-map.json.
  exportBtn.onclick = async () => {
    let base = {};
    try {
      const res = await fetch("issuer-map.json", { cache: "no-store" });
      if (res.ok) base = await res.json();
    } catch (_e) {
      /* no committed file yet -> overrides only */
    }
    const ov = loadOv();
    const merged = {};
    for (const k of Object.keys(base)) merged[k] = base[k];
    for (const k of Object.keys(ov)) merged[k] = ov[k];
    const ordered = {};
    for (const k of Object.keys(merged).sort()) ordered[k] = merged[k];
    if (!Object.keys(ordered).length) {
      exportEl.innerHTML =
        '<div class="mini" style="color:var(--muted)">Nothing to export yet.</div>';
      return;
    }
    const json = JSON.stringify(ordered, null, 2);
    exportEl.innerHTML =
      '<div class="mini" style="margin-bottom:4px">Copy this into <code>public/issuer-map.json</code> and commit it:</div>' +
      '<textarea readonly rows="' +
      Math.min(16, Object.keys(ordered).length + 3) +
      '" style="width:100%;font-family:var(--mono);font-size:12px" id="issuerMapJson">' +
      escapeHtml(json) +
      "</textarea>" +
      '<button class="chip" id="issuerMapCopy" style="cursor:pointer;margin-top:4px">Copy to clipboard</button>';
    const copyBtn = document.getElementById("issuerMapCopy");
    if (copyBtn)
      copyBtn.onclick = () => {
        const ta = document.getElementById("issuerMapJson");
        if (ta) {
          ta.select();
          try {
            navigator.clipboard.writeText(ta.value);
          } catch (_e) {
            document.execCommand("copy");
          }
          copyBtn.textContent = "Copied \u2714";
          setTimeout(() => {
            copyBtn.textContent = "Copy to clipboard";
          }, 1500);
        }
      };
  };

  // Re-render the list after the auto-merge has had a chance to populate
  // DIVIDENDS_UNMAPPED (autoMergeDividends runs at ~1200ms).
  renderList();
  setTimeout(renderList, 1600);
})();

function fixDate(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0"),
      mm = m[2].padStart(2, "0"),
      yyyy = m[3];
    return yyyy + "-" + mm + "-" + dd;
  }
  const dt = new Date(s);
  if (!isNaN(dt)) return dt.toISOString().slice(0, 10);
  return null;
}
function issuerNorm(s) {
  // Uppercase, strip accents, unify apostrophes/dashes, collapse whitespace, drop trailing legal suffixes.
  let x = String(s || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[\u2019\u2018\u02bc`']/g, " ") // apostrophes -> space
    .replace(/[\u2010-\u2015\-]/g, " ") // dashes -> space
    .replace(/[.,]/g, " ")
    .replace(/\b(S\s*A\s*R\s*L|S\s*A\s*S|S\s*A|SCA|SPA)\b/g, " ") // legal suffixes
    .replace(/\s+/g, " ")
    .trim();
  return x;
}
// Common acronym / short-name aliases that aren't the full registered issuer name.
// User-saved issuer aliases (resolved via the import quick-map). Normalized key -> ticker.
let USER_ALIASES = (() => {
  try {
    const s = localStorage.getItem("casa_issuer_aliases_v1");
    if (s) return JSON.parse(s);
  } catch (e) {}
  return {};
})();
function saveUserAliases() {
  if (
    safeSetItem("casa_issuer_aliases_v1", JSON.stringify(USER_ALIASES)) &&
    typeof markSaved === "function"
  )
    markSaved();
}
const ISSUER_ALIASES = {
  BMCI: "BCI",
  CIH: "CIH",
  "CIH BANK": "CIH",
  BCP: "BCP",
  BOA: "BOA",
  "BANK OF AFRICA BMCE GROUP": "BOA",
  ATTIJARIWAFA: "ATW",
  "MARSA MAROC": "MSA",
  "TOTALENERGIES MAROC": "TMA",
  "EAUX MINERALES D OULMES": "OUL",
  OULMES: "OUL",
  SBM: "SBM",
  "LAFARGEHOLCIM MAROC": "LHM",
  "HOLCIM MAROC": "LHM",
  "LAFARGE HOLCIM MAROC": "LHM",
};
function issuerToTicker(name) {
  if (!name) return null;
  const rawK = name.trim().toUpperCase();
  if (ISSUER_TO_TICKER[rawK]) return ISSUER_TO_TICKER[rawK];
  const nk = issuerNorm(name);
  // user-saved aliases take priority (resolved via the import quick-map)
  if (USER_ALIASES[nk] && M[USER_ALIASES[nk]]) return USER_ALIASES[nk];
  // 0) direct master ticker (issuer text IS a ticker, e.g. "CIH")
  if (M[rawK]) return rawK;
  const firstTok = nk.split(" ")[0];
  if (firstTok && M[firstTok]) return firstTok;
  // 1) alias table (normalized)
  if (ISSUER_ALIASES[nk]) return ISSUER_ALIASES[nk];
  for (const a in ISSUER_ALIASES) {
    if (nk === a || nk.startsWith(a + " ") || a.startsWith(nk + " "))
      return ISSUER_ALIASES[a];
  }
  // 2) normalized match against the issuer map
  for (const key in ISSUER_TO_TICKER) {
    const nkey = issuerNorm(key);
    if (nkey === nk || nkey.startsWith(nk) || nk.startsWith(nkey))
      return ISSUER_TO_TICKER[key];
  }
  // 3) normalized match against master company names
  for (const tk in M) {
    const nm = issuerNorm(M[tk].name || "");
    if (nm && (nm === nk || nm.startsWith(nk) || nk.startsWith(nm))) return tk;
  }
  // 4) last resort: exact-key loose match (legacy behavior)
  for (const key in ISSUER_TO_TICKER) {
    if (key.startsWith(rawK) || rawK.startsWith(key))
      return ISSUER_TO_TICKER[key];
  }
  return null;
}
function parseCalendar(raw) {
  // Detect format. If most non-empty lines contain a TAB -> tab-separated. Else -> block/newline format.
  const rawLines = raw.split(/\r?\n/);
  const nonEmpty = rawLines.filter((l) => l.trim());
  const out = [];
  let bad = 0,
    unmatched = [];
  const AMT = /^-?[\d.,\s]+$/,
    DATE = /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/;
  // --- Role-based (column-order-independent) row detector ---------------------
  // Handles the "Issuer  Ex-date  Payment date  Type  Amount MAD" feed (amount LAST,
  // with a MAD suffix) as well as any single-line layout, tab- OR space-separated.
  // A line qualifies when it carries: 2 dates, a dividend-type keyword, and a
  // <number> MAD amount. Issuer = text before the first date.
  const DATE_G = /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/g;
  const TYPE_RE =
    /\b(ordinary|exceptional|special|interim|ordinaire|exceptionnel|exceptionnelle|special dividend)\b/i;
  const AMT_MAD = /(-?[\d.\s\u00a0\u202f]*,?\d+(?:[.,]\d+)?)\s*MAD\b/i;
  function parseRoleLine(line) {
    const dates = line.match(DATE_G);
    if (!dates || dates.length < 2) return null;
    const tm = line.match(TYPE_RE);
    const am = line.match(AMT_MAD);
    if (!am) return null;
    const ex = dates[0],
      pay = dates[1];
    const amount = cleanNum(am[1]);
    if (amount == null) return null;
    // issuer = everything before the first date
    const firstDateIdx = line.indexOf(dates[0]);
    let issuer = line.slice(0, firstDateIdx).replace(/[\t]+/g, " ").trim();
    // strip a possible leading ticker column that duplicates issuer (rare); keep as-is otherwise
    const typ = tm ? tm[1] : "Ordinary";
    return { issuer, amount, ex, pay, typ };
  }
  const CAL_HEADER =
    /\b(issuer|ex[-\s]?date|payment\s*date|dividend\s*type|amount)\b/i;
  const isHeaderLine = (l) =>
    !DATE.test(l) && !AMT_MAD.test(l) && CAL_HEADER.test(l);
  const roleHits = nonEmpty.map(parseRoleLine);
  const roleCount = roleHits.filter(Boolean).length;
  const roleDenom = nonEmpty.filter((l) => !isHeaderLine(l)).length || 1;
  if (roleCount > 0 && roleCount >= roleDenom * 0.5) {
    for (let idx = 0; idx < nonEmpty.length; idx++) {
      if (isHeaderLine(nonEmpty[idx])) continue;
      const r = roleHits[idx];
      if (!r) {
        bad++;
        continue;
      }
      const ticker = issuerToTicker(r.issuer);
      const payd = fixDate(r.pay),
        exd = fixDate(r.ex);
      if (!ticker) {
        unmatched.push(r.issuer);
        bad++;
        continue;
      }
      if (!payd) {
        bad++;
        continue;
      }
      out.push({
        ticker,
        issuer: r.issuer,
        amount: r.amount,
        ex_date: exd,
        pay_date: payd,
        div_type: r.typ || "Ordinary",
      });
    }
    return { out, bad, unmatched };
  }
  const tabbed =
    nonEmpty.filter((l) => l.indexOf("\t") >= 0).length > nonEmpty.length / 2;
  if (tabbed) {
    for (const line of nonEmpty) {
      const c = line.split("\t").map((x) => x.trim());
      if (c.length < 5) {
        bad++;
        continue;
      }
      // support both "Ticker,Issuer,Amount,Ex,Pay,Type" and "Issuer,Amount,Ex,Pay,Type"
      let ticker, issuer, amount, ex, pay, typ;
      if (c.length >= 6 && !AMT.test(c[1])) {
        [ticker, issuer, amount, ex, pay, typ] = [
          c[0].toUpperCase(),
          c[1],
          cleanNum(c[2]),
          c[3],
          c[4],
          c[5],
        ];
      } else {
        issuer = c[0];
        amount = cleanNum(c[1]);
        ex = c[2];
        pay = c[3];
        typ = c[4];
        ticker = issuerToTicker(issuer);
      }
      const payd = fixDate(pay),
        exd = fixDate(ex);
      if (!ticker) {
        unmatched.push(issuer);
        bad++;
        continue;
      }
      if (!payd) {
        bad++;
        continue;
      }
      out.push({
        ticker,
        issuer,
        amount,
        ex_date: exd,
        pay_date: payd,
        div_type: typ || "Ordinary",
      });
    }
  } else {
    // Block format: fields on separate lines, records separated by blank line(s).
    // Skip an optional header block (Issuer/Amount/Ex-date/Payment date/Dividend type labels).
    const HEADERS = new Set([
      "issuer",
      "amount",
      "ex-date",
      "payment date",
      "dividend type",
      "ex date",
      "paymentdate",
    ]);
    const toks = nonEmpty.filter((l) => !HEADERS.has(l.trim().toLowerCase()));
    // Consume in groups of 5: Issuer, Amount, Ex-date, Payment date, Type
    for (let i = 0; i + 4 < toks.length || i < toks.length; ) {
      // find an issuer start: a non-numeric, non-date line
      const issuer = toks[i];
      if (issuer === undefined) break;
      const amount = cleanNum(toks[i + 1]);
      const ex = toks[i + 2],
        pay = toks[i + 3],
        typ = toks[i + 4];
      // validate shape
      if (amount == null || !DATE.test(ex || "") || !DATE.test(pay || "")) {
        i++;
        bad++;
        continue;
      }
      const ticker = issuerToTicker(issuer);
      const payd = fixDate(pay),
        exd = fixDate(ex);
      if (ticker && payd) {
        out.push({
          ticker,
          issuer,
          amount,
          ex_date: exd,
          pay_date: payd,
          div_type: typ || "Ordinary",
        });
      } else {
        if (!ticker) unmatched.push(issuer);
        bad++;
      }
      i += 5;
    }
  }
  return { out, bad, unmatched };
}
function calImport() {
  const raw = document.getElementById("calPaste").value.trim();
  if (!raw) {
    document.getElementById("calResult").textContent =
      "Paste calendar rows first.";
    return;
  }
  const { out: out2, bad, unmatched } = parseCalendar(raw);
  const uniqUnmatched = [...new Set(unmatched)];
  if (!out2.length && !uniqUnmatched.length) {
    document.getElementById("calResult").innerHTML =
      "\u274c Could not parse any rows.";
    return;
  }
  // SMART MERGE (upsert): add events not already present, update matching events
  // whose amount/pay-date/issuer/type changed, and never delete existing rows.
  // Identity = ticker + ex-date (fallback ticker + pay-date). This lets the user
  // accumulate multiple years and re-import a corrected year without losing the
  // others or creating duplicates. Replaces the old Replace/Append modes.
  let added = 0,
    updated = 0,
    dups = 0;
  if (out2.length) {
    const res = __core.divcalMerge.mergeDivcal(DIVCAL, out2);
    DIVCAL = res.list;
    added = res.added;
    updated = res.updated;
    dups = res.skipped;
    saveDivCal();
  }
  const parts = [];
  if (added) parts.push("added <b>" + added + "</b>");
  if (updated) parts.push("updated <b>" + updated + "</b>");
  let msg;
  if (added || updated) {
    msg =
      "\u2705 Merged \u2014 " +
      parts.join(", ") +
      (dups
        ? ' <span style="color:var(--muted)">(' + dups + " unchanged)</span>"
        : "") +
      ".";
  } else {
    msg = out2.length
      ? "\u2139 Nothing changed \u2014 all " +
        out2.length +
        " row(s) already up to date."
      : "\u26a0 No rows imported yet.";
  }
  if (uniqUnmatched.length) {
    msg +=
      ' <span style="color:var(--warn)">' +
      uniqUnmatched.length +
      " issuer(s) not matched \u2014 pick a ticker below.</span>";
    msg += calResolverHTML(uniqUnmatched);
  }
  document.getElementById("calResult").innerHTML = msg;
  if (uniqUnmatched.length) wireCalResolver();
  render();
}
// Best-guess ticker for an unmatched issuer: token-overlap against master names + ISSUER_TO_TICKER keys.
// Returns {ticker, score} or {ticker:null, score:0}. Threshold 0.34 keeps weak guesses out.
const _ISS_STOP = new Set([
  "DE",
  "DU",
  "DES",
  "LA",
  "LE",
  "LES",
  "SA",
  "SARL",
  "SAS",
  "SCA",
  "GROUP",
  "GROUPE",
  "HOLDING",
  "COMPAGNIE",
  "SOCIETE",
  "STE",
  "MAROC",
  "MAROCAINE",
  "ET",
  "AL",
  "CO",
  "INC",
]);
function issuerTokens(s) {
  return issuerNorm(s)
    .split(" ")
    .filter((w) => w && !_ISS_STOP.has(w));
}
function issuerNameScore(a, b) {
  const A = issuerTokens(a),
    B = issuerTokens(b);
  if (!A.length || !B.length) return 0;
  const sa = new Set(A),
    sb = new Set(B);
  let inter = 0;
  sa.forEach((w) => {
    if (sb.has(w)) inter++;
  });
  return inter / new Set([...sa, ...sb]).size;
}
function guessTicker(issuer) {
  let best = null,
    bestS = 0;
  for (const tk in M) {
    const sc = issuerNameScore(issuer, M[tk].name || "");
    if (sc > bestS) {
      bestS = sc;
      best = tk;
    }
  }
  for (const key in ISSUER_TO_TICKER) {
    const sc = issuerNameScore(issuer, key);
    if (sc > bestS) {
      bestS = sc;
      best = ISSUER_TO_TICKER[key];
    }
  }
  return bestS >= 0.34 && best
    ? { ticker: best, score: bestS }
    : { ticker: null, score: bestS };
}
// Build the quick-map resolver: each unmatched issuer + a ticker <select>.
function calResolverHTML(list) {
  let h =
    '<div id="calResolver" style="margin-top:10px;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--panel2)">';
  h +=
    '<div class="mini" style="margin-bottom:8px;color:var(--text2)">Map each unmatched issuer to a ticker, then re-import. Your choices are remembered for next time.</div>';
  for (const iss of list) {
    const esc = String(iss).replace(/</g, "&lt;").replace(/"/g, "&quot;");
    const guess = guessTicker(iss);
    // build options: blank first, then all tickers; pre-select best guess if confident
    let opts = '<option value="">\u2014 pick \u2014</option>';
    opts += Object.keys(M)
      .sort()
      .map((tk) => {
        const nm = (M[tk].name || "").replace(/</g, "&lt;");
        const sel = guess.ticker === tk ? " selected" : "";
        return (
          '<option value="' +
          tk +
          '"' +
          sel +
          ">" +
          tk +
          (nm ? " \u00b7 " + nm : "") +
          "</option>"
        );
      })
      .join("");
    const guessHint = guess.ticker
      ? '<span class="mini" style="color:var(--info);margin-left:4px" title="Best guess based on name similarity (' +
        Math.round(guess.score * 100) +
        '% match) \u2014 confirm or change">\u2754 guess</span>'
      : "";
    h +=
      '<div style="display:flex;gap:8px;align-items:center;margin:5px 0">' +
      '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' +
      esc +
      '">' +
      esc +
      "</span>" +
      '<select class="cal-resolve" data-issuer="' +
      esc +
      '" style="max-width:260px">' +
      opts +
      "</select>" +
      guessHint +
      "</div>";
  }
  h +=
    '<button class="btn" id="calResolveSave" style="margin-top:8px">Save &amp; re-import</button>';
  h += "</div>";
  return h;
}
function wireCalResolver() {
  const btn = document.getElementById("calResolveSave");
  if (!btn) return;
  btn.onclick = () => {
    let n = 0;
    document.querySelectorAll("#calResolver .cal-resolve").forEach((sel) => {
      const tk = sel.value;
      if (!tk) return;
      const iss = sel.getAttribute("data-issuer");
      const key = issuerNorm(iss);
      if (key) {
        USER_ALIASES[key] = tk;
        n++;
      }
    });
    if (!n) {
      document
        .getElementById("calResult")
        .insertAdjacentHTML(
          "beforeend",
          '<div class="mini" style="color:var(--warn);margin-top:6px">Pick at least one ticker first.</div>',
        );
      return;
    }
    saveUserAliases();
    calImport(); // re-run with the new aliases in effect
  };
}
document.getElementById("applyCal").onclick = calImport;
document.getElementById("clearCal").onclick = () => {
  document.getElementById("calPaste").value = "";
  document.getElementById("calResult").textContent = "";
};

document.getElementById("addAllMissing").onclick = async () => {
  const miss = DIVCAL.filter(
    (d) => d.pay_date && divStatus(d).t === "\u26a0 Not recorded",
  );
  if (!miss.length) {
    document.getElementById("calResult").textContent =
      "No missing dividends to add.";
    return;
  }
  if (
    !(await appConfirm(
      "Add " +
        miss.length +
        " missing dividend(s)? They will be tagged auto for review.",
    ))
  )
    return;
  let added = 0;
  for (const d of miss) {
    const exd = d.ex_date || d.pay_date;
    const amt = +(+d.amount).toFixed(4);
    for (const pea of [false, true]) {
      const sh = heldBefore(d.ticker, pea, exd);
      if (sh <= 1e-9) continue;
      const dup = TXNS.some(
        (t) =>
          t.action === "DIV" &&
          t.ticker === d.ticker &&
          !!t.pea === pea &&
          +(+t.price).toFixed(4) === amt &&
          daysBetween(t.date, d.pay_date) <= DIV_MATCH_WINDOW_DAYS,
      );
      if (dup) continue;
      TXNS.push({
        date: d.pay_date,
        ticker: d.ticker,
        action: "DIV",
        qty: +sh.toFixed(4),
        price: d.amount,
        pea: pea,
        broker: pea ? "attijari" : "saham",
        auto: true,
        exDate: exd,
        eligBasis: sh,
      });
      added++;
    }
  }
  if (added) {
    saveTxns(TXNS);
    document.getElementById("calResult").innerHTML =
      "\u2705 Added <b>" +
      added +
      "</b> missing dividend(s) \u2014 tagged for review.";
    render();
  } else
    document.getElementById("calResult").textContent =
      "Nothing added (all already recorded).";
};

// ---------- downloadable templates ----------
function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" }),
    url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
document.getElementById("dlTxnTemplate").onclick = () => {
  // SCHEMA-DRIVEN: header + sample rows are generated from __core.txnSchema so a
  // new transaction field (e.g. Order ID) appears in the template automatically
  // and can never drift from the real import/export columns.
  const S = __core.txnSchema;
  const ctx = {
    resolveBroker: (t) => t.broker || (t.opcvm ? "attijari" : "saham"),
  };
  const samples = [
    {
      date: "2026-01-15",
      ticker: "ATW",
      action: "BUY",
      qty: 10,
      price: 680,
      pea: false,
      opcvm: false,
      broker: "saham",
    },
    {
      date: "2026-03-20",
      ticker: "ATW",
      action: "SELL",
      qty: 5,
      price: 720,
      pea: false,
      opcvm: false,
      broker: "saham",
    },
    {
      date: "2026-06-22",
      ticker: "ATW",
      action: "DIV",
      qty: 10,
      price: 22,
      pea: false,
      opcvm: false,
      broker: "saham",
    },
    {
      date: "2026-02-04",
      ticker: "FCP A",
      action: "BUY",
      qty: 8.435,
      price: 831.8,
      pea: false,
      opcvm: true,
      total: 7025,
      broker: "attijari",
    },
    {
      date: "2026-02-04",
      ticker: "FCP B",
      action: "BUY",
      qty: 2.34,
      pea: false,
      opcvm: true,
      total: 2990.35,
      broker: "attijari",
    },
  ];
  const lines = [S.csvHeader().join(",")];
  for (const s of samples) lines.push(S.txnToCsvRow(s, ctx).join(","));
  lines.push(
    "# date=YYYY-MM-DD \u00B7 action=BUY/SELL/DIV \u00B7 pea=yes/no \u00B7 opcvm=yes/no (fund? auto-detected for known funds) \u00B7 total=OPCVM total TTC (optional, blank for stocks) \u00B7 qty=shares (or share count for DIV)  price=unit price MAD (or dividend/share for DIV)",
    "# broker=saham/attijari (optional). Blank -> auto: funds->attijari, stocks->saham. It sets the fee model, so fill it if you use a specific broker.",
    "# orderid=optional. Fills of ONE broker order (split executions) share the same Order ID so the per-order courtage minimum is charged once. Leave blank for single fills.",
    "# OPCVM funds: you can leave price BLANK and give total only \u2014 unit price is derived as total/qty on import (see FCP B row above).",
    "# Optional columns for auto-recorded dividends (exdate,eligbasis,auto) re-import automatically \u2014 you don't need to fill them by hand.",
  );
  downloadText("transactions_template.csv", lines.join("\n"));
};
document.getElementById("dlCalTemplate").onclick = () => {
  // SCHEMA-DRIVEN header: comes from __core.masterSchema.calTemplateHeader() so
  // the template can't drift from the calendar entry shape. The parser stays
  // format-flexible; only the advertised column order binds to the schema.
  const header = __core.masterSchema.calTemplateHeader().join("\t");
  const t = [
    header,
    "ATW\tAttijariwafa Bank\t22,00\t18/06/2026\t08/07/2026\tOrdinary",
    "IAM\tMaroc Telecom\t4,00\t04/09/2026\t15/09/2026\tOrdinary",
    "AFI\tAfric Industries\t20,00\t19/06/2026\t30/06/2026\tOrdinary",
  ].join("\n");
  downloadText("dividend_calendar_template.csv", t);
};

// prices updated stamp
(function () {
  const el = document.getElementById("pricesStamp");
  if (el && SEED.prices_updated)
    el.textContent = "Prices as of " + SEED.prices_updated;
})();

// ---------- editable fee panel: extracted to js/06i-fee-panel.js ----------

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
