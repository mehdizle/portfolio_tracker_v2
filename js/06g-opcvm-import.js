// ============================================================
// OPCVM PERFORMANCE-FILE IMPORT  (js/06g-opcvm-import.js)
// ------------------------------------------------------------
// Extracted verbatim from js/06b-import.js (god-file decomposition).
// Self-contained IIFE: a native (no-lib) xlsx/zip reader that parses an
// OPCVM performance file, previews it, and applies NAV + fees onto M via
// __core.masterSchema.applyOpcvmFund. All its symbols are IIFE-private;
// nothing elsewhere references them. Outbound deps (M, safeSetItem, render,
// snapshotSignalsNow, takeSnapshot, escapeHtml, __core) are all defined
// before this file runs or are only touched at event time. Must stay inside
// the single concatenated IIFE and load AFTER its deps (placed right after
// 06b-import.js in scripts/concat.mjs).
//
// ============================================================

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
    // Fresh fund NAVs change portfolio value too -> snapshot signals AND the
    // portfolio-value point (latest-of-day wins). Guarded.
    snapshotSignalsNow();
    if (typeof takeSnapshot === "function") {
      try {
        takeSnapshot(true);
      } catch (_e) {}
    }
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
