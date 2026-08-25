# Casablanca coverage test v4 - find the CURRENT data endpoint.
#
# Run 3: the old bourseweb/Societe-Cote.aspx endpoint returns 200 but only 244
# bytes (dead/placeholder). The site was rebuilt as a modern SPA at
# casablanca-bourse.com/fr/live-market/... which must call a JSON API. The SSL
# cert chain is genuinely incomplete (fails in CI AND elsewhere), so we use an
# unverified context for this DIAGNOSTIC probe only.
#
# This script: (1) dumps the old endpoint's 244-byte body so we see what it is;
# (2) tries a set of candidate modern API URLs and prints status + a snippet of
# each, so we can identify the real data source. No app data touched.

import ssl
import json
import urllib.request

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def get(url, headers=None):
    h = {"User-Agent": "Mozilla/5.0", "Accept": "application/json,text/html,*/*"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=30, context=CTX) as r:
            body = r.read().decode("utf-8", errors="replace")
            return r.status, r.headers.get("Content-Type", ""), body
    except Exception as e:
        return None, "", f"{type(e).__name__}: {e}"


def show(label, url, headers=None, maxlen=600):
    status, ctype, body = get(url, headers)
    print(f"\n--- {label} ---")
    print(f"URL: {url}")
    print(
        f"status={status} content-type={ctype} len={len(body) if body else 0}")
    if body:
        print("body[:%d]:" % maxlen)
        print(body[:maxlen])


def main():
    # 1) What is the old endpoint actually returning?
    show("OLD bourseweb (ATW code 8200)",
         "https://www.casablanca-bourse.com/bourseweb/Societe-Cote.aspx?codeValeur=8200&cat=7")

    # 2) Candidate modern API endpoints (guesses based on the SPA site structure).
    candidates = [
        # common CMS/SPA data patterns
        "https://www.casablanca-bourse.com/api/proxy/fr/api/bourse/dashboard/listing?",
        "https://www.casablanca-bourse.com/api/bourse/dashboard/listing",
        "https://www.casablanca-bourse.com/api/proxy/fr/api/bourse/dashboard/index_watch",
        "https://www.casablanca-bourse.com/fr/api/live-market/marche-actions-listing",
        "https://www.casablanca-bourse.com/api/live-market/marche-actions-listing",
        "https://api.casablanca-bourse.com/api/instruments",
        "https://www.casablanca-bourse.com/api/instruments",
        # the front page HTML (to grep for the api base it calls)
        "https://www.casablanca-bourse.com/fr/live-market/marche-actions-listing",
    ]
    for i, u in enumerate(candidates):
        show(f"candidate {i+1}", u)


if __name__ == "__main__":
    main()
