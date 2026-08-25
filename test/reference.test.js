// Reference test: run the financial core against a SYNTHETIC dataset (no
// personal data) and hard-assert the exact computed totals. These locked
// numbers turn "I checked once" into "checked forever": any future change that
// shifts a value by even a centime fails CI.
//
// The synthetic fixture exercises the same code paths as real use:
//   - multi-lot FIFO (two AAA buys at different prices, partial sell)
//   - regular vs PEA account independence (BBB is PEA -> no capital-gains tax)
//   - OPCVM fractional quantity (FND, 0.5 units, fund % + surcharge)
//   - a dividend (AAA DIV, regular -> withholding tax)
//
// Expected values were computed from the core's own formulas. If you change a
// fee/tax/FIFO rule on purpose, update these numbers deliberately.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runFIFO, portfolioTotals } from "../src/core/fifo.js";
import {
  FP_DEFAULT,
  FP_PEA_DEFAULT,
  BROKER_DEFAULTS,
  DIVTAX_DEFAULT,
} from "../src/core/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "synthetic.json"), "utf8"),
);

const CTX = {
  master: fx.master,
  brokers: fx.brokers || BROKER_DEFAULTS,
  fp: FP_DEFAULT,
  fpPea: { ...FP_PEA_DEFAULT, ...(fx.fpPea || {}) },
  divtax: Object.keys(fx.divtax || {}).length ? fx.divtax : DIVTAX_DEFAULT,
};

describe("reference (synthetic data): locked totals", () => {
  it("portfolio totals match the locked reference values", () => {
    const t = portfolioTotals(fx.txns, CTX);
    expect(t.invested).toBe(2022.55);
    expect(t.value).toBe(1200.0);
    expect(t.realized).toBe(1914.24);
    expect(t.divs).toBe(39.87);
    expect(t.unreal).toBe(-822.55);
    expect(t.lifetime).toBe(1131.56);
  });

  it("per-account positions are correct (FIFO, PEA split, OPCVM)", () => {
    const { pos } = runFIFO(fx.txns, CTX);
    // AAA regular: sold the oldest 10 (100-cost lot), 10 remain (200-cost lot).
    // Status is "Partial": still holding shares AND has realized a gain.
    expect(pos["AAA||REG"].held).toBe(10);
    expect(pos["AAA||REG"].status).toBe("Partial");
    expect(pos["AAA||REG"].realized).toBe(1737.41);
    expect(pos["AAA||REG"].divs).toBe(39.87);
    // BBB PEA: fully sold, no capital-gains tax (PEA exempt).
    expect(pos["BBB||PEA"].held).toBe(0);
    expect(pos["BBB||PEA"].status).toBe("Closed");
    expect(pos["BBB||PEA"].realized).toBe(168.54);
    // FND OPCVM: fractional 0.5 units, fully sold, no residual dust.
    expect(Math.abs(pos["FND||REG"].held)).toBeLessThan(1e-9);
    expect(pos["FND||REG"].status).toBe("Closed");
    expect(pos["FND||REG"].realized).toBe(8.29);
  });

  it("is deterministic", () => {
    expect(portfolioTotals(fx.txns, CTX)).toEqual(
      portfolioTotals(fx.txns, CTX),
    );
  });

  it("produces no NaN money values", () => {
    const { pos, enriched } = runFIFO(fx.txns, CTX);
    for (const k in pos) {
      for (const f of [
        "held",
        "avg",
        "invested",
        "value",
        "unreal",
        "realized",
        "divs",
        "lifetime",
      ]) {
        expect(Number.isNaN(pos[k][f])).toBe(false);
      }
    }
    for (const e of enriched) expect(Number.isNaN(e.net)).toBe(false);
  });
});
