// Connection checker: verifies the connection-manifest against the REAL source
// files on disk. This is the enforcement that makes "add/modify/delete a field
// goes through the rule first" real - if a declared connection is missing, CI
// goes red. It reads index.html and the js bundle files directly so it checks
// the actual app, not a copy.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  FIELD_CONNECTIONS,
  RENDER_CONNECTIONS,
  SAVE_REFRESH_CONNECTIONS,
  PLAN_RECOMPUTE_CONNECTIONS,
  txnInputIds,
  pendingInputIds,
  csvColumns,
  requiredRenderCalls,
  requiredSaveRefreshes,
  requiredPlanRecomputes,
} from "../src/core/connection-manifest.js";
import { csvHeader } from "../src/core/txn-schema.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const HTML = read("index.html");
const RENDER_JS = read("js/04-render.js");
// Pending form/orders code was split out of 06-features into 06d-pending.
const PENDING_JS = read("js/06d-pending.js");
// Cache of source files read on demand for the save->refresh checks.
const _srcCache = {};
const readSrc = (rel) => (_srcCache[rel] = _srcCache[rel] || read(rel));

// Extract the body of a top-level `function name() { ... }` by brace matching.
function extractFn(src, name) {
  const sig = "function " + name + "(";
  const start = src.indexOf(sig);
  if (start < 0) return null;
  const open = src.indexOf("{", start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

const hasId = (id) => HTML.includes('id="' + id + '"');

describe("connection manifest: HTML form inputs exist", () => {
  it("every transaction field has its tXxx input in index.html", () => {
    for (const id of txnInputIds()) {
      expect(hasId(id), `missing transaction form input id="${id}"`).toBe(true);
    }
  });

  it("every transaction field has its pXxx pending input in index.html", () => {
    for (const id of pendingInputIds()) {
      expect(hasId(id), `missing pending form input id="${id}"`).toBe(true);
    }
  });
});

describe("connection manifest: CSV columns match the schema header", () => {
  it("csvHeader contains every declared CSV column", () => {
    const header = csvHeader();
    for (const col of csvColumns()) {
      expect(header, `CSV header missing column "${col}"`).toContain(col);
    }
  });
});

describe("connection manifest: form-read functions reference every field id", () => {
  it("readPendingForm resolves each pending input id (schema-driven or direct)", () => {
    const fn = extractFn(PENDING_JS, "readPendingForm");
    expect(fn, "readPendingForm not found").toBeTruthy();
    // The pending form is schema-driven (loops pendingFormFields()), so instead
    // of hard input ids it must reference the schema helper. Assert the wiring
    // that guarantees every field is read.
    expect(fn).toContain("pendingFormFields");
  });
});

describe("connection manifest: price-displaying views are wired into render()", () => {
  const body = extractFn(RENDER_JS, "render");
  it("render() exists and is extractable", () => {
    expect(body, "render() body not found").toBeTruthy();
  });
  for (const { fn, reason } of RENDER_CONNECTIONS) {
    it(`render() calls ${fn}() (${reason})`, () => {
      // Match a call like `renderPositions(` anywhere in the render() body.
      const called = new RegExp("\\b" + fn + "\\s*\\(").test(body || "");
      expect(
        called,
        `render() does not call ${fn}() - live data won't refresh`,
      ).toBe(true);
    });
  }
});

describe("connection manifest: data-save functions refresh the KPI row", () => {
  it("refreshKpiRow() is defined in js/04-render.js", () => {
    expect(
      extractFn(RENDER_JS, "refreshKpiRow"),
      "refreshKpiRow() not found - the single KPI-refresh entry point is missing",
    ).toBeTruthy();
  });

  for (const { fn, file, must, reason } of SAVE_REFRESH_CONNECTIONS) {
    it(`${fn}() (${file}) calls ${must}() (${reason})`, () => {
      const body = extractFn(readSrc(file), fn);
      expect(body, `${fn}() not found in ${file}`).toBeTruthy();
      const called = new RegExp("\\b" + must + "\\s*\\(").test(body || "");
      expect(
        called,
        `${fn}() does not call ${must}() - Dashboard KPIs will go stale when its data changes`,
      ).toBe(true);
    });
  }
});

describe("connection manifest: savings-pots planners recompute the log", () => {
  for (const { fn, file, must, reason } of PLAN_RECOMPUTE_CONNECTIONS) {
    it(`${fn}() (${file}) recomputes via ${must}() (${reason})`, () => {
      const body = extractFn(readSrc(file), fn);
      expect(body, `${fn}() not found in ${file}`).toBeTruthy();
      const called = new RegExp("\\b" + must + "\\s*\\(").test(body || "");
      expect(
        called,
        `${fn}() does not call ${must}() - editing a recurring cost won't update the savings log`,
      ).toBe(true);
    });
  }
});

describe("connection manifest: internal consistency", () => {
  it("field connections are derived 1:1 from the form-bound schema fields", () => {
    // pending id is the p-prefixed txn id for every field.
    for (const c of FIELD_CONNECTIONS) {
      expect(c.pendingInput).toBe("p" + c.txnInput.slice(1));
    }
  });
  it("required render calls are unique", () => {
    const calls = requiredRenderCalls();
    expect(new Set(calls).size).toBe(calls.length);
  });
  it("save-refresh connections are unique by function name", () => {
    const fns = requiredSaveRefreshes().map((c) => c.fn);
    expect(new Set(fns).size).toBe(fns.length);
  });
  it("plan-recompute connections are unique by function name", () => {
    const fns = requiredPlanRecomputes().map((c) => c.fn);
    expect(new Set(fns).size).toBe(fns.length);
  });
});

// Guard against derived-surface DRIFT: any code that emits the transaction CSV
// (export AND the downloadable template) must build its columns from the schema
// (csvHeader / txnToCsvRow), never a hand-typed column list. This is the class
// of bug where the template silently omitted a newly-added field ("orderid").
describe("no schema drift: CSV-emitting code binds to the schema", () => {
  const IMPORT_JS = read("js/06b-import.js");

  it("the transactions template is generated from the schema (csvHeader), not a hardcoded header", () => {
    // Locate the dlTxnTemplate handler body.
    const start = IMPORT_JS.indexOf('dlTxnTemplate").onclick');
    expect(start, "dlTxnTemplate handler not found").toBeGreaterThan(-1);
    const body = IMPORT_JS.slice(start, start + 1200);
    // Must derive the header from the schema...
    expect(
      /csvHeader\(\)/.test(body),
      "template must call csvHeader() so new fields appear automatically",
    ).toBe(true);
    // ...and must NOT hardcode the old column list.
    expect(
      /"date,ticker,action,qty,price,pea,opcvm,total,broker"/.test(IMPORT_JS),
      "template must not hardcode the CSV header string",
    ).toBe(false);
  });

  it("CSV export is generated from the schema (csvHeader + txnToCsvRow)", () => {
    const start = IMPORT_JS.indexOf('exportCsv").onclick');
    expect(start, "exportCsv handler not found").toBeGreaterThan(-1);
    const body = IMPORT_JS.slice(start, start + 800);
    expect(/csvHeader\(\)/.test(body)).toBe(true);
    expect(/txnToCsvRow\(/.test(body)).toBe(true);
  });
});

// General drift net: scan the actual UI source for a HARDCODED transaction CSV
// header - i.e. a string literal that lists 3+ schema column names in a row,
// comma- or tab-separated. Any such literal is a place that will silently go
// stale when a field is added (exactly how the template dropped "orderid").
// The ONLY legitimate home for the column list is the schema module, so the
// UI files (js/*.js) must contain none. If this fails, replace the hardcoded
// list with __core.txnSchema.csvHeader() (or requiredCsvColumns() for prose).
describe("no schema drift: UI source contains no hardcoded transaction CSV header", () => {
  const UI_FILES = [
    "js/01-core.js",
    "js/02-compute.js",
    "js/03-signals.js",
    "js/04-render.js",
    "js/05-rebalance.js",
    "js/06-features.js",
    "js/06b-import.js",
    "js/06c-backup.js",
    "js/06d-pending.js",
    "js/07-expenses.js",
    "js/08-salary.js",
    "js/09-boot.js",
  ];
  // Column names that identify the transaction shape.
  const COLS = csvHeader(); // e.g. date,ticker,action,qty,price,pea,opcvm,total,broker,orderid,...
  const COLSET = new Set(COLS.map((c) => c.toLowerCase()));

  // A "hardcoded header" = a run of >=3 known column tokens separated only by
  // commas or tabs (allowing surrounding quotes/space). We look inside string
  // literals for a comma/tab list where >=3 tokens are schema columns.
  function findHardcodedHeader(src) {
    // Grab quoted string literals (single/double), then test their contents.
    const strs = src.match(/"[^"\n]*"|'[^'\n]*'/g) || [];
    for (const raw of strs) {
      const inner = raw.slice(1, -1);
      if (!/[,\t]/.test(inner)) continue;
      const tokens = inner
        .split(/[,\t]/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      if (tokens.length < 3) continue;
      let run = 0,
        best = 0;
      for (const t of tokens) {
        if (COLSET.has(t)) {
          run++;
          best = Math.max(best, run);
        } else run = 0;
      }
      if (best >= 3) return inner;
    }
    return null;
  }

  for (const rel of UI_FILES) {
    it(`${rel} has no hardcoded transaction CSV header`, () => {
      const hit = findHardcodedHeader(read(rel));
      expect(
        hit,
        hit
          ? `${rel} contains a hardcoded transaction column list ("${hit}") - derive it from __core.txnSchema.csvHeader() instead`
          : "",
      ).toBeNull();
    });
  }
});
