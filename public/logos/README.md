# Ticker logos (optional)

Drop a PNG here named after the ticker to show a real logo instead of the
auto-generated colored monogram. The file name is the ticker, uppercased, with
any non-alphanumeric character replaced by `_` and a `.png` extension.

Examples:
- `NKL` → `NKL.png`
- `SBM` → `SBM.png`
- `ATJ ACT` → `ATJ_ACT.png`
- `FCP B` → `FCP_B.png`

Recommendation: square-ish PNG, ~64×64 to 128×128, transparent or white
background. It is displayed inside a small rounded badge (contain-fit on white).

If no file is present for a ticker, the app falls back to a deterministic
colored monogram (the ticker's initials on a stable color) — so every holding
always has a badge, with zero external calls and full offline support.

This folder lives under Vite's `public/` dir, so its contents are copied to the
site root at build time and served at `/portfolio_tracker_v2/logos/<TICKER>.png`.
