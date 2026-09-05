// 06c-backup.js - split from 06-features.js (backup/restore, auto-dividends, snapshots/history, txn multi-select). Shared scope.
// ---------- full-state backup / restore ----------
const APP_LS_KEYS = [
  "casa_portfolio_txns_v1",
  "casa_fees_v1",
  "casa_fees_pea_v1",
  "casa_divtax_v1",
  "casa_master_v1",
  "casa_divcal_v1",
  "casa_theme_v1",
  "casa_snapshots_v1",
  "casa_pending_v1",
  "casa_salary_v1",
  "casa_expenses_v1",
  "casa_categories_v1",
  "casa_opcvm_isin_map_v1",
  "casa_opcvm_updated_v1",
  "casa_opcvm_updated_kind_v1",
  "casa_rebalance_v1",
  "casa_issuer_aliases_v1",
  "casa_cash_v1",
  "casa_brokers_v1",
  "casa_signal_hist_v1",
  "casa_order_seq_v1",
];
let _backupBusy = false;
document.getElementById("backupAll").onclick = () => {
  // Guard set synchronously FIRST \u2014 blocks any rapid re-fire before setTimeout runs.
  if (_backupBusy) return;
  _backupBusy = true;
  // Defer the actual download to the next event-loop tick.
  // This ensures even two synchronous calls to this handler only produce one download:
  // both pass the guard check in the same tick, but only the first sets the flag and
  // schedules the work; the second is blocked on the very next line.
  setTimeout(() => {
    try {
      takeSnapshot(true);
      const dump = {
        _app: "casa_portfolio_tracker",
        _version: 2,
        _exported: new Date().toISOString(),
        data: {},
      };
      for (let n = 0; n < localStorage.length; n++) {
        const k = localStorage.key(n);
        if (
          k &&
          k.indexOf("casa_") === 0 &&
          k !== "casa_last_backup_v1" &&
          k !== "casa_carPlanCollapsed_v1" &&
          k !== "casa_incCollapsed_v1" &&
          k !== "casa_last_tab_v1" &&
          k !== "casa_last_app_v1"
        ) {
          const v = localStorage.getItem(k);
          if (v != null) dump.data[k] = v;
        }
      }
      APP_LS_KEYS.forEach((k) => {
        if (dump.data[k] == null) {
          const v = localStorage.getItem(k);
          if (v != null) dump.data[k] = v;
        }
      });
      // v2: optional password encryption. Leaving the passphrase blank keeps the
      // plaintext backup (unchanged default). A passphrase produces an encrypted
      // envelope (AES-GCM) that restore auto-detects. Async, so wrapped in IIFE.
      (async () => {
        try {
          let payloadObj = dump;
          let suffix = "";
          const pass = await appPrompt(
            "Optional: enter a password to ENCRYPT this backup (leave blank for a normal, unencrypted backup).",
            "",
            { inputType: "password", title: "Encrypt backup?" },
          );
          if (pass && String(pass).length > 0) {
            payloadObj = await __core.backupCrypto.encryptBackup(
              dump,
              String(pass),
            );
            suffix = "_encrypted";
          }
          const blob = new Blob(
              [JSON.stringify(payloadObj, null, pass ? 0 : 1)],
              {
                type: "application/json",
              },
            ),
            url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download =
            "portfolio_backup_" +
            (() => {
              const d = new Date();
              const pad = (n) => String(n).padStart(2, "0");
              return (
                d.getFullYear() +
                "-" +
                pad(d.getMonth() + 1) +
                "-" +
                pad(d.getDate()) +
                "_" +
                pad(d.getHours()) +
                pad(d.getMinutes())
              );
            })() +
            suffix +
            ".json";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          try {
            localStorage.setItem(
              "casa_last_backup_v1",
              new Date().toISOString(),
            );
          } catch (e) {}
          showBackupAge();
        } catch (err) {
          toast(
            "Backup failed: " + (err && err.message ? err.message : err),
            "err",
          );
        }
      })();
    } finally {
      setTimeout(() => {
        _backupBusy = false;
      }, 1500);
    }
  }, 0);
};
document.getElementById("restoreAll").onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      let dump = JSON.parse(rd.result);
      // v2: if this is an encrypted backup envelope, prompt for the password
      // and decrypt before proceeding. Plaintext backups skip this untouched.
      if (__core.backupCrypto.isEncryptedBackup(dump)) {
        const pass = await appPrompt(
          "This backup is encrypted. Enter its password to restore.",
          "",
          { inputType: "password", title: "Encrypted backup" },
        );
        if (pass == null || pass === "")
          throw new Error("Restore cancelled (no password).");
        dump = await __core.backupCrypto.decryptBackup(dump, String(pass));
      }
      if (!dump || dump._app !== "casa_portfolio_tracker" || !dump.data)
        throw new Error("Not a valid backup file.");
      var APP_SCHEMA = 2;
      var fileV = typeof dump._version === "number" ? dump._version : 1;
      if (
        fileV > APP_SCHEMA &&
        !(await appConfirm(
          "This backup was made by a NEWER version of the app (schema v" +
            fileV +
            " > v" +
            APP_SCHEMA +
            "). Some fields may not import correctly. Continue anyway?",
        ))
      )
        return;
      if (
        !(await appConfirm(
          "Restore this backup? It REPLACES current data, but portfolio-value snapshots are MERGED so no history is lost.",
        ))
      )
        return;
      // Merge snapshots (union by date) so switching browsers/files never loses value history.
      let mergedSnaps = null;
      try {
        const local = JSON.parse(
          localStorage.getItem("casa_snapshots_v1") || "[]",
        );
        const incoming = JSON.parse(dump.data["casa_snapshots_v1"] || "[]");
        const byDate = {};
        [...local, ...incoming].forEach((s) => {
          if (s && s.date) byDate[s.date] = s;
        });
        mergedSnaps = Object.values(byDate).sort((a, b) =>
          a.date < b.date ? -1 : 1,
        );
      } catch (e) {}
      // Restore EVERY key present in the backup (future-proof), not just a fixed list.
      Object.keys(dump.data).forEach((k) => {
        if (dump.data[k] != null) localStorage.setItem(k, dump.data[k]);
      });
      if (mergedSnaps)
        localStorage.setItem("casa_snapshots_v1", JSON.stringify(mergedSnaps));
      toast("Backup restored (value history merged). Reloading.", "ok");
      setTimeout(() => location.reload(), 200);
    } catch (err) {
      toast("Restore failed: " + err.message, "err");
    }
  };
  rd.readAsText(f);
};

// (removed redundant tipBox engine \u2014 unified #__qtip handles all data-tip)

// ---------- auto-add dividends from calendar (ex-date aware) ----------
// Eligibility: net shares held STRICTLY BEFORE the ex-date. Sell on/before ex-date => not eligible.
// Eligibility per user's rule: you receive the dividend on shares held through the day
// BEFORE the ex-date. So a BUY counts only if strictly before ex-date; a SELL removes
// shares if it happens ON or BEFORE the ex-date (selling on ex-date = NOT eligible).
function heldBefore(ticker, pea, exDateISO) {
  let q = 0;
  for (const t of TXNS) {
    if (t.ticker !== ticker) continue;
    if (!!t.pea !== !!pea) continue;
    if (t.action === "BUY") {
      if (t.date < exDateISO) q += t.qty; // bought before ex-date -> eligible
    } else if (t.action === "SELL") {
      if (t.date <= exDateISO) q -= t.qty; // sold on/before ex-date -> not eligible
    }
  }
  return q > 1e-9 ? q : 0; // never negative
}
const DIV_MATCH_WINDOW_DAYS = 14; // same dividend won't recur at same amount within ~2 weeks
function daysBetween(a, b) {
  return Math.abs((new Date(a) - new Date(b)) / 86400000);
}
document.getElementById("autoDiv").onclick = () => {
  const cal = DIVCAL.filter((d) => d.pay_date && (d.ex_date || d.pay_date));
  const accounts = [false, true]; // Regular, PEA
  let added = 0,
    matched = 0,
    exact = 0,
    pended = 0;
  const matchNotes = [];
  for (const d of cal) {
    const exd = d.ex_date || d.pay_date;
    for (const pea of accounts) {
      const sh = heldBefore(d.ticker, pea, exd);
      if (sh <= 1e-9) continue;
      // Look for an EXISTING DIV of same ticker + same amount + same account within a \u00B1window.
      // This catches a manual entry whose date differs slightly from the official pay date.
      const amt = +(+d.amount).toFixed(4);
      let hit = null;
      for (const t of TXNS) {
        if (t.action !== "DIV") continue;
        if (t.ticker !== d.ticker) continue;
        if (!!t.pea !== !!pea) continue;
        if (+(+t.price).toFixed(4) !== amt) continue;
        if (daysBetween(t.date, d.pay_date) <= DIV_MATCH_WINDOW_DAYS) {
          hit = t;
          break;
        }
      }
      if (hit) {
        // Already recorded (possibly with a slightly-off date) -> correct the date, don't duplicate.
        if (hit.date !== d.pay_date) {
          matchNotes.push(
            d.ticker +
              " " +
              (pea ? "(PEA) " : "") +
              hit.date +
              " \u2192 " +
              d.pay_date,
          );
          hit.date = d.pay_date;
          matched++;
        } else {
          exact++;
        }
        // enrich with ex-date/eligibility for the tooltip, and mark reconciled
        hit.exDate = exd;
        if (hit.eligBasis == null) hit.eligBasis = sh;
        hit.reconciled = true;
        continue;
      }
      // Also check PENDING for an already-staged matching dividend (avoid dup there too)
      const pendHit = PENDING.some(
        (o) =>
          o.action === "DIV" &&
          o.ticker === d.ticker &&
          !!o.pea === pea &&
          +(+o.price).toFixed(4) === amt &&
          daysBetween(o.date, d.pay_date) <= DIV_MATCH_WINDOW_DAYS,
      );
      if (pendHit) continue;
      // Only act once the EX-DATE has PASSED (you've actually qualified). A future ex-date
      // means you haven't locked in the dividend yet (could still buy/sell) -> skip for now.
      if (daysUntil(exd) > 0) continue;
      if (daysUntil(d.pay_date) > 0) {
        // Ex-date passed but pay date still future -> owed but not received -> stage in PENDING.
        PENDING.push({
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
        pended++;
      } else {
        // Pay date reached/passed -> record as a real transaction.
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
  }
  saveTxns(TXNS);
  savePending();
  let msg = "";
  if (added) msg += "\u2705 Recorded <b>" + added + "</b> paid dividend(s). ";
  if (pended)
    msg +=
      "\u23F3 Staged <b>" +
      pended +
      "</b> not-yet-paid dividend(s) in Pending. ";
  if (matched)
    msg += "\uD83D\uDD01 Corrected date on <b>" + matched + "</b> existing. ";
  if (exact) msg += exact + " already matched. ";
  if (!added && !pended && !matched && !exact)
    msg = "No eligible dividends found for your holdings.";
  document.getElementById("editHint").innerHTML = msg;
  render();
  renderPending();
};

document.getElementById("clearAutoDiv").onclick = async () => {
  const n = TXNS.filter((t) => t.auto).length;
  if (n === 0) {
    document.getElementById("editHint").textContent =
      "No auto-added dividends to clear.";
    return;
  }
  if (
    !(await appConfirm(
      "Remove all " +
        n +
        " auto-added dividend row(s)? Your manually-entered transactions are kept.",
    ))
  )
    return;
  TXNS = TXNS.filter((t) => !t.auto);
  saveTxns(TXNS);
  document.getElementById("editHint").innerHTML =
    "\u2705 Cleared <b>" + n + "</b> auto-added dividend(s).";
  render();
};

// ---------- portfolio value history (snapshots) ----------
let CH_history = null;
function loadSnapshots() {
  const s = localStorage.getItem("casa_snapshots_v1");
  if (s == null) return [];
  const parsed = safeParseLS("casa_snapshots_v1", s, null, "Value history");
  return Array.isArray(parsed.value) ? parsed.value : [];
}
function saveSnapshots(a) {
  if (safeSetItem("casa_snapshots_v1", JSON.stringify(a))) markSaved();
}
function currentTotals() {
  const { pos } = runFIFO();
  const arr = Object.values(pos);
  return arr.reduce(
    (a, p) => ({
      val: a.val + p.value,
      real: a.real + p.realized,
      div: a.div + p.divs,
      life: a.life + p.lifetime,
      inv: a.inv + (p.held > 0 ? p.invested : 0),
    }),
    { val: 0, real: 0, div: 0, life: 0, inv: 0 },
  );
}
function takeSnapshot(auto) {
  const t = currentTotals();
  const today = new Date().toISOString().slice(0, 10);
  let snaps = loadSnapshots();
  // one snapshot per day \u2014 overwrite same-day
  snaps = snaps.filter((s) => s.date !== today);
  let bankedTot = 0,
    netXfer = 0;
  try {
    if (typeof eLoad === "function") {
      eLoad();
      const bk = eBucketTotals().banked;
      bankedTot = Object.values(bk).reduce((a, b) => a + b, 0);
      netXfer = eCompute().netMDtoBT;
    }
  } catch (e) {}
  snaps.push({
    date: today,
    value: +t.val.toFixed(2),
    invested: +t.inv.toFixed(2),
    realized: +t.real.toFixed(2),
    dividends: +t.div.toFixed(2),
    lifetime: +t.life.toFixed(2),
    banked: +bankedTot.toFixed(2),
    netXfer: +netXfer.toFixed(2),
  });
  snaps.sort((a, b) => (a.date < b.date ? -1 : 1));
  saveSnapshots(snaps);
  if (!auto) {
    document.getElementById("snapNote").textContent =
      "Snapshot saved for " + today + ".";
    renderHistory();
  }
  return snaps;
}
function renderHistory() {
  let snaps = loadSnapshots();
  const note = document.getElementById("snapNote");
  if (snaps.length < 2) {
    if (note)
      note.textContent = snaps.length
        ? "A value-over-time trend appears after 2+ snapshots. Each backup adds one automatically; you can also click \u201CSave snapshot\u201D anytime."
        : "No snapshots yet. Each time you back up (or click \u201CSave snapshot\u201D) a point is recorded \u2014 the chart builds from there and travels with your backup file.";
  } else if (note) {
    note.textContent =
      snaps.length +
      " snapshots \u00B7 " +
      snaps[0].date +
      " \u2192 " +
      snaps[snaps.length - 1].date;
  }
  const tx2 = themeColor("text2");
  const cats = snaps.map((s) => s.date);
  CH_history = Highcharts.chart("historyChart", {
    chart: { backgroundColor: "transparent" },
    title: { text: null },
    credits: { enabled: false },
    legend: { itemStyle: { color: tx2 } },
    xAxis: { categories: cats, labels: { style: { color: tx2 } } },
    yAxis: {
      title: { text: null },
      gridLineColor: "#2c3742",
      labels: { style: { color: tx2 }, format: "{value:,.0f}" },
    },
    tooltip: { shared: true, valueDecimals: 0, valueSuffix: " MAD" },
    series: [
      {
        name: "Current Value",
        type: "area",
        color: themeColor("primary"),
        fillOpacity: 0.15,
        data: snaps.map((s) => s.value),
      },
      {
        name: "Lifetime Return",
        type: "line",
        color: themeColor("success"),
        data: snaps.map((s) => s.lifetime),
      },
    ],
  });
}
document.getElementById("snapBtn").onclick = () => takeSnapshot(false);
// Snapshots are captured on BACKUP (reliable & travels with the file), not daily-on-open.

// ---------- Transactions multi-select (bulk delete) ----------
function updateTxnBulkBar() {
  const sel = [...document.querySelectorAll(".txnChk:checked")];
  const bar = document.getElementById("txnBulkBar");
  if (!bar) return;
  if (sel.length) {
    bar.style.display = "flex";
    document.getElementById("txnSelCount").textContent =
      sel.length + " selected";
  } else bar.style.display = "none";
}
document.addEventListener("change", (e) => {
  if (e.target && e.target.classList && e.target.classList.contains("txnChk"))
    updateTxnBulkBar();
  if (e.target && e.target.id === "txnSelectAll") {
    const on = e.target.checked;
    document.querySelectorAll(".txnChk").forEach((c) => (c.checked = on));
    updateTxnBulkBar();
  }
});
document.getElementById("txnClearSel").onclick = () => {
  document
    .querySelectorAll(".txnChk,#txnSelectAll")
    .forEach((c) => (c.checked = false));
  updateTxnBulkBar();
};
document.getElementById("txnDelSel").onclick = async () => {
  const idxs = [...document.querySelectorAll(".txnChk:checked")].map(
    (c) => +c.dataset.idx,
  );
  if (!idxs.length) return;
  if (
    !(await appConfirm(
      "Delete " +
        idxs.length +
        " selected transaction(s)? This cannot be undone (except via a backup).",
    ))
  )
    return;
  const drop = new Set(idxs);
  TXNS = TXNS.filter((t, i) => !drop.has(i));
  saveTxns(TXNS);
  render();
};
document.getElementById("txnToPending").onclick = async () => {
  const idxs = [...document.querySelectorAll(".txnChk:checked")].map(
    (c) => +c.dataset.idx,
  );
  if (!idxs.length) return;
  const sel = idxs.map((i) => TXNS[i]).filter(Boolean);
  const divs = sel.filter((t) => t.action === "DIV").length;
  const movable = sel.filter((t) => t.action !== "DIV");
  if (!movable.length) {
    toast(
      "Dividends cannot be moved to pending. Select BUY/SELL transactions.",
      "warn",
    );
    return;
  }
  if (
    !(await appConfirm(
      "Move " +
        movable.length +
        " transaction(s) to Pending" +
        (divs ? " (" + divs + " dividend(s) skipped)" : "") +
        "? They will be removed from Transactions until re-validated.",
    ))
  )
    return;
  movable.forEach((t) => {
    const o = {
      date: t.date,
      ticker: t.ticker,
      action: t.action,
      qty: t.qty,
      price: t.price,
      pea: !!t.pea,
      broker: t.broker || txnBroker(t),
    };
    if (typeof t.total === "number" && t.total > 0) o.total = t.total;
    PENDING.push(o);
  });
  const drop = new Set(idxs.filter((i) => TXNS[i] && TXNS[i].action !== "DIV"));
  TXNS = TXNS.filter((t, i) => !drop.has(i));
  saveTxns(TXNS);
  savePending();
  render();
  renderPending();
  toast("Moved " + movable.length + " transaction(s) to Pending.", "ok");
};

// \u2500\u2500 "Apply to all rows" bar for bulk-edit modals (Transactions + Pending) \u2500\u2500
// Lets you set Action / Account / Broker / OPCVM once and stamp it onto every row
// currently shown in the modal, instead of editing each row individually.
function beBulkBarHTML() {
  const brokerOpts = Object.keys(BROKERS)
    .map(
      (id) =>
        `<option value="${escapeHtml(id)}">${escapeHtml(BROKERS[id].name)}</option>`,
    )
    .join("");
  return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:9px 11px;margin-bottom:12px;background:var(--panel2);border:1px solid var(--border);border-radius:9px">
      <span class="mini" style="font-weight:700;color:var(--text)">Apply to all rows:</span>
      <select id="beAllAction" class="mini"><option value="">Action\u2026</option><option>BUY</option><option>SELL</option><option>DIV</option></select>
      <select id="beAllAccount" class="mini"><option value="">Account\u2026</option><option value="reg">Regular</option><option value="pea">PEA</option></select>
      <select id="beAllBroker" class="mini"><option value="">Broker\u2026</option>${brokerOpts}</select>
      <select id="beAllOpcvm" class="mini"><option value="">OPCVM\u2026</option><option value="1">Fund</option><option value="0">Not fund</option></select>
      <button class="btn sec2" id="beApplyAll" style="font-size:12px">Apply to all</button>
    </div>`;
}
function wireBeBulkBar() {
  const btn = document.getElementById("beApplyAll");
  if (!btn) return;
  btn.onclick = () => {
    const act = document.getElementById("beAllAction").value;
    const acct = document.getElementById("beAllAccount").value;
    const brk = document.getElementById("beAllBroker").value;
    const opc = document.getElementById("beAllOpcvm").value;
    document.querySelectorAll("#bulkEditBody .behdr").forEach((row) => {
      if (act) {
        const el = row.querySelector(".beAction");
        if (el) el.value = act;
      }
      if (acct) {
        const el = row.querySelector(".beAccount");
        if (el) el.value = acct;
      }
      if (brk) {
        const el = row.querySelector(".beBroker");
        if (el) el.value = brk;
      }
      if (opc !== "") {
        const el = row.querySelector(".beOpcvm");
        if (el) el.checked = opc === "1";
      }
    });
  };
}

document.getElementById("txnEditSel").onclick = () => {
  const idxs = [...document.querySelectorAll(".txnChk:checked")].map(
    (c) => +c.dataset.idx,
  );
  if (!idxs.length) return;
  const m = document.getElementById("bulkEditModal"),
    body = document.getElementById("bulkEditBody");
  const tickerOpts = Object.keys(M)
    .sort()
    .map((t) => `<option value="${t}">`)
    .join("");
  const brokerOpts = (cur) =>
    Object.keys(BROKERS)
      .map(
        (id) =>
          `<option value="${escapeHtml(id)}"${(cur || "") === id ? " selected" : ""}>${escapeHtml(BROKERS[id].name)}</option>`,
      )
      .join("");
  const GRID =
    "display:grid;grid-template-columns:118px 110px 78px 68px 82px 88px 92px 100px 54px;gap:7px;align-items:center;margin-bottom:6px;min-width:940px";
  const rows = idxs
    .map((i) => {
      const t = TXNS[i];
      const curBroker = txnBroker(t);
      const isOpc =
        t.opcvm === true || !!(M[t.ticker] && M[t.ticker].cat === "OPCVM");
      return `<div class="behdr" data-idx="${i}" style="${GRID}">
      <input type="date" class="beDate" value="${t.date}" style="width:100%;box-sizing:border-box">
      <input list="beTickersTxn" class="beTicker" value="${escapeHtml(t.ticker)}" placeholder="ticker" style="width:100%;box-sizing:border-box">
      <select class="beAction" style="width:100%;box-sizing:border-box"><option${t.action === "BUY" ? " selected" : ""}>BUY</option><option${t.action === "SELL" ? " selected" : ""}>SELL</option><option${t.action === "DIV" ? " selected" : ""}>DIV</option></select>
      <input type="number" step="any" class="beQty" value="${t.qty}" placeholder="qty" style="width:100%;box-sizing:border-box">
      <input type="number" step="any" class="bePrice" value="${t.price}" placeholder="price" style="width:100%;box-sizing:border-box">
      <input type="number" step="any" class="beTotal" value="${typeof t.total === "number" && t.total > 0 ? t.total : ""}" placeholder="auto" data-tip="Manual total (OPCVM) \u2014 blank = auto" style="width:100%;box-sizing:border-box">
      <select class="beAccount" style="width:100%;box-sizing:border-box"><option value="reg"${!t.pea ? " selected" : ""}>Regular</option><option value="pea"${t.pea ? " selected" : ""}>PEA</option></select>
      <select class="beBroker" style="width:100%;box-sizing:border-box" data-tip="Broker (fee model)">${brokerOpts(curBroker)}</select>
      <label class="mini" style="display:flex;align-items:center;justify-content:center;gap:4px" data-tip="OPCVM fund?"><input type="checkbox" class="beOpcvm"${isOpc ? " checked" : ""}>Fund</label>
    </div>`;
    })
    .join("");
  body.innerHTML = `<h3 style="margin:0 0 4px">Edit ${idxs.length} transaction(s)</h3>
    <div class="mini" style="margin-bottom:10px">Adjust date, ticker, action, quantity, price, account, broker or OPCVM flag.</div>
    <datalist id="beTickersTxn">${tickerOpts}</datalist>
    ${beBulkBarHTML("Txn")}
    <div style="${GRID};font-size:11px;color:var(--text2);font-weight:600;margin-bottom:4px"><span>Date</span><span>Ticker</span><span>Action</span><span>Qty</span><span>Price</span><span>Total</span><span>Account</span><span>Broker</span><span>OPCVM</span></div>
    ${rows}
    <div class="form-row" style="margin-top:14px"><button class="btn" id="beSave">Save changes</button><button class="btn sec2" id="beCancel">Cancel</button></div>`;
  m.style.display = "flex";
  wireBeBulkBar();
  document.getElementById("beCancel").onclick = () => {
    m.style.display = "none";
  };
  document.getElementById("beSave").onclick = () => {
    document.querySelectorAll("#bulkEditBody .behdr").forEach((row) => {
      const i = +row.dataset.idx;
      const t = TXNS[i];
      if (!t) return;
      const date = row.querySelector(".beDate").value;
      const ticker = row.querySelector(".beTicker").value.trim().toUpperCase();
      const action = row.querySelector(".beAction").value;
      const qty = parseFloat(row.querySelector(".beQty").value);
      const price = parseFloat(row.querySelector(".bePrice").value);
      const acct = row.querySelector(".beAccount")
        ? row.querySelector(".beAccount").value
        : null;
      const brEl = row.querySelector(".beBroker");
      const opcEl = row.querySelector(".beOpcvm");
      const totEl = row.querySelector(".beTotal");
      const totV = totEl ? parseFloat(totEl.value) : NaN;
      if (date) t.date = date;
      if (ticker) t.ticker = ticker;
      if (action) t.action = action;
      if (!isNaN(qty)) t.qty = qty;
      if (!isNaN(price)) t.price = price;
      if (acct) t.pea = acct === "pea";
      if (brEl && brEl.value) t.broker = brEl.value;
      if (opcEl) t.opcvm = opcEl.checked;
      if (totEl) {
        if (!isNaN(totV) && totV > 0) t.total = totV;
        else delete t.total;
      }
      if (t.auto) delete t.auto; // manual edit -> no longer auto
    });
    saveTxns(TXNS);
    m.style.display = "none";
    render();
  };
};

// ---------- ledger search ----------
(function () {
  const el = document.getElementById("txnSearch");
  if (!el) return;
  el.addEventListener("input", () => {
    const { enriched } = runFIFO();
    renderTxns(enriched);
  });
})();

// fee panel collapse toggle
(function () {
  const h = document.getElementById("feeToggle");
  if (!h) return;
  h.onclick = () => {
    const b = document.getElementById("feeBody"),
      ch = document.getElementById("feeChevron");
    const open = b.style.display !== "none";
    b.style.display = open ? "none" : "block";
    if (ch) ch.textContent = open ? "\u25b8 Show" : "\u25be Hide";
  };
})();

// ---------- generic collapsible sections ----------
document.addEventListener("click", function (e) {
  const h = e.target.closest && e.target.closest("h2.collap");
  if (!h) return;
  const body = h.nextElementSibling;
  if (!body || !body.classList.contains("collap-body")) return;
  const open = body.style.display !== "none";
  body.style.display = open ? "none" : "block";
  const ch = h.querySelector(".collap-ch");
  if (ch) ch.textContent = open ? "\u25B8 Show" : "\u25BE Hide";
});
