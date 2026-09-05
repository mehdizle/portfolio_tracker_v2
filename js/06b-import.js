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
function extractTicker(colA) {
  if (!colA) return null;
  const s = String(colA).trim();
  for (const t of TICKERS) {
    if (s.toUpperCase().startsWith(t.toUpperCase())) return t;
  }
  // fallback: leading capital block
  const m = s.match(/^([A-Z0-9]{2,5})/);
  return m ? m[1] : null;
}

// Multi-line TradingView watchlist parser (ticker / company / "D" / data row / rating / category+metrics)
const TV_TICKERS = Object.keys(M).sort((a, b) => b.length - a.length);
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
  // Snapshot signals now that fresh prices are loaded (latest-of-day wins). This
  // is the most accurate trigger: the snapshot reflects the data you just
  // imported. Guarded so it can never break the import.
  snapshotSignalsNow();
};
document.getElementById("clearTV").onclick = () => {
  document.getElementById("tvPaste").value = "";
  document.getElementById("tvResult").textContent = "";
};

// ---------- OPCVM performance-file import (native unzip, no libs) ----------
(function () {
  const fileInpDaily = document.getElementById("opcvmFileDaily");
  const fileInpWeekly = document.getElementById("opcvmFileWeekly");
  const applyBtn = document.getElementById("applyOpcvm");
  const reviewEl = document.getElementById("opcvmReview");
  const resEl = document.getElementById("opcvmResult");
  const nameEl = document.getElementById("opcvmFileName");
  const stampEl = document.getElementById("opcvmStamp");
  if (!fileInpDaily && !fileInpWeekly) return;
  let IMPORT_MODE = "weekly"; // 'daily' = VL only \u00B7 'weekly' = VL + fees

  const MAP_LS = "casa_opcvm_isin_map_v1"; // { ticker: isin }
  const loadMap = () => {
    try {
      return JSON.parse(localStorage.getItem(MAP_LS) || "{}");
    } catch (e) {
      return {};
    }
  };
  const saveMap = (m) => {
    safeSetItem(MAP_LS, JSON.stringify(m));
  };

  const norm = (s) =>
    String(s || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  // Fuzzy fund-name matching helpers (accent-insensitive + token overlap).
  const stripAccents = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const normFuzzy = (s) => norm(stripAccents(s));
  const _STOP = new Set([
    "DE",
    "DU",
    "DES",
    "LA",
    "LE",
    "LES",
    "FCP",
    "SICAV",
    "OPCVM",
    "FONDS",
    "FUND",
    "R",
    "C",
    "D",
    "I",
  ]);
  const toks = (s) =>
    normFuzzy(s)
      .split(" ")
      .filter((w) => w && !_STOP.has(w));
  // Jaccard-ish token overlap in [0,1]; 1.0 = identical significant tokens.
  function nameScore(a, b) {
    const A = toks(a),
      B = toks(b);
    if (!A.length || !B.length) return 0;
    const sa = new Set(A),
      sb = new Set(B);
    let inter = 0;
    sa.forEach((w) => {
      if (sb.has(w)) inter++;
    });
    const union = new Set([...sa, ...sb]).size;
    return inter / union;
  }
  // Best fuzzy match of a held-fund name against the file's FUNDS list.
  // Returns {idx, score} or {idx:-1}. Threshold 0.5 avoids weak false matches.
  function bestFuzzy(heldName) {
    let best = -1,
      bestS = 0,
      second = -1,
      secondS = 0;
    for (let i = 0; i < FUNDS.length; i++) {
      const sc = nameScore(heldName, FUNDS[i].name);
      if (sc > bestS) {
        second = best;
        secondS = bestS;
        bestS = sc;
        best = i;
      } else if (sc > secondS) {
        secondS = sc;
        second = i;
      }
    }
    if (bestS < 0.5) return { idx: -1, score: bestS };
    // Ambiguous when the runner-up is within 0.15 of the winner (and non-trivial).
    const ambiguous = second >= 0 && secondS >= 0.4 && bestS - secondS < 0.15;
    return {
      idx: best,
      score: bestS,
      ambiguous,
      secondName: ambiguous ? FUNDS[second].name : null,
      secondScore: ambiguous ? secondS : null,
    };
  }

  // --- minimal ZIP reader: locate a stored entry by name and inflate (deflate-raw) ---
  async function readXlsxSheet(buf) {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    // scan End Of Central Directory to find central dir
    let eocd = -1;
    for (let i = u8.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("Not a valid .xlsx (no EOCD)");
    let cdOff = dv.getUint32(eocd + 16, true);
    const cdCount = dv.getUint16(eocd + 10, true);
    const entries = {};
    let p = cdOff;
    for (let n = 0; n < cdCount; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commLen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const nm = new TextDecoder().decode(
        u8.subarray(p + 46, p + 46 + nameLen),
      );
      entries[nm] = { method, compSize, lho };
      p += 46 + nameLen + extraLen + commLen;
    }
    async function extract(nm) {
      const e = entries[nm];
      if (!e) throw new Error("missing " + nm);
      // parse local header for its own name/extra lengths
      const lnl = dv.getUint16(e.lho + 26, true),
        lel = dv.getUint16(e.lho + 28, true);
      const start = e.lho + 30 + lnl + lel;
      const comp = u8.subarray(start, start + e.compSize);
      if (e.method === 0) return new TextDecoder().decode(comp); // stored
      // deflate-raw via native DecompressionStream
      const ds = new DecompressionStream("deflate-raw");
      const stream = new Response(comp).body.pipeThrough(ds);
      const ab = await new Response(stream).arrayBuffer();
      return new TextDecoder("utf-8").decode(ab);
    }
    // Find first worksheet
    const sheetName = Object.keys(entries).find((k) =>
      /^xl\/worksheets\/sheet\d+\.xml$/.test(k),
    );
    if (!sheetName) throw new Error("no worksheet found");
    return await extract(sheetName);
  }

  function colOf(ref) {
    // 'A3' -> 0
    const m = /^([A-Z]+)/.exec(ref);
    if (!m) return -1;
    let c = 0;
    for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
    return c - 1;
  }
  function parseSheet(xml) {
    const rows = [];
    const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
    let rm;
    while ((rm = rowRe.exec(xml))) {
      const cells = {};
      const cRe = /<c\s+([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
      let cm;
      while ((cm = cRe.exec(rm[1]))) {
        const attrs = cm[1];
        const inner = cm[3] || "";
        const rMatch = /r="([A-Z]+\d+)"/.exec(attrs);
        if (!rMatch) continue;
        const ci = colOf(rMatch[1]);
        const tMatch = /t="([^"]*)"/.exec(attrs);
        const t = tMatch ? tMatch[1] : null;
        let val = null;
        if (t === "inlineStr") {
          const im = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
          val = im ? decodeXml(im[1]) : "";
        } else {
          const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
          val = vm ? vm[1] : null;
        }
        cells[ci] = val;
      }
      rows.push(cells);
    }
    return rows;
  }
  function decodeXml(s) {
    // Single-pass decode so no replacement's output is re-processed by a later
    // rule (e.g. "&amp;lt;" must decode to "&lt;", not "<").
    const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    return String(s).replace(/&(#\d+|amp|lt|gt|quot|apos);/g, (m, ent) => {
      if (ent[0] === "#") return String.fromCharCode(+ent.slice(1));
      return NAMED[ent];
    });
  }

  let FUNDS = []; // parsed file rows: {isin,name,vl,buyFee,sellFee,mgmt}
  let PLAN = []; // review rows: {ticker,fundName,curPrice, chosenIdx}

  function buildPlan() {
    const map = loadMap();
    PLAN = [];
    const byIsin = {};
    FUNDS.forEach((f, idx) => {
      if (f.isin) byIsin[f.isin] = idx;
    });
    const byName = {};
    FUNDS.forEach((f, idx) => {
      byName[norm(f.name)] = idx;
    });
    const byNameFz = {};
    FUNDS.forEach((f, idx) => {
      const k = normFuzzy(f.name);
      if (byNameFz[k] == null) byNameFz[k] = idx;
    });
    for (const tk in M) {
      if (!(M[tk] && M[tk].cat === "OPCVM")) continue;
      let idx = -1;
      const savedIsin = map[tk] || M[tk].isin;
      if (savedIsin && byIsin[savedIsin] != null) idx = byIsin[savedIsin];
      else if (byName[norm(M[tk].name)] != null) idx = byName[norm(M[tk].name)];
      else if (byNameFz[normFuzzy(M[tk].name)] != null)
        idx = byNameFz[normFuzzy(M[tk].name)];
      let _fuzzyScore = null,
        _amb = null,
        _secName = null,
        _secScore = null;
      if (idx < 0) {
        const bf = bestFuzzy(M[tk].name);
        if (bf.idx >= 0) {
          idx = bf.idx;
          _fuzzyScore = bf.score;
          _amb = bf.ambiguous;
          _secName = bf.secondName;
          _secScore = bf.secondScore;
        }
      }
      PLAN.push({
        ticker: tk,
        fundName: M[tk].name,
        curPrice: M[tk].price,
        chosenIdx: idx,
        fuzzy: _fuzzyScore,
        amb: _amb,
        secName: _secName,
        secScore: _secScore,
      });
    }
    renderReview();
  }

  function renderReview() {
    if (!FUNDS.length) {
      reviewEl.innerHTML = "";
      applyBtn.style.display = "none";
      return;
    }
    const weekly = IMPORT_MODE === "weekly";
    const opts = (sel) =>
      ['<option value="-1">\u2014 not in file / skip \u2014</option>']
        .concat(
          FUNDS.map(
            (f, i) =>
              '<option value="' +
              i +
              '"' +
              (i === sel ? " selected" : "") +
              ">" +
              escapeHtml(f.name) +
              " (" +
              escapeHtml(f.isin) +
              ")</option>",
          ),
        )
        .join("");
    // Fee columns only shown for the weekly file (the daily file's fees are ignored).
    const feeHead = weekly
      ? '<th scope="col" style="text-align:right">Buy fee</th><th scope="col" style="text-align:right">Sell fee</th>'
      : "";
    let h =
      '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="text-align:left;color:var(--muted)">' +
      '<th scope="col" style="padding:4px">Held OPCVM</th><th scope="col">Matched fund (from file)</th><th scope="col" style="text-align:right">Old VL</th><th scope="col" style="text-align:right">New VL</th>' +
      feeHead +
      "</tr></thead><tbody>";
    PLAN.forEach((row, ri) => {
      const f = row.chosenIdx >= 0 ? FUNDS[row.chosenIdx] : null;
      const pct = (v) => (v == null ? "\u2014" : (v * 100).toFixed(2) + "%");
      const feeCells = weekly
        ? '<td style="text-align:right">' +
          (f ? pct(f.buyFee) : "\u2014") +
          "</td>" +
          '<td style="text-align:right">' +
          (f ? pct(f.sellFee) : "\u2014") +
          "</td>"
        : "";
      h +=
        '<tr style="border-top:1px solid var(--border)">' +
        '<td style="padding:5px 4px"><b>' +
        escapeHtml(row.fundName) +
        '</b> <span class="mini" style="color:var(--muted)">' +
        escapeHtml(row.ticker) +
        "</span>" +
        (row.fuzzy != null && row.chosenIdx >= 0
          ? ' <span class="mini" title="Matched by name similarity \u2014 please verify" style="color:var(--warn)">~fuzzy ' +
            Math.round(row.fuzzy * 100) +
            "%</span>"
          : "") +
        (row.amb && row.chosenIdx >= 0
          ? ' <span class="mini" title="Close runner-up: ' +
            escapeHtml(row.secName || "") +
            " (" +
            Math.round((row.secScore || 0) * 100) +
            '%). Two funds scored similarly \u2014 verify the right one is selected." style="color:var(--danger,#e5484d);font-weight:600">\u26A0 ambiguous</span>'
          : "") +
        "</td>" +
        '<td><select data-ri="' +
        ri +
        '" class="opcvmSel" style="max-width:260px;background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:3px 6px;font-size:11px">' +
        opts(row.chosenIdx) +
        "</select></td>" +
        '<td style="text-align:right;font-family:var(--mono)">' +
        (row.curPrice != null ? row.curPrice : "\u2014") +
        "</td>" +
        '<td style="text-align:right;font-family:var(--mono);color:' +
        (f ? "var(--success)" : "var(--muted)") +
        '">' +
        (f ? f.vl : "\u2014") +
        "</td>" +
        feeCells +
        "</tr>";
    });
    h += "</tbody></table>";
    const matched = PLAN.filter((r) => r.chosenIdx >= 0).length;
    h +=
      '<div class="mini" style="margin-top:8px">' +
      matched +
      " of " +
      PLAN.length +
      " held funds matched. " +
      FUNDS.length +
      " funds in file \u00B7 <b>" +
      (weekly ? "weekly (VL + fees)" : "daily (VL only)") +
      "</b> mode.</div>";
    reviewEl.innerHTML = h;
    reviewEl.querySelectorAll(".opcvmSel").forEach((sel) => {
      sel.onchange = (e) => {
        const ri = +e.target.dataset.ri;
        PLAN[ri].chosenIdx = +e.target.value;
        PLAN[ri].fuzzy = null;
        renderReview();
      };
    });
    applyBtn.style.display = matched ? "inline-block" : "none";
  }

  async function handleFile(f, mode) {
    if (!f) return;
    IMPORT_MODE = mode;
    nameEl.textContent =
      f.name +
      "  \u00B7  " +
      (mode === "daily" ? "daily (VL only)" : "weekly (VL + fees)");
    resEl.textContent = "Reading\u2026";
    try {
      const buf = await f.arrayBuffer();
      const xml = await readXlsxSheet(buf);
      const rows = parseSheet(xml);
      // header row: find row containing 'CODE ISIN'
      let hi = rows.findIndex((r) =>
        Object.values(r).some((v) =>
          String(v).toUpperCase().includes("CODE ISIN"),
        ),
      );
      if (hi < 0) hi = 1;
      const num = (v) => {
        if (v == null || v === "" || v === "-") return null;
        const n = parseFloat(v);
        return isNaN(n) ? null : n;
      };
      FUNDS = [];
      for (let i = hi + 1; i < rows.length; i++) {
        const r = rows[i];
        const isin = r[0];
        const name = r[2];
        if (!isin || !name) continue;
        FUNDS.push({
          isin: String(isin).trim(),
          name: String(name).trim(),
          vl: num(r[17]),
          buyFee: num(r[11]),
          sellFee: num(r[12]),
          mgmt: num(r[13]),
        });
      }
      // date from title row (row 1) if present
      const t0 = rows[0] ? Object.values(rows[0]).join(" ") : "";
      const dm = /(\d{2})-(\d{2})-(\d{4})/.exec(t0);
      window.__opcvmFileDate = dm ? dm[3] + "-" + dm[2] + "-" + dm[1] : null;
      resEl.textContent =
        "Parsed " +
        FUNDS.length +
        " funds" +
        (mode === "daily"
          ? " (VL only \u2014 fees ignored in this file)"
          : "") +
        ".";
      buildPlan();
    } catch (err) {
      resEl.innerHTML =
        '<span style="color:var(--error)">Import failed: ' +
        err.message +
        "</span>";
    }
  }
  if (fileInpDaily)
    fileInpDaily.onchange = (e) =>
      handleFile(e.target.files && e.target.files[0], "daily");
  if (fileInpWeekly)
    fileInpWeekly.onchange = (e) =>
      handleFile(e.target.files && e.target.files[0], "weekly");

  applyBtn.onclick = () => {
    const map = loadMap();
    let updated = 0,
      fees = 0;
    const weekly = IMPORT_MODE === "weekly";
    for (const row of PLAN) {
      if (row.chosenIdx < 0) continue;
      const f = FUNDS[row.chosenIdx];
      const tk = row.ticker;
      if (!M[tk]) continue;
      // Schema-driven apply (__core.masterSchema.OPCVM_FIELDS): vl->price only
      // when non-null, isin always written, buyFee/sellFee/mgmt weekly-only.
      // Same gating as before; counters preserved for the result summary.
      const _res = __core.masterSchema.applyOpcvmFund(M, tk, f, weekly);
      if (_res.priceUpdated) updated++;
      if (_res.feeUpdated) fees++;
      map[tk] = f.isin; // remember mapping for future imports
    }
    saveMap(map);
    safeSetItem("casa_master_v1", JSON.stringify(M));
    if (window.__opcvmFileDate) {
      try {
        localStorage.setItem("casa_opcvm_updated_v1", window.__opcvmFileDate);
      } catch (e) {}
      // remember which file kind set the VL date (for the stamp label)
      try {
        localStorage.setItem(
          "casa_opcvm_updated_kind_v1",
          weekly ? "weekly" : "daily",
        );
      } catch (e) {}
    }
    resEl.innerHTML = weekly
      ? "\u2705 Updated <b>" +
        updated +
        "</b> prices and stored fees for <b>" +
        fees +
        "</b> funds."
      : "\u2705 Updated <b>" +
        updated +
        "</b> prices (VL). Fees left unchanged \u2014 import the weekly file to refresh fees.";
    showOpcvmStamp();
    render();
    // Fresh fund prices loaded -> snapshot signals (latest-of-day wins).
    snapshotSignalsNow();
  };

  function showOpcvmStamp() {
    let d = null,
      kind = null;
    try {
      d = localStorage.getItem("casa_opcvm_updated_v1");
      kind = localStorage.getItem("casa_opcvm_updated_kind_v1");
    } catch (e) {}
    if (stampEl)
      stampEl.textContent = d
        ? "\u00B7 VL as of " + d + (kind ? " (" + kind + ")" : "")
        : "";
  }
  showOpcvmStamp();
})();

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
    <td class="center"><button class="chip" style="cursor:pointer;border:none" data-act="delYear" data-args="${y}" aria-label="Delete year" title="Delete year">\u2715</button></td></tr>`,
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
  document.getElementById("tOpcvm").checked =
    t.opcvm === true || !!(M[t.ticker] && M[t.ticker].cat === "OPCVM");
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

// ---------- light / dark mode toggle ----------
// NOTE: these MUST mirror the current "THEME REFRESH" :root palette
// (the purple flat-modern pass), because applyTheme() sets these tokens
// inline on <html> and would otherwise override the CSS defaults.
const THEMES = {
  dark: {
    "--bg": "#0a0b0f",
    "--bg2": "#0f1116",
    "--panel": "#14161c",
    "--panel2": "#1b1e26",
    "--border": "#262a33",
    "--border-l": "#1d2029",
    "--text": "#eceef2",
    "--text2": "#9ca3af",
    "--muted": "#656b76",
    // subtle dark-purple accent (matches the refreshed :root)
    "--primary": "#7c5cdd",
    "--primary2": "#9a7ef0",
    "--success": "#2dd4a7",
    "--error": "#f26d6d",
    "--warn": "#f5b544",
    "--info": "#8b9cf5",
  },
  light: {
    "--bg": "#f6f6fb",
    "--bg2": "#ffffff",
    "--panel": "#ffffff",
    "--panel2": "#f1f0f8",
    "--border": "#e4e2ee",
    "--border-l": "#eeecf5",
    "--text": "#1a1725",
    "--text2": "#5a5570",
    "--muted": "#8b869c",
    // same purple identity, deepened for contrast on white panels
    "--primary": "#6d4fd0",
    "--primary2": "#7c5cdd",
    "--success": "#0f9d76",
    "--error": "#e0484d",
    "--warn": "#c77f00",
    "--info": "#5b6fd8",
  },
};
function applyTheme(name) {
  const t = THEMES[name] || THEMES.dark;
  for (const k in t) document.documentElement.style.setProperty(k, t[k]);
  // Refresh the cached theme tokens so charts/renders pick up the new palette.
  if (typeof refreshThemeCache === "function") refreshThemeCache();
  try {
    localStorage.setItem("casa_theme_v1", name);
  } catch (e) {}
  const btn = document.getElementById("themeToggle");
  if (btn)
    btn.textContent =
      name === "light" ? "\uD83C\uDF19 Dark" : "\u2600\uFE0F Light";
  // Re-render so charts recolor to the new theme. (Previously gated on the
  // now-removed allocation pie's CH_alloc, which left charts stale on toggle.)
  setTimeout(() => {
    try {
      if (typeof render === "function") render();
    } catch (e) {}
  }, 10);
}
document.getElementById("themeToggle").onclick = () => {
  const cur = (() => {
    try {
      return localStorage.getItem("casa_theme_v1") || "dark";
    } catch (e) {
      return "dark";
    }
  })();
  applyTheme(cur === "dark" ? "light" : "dark");
};
(function () {
  try {
    const s = localStorage.getItem("casa_theme_v1");
    if (s) applyTheme(s);
  } catch (e) {}
})();

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
// Collapse exact-duplicate dividend events (same ticker + pay-date + amount) within a batch.
function dedupeDivcal(list) {
  const seen = new Set(),
    out = [];
  for (const d of list) {
    const k = d.ticker + "|" + d.pay_date + "|" + +(+d.amount).toFixed(4);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  return out;
}
function calImport() {
  const raw = document.getElementById("calPaste").value.trim();
  if (!raw) {
    document.getElementById("calResult").textContent =
      "Paste calendar rows first.";
    return;
  }
  const mode = document.getElementById("calMode").value;
  const { out: out2, bad, unmatched } = parseCalendar(raw);
  const uniqUnmatched = [...new Set(unmatched)];
  if (!out2.length && !uniqUnmatched.length) {
    document.getElementById("calResult").innerHTML =
      "\u274c Could not parse any rows.";
    return;
  }
  let added = 0,
    dups = 0;
  if (out2.length) {
    if (mode === "replace") {
      DIVCAL = dedupeDivcal(out2);
      added = DIVCAL.length;
    } else {
      const key = (d) =>
        d.ticker + "|" + d.pay_date + "|" + +(+d.amount).toFixed(4);
      const have = new Set(DIVCAL.map(key));
      for (const d of dedupeDivcal(out2)) {
        if (have.has(key(d))) {
          dups++;
          continue;
        }
        DIVCAL.push(d);
        have.add(key(d));
        added++;
      }
    }
    saveDivCal();
  }
  let msg = added
    ? "\u2705 Imported <b>" +
      added +
      "</b> dividend(s)." +
      (dups
        ? ' <span style="color:var(--muted)">(' +
          dups +
          " duplicate(s) skipped)</span>"
        : "")
    : out2.length
      ? "\u2139 Nothing new \u2014 all " +
        out2.length +
        " row(s) already present."
      : "\u26a0 No rows imported yet.";
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

// ---------- editable fee panel ----------
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550 BROKER FEE UI \u2550\u2550\u2550\u2550\u2550\u2550\u2550
let CUR_BROKER = "saham"; // currently selected broker tab
function parsePct(str) {
  if (str == null) return null;
  let s = String(str).replace(/,/g, ".").replace(/%/g, "").trim();
  if (s === "") return null;
  let v = parseFloat(s);
  if (isNaN(v)) return null;
  return v / 100;
}
function fmtPct(dec) {
  return dec == null ? "" : +(dec * 100).toFixed(4) + "%";
}

function renderBrokerTabs() {
  const el = document.getElementById("brokerTabs");
  if (!el) return;
  el.innerHTML = Object.keys(BROKERS)
    .map((id) => {
      const b = BROKERS[id];
      const active = id === CUR_BROKER;
      return `<button class="btn ${active ? "" : "sec2"} bkTab" data-bk="${escapeHtml(id)}" style="font-size:12px;padding:5px 14px;border-radius:14px">${escapeHtml(b.name)}</button>`;
    })
    .join("");
  el.querySelectorAll(".bkTab").forEach((btn) => {
    btn.onclick = () => {
      CUR_BROKER = btn.dataset.bk;
      renderBrokerTabs();
      renderBrokerFeeForm();
    };
  });
}

function renderBrokerFeeForm() {
  const el = document.getElementById("brokerFeePanel");
  if (!el) return;
  const bk = BROKERS[CUR_BROKER];
  if (!bk) return;
  const f = bk.fees;
  let h =
    '<div class="fee-sub">' +
    bk.name +
    ' <span class="mini">\u2014 trading fees</span></div>';
  h += '<div class="fee-fields" style="margin-top:8px">';
  h +=
    '<label>Broker name <input type="text" id="bk_name" value="' +
    bk.name +
    '"></label>';
  h +=
    '<label>Fee formula <select id="bk_feeType"><option value="regular"' +
    (bk.feeType === "regular" ? " selected" : "") +
    '>Rate-based (c.march\u00E9 + c.interm + c.r\u00E8gl + courier)</option><option value="pea"' +
    (bk.feeType === "pea" ? " selected" : "") +
    ">Courtage-based (courtage + r\u00E8gl + bourse)</option></select></label>";

  if (bk.feeType === "regular") {
    h +=
      '<label>Commission de march\u00E9 (%) <input type="text" id="bk_c_marche" value="' +
      fmtPct(f.c_marche) +
      '"></label>';
    h +=
      '<label>Commission d\'interm\u00E9diation (%) <input type="text" id="bk_c_interm" value="' +
      fmtPct(f.c_interm) +
      '"></label>';
    h +=
      '<label>Commission r\u00E8glement/livraison (%) <input type="text" id="bk_c_regl" value="' +
      fmtPct(f.c_regl) +
      '"></label>';
    h +=
      '<label>VAT on fees (%) <input type="text" id="bk_vat" value="' +
      fmtPct(f.vat) +
      '"></label>';
    h +=
      '<label>Frais de courrier (fixed, MAD) <input type="text" id="bk_courier" value="' +
      (f.courier || 0) +
      '"></label>';
    h +=
      '<label>OPCVM order fee (MAD HT) <input type="text" id="bk_opcvmOrder" value="' +
      (f.opcvmOrder || 0) +
      '"></label>';
    h +=
      '<label>Dividend commission (% HT) <input type="text" id="bk_divComm" value="' +
      fmtPct(f.divComm) +
      '"></label>';
    // Effective rate display
    const eff =
      ((f.c_marche || 0) + (f.c_interm || 0) + (f.c_regl || 0)) *
      (1 + (f.vat || 0.1));
    const fix = (f.courier || 0) * (1 + (f.vat || 0.1));
    h +=
      '</div><div style="margin-top:10px;padding:8px 10px;background:var(--panel2);border-radius:8px;font-size:13px"><b>Effective stock fee:</b> ' +
      (eff * 100).toFixed(3) +
      "% + " +
      fix.toFixed(2) +
      " MAD fixed" +
      (f.opcvmOrder
        ? " \u00b7 OPCVM: " +
          ((f.opcvmOrder || 0) * (1 + (f.vat || 0.1))).toFixed(2) +
          " MAD"
        : "") +
      "</div>";
  } else {
    h +=
      '<label>Commission de courtage (%) <input type="text" id="bk_courtage" value="' +
      fmtPct(f.courtage) +
      '"></label>';
    h +=
      '<label>Courtage minimum (MAD) <input type="text" id="bk_courtageMin" value="' +
      (f.courtageMin || 0) +
      '"></label>';
    h +=
      '<label>Commission r\u00E8glement/livr. (%) <input type="text" id="bk_regl" value="' +
      fmtPct(f.regl) +
      '"></label>';
    h +=
      '<label>Commission Bourse de Casa (%) <input type="text" id="bk_bourse" value="' +
      fmtPct(f.bourse) +
      '"></label>';
    h +=
      '<label>TVA on fees (%) <input type="text" id="bk_vat" value="' +
      fmtPct(f.vat) +
      '"></label>';
    h +=
      '<label>OPCVM order fee (MAD HT) <input type="text" id="bk_opcvmOrder" value="' +
      (f.opcvmOrder || 0) +
      '"></label>';
    h +=
      '<label>Dividend commission (% HT) <input type="text" id="bk_divComm" value="' +
      fmtPct(f.divComm) +
      '"></label>';
    // Effective rate
    const eff =
      ((f.courtage || 0) + (f.regl || 0) + (f.bourse || 0)) *
      (1 + (f.vat || 0.1));
    const minFee = (f.courtageMin || 0) * (1 + (f.vat || 0.1));
    h +=
      '</div><div style="margin-top:10px;padding:8px 10px;background:var(--panel2);border-radius:8px;font-size:13px"><b>Effective:</b> ' +
      (eff * 100).toFixed(3) +
      "% (min " +
      minFee.toFixed(2) +
      " MAD) \u00B7 OPCVM " +
      ((f.opcvmOrder || 0) * (1 + (f.vat || 0.1))).toFixed(2) +
      " MAD</div>";
  }
  el.innerHTML = h;
  // Re-render form when fee type changes
  const ftSel = document.getElementById("bk_feeType");
  if (ftSel)
    ftSel.onchange = () => {
      BROKERS[CUR_BROKER].feeType = ftSel.value;
      // Reset fees to defaults for that type
      if (ftSel.value === "regular")
        BROKERS[CUR_BROKER].fees = { ...BROKER_DEFAULTS.saham.fees };
      else BROKERS[CUR_BROKER].fees = { ...BROKER_DEFAULTS.attijari.fees };
      saveBrokers();
      renderBrokerFeeForm();
    };
}

// Save current broker's fees from the form
document.getElementById("saveBrokerFeesBtn").onclick = () => {
  const bk = BROKERS[CUR_BROKER];
  if (!bk) return;
  const nameEl = document.getElementById("bk_name");
  if (nameEl) bk.name = nameEl.value.trim() || CUR_BROKER;
  const p = (id) => parsePct(document.getElementById(id)?.value);
  const num = (id) =>
    parseFloat(
      String(document.getElementById(id)?.value || "0").replace(",", "."),
    );
  if (bk.feeType === "regular") {
    bk.fees = {
      c_marche: p("bk_c_marche"),
      c_interm: p("bk_c_interm"),
      c_regl: p("bk_c_regl"),
      vat: p("bk_vat"),
      courier: num("bk_courier"),
      opcvmOrder: num("bk_opcvmOrder"),
      divComm: p("bk_divComm"),
    };
  } else {
    bk.fees = {
      courtage: p("bk_courtage"),
      courtageMin: num("bk_courtageMin"),
      regl: p("bk_regl"),
      bourse: p("bk_bourse"),
      vat: p("bk_vat"),
      opcvmOrder: num("bk_opcvmOrder"),
      divComm: p("bk_divComm"),
    };
  }
  for (const k in bk.fees) {
    if (bk.fees[k] == null || isNaN(bk.fees[k])) {
      toast("All fee fields must be valid numbers.", "warn");
      return;
    }
  }
  // Also sync to legacy FP/FP_PEA for backward compat
  if (CUR_BROKER === "saham") {
    FP = { ...bk.fees, tpcvm: FP.tpcvm };
    saveFees();
  }
  if (CUR_BROKER === "attijari") {
    FP_PEA = { ...bk.fees };
    saveFeesPea();
  }
  saveBrokers();
  document.getElementById("brokerFeeSaved").textContent = "\u2705 Saved.";
  renderBrokerFeeForm();
  render();
};

document.getElementById("resetBrokerFeesBtn").onclick = () => {
  const def = BROKER_DEFAULTS[CUR_BROKER];
  if (def) {
    BROKERS[CUR_BROKER] = { ...def, fees: { ...def.fees } };
  }
  saveBrokers();
  if (CUR_BROKER === "saham") {
    FP = { ...BROKER_DEFAULTS.saham.fees, tpcvm: FP_DEFAULT.tpcvm };
    saveFees();
  }
  if (CUR_BROKER === "attijari") {
    FP_PEA = { ...BROKER_DEFAULTS.attijari.fees };
    saveFeesPea();
  }
  renderBrokerFeeForm();
  document.getElementById("brokerFeeSaved").textContent = "Reset to defaults.";
  render();
};

// Add broker
document.getElementById("addBrokerBtn").onclick = () => {
  const name = prompt("New broker name:");
  if (!name) return;
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, "_");
  if (BROKERS[id]) {
    toast('Broker "' + name + '" already exists.', "warn");
    return;
  }
  BROKERS[id] = {
    name: name,
    feeType: "regular",
    fees: { ...BROKER_DEFAULTS.saham.fees },
  };
  saveBrokers();
  CUR_BROKER = id;
  renderBrokerTabs();
  renderBrokerFeeForm();
};

// TPCVM save
document.getElementById("saveTpcvmBtn").onclick = () => {
  const v = parsePct(document.getElementById("fe_tpcvm").value);
  if (v == null || isNaN(v)) {
    toast("TPCVM must be a valid number.", "warn");
    return;
  }
  FP.tpcvm = v;
  saveFees();
  toast("TPCVM saved.", "ok");
  render();
};

// Init fee UI
function loadFeeInputs() {
  const el = document.getElementById("fe_tpcvm");
  if (el) el.value = fmtPct(FP.tpcvm);
  renderBrokerTabs();
  renderBrokerFeeForm();
}
loadFeeInputs();

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
  renderKPIs(t);
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
