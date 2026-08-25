# Casablanca-native coverage test (diagnostic, manual-run only) - v2.
#
# The first run proved BVCscrap KNOWS the companies (it matched 18/23 names),
# but every loadata() price came back None. This version:
#   1. prints the full notation() name list (so we can map tickers exactly);
#   2. surfaces the ACTUAL error from each price fetch (no silent swallow);
#   3. tries getCours() (live session) AND loadata() (history) for a price.
#
# Does NOT modify app data. BVCscrap is community-maintained (feasibility probe).

import sys
import traceback

TICKER_NAMES = {
    "AFI": "Afric Indus",
    "AKT": "Akdital",
    "ALM": "Aluminium Maroc",
    "ATW": "Attijariwafa",
    "BCP": "Banque Centrale Populaire",
    "CAP": "Cash Plus",
    "CFG": "CFG Bank",
    "CSR": "Cosumar",
    "DYT": "Disty Technolog",
    "GTM": "Travaux du Maroc",
    "IAM": "Maroc Telecom",
    "IMO": "Immr Invest",
    "LHM": "LafargeHolcim",
    "MAB": "Maghrebail",
    "MLE": "Maroc Leasing",
    "MUT": "Mutandis",
    "NKL": "Ennakl",
    "RIS": "Risma",
    "S2M": "S2M",
    "SAH": "Sanlam Maroc",
    "SBM": "Ste Boissons",
    "T2S": "T2S",
    "TMA": "Total Maroc",
}


def find_name(want, names):
    import difflib
    lw = want.lower()
    # exact-ish contains first
    for n in names:
        if lw in n.lower() or n.lower() in lw:
            return n
    cand = difflib.get_close_matches(want, names, n=1, cutoff=0.45)
    return cand[0] if cand else None


def try_price(bvc, name):
    """Return (price, method, error_str)."""
    # 1) live session via getCours
    try:
        c = bvc.getCours(name)
        # inspect structure once
        if isinstance(c, dict):
            ds = (
                c.get("Donnees_Seance")
                or c.get("Donn\u00e9es_Seance")
            )
            if ds is not None:
                return (repr(ds)[:200], "getCours.Donnees_Seance", None)
            return (None, "getCours(keys=%s)" % list(c.keys()), None)
    except Exception as e:
        cours_err = f"{type(e).__name__}: {e}"
    else:
        cours_err = "no dict"
    # 2) history via loadata
    try:
        df = bvc.loadata(name)
        if df is not None and len(df):
            cols = list(df.columns)
            last = df.iloc[-1].to_dict()
            return (repr(last)[:200], "loadata cols=%s" % cols, None)
        return (None, "loadata empty", cours_err)
    except Exception as e:
        return (None, "both failed", f"getCours[{cours_err}] loadata[{type(e).__name__}: {e}]")


def main():
    try:
        import BVCscrap as bvc
    except Exception as e:
        print("Could not import BVCscrap:", e)
        sys.exit(1)

    try:
        names = list(bvc.notation())
    except Exception as e:
        print("notation() failed:", e)
        names = []

    print(f"=== notation() returned {len(names)} names ===")
    print(names)
    print("\n=== per-ticker probe ===")
    for tk, want in TICKER_NAMES.items():
        name = find_name(want, names)
        if not name:
            print(f"{tk:5} NO NAME MATCH (wanted ~'{want}')")
            continue
        price, method, err = try_price(bvc, name)
        print(f"{tk:5} name='{name}'")
        print(f"       -> price/sample = {price}")
        print(f"       -> method = {method}")
        if err:
            print(f"       -> error = {err}")


if __name__ == "__main__":
    main()
