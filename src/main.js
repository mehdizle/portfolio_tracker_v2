// Vite entry point (v2).
//
// Import order matters and is guaranteed by the ES spec (imported modules are
// evaluated in the order their import statements appear):
//   1. styles.css              - styling
//   2. core-bridge.js          - sets globalThis.__core (tested financial core)
//   3. app-core.generated.js   - the UI bundle; runs on import and calls __core
//
// This bridge lets the large, proven UI delegate its fee/tax/FIFO math to the
// NEW, unit-tested, integer-cents core without rewriting its ~350 call sites.
import "../styles.css";
import "./core-bridge.js";
import "./app-core.generated.js";
