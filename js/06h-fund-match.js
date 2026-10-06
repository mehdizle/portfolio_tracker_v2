// ============================================================
// ASFIM FUND MATCH / NAV BINDING  (js/06h-fund-match.js)
// ------------------------------------------------------------
// Extracted verbatim from js/06b-import.js (god-file decomposition).
// Self-contained IIFE: binds each held OPCVM fund to its official ASFIM
// record by ISIN (search + live NAV via the CORS-open ASFIM API), storing
// the map in casa_opcvm_isin_map_v1 and on M[ticker].isin. All symbols are
// IIFE-private; nothing elsewhere references them. Outbound deps (M,
// runFIFO, safeSetItem, markSaved, escapeHtml) load earlier or run at event
// time. Must stay inside the single concatenated IIFE; placed after
// 06g-opcvm-import.js in scripts/concat.mjs.
// ============================================================

// ---------- Match funds to ASFIM (auto NAV history) ----------
// Lets the user bind each held OPCVM fund to its official ASFIM record by ISIN,
// so the daily workflow (scripts/fetch-prices.mjs, reading public/fund-isins.json)
// fetches its NAV into the value-over-time curve. ASFIM's API is CORS-open to the
// app origin, so search + live-NAV lookups happen right here in the browser. The
// binding is stored in casa_opcvm_isin_map_v1 ({ticker:isin}) and on M[ticker].isin;
// a copyable JSON block mirrors it into the committed workflow file.
(function () {
  const listEl = document.getElementById("fundMatchList");
  const searchInp = document.getElementById("fundMatchSearch");
  const searchBtn = document.getElementById("fundMatchSearchBtn");
  const resultsEl = document.getElementById("fundMatchResults");
  const statusEl = document.getElementById("fundMatchResult");
  const exportBtn = document.getElementById("fundIsinsExportBtn");
  const exportEl = document.getElementById("fundIsinsExport");
  if (!listEl || !searchInp || !searchBtn) return;

  const ASFIM = "https://fundshare.asfim.ma/api";
  const MAP_LS = "casa_opcvm_isin_map_v1"; // { ticker: isin }
  const loadMap = () => {
    try {
      return JSON.parse(localStorage.getItem(MAP_LS) || "{}");
    } catch (e) {
      return {};
    }
  };
  const saveMap = (m) => {
    if (safeSetItem(MAP_LS, JSON.stringify(m))) markSaved();
  };

  // Held OPCVM fund tickers, from the current FIFO positions (cat === 'OPCVM').
  function heldFundTickers() {
    const set = new Set();
    try {
      const { pos } = runFIFO();
      for (const k in pos) {
        const p = pos[k];
        if (p && p.isFund && p.held > 1e-9) set.add(p.ticker);
      }
    } catch (_e) {}
    // Also include any master entry explicitly categorised OPCVM (covers funds
    // entered but not yet in a computed position).
    for (const tk in M) if (M[tk] && M[tk].cat === "OPCVM") set.add(tk);
    return [...set].sort();
  }

  let _selectedTicker = null; // which held fund a search result will bind to

  // ---- ASFIM calls (best-effort; return [] / null on any failure) ----
  async function asfimSearch(q) {
    const url = ASFIM + "/opcvm/?search=" + encodeURIComponent(q);
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.results || []).slice(0, 12);
    } catch (_e) {
      return [];
    }
  }
  async function asfimLatestNav(isin) {
    const url =
      ASFIM +
      "/performances/?opcvm__code_isin=" +
      encodeURIComponent(isin) +
      "&ordering=-date&page_size=1";
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const data = await res.json();
      const row = (data.results || [])[0];
      if (row && typeof row.vl === "number" && row.vl > 0)
        return { vl: row.vl, date: row.date };
    } catch (_e) {}
    return null;
  }

  // ---- render the per-held-fund match rows ----
  function renderList() {
    const map = loadMap();
    const funds = heldFundTickers();
    if (!funds.length) {
      listEl.innerHTML =
        '<div class="mini" style="color:var(--muted)">No OPCVM fund positions yet. Add a fund transaction (mark it OPCVM), then match it here.</div>';
      return;
    }
    listEl.innerHTML = funds
      .map((tk) => {
        const isin = map[tk] || (M[tk] && M[tk].isin) || "";
        const nm = (M[tk] && M[tk].name) || tk;
        const matched = isin
          ? '<span class="mini" style="color:var(--success)">\u2714 ' +
            escapeHtml(isin) +
            "</span>"
          : '<span class="mini" style="color:var(--warn)">not matched</span>';
        return (
          '<div class="form-row" style="align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">' +
          '<b style="min-width:70px">' +
          escapeHtml(tk) +
          "</b>" +
          '<span class="mini" style="flex:1;min-width:140px;color:var(--text2)">' +
          escapeHtml(nm) +
          "</span>" +
          matched +
          '<button class="chip fundMatchPick" data-tk="' +
          escapeHtml(tk) +
          '" style="cursor:pointer">' +
          (isin ? "Re-match" : "Match\u2026") +
          "</button>" +
          (isin
            ? '<button class="chip fundNavNow" data-tk="' +
              escapeHtml(tk) +
              '" data-isin="' +
              escapeHtml(isin) +
              '" style="cursor:pointer" data-tip="Fetch this fund\u0027s latest NAV now">NAV now</button>'
            : "") +
          "</div>"
        );
      })
      .join("");
  }

  // ---- render ASFIM search results as pickable rows ----
  function renderResults(rows) {
    if (!rows.length) {
      resultsEl.innerHTML =
        '<div class="mini" style="color:var(--muted)">No ASFIM funds found. Try part of the fund name, or paste the ISIN.</div>';
      return;
    }
    const forTk = _selectedTicker
      ? " for <b>" + escapeHtml(_selectedTicker) + "</b>"
      : "";
    resultsEl.innerHTML =
      '<div class="mini" style="margin-bottom:4px">Pick the ASFIM fund' +
      forTk +
      ":</div>" +
      rows
        .map((r) => {
          const isin = r.code_isin || "";
          return (
            '<div class="form-row" style="align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">' +
            '<span style="flex:1;min-width:180px">' +
            escapeHtml(r.nom || "(unnamed)") +
            '<span class="mini" style="color:var(--muted)"> \u00B7 ' +
            escapeHtml(r.type || "") +
            " \u00B7 " +
            escapeHtml(r.periodicite || "") +
            "</span></span>" +
            '<code class="mini">' +
            escapeHtml(isin) +
            "</code>" +
            '<button class="chip fundMatchBind" data-isin="' +
            escapeHtml(isin) +
            '" data-nom="' +
            escapeHtml(r.nom || "") +
            '" style="cursor:pointer"' +
            (isin ? "" : " disabled") +
            ">Use this</button>" +
            "</div>"
          );
        })
        .join("");
  }

  // ---- bind an ISIN to the selected (or a prompted) ticker ----
  function bind(ticker, isin, nom) {
    if (!ticker || !isin) return;
    const map = loadMap();
    map[ticker] = isin;
    saveMap(map);
    if (!M[ticker]) M[ticker] = { name: nom || ticker, cat: "OPCVM" };
    M[ticker].isin = isin;
    if (nom && !M[ticker].name) M[ticker].name = nom;
    safeSetItem("casa_master_v1", JSON.stringify(M));
    statusEl.textContent = "\u2705 " + ticker + " \u2192 " + isin + " saved.";
    renderList();
  }

  // ---- events ----
  searchBtn.onclick = async () => {
    const q = (searchInp.value || "").trim();
    if (!q) {
      statusEl.textContent = "Type a fund name or ISIN to search.";
      return;
    }
    resultsEl.innerHTML =
      '<div class="mini" style="color:var(--muted)">Searching ASFIM\u2026</div>';
    const rows = await asfimSearch(q);
    renderResults(rows);
  };
  searchInp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      searchBtn.onclick();
    }
  });

  // Delegated clicks: pick a ticker to match, bind a result, or fetch NAV.
  listEl.addEventListener("click", async (e) => {
    const pick = e.target.closest(".fundMatchPick");
    if (pick) {
      _selectedTicker = pick.dataset.tk;
      statusEl.textContent =
        "Searching a match for " + _selectedTicker + "\u2026";
      // pre-seed the search with the fund's name for convenience
      searchInp.value = (M[_selectedTicker] && M[_selectedTicker].name) || "";
      const rows = await asfimSearch(searchInp.value || _selectedTicker);
      renderResults(rows);
      return;
    }
    const nav = e.target.closest(".fundNavNow");
    if (nav) {
      const tk = nav.dataset.tk;
      const isin = nav.dataset.isin;
      nav.textContent = "\u2026";
      const r = await asfimLatestNav(isin);
      if (r) {
        if (!M[tk]) M[tk] = { name: tk, cat: "OPCVM" };
        M[tk].price = r.vl;
        safeSetItem("casa_master_v1", JSON.stringify(M));
        statusEl.textContent =
          "\u2705 " + tk + " NAV " + r.vl + " (" + r.date + ") applied.";
        if (typeof render === "function") render();
      } else {
        statusEl.textContent = "Could not fetch NAV for " + tk + ".";
      }
      nav.textContent = "NAV now";
      return;
    }
  });

  resultsEl.addEventListener("click", (e) => {
    const b = e.target.closest(".fundMatchBind");
    if (!b) return;
    const isin = b.dataset.isin;
    let tk = _selectedTicker;
    if (!tk) {
      // No held fund selected (free search) - ask which ticker to bind to.
      tk = (window.prompt("Bind ISIN " + isin + " to which ticker?") || "")
        .trim()
        .toUpperCase();
      if (!tk) return;
    }
    bind(tk, isin, b.dataset.nom);
    _selectedTicker = null;
    resultsEl.innerHTML = "";
  });

  // ---- generate the copyable public/fund-isins.json for the workflow ----
  exportBtn.onclick = () => {
    const map = loadMap();
    // Merge in any ISINs on the master that aren't in the map (belt & braces).
    for (const tk in M)
      if (M[tk] && M[tk].cat === "OPCVM" && M[tk].isin && !map[tk])
        map[tk] = M[tk].isin;
    const keys = Object.keys(map).sort();
    if (!keys.length) {
      exportEl.innerHTML =
        '<div class="mini" style="color:var(--muted)">No matched funds yet.</div>';
      return;
    }
    const ordered = {};
    for (const k of keys) ordered[k] = map[k];
    const json = JSON.stringify(ordered, null, 2);
    exportEl.innerHTML =
      '<div class="mini" style="margin-bottom:4px">Copy this into <code>public/fund-isins.json</code> and commit it, so the daily workflow tracks these funds:</div>' +
      '<textarea readonly rows="' +
      Math.min(14, keys.length + 3) +
      '" style="width:100%;font-family:var(--mono);font-size:12px" id="fundIsinsJson">' +
      escapeHtml(json) +
      "</textarea>" +
      '<button class="chip" id="fundIsinsCopy" style="cursor:pointer;margin-top:4px">Copy to clipboard</button>';
    const copyBtn = document.getElementById("fundIsinsCopy");
    if (copyBtn)
      copyBtn.onclick = () => {
        const ta = document.getElementById("fundIsinsJson");
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

  // initial paint (and repaint when the Data tab or positions change is fine on
  // next open; this runs once at boot).
  renderList();
})();
