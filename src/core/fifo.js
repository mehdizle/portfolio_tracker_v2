// ============================================================
// fifo.js - computeRow (per-transaction fee/tax) + FIFO engine.
//
// Faithful port of v1's logic with:
//  - integer-cents rounding at money boundaries (fees, tax, net, proceeds, cost);
//  - explicit context object instead of globals (testable);
//  - the same account-split FIFO (ticker + PEA/Regular), same OPCVM/manual-total
//    handling, same avg-cost-for-sell semantics.
//
// ctx = {
//   master,          // M: ticker -> metadata
//   brokers,         // BROKERS
//   fp, fpPea,       // FP, FP_PEA
//   divtax,          // DIVTAX
// }
// ============================================================
import { roundMoney, QTY_EPS } from "./money.js";
import {
  vatRate,
  feeRate,
  fixedFee,
  peaStockFees,
  peaDivFees,
  calcBrokerFees,
  opcvmFee,
} from "./fees.js";
import { divRate, capitalGainsTax, dividendTax } from "./tax.js";

/** Resolve broker id for a transaction (broker field, else pea-based default). */
export function txnBroker(t, brokers) {
  if (t.broker && brokers && brokers[t.broker]) return t.broker;
  return t.pea ? "attijari" : "saham";
}

/**
 * computeRow: fees/tax/net/ttc for one transaction.
 * avgCostForSell = weighted-average cost per share for SELL tax (0 if none).
 * Returns { fees, tax, ttc, net, opcvm, manual? }.
 */
export function computeRow(t, avgCostForSell, ctx) {
  const { master, brokers, fp, fpPea, divtax } = ctx;
  const vat = vatRate(fp);
  const tpcvm = fp && fp.tpcvm != null ? fp.tpcvm : 0.15;
  const gross = roundMoney(t.price * t.qty);
  const yr = new Date(t.date).getFullYear();
  const meta = master ? master[t.ticker] : null;
  const isOpcvm = t.opcvm === true || !!(meta && meta.cat === "OPCVM");

  // Manual Total override (e.g. OPCVM with own fee structure).
  const mt =
    typeof t.total === "number" && isFinite(t.total) && t.total > 0 ? t.total : null;
  if (mt != null) {
    // OPCVM PEA (non-DIV) falls through to standard OPCVM fee path below.
    if (!(isOpcvm && t.pea && t.action !== "DIV")) {
      const feesInfo = roundMoney(Math.abs(gross - mt));
      if (t.action === "BUY")
        return { fees: feesInfo, tax: 0, ttc: mt / t.qty, net: -mt, manual: true, opcvm: isOpcvm };
      return { fees: feesInfo, tax: 0, ttc: mt / t.qty, net: mt, manual: true, opcvm: isOpcvm };
    }
  }

  const brokerId = txnBroker(t, brokers);
  const broker = (brokers && brokers[brokerId]) || null;

  let fees;
  if (isOpcvm) {
    fees = opcvmFee(gross, t.action, meta, mt == null, brokers, vat);
  } else if (t._feeFrozen && t._feeFP) {
    const ffp = t._feeFP;
    const fvat = ffp.vat != null ? ffp.vat : 0.1;
    if (broker && broker.feeType === "pea") {
      fees =
        t.action === "DIV"
          ? peaDivFees(gross, ffp, fvat)
          : peaStockFees(gross, ffp, fvat);
    } else {
      fees = roundMoney(
        gross *
          ((ffp.c_marche || 0) + (ffp.c_interm || 0) + (ffp.c_regl || 0)) *
          (1 + fvat) +
          (ffp.courier || 2.5) * (1 + fvat),
      );
    }
  } else if (broker) {
    fees = calcBrokerFees(gross, t.action, broker, false, vat, fp);
  } else {
    fees = t.pea
      ? t.action === "DIV"
        ? peaDivFees(gross, fpPea, vat)
        : peaStockFees(gross, fpPea, vat)
      : roundMoney(gross * feeRate(fp, vat) + fixedFee(fp, vat));
  }

  if (t.action === "BUY") {
    const net = roundMoney(-(gross + fees));
    return { fees, tax: 0, ttc: (gross + fees) / t.qty, net, opcvm: isOpcvm };
  }
  if (t.action === "DIV") {
    const rate = divRate(yr, divtax, tpcvm);
    const tax = dividendTax(gross, t.pea, vat, rate);
    const net = roundMoney(gross - fees - tax);
    return { fees, tax, ttc: (gross - fees - tax) / t.qty, net, opcvm: isOpcvm };
  }
  // SELL
  const costBasis = t.qty * (avgCostForSell || 0);
  const tax = capitalGainsTax(gross, fees, costBasis, t.pea, tpcvm);
  const net = roundMoney(gross - fees - tax);
  return { fees, tax, ttc: (gross - fees - tax) / t.qty, net, opcvm: isOpcvm };
}

/**
 * FIFO engine. Returns { pos, enriched }.
 * Account key = ticker + "||PEA"/"||REG"; FIFO runs independently per account.
 */
export function runFIFO(txns, ctx) {
  const { master } = ctx;
  const rows = [...txns].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  const lots = {}; // key -> [[qty, ttcPerShare], ...]
  const acc = {};
  const enriched = [];
  const keyOf = (tk, pea) => tk + "||" + (pea ? "PEA" : "REG");
  const A = (k) =>
    acc[k] ||
    (acc[k] = {
      realized: 0,
      divs: 0,
      soldQty: 0,
      totalBuyCost: 0,
      boughtQty: 0,
      realizedDetail: [],
      divDetail: [],
    });

  for (const t of rows) {
    const pea = !!t.pea;
    const k = keyOf(t.ticker, pea);
    A(k);
    if (!lots[k]) lots[k] = [];
    const tEff = { ...t, pea };
    let avg = 0;
    if (t.action === "SELL" && lots[k].length) {
      const q = lots[k].reduce((s, l) => s + l[0], 0);
      const c = lots[k].reduce((s, l) => s + l[0] * l[1], 0);
      avg = q ? c / q : 0;
    }
    acc[k].broker = txnBroker(t, ctx.brokers);
    const r = computeRow(tEff, avg, ctx);

    if (t.action === "BUY") {
      lots[k].push([t.qty, r.ttc]);
      acc[k].totalBuyCost = roundMoney(acc[k].totalBuyCost + r.ttc * t.qty);
      acc[k].boughtQty += t.qty;
    } else if (t.action === "SELL") {
      acc[k].soldQty += t.qty;
      let rem = t.qty;
      let cost = 0;
      while (rem > QTY_EPS && lots[k].length) {
        const lot = lots[k][0];
        const take = Math.min(rem, lot[0]);
        cost += take * lot[1];
        lot[0] -= take;
        rem -= take;
        if (lot[0] <= QTY_EPS) lots[k].shift();
      }
      cost = roundMoney(cost);
      const proceeds = roundMoney(r.ttc * t.qty);
      const gain = roundMoney(proceeds - cost);
      acc[k].realized = roundMoney(acc[k].realized + gain);
      acc[k].realizedDetail.push({
        date: t.date,
        qty: t.qty,
        price: t.price,
        proceeds,
        cost,
        gain,
      });
    } else if (t.action === "DIV") {
      acc[k].divs = roundMoney(acc[k].divs + r.net);
      acc[k].divDetail.push({
        date: t.date,
        qty: t.qty,
        perShare: t.price,
        gross: roundMoney(t.price * t.qty),
        fees: r.fees,
        tax: r.tax,
        net: r.net,
        pea,
      });
    }
    enriched.push({ ...t, ...r, account: pea ? "PEA" : "Regular" });
  }

  const pos = {};
  const keys = new Set([...Object.keys(acc), ...Object.keys(lots)]);
  for (const k of keys) {
    const [tk, acctag] = k.split("||");
    const pea = acctag === "PEA";
    const L = lots[k] || [];
    const held = L.reduce((s, l) => s + l[0], 0);
    const avg = held > QTY_EPS ? L.reduce((s, l) => s + l[0] * l[1], 0) / held : 0;
    const a = acc[k] || { realized: 0, divs: 0, soldQty: 0, totalBuyCost: 0 };
    const price = master && master[tk] && master[tk].price != null ? master[tk].price : null;
    const invested = roundMoney(held * avg);
    const value = held > 0 && price != null ? roundMoney(held * price) : 0;
    const unreal = held > 0 && price != null ? roundMoney(value - invested) : 0;
    const lifetime = roundMoney(unreal + a.realized + a.divs);
    const costBasis = a.totalBuyCost || 0;
    const isFund = master && master[tk] && master[tk].cat === "OPCVM";

    let netIfSold = null;
    let netIfSoldPS = null;
    let netVsValue = null;
    let sellFees = null;
    let sellTax = null;
    if (held > 0 && price != null) {
      const r = computeRow(
        {
          action: "SELL",
          ticker: tk,
          qty: held,
          price,
          pea,
          opcvm: isFund,
          broker: a.broker,
        },
        avg,
        ctx,
      );
      netIfSold = r.net;
      netIfSoldPS = r.net / held;
      netVsValue = roundMoney(netIfSold - value);
      sellFees = r.fees;
      sellTax = r.tax;
    }
    pos[k] = {
      key: k,
      ticker: tk,
      name: (master && master[tk] && master[tk].name) || tk,
      account: pea ? "PEA" : "Regular",
      isPea: pea,
      broker: a.broker || (pea ? "attijari" : "saham"),
      held,
      avg,
      invested,
      price,
      value,
      unreal,
      netIfSold,
      netIfSoldPS,
      netVsValue,
      sellFees,
      sellTax,
      realized: a.realized,
      divs: a.divs,
      realizedDetail: a.realizedDetail || [],
      divDetail: a.divDetail || [],
      lifetime,
      costBasis,
      isFund,
      lifepct: costBasis > QTY_EPS ? lifetime / costBasis : 0,
      status: held > 0 ? (a.realized !== 0 ? "Partial" : "Open") : "Closed",
    };
  }
  return { pos, enriched };
}

/** Portfolio-level totals across all positions (convenience for tests/UI). */
export function portfolioTotals(txns, ctx) {
  const { pos } = runFIFO(txns, ctx);
  let invested = 0;
  let value = 0;
  let realized = 0;
  let divs = 0;
  let unreal = 0;
  for (const k in pos) {
    const p = pos[k];
    invested += p.invested;
    value += p.value;
    realized += p.realized;
    divs += p.divs;
    unreal += p.unreal;
  }
  return {
    invested: roundMoney(invested),
    value: roundMoney(value),
    realized: roundMoney(realized),
    divs: roundMoney(divs),
    unreal: roundMoney(unreal),
    lifetime: roundMoney(unreal + realized + divs),
  };
}
