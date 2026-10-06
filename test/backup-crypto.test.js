// Tests for the optional password encryption of backups
// (src/core/backup-crypto.js). Exercises the REAL WebCrypto code path:
// PBKDF2-SHA256 key derivation + AES-GCM encrypt/decrypt round-trip, wrong-
// password rejection, tamper detection, and envelope detection.
//
// Runs under vitest's "node" environment (vite.config.js). Node >= 18 exposes
// globalThis.crypto (Web Crypto), btoa/atob and TextEncoder/TextDecoder, which
// is everything backup-crypto.js uses - so these run with no browser/jsdom.
import { describe, it, expect } from "vitest";
import {
  encryptBackup,
  decryptBackup,
  isEncryptedBackup,
} from "../src/core/backup-crypto.js";

// A representative backup payload: nested objects, arrays, unicode, numbers.
const sample = {
  _app: "casa_portfolio_tracker",
  txns: [
    { date: "2026-01-02", ticker: "ATW", action: "BUY", qty: 10, price: 678.5 },
    { date: "2026-03-01", ticker: "IAM", action: "DIV", qty: 20, price: 3.1 },
  ],
  master: {
    ATW: { name: "Attijariwafa Bank \u2014 \u00e9\u00e8\u00e7", cat: "Banks" },
  },
  cash: 12345.67,
  note: "unicode: \u0634\u0631\u0643\u0629 \uD83D\uDCC8",
};

describe("backup-crypto: envelope detection", () => {
  it("isEncryptedBackup is false for a plain object / junk", () => {
    expect(isEncryptedBackup(sample)).toBe(false);
    expect(isEncryptedBackup(null)).toBe(false);
    expect(isEncryptedBackup({})).toBe(false);
    expect(isEncryptedBackup({ _type: "casa_encrypted_backup" })).toBe(false); // missing ct/iv/salt
  });

  it("isEncryptedBackup is true for a produced envelope", async () => {
    const env = await encryptBackup(sample, "hunter2");
    expect(isEncryptedBackup(env)).toBe(true);
  });
});

describe("backup-crypto: encrypt envelope shape", () => {
  it("produces a self-describing, JSON-serialisable envelope (no plaintext leak)", async () => {
    const env = await encryptBackup(sample, "pw");
    expect(env._type).toBe("casa_encrypted_backup");
    expect(env.kdf).toBe("PBKDF2-SHA256");
    expect(env.iterations).toBe(250000);
    // salt/iv/ct are base64 strings and present
    for (const k of ["salt", "iv", "ct"]) {
      expect(typeof env[k]).toBe("string");
      expect(env[k].length).toBeGreaterThan(0);
    }
    // The envelope must NOT leak recognisable payload plaintext in its
    // STRUCTURAL (non-ciphertext) fields. We exclude salt/iv/ct from this probe
    // on purpose: those are random base64 blobs, and a short plaintext token
    // (e.g. "BUY") can appear in random base64 BY CHANCE - asserting its
    // absence there made this test intermittently fail. The real guarantee is
    // that no plaintext lands OUTSIDE the ciphertext, so probe the envelope with
    // the opaque random fields removed.
    const { salt, iv, ct, ...structural } = env;
    const blob = JSON.stringify(structural);
    expect(blob).not.toContain("Attijariwafa"); // a master name
    expect(blob).not.toContain("BUY"); // a txn action
    expect(blob).not.toContain("12345.67"); // the cash figure
    // and the ciphertext itself must be non-empty base64 (already asserted
    // above) - its opaque contents are validated by the round-trip/decrypt
    // tests, not by substring probing random bytes.
    // round-trippable as a .json file
    expect(() => JSON.parse(JSON.stringify(env))).not.toThrow();
  });

  it("uses a fresh random salt + iv each call (no reuse)", async () => {
    const a = await encryptBackup(sample, "pw");
    const b = await encryptBackup(sample, "pw");
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct); // different iv -> different ciphertext
  });
});

describe("backup-crypto: round-trip", () => {
  it("decrypt(encrypt(x, pw), pw) === x (deep equal, unicode preserved)", async () => {
    const env = await encryptBackup(sample, "s3cret-\u00e9\u00e8");
    const out = await decryptBackup(env, "s3cret-\u00e9\u00e8");
    expect(out).toEqual(sample);
  });

  it("handles an empty object and arrays", async () => {
    for (const payload of [{}, { a: [] }, { list: [1, 2, 3], flag: false }]) {
      const env = await encryptBackup(payload, "pw");
      expect(await decryptBackup(env, "pw")).toEqual(payload);
    }
  });
});

describe("backup-crypto: wrong password / tamper", () => {
  it("rejects a wrong password with a friendly error", async () => {
    const env = await encryptBackup(sample, "correct-horse");
    await expect(decryptBackup(env, "wrong-horse")).rejects.toThrow(
      /wrong password or corrupted/i,
    );
  });

  it("rejects tampered ciphertext (AES-GCM auth failure)", async () => {
    const env = await encryptBackup(sample, "pw");
    // Flip the last base64 char of the ciphertext.
    const last = env.ct.slice(-1);
    const flipped = last === "A" ? "B" : "A";
    const tampered = { ...env, ct: env.ct.slice(0, -1) + flipped };
    await expect(decryptBackup(tampered, "pw")).rejects.toThrow();
  });

  it("decryptBackup rejects a non-envelope input", async () => {
    await expect(decryptBackup({ foo: "bar" }, "pw")).rejects.toThrow(
      /not an encrypted backup/i,
    );
  });
});
