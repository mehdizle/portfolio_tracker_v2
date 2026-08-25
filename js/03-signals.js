// ============================================================
// 03-signals.js
// signals: scoring (num/lin/soft), sector stats, factorScores, fairValue, targets, signal, daysUntil
// Part of the Portfolio Tracker app. Loaded as an ordered plain
// <script> (shared global scope) - order matters, see index.html.
// ============================================================
      // ---------- valuation & signal engine (robust rebuild) ----------
      // Design goals (fixing the Excel model's flaws):
      //  1. Missing-data resilient: score = weighted avg of AVAILABLE factors only,
      //     normalized by the weights actually used -> always a fair 0..1, never null.
      //  2. Every factor is normalized to 0..1 then weighted (no silent 0.85 cap).
      //  3. Targets guarantee sell > buy.
      const num = (v) => typeof v === "number" && isFinite(v);
      // linear score helper: value maps to 1 at 'best', 0 at 'worst' (either direction)
      function lin(v, best, worst) {
        if (!num(v)) return null;
        if (best === worst) return 0.5;
        let s = (v - worst) / (best - worst);
        return Math.max(0, Math.min(1, s));
      }
      // Soft scorer: like lin() but rewards exceptional values beyond 'best' and
      // penalises beyond 'worst' with a gentle asymptote instead of a hard clamp.
      // Maps 'worst'->~0.12, midpoint->0.5, 'best'->~0.88, and keeps rising/falling
      // past the bounds toward 0/1 (never fully saturating). Preserves direction.
      function soft(v, best, worst) {
        if (!num(v)) return null;
        if (!isFinite(v)) return null; // reject NaN/Infinity outright
        if (best === worst) return 0.5;
        let t = (v - worst) / (best - worst); // 0 at worst, 1 at best, can exceed
        // Clamp extreme outliers: allow a little beyond best/worst (rewards/penalties
        // past the bounds) but cap the excursion so a garbage input (e.g. PEG=40,
        // ROE=-500%) can't keep dominating the blended score. t in [-0.5, 1.5]
        // => soft in ~[0.018, 0.982]. Preserves direction; kills runaway leverage.
        if (t < -0.5) t = -0.5;
        else if (t > 1.5) t = 1.5;
        // logistic centred at t=0.5, slope tuned so t=0->~0.12, t=1->~0.88
        return 1 / (1 + Math.exp(-4 * (t - 0.5)));
      }

      // Sector weighting profiles \u2014 SAME factors, re-weighted per sector.
      // Financials (banks/insurers/REITs) judged on P/B, ROE, Yield \u2014 NOT EV/EBITDA.
      // Each profile also carries an earnings-yield target (ey) & dividend growth (g)
      // used by the price-INDEPENDENT fair-value anchors.
      // peFair/grahamK/dyFair calibrated to the Casablanca market medians
      // (median P/E\u224818, median P/E\u00B7P/B\u224854, median div yield\u22483.4%), tilted per sector.
      const SECTOR_PROFILES = {
        financial: {
          key: "financial",
          label: "Financial",
          valuation: 0.04,
          safety: 0.04,
          quality: 0.22,
          growth: 0.05,
          yield: 0.13,
          book: 0.24,
          timing: 0.05,
          momentum: 0.11,
          peerrel: 0.12,
          peFair: 14,
          grahamK: 40,
          dyFair: 0.045,
          g: 0.03,
        },
        reit: {
          key: "reit",
          label: "REIT",
          valuation: 0.04,
          safety: 0.04,
          quality: 0.13,
          growth: 0.05,
          yield: 0.26,
          book: 0.21,
          timing: 0.05,
          momentum: 0.1,
          peerrel: 0.12,
          peFair: 16,
          grahamK: 38,
          dyFair: 0.05,
          g: 0.02,
        },
        industrial: {
          key: "industrial",
          label: "Industrial",
          valuation: 0.17,
          safety: 0.15,
          quality: 0.16,
          growth: 0.08,
          yield: 0.06,
          book: 0.1,
          timing: 0.05,
          momentum: 0.11,
          peerrel: 0.12,
          peFair: 17,
          grahamK: 48,
          dyFair: 0.032,
          g: 0.03,
        },
        defensive: {
          key: "defensive",
          label: "Defensive",
          valuation: 0.14,
          safety: 0.12,
          quality: 0.16,
          growth: 0.06,
          yield: 0.14,
          book: 0.1,
          timing: 0.05,
          momentum: 0.11,
          peerrel: 0.12,
          peFair: 20,
          grahamK: 55,
          dyFair: 0.034,
          g: 0.03,
        },
        growth: {
          key: "growth",
          label: "Growth",
          valuation: 0.14,
          safety: 0.1,
          quality: 0.19,
          growth: 0.17,
          yield: 0.03,
          book: 0.07,
          timing: 0.05,
          momentum: 0.13,
          peerrel: 0.12,
          peFair: 24,
          grahamK: 70,
          dyFair: 0.02,
          g: 0.06,
        },
        default: {
          key: "default",
          label: "Balanced",
          valuation: 0.16,
          safety: 0.12,
          quality: 0.18,
          growth: 0.08,
          yield: 0.08,
          book: 0.12,
          timing: 0.05,
          momentum: 0.09,
          peerrel: 0.12,
          peFair: 18,
          grahamK: 50,
          dyFair: 0.034,
          g: 0.03,
        },
      };
      function sectorProfile(cat) {
        const c = (cat || "").toLowerCase();
        if (/bank|financial|insurance|holding|financ/.test(c))
          return SECTOR_PROFILES.financial;
        if (/reit|real estate/.test(c)) return SECTOR_PROFILES.reit;
        if (/tech|health|beverage|tourism|retail/.test(c))
          return SECTOR_PROFILES.growth;
        if (/food|consumer|utilit|telecom|transport|energy/.test(c))
          return SECTOR_PROFILES.defensive;
        if (
          /industr|building|construction|material|mining|automotive|chemical|forestry|agri/.test(
            c,
          )
        )
          return SECTOR_PROFILES.industrial;
        return SECTOR_PROFILES.default;
      }

      // Position-in-range (0 at 52wk low, 1 at high) \u2014 used for timing/range-position only.
      function posInRange(m) {
        return num(m.price) && num(m.low) && num(m.high) && m.high > m.low
          ? (m.price - m.low) / (m.high - m.low)
          : null;
      }
      // RANGE-POSITION score (NOT true momentum \u2014 we have no price time-series, so real
      // momentum like trailing returns / moving averages cannot be computed). This uses only
      // where the price sits within its 52-week band. We reward the MODERATE zone (~0.35-0.65):
      // near the low may be a falling knife, near the high may be overheated. Peak reward ~0.55.
      function momentumRaw(m) {
        const pir = posInRange(m);
        if (pir == null) return null;
        return pir; // raw 0..1 position; scored below with a hump curve
      }
      function momentumScore(m) {
        const r = momentumRaw(m);
        if (r == null) return null;
        // Hump: reward the "recovering but not overheated" zone (~0.35-0.65),
        // penalise both falling-knife (near low, could keep falling) and overheated (near high).
        // Gaussian centred at 0.55, width 0.28.
        const c = 0.55,
          w = 0.28;
        return Math.exp(-((r - c) * (r - c)) / (2 * w * w));
      }

      // ---------- (B) Sector-relative valuation stats ----------
      // Peer medians (P/E, P/B, Div-Y) per sector key, computed once from the whole master list M.
      // Lets us score a stock on how cheap it is RELATIVE TO ITS PEERS \u2014 robust to whole-sector
      // re-ratings that fixed absolute anchors miss. Cache is invalidated when M changes size.
      let _SECTOR_STATS = null,
        _SECTOR_STATS_SIG = null;
      function _median(arr) {
        if (!arr.length) return null;
        const a = arr.slice().sort((x, y) => x - y);
        const n = a.length;
        return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
      }
      function _statsFor(list) {
        const pe = [],
          pb = [],
          divy = [];
        list.forEach((m) => {
          if (num(m.pe) && m.pe > 0) pe.push(m.pe);
          if (num(m.pb) && m.pb > 0) pb.push(m.pb);
          if (num(m.divy) && m.divy > 0) divy.push(m.divy);
        });
        return {
          pe: _median(pe),
          pb: _median(pb),
          divy: _median(divy),
          n: Math.max(pe.length, pb.length, divy.length),
        };
      }
      function sectorStats() {
        const sig =
          Object.keys(M).length + "|" + Object.keys(M).join(",").length;
        if (_SECTOR_STATS && _SECTOR_STATS_SIG === sig) return _SECTOR_STATS;
        const byProf = {},
          byCat = {};
        for (const tk in M) {
          const m = M[tk];
          if (!m || m.cat === "OPCVM") continue;
          const key = sectorProfile(m.cat).key;
          const cat = m.cat || "Uncategorized";
          (byProf[key] = byProf[key] || []).push(m);
          (byCat[cat] = byCat[cat] || []).push(m);
        }
        const prof = {},
          cat = {};
        for (const k in byProf) prof[k] = _statsFor(byProf[k]);
        for (const c in byCat) cat[c] = _statsFor(byCat[c]);
        _SECTOR_STATS = { prof, cat };
        _SECTOR_STATS_SIG = sig;
        return _SECTOR_STATS;
      }
      // Peer-relative valuation score 0..1: cheaper-than-peers on P/E and P/B => higher.
      // Uses ratio-to-median (0.5x median = very cheap ~1; 2x median = expensive ~0). Div-Y:
      // higher-than-peer yield is a mild positive. Needs >=3 peers with data to be meaningful.
      // Peer-relative valuation. Compares a stock to its peers on P/E, P/B and Div-Y.
      // PEER SET SELECTION (fixes the thin/singleton-sector concern):
      //   - Prefer the RAW category (e.g. "Banking") when it has >=4 comparables \u2014 most apples-to-apples.
      //   - Otherwise fall back to the BROAD profile bucket (e.g. "financial") for a coarser comparison.
      //   - If even the profile bucket has <3, return null (no meaningful peer signal).
      // Returns {score, n, basis} where n = effective peer count and basis = 'category'|'sector'.
      // The caller (factorScores) DOWN-WEIGHTS the factor when n is small, so a comparison built
      // on only 3-4 names counts less than one built on 15+.
      function peerRelScore(m) {
        const st = sectorStats();
        const cat = m.cat || "Uncategorized";
        const key = sectorProfile(m.cat).key;
        const cStat = st.cat[cat],
          pStat = st.prof[key];
        let s = null,
          basis = null;
        if (cStat && cStat.n >= 4) {
          s = cStat;
          basis = "category";
        } else if (pStat && pStat.n >= 3) {
          s = pStat;
          basis = "sector";
        } else return null; // too few comparables anywhere
        const parts = [];
        if (num(m.pe) && m.pe > 0 && s.pe) {
          parts.push(soft(s.pe / m.pe, 1.6, 0.6));
        } // peerPE/myPE: >1 => cheaper than peers
        if (num(m.pb) && m.pb > 0 && s.pb) {
          parts.push(soft(s.pb / m.pb, 1.6, 0.6));
        }
        if (num(m.divy) && m.divy > 0 && s.divy) {
          parts.push(soft(m.divy / s.divy, 1.5, 0.7));
        } // higher yield vs peers = mild +
        if (!parts.length) return null;
        return {
          score: parts.reduce((a, b) => a + b, 0) / parts.length,
          n: s.n,
          basis,
        };
      }
      function factorScores(m) {
        if (!m) return null;
        const pir = posInRange(m);
        const prof = sectorProfile(m.cat);
        const F = {
          valuation: { w: prof.valuation, s: soft(m.ev, 6, 16) },
          safety: { w: prof.safety, s: soft(m.netdebt, 0, 5) },
          quality: { w: prof.quality, s: soft(m.roe, 0.22, 0.05) },
          growth: {
            w: prof.growth,
            s:
              m.epsGrowth != null && m.epsGrowth <= 0
                ? 0.15
                : soft(m.peg, 0.7, 2.0),
          }, // negative growth \u2192 PEG misleading, force low score
          yield: { w: prof.yield, s: soft(m.divy, 0.06, 0.0) },
          book: { w: prof.book, s: soft(m.pb, 0.8, 3.0) },
          timing: {
            w: prof.timing,
            s: pir == null ? null : soft(pir, 0.15, 0.95),
          }, // prefer lower-in-range for entry
          momentum: { w: prof.momentum, s: momentumScore(m) },
        };
        // (B) Peer-relative valuation \u2014 DOWN-WEIGHTED by how many comparables exist.
        // Thin peer sets (few/only stock in its category) get less influence, not full weight.
        // Confidence ramp: n<=3 -> ~0.4x weight, n>=10 -> full weight (linear between).
        const _pr = peerRelScore(m);
        if (_pr) {
          const _conf = Math.max(0.35, Math.min(1, (_pr.n - 2) / 8)); // 3 peers -> 0.35..0.4, 10+ -> 1.0
          F.peerrel = {
            w: (prof.peerrel || 0) * _conf,
            s: _pr.score,
            _n: _pr.n,
            _basis: _pr.basis,
          };
        } else {
          F.peerrel = { w: prof.peerrel || 0, s: null }; // no comparables -> factor skipped
        }
        // Normalize by available weights so missing factors don't zero the score
        let wsum = 0,
          acc = 0,
          used = 0,
          total = 0,
          availW = 0,
          totW = 0;
        for (const k in F) {
          const f = F[k];
          total++;
          totW += f.w;
          if (f.s != null) {
            acc += f.s * f.w;
            wsum += f.w;
            used++;
            availW += f.w;
          }
        }
        // \u2500\u2500 FACTOR CORRELATION DISCOUNT \u2500\u2500
        // The "cheapness cluster" (valuation, book, peerrel) measures overlapping signals.
        // Cap their combined weighted contribution to 1.5\u00D7 the single largest weight in the
        // cluster, so triple-cheap doesn't overwhelm quality/safety/growth.
        if (wsum > 0) {
          const _cheapKeys = ["valuation", "book", "peerrel"];
          let _cSum = 0,
            _cMaxW = 0;
          for (const ck of _cheapKeys) {
            const f = F[ck];
            if (f && f.s != null) {
              _cSum += f.s * f.w;
              _cMaxW = Math.max(_cMaxW, f.w);
            }
          }
          const _cCap = _cMaxW * 1.5;
          if (_cSum > _cCap && _cCap > 0) {
            const _cScale = _cCap / _cSum;
            for (const ck of _cheapKeys) {
              const f = F[ck];
              if (f && f.s != null) {
                acc -= f.s * f.w * (1 - _cScale);
              }
            }
          }
        }
        const score = wsum > 0 ? acc / wsum : null; // 0..1
        const wcov = totW > 0 ? availW / totW : 0;
        // ---- Conviction = how much we can TRUST this score ----
        // wcov alone was misleading: missing factors often carry tiny sector weights, so a stock
        // with EV, net-debt AND PEG all absent could still read ~0.87 wcov => 'High'. We now also
        // require enough CORE fundamentals to actually be present. dataDepth counts the key raw
        // inputs: earnings (eps|pe), book (pb|bvps), profitability (roe), income (divy|dps),
        // and balance-sheet/growth (ev|netdebt|peg). 0..1.
        const _has = (v) => num(v) && isFinite(v);
        const _depthDefs = [
          ["Earnings (EPS or P/E)", _has(m.eps) || _has(m.pe)],
          ["Book value (P/B or BVPS)", _has(m.pb) || _has(m.bvps)],
          ["Profitability (ROE)", _has(m.roe)],
          ["Income (Div yield or DPS)", _has(m.divy) || _has(m.dps)],
          [
            "Balance sheet / growth (EV, net-debt or PEG)",
            _has(m.ev) || _has(m.netdebt) || _has(m.peg),
          ],
          ["52-week price range", _has(m.low) && _has(m.high)],
        ];
        const _depthChecks = _depthDefs.map((d) => d[1]);
        const dataDepth =
          _depthChecks.filter(Boolean).length / _depthChecks.length; // 0..1
        // Blend: geometric-style min-lean so BOTH must be decent for High. Take the weaker signal
        // and nudge by the average, so a great wcov can't paper over thin fundamentals.
        const convScore =
          Math.min(wcov, dataDepth) * 0.6 + ((wcov + dataDepth) / 2) * 0.4;
        const conviction =
          convScore >= 0.8 ? "High" : convScore >= 0.55 ? "Medium" : "Low";
        // Quality-only sub-score (ROE + safety + growth) \u2014 used to separate a genuine
        // value buy from a falling knife independent of price/valuation.
        const qParts = [
          ["quality", F.quality],
          ["safety", F.safety],
          ["growth", F.growth],
        ];
        let qA = 0,
          qW = 0;
        qParts.forEach(([k, f]) => {
          if (f.s != null) {
            qA += f.s * f.w;
            qW += f.w;
          }
        });
        // Blend in earnings-quality flag (penalises red-flag stocks)
        const _eq = earningsQuality(m);
        if (qW > 0 && !_eq.ok) {
          qA *= _eq.score;
        }
        const quality = qW > 0 ? qA / qW : null;
        return {
          score,
          pir,
          parts: F,
          coverage: used / total,
          wcov,
          dataDepth,
          convScore,
          depthDefs: _depthDefs,
          conviction,
          profile: prof.label,
          quality,
          prof,
          eqFlags: _eq.flags,
        };
      }

      // ---------- Price-INDEPENDENT fair value ----------
      // Blends anchors that don't simply scale with the current price:
      //  1) Absolute Graham:    sqrt(K * EPS * BVPS)   (EPS/BVPS = reported when available, else price/PE, price/PB)
      //  2) Earnings-power:      EPS / sector earnings-yield target
      //  3) Dividend-discount:   DPS / (requiredReturn - g)   (Gordon growth)
      //  4) 52-week midpoint     (already price-independent)
      // Outlier anchors (>1.8x from the median anchor) are trimmed before averaging.
      // Per-sector RELIABILITY weight of each valuation anchor (how much to trust it for
      // that sector). Banks/REITs -> book & dividend; growth -> earnings power; etc.
      // mid52 is a light technical sanity anchor everywhere. Weights are relative (auto-normalised).
      const ANCHOR_W = {
        financial: { graham: 1.1, earnpower: 0.7, ddm: 1.0, mid52: 0.5 },
        reit: { graham: 0.9, earnpower: 0.5, ddm: 1.4, mid52: 0.5 },
        industrial: { graham: 1.0, earnpower: 1.2, ddm: 0.6, mid52: 0.5 },
        defensive: { graham: 1.0, earnpower: 1.0, ddm: 1.0, mid52: 0.5 },
        growth: { graham: 0.7, earnpower: 1.4, ddm: 0.4, mid52: 0.6 },
        default: { graham: 1.0, earnpower: 1.0, ddm: 0.8, mid52: 0.5 },
      };
      function anchorWeights(prof) {
        return ANCHOR_W[(prof && prof.key) || "default"] || ANCHOR_W.default;
      }
      // Gordon-growth dividend value: next-year dividend discounted at the sector-implied
      // required return r = dyFair + g  =>  DPS\u00B7(1+g)/(r\u2212g) = DPS\u00B7(1+g)/dyFair.
      function ddmValue(dps, prof) {
        const g = num(prof.g) ? prof.g : 0;
        return (dps * (1 + g)) / prof.dyFair;
      }

      function fairValue(m) {
        if (!m || !num(m.price)) return null;
        // OPCVM funds carry only price + fees \u2014 no earnings/book/dividend metrics \u2014
        // so there is NO intrinsic anchor to compute. Return null rather than
        // falling back to price (which would masquerade as a fair value and drive
        // bogus buy/sell targets). Funds are traded at NAV, not valued.
        if (m.cat === "OPCVM") return null;
        const prof = sectorProfile(m.cat);
        // Prefer ABSOLUTE per-share fundamentals (price-independent); fall back to ratio-derived when absent.
        const eps =
          num(m.eps) && m.eps > 0
            ? m.eps
            : num(m.pe) && m.pe > 0
              ? m.price / m.pe
              : null;
        const bvps =
          num(m.bvps) && m.bvps > 0
            ? m.bvps
            : num(m.pb) && m.pb > 0
              ? m.price / m.pb
              : null;
        const dps =
          num(m.dps) && m.dps > 0
            ? m.dps
            : num(m.divy) && m.divy > 0
              ? m.price * m.divy
              : null;
        const aw = anchorWeights(prof);
        // \u2500\u2500 CYCLICAL EARNINGS NORMALIZATION (peak-earnings guard) \u2500\u2500
        // Cyclical/Sensitive companies earn the most at the top of their cycle. Capitalising
        // those PEAK earnings at a full multiple makes them look artificially "cheap" right
        // before earnings mean-revert. We have no earnings time-series, so we use the two signals
        // we DO have: the sector cycle tag, and where price sits in its 52w range (a proxy for
        // "late in the cycle"). High-in-range cyclicals get their EARNINGS-based anchors (Graham,
        // earnings-power) haircut; book/dividend/mid52 anchors are left untouched. Defensives
        // and non-cyclicals are unaffected (factor = 1).
        const _cyc = (m.cycle || "").toLowerCase();
        const _isCyclical = /cyclical|sensitive/.test(_cyc);
        let _earnFactor = 1;
        if (_isCyclical) {
          const _pir = posInRange(m); // 0 (low) .. 1 (high), null if no range
          if (_pir != null) {
            // No haircut at/below mid-range; ramp to a max 25% haircut as price nears the 52w high.
            const _over = Math.max(0, _pir - 0.5) / 0.5; // 0 at midpoint, 1 at the high
            _earnFactor = 1 - 0.25 * _over; // 1.0 .. 0.75
          }
        }
        const anchors = [];
        // 1) Graham number, market-calibrated constant: sqrt(K \u00B7 EPS \u00B7 BVPS)
        if (eps != null && bvps != null && eps > 0 && bvps > 0)
          anchors.push({
            v: Math.sqrt(prof.grahamK * eps * bvps) * _earnFactor,
            k: "graham",
            w: aw.graham,
          });
        // 2) Earnings power: EPS \u00D7 sector-fair P/E (haircut for peak-cycle cyclicals)
        if (eps != null && eps > 0)
          anchors.push({
            v: eps * prof.peFair * _earnFactor,
            k: "earnpower",
            w: aw.earnpower,
          });
        // 3) Dividend value: Gordon growth DDM (uses sector growth g)
        if (dps != null && dps > 0)
          anchors.push({ v: ddmValue(dps, prof), k: "ddm", w: aw.ddm });
        // 4) 52-week midpoint (technical, price-anchored reference)
        if (num(m.low) && num(m.high))
          anchors.push({ v: (m.low + m.high) / 2, k: "mid52", w: aw.mid52 });
        if (!anchors.length) return m.price;
        // trim outliers vs median (keep 0.5x..2.0x of median anchor)
        const vals = anchors
          .map((a) => a.v)
          .slice()
          .sort((a, b) => a - b);
        const med = vals[Math.floor((vals.length - 1) / 2)];
        const kept = anchors.filter((a) =>
          med > 0 ? a.v / med >= 0.5 && a.v / med <= 2.0 : true,
        );
        const use = kept.length ? kept : anchors;
        // sector-weighted average of surviving anchors
        let wsum = 0,
          acc = 0;
        use.forEach((a) => {
          const w = num(a.w) ? a.w : 1;
          acc += a.v * w;
          wsum += w;
        });
        return wsum > 0
          ? acc / wsum
          : use.reduce((x, a) => x + a.v, 0) / use.length;
      }
      // expose the anchor breakdown for the tooltip
      function fairValueParts(m) {
        if (!m || !num(m.price)) return [];
        const prof = sectorProfile(m.cat);
        // Prefer ABSOLUTE per-share fundamentals (mirror fairValue so tooltip matches the engine).
        const eps =
          num(m.eps) && m.eps > 0
            ? m.eps
            : num(m.pe) && m.pe > 0
              ? m.price / m.pe
              : null;
        const bvps =
          num(m.bvps) && m.bvps > 0
            ? m.bvps
            : num(m.pb) && m.pb > 0
              ? m.price / m.pb
              : null;
        const dps =
          num(m.dps) && m.dps > 0
            ? m.dps
            : num(m.divy) && m.divy > 0
              ? m.price * m.divy
              : null;
        // Mirror the cyclical peak-earnings haircut applied in fairValue().
        const _cyc = (m.cycle || "").toLowerCase();
        const _isCyclical = /cyclical|sensitive/.test(_cyc);
        let _earnFactor = 1;
        if (_isCyclical) {
          const _pir = posInRange(m);
          if (_pir != null) {
            const _over = Math.max(0, _pir - 0.5) / 0.5;
            _earnFactor = 1 - 0.25 * _over;
          }
        }
        const _haircutNote =
          _earnFactor < 0.999
            ? " \u00D7" + _earnFactor.toFixed(2) + " cyc. haircut"
            : "";
        const out = [];
        if (eps != null && bvps != null && eps > 0 && bvps > 0)
          out.push([
            "Graham \u221A(" + prof.grahamK + "\u00B7EPS\u00B7BVPS)" + _haircutNote,
            Math.sqrt(prof.grahamK * eps * bvps) * _earnFactor,
          ]);
        if (eps != null && eps > 0)
          out.push([
            "Earnings power (EPS\u00D7" + prof.peFair + ")" + _haircutNote,
            eps * prof.peFair * _earnFactor,
          ]);
        if (dps != null && dps > 0)
          out.push([
            "Dividend value (Gordon g=" +
              ((prof.g || 0) * 100).toFixed(0) +
              "%, DDM)",
            ddmValue(dps, prof),
          ]);
        if (num(m.low) && num(m.high))
          out.push(["52-wk midpoint", (m.low + m.high) / 2]);
        return out;
      }

      function targetBuy(m, sc) {
        const fv = fairValue(m);
        if (fv == null) return null;
        const s = sc && sc.score != null ? sc.score : 0.5;
        // Margin of safety: higher score -> pay closer to fair; lower score -> demand more.
        let disc = 0.1 + (1 - s) * 0.2; // 10%..30% below fair value (score-driven)
        // (C) CONFIDENCE-SCALED: thin data (Low conviction) => demand an EXTRA margin of safety
        // before calling it a buy. High conviction => no extra. Medium => small extra.
        const conv = sc && sc.conviction;
        const convExtra = conv === "Low" ? 0.1 : conv === "Medium" ? 0.04 : 0;
        disc = Math.min(0.45, disc + convExtra); // cap total discount at 45%
        return fv * (1 - disc);
      }
      function targetSell(m, sc) {
        const fv = fairValue(m);
        if (fv == null) return null;
        const s = sc && sc.score != null ? sc.score : 0.5;
        const prem = 0.12 + s * 0.28; // 12%..40% premium to fair value
        let sell = fv * (1 + prem);
        const buy = targetBuy(m, sc);
        // 52-week-high cap: keep the sell target from being unrealistically far above the
        // recent trading range. BUT it must never pull the target below what the stock is
        // worth \u2014 otherwise we'd tell you to exit below fair value (and even below target buy)
        // for high-quality names trading near their highs. So cap FIRST, then enforce the
        // fair-value and buy-spread FLOORS afterwards (floors always win over the cap).
        if (num(m.high)) sell = Math.min(sell, m.high * 1.1); // cap a bit above 52wk high (breakout room)
        const floor = Math.max(fv, buy != null ? buy * 1.18 : 0); // never sell below fair value or <18% over buy
        if (sell < floor) sell = floor;
        return sell;
      }

      // ---------- (A) Quality gate & (E) dividend-safety helpers ----------
      // Dividend safety: implied payout ratio from DPS/EPS (using reported values, else derived
      // from price\u00D7divy and price/PE). Returns {ratio, level, note} or null when no dividend.
      function divSafety(m) {
        if (!m || !num(m.price)) return null;
        const eps =
          num(m.eps) && m.eps > 0
            ? m.eps
            : num(m.pe) && m.pe > 0
              ? m.price / m.pe
              : null;
        const dps =
          num(m.dps) && m.dps > 0
            ? m.dps
            : num(m.divy) && m.divy > 0
              ? m.price * m.divy
              : null;
        if (dps == null || dps <= 0) return null; // no dividend to assess
        if (eps == null || eps <= 0)
          return {
            ratio: null,
            level: "unknown",
            note: "Pays a dividend but earnings unknown/negative \u2014 payout sustainability unclear.",
          };
        const ratio = dps / eps; // payout ratio
        // REITs/utilities legitimately run high payouts; be a bit more lenient for income sectors.
        const pr = sectorProfile(m.cat);
        const incomeSector = pr.key === "reit" || pr.key === "defensive";
        const hi = incomeSector ? 1.1 : 0.9; // >100-110% (REIT) or >90% = stretched
        const danger = incomeSector ? 1.3 : 1.05; // clearly funding div beyond earnings
        let level = "ok",
          note = "";
        if (ratio > danger) {
          level = "danger";
          note =
            "Payout " +
            (ratio * 100).toFixed(0) +
            "% of earnings \u2014 dividend likely unsustainable / at risk of a cut.";
        } else if (ratio > hi) {
          level = "stretched";
          note =
            "Payout " +
            (ratio * 100).toFixed(0) +
            "% of earnings \u2014 dividend is stretched; limited cushion.";
        } else {
          level = "ok";
          note =
            "Payout " + (ratio * 100).toFixed(0) + "% of earnings \u2014 covered.";
        }
        return { ratio, level, note };
      }
      // Quality gate: a hard floor that blocks a "value" BUY when fundamentals are unsafe,
      // independent of how cheap the stock looks. Returns {block:bool, reason:str}.
      // Signals: very weak quality sub-score, OR dangerously high net debt (>4x, soft() ~0),
      // OR a dividend clearly at risk of a cut. Cheapness never overrides a broken balance sheet.
      // \u2500\u2500 EARNINGS QUALITY flag \u2500\u2500
      // Checks for accounting / fundamental red flags using available data.
      // Returns {ok:bool, score:0-1, flags:[string]}. Score 1=clean, 0=multiple red flags.
      function earningsQuality(m) {
        if (!m) return { ok: true, score: 1, flags: [] };
        const flags = [];
        const _n = (v) => v != null && isFinite(v);
        // 1) Payout > earnings (DPS/EPS > 1.0) \u2014 unsustainable dividend
        if (_n(m.dps) && _n(m.eps) && m.eps > 0) {
          const payout = m.dps / m.eps;
          if (payout > 1.2)
            flags.push(
              "Payout " +
                Math.round(payout * 100) +
                "% of earnings (unsustainable)",
            );
          else if (payout > 1.0)
            flags.push(
              "Payout slightly exceeds earnings (" +
                Math.round(payout * 100) +
                "%)",
            );
        }
        // 2) ROE vs P/B mismatch: low quality priced for growth
        if (_n(m.roe) && _n(m.pb)) {
          if (m.roe < 0.08 && m.pb > 2.0)
            flags.push(
              "Low ROE (" +
                Math.round(m.roe * 100) +
                "%) at high P/B (" +
                m.pb.toFixed(1) +
                ")",
            );
          if (m.roe < 0.05 && m.pb > 1.5)
            flags.push(
              "Very weak ROE (" +
                Math.round(m.roe * 100) +
                "%) yet P/B " +
                m.pb.toFixed(1),
            );
        }
        // 3) Leveraged + expensive (high EV/EBITDA with heavy debt)
        if (_n(m.ev) && _n(m.netdebt)) {
          if (m.netdebt > 4.0 && m.ev > 15)
            flags.push(
              "Leveraged & expensive (net-debt " +
                m.netdebt.toFixed(1) +
                "x, EV/EBITDA " +
                m.ev.toFixed(1) +
                "x)",
            );
          else if (m.netdebt > 5.0)
            flags.push(
              "High leverage (net-debt/EBITDA " + m.netdebt.toFixed(1) + "x)",
            );
        }
        // 4) PEG extremely high with low growth (value trap)
        if (_n(m.peg) && _n(m.pe)) {
          if (m.peg > 3.0 && m.pe > 20)
            flags.push(
              "PEG " +
                m.peg.toFixed(1) +
                " at P/E " +
                m.pe.toFixed(0) +
                " \u2014 expensive for growth delivered",
            );
        }
        // 5) FCF vs EPS divergence \u2014 earnings without cash backing (accruals red flag)
        if (_n(m.fcf) && _n(m.eps) && m.eps > 0) {
          const fcfRatio = m.fcf / m.eps;
          if (fcfRatio < 0)
            flags.push(
              "Negative FCF (" +
                m.fcf.toFixed(1) +
                ") despite positive EPS (" +
                m.eps.toFixed(1) +
                ") \u2014 earnings not backed by cash",
            );
          else if (fcfRatio < 0.4)
            flags.push(
              "FCF/EPS only " +
                (fcfRatio * 100).toFixed(0) +
                "% \u2014 weak cash conversion, possible accruals issue",
            );
        }
        // 6) EPS growth vs PEG sanity: if epsGrowth is negative but PEG is positive and low, something's off
        if (_n(m.epsGrowth) && _n(m.peg)) {
          if (m.epsGrowth < 0 && m.peg > 0 && m.peg < 1.5)
            flags.push(
              "PEG looks cheap (" +
                m.peg.toFixed(1) +
                ") but EPS growth is negative (" +
                (m.epsGrowth * 100).toFixed(0) +
                "%) \u2014 misleading value signal",
            );
        }
        const score = Math.max(0, 1 - flags.length * 0.3); // 1.0=clean, 0.4=1 flag, 0.1=3 flags
        return { ok: flags.length === 0, score, flags };
      }
      function qualityGate(m, sc) {
        const Q = sc && sc.quality;
        const nd = m && m.netdebt; // net debt / EBITDA (lower better)
        const ds = divSafety(m);
        const reasons = [];
        if (Q != null && Q < 0.28)
          reasons.push(
            "quality sub-score very weak (" + (Q * 100).toFixed(0) + "%)",
          );
        if (num(nd) && nd > 4.5)
          reasons.push(
            "high leverage (net-debt/EBITDA " + nd.toFixed(1) + "x)",
          );
        if (ds && ds.level === "danger")
          reasons.push(
            "dividend at risk (" +
              (ds.ratio != null
                ? (ds.ratio * 100).toFixed(0) + "% payout"
                : "uncovered") +
              ")",
          );
        return {
          block: reasons.length > 0,
          reason: reasons.join("; "),
          divSafety: ds,
        };
      }
      // ---------- Signal: quality \u00D7 valuation \u00D7 momentum, with reasons ----------
      function signal(m, sc, held) {
        if (!m || !num(m.price) || !sc || sc.score == null)
          return {
            t: "\uD83D\uDCDD DATA NEEDED",
            c: "b-hold",
            reasons: ["Not enough fundamentals to score."],
          };
        const _held = held === true; // TRIM/SELL only make sense for positions you actually hold
        const S = sc.score,
          price = m.price;
        const pir = sc.pir == null ? 0.5 : sc.pir;
        const Q = sc.quality == null ? S : sc.quality; // quality sub-score
        const mom =
          sc.parts && sc.parts.momentum && sc.parts.momentum.s != null
            ? sc.parts.momentum.s
            : null;
        const tb = targetBuy(m, sc),
          ts = targetSell(m, sc),
          fv = fairValue(m);
        const R = [];
        const _gate = qualityGate(m, sc); // (A) hard quality/leverage/div-risk floor
        const _ds = _gate.divSafety; // (E) dividend-safety detail (may be null)
        const disc = fv ? (fv - price) / fv : null; // +ve = trading below fair
        const pct = (x) => (x * 100).toFixed(0) + "%";
        if (fv != null)
          R.push(
            "Price " +
              (disc >= 0
                ? "\u2212" + pct(disc) + " below"
                : "+" + pct(-disc) + " above") +
              " fair value (" +
              money(fv) +
              ").",
          );
        R.push(
          "Score " +
            (S * 100).toFixed(0) +
            "% \u00B7 quality " +
            (Q != null ? (Q * 100).toFixed(0) + "%" : "\u2014") +
            " \u00B7 position-in-range " +
            pct(pir) +
            ".",
        );
        // (B) peer-relative context: note the comparison basis + how many comparables backed it.
        {
          const _pf = sc.parts && sc.parts.peerrel;
          if (_pf && _pf.s != null && _pf._n) {
            const _pcls =
              _pf.s >= 0.6 ? "cheaper" : _pf.s <= 0.4 ? "pricier" : "in line";
            R.push(
              "Valuation " +
                _pcls +
                " than " +
                (_pf._basis === "category" ? "category" : "sector") +
                " peers (" +
                _pf._n +
                " compared" +
                (_pf._n < 4 ? " \u2014 thin, low weight" : "") +
                ").",
            );
          }
        }

        // ---- RICH / OVERVALUED side (valuation-driven, not pure quality) ----
        // TRIM/SELL are HELD-only actions. For names you do NOT hold, the same "price above
        // target" conditions are an AVOID/WATCH (a not-buy) \u2014 you cannot trim what you don't own.
        if (ts != null && price > ts * 1.2) {
          if (_held) {
            R.push("Well above target sell (" + money(ts) + ") \u2014 take profit.");
            return {
              t: "\uD83D\uDCB5 TRIM (Well Above Target)",
              c: "b-trim",
              reasons: R,
            };
          }
          R.push(
            "Well above target sell (" +
              money(ts) +
              ") \u2014 richly valued; not an entry.",
          );
          return { t: "\uD83D\uDD12 AVOID (Overvalued)", c: "b-wait", reasons: R };
        }
        if (ts != null && price > ts) {
          if (_held) {
            if (S > 0.6) {
              R.push(
                "At/above target sell but quality still good \u2014 trim, don\u2019t exit.",
              );
              return { t: "\uD83D\uDCB5 TRIM (At Target)", c: "b-trim", reasons: R };
            }
            R.push("At/above target sell and quality weak \u2014 reduce.");
            return { t: "\u26D4 SELL (Rich + Weak)", c: "b-sell", reasons: R };
          }
          R.push("At/above target sell \u2014 fully valued; wait for a pullback.");
          return { t: "\uD83D\uDD12 AVOID (Fully Valued)", c: "b-wait", reasons: R };
        }
        // Deteriorating quality while expensive. Held -> exit; not held -> avoid. (Cheap + weak = NOT an automatic sell.)
        if (Q != null && Q < 0.3 && disc != null && disc < 0.05) {
          if (_held) {
            R.push("Weak quality and not cheap \u2014 reduce / exit.");
            return { t: "\u26D4 SELL (Weak Quality)", c: "b-sell", reasons: R };
          }
          R.push("Weak quality and not cheap \u2014 avoid.");
          return { t: "\uD83D\uDEAB AVOID (Weak Quality)", c: "b-wait", reasons: R };
        }

        // ---- BUY side (needs BOTH value and acceptable quality) ----
        // (A) QUALITY GATE: a broken balance sheet / at-risk dividend blocks a "value" BUY no
        // matter how cheap it looks \u2014 cheapness never overrides safety. Downgrade to Speculative.
        if (tb != null && price <= tb * 1.1 && _gate.block) {
          R.push(
            "Cheap, but blocked by quality gate: " +
              _gate.reason +
              ". Treat as speculative \u2014 size small.",
          );
          if (_ds && _ds.note) R.push(_ds.note);
          return {
            t: "\uD83E\uDE78 SPECULATIVE (Quality Gate)",
            c: "b-wait",
            reasons: R,
          };
        }
        if (tb != null && price <= tb) {
          if (
            _ds &&
            (_ds.level === "stretched" ||
              _ds.level === "danger" ||
              _ds.level === "unknown")
          )
            R.push(_ds.note);
          if (S >= 0.7 && Q >= 0.55) {
            R.push("Deep discount + strong quality \u2014 high-conviction entry.");
            return { t: "\uD83D\uDE80 STRONG BUY", c: "b-buy", reasons: R };
          }
          if (S >= 0.58) {
            R.push("Below target buy with solid quality.");
            return { t: "\uD83D\uDCB0 BUY (Deep Value)", c: "b-buy", reasons: R };
          }
          if (Q != null && Q < 0.35) {
            R.push(
              "Cheap but quality is weak \u2014 possible falling knife, size small.",
            );
            return {
              t: "\uD83E\uDE78 SPECULATIVE (Falling Knife?)",
              c: "b-wait",
              reasons: R,
            };
          }
          R.push("Below target buy; middling quality.");
          return { t: "\uD83D\uDCB8 BUY (Value)", c: "b-buy", reasons: R };
        }
        if (tb != null && price <= tb * 1.05 && S >= 0.52) {
          if (_ds && _ds.level !== "ok" && _ds.note) R.push(_ds.note);
          R.push(
            "Just above target buy with good quality \u2014 accumulate on dips.",
          );
          return { t: "\uD83D\uDCB8 BUY (Good Value)", c: "b-buy", reasons: R };
        }
        if (
          tb != null &&
          price <= tb * 1.1 &&
          S >= 0.48 &&
          (mom == null || mom >= 0.4)
        ) {
          if (_ds && _ds.level !== "ok" && _ds.note) R.push(_ds.note);
          R.push("Near target buy, decent quality & steady trend.");
          return { t: "\u2753 BUY (Speculative)", c: "b-buy", reasons: R };
        }

        // ---- No-action zones ----
        if (tb != null && price > tb * 1.35) {
          R.push("Materially above target buy \u2014 wait for a better entry.");
          return { t: "\u23F3 WAIT (Expensive)", c: "b-wait", reasons: R };
        }
        R.push("Fairly valued \u2014 hold; add only on weakness.");
        return { t: "\u27A1\uFE0F HOLD", c: "b-hold", reasons: R };
      }

      // Back-compat alias used by renderSignals
      function scoreParts(m) {
        const r = factorScores(m);
        return r ? { total: r.score, pir: r.pir, coverage: r.coverage } : null;
      }
      function daysUntil(d) {
        return Math.round((new Date(d) - TODAY) / 86400000);
      }
