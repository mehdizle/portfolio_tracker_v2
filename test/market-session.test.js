// Tests for the pure Casablanca session logic (src/core/market-session.js).
// The UI owns "what time is it" (Intl); this verifies phase classification and
// the headline label for representative minutes-of-day, so a schedule typo or
// off-by-one in the boundaries is caught in CI.
import { describe, it, expect } from "vitest";
import {
  MARKET_GROUPS,
  toMins,
  fmtRange,
  classifyPhases,
  overallLabel,
} from "../src/core/market-session.js";

const CONT = MARKET_GROUPS.find((g) => g.id === "continuous").phases;
const FIX = MARKET_GROUPS.find((g) => g.id === "fixing").phases;
const at = (hhmm) => toMins(hhmm);
const stateOf = (phases, mins, key, open = true) =>
  classifyPhases(phases, mins, open).find((p) => p.key === key).state;

describe("toMins / fmtRange", () => {
  it("parses HH:MM to minutes since midnight", () => {
    expect(toMins("00:00")).toBe(0);
    expect(toMins("08:10")).toBe(490);
    expect(toMins("15:30")).toBe(930);
  });
  it("formats a range and a point phase", () => {
    expect(fmtRange({ start: "09:00", end: "09:30" })).toContain("09:00");
    expect(fmtRange({ start: "09:00", end: "09:30" })).toContain("09:30");
    expect(fmtRange({ start: "14:30", end: "14:30", point: true })).toBe(
      "14:30",
    );
  });
});

describe("classifyPhases (Group 1 Continuous)", () => {
  it("mid-continuous-trading: that phase is now, earlier past, later upcoming", () => {
    const m = at("11:00");
    expect(stateOf(CONT, m, "continuous")).toBe("now");
    expect(stateOf(CONT, m, "preopen")).toBe("past");
    expect(stateOf(CONT, m, "openauct")).toBe("past");
    expect(stateOf(CONT, m, "closeauct")).toBe("upcoming");
    expect(stateOf(CONT, m, "tal")).toBe("upcoming");
  });
  it("boundaries are half-open [start, end): 09:30 is continuous, not opening auction", () => {
    const m = at("09:30");
    expect(stateOf(CONT, m, "openauct")).toBe("past");
    expect(stateOf(CONT, m, "continuous")).toBe("now");
  });
  it("before open: everything upcoming; after close: everything past", () => {
    const pre = at("07:00");
    expect(CONT.every((p) => stateOf(CONT, pre, p.key) === "upcoming")).toBe(
      true,
    );
    const post = at("16:00");
    expect(CONT.every((p) => stateOf(CONT, post, p.key) === "past")).toBe(true);
  });
});

describe("classifyPhases (Group 3 Fixing)", () => {
  it("the fixing is a point: 'now' only exactly at 14:30", () => {
    expect(stateOf(FIX, at("14:30"), "fixing")).toBe("now");
    expect(stateOf(FIX, at("14:29"), "fixing")).toBe("upcoming");
    expect(stateOf(FIX, at("14:31"), "fixing")).toBe("past");
  });
  it("accumulation runs the morning; post-fixing after 14:30", () => {
    expect(stateOf(FIX, at("10:00"), "accum")).toBe("now");
    expect(stateOf(FIX, at("15:00"), "postfix")).toBe("now");
  });
});

describe("classifyPhases when market closed (weekend/holiday)", () => {
  it("nothing is 'now'; upcoming before open, past after", () => {
    const closed = classifyPhases(CONT, at("11:00"), false);
    expect(closed.some((p) => p.state === "now")).toBe(false);
    expect(closed.every((p) => p.state === "past")).toBe(true); // 11:00 is after 08:10 open
    const early = classifyPhases(CONT, at("06:00"), false);
    expect(early.every((p) => p.state === "upcoming")).toBe(true);
  });
});

describe("overallLabel", () => {
  it("weekend -> closed", () => {
    expect(overallLabel(at("11:00"), true)).toContain("Closed");
  });
  it("before 08:10 -> pre-market; after 15:45 -> closed", () => {
    expect(overallLabel(at("07:00"), false)).toBe("Pre-market");
    expect(overallLabel(at("16:00"), false)).toBe("Closed");
  });
  it("during the day -> the continuous phase label", () => {
    expect(overallLabel(at("11:00"), false)).toBe("Continuous Trading");
    expect(overallLabel(at("08:30"), false)).toBe("Pre-Opening");
    expect(overallLabel(at("15:25"), false)).toBe("Closing Auction");
  });
});
