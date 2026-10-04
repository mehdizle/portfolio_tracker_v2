// ============================================================
// DIAGNOSTICS / DEBUG EXPORT  (js/09c-debug.js)
// ------------------------------------------------------------
// Wired to the #debugExport button in the top bar. Produces a single
// structured JSON snapshot of the whole app's runtime state PLUS a set of
// self-audit health checks, so a future issue (or a routine "is everything
// consistent?" audit) can be inspected from one downloaded file.
//
// Design rules:
//   - READ-ONLY. It never writes localStorage, never mutates app state, and
//     only calls pure / memoized compute functions (runFIFO, computeSignalsRows,
//     currentTotals). It deliberately avoids save*(), takeSnapshot(), and
//     DOM-form-coupled computeRebalance().
//   - COMPLETE. It enumerates localStorage by `casa_` prefix (not a hardcoded
//     list) so new keys and *_corrupt_* quarantine keys are always captured.
//   - DEFENSIVE. Every section is wrapped so one failing probe can't abort the
//     export; failures are recorded under `_errors`.
//
// Loaded last in the concat order (see scripts/concat.mjs) so every global it
// reads is already defined.
// ============================================================
(function () {
  const btn = document.getElementById("debugExport");
  if (!btn) return;

  // ---- small helpers -------------------------------------------------------
  const errors = [];
  // Run a probe, record its result under `label`; never throw.
  const safe = (label, fn, fallback) => {
    try {
      return fn();
    } catch (e) {
      errors.push({ at: label, message: String((e && e.message) || e) });
      return fallback === undefined ? null : fallback;
    }
  };
  const jsonParse = (raw) => {
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return {
        __parseError: String((e && e.message) || e),
        __raw: String(raw).slice(0, 500),
      };
    }
  };
  const sizeOf = (raw) => (raw == null ? 0 : String(raw).length);
  const isObj = (x) => x && typeof x === "object";
  const normTk = (s) =>
    String(s == null ? "" : s)
      .toUpperCase()
      .trim();

  btn.onclick = () => {
    errors.length = 0;
    const out = {};

    // ===== 0. meta / version stamp =========================================
    out.meta = safe(
      "meta",
      () => {
        const pricesFreshness = safe(
          "meta.prices",
          () => {
            // The in-memory feed stamp isn't a global; read what we persisted/know.
            return {
              seedPricesUpdated:
                typeof SEED !== "undefined" ? SEED.prices_updated : null,
            };
          },
          {},
        );
        // __APP_VERSION__ is replaced at build time by Vite's `define` with
        // package.json's version (single source of truth). The typeof guard keeps
        // this safe if the token is ever evaluated un-replaced (raw file / tests).
        const appVersion =
          typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
        return {
          _generatedAt: new Date().toISOString(),
          _note:
            "Portfolio Tracker diagnostics export (read-only snapshot + self-audit).",
          appVersion: appVersion,
          backupSchema: 2, // APP_SCHEMA in the backup/restore handler
          userAgent: safe("meta.ua", () => navigator.userAgent, null),
          href: safe("meta.href", () => location.href, null),
          prices: pricesFreshness,
        };
      },
      {},
    );

    // ===== 1. localStorage (prefix scan, not a hardcoded list) =============
    // Captures every casa_* key, its byte size, and a parsed value for the
    // small/structural ones. Large caches are summarized (count only) to keep
    // the file reasonable. *_corrupt_* keys are flagged separately in the audit.
    out.localStorage = safe(
      "localStorage",
      () => {
        const LARGE_SUMMARY_ONLY = ["casa_signal_hist_v1", "casa_snapshots_v1"];
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf("casa_") === 0) keys.push(k);
        }
        keys.sort();
        const store = {};
        keys.forEach((k) => {
          const raw = localStorage.getItem(k);
          const entry = { bytes: sizeOf(raw) };
          if (LARGE_SUMMARY_ONLY.indexOf(k) >= 0) {
            const v = jsonParse(raw);
            entry.summary = Array.isArray(v)
              ? { type: "array", length: v.length }
              : isObj(v)
                ? { type: "object", keys: Object.keys(v).length }
                : { type: typeof v };
          } else {
            entry.value = jsonParse(raw);
          }
          store[k] = entry;
        });
        return { keyCount: keys.length, keys, entries: store };
      },
      {},
    );

    // ===== 2. live in-memory globals =======================================
    // These can diverge from localStorage until the next save, so we snapshot
    // the live objects directly (per the state inventory).
    out.live = {};
    out.live.master = safe(
      "live.master",
      () => {
        const M_ = typeof M !== "undefined" ? M : {};
        const tickers = Object.keys(M_).sort();
        const rows = {};
        tickers.forEach((tk) => {
          const m = M_[tk] || {};
          rows[tk] = {
            name: m.name,
            cat: m.cat,
            cycle: m.cycle,
            style: m.style,
            price: m.price,
            pe: m.pe,
            pb: m.pb,
            divy: m.divy,
            eps: m.eps,
            isin: m.isin,
            _catOnly: m._catOnly,
          };
        });
        return { count: tickers.length, tickers, rows };
      },
      {},
    );
    out.live.transactions = safe(
      "live.transactions",
      () => ({
        count: typeof TXNS !== "undefined" ? TXNS.length : 0,
        rows: typeof TXNS !== "undefined" ? TXNS : [],
      }),
      {},
    );
    out.live.pending = safe(
      "live.pending",
      () => ({
        count: typeof PENDING !== "undefined" ? PENDING.length : 0,
        rows: typeof PENDING !== "undefined" ? PENDING : [],
      }),
      {},
    );
    out.live.dividendCalendar = safe(
      "live.divcal",
      () => ({
        count: typeof DIVCAL !== "undefined" ? DIVCAL.length : 0,
        rows: typeof DIVCAL !== "undefined" ? DIVCAL : [],
      }),
      {},
    );
    out.live.cash = safe(
      "live.cash",
      () => {
        const arr = typeof loadCash === "function" ? loadCash() : [];
        return {
          count: arr.length,
          activeAccount: typeof CASH_ACCT !== "undefined" ? CASH_ACCT : null,
          rows: arr,
        };
      },
      {},
    );
    out.live.aliases = safe(
      "live.aliases",
      () => ({
        user: typeof USER_ALIASES !== "undefined" ? USER_ALIASES : null,
        unmappedDividendIssuers:
          typeof DIVIDENDS_UNMAPPED !== "undefined" ? DIVIDENDS_UNMAPPED : null,
      }),
      {},
    );

    // ===== 3. config / fees / defaults =====================================
    out.config = safe(
      "config",
      () => ({
        feesRegular: typeof FP !== "undefined" ? FP : null,
        feesPEA: typeof FP_PEA !== "undefined" ? FP_PEA : null,
        brokers: typeof BROKERS !== "undefined" ? BROKERS : null,
        divTaxByYear: typeof DIVTAX !== "undefined" ? DIVTAX : null,
        rebalanceCapDefaults:
          typeof RB_CAP_DEFAULTS !== "undefined" ? RB_CAP_DEFAULTS : null,
        coreDefaults: safe(
          "config.core",
          () =>
            typeof __core !== "undefined" && __core.defaults
              ? __core.defaults
              : null,
          null,
        ),
        coreNamespaces: safe(
          "config.coreNs",
          () =>
            typeof __core !== "undefined" ? Object.keys(__core).sort() : null,
          null,
        ),
      }),
      {},
    );

    // ===== 4. derived / computed state (pure calls only) ===================
    const fifo = safe(
      "derived.fifo",
      () =>
        typeof runFIFO === "function" ? runFIFO() : { pos: {}, enriched: [] },
      { pos: {}, enriched: [] },
    );

    out.derived = {};
    out.derived.totals = safe(
      "derived.totals",
      () => (typeof currentTotals === "function" ? currentTotals() : null),
      null,
    );
    out.derived.positions = safe(
      "derived.positions",
      () => {
        const pos = (fifo && fifo.pos) || {};
        const rows = {};
        Object.keys(pos).forEach((k) => {
          const p = pos[k] || {};
          rows[k] = {
            ticker: p.ticker,
            account: p.account,
            held: p.held,
            avg: p.avg,
            price: p.price,
            value: p.value,
            invested: p.invested,
            unreal: p.unreal,
            realized: p.realized,
            divs: p.divs,
            lifetime: p.lifetime,
            isFund: p.isFund,
            oversold: p.oversold,
            status: p.status,
          };
        });
        return { count: Object.keys(rows).length, rows };
      },
      {},
    );
    out.derived.signals = safe(
      "derived.signals",
      () => {
        const rows =
          typeof computeSignalsRows === "function" ? computeSignalsRows() : [];
        return {
          count: rows.length,
          rows: rows.map((r) => ({
            ticker: r.ticker,
            name: r.name,
            price: r.price,
            cat: r.m && r.m.cat,
            cycle: r.m && r.m.cycle,
            style: r.m && r.m.style,
            score: r.score,
            conviction: r.conviction,
            fv: r.fv,
            tbuy: r.tbuy,
            tsell: r.tsell,
            held: r.held,
            signal: r.sig && r.sig.c,
          })),
        };
      },
      {},
    );

    // ===== 5. SELF-AUDIT health checks =====================================
    // Each check returns { ok, severity, detail } so a quick scan of the audit
    // section tells you whether anything looks wrong. severity: info|warn|error.
    out.audit = safe(
      "audit",
      () => {
        const checks = [];
        const add = (name, ok, severity, detail) =>
          checks.push({ name, ok, severity, detail });
        const M_ = typeof M !== "undefined" ? M : {};
        const TX = typeof TXNS !== "undefined" ? TXNS : [];
        const pos = (fifo && fifo.pos) || {};

        // 5a. corrupt/quarantined localStorage keys
        add("no_corrupt_ls_keys", true, "error", null); // placeholder, set below
        const corruptKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && /_corrupt_/.test(k)) corruptKeys.push(k);
        }
        checks[checks.length - 1] = {
          name: "no_corrupt_ls_keys",
          ok: corruptKeys.length === 0,
          severity: "error",
          detail: corruptKeys.length ? { quarantined: corruptKeys } : "none",
        };

        // 5b. FIFO oversold (sold more than ever held — ledger error)
        const oversold = Object.keys(pos)
          .filter((k) => (pos[k] && pos[k].oversold) > 0)
          .map((k) => ({ key: k, oversold: pos[k].oversold }));
        add(
          "no_oversold_positions",
          oversold.length === 0,
          "error",
          oversold.length ? oversold : "none",
        );

        // 5c. transactions referencing a ticker with no master record / no price
        const txTickers = Array.from(
          new Set(TX.map((t) => t && t.ticker).filter(Boolean)),
        );
        const missingMaster = [];
        const missingPrice = [];
        txTickers.forEach((tk) => {
          if (!M_[tk]) {
            const stillHeld = Object.keys(pos).some(
              (k) => pos[k].ticker === tk && pos[k].held > 1e-9,
            );
            missingMaster.push({ ticker: tk, stillHeld });
          } else if (M_[tk].price == null) {
            missingPrice.push(tk);
          }
        });
        add(
          "all_txn_tickers_in_master",
          missingMaster.length === 0,
          "error",
          missingMaster.length ? missingMaster : "none",
        );
        add(
          "all_master_tickers_priced",
          missingPrice.length === 0,
          "warn",
          missingPrice.length ? missingPrice : "none",
        );

        // 5d. category coverage: non-OPCVM, non-stub master names missing cat/cycle/style
        const noCat = [],
          noCycle = [],
          noStyle = [];
        Object.keys(M_).forEach((tk) => {
          const m = M_[tk] || {};
          if (m.cat === "OPCVM" || m._catOnly) return;
          if (!m.cat) noCat.push(tk);
          if (!m.cycle) noCycle.push(tk);
          if (!m.style) noStyle.push(tk);
        });
        add(
          "all_stocks_have_category",
          noCat.length === 0,
          "warn",
          noCat.length ? noCat : "none",
        );
        add(
          "all_stocks_have_cycle",
          noCycle.length === 0,
          "warn",
          noCycle.length ? noCycle : "none",
        );
        add(
          "all_stocks_have_style",
          noStyle.length === 0,
          "warn",
          noStyle.length ? noStyle : "none",
        );

        // 5e. category store vs master key-shape mismatches (case/whitespace)
        const catStore = jsonParse(
          safe(
            "audit.catraw",
            () => localStorage.getItem("casa_categories_v1"),
            null,
          ),
        );
        const mismatches = [];
        if (isObj(catStore)) {
          const mKeysNorm = {};
          Object.keys(M_).forEach((tk) => (mKeysNorm[normTk(tk)] = tk));
          Object.keys(catStore).forEach((k) => {
            if (!M_[k]) {
              const hit = mKeysNorm[normTk(k)];
              if (hit && hit !== k)
                mismatches.push({ catStoreKey: k, masterKey: hit });
            }
          });
        }
        add(
          "category_keys_match_master",
          mismatches.length === 0,
          "warn",
          mismatches.length ? mismatches : "none",
        );

        // 5f. held tickers that would show uncategorized in the rebalance readout
        const heldUncat = [];
        Object.keys(pos).forEach((k) => {
          const p = pos[k];
          if (!p || p.held <= 1e-9) return;
          const m = M_[p.ticker] || {};
          if (m.cat === "OPCVM") return;
          if (!m.cat || !m.cycle || !m.style) {
            if (!heldUncat.find((x) => x.ticker === p.ticker))
              heldUncat.push({
                ticker: p.ticker,
                cat: m.cat || null,
                cycle: m.cycle || null,
                style: m.style || null,
              });
          }
        });
        add(
          "held_names_fully_categorized",
          heldUncat.length === 0,
          "warn",
          heldUncat.length ? heldUncat : "none",
        );

        // 5g. duplicate transaction ids / order sequence sanity (if ids exist)
        const ids = TX.map((t) => t && t.id).filter((x) => x != null);
        const dupIds = ids.filter((v, i) => ids.indexOf(v) !== i);
        add(
          "no_duplicate_txn_ids",
          dupIds.length === 0,
          "warn",
          dupIds.length ? Array.from(new Set(dupIds)) : "none",
        );

        // ---- roll up ----
        const summary = {
          total: checks.length,
          passed: checks.filter((c) => c.ok).length,
          failed: checks.filter((c) => !c.ok).length,
          errors: checks.filter((c) => !c.ok && c.severity === "error").length,
          warnings: checks.filter((c) => !c.ok && c.severity === "warn").length,
        };
        return { summary, checks };
      },
      {},
    );

    // ===== finalize ========================================================
    out._errors = errors.slice();
    out.meta.overallHealth = safe(
      "overall",
      () => {
        const a = out.audit && out.audit.summary;
        if (!a) return "unknown";
        if (a.errors > 0) return "ERROR";
        if (a.warnings > 0) return "WARN";
        return "OK";
      },
      "unknown",
    );

    // download
    safe("download", () => {
      const text = JSON.stringify(out, null, 2);
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.href = url;
      a.download = "diagnostics_" + stamp + ".json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (typeof toast === "function") {
        const h = out.meta.overallHealth;
        toast(
          "Diagnostics exported \u00b7 health: " + h,
          h === "ERROR" ? "err" : "ok",
        );
      }
    });
  };
})();
