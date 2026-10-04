// 03b-signals-ui.js
// Signals-tab PRESENTATION layer: everything that turns the pure scoring engine
// (03-signals.js: factorScores/fairValue/signal/targets) into on-screen UI.
// Pulled out of 04-render.js and 06-features.js so the "render" and "features"
// files stop doubling as the signals UI. Contents:
//   - computeSignalsRows(): assembles the per-ticker row model the Signals tab,
//     Top Buys / Top Sector / Top Headroom widgets, and Rebalance all read
//   - the signal-factor tooltip builders (fair value, target buy/sell, score,
//     conviction, P/E, P-in-range, dividend yield, price, peer-relative, the
//     full signalTipHTML factor breakdown)
//   - the ranking helpers (buyStrength / sellUrgency / topBuyRank)
//   - the Top Buys / Top Sector / Top Headroom dashboard widgets
//   - renderSignals() (the Signals tab table) and the signal-outcome scorecard
//     subsystem (snapshot recording + renderSignalOutcomes)
// Part of the Portfolio Tracker app. Loaded as an ordered plain <script>
// (shared global scope via scripts/concat.mjs) after 03-signals.js and
// 04-render.js (uses tooltip helpers from 01b, scoring from 03-signals, and a
// few shared render helpers).
// ============================================================

function computeSignalsRows() {
  const { pos } = runFIFO();
  return Object.keys(M)
    .filter((tk) => {
      // Hide category-only stubs: a key created purely to hold an uploaded
      // category/cycle/style (applyCategories) that has no price and isn't
      // held. Without this they'd show as blank "\u2014 MAD" phantom rows in the
      // Signals table and feed empty names into every widget that reads this
      // list. Once the name is priced (TradingView paste / OPCVM file) or
      // bought, it stops being a stub and appears normally.
      const m = M[tk];
      if (!m) return false;
      const priced = m.price != null && m.price > 0;
      const held = heldSharesOf(pos, tk) > 0;
      return priced || held || !m._catOnly;
    })
    .map((tk) => {
      const m = M[tk];
      const sc = factorScores(m); // {score, pir, coverage, parts} or null
      const sig = signal(m, sc, heldSharesOf(pos, tk) > 0);
      return {
        ticker: tk,
        name: m.name,
        m,
        sc,
        sig,
        price: m.price,
        tbuy: targetBuy(m, sc),
        tsell: targetSell(m, sc),
        score: sc ? sc.score : null,
        pir: sc ? sc.pir : null,
        pe: m.pe,
        divy: m.divy,
        fv: fairValue(m),
        conviction: sc ? sc.conviction : null,
        profile: sc ? sc.profile : null,
        held: heldSharesOf(pos, tk) > 0,
      };
    });
}

// ---------- signal calculation breakdown ----------

function tgtBuyTipHTML(r) {
  const fv = fairValue(r.m);
  const s = r.sc && r.sc.score != null ? r.sc.score : 0.5;
  const conv = r.sc && r.sc.conviction;
  // Derive the ACTUAL discount from the canonical targetBuy() result so the tooltip
  // always matches the displayed target (incl. the conviction margin-of-safety).
  const tbuy = r.tbuy != null ? r.tbuy : targetBuy(r.m, r.sc);
  const disc = fv != null && fv > 0 && tbuy != null ? 1 - tbuy / fv : null;
  const convExtra = conv === "Low" ? 10 : conv === "Medium" ? 4 : 0;
  const row = _tipRow; // shared tooltip row builder (gap:18px)
  let h = `<div style="font-weight:700;margin-bottom:6px">Target Buy \u00B7 ${escapeHtml(r.ticker)}</div>`;
  h += row("Fair value", (fv != null ? money(fv) : "\u2014") + " MAD");
  h += row("Score", (s * 100).toFixed(0) + "%");
  h += row(
    'Margin of safety <span class="mini">(10% + (1\u2212score)\u00D720%' +
      (convExtra ? " + " + convExtra + "% " + conv + " conviction" : "") +
      ")</span>",
    (disc != null ? (disc * 100).toFixed(1) : "\u2014") + "%",
  );
  h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>`;
  h += row(
    '<b>Target Buy</b> <span class="mini">(fair \u00D7 (1\u2212disc))</span>',
    "<b>" + (r.tbuy != null ? money(r.tbuy) : "\u2014") + "</b>",
  );
  h += `<div class="mini" style="margin-top:6px">Higher score \u2192 smaller required discount \u2192 buy closer to fair value.</div>`;
  return h;
}
function tgtSellTipHTML(r) {
  const fv = fairValue(r.m);
  const s = r.sc && r.sc.score != null ? r.sc.score : 0.5;
  // Derive the ACTUAL premium from the canonical targetSell() result (after the
  // 52-wk-high cap and fair-value/buy floors), so the tooltip matches the target shown.
  const tsell = r.tsell != null ? r.tsell : targetSell(r.m, r.sc);
  const prem = fv != null && fv > 0 && tsell != null ? tsell / fv - 1 : null;
  const row = _tipRow; // shared tooltip row builder (gap:18px)
  let h = `<div style="font-weight:700;margin-bottom:6px">Target Sell \u00B7 ${escapeHtml(r.ticker)}</div>`;
  h += row("Fair value", (fv != null ? money(fv) : "\u2014") + " MAD");
  h += row("Score", (s * 100).toFixed(0) + "%");
  h += row(
    'Premium over fair <span class="mini">(base 12% + score\u00D728%, then capped/floored)</span>',
    (prem != null ? (prem * 100).toFixed(1) : "\u2014") + "%",
  );
  h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>`;
  h += row(
    "<b>Target Sell</b>",
    "<b>" + (r.tsell != null ? money(r.tsell) : "\u2014") + "</b>",
  );
  h += `<div class="mini" style="margin-top:6px">Floored at Buy\u00D71.18, capped ~10% above 52-wk high. Higher score \u2192 higher premium.</div>`;
  return h;
}
function fvTipHTML(r) {
  const m = r.m,
    fv = r.fv,
    pr = r.price;
  const row = _tipRow; // shared tooltip row builder (gap:18px)
  let h =
    '<div style="font-weight:700;margin-bottom:4px">' +
    r.ticker +
    " \u2014 Fair Value</div>";
  h +=
    '<div style="color:var(--text2);font-size:11px;margin-bottom:6px">Blended intrinsic value from price-independent anchors (median-trimmed).</div>';
  const aps = fairValueParts(m);
  if (aps.length) {
    aps.forEach((a) => {
      h += row(a[0], money(a[1]) + " MAD");
    });
    h +=
      '<div style="border-top:1px solid var(--border);margin:6px 0;padding-top:2px"></div>';
  }
  h += row(
    "<b>Fair value</b>",
    "<b>" + (fv != null ? money(fv) + " MAD" : "\u2014") + "</b>",
  );
  h += row("Current price", pr != null ? money(pr) + " MAD" : "\u2014");
  if (fv != null && pr != null && fv > 0) {
    const gap = (fv - pr) / pr;
    const up = gap >= 0;
    const label = up
      ? "Undervalued \u2014 upside to fair"
      : "Overvalued \u2014 above fair";
    h += row(
      label,
      "<b>" + (up ? "+" : "") + (gap * 100).toFixed(1) + "%</b>",
      up ? "pos" : "neg",
    );
  }
  return h;
}
function scoreTipHTML(r) {
  // reuse the factor breakdown from signalTipHTML
  return signalTipHTML(r);
}
function convTipHTML(r) {
  const sc = r.sc;
  const _row = (l, v, cl) =>
    '<div style="display:flex;justify-content:space-between;gap:18px"><span>' +
    l +
    '</span><span class="' +
    (cl || "") +
    '" style="font-family:var(--mono)">' +
    v +
    "</span></div>";
  let h =
    '<div style="font-weight:700;margin-bottom:6px">Conviction \u00B7 ' +
    escapeHtml(r.ticker) +
    "</div>";
  if (!sc) {
    return (
      h +
      '<div class="mini" style="color:var(--muted)">Not enough data to score.</div>'
    );
  }
  const lvl = sc.conviction || "\u2014";
  const lvlCl = lvl === "High" ? "pos" : lvl === "Low" ? "neg" : "";
  h += _row("<b>Level</b>", "<b>" + lvl + "</b>", lvlCl);
  h +=
    '<div class="mini" style="margin:4px 0 6px;color:var(--muted)">How much to trust this score \u2014 needs BOTH broad factor coverage AND enough core fundamentals present.</div>';
  h += _row(
    'Factor coverage <span class="mini">(by weight)</span>',
    sc.wcov != null ? (sc.wcov * 100).toFixed(0) + "%" : "\u2014",
  );
  const nHave = (sc.depthDefs || []).filter((d) => d[1]).length,
    nTot = (sc.depthDefs || []).length;
  h += _row(
    "Core data depth",
    nHave +
      " / " +
      nTot +
      (sc.dataDepth != null
        ? " (" + (sc.dataDepth * 100).toFixed(0) + "%)"
        : ""),
  );
  h +=
    '<div style="border-top:1px solid var(--border);margin:6px 0;padding-top:2px"></div>';
  (sc.depthDefs || []).forEach((d) => {
    h +=
      '<div style="display:flex;justify-content:space-between;gap:14px"><span class="mini">' +
      d[0] +
      '</span><span style="font-family:var(--mono);color:' +
      (d[1] ? "var(--success)" : "var(--error)") +
      '">' +
      (d[1] ? "\u2713" : "\u2717") +
      "</span></div>";
  });
  if (sc.convScore != null) {
    h +=
      '<div style="border-top:1px solid var(--border);margin:6px 0;padding-top:2px"></div>';
    h += _row(
      "<b>Conviction score</b>",
      "<b>" + (sc.convScore * 100).toFixed(0) + "%</b>",
    );
    h +=
      '<div class="mini" style="margin-top:4px;color:var(--muted)">Thresholds: High \u2265 80% \u00B7 Medium \u2265 55% \u00B7 else Low. Missing core inputs cap conviction even when weighted coverage looks high.</div>';
  }
  // \u2500\u2500 Earnings quality flags \u2500\u2500
  if (sc && sc.eqFlags && sc.eqFlags.length) {
    h +=
      '<div style="border-top:1px solid var(--border);margin:6px 0;padding-top:4px;color:var(--warn);font-weight:600">\u26a0 Quality red flags</div>';
    sc.eqFlags.forEach((f) => {
      h += _row(f, "", "neg");
    });
    h +=
      '<div class="mini" style="color:var(--muted)">These penalize the quality sub-score and may block BUY signals.</div>';
  }
  return h;
}

function fairValueTipHTML(m, ticker) {
  const fv = fairValue(m);
  const parts = fairValueParts(m);
  let h = _tipHead("Fair value \u00B7 " + (ticker || ""));
  if (!parts.length) {
    h += '<div class="mini">Not enough data \u2014 using last price.</div>';
    return h;
  }
  h +=
    '<div class="mini" style="color:var(--text2);margin-bottom:2px">Blend of ' +
    parts.length +
    " anchor" +
    (parts.length === 1 ? "" : "s") +
    " (outliers trimmed):</div>";
  parts.forEach((pr) => {
    h += _tipRow(pr[0], money(pr[1]));
  });
  h += _tipRule();
  h += _tipRow(
    '<b>Fair value</b> <span class="mini">(mean)</span>',
    "<b>" + (fv != null ? money(fv) : "\u2014") + " MAD</b>",
  );
  return h;
}
function upsideTipHTML(r) {
  const m = r.m,
    fv = r._tb && r._tb.fv != null ? r._tb.fv : fairValue(m);
  const up =
    fv != null && r.price != null && r.price > 0
      ? ((fv - r.price) / r.price) * 100
      : null;
  let h = _tipHead("Upside to fair value \u00B7 " + r.ticker);
  h += _tipRow(
    "Current price",
    (r.price != null ? money(r.price) : "\u2014") + " MAD",
  );
  h += _tipRow("Fair value", (fv != null ? money(fv) : "\u2014") + " MAD");
  h += _tipRule();
  const parts = fairValueParts(m);
  if (parts.length) {
    h +=
      '<div class="mini" style="color:var(--text2);margin-bottom:2px">Fair value = mean of:</div>';
    parts.forEach((pr) => {
      h += _tipRow(pr[0], money(pr[1]));
    });
    h += _tipRule();
  }
  h += _tipRow(
    '<b>Upside</b> <span class="mini">((fair\u2212price)/price)</span>',
    '<b class="' +
      (up != null && up >= 0 ? "pos" : "neg") +
      '">' +
      (up != null ? (up >= 0 ? "+" : "") + up.toFixed(1) + "%" : "\u2014") +
      "</b>",
  );
  return h;
}
function pirTipHTML(r) {
  const m = r.m;
  let h = _tipHead("Position in 52-wk range \u00B7 " + r.ticker);
  h += _tipRow("52-wk low", (num(m.low) ? money(m.low) : "\u2014") + " MAD");
  h += _tipRow(
    "Current price",
    (r.price != null ? money(r.price) : "\u2014") + " MAD",
  );
  h += _tipRow("52-wk high", (num(m.high) ? money(m.high) : "\u2014") + " MAD");
  h += _tipRule();
  h += _tipRow(
    '<b>Position</b> <span class="mini">((px\u2212low)/(high\u2212low))</span>',
    "<b>" + (r.pir != null ? pct(r.pir) : "\u2014") + "</b>",
  );
  h +=
    '<div class="mini" style="margin-top:6px">0% = at the 52-wk low (cheap end of its band) \u00B7 100% = at the high.</div>';
  return h;
}
function peTipHTML(r) {
  const m = r.m;
  const epsAbs = num(m.eps) && m.eps > 0;
  const eps = epsAbs ? m.eps : num(m.pe) && m.pe > 0 ? m.price / m.pe : null;
  let h = _tipHead("Price / Earnings \u00B7 " + r.ticker);
  h += _tipRow("Price", (r.price != null ? money(r.price) : "\u2014") + " MAD");
  if (eps != null)
    h += _tipRow(
      'EPS <span class="mini">(' +
        (epsAbs ? "reported" : "price/PE") +
        ")</span>",
      money(eps) + " MAD",
    );
  h += _tipRule();
  h += _tipRow(
    "<b>P/E</b>",
    "<b>" + (r.pe != null ? money(r.pe, 1) : "\u2014") + "</b>",
  );
  const pr = sectorProfile(m.cat);
  h +=
    '<div class="mini" style="margin-top:6px">Sector-fair P/E \u2248 ' +
    pr.peFair +
    ". Lower than fair = cheaper on earnings.</div>";
  return h;
}
function divyTipHTML(r) {
  const m = r.m;
  const dpsAbs = num(m.dps) && m.dps > 0;
  const dps = dpsAbs
    ? m.dps
    : num(m.divy) && m.divy > 0
      ? m.price * m.divy
      : null;
  let h = _tipHead("Dividend yield \u00B7 " + r.ticker);
  h += _tipRow("Price", (r.price != null ? money(r.price) : "\u2014") + " MAD");
  if (dps != null)
    h += _tipRow(
      'Div / share <span class="mini">(price\u00D7yield)</span>',
      money(dps) + " MAD",
    );
  h += _tipRule();
  h += _tipRow(
    "<b>Yield</b>",
    "<b>" + (r.divy != null ? pct(r.divy) : "\u2014") + "</b>",
  );
  const pr = sectorProfile(m.cat);
  h +=
    '<div class="mini" style="margin-top:6px">Sector-fair yield \u2248 ' +
    (pr.dyFair * 100).toFixed(1) +
    "%. Higher = more income per MAD.</div>";
  return h;
}
function priceTipHTML(r) {
  const m = r.m;
  let h = _tipHead("Last price \u00B7 " + r.ticker);
  h += _tipRow("Price", (r.price != null ? money(r.price) : "\u2014") + " MAD");
  if (num(m.low) && num(m.high)) {
    h += _tipRow("52-wk low", money(m.low));
    h += _tipRow("52-wk high", money(m.high));
  }
  return h;
}

// Reusable peer-relative valuation tooltip (shared by the Signals breakdown and Top Buys cards).
function peerTipHTML(r) {
  const m = r.m,
    sc = r.sc;
  const row = _tipRow; // shared tooltip row builder (gap:18px)
  let h = `<div style="font-weight:700;margin-bottom:6px">Peer-relative valuation \u00B7 ${escapeHtml(r.ticker)}</div>`;
  const pf = sc && sc.parts && sc.parts.peerrel;
  if (!pf || pf.s == null || !pf._n) {
    h +=
      '<div class="mini" style="color:var(--muted)">No comparable peers with valuation data \u2014 peer signal not used for this stock.</div>';
    return h;
  }
  const st = typeof sectorStats === "function" ? sectorStats() : null;
  const cat = m.cat || "Uncategorized";
  const key =
    typeof sectorProfile === "function" ? sectorProfile(m.cat).key : null;
  const ref = st
    ? pf._basis === "category"
      ? st.cat && st.cat[cat]
      : st.prof && st.prof[key]
    : null;
  const basisLbl =
    pf._basis === "category"
      ? "same category (" + escapeHtml(cat) + ")"
      : "broad sector (" + (sc.profile || key) + ")";
  h += row("Compared against", "<b>" + basisLbl + "</b>");
  h += row(
    "Comparables used",
    "<b>" +
      pf._n +
      "</b>" +
      (pf._n < 4
        ? ' <span class="mini neg">(thin \u2014 down-weighted)</span>'
        : ""),
  );
  if (ref) {
    if (ref.pe != null)
      h += row(
        "Peer median P/E",
        money(ref.pe, 1) +
          (num(m.pe) && m.pe > 0
            ? '  <span class="mini">\u00B7 you ' + money(m.pe, 1) + "</span>"
            : ""),
      );
    if (ref.pb != null)
      h += row(
        "Peer median P/B",
        money(ref.pb, 2) +
          (num(m.pb) && m.pb > 0
            ? '  <span class="mini">\u00B7 you ' + money(m.pb, 2) + "</span>"
            : ""),
      );
    if (ref.divy != null)
      h += row(
        "Peer median Div Y",
        (ref.divy * 100).toFixed(1) +
          "%" +
          (num(m.divy) && m.divy > 0
            ? '  <span class="mini">\u00B7 you ' +
              (m.divy * 100).toFixed(1) +
              "%</span>"
            : ""),
      );
  }
  const verdict =
    pf.s >= 0.6
      ? "cheaper than peers"
      : pf.s <= 0.4
        ? "pricier than peers"
        : "in line with peers";
  h +=
    '<div style="border-top:1px solid var(--border);margin:6px 0;padding-top:2px"></div>';
  h += row(
    "<b>Peer verdict</b>",
    '<b class="' +
      (pf.s >= 0.6 ? "pos" : pf.s <= 0.4 ? "neg" : "") +
      '">' +
      (pf.s * 100).toFixed(0) +
      "% \u00B7 " +
      verdict +
      "</b>",
  );
  h +=
    '<div class="mini" style="margin-top:4px;color:var(--muted)">Prefers same-category peers when \u22654 exist, else the broad sector. Fewer comparables \u2192 lower weight in the score.</div>';
  return h;
}
function signalTipHTML(r) {
  const m = r.m,
    sc = r.sc,
    fv = fairValue(m);
  const names = {
    valuation: "Valuation (EV/EBITDA)",
    safety: "Safety (Net Debt/EBITDA)",
    quality: "Quality (ROE)",
    growth: "Growth (PEG + EPS growth)",
    yield: "Yield (Div %)",
    book: "Book (P/B)",
    fcfy: "FCF Yield (FCF/Price)",
    timing: "Timing (Entry pos.)",
    momentum: "Range Position (52w)",
    peerrel: "Peer-relative (vs sector)",
  };
  const row = _tipRow; // shared tooltip row builder (gap:18px)
  let h = `<div style="font-weight:700;margin-bottom:2px">${escapeHtml(r.ticker)} \u2014 ${escapeHtml(r.name || "")}</div>`;
  h += `<div style="margin-bottom:8px"><span class="badge ${r.sig.c}">${r.sig.t}</span></div>`;
  h += `<div style="color:var(--text2);font-size:11px;margin-bottom:2px">Factor \u00B7 <b>raw value</b> \u00B7 weight \u00B7 score \u2192 contribution</div>`;
  if (sc && sc.parts) {
    // Raw metric values for each factor
    const _rawVals = {
      valuation: m.ev != null ? m.ev.toFixed(1) + "x" : null,
      safety: m.netdebt != null ? m.netdebt.toFixed(1) + "x" : null,
      quality: m.roe != null ? (m.roe * 100).toFixed(1) + "%" : null,
      growth:
        m.peg != null
          ? m.peg.toFixed(1) +
            (m.epsGrowth != null
              ? " (gr " +
                (m.epsGrowth >= 0 ? "+" : "") +
                (m.epsGrowth * 100).toFixed(0) +
                "%)"
              : "")
          : null,
      yield: m.divy != null ? (m.divy * 100).toFixed(2) + "%" : null,
      book: m.pb != null ? m.pb.toFixed(2) + "x" : null,
      fcfy:
        m.fcf != null && m.price != null && m.price > 0
          ? ((m.fcf / m.price) * 100).toFixed(1) + "%"
          : null,
      timing: sc.pir != null ? (sc.pir * 100).toFixed(0) + "%" : null,
      momentum: sc.pir != null ? (sc.pir * 100).toFixed(0) + "%" : null,
      peerrel:
        sc.parts.peerrel && sc.parts.peerrel._n
          ? sc.parts.peerrel._n + " peers"
          : null,
    };
    for (const k in sc.parts) {
      const f = sc.parts[k];
      // Skip factors that carry zero weight for this sector (e.g. FCF yield for
      // financials/REITs) - they contribute nothing and would just add a noisy
      // "0% weight -> 0%" row.
      if (!f.w) continue;
      const rv = _rawVals[k];
      const rawStr = rv ? "<b>" + rv + "</b> \u00B7 " : "";
      const s =
        f.s == null
          ? '<span style="color:var(--muted)">no data</span>'
          : (f.s * 100).toFixed(0) + "%";
      const contrib =
        f.s == null ? "" : " \u2192 " + (f.s * f.w * 100).toFixed(0) + "%";
      h += row(
        names[k] || k,
        rawStr +
          '<span class="mini">' +
          (f.w * 100).toFixed(0) +
          "%</span> \u00B7 " +
          s +
          contrib,
      );
    }
  }
  h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"></div>`;
  h += row(
    '<b>Total Score</b> <span class="mini">(\u00F7 avail. weights, correlation-adjusted)</span>',
    "<b>" +
      (sc && sc.score != null ? (sc.score * 100).toFixed(0) + "%" : "\u2014") +
      "</b>",
  );
  h += row(
    "Sector weighting profile",
    "<b>" + (sc && sc.profile ? sc.profile : "\u2014") + "</b>",
  );
  h += row(
    'Conviction <span class="mini">(data coverage ' +
      (sc && sc.wcov != null ? (sc.wcov * 100).toFixed(0) + "%" : "") +
      ")</span>",
    "<b>" + (sc && sc.conviction ? sc.conviction : "\u2014") + "</b>",
    sc && sc.conviction === "High"
      ? "pos"
      : sc && sc.conviction === "Low"
        ? "neg"
        : "",
  );
  h += `<div style="margin-top:8px"></div>`;
  h += row(
    'Fair value <span class="mini">(price-independent anchors)</span>',
    (fv != null ? money(fv) : "\u2014") + " MAD",
  );
  {
    const aps = fairValueParts(m);
    if (aps.length) {
      h += '<div class="mini" style="margin:2px 0 2px 8px;color:var(--text2)">';
      aps.forEach((a) => {
        h +=
          '<div style="display:flex;justify-content:space-between;gap:14px"><span>' +
          a[0] +
          '</span><span style="font-family:var(--mono)">' +
          money(a[1]) +
          "</span></div>";
      });
      h += "</div>";
    }
  }
  // ---- (B) Peer-relative valuation detail: what we compared against, and how many peers ----
  {
    const pf = sc && sc.parts && sc.parts.peerrel;
    if (pf && pf.s != null && pf._n) {
      const st = typeof sectorStats === "function" ? sectorStats() : null;
      const cat = m.cat || "Uncategorized";
      const key =
        typeof sectorProfile === "function" ? sectorProfile(m.cat).key : null;
      const ref = st
        ? pf._basis === "category"
          ? st.cat && st.cat[cat]
          : st.prof && st.prof[key]
        : null;
      h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;font-weight:600">Peer-relative valuation</div>`;
      const basisLbl =
        pf._basis === "category"
          ? "same category (" + escapeHtml(cat) + ")"
          : "broad sector (" + (sc.profile || key) + ")";
      h += row("Compared against", "<b>" + basisLbl + "</b>");
      h += row(
        "Comparables used",
        "<b>" +
          pf._n +
          "</b>" +
          (pf._n < 4
            ? ' <span class="mini neg">(thin \u2014 down-weighted)</span>'
            : ""),
      );
      if (ref) {
        if (ref.pe != null)
          h += row(
            "Peer median P/E",
            money(ref.pe, 1) +
              (num(m.pe) && m.pe > 0
                ? '  <span class="mini">\u00B7 you ' +
                  money(m.pe, 1) +
                  "</span>"
                : ""),
          );
        if (ref.pb != null)
          h += row(
            "Peer median P/B",
            money(ref.pb, 2) +
              (num(m.pb) && m.pb > 0
                ? '  <span class="mini">\u00B7 you ' +
                  money(m.pb, 2) +
                  "</span>"
                : ""),
          );
        if (ref.divy != null)
          h += row(
            "Peer median Div Y",
            (ref.divy * 100).toFixed(1) +
              "%" +
              (num(m.divy) && m.divy > 0
                ? '  <span class="mini">\u00B7 you ' +
                  (m.divy * 100).toFixed(1) +
                  "%</span>"
                : ""),
          );
      }
      const verdict =
        pf.s >= 0.6
          ? "cheaper than peers"
          : pf.s <= 0.4
            ? "pricier than peers"
            : "in line with peers";
      h += row(
        "<b>Peer verdict</b>",
        '<b class="' +
          (pf.s >= 0.6 ? "pos" : pf.s <= 0.4 ? "neg" : "") +
          '">' +
          (pf.s * 100).toFixed(0) +
          "% \u00B7 " +
          verdict +
          "</b>",
      );
      h +=
        '<div class="mini" style="margin-top:4px;color:var(--muted)">Prefers same-category peers when \u22654 exist, else the broad sector. Fewer comparables \u2192 lower weight in the score.</div>';
      h += `<div style="margin-top:8px"></div>`;
    }
  }
  h += row(
    'Target Buy <span class="mini">(fair \u2212 discount)</span>',
    r.tbuy != null ? money(r.tbuy) : "\u2014",
  );
  h += row(
    'Target Sell <span class="mini">(fair + premium)</span>',
    r.tsell != null ? money(r.tsell) : "\u2014",
  );
  h += row("Current price", r.price != null ? money(r.price) : "\u2014");
  h += row("Position in range", r.pir != null ? pct(r.pir) : "\u2014");
  if (r.sig && r.sig.reasons && r.sig.reasons.length) {
    h += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;font-weight:600">Why this signal</div>`;
    h +=
      '<ul style="margin:4px 0 0;padding-left:16px">' +
      r.sig.reasons
        .map((x) => '<li style="margin:2px 0">' + x + "</li>")
        .join("") +
      "</ul>";
  }
  // \u2500\u2500 Earnings quality flags \u2500\u2500
  if (sc && sc.eqFlags && sc.eqFlags.length) {
    h +=
      '<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;font-weight:600;color:var(--warn)">\u26a0 Earnings quality concerns</div>';
    h +=
      '<ul style="margin:4px 0 0;padding-left:16px;color:var(--warn)">' +
      sc.eqFlags
        .map((f) => '<li style="margin:2px 0">' + escapeHtml(f) + "</li>")
        .join("") +
      "</ul>";
  }
  return h;
}

// Buy strength: how compelling the buy is (higher = act first).
// Combines the signal tier, the score, and how far below the buy target the price sits.
function buyStrength(r) {
  const tier =
    {
      "\uD83D\uDE80 STRONG BUY": 5,
      "\uD83D\uDCB0 BUY (Deep Value)": 4,
      "\uD83D\uDCB8 BUY (Good Value)": 3,
      "\u2753 BUY (Speculative)": 1,
    }[r.sig.t] || 2;
  const disc =
    r.tbuy && r.price != null ? Math.max(0, (r.tbuy - r.price) / r.tbuy) : 0; // deeper discount = stronger
  return tier * 100 + (r.score || 0) * 20 + disc * 40;
}
// Sell urgency: how urgent the exit is (higher = act first).
function sellUrgency(r) {
  const tier =
    r.sig.c === "b-sell"
      ? 5
      : r.sig.t.indexOf("TRIM 50") >= 0 || r.sig.t.indexOf("Well Above") >= 0
        ? 4
        : 3;
  const over =
    r.tsell && r.price != null ? Math.max(0, (r.price - r.tsell) / r.tsell) : 0; // further above target = more urgent
  const weak = 1 - (r.score || 0.5); // weaker quality = more urgent to sell
  return tier * 100 + over * 50 + weak * 20;
}
function topBuyRank(r) {
  // Composite conviction-weighted buy quality. All components normalised ~0..1.
  const tier =
    {
      "\uD83D\uDE80 STRONG BUY": 1.0,
      "\uD83D\uDCB0 BUY (Deep Value)": 0.85,
      "\uD83D\uDCB8 BUY (Good Value)": 0.7,
      "\u2753 BUY (Speculative)": 0.45,
    }[r.sig.t] || 0.6;
  const fv = fairValue(r.m);
  const disc =
    fv && r.price != null ? Math.max(0, Math.min(0.6, (fv - r.price) / fv)) : 0; // upside to fair value, capped 60%
  const sc = r.score != null ? r.score : 0.5; // factor score 0..1
  const convW = { High: 1.0, Medium: 0.8, Low: 0.55 }[r.conviction] || 0.7; // data coverage / confidence
  // weighted blend then scaled by conviction (low data confidence discounts the whole idea)
  const raw = 0.45 * tier + 0.35 * (disc / 0.6) + 0.2 * sc;
  return { rank: raw * convW, tier, disc, sc, convW, fv };
}

function renderTopBuys() {
  const wrap = document.getElementById("topBuysWrap");
  if (!wrap) return;
  const at = (document.getElementById("sigAsset") || {}).value || "stocks";
  let rows = computeSignalsRows().filter((r) => r.sig.c === "b-buy");
  if (at === "stocks") rows = rows.filter((r) => !(r.m && r.m.cat === "OPCVM"));
  else if (at === "opcvm")
    rows = rows.filter((r) => r.m && r.m.cat === "OPCVM");
  rows.forEach((r) => {
    r._tb = topBuyRank(r);
  });
  rows.sort((a, b) => b._tb.rank - a._tb.rank);
  const top = rows.slice(0, 10);
  window.__topBuys = top;
  // prune stale selections
  if (window.__tbSel) {
    const keep = {};
    top.forEach((r) => {
      if (window.__tbSel[r.ticker]) keep[r.ticker] = true;
    });
    window.__tbSel = keep;
  } else window.__tbSel = {};
  if (!top.length) {
    wrap.innerHTML =
      '<div class="sec" style="padding:12px 14px;margin:0;height:100%;display:flex;flex-direction:column"><h3 style="margin:0 0 6px">\u2B50 Top Buys</h3><div class="mini" style="color:var(--text2)">No buy signals for the current asset filter.</div></div>';
    renderTopSector();
    renderTopHeadroom();
    return;
  }
  const row = (r, i) => {
    const up =
      r._tb.fv && r.price != null
        ? ((r._tb.fv - r.price) / r.price) * 100
        : null;
    const upTxt =
      up != null ? (up >= 0 ? "+" : "") + up.toFixed(0) + "%" : "\u2014";
    const checked = window.__tbSel[r.ticker] ? "checked" : "";
    return `<div class="tb-card" style="display:flex;align-items:center;gap:7px;padding:6px 9px;border:1px solid var(--border);border-radius:9px;background:var(--panel);margin-bottom:5px" data-tip="${escapeHtml(r.name || r.ticker)} \u2014 ${
      (r.sig.reasons || [])
        .filter((x) => !/^Score\s/.test(x))
        .slice(0, 2)
        .join(" ") || "buy signal"
    }">
      <input type="checkbox" class="tb-chk" data-tk="${escapeHtml(r.ticker)}" data-act="toggleTbSel" data-args="${r.ticker},$checked" data-stop="true" ${checked} style="width:16px;height:16px;flex:none;cursor:pointer">
      <div style="font-family:var(--mono);font-weight:800;font-size:13px;color:var(--muted);width:16px;flex:none">${i + 1}</div>
      <div style="min-width:0;flex:1;cursor:pointer" data-act="prefillPending" data-args="${r.ticker}">
        <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.ticker)} <span class="badge ${r.sig.c}" style="font-size:9px">${r.sig.t}</span></div>
        <div class="mini" style="color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.name || "")}</div>
        ${aboveTgtBadge(r.price, r.tbuy) ? '<div style="margin-top:2px">' + aboveTgtBadge(r.price, r.tbuy) + "</div>" : ""}
      </div>
      <div style="text-align:right;flex:none;width:56px;cursor:help" data-tip="${tipRef(priceTipHTML(r))}"><span class="mini" style="color:var(--text2);white-space:nowrap">Price</span><br><b style="font-family:var(--mono);font-size:12px">${r.price != null ? money(r.price) : "\u2014"}</b></div>
      <div style="text-align:right;flex:none;width:56px;cursor:help" data-tip="${tipRef(upsideTipHTML(r))}"><span class="mini" style="color:var(--text2);white-space:nowrap">Upside</span><br><b class="${up != null && up > 0 ? "pos" : "neg"}" style="font-family:var(--mono);font-size:12px">${upTxt}</b></div>
      <div style="text-align:right;flex:none;width:56px;cursor:help" data-tip="${r.tbuy != null ? tipRef(tgtBuyTipHTML(r)) : ""}"><span class="mini" style="color:var(--text2);white-space:nowrap">Tgt buy</span><br><b style="font-family:var(--mono);font-size:12px">${r.tbuy != null ? money(r.tbuy) : "\u2014"}</b></div>
      <div style="text-align:right;flex:none;width:56px;${r.divy != null ? "cursor:help" : ""}" data-tip="${r.divy != null ? tipRef(divyTipHTML(r)) : ""}"><span class="mini" style="color:var(--text2);white-space:nowrap">Div Y</span><br><b class="${r.divy > 0 ? "pos" : ""}" style="font-family:var(--mono);font-size:12px">${r.divy != null ? pct(r.divy) : "\u2014"}</b></div>
      <div style="text-align:right;flex:none;width:56px;${r.sc && r.sc.parts && r.sc.parts.peerrel ? "cursor:help" : ""}" data-tip="${r.sc && r.sc.parts && r.sc.parts.peerrel ? tipRef(peerTipHTML(r)) : ""}"><span class="mini" style="color:var(--text2);white-space:nowrap">Rank</span><br><b style="font-family:var(--mono);font-size:12px">${(r._tb.rank * 100).toFixed(0)}</b></div>
    </div>`;
  };
  wrap.innerHTML = `<div class="sec" style="padding:12px 14px;margin:0;height:100%;display:flex;flex-direction:column">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;gap:10px">
      <h3 style="margin:0;white-space:nowrap">\u2B50 Top Buys <span class="mini" style="font-weight:400;color:var(--text2)">(${top.length})</span></h3>
      <span class="mini" style="color:var(--text2);text-align:right">tick names, then Draft selected</span>
    </div>
    <div style="flex:1 1 auto;min-height:0;overflow:auto;margin:-2px -2px 0;padding:2px">${top.map(row).join("")}</div>
    <div id="tbSelBar" style="display:none;align-items:center;gap:10px;margin-top:8px;padding:8px 10px;background:var(--panel2);border-radius:8px">
      <span class="mini" id="tbSelCount" style="color:var(--text2)"></span>
      <div style="flex:1"></div>
      <button class="btn sec2" data-act="clearTbSel" style="font-size:11px;padding:4px 10px">Clear</button>
      <button class="btn" data-act="openDraftSelected" style="font-size:11px;padding:4px 10px">\u2795 Draft selected</button>
    </div>
  </div>`;
  updateTbSelBar();
  renderTopSector();
  renderTopHeadroom();
}

function toggleTbSel(tk, on) {
  window.__tbSel = window.__tbSel || {};
  if (on) window.__tbSel[tk] = true;
  else delete window.__tbSel[tk];
  updateTbSelBar();
}
function clearTbSel() {
  window.__tbSel = {};
  document.querySelectorAll(".tb-chk").forEach((c) => (c.checked = false));
  updateTbSelBar();
}
function updateTbSelBar() {
  const bar = document.getElementById("tbSelBar");
  if (!bar) return;
  const n = Object.keys(window.__tbSel || {}).length;
  bar.style.display = n ? "flex" : "none";
  const c = document.getElementById("tbSelCount");
  if (c) c.textContent = n + " name" + (n === 1 ? "" : "s") + " selected";
}

// Sector allocation donut for the companion card (current holdings by sector)
let CH_topSector = null,
  CH_topCycle = null,
  CH_topStyle = null;
function renderTopSector() {
  const wrap = document.getElementById("topSectorWrap");
  if (!wrap) return;
  const { pos } = runFIFO();
  const held = Object.values(pos).filter((p) => p.held > 0 && p.value > 0);
  // Donuts exclude OPCVM funds (they have no sector/cycle/style classification);
  // OPCVM still counts in Sector Headroom below.
  const heldStocks = held.filter((p) => !((M[p.ticker] || {}).cat === "OPCVM"));
  // Build a value breakdown by any metadata field (cat/cycle/style), sorted
  // desc. The bucketing+sum is the shared sumValueByField() helper (02-compute);
  // this closure just maps it into the donut's {name,y} shape + total.
  const breakdown = (field, fallback) => {
    const by = sumValueByField(heldStocks, field, fallback);
    const total = Object.values(by).reduce((a, b) => a + b, 0);
    const data = Object.keys(by)
      .map((k) => ({ name: k, y: by[k] }))
      .sort((a, b) => b.y - a.y);
    return { data, total };
  };
  const sec = breakdown("cat", "Uncategorized");
  const cyc = breakdown("cycle", "Unclassified");
  const sty = breakdown("style", "Unclassified");
  const total = sec.total;
  if (!sec.data.length) {
    wrap.innerHTML =
      '<div class="sec" style="padding:12px 14px;margin:0;height:100%"><h3 style="margin:0 0 6px">\uD83E\uDD67 Your Mix</h3><div class="mini" style="color:var(--text2)">No holdings yet.</div></div>';
    return;
  }
  const topCat = sec.data[0],
    conc = total > 0 ? (topCat.y / total) * 100 : 0;
  const flag =
    conc >= 35
      ? '<span class="neg">\u26A0 ' +
        topCat.name +
        " " +
        conc.toFixed(0) +
        "% \u2014 concentrated</span>"
      : conc >= 25
        ? '<span style="color:var(--warn)">' +
          topCat.name +
          " " +
          conc.toFixed(0) +
          "% (top sector)</span>"
        : '<span class="pos">Well spread \u2014 top ' +
          topCat.name +
          " " +
          conc.toFixed(0) +
          "%</span>";

  // Compact donut column: small heading + chart div. The three sit side-by-side in a grid.
  const donutCol = (
    id,
    emoji,
    title,
    n,
  ) => `<div style="min-width:0;display:flex;flex-direction:column">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;margin:0 0 2px">
        <h3 style="margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px">${emoji} ${title}</h3>
        <span class="mini" style="color:var(--text2);flex:none">${n}</span>
      </div>
      <div id="${id}" style="height:180px"></div>
    </div>`;

  wrap.innerHTML = `<div class="sec" style="padding:12px 14px;margin:0;height:100%;display:flex;flex-direction:column">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;gap:8px">
      <h3 style="margin:0;white-space:nowrap">\uD83E\uDD67 Your Mix</h3>
      <span class="mini" style="color:var(--text2)">${money(total, 0)} MAD</span>
    </div>
    <div class="mini" style="margin-bottom:6px">${flag}</div>
    <div style="flex:1;min-height:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;align-items:start">
      ${donutCol("topSectorChart", "\uD83C\uDFE6", "By Sector", sec.data.length)}
      ${donutCol("topCycleChart", "\uD83D\uDD04", "By Cycle", cyc.data.length)}
      ${donutCol("topStyleChart", "\uD83C\uDFA8", "By Asset Style", sty.data.length)}
    </div>
  </div>`;
  const tx = themeColor("text");
  const donut = (id, data, h) => {
    try {
      return Highcharts.chart(id, {
        chart: { type: "pie", backgroundColor: "transparent", height: h },
        title: { text: null },
        credits: { enabled: false },
        legend: { enabled: false },
        tooltip: {
          pointFormat: "<b>{point.y:,.0f} MAD</b> ({point.percentage:.1f}%)",
        },
        plotOptions: {
          pie: {
            innerSize: "56%",
            dataLabels: {
              enabled: true,
              style: { color: tx, fontSize: "10px", textOutline: "none" },
              format: "{point.name}: {point.percentage:.0f}%",
              distance: 6,
              connectorWidth: 1,
            },
          },
        },
        series: [{ name: "Value", data: data }],
      });
    } catch (e) {
      console.error(id, e);
      return null;
    }
  };
  CH_topSector = donut("topSectorChart", sec.data, 180);
  CH_topCycle = donut("topCycleChart", cyc.data, 180);
  CH_topStyle = donut("topStyleChart", sty.data, 180);
}

// Sector headroom card (card 3) \u2014 current sector weight vs the concentration cap set on the Rebalance tab.
function renderTopHeadroom() {
  const wrap = document.getElementById("topHeadroomWrap");
  if (!wrap) return;
  const { pos } = runFIFO();
  const held = Object.values(pos).filter((p) => p.held > 0 && p.value > 0);
  const byCat = {};
  held.forEach((p) => {
    const cat = (M[p.ticker] && M[p.ticker].cat) || "Uncategorized";
    byCat[cat] = (byCat[cat] || 0) + p.value;
  });
  const total = Object.values(byCat).reduce((a, b) => a + b, 0);
  const data = Object.keys(byCat)
    .map((k) => ({ name: k, y: byCat[k] }))
    .sort((a, b) => b.y - a.y);
  const capPct = Math.min(
    60,
    Math.max(
      5,
      parseFloat((document.getElementById("rbCap") || {}).value) ||
        RB_CAP_DEFAULTS.cap,
    ),
  );
  const capOpcvm = Math.min(
    80,
    Math.max(
      5,
      parseFloat((document.getElementById("rbCapOpcvm") || {}).value) ||
        RB_CAP_DEFAULTS.opcvm,
    ),
  );
  const capForP = (cat) => (cat === "OPCVM" ? capOpcvm : capPct);
  if (!data.length) {
    wrap.innerHTML =
      '<div class="sec" style="padding:12px 14px;margin:0;height:100%;display:flex;flex-direction:column"><h3 style="margin:0 0 6px">\uD83D\uDCCA Sector Headroom</h3><div class="mini" style="color:var(--text2)">No holdings yet.</div></div>';
    return;
  }
  // sorted by current weight, highest first (matches the Sector Mix ordering)
  const rowsData = data
    .map((d) => {
      const cap = capForP(d.name);
      const w = total > 0 ? (d.y / total) * 100 : 0;
      return { name: d.name, w, cap, room: cap - w };
    })
    .sort((a, b) => b.w - a.w); // highest current weight first
  const overN = rowsData.filter((r) => r.w > r.cap + 1e-9).length;
  const nearN = rowsData.filter(
    (r) => r.w <= r.cap + 1e-9 && r.w >= r.cap * 0.8,
  ).length;
  const flag = overN
    ? '<span class="neg">\u26A0 ' +
      overN +
      " sector" +
      (overN === 1 ? "" : "s") +
      " over cap</span>"
    : nearN
      ? '<span style="color:var(--warn)">' +
        nearN +
        " near cap (\u226580%)</span>"
      : '<span class="pos">All sectors within cap</span>';
  const hrRows = rowsData
    .map((d) => {
      const fill = Math.min(100, d.cap > 0 ? (d.w / d.cap) * 100 : 0);
      const over = d.w > d.cap + 1e-9;
      const near = !over && d.w >= d.cap * 0.8;
      const col = over
        ? "var(--error)"
        : near
          ? "var(--warn)"
          : "var(--success)";
      const capTag =
        d.name === "OPCVM"
          ? ' <span class="mini" style="color:var(--text2)">(fund cap)</span>'
          : "";
      const roomTxt = over
        ? "+" + (d.w - d.cap).toFixed(0) + "% over"
        : d.room.toFixed(0) + "% room";
      return `<div style="margin-bottom:7px" data-tip="${escapeHtml(d.name)}: ${d.w.toFixed(1)}% of portfolio vs ${d.cap.toFixed(0)}% cap \u2014 ${over ? "over the cap by " + (d.w - d.cap).toFixed(1) + " pts" : d.room.toFixed(1) + " pts of headroom before the cap"}">
      <div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;margin-bottom:2px">
        <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(d.name)}${capTag}</span>
        <span style="font-family:var(--mono);color:${col};flex:none">${d.w.toFixed(0)}% \u00B7 ${roomTxt}</span>
      </div>
      <div style="position:relative;height:7px;border-radius:5px;background:var(--panel2);overflow:hidden">
        <div style="position:absolute;left:0;top:0;bottom:0;width:${fill}%;background:${col};border-radius:5px;transition:width .3s"></div>
      </div>
    </div>`;
    })
    .join("");
  wrap.innerHTML = `<div class="sec" style="padding:12px 14px;margin:0;height:100%;display:flex;flex-direction:column">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;gap:8px">
      <h3 style="margin:0;white-space:nowrap">\uD83D\uDCCA Sector Headroom</h3>
      <span class="mini" style="color:var(--text2);cursor:help" data-tip="Each bar shows a sector's current share of your portfolio against the concentration cap set on the Rebalance tab. Green = room to add \u00B7 amber = getting close (\u226580% of cap) \u00B7 red = over the cap. OPCVM funds use a separate, higher cap.">vs ${capPct.toFixed(0)}% \u00B7 OPCVM ${capOpcvm.toFixed(0)}% \u24D8</span>
    </div>
    <div class="mini" style="margin-bottom:6px">${flag}</div>
    <div style="flex:1;min-height:0;overflow:auto">${hrRows}</div>
    <div class="mini" style="color:var(--text2);margin-top:6px;text-align:right"><a href="#" data-act="gotoTab" data-args="rebalance" style="color:var(--info)">Adjust cap \u2192</a></div>
  </div>`;
}

// ============================================================
// Signals tab render + signal-outcome scorecard (moved from 06-features.js).
// renderSignals() builds the Signals table; the SIGHIST_* block records a
// dated snapshot of every call and renderSignalOutcomes() grades them.
// ============================================================
function renderSignals() {
  try {
    renderTopBuys();
  } catch (e) {
    console.error("topBuys", e);
  }
  const f = document.getElementById("sigFilter").value;
  const at = (document.getElementById("sigAsset") || {}).value || "stocks";
  let rows = computeSignalsRows();
  if (at === "stocks") rows = rows.filter((r) => !(r.m && r.m.cat === "OPCVM"));
  else if (at === "opcvm")
    rows = rows.filter((r) => r.m && r.m.cat === "OPCVM");
  if (f === "buy") rows = rows.filter((r) => r.sig.c === "b-buy");
  else if (f === "sell")
    rows = rows.filter((r) => r.sig.c === "b-sell" || r.sig.c === "b-trim");
  else if (f === "held") rows = rows.filter((r) => r.held);
  // Free-text search across ticker + name (case-insensitive).
  const _sq = ((document.getElementById("sigSearch") || {}).value || "")
    .trim()
    .toLowerCase();
  if (_sq)
    rows = rows.filter((r) =>
      ((r.ticker || "") + " " + (r.name || "")).toLowerCase().includes(_sq),
    );
  // If the user hasn't clicked a column header, sort by SIGNAL STRENGTH for the active filter:
  //   Buy filter  -> strongest buys first;  Sell filter -> most urgent sells first.
  const userSorted = typeof SIG_SORT !== "undefined" && SIG_SORT.userSet;
  // Group rank for the "All" view: Buys first, then Wait/Hold, then Sells/Trims.
  const groupRank = (r) =>
    r.sig.c === "b-buy"
      ? 0
      : r.sig.c === "b-wait" || r.sig.c === "b-hold"
        ? 1
        : 2;
  if (!userSorted && f === "buy") {
    rows.sort((a, b) => buyStrength(b) - buyStrength(a));
  } else if (!userSorted && f === "sell") {
    rows.sort((a, b) => sellUrgency(b) - sellUrgency(a));
  } else if (!userSorted && (f === "all" || f === "held")) {
    // Ranked: strongest buys \u2192 holds/waits \u2192 most urgent sells.
    // Within the middle "Hold / Wait" band, cluster identical signal labels together
    // (all HOLDs, then WAITs, then AVOIDs) so the list doesn't visually zig-zag between
    // labels; within each label, best score first. (Rows are score-ranked overall, but
    // grouping like-labels makes the ordering read cleanly.)
    const midLabelRank = (r) => {
      const t = (r.sig && r.sig.t) || "";
      if (t.indexOf("HOLD") >= 0) return 0; // fairly valued
      if (t.indexOf("WAIT") >= 0) return 1; // cheap-ish but wait for entry
      if (t.indexOf("AVOID") >= 0) return 2; // rich / overvalued / weak
      return 3; // any other wait/hold variant
    };
    rows.sort((a, b) => {
      const ga = groupRank(a),
        gb = groupRank(b);
      if (ga !== gb) return ga - gb;
      if (ga === 0) return buyStrength(b) - buyStrength(a); // buys: strongest first
      if (ga === 2) return sellUrgency(b) - sellUrgency(a); // sells: most urgent first
      const la = midLabelRank(a),
        lb = midLabelRank(b); // holds/waits: cluster by label\u2026
      if (la !== lb) return la - lb;
      return (b.score || 0) - (a.score || 0); // \u2026then best score first within a label
    });
  } else {
    const k =
      typeof SIG_SORT !== "undefined" && SIG_SORT.k ? SIG_SORT.k : "score";
    const d = typeof SIG_SORT !== "undefined" ? SIG_SORT.d : -1;
    rows.sort((a, b) => {
      let x = a[k],
        y = b[k];
      if (typeof x === "string")
        return d * String(x).localeCompare(String(y || ""));
      return d * ((x || 0) - (y || 0));
    });
  }
  window._sigRows = {};
  rows.forEach((r) => (window._sigRows[r.ticker] = r));
  // Group dividers only in the ranked (non-user-sorted) All/Held views
  const showDividers = !userSorted && (f === "all" || f === "held");
  const grpLabel = (r) =>
    r.sig.c === "b-buy"
      ? "\uD83D\uDFE2 Buy Opportunities"
      : r.sig.c === "b-wait" || r.sig.c === "b-hold"
        ? "\u26AA Hold / Wait"
        : "\uD83D\uDD34 Sell / Trim";
  const divider = (txt) =>
    `<tr><td colspan="12" style="background:var(--panel2);color:var(--text2);font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:7px 10px">${txt}</td></tr>`;
  let lastGrp = null;
  const rowHtml = (r) => `<tr class="${r.held ? "held-row" : ""} sig-row">
    <td class="l" style="cursor:pointer" data-tip="Click to draft a pending order for ${escapeHtml(r.ticker)}" data-act="prefillPending" data-args="${r.ticker}" data-stop="true">${tickerBadge(r.ticker)}<b style="color:var(--primary2)">${escapeHtml(r.ticker)}</b>${r.held ? ' <span class="tag-in">held</span>' : ""}</td>
    <td class="l" style="cursor:pointer;color:var(--text2)" data-tip="Click for full company details" data-act="showCompanyDetail" data-args="${r.ticker}" data-stop="true">${escapeHtml(r.name || "")}</td>
    <td class="center nis-cell" style="cursor:help" data-tip="${tipRef(signalTipHTML(r))}"><span class="badge ${r.sig.c}">${r.sig.t}</span> <span style="color:var(--muted)">\u24D8</span></td>
    <td class="${r.price != null ? "nis-cell" : ""}" style="${r.price != null ? "cursor:help" : ""}" data-tip="${r.price != null ? tipRef(priceTipHTML(r)) : ""}">${r.price != null ? money(r.price) : "\u2014"}${r.price != null && r.fv != null && r.fv > 0 ? (r.price < r.fv ? ' <span style=\"color:var(--success)\" title=\"Below fair value\">\u25B2</span>' : r.price > r.fv ? ' <span style=\"color:var(--error)\" title=\"Above fair value\">\u25BC</span>' : "") : ""}</td><td class="${r.fv != null ? "nis-cell" : ""}" style="${r.fv != null ? "cursor:help" : ""}" data-tip="${r.fv != null ? tipRef(fvTipHTML(r)) : ""}">${r.fv != null ? money(r.fv) : "\u2014"}</td>
    <td class="${r.tbuy != null ? "nis-cell" : ""}" style="${r.tbuy != null ? "cursor:help" : ""}" data-tip="${r.tbuy != null ? tipRef(tgtBuyTipHTML(r)) : ""}">${r.tbuy != null ? money(r.tbuy) : "\u2014"}</td>
    <td class="${r.tsell != null ? "nis-cell" : ""}" style="${r.tsell != null ? "cursor:help" : ""}" data-tip="${r.tsell != null ? tipRef(tgtSellTipHTML(r)) : ""}">${r.tsell != null ? money(r.tsell) : "\u2014"}</td>
    <td class="${r.score != null ? "nis-cell" : ""}" style="${r.score != null ? "cursor:help" : ""}" data-tip="${r.score != null ? tipRef(scoreTipHTML(r)) : ""}">${r.score != null ? (r.score * 100).toFixed(0) + "%" : "\u2014"}</td>
    <td class="center ${r.sc ? "nis-cell" : ""}" style="${r.sc ? "cursor:help" : ""}" data-tip="${r.sc ? tipRef(convTipHTML(r)) : ""}">${r.conviction ? `<span class="chip" style="background:${r.conviction === "High" ? "rgba(34,197,94,.15);color:var(--success)" : r.conviction === "Medium" ? "rgba(245,158,11,.15);color:var(--warn)" : "rgba(239,68,68,.15);color:var(--error)"}">${r.conviction}</span>` : "\u2014"}</td>
    <td class="${r.pir != null ? "nis-cell" : ""}" style="${r.pir != null ? "cursor:help" : ""}" data-tip="${r.pir != null ? tipRef(pirTipHTML(r)) : ""}">${r.pir != null ? pct(r.pir) : "\u2014"}</td><td class="${r.pe != null ? "nis-cell" : ""}" style="${r.pe != null ? "cursor:help" : ""}" data-tip="${r.pe != null ? tipRef(peTipHTML(r)) : ""}">${r.pe != null ? money(r.pe, 1) : "\u2014"}</td>
    <td class="${r.divy != null ? "nis-cell" : ""}" style="${r.divy != null ? "cursor:help" : ""}" data-tip="${r.divy != null ? tipRef(divyTipHTML(r)) : ""}">${r.divy != null ? pct(r.divy) : "\u2014"}</td></tr>`;
  const _tb = rows
    .map((r) => {
      let out = "";
      if (showDividers) {
        const g = grpLabel(r);
        if (g !== lastGrp) {
          out += divider(g);
          lastGrp = g;
        }
      }
      return out + rowHtml(r);
    })
    .join("");
  document.querySelector("#sigTable tbody").innerHTML =
    _tb ||
    `<tr><td colspan="12" class="l" style="color:var(--muted);padding:14px">${_sq ? "No opportunities match \u201c" + escapeHtml(_sq) + "\u201d." : "No opportunities."}</td></tr>`;
  // Signal-outcome tracking: snapshot today's signals (once/day) so the trail
  // keeps feeding. The outcome PANEL now lives in its own "Scorecard" tab
  // (#signalOutcomes) and is rendered when that tab opens - not here - so the
  // Signals table stays lean. Wrapped in try so it can never break the table.
  try {
    recordSignalSnapshot(computeSignalsRows());
  } catch (e) {
    console.error("sig snapshot", e);
  }
  // If the Scorecard tab is currently open, refresh its panel too (e.g. the
  // user re-runs signals while viewing it). Otherwise this is a cheap no-op.
  try {
    const scv = document.getElementById("signalOutcomes");
    if (scv && scv.classList.contains("active")) renderSignalOutcomes();
  } catch (e) {
    console.error("sig outcomes", e);
  }
}

// \u2500\u2500 SIGNAL-OUTCOME TRACKING \u2500\u2500
// Persists a dated snapshot of each ticker's signal + price so we can later
// measure whether the engine's calls actually worked (did Buy-rated names rise
// more than Avoid-rated ones?). This is the feedback loop a factor model needs.
const SIGHIST_LS = "casa_signal_hist_v1";
function loadSigHist() {
  try {
    const raw = localStorage.getItem(SIGHIST_LS);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}
function saveSigHist(arr) {
  try {
    if (safeSetItem(SIGHIST_LS, JSON.stringify(arr))) markSaved();
  } catch (e) {}
}
// Bucket a signal class into buy / neutral / sell for aggregate outcome stats.
function _sigBucket(sigC) {
  if (sigC === "b-buy") return "buy";
  if (sigC === "b-sell" || sigC === "b-trim") return "sell";
  return "neutral";
}
// Append one snapshot per ranked ticker, at most once per calendar day. A day
// with an existing snapshot for a ticker is skipped (idempotent re-renders).
function recordSignalSnapshot(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const today = new Date().toISOString().slice(0, 10);
  const hist = loadSigHist();
  // LATEST-of-day wins: index today's existing entry per ticker so a re-snapshot
  // (e.g. after importing fresh prices in the Data tab) OVERWRITES it in place
  // with the newer values, rather than being skipped. One snapshot per ticker
  // per day, always reflecting the most recent data you loaded that day.
  const todayIdx = {};
  for (let i = 0; i < hist.length; i++) {
    if (hist[i].date === today) todayIdx[hist[i].ticker] = i;
  }
  let changed = 0;
  for (const r of rows) {
    if (!r || !r.ticker || r.price == null) continue;
    const rec = {
      date: today,
      ticker: r.ticker,
      sig: (r.sig && r.sig.c) || "",
      label: (r.sig && r.sig.t) || "",
      score: r.score != null ? r.score : null,
      price: r.price,
      fv: r.fv != null ? r.fv : null,
    };
    const at = todayIdx[r.ticker];
    if (at != null)
      hist[at] = rec; // overwrite today's entry (latest wins)
    else {
      todayIdx[r.ticker] = hist.length;
      hist.push(rec);
    }
    changed++;
  }
  // Cap history so it can't grow unbounded (keep ~2y of daily snapshots).
  const MAX = 20000;
  if (hist.length > MAX) hist.splice(0, hist.length - MAX);
  if (changed) saveSigHist(hist);
}
// Take a signal snapshot right now (used by the Data-tab importers, which is the
// most accurate trigger - the snapshot reflects the prices just loaded).
// Guarded so it can never break an import; latest-of-day overwrites earlier.
function snapshotSignalsNow() {
  try {
    if (typeof computeSignalsRows === "function")
      recordSignalSnapshot(computeSignalsRows());
  } catch (e) {
    console.error("sig snapshot (import)", e);
  }
}
// Build the outcome panel: for snapshots older than a horizon, compare the
// signal-time price to the CURRENT price and aggregate return by signal bucket.
function renderSignalOutcomes() {
  const host = document.getElementById("sigOutcomes");
  if (!host) return;
  const hist = loadSigHist();
  const today = new Date();
  const horizonDays = 30; // only judge calls at least this old
  // Prices now come from the DAILY REPO HISTORY (price-history.json) when
  // available, so outcomes densify hands-off (no app-open needed) and the
  // "price then" is the actual close on the call date, not whatever was cached
  // in the browser trail. Falls back to the trail's stored price / live M price
  // when history is absent. The trail is still the source of the signal LABEL
  // per date (only the browser knows what the engine rated when).
  const _ph = typeof getPriceHistory === "function" ? getPriceHistory() : null;
  if (typeof loadPriceHistory === "function") {
    try {
      loadPriceHistory();
    } catch (_e) {}
  }
  const _VH = typeof __core !== "undefined" ? __core.valueHistory : null;
  // Current price: latest close from history, else live master price.
  const curPrice = (tk) => {
    if (_ph && _VH) {
      const c = _VH.latestClose(_ph, tk);
      if (c != null) return c;
    }
    return M[tk] && M[tk].price != null ? M[tk].price : null;
  };
  // Price on a call date: close on/before that date from history, else the
  // price the trail recorded at call time.
  const priceThen = (h) => {
    if (_ph && _VH) {
      const c = _VH.closeOnOrBefore(_ph, h.ticker, h.date);
      if (c != null) return c;
    }
    return h.price != null ? h.price : null;
  };
  // OPCVM funds are excluded from the scorecard: the signal engine doesn't
  // produce a fair-value / Buy-Sell call for funds (they're NAV-priced baskets),
  // so grading them as "signal calls" is meaningless. Skip any ticker currently
  // categorised OPCVM. (Historic fund snapshots in the trail are simply ignored.)
  const _isFundTk = (tk) =>
    typeof M !== "undefined" && M[tk] && M[tk].cat === "OPCVM";
  // Keep, per ticker, the OLDEST snapshot that is at least `horizonDays` old,
  // so each name is judged on its earliest qualifying call (longest track).
  const byTk = {};
  for (const h of hist) {
    const ageD = (today - new Date(h.date)) / 86400000;
    if (ageD < horizonDays) continue;
    if (_isFundTk(h.ticker)) continue; // no funds on the scorecard
    if (!byTk[h.ticker] || h.date < byTk[h.ticker].date) byTk[h.ticker] = h;
  }
  // \u2500\u2500 PER-DATE BENCHMARK \u2500\u2500
  // The benchmark for a call made on date D is the AVERAGE price change, from D
  // to now, of EVERY name snapshotted on D (regardless of its signal). Comparing
  // a name's return to this "typical stock starting the same day" isolates
  // whether the SIGNAL added value vs the market just drifting. Computed per
  // start-date so a 60-day-old call is measured against a 60-day benchmark, not
  // a 30-day one. Only names with a current price contribute.
  const benchByDate = {}; // date -> { sum, n }
  for (const s of hist) {
    if (_isFundTk(s.ticker)) continue; // funds excluded from the benchmark too
    const now0 = curPrice(s.ticker);
    const then0 = priceThen(s);
    if (now0 == null || !then0) continue;
    const r0 = (now0 - then0) / then0;
    benchByDate[s.date] = benchByDate[s.date] || { sum: 0, n: 0 };
    benchByDate[s.date].sum += r0;
    benchByDate[s.date].n += 1;
  }
  const benchFor = (dt) => {
    const b = benchByDate[dt];
    return b && b.n ? b.sum / b.n : null;
  };
  const rows = [];
  const agg = {
    buy: { n: 0, sum: 0, exSum: 0, exN: 0 },
    neutral: { n: 0, sum: 0, exSum: 0, exN: 0 },
    sell: { n: 0, sum: 0, exSum: 0, exN: 0 },
  };
  let allSum = 0,
    allN = 0; // overall benchmark across judged names
  for (const tk in byTk) {
    const h = byTk[tk];
    const now = curPrice(tk);
    const then = priceThen(h); // close on the call date (repo history) or trail
    if (now == null || !then) continue;
    const ret = (now - then) / then; // price change since the call
    const bench = benchFor(h.date); // typical name starting the same day
    const excess = bench != null ? ret - bench : null; // signal value-add
    const bucket = _sigBucket(h.sig);
    agg[bucket].n++;
    agg[bucket].sum += ret;
    if (excess != null) {
      agg[bucket].exSum += excess;
      agg[bucket].exN++;
    }
    allSum += ret;
    allN++;
    rows.push({ tk, h, now, then, ret, bench, excess, bucket });
  }
  if (!rows.length) {
    // Nothing is judgeable yet. Be specific about WHY: if signals have been
    // recorded but none has reached the 30-day horizon, show the oldest call's
    // age and the date the first outcome will appear - far more useful than a
    // generic "come back later". If there are no recorded signals at all, say so.
    let msg;
    // Count only STOCK snapshots (funds are excluded from the scorecard), so
    // the "X recorded / oldest N days" line matches what this panel can show.
    const stockHist = hist.filter((h) => !_isFundTk(h.ticker));
    if (stockHist.length) {
      const oldest = stockHist.reduce(
        (m, h) => (m == null || h.date < m ? h.date : m),
        null,
      );
      const ageOldest = Math.floor((today - new Date(oldest)) / 86400000);
      const readyOn = new Date(
        new Date(oldest).getTime() + horizonDays * 86400000,
      )
        .toISOString()
        .slice(0, 10);
      msg =
        "Signal-outcome tracking is on \u2014 <b>" +
        stockHist.length +
        "</b> stock signal snapshot(s) recorded, oldest <b>" +
        ageOldest +
        " day(s)</b> old. Calls are judged once they reach <b>" +
        horizonDays +
        " days</b>, so the first outcomes appear around <b>" +
        readyOn +
        "</b>. (Prices update automatically from the daily repo history \u2014 no need to keep the app open.)";
    } else {
      msg =
        "Signal-outcome tracking is on. Open the Signals tab periodically so calls get recorded; once a call is at least " +
        horizonDays +
        " days old this panel scores how Buy / Hold / Sell calls performed since. (Prices update automatically from the daily repo history \u2014 no need to keep the app open.)";
    }
    host.innerHTML =
      '<div class="mini" style="color:var(--muted)">' + msg + "</div>";
    return;
  }
  // Sort by EXCESS return (signal value-add) when available, else raw return.
  rows.sort((a, b) => {
    const ax = a.excess != null ? a.excess : a.ret;
    const bx = b.excess != null ? b.excess : b.ret;
    return bx - ax;
  });
  const pctS = (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%";
  const cls = (x) => (x > 0.0001 ? "pos" : x < -0.0001 ? "neg" : "");
  const avg = (b) => (b.n ? b.sum / b.n : null);
  const exAvg = (b) => (b.exN ? b.exSum / b.exN : null);
  const overallBench = allN ? allSum / allN : null;
  // Days a call has been tracked (call date -> today), for the tooltips.
  const ageOf = (dt) => Math.round((today - new Date(dt)) / 86400000);
  // Local aliases to the shared tooltip builders (js/01b-tooltip.js). `note`
  // keeps a scorecard-specific max-width, so it stays a local variant.
  const tHead = _tipHead;
  const tRow = _tipRow;
  const tRule = _tipRule;
  const note = (t) =>
    `<div class="mini" style="color:var(--text2);margin-top:6px;max-width:280px;white-space:normal">${t}</div>`;

  // \u2500\u2500 PER-CELL TOOLTIP BUILDERS (explain how each number is derived) \u2500\u2500
  // "Call" cell: what was rated, when, and how old the call is now.
  const tipCall = (x) =>
    tHead("The call \u00B7 " + escapeHtml(x.tk)) +
    tRow(
      "Rated",
      "<b>" + escapeHtml(x.h.label || x.h.sig || "\u2014") + "</b>",
    ) +
    tRow("On", escapeHtml(x.h.date)) +
    tRow("Tracked for", ageOf(x.h.date) + " days") +
    (x.h.score != null
      ? tRow("Score that day", Math.round(x.h.score * 100) + "%")
      : "") +
    (x.h.fv != null ? tRow("Fair value then", money(x.h.fv)) : "") +
    note(
      "This is the engine's EARLIEST rating for " +
        escapeHtml(x.tk) +
        " that is now at least 30 days old \u2014 the call being graded.",
    );
  // "Price then/now" cells: where the two prices came from.
  const tipPrices = (x) =>
    tHead("Prices \u00B7 " + escapeHtml(x.tk)) +
    tRow("Price on " + escapeHtml(x.h.date), money(x.then)) +
    tRow("Price now", money(x.now)) +
    tRule() +
    tRow(
      "<b>Change</b>",
      '<b class="' + cls(x.ret) + '">' + pctS(x.ret) + "</b>",
    ) +
    note(
      "Closes come from the daily repo price history (carried forward on non-trading days), so this updates hands-off. Price-only \u2014 excludes dividends &amp; fees.",
    );
  // "Change" cell: the raw return arithmetic spelled out.
  const tipChange = (x) =>
    tHead("Change since the call \u00B7 " + escapeHtml(x.tk)) +
    tRow("Price then", money(x.then)) +
    tRow("Price now", money(x.now)) +
    tRule() +
    tRow(
      "(" +
        money(x.now) +
        " \u2212 " +
        money(x.then) +
        ") \u00F7 " +
        money(x.then),
      '<b class="' + cls(x.ret) + '">' + pctS(x.ret) + "</b>",
    ) +
    note(
      "The stock's own price move over " +
        ageOf(x.h.date) +
        " days. It does NOT yet say if the signal was good \u2014 for that, see \u201Cvs bench\u201D.",
    );
  // "vs bench" cell: the whole point - excess vs same-start-date peers.
  const tipBench = (x) => {
    if (x.excess == null)
      return (
        tHead("vs bench \u00B7 " + escapeHtml(x.tk)) +
        note(
          "No benchmark available for the start date " +
            escapeHtml(x.h.date) +
            ".",
        )
      );
    const bd = benchByDate[x.h.date];
    const peers = bd ? bd.n : 0;
    const good =
      (x.bucket === "buy" && x.excess > 0) ||
      (x.bucket === "sell" && x.excess < 0);
    const verdict =
      x.bucket === "buy"
        ? x.excess > 0
          ? "Good call \u2014 this Buy beat the market."
          : "This Buy trailed the market."
        : x.bucket === "sell"
          ? x.excess < 0
            ? "Good call \u2014 this Sell/Trim lagged the market (right to avoid)."
            : "This Sell/Trim actually rose vs the market."
          : "Hold/Wait \u2014 no action was implied.";
    return (
      tHead("vs bench \u00B7 " + escapeHtml(x.tk)) +
      tRow(
        "This name's change",
        '<span class="' + cls(x.ret) + '">' + pctS(x.ret) + "</span>",
      ) +
      tRow(
        "Avg of " +
          peers +
          " name" +
          (peers === 1 ? "" : "s") +
          " from " +
          escapeHtml(x.h.date),
        '<span class="' +
          cls(x.bench) +
          '">' +
          (x.bench != null ? pctS(x.bench) : "\u2014") +
          "</span>",
      ) +
      tRule() +
      tRow(
        "<b>Excess (value-add)</b>",
        '<b class="' +
          cls(x.excess) +
          '">' +
          pctS(x.ret) +
          " \u2212 " +
          pctS(x.bench) +
          " = " +
          pctS(x.excess) +
          "</b>",
      ) +
      note(
        "Every name snapshotted on " +
          escapeHtml(x.h.date) +
          " forms the benchmark (a \u201Ctypical stock starting that day\u201D), so this isolates the SIGNAL from the market's drift. " +
          (good ? "\u2705 " : "\u26A0\uFE0F ") +
          verdict,
      )
    );
  };
  // Bucket card now shows raw avg AND excess-vs-benchmark (the value-add).
  const aggCard = (label, b, tip) => {
    const ex = exAvg(b);
    return (
      `<div class="card nis-cell" data-tip="${tipRef(tip)}" style="cursor:help">` +
      `<div class="label">${label} <span class="mini">(${b.n})</span></div>` +
      `<div class="value ${b.n ? cls(avg(b)) : ""}">${b.n ? pctS(avg(b)) : "\u2014"}</div>` +
      `<div class="mini" style="margin-top:2px">vs bench: <span class="${ex != null ? cls(ex) : ""}">${ex != null ? pctS(ex) : "\u2014"}</span></div>` +
      `</div>`
    );
  };
  // \u2500\u2500 PLAIN-ENGLISH VERDICT \u2500\u2500
  // Turn the buy/sell excess numbers into a one-line "is the engine working?"
  // takeaway, so the user doesn't have to interpret the cards themselves.
  // Buy is "good" when its excess is positive (beat the market); Sell is "good"
  // when its excess is NEGATIVE (the names it flagged lagged the market).
  const buyEx = exAvg(agg.buy);
  const sellEx = exAvg(agg.sell);
  const buyGood = buyEx != null && buyEx > 0.005; // beat market by >0.5pt
  const buyBad = buyEx != null && buyEx < -0.005;
  const sellGood = sellEx != null && sellEx < -0.005; // flagged names lagged
  const sellBad = sellEx != null && sellEx > 0.005;
  const goods = (buyGood ? 1 : 0) + (sellGood ? 1 : 0);
  const bads = (buyBad ? 1 : 0) + (sellBad ? 1 : 0);
  let verdictTxt, verdictColor;
  if (buyEx == null && sellEx == null) {
    verdictTxt =
      "Not enough judged Buy/Sell calls yet to grade the engine \u2014 check back as more calls pass 30 days.";
    verdictColor = "var(--text2)";
  } else if (goods && !bads) {
    verdictTxt =
      "\u2705 The engine is adding value so far: " +
      (buyGood ? "Buy-rated names beat the market by " + pctS(buyEx) : "") +
      (buyGood && sellGood ? ", and " : "") +
      (sellGood
        ? "Sell/Trim names lagged it by " + pctS(sellEx) + " (correct)"
        : "") +
      ". Treat the engine's calls as a credible signal \u2014 but still size positions with the Rebalance tab.";
    verdictColor = "var(--success)";
  } else if (bads && !goods) {
    verdictTxt =
      "\u26A0\uFE0F The engine is NOT adding value over this sample: " +
      (buyBad ? "Buy-rated names trailed the market by " + pctS(buyEx) : "") +
      (buyBad && sellBad ? ", and " : "") +
      (sellBad
        ? "Sell/Trim names actually rose " + pctS(sellEx) + " vs the market"
        : "") +
      ". Lean on your own judgement and don't follow the signals mechanically.";
    verdictColor = "var(--error)";
  } else {
    verdictTxt =
      "\u2696\uFE0F Mixed so far: " +
      "Buy calls are " +
      (buyEx != null ? pctS(buyEx) + " vs market" : "n/a") +
      ", Sell calls are " +
      (sellEx != null ? pctS(sellEx) + " vs market" : "n/a") +
      ". The edge is small on this sample \u2014 use the signals as one input, not a rule. More history makes this clearer.";
    verdictColor = "var(--warn)";
  }

  let h =
    '<div style="font-weight:700;margin-bottom:6px">\uD83D\uDCC8 Signal outcomes <span class="mini" style="font-weight:400;color:var(--text2)">\u2014 price change since each call (\u2265 30 days old, earliest call per name). "vs bench" = excess over the average name from the same start date.</span></div>';
  // Verdict banner: the single most useful line on the page.
  h +=
    '<div style="border-left:3px solid ' +
    verdictColor +
    ';background:var(--panel2);padding:9px 12px;border-radius:6px;margin-bottom:10px;font-size:13px;line-height:1.45">' +
    verdictTxt +
    "</div>";
  // Collapsible "how to read this" so it's explicit without cluttering.
  h +=
    '<details style="margin-bottom:12px;font-size:12.5px;line-height:1.5">' +
    '<summary style="cursor:pointer;color:var(--primary2);font-weight:600">\u2753 How to read this / what to do</summary>' +
    '<div style="color:var(--text2);margin-top:8px">' +
    "<b>What this tab is.</b> A report card that grades the Signals engine on its OWN past calls. It is <b>not</b> a to-do list of trades \u2014 it tells you <i>how much to trust</i> the Buy/Hold/Sell ratings you see on the Signals tab.<br><br>" +
    "<b>How a call is graded.</b> When a ticker is first rated (Buy, Hold, or Sell), that date + price is saved. Once the call is \u2265 30 days old, the tab compares its price then vs now, and subtracts the return of the <i>average</i> stock that started the same day. That difference is <b>\u201Cvs bench\u201D</b> \u2014 the part due to the signal, not the whole market drifting.<br><br>" +
    "<b>The three cards (the important part):</b><br>" +
    "\u2022 <b>Buy-rated</b> \u2014 you want <b>vs bench positive</b> (the engine's buys beat the market).<br>" +
    "\u2022 <b>Sell/Trim</b> \u2014 you want <b>vs bench negative</b> (the names it told you to sell/trim did worse than the market \u2014 so avoiding them was right).<br>" +
    "\u2022 <b>Hold/Wait</b> \u2014 expected to sit near the market (near 0). No action implied.<br><br>" +
    "<b>What to actually do:</b><br>" +
    "1. Read the green/amber/red verdict line above \u2014 it already summarises whether the engine is earning its keep.<br>" +
    "2. If it\u2019s <b>green</b>, you can lean on the Signals tab\u2019s ratings with more confidence when picking buys/trims (then size them in <b>Rebalance</b>).<br>" +
    "3. If it\u2019s <b>red/amber</b>, treat the ratings as just one opinion and rely more on your own view + fair-value gap.<br>" +
    "4. Scan the table for outliers: a Buy with a big <b>negative</b> vs bench, or a Sell that <b>rose</b> a lot, is a call the engine got wrong \u2014 worth a closer look on that name.<br><br>" +
    "<b>Caveats.</b> Price-only (ignores dividends &amp; fees), each name counts once (its earliest \u2265 30-day call), and small samples are noisy \u2014 a handful of calls isn\u2019t proof. It grades the engine; it does <b>not</b> feed the Rebalance math." +
    "</div></details>";
  h +=
    '<div class="grid kpis" style="margin-bottom:10px">' +
    `<div class="card nis-cell" data-tip="${tipRef("Average price change of ALL judged names over their tracking windows - the market baseline the signal buckets are compared against.")}" style="cursor:help"><div class="label">Benchmark (all) <span class="mini">(${allN})</span></div><div class="value ${overallBench != null ? cls(overallBench) : ""}">${overallBench != null ? pctS(overallBench) : "\u2014"}</div></div>` +
    aggCard(
      "Buy-rated",
      agg.buy,
      "Average price change since the engine first rated these names Buy (\u2265 30 days ago), and the EXCESS over the average name from the same start date. Positive 'vs bench' means the Buy calls beat the typical stock - the signal added value.",
    ) +
    aggCard(
      "Hold/Wait",
      agg.neutral,
      "Average price change since these names were rated Hold/Wait/Avoid, and the excess vs the same-day benchmark.",
    ) +
    aggCard(
      "Sell/Trim",
      agg.sell,
      "Average price change since Sell/Trim, and the excess vs benchmark. NEGATIVE 'vs bench' is the engine being right (these underperformed the typical stock).",
    ) +
    "</div>";
  // Search box: filter the per-name table by ticker (client-side row hide/show
  // via the delegated dispatcher, so typing keeps focus and needs no re-render).
  h +=
    '<div style="display:flex;align-items:center;gap:8px;margin:8px 0 6px">' +
    '<input id="scSearch" type="text" placeholder="\uD83D\uDD0D Search ticker\u2026" ' +
    'autocomplete="off" data-act="scFilterRows" data-on="input" ' +
    'style="flex:0 0 220px;max-width:60%;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font-size:12px" />' +
    '<span id="scSearchCount" class="mini" style="color:var(--text2)"></span>' +
    "</div>";
  h +=
    '<div class="scroll"><table id="scTable" style="width:100%;font-size:12px"><thead><tr>' +
    '<th class="l" data-tip="The name being graded. Each name appears once, judged on its earliest call that is now at least 30 days old.">Ticker</th>' +
    '<th class="l" data-tip="What the engine rated this name on the call date (Buy / Hold / Sell, etc.). Hover a row\'s badge for the full detail.">Call</th>' +
    '<th data-tip="The date the call was made (and prices were snapshotted).">On</th>' +
    '<th data-tip="Share price on the call date (close from the daily price history).">Price then</th>' +
    '<th data-tip="Latest known share price now.">Price now</th>' +
    '<th data-tip="Raw price change from the call date to now (price only, excludes dividends and fees).">Change</th>' +
    '<th data-tip="Excess return over the average name from the same start date - the signal\'s value-add.">vs bench</th></tr></thead><tbody>';
  for (const x of rows) {
    h +=
      // Ticker: logo badge + clickable name -> full company detail (same as Signals)
      '<tr class="sc-row" data-sc-tk="' +
      escapeHtml(x.tk) +
      '"><td class="l" style="cursor:pointer" data-tip="Click for full company details" data-act="showCompanyDetail" data-args="' +
      escapeHtml(x.tk) +
      '" data-stop="true">' +
      tickerBadge(x.tk) +
      '<b style="color:var(--primary2)">' +
      escapeHtml(x.tk) +
      "</b>" +
      // Call badge (hover: what was rated, when, how old)
      '</td><td class="l nis-cell" style="cursor:help" data-tip="' +
      tipRef(tipCall(x)) +
      '"><span class="badge ' +
      (x.h.sig || "") +
      '">' +
      escapeHtml(x.h.label || x.h.sig || "\u2014") +
      '</span> <span style="color:var(--muted)">\u24D8</span></td>' +
      // On (call date) - shares the "call" tooltip
      '<td class="nis-cell" style="cursor:help" data-tip="' +
      tipRef(tipCall(x)) +
      '">' +
      escapeHtml(x.h.date) +
      "</td>" +
      // Price then / Price now (hover: source of each price)
      '<td class="nis-cell" style="cursor:help" data-tip="' +
      tipRef(tipPrices(x)) +
      '">' +
      money(x.then) +
      '</td><td class="nis-cell" style="cursor:help" data-tip="' +
      tipRef(tipPrices(x)) +
      '">' +
      money(x.now) +
      // Change (hover: raw-return arithmetic)
      '</td><td class="nis-cell ' +
      cls(x.ret) +
      '" style="cursor:help" data-tip="' +
      tipRef(tipChange(x)) +
      '">' +
      pctS(x.ret) +
      // vs bench (hover: excess = this - peers, with verdict)
      '</td><td class="nis-cell ' +
      (x.excess != null ? cls(x.excess) : "") +
      '" style="cursor:help" data-tip="' +
      tipRef(tipBench(x)) +
      '">' +
      (x.excess != null ? pctS(x.excess) : "\u2014") +
      ' <span style="color:var(--muted)">\u24D8</span>' +
      "</td></tr>";
  }
  h += "</tbody></table></div>";
  h +=
    '<div class="mini" style="margin-top:6px;color:var(--muted)">Price-only change (excludes dividends &amp; fees). "vs bench" compares each call to the average name from the same start date, isolating the signal\'s value-add. A rough scorecard for the signal engine, not a P&amp;L.</div>';
  host.innerHTML = h;
}
// Scorecard search: hide/show table rows whose ticker doesn't match the query.
// Called by the delegated dispatcher (data-act="scFilterRows", data-on="input").
// Pure DOM filtering - no re-render, so the input keeps focus while typing.
window.scFilterRows = function () {
  const inp = document.getElementById("scSearch");
  const tbl = document.getElementById("scTable");
  if (!tbl) return;
  const q = ((inp && inp.value) || "").trim().toUpperCase();
  const rowsEls = tbl.querySelectorAll("tbody tr.sc-row");
  let shown = 0;
  rowsEls.forEach((tr) => {
    const tk = (tr.getAttribute("data-sc-tk") || "").toUpperCase();
    const match = !q || tk.indexOf(q) >= 0;
    tr.style.display = match ? "" : "none";
    if (match) shown++;
  });
  const cnt = document.getElementById("scSearchCount");
  if (cnt)
    cnt.textContent = q ? shown + " match" + (shown === 1 ? "" : "es") : "";
};
