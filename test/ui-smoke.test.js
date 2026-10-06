// @vitest-environment jsdom
//
// UI SMOKE TESTS - the first automated coverage of the UI layer.
//
// Everything else under test/ exercises the pure src/core modules. The UI
// (js/*.js, concatenated into one shared-scope IIFE) had ZERO automated tests,
// so a refactor there could white-screen the app and CI wouldn't notice. These
// smoke tests close that gap at the highest-value level: they load the REAL
// index.html body + the REAL concatenated bundle into jsdom (with __core wired
// exactly like production via core-bridge.js) and assert the app boots, wires
// its handlers, and survives real + corrupt data without throwing.
//
// Lenient by design (boot-doesn't-throw + handler wiring), not snapshot
// assertions - robust to harmless output changes, but still catches the real
// regression class: "something broke the boot path".
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// core-bridge sets globalThis.__core. Import it ONCE at module load (ES module
// imports are cached/singleton), so __core is populated for every test. We must
// NOT delete it between tests - the cached import won't re-run to recreate it.
await import("../src/core-bridge.js");

// Build the concatenated UI bundle source the same way scripts/concat.mjs does
// - including the EXPOSE block it appends INSIDE the IIFE to publish bare
// inline-handler functions to window. Mirroring that block is what makes the
// "handlers published to window" assertion meaningful.
function buildBundleSource() {
  const concat = readFileSync(join(root, "scripts", "concat.mjs"), "utf8");
  // The numbered js/*.js entries from the `files` array.
  const filesBlock = concat.match(/const files = \[(.*?)\];/s)[1];
  const files = [...filesBlock.matchAll(/"([^"]+\.js)"/g)].map((m) => m[1]);
  const parts = files.map((f) => readFileSync(join(root, "js", f), "utf8"));
  // The EXPOSE list -> the same `if (typeof X === "function") window.X = X;`
  // block concat.mjs emits inside the IIFE.
  const exposeBlock = concat.match(/const EXPOSE = \[(.*?)\];/s)[1];
  const expose = [...exposeBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const exposeSrc = expose
    .map((n) => `if (typeof ${n} === "function") window.${n} = ${n};`)
    .join("\n");
  // __APP_VERSION__ is a build-time define; __core is a global the bundle reads
  // as a BARE identifier, so alias it from globalThis at the top of the eval'd
  // scope. Wrap in the same IIFE the real build uses, with the expose block
  // appended inside it exactly like scripts/concat.mjs.
  return (
    "const __APP_VERSION__ = 'test';\n" +
    "const __core = globalThis.__core;\n" +
    "(function(){\n" +
    parts.join("\n") +
    "\n" +
    exposeSrc +
    "\n})();\n"
  );
}

// Use the REAL <body> from index.html so every element the (defensive but
// element-touching) boot path looks up actually exists. We strip <script> tags
// (Highcharts CDN etc. - not needed; the bundle only calls Highcharts lazily).
// Strip via proper DOM PARSING, not a regex: a regex HTML filter is both
// defeatable and flagged by CodeQL (js/bad-tag-filter) - parsing the document
// and removing <script> nodes is correct and alert-free.
function realBodyHtml() {
  const html = readFileSync(join(root, "index.html"), "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script").forEach((s) => s.remove());
  return doc.body ? doc.body.innerHTML : "";
}

const BODY_HTML = realBodyHtml();

function loadApp() {
  document.body.innerHTML = BODY_HTML;
  const src = buildBundleSource();
  // Indirect eval runs the bundle in global scope, mirroring how the real
  // <script> bundle executes against window/document/localStorage.
  (0, eval)(src);
}

describe("UI smoke: boot resilience", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    // NOTE: deliberately do NOT delete globalThis.__core (see import note above).
  });

  it("evaluates the concatenated bundle without throwing (app boots)", () => {
    expect(() => loadApp()).not.toThrow();
  });

  it("publishes inline-handler targets to window (data-act dispatch)", () => {
    loadApp();
    // A representative sample of the EXPOSE list from concat.mjs.
    expect(typeof window.gotoTab).toBe("function");
    expect(typeof window.editCashRow).toBe("function");
  });

  it("boots with a SEEDED portfolio without throwing (load + restore + wiring)", () => {
    localStorage.setItem(
      "casa_portfolio_txns_v1",
      JSON.stringify([
        {
          date: "2026-01-05",
          ticker: "ATW",
          action: "BUY",
          qty: 10,
          price: 500,
          pea: false,
          broker: "saham",
        },
      ]),
    );
    localStorage.setItem(
      "casa_master_v1",
      JSON.stringify({
        ATW: {
          name: "Attijariwafa Bank",
          cat: "Banking",
          cycle: "Cyclical",
          style: "Compounder",
          price: 520,
        },
      }),
    );
    expect(() => loadApp()).not.toThrow();
    // __core must be wired for the UI to delegate its math.
    expect(globalThis.__core).toBeTruthy();
    expect(typeof globalThis.__core.fifo.runFIFO).toBe("function");
  });

  it("survives corrupt localStorage without throwing (resilience)", () => {
    // The app's loaders are corruption-safe (safeParseLS quarantines bad data),
    // so boot should NOT throw even on garbage. (It logs a corruption warning;
    // that's expected and not a failure.)
    localStorage.setItem("casa_portfolio_txns_v1", "{ not valid json ]");
    localStorage.setItem("casa_master_v1", "garbage");
    expect(() => loadApp()).not.toThrow();
  });
});
