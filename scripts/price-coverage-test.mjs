// Coverage test (throwaway/diagnostic): checks which Casablanca tickers return
// usable PRICE + FUNDAMENTALS data from free sources. Run via the
// "Price source coverage test" workflow (manual trigger). Prints a report to
// the Actions log. Does NOT modify any app data.
//
// Source tested: Yahoo Finance public chart + quoteSummary endpoints, using the
// ".CS" suffix Yahoo uses for Casablanca-listed equities. No API key needed.
// Runs from GitHub's runners (not a rate-limited dev sandbox), once per trigger.

const EQUITIES = [
  "AFI","AKT","ALM","ATW","BCP","CAP","CFG","CSR","DYT","GTM","IAM","IMO",
  "LHM","MAB","MLE","MUT","NKL","RIS","S2M","SAH","SBM","T2S","TMA",
];

// Yahoo sometimes uses different suffixes; we try a few and report which works.
const SUFFIXES = [".CS", ".CAS", ""];

async function tryJson(url) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (coverage-test)" },
    });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, data: await r.json() };
  } catch (e) {
    return { ok: false, err: String(e) };
  }
}

async function priceFor(symbol) {
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) +
    "?interval=1d&range=5d";
  const res = await tryJson(url);
  if (!res.ok) return { found: false, status: res.status || res.err };
  const r = res.data && res.data.chart && res.data.chart.result;
  const meta = r && r[0] && r[0].meta;
  if (meta && typeof meta.regularMarketPrice === "number")
    return { found: true, price: meta.regularMarketPrice, currency: meta.currency };
  return { found: false, status: "no price in payload" };
}

async function fundamentalsFor(symbol) {
  const url =
    "https://query1.finance.yahoo.com/v10/finance/quoteSummary/" +
    encodeURIComponent(symbol) +
    "?modules=summaryDetail,defaultKeyStatistics,financialData";
  const res = await tryJson(url);
  if (!res.ok) return { ok: false };
  const q =
    res.data &&
    res.data.quoteSummary &&
    res.data.quoteSummary.result &&
    res.data.quoteSummary.result[0];
  if (!q) return { ok: false };
  const sd = q.summaryDetail || {};
  const ks = q.defaultKeyStatistics || {};
  const pick = (o, k) => (o && o[k] && o[k].raw != null ? o[k].raw : null);
  return {
    ok: true,
    pe: pick(sd, "trailingPE"),
    pb: pick(ks, "priceToBook"),
    divYield: pick(sd, "dividendYield"),
    eps: pick(ks, "trailingEps"),
    mcap: pick(sd, "marketCap"),
  };
}

async function main() {
  console.log("=== Casablanca ticker coverage test (Yahoo Finance) ===\n");
  const rows = [];
  for (const tk of EQUITIES) {
    let hit = null;
    for (const suf of SUFFIXES) {
      const sym = tk.replace(/\s+/g, "") + suf;
      const p = await priceFor(sym);
      if (p.found) {
        const f = await fundamentalsFor(sym);
        hit = { tk, sym, price: p.price, currency: p.currency, f };
        break;
      }
      await new Promise((r) => setTimeout(r, 300)); // be gentle
    }
    if (hit) {
      const f = hit.f.ok ? hit.f : {};
      rows.push(
        `${hit.tk.padEnd(8)} OK  sym=${hit.sym.padEnd(10)} px=${hit.price} ${hit.currency || ""}` +
          `  PE=${f.pe ?? "-"} PB=${f.pb ?? "-"} divY=${f.divYield ?? "-"} EPS=${f.eps ?? "-"}`,
      );
    } else {
      rows.push(`${tk.padEnd(8)} MISS (no price on any suffix)`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(rows.join("\n"));
  const okCount = rows.filter((r) => r.includes(" OK ")).length;
  console.log(`\n=== ${okCount}/${EQUITIES.length} equities have a price ===`);
}

main();
