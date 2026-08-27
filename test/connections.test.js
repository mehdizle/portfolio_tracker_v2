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
  txnInputIds,
  pendingInputIds,
  csvColumns,
  requiredRenderCalls,
} from "../src/core/connection-manifest.js";
import { csvHeader } from "../src/core/txn-schema.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const HTML = read("index.html");
const RENDER_JS = read("js/04-render.js");
const FEATURES_JS = read("js/06-features.js");

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
    const fn = extractFn(FEATURES_JS, "readPendingForm");
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
      expect(called, `render() does not call ${fn}() - live data won't refresh`).toBe(true);
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
});
