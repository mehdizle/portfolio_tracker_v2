// 06m-divcal-import.js - dividend-calendar smart-merge import, unmapped-issuer
// matcher, issuer->ticker resolution + calendar template download. Extracted
// from js/06b-import.js (shared scope; concatenated by scripts/concat.mjs,
// loaded right after 06b-import so top-level eval order is preserved).
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
    .replace(/[\u2010-\u2015-]/g, " ") // dashes -> space
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
  const { out: out2, unmatched } = parseCalendar(raw);
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
