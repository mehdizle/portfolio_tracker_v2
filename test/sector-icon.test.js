// Coverage test for the sector -> icon mapping (src/core/sector-icon.js).
// Guards against the bug we hit before: multiple distinct sectors collapsing
// onto the same icon. Every real Casablanca sector must resolve to a specific
// (non-default) icon, and the set must be distinct except for known synonyms.
import { describe, it, expect } from "vitest";
import {
  sectorIcon,
  SECTOR_ICON_DEFAULT,
} from "../src/core/sector-icon.js";

// The sector names that actually appear in the master data.
const REAL_SECTORS = [
  "Agri-Services / Industrial",
  "Automotive",
  "Banking",
  "Beverages",
  "Building Materials",
  "Chemicals",
  "Construction",
  "Consumer Goods",
  "Energy",
  "Financial Services",
  "Food Producers",
  "Forestry & Paper",
  "Healthcare",
  "Holding",
  "Industrial Goods",
  "Insurance",
  "Mining",
  "OPCVM",
  "Real Estate",
  "Real Estate (REIT)",
  "Retail",
  "Technology",
  "Telecommunications",
  "Tourism",
  "Transport",
  "Transport & Logistics",
  "Utilities",
];

// Sectors that legitimately share an icon (same real-world category, naming
// variants only). Everything else must be distinct.
const ALLOWED_SHARED = [["Transport", "Transport & Logistics"]];

describe("sectorIcon", () => {
  it("every real sector resolves to a specific (non-default) icon", () => {
    for (const s of REAL_SECTORS) {
      expect(sectorIcon(s), `no icon for "${s}"`).not.toBe(
        SECTOR_ICON_DEFAULT,
      );
    }
  });

  it("distinct sectors get distinct icons (except known synonyms)", () => {
    const byIcon = {};
    for (const s of REAL_SECTORS) {
      const ic = sectorIcon(s);
      (byIcon[ic] || (byIcon[ic] = [])).push(s);
    }
    const collisions = Object.values(byIcon).filter((g) => g.length > 1);
    // Each collision group must be a subset of an ALLOWED_SHARED group.
    for (const g of collisions) {
      const ok = ALLOWED_SHARED.some((allow) =>
        g.every((name) => allow.includes(name)),
      );
      expect(ok, `unexpected shared icon for: ${g.join(", ")}`).toBe(true);
    }
  });

  it("is case-insensitive and keyword-matched on variants", () => {
    expect(sectorIcon("banking")).toBe(sectorIcon("Banking"));
    // REIT must beat the generic 'real estate' rule (ordered first).
    expect(sectorIcon("Real Estate (REIT)")).not.toBe(
      sectorIcon("Real Estate"),
    );
    // Building Materials must not collide with Construction.
    expect(sectorIcon("Building Materials")).not.toBe(
      sectorIcon("Construction"),
    );
    // Financial Services must not collide with Banking.
    expect(sectorIcon("Financial Services")).not.toBe(sectorIcon("Banking"));
  });

  it("unknown / empty sector -> default tag", () => {
    expect(sectorIcon("Something Unknown")).toBe(SECTOR_ICON_DEFAULT);
    expect(sectorIcon("")).toBe(SECTOR_ICON_DEFAULT);
    expect(sectorIcon(null)).toBe(SECTOR_ICON_DEFAULT);
  });
});
