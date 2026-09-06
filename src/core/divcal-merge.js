// =================== DIVIDEND CALENDAR MERGE (UPSERT) ===================
// Pure, DOM-free merge logic for importing dividend-calendar events.
//
// Behaviour (replaces the old Replace/Append modes):
//   - ADD    an incoming event whose identity isn't already present is appended.
//   - UPDATE an incoming event whose identity matches an existing row updates
//            that row in place (amount, pay_date, issuer, div_type) if any of
//            those changed. Existing rows are NEVER deleted.
//   - SKIP   an incoming event identical to what's already stored.
//
// This lets a user accumulate multiple years (2024, 2025, 2026 ...) and
// re-import a corrected year without wiping earlier years, and without creating
// duplicates when only the amount/pay-date was fixed.
//
// IDENTITY: a single real-world distribution is identified by ticker + ex-date
// (the record date is unique per distribution). When ex-date is missing we fall
// back to ticker + pay-date so undated rows still de-duplicate sensibly.

// Fields that carry meaning and may be corrected on re-import. NOTE: div_type
// is part of the IDENTITY (below), not an updatable field - an Ordinary and an
// Exceptional dividend on the same date are two DISTINCT events, so a type must
// never overwrite the other. Only amount/pay_date/issuer can be corrected.
const MERGE_FIELDS = ["amount", "pay_date", "issuer"];

// Normalise a dividend type to a stable identity token. Anything starting with
// "e" (Exceptional/Extraordinary/Special variants) -> "exc"; everything else
// (Ordinary, blank) -> "ord". Keeps identity robust to wording differences.
function typeKey(d) {
  const t = String((d && d.div_type) || "")
    .trim()
    .toLowerCase();
  return t.startsWith("e") ? "exc" : "ord";
}

// Stable identity key for one dividend event: ticker + ex-date + type.
// Including TYPE is essential - a ticker can pay an Ordinary AND an Exceptional
// dividend on the SAME ex-date (common in Casablanca); without type in the key
// the second row would overwrite the first and one payment would be lost.
export function divIdentity(d) {
  const tk = String((d && d.ticker) || "")
    .trim()
    .toUpperCase();
  const ex = String((d && d.ex_date) || "").trim();
  const pay = String((d && d.pay_date) || "").trim();
  return tk + "|" + (ex || "@" + pay) + "|" + typeKey(d);
}

// Normalise an amount for comparison (avoid 22 vs 22.00 vs 22.0001 churn).
function amtEq(a, b) {
  const na = +a,
    nb = +b;
  if (isFinite(na) && isFinite(nb)) return +na.toFixed(4) === +nb.toFixed(4);
  return String(a == null ? "" : a) === String(b == null ? "" : b);
}

function fieldEq(key, a, b) {
  if (key === "amount") return amtEq(a, b);
  return (
    String(a == null ? "" : a).trim() === String(b == null ? "" : b).trim()
  );
}

// Collapse exact-duplicate events within a single incoming batch, keeping the
// LAST occurrence (so a later corrected row in the same paste wins).
export function dedupeBatch(list) {
  const idx = new Map();
  const out = [];
  for (const d of list || []) {
    const k = divIdentity(d);
    if (idx.has(k)) out[idx.get(k)] = d;
    else {
      idx.set(k, out.length);
      out.push(d);
    }
  }
  return out;
}

// Merge an incoming batch into an existing calendar array.
// Returns { list, added, updated, skipped } - list is a NEW array (does not
// mutate the input `existing`). Existing rows keep their runtime flags.
export function mergeDivcal(existing, incoming) {
  const base = Array.isArray(existing) ? existing.map((d) => ({ ...d })) : [];
  const byId = new Map();
  base.forEach((d, i) => byId.set(divIdentity(d), i));

  let added = 0,
    updated = 0,
    skipped = 0;

  for (const inc of dedupeBatch(incoming)) {
    const id = divIdentity(inc);
    if (byId.has(id)) {
      const cur = base[byId.get(id)];
      let changed = false;
      for (const f of MERGE_FIELDS) {
        if (inc[f] === undefined) continue;
        if (!fieldEq(f, cur[f], inc[f])) {
          cur[f] = inc[f];
          changed = true;
        }
      }
      if (changed) updated++;
      else skipped++;
    } else {
      base.push({ ...inc });
      byId.set(id, base.length - 1);
      added++;
    }
  }
  return { list: base, added, updated, skipped };
}
