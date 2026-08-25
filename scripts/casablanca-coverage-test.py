# Casablanca coverage test v3 - direct official-endpoint probe with proper certs.
#
# Run 2 revealed: the official Bourse de Casablanca endpoint IS reachable and
# knows the companies (correct codeValeur per stock), but Python rejected its
# TLS cert (CERTIFICATE_VERIFY_FAILED). LeBoursier history (loadata) is dead.
#
# This version bypasses BVCscrap's fetch and hits the official page directly,
# using certifi's CA bundle. It probes a few tickers whose codeValeur we learned
# from run 2's log, and prints the raw response status + a snippet so we can see
# whether a real MAD price is present. Diagnostic only; no app data touched.

import ssl
import sys
import re

# codeValeur values observed in run 2's log (official site internal codes).
CODES = {
    "ATW": 8200,   # Attijariwafa
    "IAM": 8001,   # Maroc Telecom
    "CSR": 4100,   # Cosumar
    "LHM": 3800,   # LafargeHolcim
    "BCP": 11600,  # (was mismatched name; code from log - verify)
    "SBM": 10400,  # Ste des Boissons
    "MUT": 21,     # Mutandis
    "IMO": 12,     # Immorente
}


def fetch(url, ctx, label):
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
            body = r.read().decode("utf-8", errors="replace")
            return r.status, body
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"


def main():
    # Build an SSL context that trusts certifi's CA bundle (the usual fix).
    try:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
        print("Using certifi CA bundle:", certifi.where())
    except Exception as e:
        ctx = ssl.create_default_context()
        print("certifi not available, using system default:", e)

    # Also prepare a NO-VERIFY context as a fallback diagnostic (tells us if the
    # ONLY problem is the cert chain vs. the endpoint being gone).
    noverify = ssl.create_default_context()
    noverify.check_hostname = False
    noverify.verify_mode = ssl.CERT_NONE

    base = "https://www.casablanca-bourse.com/bourseweb/Societe-Cote.aspx?codeValeur={}&cat=7"
    print("\n=== direct official-endpoint probe ===")
    for tk, code in CODES.items():
        url = base.format(code)
        status, body = fetch(url, ctx, tk)
        mode = "verify(certifi)"
        if status is None:
            # retry without verification to isolate the cause
            status2, body2 = fetch(url, noverify, tk)
            if status2 is not None:
                print(
                    f"{tk:5} code={code}: certifi FAILED but NO-VERIFY worked (status {status2}) -> cert-chain issue only")
                status, body, mode = status2, body2, "no-verify"
            else:
                print(
                    f"{tk:5} code={code}: BOTH failed. certifi_err={body} | noverify_err={body2}")
                continue
        # Look for a price-like number in the page (MAD values, e.g. 706,10 or 706.10)
        snippet = ""
        m = re.search(
            r'(Cours|Dernier|cours)[^0-9]{0,40}([0-9][0-9\s.,]{2,})', body)
        if m:
            snippet = f"matched '{m.group(1)}' -> {m.group(2).strip()[:20]}"
        else:
            snippet = "no obvious price pattern; page len=" + str(len(body))
        print(f"{tk:5} code={code}: status={status} [{mode}] {snippet}")


if __name__ == "__main__":
    main()
