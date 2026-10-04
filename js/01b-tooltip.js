// 01b-tooltip.js
// The whole tooltip system in one module:
//   1. the trusted-content registry (tipRef / __TIP) - was in 01-core.js
//   2. the HTML builder helpers (_tipHead/_tipRow/_tipRule + tipHead/tipRow/
//      tipNote/tipRule) - were scattered/duplicated across 04-render.js,
//      05-rebalance.js and 06-features.js
//   3. the instant tooltip ENGINE (hover listener, floating #__qtip element,
//      positioning, HTML sanitizer) - was embedded in 08-salary.js
// Part of the Portfolio Tracker app. Loaded as an ordered plain <script>
// (shared global scope via scripts/concat.mjs) immediately after 01-core.js,
// so these helpers exist before any feature file builds a tooltip.
// ============================================================

// ---------- Trusted tooltip registry ----------
// Rich (HTML) tooltips are our OWN generated markup, but embedding that HTML in
// a data-tip attribute means it must be re-parsed from the DOM on hover - a
// tainted "DOM text -> HTML" flow. Instead we keep the trusted HTML in this
// in-memory store and put only an opaque token ("#t<n>") in the attribute. The
// tooltip engine (below) looks the token up here and builds DOM from the
// trusted string, so no untrusted attribute value is ever parsed as HTML.
const __TIP = new Map(); // token -> trusted tooltip HTML
const __TIP_BY_HTML = new Map(); // html -> token (content-addressed dedupe)
let __TIP_SEQ = 0;
// Register trusted tooltip HTML, return the token to place in data-tip="...".
// Content-addressed: identical HTML reuses the same token, so the store only
// grows by DISTINCT tooltip content (bounded and small) and never needs a reset
// that could orphan tokens still referenced by another tab's live DOM.
// Plain text should NOT use this - pass it directly so it renders as text.
function tipRef(html) {
  if (html == null || html === "") return "";
  const s = String(html);
  let token = __TIP_BY_HTML.get(s);
  if (token == null) {
    token = "#t" + ++__TIP_SEQ;
    __TIP.set(token, s);
    __TIP_BY_HTML.set(s, token);
  }
  return token;
}
if (typeof window !== "undefined") {
  window.__TIP = __TIP;
  window.tipRef = tipRef;
}

// ---------- Tooltip HTML builders (single source of truth) ----------
// Every per-feature tooltip in the app composes its content from these. They
// used to be defined once as _tipHead/_tipRow/_tipRule (04-render.js) and then
// re-implemented with fallback copies as tipHead/tipRow/tipNote/tipRule
// (05-rebalance.js) and tHead/tRow/tRule/note (06-features.js). Centralising
// them here removes that drift risk: edit a row's markup once and every tooltip
// updates. Because this module loads before every consumer, the old
// "typeof _tipRow === 'function' ? ... : inline fallback" guards are no longer
// needed - the helpers are always present.
function _tipRow(l, v, cl) {
  return (
    '<div style="display:flex;justify-content:space-between;gap:18px"><span>' +
    l +
    '</span><span class="' +
    (cl || "") +
    '" style="font-family:var(--mono)">' +
    v +
    "</span></div>"
  );
}
function _tipHead(t) {
  return '<div style="font-weight:700;margin-bottom:6px">' + t + "</div>";
}
function _tipRule() {
  return '<div style="border-top:1px solid var(--border);margin:6px 0"></div>';
}
// Named wrappers kept for the many call sites that use these spellings. tipRow
// intentionally takes only (l, v) to match its historical signature.
function tipHead(t) {
  return _tipHead(t);
}
function tipRow(l, v) {
  return _tipRow(l, v);
}
function tipNote(t) {
  return t
    ? '<div class="mini" style="color:var(--text2);margin-top:6px;max-width:300px;white-space:normal">' +
        t +
        "</div>"
    : "";
}
function tipRule() {
  return _tipRule();
}

/* ===== Instant tooltip engine (data-tip) \u2014 no native title delay ===== */
(function () {
  if (window.__qtipInit) return;
  window.__qtipInit = true;
  const tip = document.createElement("div");
  tip.id = "__qtip";
  tip.style.cssText =
    "position:fixed;z-index:99999;max-width:340px;background:#0d1520;color:#e6edf3;border:1px solid #2c3742;border-radius:8px;padding:9px 11px;font-size:11.5px;line-height:1.5;white-space:pre-line;box-shadow:0 8px 24px rgba(0,0,0,.45);pointer-events:none;opacity:0;transition:opacity .08s;font-family:var(--sans,system-ui);display:none";
  document.addEventListener("DOMContentLoaded", () =>
    document.body.appendChild(tip),
  );
  if (document.body) document.body.appendChild(tip);
  let cur = null;
  function place(e) {
    const pad = 14;
    let x = e.clientX + pad,
      y = e.clientY + pad;
    const r = tip.getBoundingClientRect();
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  // Build a sanitized DOM fragment from tooltip HTML. Returns a DocumentFragment
  // (never an HTML string), so callers use replaceChildren instead of innerHTML.
  // `html` here is always TRUSTED app output taken from the __TIP registry
  // (see tipRef above) - never a value read from the DOM - so no untrusted
  // string is ever parsed as HTML. The whitelist below is defense-in-depth.
  function buildTipNodes(html) {
    // Parse with DOMParser (an inert document - scripts do not run, and no
    // element is ever assigned via innerHTML), then transplant only whitelisted
    // nodes into the live tooltip.
    const doc = new DOMParser().parseFromString(String(html), "text/html");
    const OK_TAGS = {
      B: 1,
      I: 1,
      U: 1,
      EM: 1,
      STRONG: 1,
      SPAN: 1,
      DIV: 1,
      BR: 1,
      SMALL: 1,
      P: 1,
      UL: 1,
      OL: 1,
      LI: 1,
      TABLE: 1,
      THEAD: 1,
      TBODY: 1,
      TR: 1,
      TD: 1,
      TH: 1,
    };
    const OK_ATTR = { style: 1, class: 1 };
    const clean = (src, dest) => {
      for (const node of Array.prototype.slice.call(src.childNodes)) {
        if (node.nodeType === 3) {
          dest.appendChild(document.createTextNode(node.nodeValue));
          continue;
        }
        if (node.nodeType !== 1) continue;
        if (!OK_TAGS[node.tagName]) {
          // Unknown/unsafe element: keep its text, drop the element itself.
          const span = document.createElement("span");
          clean(node, span);
          while (span.firstChild) dest.appendChild(span.firstChild);
          continue;
        }
        const el = document.createElement(node.tagName.toLowerCase());
        for (const attr of Array.prototype.slice.call(node.attributes)) {
          const n = attr.name.toLowerCase();
          const v = String(attr.value);
          if (!OK_ATTR[n]) continue;
          if (
            /(javascript|data|vbscript):/i.test(v) ||
            /expression\s*\(/i.test(v)
          ) {
            continue;
          }
          el.setAttribute(n, v);
        }
        clean(node, el);
        dest.appendChild(el);
      }
    };
    const frag = document.createDocumentFragment();
    clean(doc.body, frag);
    return frag;
  }
  document.addEventListener("mouseover", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) {
      return;
    }
    var raw = t.getAttribute("data-tip") || "";
    if (raw === "") return; // empty data-tip -> no tooltip
    cur = t;
    // Rich (HTML) tooltips are registered in the trusted __TIP store and the
    // attribute only carries an opaque token (e.g. "#t42"). Plain-text tooltips
    // keep their literal string in the attribute. This means untrusted DOM text
    // is NEVER parsed as HTML - only trusted, app-built HTML from __TIP is.
    var token = /^#t\d+$/.test(raw) ? raw : null;
    if (token) {
      const html = __TIP.get(token);
      if (html == null) return; // token with no (surviving) content -> skip
      tip.replaceChildren(buildTipNodes(html));
      tip.style.whiteSpace = "normal";
    } else {
      // Legacy/plain path: literal text (optionally %-encoded), shown as text.
      var txt = raw;
      if (/%[0-9A-Fa-f]{2}/.test(raw)) {
        try {
          txt = decodeURIComponent(raw);
        } catch (_) {
          txt = raw;
        }
      }
      tip.textContent = txt;
      tip.style.whiteSpace = "pre-line";
    }
    tip.style.display = "block";
    place(e);
    requestAnimationFrame(() => {
      tip.style.opacity = "1";
      place(e);
    });
  });
  document.addEventListener("mousemove", (e) => {
    if (cur) place(e);
  });
  document.addEventListener("mouseout", (e) => {
    const t = e.target.closest("[data-tip]");
    if (t && t === cur) {
      cur = null;
      tip.style.opacity = "0";
      setTimeout(() => {
        if (!cur) tip.style.display = "none";
      }, 100);
    }
  });
})();
