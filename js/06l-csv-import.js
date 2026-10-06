// ============================================================
// TRANSACTION CSV IMPORT / EXPORT  (js/06l-csv-import.js)
// ------------------------------------------------------------
// Extracted verbatim from js/06b-import.js (god-file decomposition).
// Wires #exportCsv (schema-driven via __core.txnSchema, broker resolved by
// txnBroker) and #importCsv (async FileReader -> parse -> save TXNS). Pure
// load-time handler wiring; defines no reusable symbols. Outbound deps
// (__core, TXNS, txnBroker, safeSetItem, render, toast) resolve at event
// time, so this stays in the single concatenated IIFE; placed after
// 06k-price-import.js in concat order.
// ============================================================

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
