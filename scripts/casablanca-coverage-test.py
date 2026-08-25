# Casablanca-native coverage test (diagnostic, manual-run only).
#
# Tests whether BVCscrap (scrapes Bourse de Casablanca / LeBoursier.ma) can
# return CORRECT MAD prices + fundamentals for YOUR tickers. Prints a report to
# the Actions log. Does NOT modify app data.
#
# BVCscrap uses full company NAMES (bvc.notation()), not ticker symbols, so we
# fuzzy-match each of your tickers (by its known company name) to the library's
# name list, then pull price + key indicators.
#
# NOTE: BVCscrap is community-maintained (its README asks for new maintainers),
# so treat this as a feasibility probe, not a guarantee of long-term stability.

import sys
import difflib

# Your tickers -> the company name to match against BVCscrap's notation() list.
# (names taken from your master data; matching is fuzzy so close is fine)
TICKER_NAMES = {
    "AFI": "Afric Industries",
    "AKT": "Akdital",
    "ALM": "Aluminium du Maroc",
    "ATW": "Attijariwafa Bank",
    "BCP": "Banque Centrale Populaire",
    "CAP": "Cash Plus",
    "CFG": "CFG Bank",
    "CSR": "Cosumar",
    "DYT": "Disty Technologies",
    "GTM": "Societe Generale des Travaux du Maroc",
    "IAM": "Itissalat Al-Maghrib",
    "IMO": "Immorente Invest",
    "LHM": "Lafargeholcim Maroc",
    "MAB": "Maghrebail",
    "MLE": "Maroc Leasing",
    "MUT": "Mutandis",
    "NKL": "Ennakl",
    "RIS": "Risma",
    "S2M": "S2M",
    "SAH": "Sanlam Maroc",
    "SBM": "Societe des Boissons du Maroc",
    "T2S": "T2S",
    "TMA": "TotalEnergies Marketing Maroc",
}

def main():
    try:
        import BVCscrap as bvc
    except Exception as e:
        print("Could not import BVCscrap:", e)
        sys.exit(1)

    # 1. Get the library's canonical name list.
    try:
        names = list(bvc.notation())
    except Exception as e:
        print("bvc.notation() failed:", e)
        names = []
    print(f"BVCscrap notation() returned {len(names)} names\n")

    # 2. For each ticker, fuzzy-match to a name and try to fetch price + indicators.
    ok = 0
    for tk, want in TICKER_NAMES.items():
        match = None
        if names:
            cand = difflib.get_close_matches(want, names, n=1, cutoff=0.5)
            # also try a looser contains-match
            if not cand:
                lw = want.lower()
                cand = [n for n in names if lw[:6] in n.lower()]
            match = cand[0] if cand else None

        if not match:
            print(f"{tk:5} NO NAME MATCH (wanted ~'{want}')")
            continue

        price = None
        try:
            df = bvc.loadata(match)
            if df is not None and len(df):
                # last row's 'Value' column = latest close
                price = float(df["Value"].iloc[-1])
        except Exception as e:
            price = None

        pe = pb = None
        try:
            ind = bvc.getKeyIndicators(match)
            blob = str(ind).lower()
            # crude presence check for PER/PBR-type ratios
            pe = "per" in blob or "p/e" in blob
            pb = "p/b" in blob or "pbr" in blob or "book" in blob
        except Exception:
            pass

        status = "OK " if price is not None else "no price"
        ok += 1 if price is not None else 0
        print(f"{tk:5} {status} name='{match}' price={price} fundamentals(PER?={pe} PBR?={pb})")

    print(f"\n=== {ok}/{len(TICKER_NAMES)} tickers returned a MAD price via BVCscrap ===")

if __name__ == "__main__":
    main()
