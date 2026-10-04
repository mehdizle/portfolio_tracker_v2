// 01c-ui-kit.js
// Shared, cross-cutting UI widgets that aren't core infrastructure:
//   1. in-app modal dialogs (appConfirm / appPrompt / appFillDialog) + their
//      date helpers (_qwTodayISO / validTxnDate) - were in 01-core.js
//   2. the delegated modal backdrop/close click handler - was in 09-boot.js
//   3. the ticker-badge widget (monogram + logo fallback) - was in 01-core.js
//   4. the delegated ticker-logo <img> error fallback - was in 09-boot.js
// Grouping the badge markup with its own error-fallback listener (and the modal
// builders with their backdrop handler) keeps each widget's pieces together.
// Part of the Portfolio Tracker app. Loaded as an ordered plain <script>
// (shared global scope via scripts/concat.mjs) after 01-core.js (needs
// escapeHtml) and 01b-tooltip.js.
// ============================================================

// ---------- in-app modal helpers ----------
function _qwTodayISO() {
  const d = new Date();
  const o = d.getTimezoneOffset();
  const l = new Date(d.getTime() - o * 60000);
  return l.toISOString().slice(0, 10);
}
// Validate a YYYY-MM-DD string is a REAL calendar date (rejects 2024-13-40,
// 2024-02-30, empty, or non-string). Used to guard transaction/import input.
function validTxnDate(s) {
  if (typeof s !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = +m[1],
    mo = +m[2],
    da = +m[3];
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return false;
  const dt = new Date(y, mo - 1, da);
  // round-trip check: JS Date normalizes overflow (Feb 30 -> Mar 2), so a valid
  // date must read back the same Y/M/D.
  return (
    dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === da
  );
}
function appConfirm(message, opts) {
  opts = opts || {};
  return new Promise((res) => {
    const back = document.createElement("div");
    back.className = "qwmodal-back";
    back.innerHTML =
      '<div class="qwmodal" role="dialog" aria-modal="true">' +
      "<h3>" +
      escapeHtml(opts.title || "Please confirm") +
      "</h3>" +
      '<p class="qw-msg"></p>' +
      '<div class="qw-btns">' +
      '<button class="qw-b qw-cancel">' +
      escapeHtml(opts.cancelText || "Cancel") +
      "</button>" +
      '<button class="qw-b qw-ok' +
      (opts.danger ? " qw-danger" : "") +
      '">' +
      escapeHtml(opts.okText || "Confirm") +
      "</button>" +
      "</div></div>";
    back.querySelector(".qw-msg").textContent = message;
    const done = (v) => {
      back.remove();
      document.removeEventListener("keydown", onKey);
      res(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") done(false);
      else if (e.key === "Enter") done(true);
    };
    back.querySelector(".qw-cancel").onclick = () => done(false);
    back.querySelector(".qw-ok").onclick = () => done(true);
    back.addEventListener("mousedown", (e) => {
      if (e.target === back) done(false);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);
    back.querySelector(".qw-ok").focus();
  });
}
function appPrompt(label, value, opts) {
  opts = opts || {};
  return new Promise((res) => {
    const back = document.createElement("div");
    back.className = "qwmodal-back";
    const showToday = !!opts.today;
    back.innerHTML =
      '<div class="qwmodal" role="dialog" aria-modal="true">' +
      "<h3>" +
      escapeHtml(opts.title || "Enter a value") +
      "</h3>" +
      '<label class="qw-field"><span class="qw-lbl"></span>' +
      '<span class="qw-inrow"><input type="' +
      (opts.inputType || "text") +
      '">' +
      (showToday
        ? '<button type="button" class="qw-today">Today</button>'
        : "") +
      "</span></label>" +
      '<div class="qw-btns">' +
      '<button class="qw-b qw-cancel">Cancel</button>' +
      '<button class="qw-b qw-ok">OK</button>' +
      "</div></div>";
    back.querySelector(".qw-lbl").textContent = label;
    const inp = back.querySelector("input");
    inp.value = value == null ? "" : value;
    const done = (v) => {
      back.remove();
      document.removeEventListener("keydown", onKey);
      res(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") done(null);
      else if (e.key === "Enter") done(inp.value);
    };
    if (showToday) {
      back.querySelector(".qw-today").onclick = () => {
        inp.value = _qwTodayISO();
        inp.focus();
      };
    }
    back.querySelector(".qw-cancel").onclick = () => done(null);
    back.querySelector(".qw-ok").onclick = () => done(inp.value);
    back.addEventListener("mousedown", (e) => {
      if (e.target === back) done(null);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);
    inp.focus();
    inp.select();
  });
}
// combined fill dialog for validating a pending order (date+Today, price, qty, total)
function appFillDialog(o, isDiv, moneyFn) {
  return new Promise((res) => {
    const back = document.createElement("div");
    back.className = "qwmodal-back";
    const qtyRow = isDiv
      ? ""
      : '<label class="qw-field">Quantity executed (order is ' +
        moneyFn(o.qty, o.qty % 1 ? 3 : 0) +
        " \u2014 less = partial fill)" +
        '<span class="qw-inrow"><input id="qwf-qty" type="text"></span></label>';
    const totRow =
      !isDiv && o.total != null
        ? '<label class="qw-field">Executed Total TTC (blank = qty\u00D7price)' +
          '<span class="qw-inrow"><input id="qwf-tot" type="text"></span></label>'
        : "";
    back.innerHTML =
      '<div class="qwmodal" role="dialog" aria-modal="true">' +
      "<h3>" +
      (isDiv ? "Record dividend" : "Validate order") +
      " \u2014 " +
      escapeHtml(o.ticker || "") +
      "</h3>" +
      '<label class="qw-field">' +
      (isDiv ? "Date received (YYYY-MM-DD)" : "Execution date (YYYY-MM-DD)") +
      '<span class="qw-inrow"><input id="qwf-date" type="text"><button type="button" class="qw-today">Today</button></span></label>' +
      '<label class="qw-field">' +
      (isDiv ? "Dividend amount per share" : "Executed unit price") +
      '<span class="qw-inrow"><input id="qwf-price" type="text"></span></label>' +
      qtyRow +
      totRow +
      '<div class="qw-btns"><button class="qw-b qw-cancel">Cancel</button><button class="qw-b qw-ok">Confirm</button></div></div>';
    const g = (id) => back.querySelector("#" + id);
    g("qwf-date").value = o.date || "";
    g("qwf-price").value = o.price != null ? o.price : "";
    if (!isDiv) g("qwf-qty").value = o.qty;
    if (totRow) g("qwf-tot").value = +o.total.toFixed(2);
    back.querySelector(".qw-today").onclick = () => {
      g("qwf-date").value = _qwTodayISO();
      g("qwf-date").focus();
    };
    const done = (v) => {
      back.remove();
      document.removeEventListener("keydown", onKey);
      res(v);
    };
    const submit = () =>
      done({
        date: g("qwf-date").value,
        price: g("qwf-price").value,
        qty: isDiv ? null : g("qwf-qty").value,
        total: totRow ? g("qwf-tot").value : null,
      });
    const onKey = (e) => {
      if (e.key === "Escape") done(null);
      else if (e.key === "Enter" && e.target.tagName !== "BUTTON") submit();
    };
    back.querySelector(".qw-cancel").onclick = () => done(null);
    back.querySelector(".qw-ok").onclick = submit;
    back.addEventListener("mousedown", (e) => {
      if (e.target === back) done(null);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);
    g("qwf-date").focus();
    g("qwf-date").select();
  });
}

// ---------- Modal backdrop / close delegation (static modals in index.html) ----------
// - [data-modal-backdrop]: clicking the backdrop itself (not its contents) hides it.
// - [data-modal-close="id"]: a button that hides the modal with that id.
// (Moved out of 09-boot.js so all modal behavior lives beside the modal builders.)
(function () {
  document.addEventListener("click", function (e) {
    const bd = e.target && e.target.closest ? e.target : null;
    if (
      bd &&
      bd.hasAttribute &&
      bd.hasAttribute("data-modal-backdrop") &&
      e.target === bd
    ) {
      bd.style.display = "none";
      return;
    }
    const closer =
      e.target && e.target.closest
        ? e.target.closest("[data-modal-close]")
        : null;
    if (closer) {
      const id = closer.getAttribute("data-modal-close");
      const m = document.getElementById(id);
      if (m) m.style.display = "none";
    }
  });
})();

// ---------- Ticker badge (monogram fallback + optional real logo) ----------
// Renders a small inline badge for a ticker:
//   - a deterministic colored monogram (always works, offline, private), PLUS
//   - an <img> that tries logos/<TICKER>.svg then logos/<TICKER>.png; if one
//     loads it reveals itself and hides the monogram; if all 404 the monogram
//     stays. No inline handlers - the delegated load/error listener (below)
//     wires the swap + fallback, keeping the "no inline onclick/onerror" model.
// Drop real logos into public/logos/ (SVG preferred, PNG accepted), either flat
// (logos/<TICKER>.svg) or under an exchange subfolder (logos/CSEMA/<TICKER>.svg).
// Case-insensitive stored key; they override the monogram automatically.
// Exchange subfolders under logos/ to search for a ticker logo, in order.
// "" = the flat logos/ root (kept last so a top-level drop-in still works).
// Add more exchanges here (e.g. "NYSE", "LSE") if logos are sorted by market.
const LOGO_DIRS = ["CSEMA", ""];
function _tickerHue(tk) {
  // Stable hash -> hue (0..359). Same ticker always gets the same color.
  let h = 0;
  const s = String(tk || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
function _tickerInitials(tk) {
  const s = String(tk || "").replace(/[^A-Za-z0-9]/g, "");
  if (!s) return "?";
  // Up to 3 chars for readability (e.g. "NKL", "ATW", "SBM").
  return s.slice(0, 3).toUpperCase();
}
// Filesystem-safe logo key for a ticker (spaces/punct -> underscore, upper).
function _tickerLogoKey(tk) {
  return String(tk || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
// Logo file extensions tried per directory, in order (SVG preferred).
const LOGO_EXTS = ["svg", "png"];
// i-th logo-URL candidate for a ticker key, or null once exhausted. The URL is
// built ONLY from hardcoded constants (LOGO_DIRS/LOGO_EXTS) plus the key
// re-sanitized here to [A-Z0-9_], so nothing derived from untrusted DOM text is
// ever assigned to an <img src>. This is the single source of truth for both
// the initial badge src and the on-error fallback walk (below), which lets
// CodeQL see the sink is fed only by safe, constant-derived strings.
function logoCandidate(key, i) {
  const safe = String(key || "").replace(/[^A-Z0-9_]/g, "");
  if (!safe) return null;
  const perDir = LOGO_EXTS.length;
  const dirIdx = Math.floor(i / perDir);
  if (dirIdx >= LOGO_DIRS.length) return null;
  const dir = LOGO_DIRS[dirIdx];
  const ext = LOGO_EXTS[i % perDir];
  return "logos/" + (dir ? dir + "/" : "") + safe + "." + ext;
}
// size = badge diameter in px (default 20). Returns an inline-block HTML string.
function tickerBadge(tk, size) {
  const px = size || 20;
  const key = _tickerLogoKey(tk);
  if (!key) return "";
  const hue = _tickerHue(key);
  const initials = escapeHtml(_tickerInitials(tk));
  const fontPx = Math.max(
    7,
    Math.round(px * (initials.length >= 3 ? 0.34 : 0.42)),
  );
  // logos/ is relative to the page, so it resolves under the GitHub Pages base
  // (/portfolio_tracker_v2/logos/...) and locally, with no build-time base var.
  // Candidate URLs, tried in order: each exchange subfolder (LOGO_DIRS) then the
  // flat logos/ root, SVG before PNG (see logoCandidate). This lets logos be
  // organized by exchange (logos/CSEMA/ATW.svg) or dropped flat (logos/ATW.svg).
  // First candidate is the initial src; the on-error walk (below) advances
  // the attempt index (data-logo-i) and rebuilds the next URL via logoCandidate,
  // so no DOM-attribute text is ever assigned to img.src. If every candidate
  // 404s, the monogram stays.
  const src = logoCandidate(key, 0) || "";
  return (
    '<span class="tkr-badge" style="width:' +
    px +
    "px;height:" +
    px +
    'px;position:relative;display:inline-flex;flex:none;vertical-align:middle;margin-right:6px;border-radius:6px;overflow:hidden;align-items:center;justify-content:center;background:#fff">' +
    // monogram (visible fallback)
    '<span class="tkr-mono" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:' +
    fontPx +
    "px;color:#fff;background:hsl(" +
    hue +
    ',62%,42%);letter-spacing:.02em">' +
    initials +
    "</span>" +
    // real logo, layered ON TOP of the monogram with an opaque white background
    // so it covers it when present. It is VISIBLE by default (not display:none)
    // so the browser always fetches it - a hidden/lazy image is often never
    // loaded, which previously left the monogram stuck. On error the delegated
    // handler (below) advances data-logo-i and rebuilds the next candidate
    // via logoCandidate; once exhausted it hides the img so the monogram shows
    // through. No loading="lazy" for the same reason.
    '<img class="tkr-logo" alt="" src="' +
    escapeHtml(src) +
    '" data-logo-key="' +
    escapeHtml(key) +
    '" data-logo-i="0"' +
    // inset:-1px makes the logo slightly OVERFILL the wrapper so its opaque
    // pixels extend under the rounded clip at the corners - this removes the
    // ~1px antialiased white halo where the wrapper background would otherwise
    // bleed through. width/height use calc(100% + 2px) to match the overfill.
    ' style="position:absolute;inset:-1px;width:calc(100% + 2px);height:calc(100% + 2px);object-fit:cover;display:block">' +
    "</span>"
  );
}

// ---------- Ticker-logo <img> error fallback (delegated, capture phase) ----------
// The badge shows the logo <img> ON TOP of the monogram by default (opaque
// white bg), so a present logo covers the monogram with no reliance on a "load"
// event (a hidden/lazy image is often never fetched). On error we advance the
// attempt index and rebuild the next candidate via logoCandidate (exchange
// .svg/.png then flat .svg/.png); when exhausted we HIDE the img so the
// monogram underneath shows through. Delegated on the capture phase because the
// img "error" event doesn't bubble. (Moved out of 09-boot.js so it lives beside
// tickerBadge/logoCandidate, the markup it reacts to.)
(function () {
  document.addEventListener(
    "error",
    function (e) {
      const img = e.target;
      if (
        !img ||
        img.tagName !== "IMG" ||
        !img.classList ||
        !img.classList.contains("tkr-logo")
      )
        return;
      // Advance the attempt INDEX (a number) and rebuild the next URL from
      // constants via logoCandidate() - the value assigned to img.src is never
      // derived from DOM-attribute text, only from the sanitized logo key and
      // the hardcoded dir/ext tables. When candidates are exhausted, hide the
      // img so the monogram underneath shows through.
      const key = img.getAttribute("data-logo-key") || "";
      const i = (parseInt(img.getAttribute("data-logo-i"), 10) || 0) + 1;
      const next =
        typeof logoCandidate === "function" ? logoCandidate(key, i) : null;
      if (next) {
        img.setAttribute("data-logo-i", String(i));
        img.src = next;
      } else {
        img.style.display = "none";
      }
    },
    true,
  );
})();
