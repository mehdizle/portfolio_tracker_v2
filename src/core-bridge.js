// Core bridge: sets globalThis.__core BEFORE the UI bundle evaluates.
//
// ES modules evaluate imported modules in import order, so main.js imports THIS
// module before it imports ./app-core.generated.js. That guarantees __core is
// populated by the time the UI bundle's IIFE runs and calls into it.
import * as money from "./core/money.js";
import * as fees from "./core/fees.js";
import * as tax from "./core/tax.js";
import * as fifo from "./core/fifo.js";
import * as backupCrypto from "./core/backup-crypto.js";
import {
  FP_DEFAULT,
  FP_PEA_DEFAULT,
  BROKER_DEFAULTS,
  DIVTAX_DEFAULT,
} from "./core/config.js";

globalThis.__core = {
  money,
  fees,
  tax,
  fifo,
  backupCrypto,
  defaults: { FP_DEFAULT, FP_PEA_DEFAULT, BROKER_DEFAULTS, DIVTAX_DEFAULT },
};
